/**
 * Health Check Endpoint Tests - TDD RED Phase
 *
 * These tests define the expected behavior of health check endpoints
 * exposed by the unified storage layer. Health checks enable:
 * - Liveness probes (is the DO running?)
 * - Readiness probes (is state loaded and ready to serve?)
 * - Component status (state manager, pipeline, sql)
 * - Replication lag metrics (for leader-follower setups)
 *
 * NOTE: These tests are designed to FAIL because the implementation
 * does not exist yet. This is the TDD RED phase.
 *
 * @see /objects/unified-storage/health-check.ts (to be created in GREEN phase)
 * @see /docs/architecture/unified-storage.md for health architecture
 * @module tests/unified-storage/health-checks.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from non-existent module - this will cause tests to fail
import {
  HealthCheckManager,
  type HealthCheckConfig,
  type HealthStatus,
  type ComponentHealth,
  type HealthCheckCallback,
  type ReplicationLagMetrics,
} from '../../objects/unified-storage/health-check'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock state manager for testing health checks
 */
const createMockStateManager = (options: {
  isLoaded?: boolean
  loadDurationMs?: number
  thingCount?: number
  dirtyCount?: number
  lastAccessMs?: number
} = {}) => {
  const isLoaded = options.isLoaded ?? true
  const loadDurationMs = options.loadDurationMs ?? 100
  const thingCount = options.thingCount ?? 1000
  const dirtyCount = options.dirtyCount ?? 0
  const lastAccessMs = options.lastAccessMs ?? Date.now()

  return {
    isLoaded: vi.fn(() => isLoaded),
    getLoadDuration: vi.fn(() => loadDurationMs),
    getThingCount: vi.fn(() => thingCount),
    getDirtyCount: vi.fn(() => dirtyCount),
    getLastAccessTime: vi.fn(() => lastAccessMs),
    // Simulate slow operations for blocking tests
    simulateSlowOperation: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }),
  }
}

type MockStateManager = ReturnType<typeof createMockStateManager>

/**
 * Mock pipeline emitter for testing health checks
 */
const createMockPipelineEmitter = (options: {
  isConnected?: boolean
  pendingEvents?: number
  lastSendMs?: number
  errorCount?: number
} = {}) => {
  const isConnected = options.isConnected ?? true
  const pendingEvents = options.pendingEvents ?? 0
  const lastSendMs = options.lastSendMs ?? Date.now()
  const errorCount = options.errorCount ?? 0

  return {
    isConnected: vi.fn(() => isConnected),
    getPendingCount: vi.fn(() => pendingEvents),
    getLastSendTime: vi.fn(() => lastSendMs),
    getErrorCount: vi.fn(() => errorCount),
  }
}

type MockPipelineEmitter = ReturnType<typeof createMockPipelineEmitter>

/**
 * Mock SQL storage for testing health checks
 */
const createMockSqlStorage = (options: {
  isHealthy?: boolean
  lastCheckpointMs?: number
  pendingWrites?: number
  queryLatencyMs?: number
} = {}) => {
  const isHealthy = options.isHealthy ?? true
  const lastCheckpointMs = options.lastCheckpointMs ?? Date.now()
  const pendingWrites = options.pendingWrites ?? 0
  const queryLatencyMs = options.queryLatencyMs ?? 5

  return {
    isHealthy: vi.fn(() => isHealthy),
    getLastCheckpointTime: vi.fn(() => lastCheckpointMs),
    getPendingWriteCount: vi.fn(() => pendingWrites),
    getAverageQueryLatency: vi.fn(() => queryLatencyMs),
    // Simulate health check
    ping: vi.fn(async () => {
      if (!isHealthy) {
        throw new Error('SQL storage unhealthy')
      }
      return queryLatencyMs
    }),
  }
}

type MockSqlStorage = ReturnType<typeof createMockSqlStorage>

/**
 * Mock replication manager for leader-follower health
 */
const createMockReplicationManager = (options: {
  role?: 'leader' | 'follower'
  isHealthy?: boolean
  lagMs?: number
  lagEvents?: number
  lastSyncMs?: number
} = {}) => {
  const role = options.role ?? 'leader'
  const isHealthy = options.isHealthy ?? true
  const lagMs = options.lagMs ?? 0
  const lagEvents = options.lagEvents ?? 0
  const lastSyncMs = options.lastSyncMs ?? Date.now()

  return {
    getRole: vi.fn(() => role),
    isHealthy: vi.fn(() => isHealthy),
    getReplicationLagMs: vi.fn(() => lagMs),
    getReplicationLagEvents: vi.fn(() => lagEvents),
    getLastSyncTime: vi.fn(() => lastSyncMs),
    getLeaderInfo: vi.fn(() => role === 'follower' ? {
      leaderId: 'leader-node-1',
      lastHeartbeatMs: Date.now() - 500,
    } : null),
    getFollowerCount: vi.fn(() => role === 'leader' ? 3 : 0),
  }
}

type MockReplicationManager = ReturnType<typeof createMockReplicationManager>

/**
 * Mock DO state for testing
 */
const createMockDOState = () => {
  return {
    id: {
      toString: () => 'test-unified-do-id',
      name: 'test-namespace',
    },
    storage: {
      sql: createMockSqlStorage(),
    },
    waitUntil: vi.fn(),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('HealthCheckManager', () => {
  let mockStateManager: MockStateManager
  let mockPipelineEmitter: MockPipelineEmitter
  let mockSqlStorage: MockSqlStorage
  let mockReplicationManager: MockReplicationManager
  let healthManager: HealthCheckManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockStateManager = createMockStateManager()
    mockPipelineEmitter = createMockPipelineEmitter()
    mockSqlStorage = createMockSqlStorage()
    mockReplicationManager = createMockReplicationManager()
  })

  afterEach(async () => {
    if (healthManager) {
      await healthManager.close()
    }
    vi.useRealTimers()
  })

  // ============================================================================
  // LIVENESS PROBE TESTS
  // ============================================================================

  describe('/health/live - Liveness Probe', () => {
    it('should return 200 when DO is running', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleLivenessProbe()

      expect(response.status).toBe(200)
      expect(response.body.alive).toBe(true)
    })

    it('should return timestamp in response', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleLivenessProbe()

      expect(response.body.timestamp).toBeDefined()
      expect(typeof response.body.timestamp).toBe('string')
      // Should be ISO 8601 format
      expect(() => new Date(response.body.timestamp)).not.toThrow()
    })

    it('should return quickly (< 10ms)', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const start = Date.now()
      await healthManager.handleLivenessProbe()
      const duration = Date.now() - start

      // Liveness should be near-instant, no external calls
      expect(duration).toBeLessThan(10)
    })

    it('should include DO identifier in response', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        doId: 'test-do-12345',
      })

      const response = await healthManager.handleLivenessProbe()

      expect(response.body.doId).toBe('test-do-12345')
    })

    it('should return uptime information', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      // Advance time to simulate uptime
      await vi.advanceTimersByTimeAsync(60000) // 1 minute

      const response = await healthManager.handleLivenessProbe()

      expect(response.body.uptimeMs).toBeGreaterThanOrEqual(60000)
    })
  })

  // ============================================================================
  // READINESS PROBE TESTS
  // ============================================================================

  describe('/health/ready - Readiness Probe', () => {
    it('should return 200 when state is loaded', async () => {
      mockStateManager = createMockStateManager({ isLoaded: true })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleReadinessProbe()

      expect(response.status).toBe(200)
      expect(response.body.ready).toBe(true)
    })

    it('should return 503 during cold start recovery', async () => {
      // State not loaded yet - simulating cold start
      mockStateManager = createMockStateManager({ isLoaded: false })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleReadinessProbe()

      expect(response.status).toBe(503)
      expect(response.body.ready).toBe(false)
      expect(response.body.reason).toMatch(/loading|recovering|cold.*start/i)
    })

    it('should return 503 when pipeline is disconnected', async () => {
      mockPipelineEmitter = createMockPipelineEmitter({ isConnected: false })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleReadinessProbe()

      expect(response.status).toBe(503)
      expect(response.body.ready).toBe(false)
      expect(response.body.reason).toMatch(/pipeline|disconnected/i)
    })

    it('should return 503 when SQL storage is unhealthy', async () => {
      mockSqlStorage = createMockSqlStorage({ isHealthy: false })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleReadinessProbe()

      expect(response.status).toBe(503)
      expect(response.body.ready).toBe(false)
      expect(response.body.reason).toMatch(/sql|storage|database/i)
    })

    it('should include time since state loaded', async () => {
      mockStateManager = createMockStateManager({
        isLoaded: true,
        loadDurationMs: 250,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleReadinessProbe()

      expect(response.body.loadDurationMs).toBe(250)
    })

    it('should return recovery progress during cold start', async () => {
      mockStateManager = createMockStateManager({
        isLoaded: false,
        thingCount: 500,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        recoveryProgress: {
          phase: 'loading',
          loaded: 500,
          total: 1000,
          elapsedMs: 1500,
        },
      })

      const response = await healthManager.handleReadinessProbe()

      expect(response.status).toBe(503)
      expect(response.body.recoveryProgress).toBeDefined()
      expect(response.body.recoveryProgress.phase).toBe('loading')
      expect(response.body.recoveryProgress.loaded).toBe(500)
      expect(response.body.recoveryProgress.total).toBe(1000)
      expect(response.body.recoveryProgress.percentComplete).toBe(50)
    })
  })

  // ============================================================================
  // COMPONENT STATUS TESTS
  // ============================================================================

  describe('Component Status', () => {
    it('should include state manager health', async () => {
      mockStateManager = createMockStateManager({
        isLoaded: true,
        thingCount: 5000,
        dirtyCount: 50,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.components.state).toBeDefined()
      expect(response.body.components.state.status).toBe('healthy')
      expect(response.body.components.state.loaded).toBe(true)
      expect(response.body.components.state.thingCount).toBe(5000)
      expect(response.body.components.state.dirtyCount).toBe(50)
    })

    it('should include pipeline emitter health', async () => {
      mockPipelineEmitter = createMockPipelineEmitter({
        isConnected: true,
        pendingEvents: 10,
        errorCount: 0,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.components.pipeline).toBeDefined()
      expect(response.body.components.pipeline.status).toBe('healthy')
      expect(response.body.components.pipeline.connected).toBe(true)
      expect(response.body.components.pipeline.pendingEvents).toBe(10)
      expect(response.body.components.pipeline.errorCount).toBe(0)
    })

    it('should include SQL storage health', async () => {
      mockSqlStorage = createMockSqlStorage({
        isHealthy: true,
        pendingWrites: 25,
        queryLatencyMs: 3,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.components.sql).toBeDefined()
      expect(response.body.components.sql.status).toBe('healthy')
      expect(response.body.components.sql.pendingWrites).toBe(25)
      expect(response.body.components.sql.avgQueryLatencyMs).toBe(3)
    })

    it('should report degraded when pipeline has high pending count', async () => {
      mockPipelineEmitter = createMockPipelineEmitter({
        isConnected: true,
        pendingEvents: 10000, // High backlog
        errorCount: 0,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        thresholds: {
          pipelinePendingWarning: 1000,
          pipelinePendingCritical: 5000,
        },
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.components.pipeline.status).toBe('degraded')
    })

    it('should report unhealthy when component fails', async () => {
      // State manager throws on health check
      mockStateManager = createMockStateManager({ isLoaded: false })
      mockStateManager.isLoaded.mockImplementation(() => {
        throw new Error('State manager crashed')
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.components.state.status).toBe('unhealthy')
      expect(response.body.components.state.error).toMatch(/crashed|failed/i)
    })

    it('should aggregate overall status from components', async () => {
      // One component degraded
      mockPipelineEmitter = createMockPipelineEmitter({
        isConnected: true,
        pendingEvents: 10000,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        thresholds: {
          pipelinePendingWarning: 1000,
        },
      })

      const response = await healthManager.handleDetailedHealth()

      // Overall should be degraded if any component is degraded
      expect(response.body.status).toBe('degraded')
    })

    it('should be unhealthy if any critical component is unhealthy', async () => {
      mockSqlStorage = createMockSqlStorage({ isHealthy: false })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.status).toBe('unhealthy')
    })
  })

  // ============================================================================
  // REPLICATION LAG METRICS TESTS
  // ============================================================================

  describe('Replication Lag Metrics', () => {
    it('should include replication lag for followers', async () => {
      mockReplicationManager = createMockReplicationManager({
        role: 'follower',
        lagMs: 150,
        lagEvents: 5,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        replicationManager: mockReplicationManager as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.replication).toBeDefined()
      expect(response.body.replication.role).toBe('follower')
      expect(response.body.replication.lagMs).toBe(150)
      expect(response.body.replication.lagEvents).toBe(5)
    })

    it('should include leader info for followers', async () => {
      mockReplicationManager = createMockReplicationManager({
        role: 'follower',
        lagMs: 50,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        replicationManager: mockReplicationManager as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.replication.leader).toBeDefined()
      expect(response.body.replication.leader.id).toBe('leader-node-1')
      expect(response.body.replication.leader.lastHeartbeatMs).toBeDefined()
    })

    it('should include follower count for leaders', async () => {
      mockReplicationManager = createMockReplicationManager({
        role: 'leader',
        isHealthy: true,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        replicationManager: mockReplicationManager as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.replication.role).toBe('leader')
      expect(response.body.replication.followerCount).toBe(3)
    })

    it('should report degraded when lag exceeds threshold', async () => {
      mockReplicationManager = createMockReplicationManager({
        role: 'follower',
        lagMs: 5000, // 5 seconds - high lag
        lagEvents: 1000,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        replicationManager: mockReplicationManager as any,
        thresholds: {
          replicationLagWarningMs: 1000,
          replicationLagCriticalMs: 10000,
        },
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.replication.status).toBe('degraded')
    })

    it('should report unhealthy when lag exceeds critical threshold', async () => {
      mockReplicationManager = createMockReplicationManager({
        role: 'follower',
        lagMs: 60000, // 60 seconds - critical lag
        lagEvents: 50000,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        replicationManager: mockReplicationManager as any,
        thresholds: {
          replicationLagWarningMs: 1000,
          replicationLagCriticalMs: 30000,
        },
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.replication.status).toBe('unhealthy')
    })

    it('should report last sync time', async () => {
      const lastSyncTime = Date.now() - 1000 // 1 second ago
      mockReplicationManager = createMockReplicationManager({
        role: 'follower',
        lastSyncMs: lastSyncTime,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        replicationManager: mockReplicationManager as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.replication.lastSyncMs).toBe(lastSyncTime)
      expect(response.body.replication.timeSinceLastSyncMs).toBeGreaterThanOrEqual(1000)
    })
  })

  // ============================================================================
  // CUSTOM HEALTH CHECK CALLBACKS
  // ============================================================================

  describe('Custom Health Check Callbacks', () => {
    it('should support registering custom health checks', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const customCheck = vi.fn(async () => ({
        status: 'healthy' as const,
        name: 'custom-service',
        details: { customMetric: 42 },
      }))

      healthManager.registerHealthCheck('custom-service', customCheck)

      const response = await healthManager.handleDetailedHealth()

      expect(customCheck).toHaveBeenCalled()
      expect(response.body.customChecks).toBeDefined()
      expect(response.body.customChecks['custom-service']).toBeDefined()
      expect(response.body.customChecks['custom-service'].status).toBe('healthy')
      expect(response.body.customChecks['custom-service'].customMetric).toBe(42)
    })

    it('should include multiple custom health checks', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      healthManager.registerHealthCheck('external-api', async () => ({
        status: 'healthy',
        name: 'external-api',
        latencyMs: 50,
      }))

      healthManager.registerHealthCheck('cache-layer', async () => ({
        status: 'healthy',
        name: 'cache-layer',
        hitRate: 0.95,
      }))

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.customChecks['external-api']).toBeDefined()
      expect(response.body.customChecks['cache-layer']).toBeDefined()
      expect(response.body.customChecks['external-api'].latencyMs).toBe(50)
      expect(response.body.customChecks['cache-layer'].hitRate).toBe(0.95)
    })

    it('should handle failing custom health checks gracefully', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const failingCheck = vi.fn(async () => {
        throw new Error('Custom service unavailable')
      })

      healthManager.registerHealthCheck('failing-service', failingCheck)

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.customChecks['failing-service']).toBeDefined()
      expect(response.body.customChecks['failing-service'].status).toBe('unhealthy')
      expect(response.body.customChecks['failing-service'].error).toMatch(/unavailable/i)
    })

    it('should unregister custom health checks', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const customCheck = vi.fn(async () => ({
        status: 'healthy' as const,
        name: 'removable-check',
      }))

      healthManager.registerHealthCheck('removable-check', customCheck)
      healthManager.unregisterHealthCheck('removable-check')

      const response = await healthManager.handleDetailedHealth()

      expect(customCheck).not.toHaveBeenCalled()
      expect(response.body.customChecks?.['removable-check']).toBeUndefined()
    })

    it('should timeout slow custom health checks', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        customCheckTimeoutMs: 100,
      })

      const slowCheck = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return { status: 'healthy' as const, name: 'slow-check' }
      })

      healthManager.registerHealthCheck('slow-check', slowCheck)

      // Advance timers to trigger timeout
      const responsePromise = healthManager.handleDetailedHealth()
      await vi.advanceTimersByTimeAsync(150)
      const response = await responsePromise

      expect(response.body.customChecks['slow-check'].status).toBe('unhealthy')
      expect(response.body.customChecks['slow-check'].error).toMatch(/timeout/i)
    })
  })

  // ============================================================================
  // NON-BLOCKING HEALTH CHECKS
  // ============================================================================

  describe('Health Checks Don\'t Block', () => {
    it('should not block on slow state manager operations', async () => {
      mockStateManager = createMockStateManager({ isLoaded: true })
      // Simulate a slow operation running in the state manager
      mockStateManager.simulateSlowOperation.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000))
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      // Start slow operation in background
      const slowOpPromise = mockStateManager.simulateSlowOperation()

      // Health check should return quickly regardless
      const start = Date.now()
      const response = await healthManager.handleLivenessProbe()
      const duration = Date.now() - start

      expect(duration).toBeLessThan(100) // Should not wait for slow operation
      expect(response.status).toBe(200)

      // Cleanup - advance time to complete the slow operation
      await vi.advanceTimersByTimeAsync(10000)
      await slowOpPromise
    })

    it('should use cached status for rapid health checks', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        cacheStatusMs: 1000, // Cache for 1 second
      })

      // First call should compute status
      await healthManager.handleDetailedHealth()
      expect(mockStateManager.isLoaded).toHaveBeenCalledTimes(1)

      // Second call within cache window should use cached status
      await healthManager.handleDetailedHealth()
      expect(mockStateManager.isLoaded).toHaveBeenCalledTimes(1) // Not called again

      // After cache expires, should recompute
      await vi.advanceTimersByTimeAsync(1100)
      await healthManager.handleDetailedHealth()
      expect(mockStateManager.isLoaded).toHaveBeenCalledTimes(2)
    })

    it('should run component checks in parallel', async () => {
      // Create components that each take time to check
      const checkTimes: number[] = []

      mockStateManager.isLoaded.mockImplementation(() => {
        checkTimes.push(Date.now())
        return true
      })

      mockPipelineEmitter.isConnected.mockImplementation(() => {
        checkTimes.push(Date.now())
        return true
      })

      mockSqlStorage.isHealthy.mockImplementation(() => {
        checkTimes.push(Date.now())
        return true
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      await healthManager.handleDetailedHealth()

      // All checks should start at approximately the same time (parallel)
      // The spread should be minimal (< 50ms)
      if (checkTimes.length >= 2) {
        const spread = Math.max(...checkTimes) - Math.min(...checkTimes)
        expect(spread).toBeLessThan(50)
      }
    })

    it('should timeout overall health check if components are slow', async () => {
      // Create a stuck SQL check
      mockSqlStorage.ping.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30000))
        return 0
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        overallTimeoutMs: 5000,
      })

      const responsePromise = healthManager.handleDetailedHealth()
      await vi.advanceTimersByTimeAsync(5100)
      const response = await responsePromise

      // Should return with timeout indication, not hang forever
      expect(response.body.timedOut).toBe(true)
      expect(response.body.components.sql.status).toBe('unknown')
    })
  })

  // ============================================================================
  // DEGRADED STATE TESTS
  // ============================================================================

  describe('Degraded State Reporting', () => {
    it('should report degraded when pipeline is unavailable', async () => {
      mockPipelineEmitter = createMockPipelineEmitter({
        isConnected: false,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.status).toBe('degraded')
      expect(response.body.components.pipeline.status).toBe('unhealthy')
      expect(response.body.degradedReason).toMatch(/pipeline/i)
    })

    it('should report degraded when dirty count is high', async () => {
      mockStateManager = createMockStateManager({
        isLoaded: true,
        dirtyCount: 10000, // High uncommitted changes
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        thresholds: {
          dirtyCountWarning: 1000,
          dirtyCountCritical: 50000,
        },
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.status).toBe('degraded')
      expect(response.body.components.state.status).toBe('degraded')
    })

    it('should report degraded when last checkpoint is old', async () => {
      const oldCheckpoint = Date.now() - 60000 // 1 minute ago
      mockSqlStorage = createMockSqlStorage({
        isHealthy: true,
        lastCheckpointMs: oldCheckpoint,
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        thresholds: {
          checkpointAgeWarningMs: 30000,
          checkpointAgeCriticalMs: 120000,
        },
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.components.sql.status).toBe('degraded')
      expect(response.body.components.sql.lastCheckpointAgeMs).toBeGreaterThanOrEqual(60000)
    })

    it('should aggregate multiple degradation reasons', async () => {
      mockPipelineEmitter = createMockPipelineEmitter({
        isConnected: true,
        pendingEvents: 5000, // High backlog
      })
      mockStateManager = createMockStateManager({
        isLoaded: true,
        dirtyCount: 5000, // High dirty count
      })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        thresholds: {
          pipelinePendingWarning: 1000,
          dirtyCountWarning: 1000,
        },
      })

      const response = await healthManager.handleDetailedHealth()

      expect(response.body.status).toBe('degraded')
      expect(response.body.degradedReasons).toBeInstanceOf(Array)
      expect(response.body.degradedReasons.length).toBe(2)
    })

    it('should recover from degraded to healthy when issues resolve', async () => {
      // Start degraded
      mockPipelineEmitter = createMockPipelineEmitter({ isConnected: false })

      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      let response = await healthManager.handleDetailedHealth()
      expect(response.body.status).toBe('degraded')

      // Simulate pipeline reconnection
      mockPipelineEmitter.isConnected.mockReturnValue(true)

      // Clear cache to get fresh status
      await vi.advanceTimersByTimeAsync(2000)

      response = await healthManager.handleDetailedHealth()
      expect(response.body.status).toBe('healthy')
    })
  })

  // ============================================================================
  // HTTP ENDPOINT INTEGRATION
  // ============================================================================

  describe('HTTP Endpoint Integration', () => {
    it('should handle /health/live endpoint', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const request = new Request('https://test.do/health/live')
      const response = await healthManager.handleRequest(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.alive).toBe(true)
    })

    it('should handle /health/ready endpoint', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const request = new Request('https://test.do/health/ready')
      const response = await healthManager.handleRequest(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ready).toBe(true)
    })

    it('should handle /health endpoint for detailed status', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const request = new Request('https://test.do/health')
      const response = await healthManager.handleRequest(request)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBeDefined()
      expect(body.components).toBeDefined()
    })

    it('should set appropriate cache headers for health endpoints', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const request = new Request('https://test.do/health/live')
      const response = await healthManager.handleRequest(request)

      // Health endpoints should not be cached
      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate')
    })

    it('should return 404 for unknown health endpoints', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      const request = new Request('https://test.do/health/unknown')
      const response = await healthManager.handleRequest(request)

      expect(response.status).toBe(404)
    })
  })

  // ============================================================================
  // CONSTRUCTOR AND CONFIG
  // ============================================================================

  describe('Constructor and Config', () => {
    it('should create manager with minimal config', () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      expect(healthManager).toBeInstanceOf(HealthCheckManager)
    })

    it('should use default thresholds', () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      expect(healthManager.config.thresholds.pipelinePendingWarning).toBe(1000)
      expect(healthManager.config.thresholds.replicationLagWarningMs).toBe(5000)
      expect(healthManager.config.overallTimeoutMs).toBe(5000)
    })

    it('should accept custom thresholds', () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
        thresholds: {
          pipelinePendingWarning: 500,
          replicationLagWarningMs: 2000,
        },
        overallTimeoutMs: 3000,
      })

      expect(healthManager.config.thresholds.pipelinePendingWarning).toBe(500)
      expect(healthManager.config.thresholds.replicationLagWarningMs).toBe(2000)
      expect(healthManager.config.overallTimeoutMs).toBe(3000)
    })

    it('should close gracefully', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      await healthManager.close()

      expect(healthManager.isClosed()).toBe(true)
    })

    it('should reject requests after close', async () => {
      healthManager = new HealthCheckManager({
        stateManager: mockStateManager as any,
        pipelineEmitter: mockPipelineEmitter as any,
        sqlStorage: mockSqlStorage as any,
      })

      await healthManager.close()

      const request = new Request('https://test.do/health/live')
      const response = await healthManager.handleRequest(request)

      expect(response.status).toBe(503)
    })
  })
})
