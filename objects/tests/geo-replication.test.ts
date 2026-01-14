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
 * Uses cloudflare:test with real miniflare - NO MOCKS per CLAUDE.md guidelines.
 * Tests the GeoReplicationModule through real DO stubs via stub.geo.* RPC.
 *
 * @see objects/GeoReplication.ts for implementation
 * @see workers/wrangler.geo-replication.jsonc for test DO configuration
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import type {
  GeoConfigResult,
  WriteResult,
  ReadResult,
  VectorClock,
  ConflictInfo,
  FailoverEvent,
  ReplicationLagMetrics,
  ConsistencyMetrics,
  RegionInfo,
} from '../GeoReplication'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()
let testCounter = 0

/**
 * Generate a unique namespace for each test to ensure isolation
 */
function uniqueNs(prefix: string = 'geo-test'): string {
  return `${prefix}-${testRunId}-${++testCounter}`
}

/**
 * Helper to get a real DO stub with geo-replication module
 */
function getGeoStub(ns: string) {
  const id = env.DO.idFromName(ns)
  return env.DO.get(id) as unknown as {
    geo: {
      configureRegion(config: {
        primary: string
        replicas: string[]
        readPreference?: 'nearest' | 'primary' | 'secondary'
        conflictResolution?: 'lww' | 'vector-clock' | 'manual'
        consistency?: 'eventual' | 'strong' | 'bounded-staleness'
        maxStalenessMs?: number
        failover?: { enabled: boolean; timeoutMs?: number; healthCheckIntervalMs?: number }
        monitoring?: { lagAlertThresholdMs?: number }
      }): Promise<GeoConfigResult>
      getRegionConfig(): Promise<GeoConfigResult>
      listAvailableRegions(): Promise<RegionInfo[]>
      write(key: string, value: unknown): Promise<WriteResult>
      writeBatch(items: Array<{ key: string; value: unknown }>): Promise<WriteResult[]>
      writeWithTimestamp(key: string, value: unknown, timestamp: number): Promise<WriteResult>
      writeWithVectorClock(key: string, value: unknown, vectorClock: VectorClock): Promise<WriteResult>
      writeWithSession(sessionId: string, key: string, value: unknown): Promise<WriteResult>
      read<T = unknown>(key: string, options?: { callerRegion?: string; requireFresh?: boolean }): Promise<ReadResult<T>>
      readWithSession<T = unknown>(sessionId: string, key: string): Promise<ReadResult<T>>
      getVectorClock(key: string): Promise<VectorClock>
      getConflicts(): Promise<ConflictInfo[]>
      getUnresolvedConflicts(): Promise<ConflictInfo[]>
      resolveConflict(key: string, resolvedValue: unknown): Promise<void>
      onConflict(listener: (event: ConflictInfo) => void): Promise<void>
      simulateConcurrentWrite(key: string, value: unknown, region: string): Promise<void>
      getConsistencyConfig(): Promise<ConsistencyMetrics>
      getRegionStatus(region: string): Promise<{ healthy: boolean; lastCheck?: string; responseTime?: number }>
      triggerFailover(): Promise<FailoverEvent>
      getFailoverHistory(): Promise<FailoverEvent[]>
      getReplicationStatus(): Promise<{ primary: string; replicas: string[] }>
      getRegionRole(region: string): Promise<{ role: 'primary' | 'replica' | 'unknown' }>
      getReplicationLag(): Promise<ReplicationLagMetrics>
      getActiveAlerts(): Promise<Array<{ type: string; region?: string; message: string; timestamp: string }>>
      getLagHistory(options: { region: string; duration: string; resolution: string }): Promise<Array<{ timestamp: string; lagMs: number }>>
      getReplicationETA(region: string): Promise<{ pendingWrites: number; estimatedCompletionMs: number }>
      getMetricsPrometheus(): Promise<string>
      measureReplicaLatencies(): Promise<Record<string, number>>
      getRoutingCacheStats(): Promise<{ hits: number; size: number }>
      addReplica(region: string): Promise<void>
      removeReplica(region: string): Promise<void>
      getReplicaStatus(region: string): Promise<{ state: 'syncing' | 'synced' | 'disconnected'; lag?: number; lastSync?: string }>
      getReplicationQueue(region: string): Promise<{ pendingWrites: number }>
      simulateRegionFailure(region: string): Promise<void>
      simulateRegionRecovery(region: string): Promise<void>
      simulatePartition(regions: string[]): Promise<void>
      simulateReplicationLag(region: string, lagMs: number): Promise<void>
      simulateReplicationBacklog(region: string, pendingWrites: number): Promise<void>
      setReplicaLag(region: string, lagMs: number): Promise<void>
    }
  }
}

// ============================================================================
// TEST SUITE: REGION CONFIGURATION
// ============================================================================

describe('Geo-Replication', () => {
  describe('Region Configuration', () => {
    it('should configure primary region', async () => {
      const ns = uniqueNs('config-primary')
      const stub = getGeoStub(ns)

      const result = await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      expect(result.primary).toBe('us-east')
      expect(result.replicas).toContain('eu-west')
      expect(result.replicas).toContain('ap-south')
    })

    it('should get current region configuration', async () => {
      const ns = uniqueNs('config-get')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-west',
        replicas: ['eu-central'],
      })

      const config = await stub.geo.getRegionConfig()

      expect(config.primary).toBe('us-west')
      expect(config.replicas).toEqual(['eu-central'])
      expect(config.version).toBeGreaterThanOrEqual(1)
    })

    it('should validate region codes using IATA format', async () => {
      const ns = uniqueNs('config-validate')
      const stub = getGeoStub(ns)

      // Should accept valid IATA codes
      const validResult = await stub.geo.configureRegion({
        primary: 'ewr',
        replicas: ['lax', 'fra', 'sin'],
      })
      expect(validResult.primary).toBe('ewr')

      // Should reject invalid codes
      await expect(
        stub.geo.configureRegion({
          primary: 'invalid-region-code',
          replicas: [],
        })
      ).rejects.toThrow(/invalid.*region/i)
    })

    it('should support multiple replicas per continent', async () => {
      const ns = uniqueNs('config-multi')
      const stub = getGeoStub(ns)

      const result = await stub.geo.configureRegion({
        primary: 'ewr',
        replicas: ['lax', 'ord', 'fra', 'lhr', 'sin', 'nrt', 'syd'],
      })

      expect(result.replicas.length).toBe(7)
    })

    it('should list available regions with metadata', async () => {
      const ns = uniqueNs('config-list')
      const stub = getGeoStub(ns)

      const regions: RegionInfo[] = await stub.geo.listAvailableRegions()

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
      const ns = uniqueNs('write-forward')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'eu-west',
        replicas: ['us-east', 'ap-south'],
      })

      const result: WriteResult = await stub.geo.write('customer:123', {
        name: 'Alice',
        email: 'alice@example.com',
      })

      expect(result.primaryRegion).toBe('eu-west')
      expect(result.key).toBe('customer:123')
    })

    it('should propagate writes to all replicas', async () => {
      const ns = uniqueNs('write-propagate')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      const result: WriteResult = await stub.geo.write('order:456', {
        items: ['item1', 'item2'],
        total: 99.99,
      })

      expect(result.propagatedTo).toContain('eu-west')
      expect(result.propagatedTo).toContain('ap-south')
      expect(result.propagatedTo.length).toBe(2)
    })

    it('should batch writes for efficiency', async () => {
      const ns = uniqueNs('write-batch')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      const results: WriteResult[] = await stub.geo.writeBatch([
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
      const ns = uniqueNs('write-reject')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Simulate primary unavailable
      await stub.geo.simulateRegionFailure('us-east')

      // Write should fail (unless failover has occurred)
      await expect(
        stub.geo.write('test-key', { value: 'test' })
      ).rejects.toThrow(/primary.*unavailable/i)
    })

    it('should queue writes during network partition', async () => {
      const ns = uniqueNs('write-queue')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Simulate network partition
      await stub.geo.simulatePartition(['eu-west'])

      // Write to primary should succeed but queue for eu-west
      const result = await stub.geo.write('queued-key', { value: 'queued' })

      expect(result.primaryRegion).toBe('us-east')

      // Check queue status
      const queueStatus = await stub.geo.getReplicationQueue('eu-west')
      expect(queueStatus.pendingWrites).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TEST SUITE: READ ROUTING TO NEAREST REPLICA
  // ============================================================================

  describe('Read Routing to Nearest Replica', () => {
    it('should route reads to nearest replica', async () => {
      const ns = uniqueNs('read-nearest')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      // Write data first
      await stub.geo.write('data:123', { value: 'test' })

      // Set caller location hint
      const result: ReadResult = await stub.geo.read('data:123', {
        callerRegion: 'eu-central', // Should route to eu-west
      })

      expect(result.sourceRegion).toBe('eu-west')
    })

    it('should fall back to primary when replicas unavailable', async () => {
      const ns = uniqueNs('read-fallback')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Write data first
      await stub.geo.write('data:456', { value: 'test' })

      // Simulate replica failure
      await stub.geo.simulateRegionFailure('eu-west')

      const result: ReadResult = await stub.geo.read('data:456', {
        callerRegion: 'eu-central',
      })

      expect(result.sourceRegion).toBe('us-east')
    })

    it('should support read preference configuration', async () => {
      const ns = uniqueNs('read-pref')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        readPreference: 'primary',
      })

      // Write data first
      await stub.geo.write('data:789', { value: 'test' })

      // With primary preference, should always read from primary
      const result: ReadResult = await stub.geo.read('data:789', {
        callerRegion: 'ap-northeast',
      })

      expect(result.sourceRegion).toBe('us-east')
    })

    it('should measure latency to each replica', async () => {
      const ns = uniqueNs('read-latency')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      const latencies = await stub.geo.measureReplicaLatencies()

      expect(latencies['us-east']).toBeDefined()
      expect(latencies['eu-west']).toBeDefined()
      expect(latencies['ap-south']).toBeDefined()
      expect(typeof latencies['eu-west']).toBe('number')
    })

    it('should cache routing decisions for performance', async () => {
      const ns = uniqueNs('read-cache')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Write data first
      await stub.geo.write('data:abc', { value: 'test1' })
      await stub.geo.write('data:xyz', { value: 'test2' })

      // First read - routing decision calculated
      const result1 = await stub.geo.read('data:abc', {
        callerRegion: 'eu-central',
      })

      // Second read - should use cached routing
      const result2 = await stub.geo.read('data:xyz', {
        callerRegion: 'eu-central',
      })

      // Both should route to same region
      expect(result1.sourceRegion).toBe(result2.sourceRegion)

      // Check cache stats
      const cacheStats = await stub.geo.getRoutingCacheStats()
      expect(cacheStats.hits).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TEST SUITE: CONFLICT RESOLUTION
  // ============================================================================

  describe('Conflict Resolution', () => {
    describe('Last-Writer-Wins (LWW)', () => {
      it('should resolve conflicts using timestamp', async () => {
        const ns = uniqueNs('conflict-lww')
        const stub = getGeoStub(ns)

        await stub.geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'lww',
        })

        // Simulate concurrent writes with different timestamps
        const earlier = Date.now() - 1000
        const later = Date.now()

        await stub.geo.writeWithTimestamp('key:conflict', 'value-earlier', earlier)
        await stub.geo.writeWithTimestamp('key:conflict', 'value-later', later)

        const result = await stub.geo.read('key:conflict')
        expect(result.value).toBe('value-later')
      })

      it('should use microsecond precision for timestamps', async () => {
        const ns = uniqueNs('conflict-precision')
        const stub = getGeoStub(ns)

        await stub.geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'lww',
        })

        // Write with high-precision timestamps
        const ts1 = 1704067200000.001 // Microsecond precision
        const ts2 = 1704067200000.002

        await stub.geo.writeWithTimestamp('key:precise', 'value1', ts1)
        await stub.geo.writeWithTimestamp('key:precise', 'value2', ts2)

        const result = await stub.geo.read('key:precise')
        expect(result.value).toBe('value2')
      })
    })

    describe('Vector Clocks', () => {
      it('should track vector clocks for causality', async () => {
        const ns = uniqueNs('conflict-vc-track')
        const stub = getGeoStub(ns)

        await stub.geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west', 'ap-south'],
          conflictResolution: 'vector-clock',
        })

        // Write from primary
        await stub.geo.write('key:versioned', { data: 'initial' })

        const clock: VectorClock = await stub.geo.getVectorClock('key:versioned')

        expect(clock['us-east']).toBeDefined()
        expect(clock['us-east']).toBeGreaterThanOrEqual(1)
      })

      it('should detect concurrent writes with vector clocks', async () => {
        const ns = uniqueNs('conflict-vc-detect')
        const stub = getGeoStub(ns)

        await stub.geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'vector-clock',
        })

        // Simulate concurrent writes from different regions
        const clock1: VectorClock = { 'us-east': 1, 'eu-west': 0 }
        const clock2: VectorClock = { 'us-east': 0, 'eu-west': 1 }

        await stub.geo.writeWithVectorClock('key:concurrent', 'value-a', clock1)
        await stub.geo.writeWithVectorClock('key:concurrent', 'value-b', clock2)

        const conflicts: ConflictInfo[] = await stub.geo.getConflicts()

        expect(conflicts.length).toBeGreaterThan(0)
        expect(conflicts[0].key).toBe('key:concurrent')
        expect(conflicts[0].conflictingValues.length).toBe(2)
      })

      it('should merge vector clocks on resolution', async () => {
        const ns = uniqueNs('conflict-vc-merge')
        const stub = getGeoStub(ns)

        await stub.geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'vector-clock',
        })

        // Create conflict
        const clock1: VectorClock = { 'us-east': 2, 'eu-west': 1 }
        const clock2: VectorClock = { 'us-east': 1, 'eu-west': 2 }

        await stub.geo.writeWithVectorClock('key:merge', 'value-a', clock1)
        await stub.geo.writeWithVectorClock('key:merge', 'value-b', clock2)

        // Resolve conflict manually
        await stub.geo.resolveConflict('key:merge', 'value-resolved')

        const newClock = await stub.geo.getVectorClock('key:merge')

        // Merged clock should have max of each component
        expect(newClock['us-east']).toBeGreaterThanOrEqual(2)
        expect(newClock['eu-west']).toBeGreaterThanOrEqual(2)
      })
    })

    describe('Conflict Reporting', () => {
      it('should report unresolved conflicts', async () => {
        const ns = uniqueNs('conflict-report')
        const stub = getGeoStub(ns)

        await stub.geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'manual',
        })

        // Create conflicts
        await stub.geo.simulateConcurrentWrite('key:report1', 'value-a', 'us-east')
        await stub.geo.simulateConcurrentWrite('key:report1', 'value-b', 'eu-west')

        const conflicts = await stub.geo.getUnresolvedConflicts()

        expect(Array.isArray(conflicts)).toBe(true)
        expect(conflicts.length).toBeGreaterThan(0)
      })

      it('should emit conflict events', async () => {
        const ns = uniqueNs('conflict-events')
        const stub = getGeoStub(ns)

        await stub.geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
        })

        // Subscribe to conflict events
        const events: ConflictInfo[] = []
        await stub.geo.onConflict((event: ConflictInfo) => events.push(event))

        // Create conflict
        await stub.geo.simulateConcurrentWrite('key:event', 'value-a', 'us-east')
        await stub.geo.simulateConcurrentWrite('key:event', 'value-b', 'eu-west')

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
      const ns = uniqueNs('consistency-default')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      const config: ConsistencyMetrics = await stub.geo.getConsistencyConfig()

      expect(config.level).toBe('eventual')
    })

    it('should support strong consistency option', async () => {
      const ns = uniqueNs('consistency-strong')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        consistency: 'strong',
      })

      const config: ConsistencyMetrics = await stub.geo.getConsistencyConfig()

      expect(config.level).toBe('strong')
      expect(config.quorumSize).toBeDefined()
    })

    it('should support bounded staleness', async () => {
      const ns = uniqueNs('consistency-bounded')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        consistency: 'bounded-staleness',
        maxStalenessMs: 5000,
      })

      const config: ConsistencyMetrics = await stub.geo.getConsistencyConfig()

      expect(config.level).toBe('bounded-staleness')
      expect(config.staleness).toBe(5000)
    })

    it('should block stale reads when staleness exceeded', async () => {
      const ns = uniqueNs('consistency-stale')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        consistency: 'bounded-staleness',
        maxStalenessMs: 100, // Very low threshold
      })

      // Write data
      await stub.geo.write('key:stale', { value: 'fresh' })

      // Simulate lag exceeding staleness bound
      await stub.geo.simulateReplicationLag('eu-west', 200)

      // Read from eu-west should fail or route to primary
      const result = await stub.geo.read('key:stale', {
        callerRegion: 'eu-west',
        requireFresh: true,
      })

      // Should fall back to primary
      expect(result.sourceRegion).toBe('us-east')
    })

    it('should guarantee read-your-writes consistency', async () => {
      const ns = uniqueNs('consistency-ryw')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Write from a specific session
      const sessionId = 'session-123'
      await stub.geo.writeWithSession(sessionId, 'key:ryw', { value: 'written' })

      // Read with same session should see the write
      const result = await stub.geo.readWithSession(sessionId, 'key:ryw')

      expect(result.value).toEqual({ value: 'written' })
    })
  })

  // ============================================================================
  // TEST SUITE: FAILOVER SCENARIOS
  // ============================================================================

  describe('Failover Scenarios', () => {
    it('should detect primary failure via health checks', async () => {
      const ns = uniqueNs('failover-detect')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        failover: { enabled: true, healthCheckIntervalMs: 100 },
      })

      // Simulate primary failure
      await stub.geo.simulateRegionFailure('us-east')

      const status = await stub.geo.getRegionStatus('us-east')
      expect(status.healthy).toBe(false)
    })

    it('should promote replica to primary on failover', async () => {
      const ns = uniqueNs('failover-promote')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        failover: { enabled: true, timeoutMs: 100 },
      })

      // Simulate primary failure
      await stub.geo.simulateRegionFailure('us-east')

      // Trigger failover
      const failoverEvent: FailoverEvent = await stub.geo.triggerFailover()

      expect(failoverEvent.previousPrimary).toBe('us-east')
      expect(['eu-west', 'ap-south']).toContain(failoverEvent.newPrimary)
      expect(failoverEvent.reason).toBe('health-check')
    })

    it('should select best replica for promotion', async () => {
      const ns = uniqueNs('failover-select')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        failover: { enabled: true },
      })

      // Set eu-west as more up-to-date
      await stub.geo.setReplicaLag('eu-west', 10)
      await stub.geo.setReplicaLag('ap-south', 500)

      // Simulate failure and failover
      await stub.geo.simulateRegionFailure('us-east')
      const failoverEvent = await stub.geo.triggerFailover()

      // Should select replica with lowest lag
      expect(failoverEvent.newPrimary).toBe('eu-west')
    })

    it('should reintegrate recovered primary', async () => {
      const ns = uniqueNs('failover-reintegrate')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        failover: { enabled: true },
      })

      // Simulate failure and failover
      await stub.geo.simulateRegionFailure('us-east')
      await stub.geo.triggerFailover()

      // Verify eu-west is now primary
      const statusAfterFailover = await stub.geo.getReplicationStatus()
      expect(statusAfterFailover.primary).toBe('eu-west')

      // Simulate recovery - the old primary should be healthy but NOT automatically added as replica
      // (that would require explicit addReplica call in production)
      await stub.geo.simulateRegionRecovery('us-east')

      // Verify region is healthy again
      const regionStatus = await stub.geo.getRegionStatus('us-east')
      expect(regionStatus.healthy).toBe(true)

      // In production, you would call addReplica to reintegrate
      await stub.geo.addReplica('us-east')

      const finalStatus = await stub.geo.getReplicationStatus()
      expect(finalStatus.replicas).toContain('us-east')
      expect(finalStatus.primary).toBe('eu-west')
    })

    it('should prevent split-brain scenarios', async () => {
      const ns = uniqueNs('failover-splitbrain')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        failover: { enabled: true },
      })

      // Simulate network partition (not failure)
      await stub.geo.simulatePartition(['us-east'])

      // Both regions might think they're primary
      const usEastStatus = await stub.geo.getRegionRole('us-east')
      const euWestStatus = await stub.geo.getRegionRole('eu-west')

      // System should prevent both being primary
      const primaryCount = [usEastStatus, euWestStatus].filter(
        (s) => s.role === 'primary'
      ).length
      expect(primaryCount).toBe(1)
    })

    it('should track failover history', async () => {
      const ns = uniqueNs('failover-history')
      const stub = getGeoStub(ns)

      // Configure with multiple replicas so we can failover twice
      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        failover: { enabled: true },
      })

      // First failover: us-east -> eu-west
      await stub.geo.simulateRegionFailure('us-east')
      await stub.geo.triggerFailover()

      // Recover us-east and add it back as replica for the second failover
      await stub.geo.simulateRegionRecovery('us-east')
      await stub.geo.addReplica('us-east')

      // Second failover: eu-west -> one of the replicas
      await stub.geo.simulateRegionFailure('eu-west')
      await stub.geo.triggerFailover()

      const history: FailoverEvent[] = await stub.geo.getFailoverHistory()

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
      const ns = uniqueNs('lag-measure')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      const lag: ReplicationLagMetrics = await stub.geo.getReplicationLag()

      expect(typeof lag.maxLagMs).toBe('number')
      expect(typeof lag.avgLagMs).toBe('number')
      expect(lag.byRegion['eu-west']).toBeDefined()
      expect(lag.byRegion['ap-south']).toBeDefined()
    })

    it('should track lag percentiles', async () => {
      const ns = uniqueNs('lag-percentiles')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Generate some traffic to build metrics
      for (let i = 0; i < 100; i++) {
        await stub.geo.write(`key:${i}`, { value: i })
      }

      const lag: ReplicationLagMetrics = await stub.geo.getReplicationLag()

      expect(lag.p50LagMs).toBeDefined()
      expect(lag.p95LagMs).toBeDefined()
      expect(lag.p99LagMs).toBeDefined()
      expect(lag.p50LagMs).toBeLessThanOrEqual(lag.p95LagMs)
      expect(lag.p95LagMs).toBeLessThanOrEqual(lag.p99LagMs)
    })

    it('should alert on excessive lag', async () => {
      const ns = uniqueNs('lag-alert')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        monitoring: { lagAlertThresholdMs: 1000 },
      })

      // Simulate high lag
      await stub.geo.simulateReplicationLag('eu-west', 2000)

      const alerts = await stub.geo.getActiveAlerts()

      expect(alerts.length).toBeGreaterThan(0)
      expect(alerts[0].type).toBe('replication-lag')
      expect(alerts[0].region).toBe('eu-west')
    })

    it('should track lag over time', async () => {
      const ns = uniqueNs('lag-history')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      const history = await stub.geo.getLagHistory({
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
      const ns = uniqueNs('lag-eta')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Simulate backlog
      await stub.geo.simulateReplicationBacklog('eu-west', 1000) // 1000 pending writes

      const eta = await stub.geo.getReplicationETA('eu-west')

      expect(eta.pendingWrites).toBe(1000)
      expect(typeof eta.estimatedCompletionMs).toBe('number')
      expect(eta.estimatedCompletionMs).toBeGreaterThan(0)
    })

    it('should expose lag metrics via prometheus format', async () => {
      const ns = uniqueNs('lag-prometheus')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      const metrics: string = await stub.geo.getMetricsPrometheus()

      expect(metrics).toContain('geo_replication_lag_ms')
      expect(metrics).toContain('eu-west')
    })
  })

  // ============================================================================
  // TEST SUITE: INTEGRATION SCENARIOS
  // ============================================================================

  describe('Integration Scenarios', () => {
    it('should handle full replication lifecycle', async () => {
      const ns = uniqueNs('integration-lifecycle')
      const stub = getGeoStub(ns)

      // 1. Configure regions
      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        consistency: 'eventual',
        failover: { enabled: true },
      })

      // 2. Write data
      await stub.geo.write('user:1', { name: 'Alice' })

      // 3. Read from nearest
      const read1 = await stub.geo.read('user:1', {
        callerRegion: 'eu-central',
      })
      expect(read1.value.name).toBe('Alice')

      // 4. Simulate failover
      await stub.geo.simulateRegionFailure('us-east')
      const failover = await stub.geo.triggerFailover()

      // 5. Verify continued operation
      const read2 = await stub.geo.read('user:1')
      expect(read2.value.name).toBe('Alice')

      // 6. Check metrics
      const lag = await stub.geo.getReplicationLag()
      expect(lag.maxLagMs).toBeDefined()
    })

    it('should handle region addition', async () => {
      const ns = uniqueNs('integration-add')
      const stub = getGeoStub(ns)

      // Start with one replica
      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Write some data
      await stub.geo.write('data:1', { value: 'test' })

      // Simulate lag for the new region before adding (syncing state)
      await stub.geo.simulateReplicationLag('ap-south', 100)

      // Add new replica
      await stub.geo.addReplica('ap-south')

      // Verify new replica is syncing (has lag)
      const status = await stub.geo.getReplicaStatus('ap-south')
      expect(status.state).toBe('syncing')

      // Clear the lag to simulate sync completion
      await stub.geo.simulateReplicationLag('ap-south', 0)

      // Verify replica is now synced
      const finalStatus = await stub.geo.getReplicaStatus('ap-south')
      expect(finalStatus.state).toBe('synced')
    })

    it('should handle region removal', async () => {
      const ns = uniqueNs('integration-remove')
      const stub = getGeoStub(ns)

      await stub.geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      // Remove a replica
      await stub.geo.removeReplica('ap-south')

      const config = await stub.geo.getRegionConfig()
      expect(config.replicas).not.toContain('ap-south')
      expect(config.replicas).toContain('eu-west')
    })
  })
})
