/**
 * ACID Test Suite - Phase 3: Shard Failover
 *
 * RED TDD: These tests define the expected behavior for shard failover
 * and recovery scenarios. All tests are expected to FAIL initially as this is
 * the RED phase.
 *
 * Shard failover provides:
 * - Automatic detection of shard failures
 * - Transparent failover to healthy shards
 * - Recovery and reintegration of failed shards
 * - Split-brain prevention
 * - Data consistency during failover
 * - Health monitoring and alerting
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace, createMockId } from '../../do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS FOR FAILOVER TESTS
// ============================================================================

/**
 * Shard health status
 */
type ShardHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unreachable' | 'recovering'

/**
 * Failover strategy
 */
type FailoverStrategy =
  | 'automatic'       // System decides based on health
  | 'manual'          // Requires explicit trigger
  | 'semi-automatic'  // Automatic detection, manual approval

/**
 * Recovery mode
 */
type RecoveryMode =
  | 'full'           // Full data sync
  | 'incremental'    // Only changed data
  | 'streaming'      // Continuous streaming recovery

/**
 * Shard health check result
 */
interface ShardHealthCheck {
  /** Shard index */
  shardIndex: number
  /** Health status */
  status: ShardHealthStatus
  /** Response time (ms) */
  responseTime: number
  /** Last successful check */
  lastHealthy: Date
  /** Error if unhealthy */
  error?: string
  /** Number of consecutive failures */
  consecutiveFailures: number
  /** Storage utilization (0-1) */
  storageUtilization?: number
  /** CPU utilization (0-1) */
  cpuUtilization?: number
}

/**
 * Failover configuration
 */
interface FailoverConfig {
  /** Failover strategy */
  strategy: FailoverStrategy
  /** Health check interval (ms) */
  healthCheckInterval: number
  /** Failures before marking unhealthy */
  failureThreshold: number
  /** Time window for failure counting */
  failureWindow: number
  /** Auto-recovery enabled */
  autoRecovery: boolean
  /** Recovery mode */
  recoveryMode: RecoveryMode
  /** Enable split-brain protection */
  splitBrainProtection: boolean
}

/**
 * Failover event
 */
interface FailoverEvent {
  /** Event type */
  type: 'failover.started' | 'failover.completed' | 'failover.failed' | 'recovery.started' | 'recovery.completed' | 'health.changed'
  /** Shard involved */
  shardIndex: number
  /** Timestamp */
  timestamp: Date
  /** Additional data */
  data?: Record<string, unknown>
}

/**
 * Failover result
 */
interface FailoverResult {
  /** Whether failover succeeded */
  success: boolean
  /** Source shard (failed) */
  sourceShard: number
  /** Target shard (if redirected) */
  targetShard?: number
  /** Duration of failover */
  duration: number
  /** Data operations affected */
  operationsAffected: number
  /** Error if failed */
  error?: string
}

/**
 * Recovery result
 */
interface RecoveryResult {
  /** Whether recovery succeeded */
  success: boolean
  /** Shard that recovered */
  shardIndex: number
  /** Records synchronized */
  recordsSynced: number
  /** Duration of recovery */
  duration: number
  /** Data verification result */
  dataVerified: boolean
  /** Errors encountered */
  errors: string[]
}

/**
 * Shard registry
 */
interface ShardRegistry {
  id: string
  shardKey: string
  shardCount: number
  strategy: 'hash' | 'range' | 'roundRobin' | 'custom'
  createdAt: Date
  endpoints: Array<{
    shardIndex: number
    ns: string
    doId: string
    status: 'active' | 'inactive' | 'rebalancing' | 'failed' | 'recovering'
  }>
}

/**
 * Thing record
 */
interface ThingRecord {
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  visibility: string
  version?: number
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create mock shard data
 */
function createMockShardData(shardCount: number, thingsPerShard: number): Map<number, ThingRecord[]> {
  const shardData = new Map<number, ThingRecord[]>()

  for (let shard = 0; shard < shardCount; shard++) {
    const things: ThingRecord[] = []
    for (let i = 0; i < thingsPerShard; i++) {
      things.push({
        id: `shard${shard}-thing-${i}`,
        type: 1,
        branch: null,
        name: `Shard ${shard} Item ${i}`,
        data: { tenantId: `tenant-${shard}`, value: i },
        deleted: false,
        visibility: 'user',
        version: 1,
      })
    }
    shardData.set(shard, things)
  }

  return shardData
}

/**
 * Create shard registry for testing
 */
function createShardRegistry(shardCount: number): ShardRegistry {
  return {
    id: 'shard-set-1',
    shardKey: 'tenantId',
    shardCount,
    strategy: 'hash',
    createdAt: new Date(),
    endpoints: Array.from({ length: shardCount }, (_, i) => ({
      shardIndex: i,
      ns: `https://shard-${i}.test.do`,
      doId: `shard-do-${i}`,
      status: 'active' as const,
    })),
  }
}

// ============================================================================
// TEST SUITE: HEALTH MONITORING
// ============================================================================

describe('shard failover - health monitoring', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: FailoverEvent[]
  let shardData: Map<number, ThingRecord[]>

  beforeEach(() => {
    capturedEvents = []
    shardData = createMockShardData(4, 25)

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as FailoverEvent['type'],
        shardIndex: (data as Record<string, unknown>)?.shardIndex as number ?? -1,
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', createShardRegistry(4))

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        status: 'healthy',
        responseTime: 10,
      }))),
    })
    result.env.DO = mockNamespace
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('health checks', () => {
    it('should perform health checks on all shards', async () => {
      // RED: Should check health of all shards
      const healthChecks = await (result.instance as unknown as {
        checkShardHealth(): Promise<ShardHealthCheck[]>
      }).checkShardHealth()

      expect(healthChecks).toHaveLength(4)
      expect(healthChecks.every((h) => h.status === 'healthy')).toBe(true)
    })

    it('should measure response time for each shard', async () => {
      // RED: Should track response times
      const healthChecks = await (result.instance as unknown as {
        checkShardHealth(): Promise<ShardHealthCheck[]>
      }).checkShardHealth()

      expect(healthChecks.every((h) => h.responseTime >= 0)).toBe(true)
    })

    it('should detect slow shards as degraded', async () => {
      // RED: Slow response should mark as degraded
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 2) {
            await new Promise((resolve) => setTimeout(resolve, 500)) // Slow
          }
          return new Response(JSON.stringify({ status: 'healthy' }))
        }),
      })

      const healthChecks = await (result.instance as unknown as {
        checkShardHealth(options?: { slowThreshold?: number }): Promise<ShardHealthCheck[]>
      }).checkShardHealth({ slowThreshold: 100 })

      const slowShard = healthChecks.find((h) => h.shardIndex === 2)
      expect(slowShard?.status).toBe('degraded')
    })

    it('should detect unreachable shards', async () => {
      // RED: Connection failures should mark as unreachable
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 1) {
            throw new Error('Connection refused')
          }
          return new Response(JSON.stringify({ status: 'healthy' }))
        }),
      })

      const healthChecks = await (result.instance as unknown as {
        checkShardHealth(): Promise<ShardHealthCheck[]>
      }).checkShardHealth()

      const unreachableShard = healthChecks.find((h) => h.shardIndex === 1)
      expect(unreachableShard?.status).toBe('unreachable')
      expect(unreachableShard?.error).toBeDefined()
    })

    it('should track consecutive failures', async () => {
      // RED: Should count consecutive failures
      const mockNamespace = result.env.DO!
      let callCount = 0
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 3) {
            callCount++
            throw new Error('Shard 3 error')
          }
          return new Response(JSON.stringify({ status: 'healthy' }))
        }),
      })

      // Run multiple health checks
      await (result.instance as unknown as {
        checkShardHealth(): Promise<ShardHealthCheck[]>
      }).checkShardHealth()
      await (result.instance as unknown as {
        checkShardHealth(): Promise<ShardHealthCheck[]>
      }).checkShardHealth()
      const healthChecks = await (result.instance as unknown as {
        checkShardHealth(): Promise<ShardHealthCheck[]>
      }).checkShardHealth()

      const failingShard = healthChecks.find((h) => h.shardIndex === 3)
      expect(failingShard?.consecutiveFailures).toBeGreaterThanOrEqual(3)
    })

    it('should emit health change events', async () => {
      // RED: Should emit events on status change
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 0) {
            throw new Error('Shard 0 failed')
          }
          return new Response(JSON.stringify({ status: 'healthy' }))
        }),
      })

      // First check establishes baseline
      result.storage.data.set('lastHealthStatus', {
        0: 'healthy',
        1: 'healthy',
        2: 'healthy',
        3: 'healthy',
      })

      await (result.instance as unknown as {
        checkShardHealth(): Promise<ShardHealthCheck[]>
      }).checkShardHealth()

      const healthChangeEvent = capturedEvents.find((e) => e.type === 'health.changed')
      expect(healthChangeEvent).toBeDefined()
      expect(healthChangeEvent?.shardIndex).toBe(0)
    })
  })

  describe('health aggregation', () => {
    it('should calculate overall cluster health', async () => {
      // RED: Should aggregate health status
      const clusterHealth = await (result.instance as unknown as {
        getClusterHealth(): Promise<{
          status: 'healthy' | 'degraded' | 'critical'
          healthyShards: number
          totalShards: number
        }>
      }).getClusterHealth()

      expect(clusterHealth.status).toBe('healthy')
      expect(clusterHealth.healthyShards).toBe(4)
      expect(clusterHealth.totalShards).toBe(4)
    })

    it('should mark cluster as degraded when some shards fail', async () => {
      // RED: Partial failures should degrade cluster
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 1) {
            throw new Error('Shard 1 failed')
          }
          return new Response(JSON.stringify({ status: 'healthy' }))
        }),
      })

      const clusterHealth = await (result.instance as unknown as {
        getClusterHealth(): Promise<{
          status: 'healthy' | 'degraded' | 'critical'
          healthyShards: number
          totalShards: number
        }>
      }).getClusterHealth()

      expect(clusterHealth.status).toBe('degraded')
      expect(clusterHealth.healthyShards).toBe(3)
    })

    it('should mark cluster as critical when majority fails', async () => {
      // RED: Majority failure should be critical
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex < 3) { // 3 of 4 fail
            throw new Error(`Shard ${shardIndex} failed`)
          }
          return new Response(JSON.stringify({ status: 'healthy' }))
        }),
      })

      const clusterHealth = await (result.instance as unknown as {
        getClusterHealth(): Promise<{
          status: 'healthy' | 'degraded' | 'critical'
          healthyShards: number
          totalShards: number
        }>
      }).getClusterHealth()

      expect(clusterHealth.status).toBe('critical')
    })
  })
})

// ============================================================================
// TEST SUITE: AUTOMATIC FAILOVER
// ============================================================================

describe('shard failover - automatic failover', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: FailoverEvent[]

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as FailoverEvent['type'],
        shardIndex: (data as Record<string, unknown>)?.shardIndex as number ?? -1,
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', createShardRegistry(4))
    result.storage.data.set('failoverConfig', {
      strategy: 'automatic',
      healthCheckInterval: 1000,
      failureThreshold: 3,
      failureWindow: 10000,
      autoRecovery: true,
      recoveryMode: 'incremental',
      splitBrainProtection: true,
    } as FailoverConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('failover trigger', () => {
    it('should trigger failover after threshold failures', async () => {
      // RED: Should failover after configured failures
      result.storage.data.set('shardHealthHistory', {
        2: { consecutiveFailures: 3, lastHealthy: new Date(Date.now() - 60000) },
      })

      const failoverResult = await (result.instance as unknown as {
        checkAndFailover(): Promise<FailoverResult | null>
      }).checkAndFailover()

      expect(failoverResult).toBeDefined()
      expect(failoverResult?.sourceShard).toBe(2)
    })

    it('should emit failover.started event', async () => {
      // RED: Should emit event when failover starts
      result.storage.data.set('shardHealthHistory', {
        1: { consecutiveFailures: 5, lastHealthy: new Date(Date.now() - 120000) },
      })

      await (result.instance as unknown as {
        checkAndFailover(): Promise<FailoverResult | null>
      }).checkAndFailover()

      const failoverStarted = capturedEvents.find((e) => e.type === 'failover.started')
      expect(failoverStarted).toBeDefined()
      expect(failoverStarted?.shardIndex).toBe(1)
    })

    it('should update shard status to failed', async () => {
      // RED: Registry should reflect failed status
      result.storage.data.set('shardHealthHistory', {
        0: { consecutiveFailures: 3, lastHealthy: new Date(Date.now() - 60000) },
      })

      await (result.instance as unknown as {
        checkAndFailover(): Promise<FailoverResult | null>
      }).checkAndFailover()

      const registry = result.storage.data.get('shardRegistry') as ShardRegistry
      const failedShard = registry.endpoints.find((e) => e.shardIndex === 0)
      expect(failedShard?.status).toBe('failed')
    })

    it('should not failover if within threshold', async () => {
      // RED: Should not failover prematurely
      result.storage.data.set('shardHealthHistory', {
        3: { consecutiveFailures: 2, lastHealthy: new Date() }, // Below threshold
      })

      const failoverResult = await (result.instance as unknown as {
        checkAndFailover(): Promise<FailoverResult | null>
      }).checkAndFailover()

      expect(failoverResult).toBeNull()
    })
  })

  describe('query rerouting', () => {
    it('should reroute queries from failed shard', async () => {
      // RED: Queries should not go to failed shard
      const mockNamespace = createMockDONamespace()
      const queriedShards: number[] = []
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          queriedShards.push(shardIndex)
          return new Response(JSON.stringify({ data: [] }))
        }),
      })
      result.env.DO = mockNamespace

      // Mark shard 1 as failed
      const registry = result.storage.data.get('shardRegistry') as ShardRegistry
      registry.endpoints[1].status = 'failed'
      result.storage.data.set('shardRegistry', registry)

      await (result.instance as unknown as {
        queryAllShards(query: string): Promise<unknown[]>
      }).queryAllShards('SELECT * FROM things')

      expect(queriedShards).not.toContain(1)
    })

    it('should maintain data availability during failover', async () => {
      // RED: Data should remain accessible
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          if (shardIndex === 2) {
            throw new Error('Shard 2 is down')
          }
          return new Response(JSON.stringify({
            data: [{ id: `item-from-shard-${shardIndex}` }],
          }))
        }),
      })
      result.env.DO = mockNamespace

      // Start failover process
      result.storage.data.set('shardHealthHistory', {
        2: { consecutiveFailures: 5, lastHealthy: new Date(Date.now() - 120000) },
      })

      await (result.instance as unknown as {
        checkAndFailover(): Promise<FailoverResult | null>
      }).checkAndFailover()

      // Queries should still return data from other shards
      const queryResult = await (result.instance as unknown as {
        queryAllShards(query: string): Promise<unknown[]>
      }).queryAllShards('SELECT * FROM things')

      expect(queryResult.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// TEST SUITE: RECOVERY
// ============================================================================

describe('shard failover - recovery', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: FailoverEvent[]

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as FailoverEvent['type'],
        shardIndex: (data as Record<string, unknown>)?.shardIndex as number ?? -1,
        timestamp: new Date(),
        data: data as Record<string, unknown>,
      })
      return originalEmit?.call(result.instance, verb, data)
    }

    result.storage.data.set('isSharded', true)
    const registry = createShardRegistry(4)
    registry.endpoints[2].status = 'failed' // Shard 2 is failed
    result.storage.data.set('shardRegistry', registry)

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))),
    })
    result.env.DO = mockNamespace
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('recovery initiation', () => {
    it('should detect when failed shard becomes healthy', async () => {
      // RED: Should detect recovered shard
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'healthy' }))),
      })

      const recoveryNeeded = await (result.instance as unknown as {
        checkForRecovery(): Promise<number[]>
      }).checkForRecovery()

      expect(recoveryNeeded).toContain(2)
    })

    it('should emit recovery.started event', async () => {
      // RED: Should emit event on recovery start
      await (result.instance as unknown as {
        recoverShard(shardIndex: number): Promise<RecoveryResult>
      }).recoverShard(2)

      const recoveryStarted = capturedEvents.find((e) => e.type === 'recovery.started')
      expect(recoveryStarted).toBeDefined()
      expect(recoveryStarted?.shardIndex).toBe(2)
    })

    it('should mark shard as recovering', async () => {
      // RED: Status should update to recovering
      const recoveryPromise = (result.instance as unknown as {
        recoverShard(shardIndex: number): Promise<RecoveryResult>
      }).recoverShard(2)

      // Check status during recovery
      const registry = result.storage.data.get('shardRegistry') as ShardRegistry
      const recoveringShard = registry.endpoints.find((e) => e.shardIndex === 2)
      expect(recoveringShard?.status).toBe('recovering')

      await recoveryPromise
    })
  })

  describe('data synchronization', () => {
    it('should synchronize missed data to recovering shard', async () => {
      // RED: Should sync data that was written during downtime
      result.storage.data.set('missedWrites', {
        2: [
          { type: 'insert', data: { id: 'new-1' }, timestamp: Date.now() - 30000 },
          { type: 'update', data: { id: 'existing-1' }, timestamp: Date.now() - 20000 },
          { type: 'delete', data: { id: 'deleted-1' }, timestamp: Date.now() - 10000 },
        ],
      })

      const recoveryResult = await (result.instance as unknown as {
        recoverShard(shardIndex: number): Promise<RecoveryResult>
      }).recoverShard(2)

      expect(recoveryResult.recordsSynced).toBe(3)
    })

    it('should verify data integrity after sync', async () => {
      // RED: Should verify all data was synced correctly
      const recoveryResult = await (result.instance as unknown as {
        recoverShard(shardIndex: number, options?: { verify?: boolean }): Promise<RecoveryResult>
      }).recoverShard(2, { verify: true })

      expect(recoveryResult.dataVerified).toBe(true)
    })

    it('should handle sync failures gracefully', async () => {
      // RED: Should report sync errors
      const mockNamespace = result.env.DO!
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (request: Request) => {
          const url = new URL(request.url)
          if (url.pathname.includes('/sync')) {
            throw new Error('Sync failed')
          }
          return new Response(JSON.stringify({ success: true }))
        }),
      })

      const recoveryResult = await (result.instance as unknown as {
        recoverShard(shardIndex: number): Promise<RecoveryResult>
      }).recoverShard(2)

      expect(recoveryResult.success).toBe(false)
      expect(recoveryResult.errors.length).toBeGreaterThan(0)
    })
  })

  describe('recovery completion', () => {
    it('should mark shard as active after successful recovery', async () => {
      // RED: Status should return to active
      await (result.instance as unknown as {
        recoverShard(shardIndex: number): Promise<RecoveryResult>
      }).recoverShard(2)

      const registry = result.storage.data.get('shardRegistry') as ShardRegistry
      const recoveredShard = registry.endpoints.find((e) => e.shardIndex === 2)
      expect(recoveredShard?.status).toBe('active')
    })

    it('should emit recovery.completed event', async () => {
      // RED: Should emit completion event
      await (result.instance as unknown as {
        recoverShard(shardIndex: number): Promise<RecoveryResult>
      }).recoverShard(2)

      const recoveryCompleted = capturedEvents.find((e) => e.type === 'recovery.completed')
      expect(recoveryCompleted).toBeDefined()
      expect(recoveryCompleted?.shardIndex).toBe(2)
    })

    it('should resume normal routing to recovered shard', async () => {
      // RED: Queries should be routed to recovered shard again
      await (result.instance as unknown as {
        recoverShard(shardIndex: number): Promise<RecoveryResult>
      }).recoverShard(2)

      const mockNamespace = createMockDONamespace()
      const queriedShards: number[] = []
      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
          queriedShards.push(shardIndex)
          return new Response(JSON.stringify({ data: [] }))
        }),
      })
      result.env.DO = mockNamespace

      await (result.instance as unknown as {
        queryAllShards(query: string): Promise<unknown[]>
      }).queryAllShards('SELECT * FROM things')

      expect(queriedShards).toContain(2)
    })
  })
})

// ============================================================================
// TEST SUITE: SPLIT-BRAIN PREVENTION
// ============================================================================

describe('shard failover - split-brain prevention', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', createShardRegistry(4))
    result.storage.data.set('failoverConfig', {
      strategy: 'automatic',
      splitBrainProtection: true,
    } as Partial<FailoverConfig>)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should require quorum for failover decisions', async () => {
    // RED: Should not failover without quorum
    result.storage.data.set('clusterQuorum', {
      required: 3,
      available: 2, // Below quorum
    })

    result.storage.data.set('shardHealthHistory', {
      1: { consecutiveFailures: 10, lastHealthy: new Date(Date.now() - 300000) },
    })

    await expect(
      (result.instance as unknown as {
        checkAndFailover(): Promise<FailoverResult | null>
      }).checkAndFailover()
    ).rejects.toThrow(/quorum|insufficient/i)
  })

  it('should fence off stale shard on network partition recovery', async () => {
    // RED: Should prevent stale shard from accepting writes
    result.storage.data.set('fencingTokens', {
      2: { token: 'old-token', epoch: 5 },
    })

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockImplementation(async (request: Request) => {
        const shardIndex = parseInt(id.toString().replace('shard-do-', ''), 10)
        if (shardIndex === 2) {
          // Shard reports old epoch
          return new Response(JSON.stringify({
            status: 'healthy',
            epoch: 3, // Old epoch
          }))
        }
        return new Response(JSON.stringify({ status: 'healthy', epoch: 5 }))
      }),
    })
    result.env.DO = mockNamespace

    const fencingResult = await (result.instance as unknown as {
      checkFencing(): Promise<{ fencedShards: number[] }>
    }).checkFencing()

    expect(fencingResult.fencedShards).toContain(2)
  })

  it('should use monotonic epoch numbers', async () => {
    // RED: Epoch should always increase
    const initialEpoch = result.storage.data.get('currentEpoch') || 0

    await (result.instance as unknown as {
      incrementEpoch(): Promise<number>
    }).incrementEpoch()

    const newEpoch = result.storage.data.get('currentEpoch')
    expect(newEpoch).toBeGreaterThan(initialEpoch)
  })

  it('should reject writes from shards with stale epoch', async () => {
    // RED: Stale writes should be rejected
    result.storage.data.set('currentEpoch', 10)

    const writeRequest = {
      shardIndex: 1,
      epoch: 8, // Stale
      operation: { type: 'insert', data: { id: 'new-item' } },
    }

    await expect(
      (result.instance as unknown as {
        validateShardWrite(request: typeof writeRequest): Promise<void>
      }).validateShardWrite(writeRequest)
    ).rejects.toThrow(/stale.*epoch|fenced/i)
  })
})

// ============================================================================
// TEST SUITE: MANUAL FAILOVER
// ============================================================================

describe('shard failover - manual operations', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', createShardRegistry(4))

    const mockNamespace = createMockDONamespace()
    mockNamespace.stubFactory = (id) => ({
      id,
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))),
    })
    result.env.DO = mockNamespace
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should support manual shard deactivation', async () => {
    // RED: Should be able to manually deactivate shard
    await (result.instance as unknown as {
      deactivateShard(shardIndex: number, reason: string): Promise<void>
    }).deactivateShard(1, 'Planned maintenance')

    const registry = result.storage.data.get('shardRegistry') as ShardRegistry
    const deactivatedShard = registry.endpoints.find((e) => e.shardIndex === 1)
    expect(deactivatedShard?.status).toBe('inactive')
  })

  it('should support manual shard activation', async () => {
    // RED: Should be able to manually activate shard
    const registry = result.storage.data.get('shardRegistry') as ShardRegistry
    registry.endpoints[3].status = 'inactive'
    result.storage.data.set('shardRegistry', registry)

    await (result.instance as unknown as {
      activateShard(shardIndex: number): Promise<void>
    }).activateShard(3)

    const updatedRegistry = result.storage.data.get('shardRegistry') as ShardRegistry
    const activatedShard = updatedRegistry.endpoints.find((e) => e.shardIndex === 3)
    expect(activatedShard?.status).toBe('active')
  })

  it('should support forced failover', async () => {
    // RED: Should be able to force failover even on healthy shard
    const failoverResult = await (result.instance as unknown as {
      forceFailover(shardIndex: number, reason: string): Promise<FailoverResult>
    }).forceFailover(0, 'Testing failover procedure')

    expect(failoverResult.success).toBe(true)
    expect(failoverResult.sourceShard).toBe(0)
  })

  it('should validate shard index for manual operations', async () => {
    // RED: Should reject invalid shard indices
    await expect(
      (result.instance as unknown as {
        deactivateShard(shardIndex: number, reason: string): Promise<void>
      }).deactivateShard(99, 'Invalid shard')
    ).rejects.toThrow(/invalid.*shard|not.*found/i)
  })

  it('should log manual operations for audit', async () => {
    // RED: Should maintain audit log
    await (result.instance as unknown as {
      deactivateShard(shardIndex: number, reason: string): Promise<void>
    }).deactivateShard(2, 'Testing')

    const auditLog = result.storage.data.get('auditLog') as Array<{
      action: string
      shardIndex: number
      reason: string
      timestamp: Date
    }>

    expect(auditLog).toBeDefined()
    expect(auditLog.length).toBeGreaterThan(0)
    expect(auditLog[auditLog.length - 1].action).toBe('deactivate')
  })
})

// ============================================================================
// TEST SUITE: VALIDATION
// ============================================================================

describe('shard failover - validation', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', [
          { name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() },
        ]],
      ]),
    })

    result.storage.data.set('isSharded', true)
    result.storage.data.set('shardRegistry', createShardRegistry(4))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should reject failover operations on non-sharded DO', async () => {
    // RED: Cannot perform failover if not sharded
    result.storage.data.set('isSharded', false)

    await expect(
      (result.instance as unknown as {
        checkShardHealth(): Promise<ShardHealthCheck[]>
      }).checkShardHealth()
    ).rejects.toThrow(/not.*sharded/i)
  })

  it('should validate failover configuration', async () => {
    // RED: Should validate config
    await expect(
      (result.instance as unknown as {
        setFailoverConfig(config: Partial<FailoverConfig>): Promise<void>
      }).setFailoverConfig({
        failureThreshold: -1, // Invalid
      })
    ).rejects.toThrow(/invalid.*threshold|positive/i)
  })

  it('should reject recovery of active shard', async () => {
    // RED: Cannot recover already-active shard
    await expect(
      (result.instance as unknown as {
        recoverShard(shardIndex: number): Promise<RecoveryResult>
      }).recoverShard(0) // Shard 0 is already active
    ).rejects.toThrow(/already.*active|not.*failed/i)
  })
})
