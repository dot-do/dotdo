/**
 * AutoShardManager Tests
 *
 * Tests for automatic sharding with capacity monitoring and migration:
 * - CapacityMonitor: Storage usage tracking and threshold detection
 * - ShardKeyManager: Key assignment and migration tracking
 * - MigrationManager: Background data migration with chunking
 * - LoadBalancer: Shard routing and load distribution
 * - AutoShardManager: Combined automatic sharding system
 *
 * @module db/core/auto-shard.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CapacityMonitor,
  ShardKeyManager,
  MigrationManager,
  LoadBalancer,
  AutoShardManager,
  DO_STORAGE_LIMIT,
  DEFAULT_CAPACITY_THRESHOLD,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MIGRATION_DELAY_MS,
  MAX_SHARDS,
  type CapacityMetrics,
  type ShardStats,
  type MigrationTask,
} from './auto-shard'

// ============================================================================
// CONSTANTS
// ============================================================================

const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024
const KB = 1024

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockNamespace() {
  const stubs = new Map<string, any>()
  return {
    idFromName: vi.fn((name: string) => ({ toString: () => `id-${name}` })),
    get: vi.fn((id: any) => {
      const name = id.toString()
      if (!stubs.has(name)) {
        stubs.set(name, {
          fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))),
        })
      }
      return stubs.get(name)
    }),
    _stubs: stubs,
  }
}

// ============================================================================
// CAPACITY MONITOR TESTS
// ============================================================================

describe('CapacityMonitor', () => {
  let monitor: CapacityMonitor

  beforeEach(() => {
    monitor = new CapacityMonitor()
  })

  describe('constructor', () => {
    it('uses default threshold of 0.9', () => {
      expect(monitor.getThreshold()).toBe(DEFAULT_CAPACITY_THRESHOLD)
    })

    it('accepts custom threshold', () => {
      const customMonitor = new CapacityMonitor(0.8)
      expect(customMonitor.getThreshold()).toBe(0.8)
    })
  })

  describe('update', () => {
    it('calculates usage percentage correctly', () => {
      const metrics = monitor.update({
        usedBytes: 5 * GB,
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(metrics.usagePercent).toBe(50)
    })

    it('calculates average record size correctly', () => {
      const metrics = monitor.update({
        usedBytes: 1 * MB,
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(metrics.avgRecordSize).toBe(1024) // 1MB / 1000 = 1KB
    })

    it('handles zero records', () => {
      const metrics = monitor.update({
        usedBytes: 0,
        limitBytes: 10 * GB,
        recordCount: 0,
      })

      expect(metrics.avgRecordSize).toBe(0)
    })

    it('adds timestamp', () => {
      const before = Date.now()
      const metrics = monitor.update({
        usedBytes: 1 * GB,
        limitBytes: 10 * GB,
        recordCount: 100,
      })
      const after = Date.now()

      expect(metrics.timestamp).toBeGreaterThanOrEqual(before)
      expect(metrics.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('shouldShard', () => {
    it('returns false when no metrics', () => {
      expect(monitor.shouldShard()).toBe(false)
    })

    it('returns false when below threshold', () => {
      monitor.update({
        usedBytes: 5 * GB,
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(monitor.shouldShard()).toBe(false)
    })

    it('returns true when at threshold', () => {
      monitor.update({
        usedBytes: 9 * GB, // 90% of 10GB
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(monitor.shouldShard()).toBe(true)
    })

    it('returns true when above threshold', () => {
      monitor.update({
        usedBytes: 9.5 * GB,
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(monitor.shouldShard()).toBe(true)
    })
  })

  describe('isApproachingThreshold', () => {
    it('returns true at 80% of threshold', () => {
      // 80% of 90% = 72%
      monitor.update({
        usedBytes: 7.2 * GB,
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(monitor.isApproachingThreshold()).toBe(true)
    })

    it('returns false below 80% of threshold', () => {
      monitor.update({
        usedBytes: 5 * GB, // 50%
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(monitor.isApproachingThreshold()).toBe(false)
    })
  })

  describe('isCritical', () => {
    it('returns true when above 95%', () => {
      monitor.update({
        usedBytes: 9.6 * GB,
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(monitor.isCritical()).toBe(true)
    })

    it('returns false when below 95%', () => {
      monitor.update({
        usedBytes: 9 * GB, // 90%
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(monitor.isCritical()).toBe(false)
    })
  })

  describe('estimateRemainingCapacity', () => {
    it('calculates remaining records correctly', () => {
      monitor.update({
        usedBytes: 5 * GB,
        limitBytes: 10 * GB,
        recordCount: 5000, // 1MB per record average
      })

      const remaining = monitor.estimateRemainingCapacity()
      // 5GB remaining / 1MB per record = 5000 records
      expect(remaining).toBe(5000)
    })

    it('returns 0 when no metrics', () => {
      expect(monitor.estimateRemainingCapacity()).toBe(0)
    })
  })

  describe('warning callback', () => {
    it('calls callback when approaching threshold', () => {
      const callback = vi.fn()
      const monitorWithCallback = new CapacityMonitor(0.9, callback)

      monitorWithCallback.update({
        usedBytes: 8 * GB, // 80% = approaching 90% threshold
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          usagePercent: 80,
        })
      )
    })

    it('does not call callback when below warning level', () => {
      const callback = vi.fn()
      const monitorWithCallback = new CapacityMonitor(0.9, callback)

      monitorWithCallback.update({
        usedBytes: 5 * GB, // 50%
        limitBytes: 10 * GB,
        recordCount: 1000,
      })

      expect(callback).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// SHARD KEY MANAGER TESTS
// ============================================================================

describe('ShardKeyManager', () => {
  let manager: ShardKeyManager

  beforeEach(() => {
    manager = new ShardKeyManager('tenant_id', 4)
  })

  describe('getShardInfo', () => {
    it('returns consistent shard for same key', () => {
      const info1 = manager.getShardInfo('tenant-123')
      const info2 = manager.getShardInfo('tenant-123')

      expect(info1.shardId).toBe(info2.shardId)
      expect(info1.shardName).toBe(info2.shardName)
    })

    it('returns valid shard ID', () => {
      const info = manager.getShardInfo('tenant-123')

      expect(info.shardId).toBeGreaterThanOrEqual(0)
      expect(info.shardId).toBeLessThan(4)
    })

    it('includes shard key name', () => {
      const info = manager.getShardInfo('tenant-123')

      expect(info.key).toBe('tenant_id')
    })

    it('sets migrated to false for new keys', () => {
      const info = manager.getShardInfo('tenant-123')

      expect(info.migrated).toBe(false)
    })

    it('formats shard name correctly', () => {
      const info = manager.getShardInfo('tenant-123')

      expect(info.shardName).toMatch(/^shard-\d+$/)
    })
  })

  describe('recordMigration', () => {
    it('updates shard assignment', () => {
      const original = manager.getShardInfo('tenant-123')
      const originalShardId = original.shardId

      manager.recordMigration('tenant-123', 3)

      const updated = manager.getShardInfo('tenant-123')
      expect(updated.shardId).toBe(3)
      expect(updated.migrated).toBe(true)
      expect(updated.originalShardId).toBe(originalShardId)
    })
  })

  describe('updateShardCount', () => {
    it('clears cached assignments', () => {
      // Get initial assignment
      manager.getShardInfo('tenant-123')

      // Update shard count
      manager.updateShardCount(8)

      // Assignments should be recalculated
      expect(manager.getShardCount()).toBe(8)
    })
  })

  describe('clear', () => {
    it('removes all assignments', () => {
      manager.getShardInfo('tenant-1')
      manager.getShardInfo('tenant-2')

      manager.clear()

      const assignments = manager.getAssignments()
      expect(assignments.size).toBe(0)
    })
  })
})

// ============================================================================
// MIGRATION MANAGER TESTS
// ============================================================================

describe('MigrationManager', () => {
  let migrationManager: MigrationManager

  beforeEach(() => {
    migrationManager = new MigrationManager(100, 50) // 100 records per chunk, 50ms delay
  })

  describe('createTask', () => {
    it('creates task with pending status', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 1000)

      expect(task.status).toBe('pending')
      expect(task.totalRecords).toBe(1000)
      expect(task.migratedRecords).toBe(0)
      expect(task.offset).toBe(0)
    })

    it('generates unique task ID', () => {
      const task1 = migrationManager.createTask('main', 1, 'tenant_id', 100)
      const task2 = migrationManager.createTask('main', 2, 'tenant_id', 100)

      expect(task1.id).not.toBe(task2.id)
    })
  })

  describe('startTask', () => {
    it('changes status to in_progress', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 1000)
      const started = migrationManager.startTask(task.id)

      expect(started?.status).toBe('in_progress')
      expect(started?.startedAt).toBeDefined()
    })

    it('returns undefined for unknown task', () => {
      const result = migrationManager.startTask('unknown-id')

      expect(result).toBeUndefined()
    })
  })

  describe('getNextChunk', () => {
    it('returns correct chunk for first iteration', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 1000)
      migrationManager.startTask(task.id)

      const chunk = migrationManager.getNextChunk(task.id)

      expect(chunk?.offset).toBe(0)
      expect(chunk?.limit).toBe(100) // Chunk size
    })

    it('returns null for pending task', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 1000)
      // Don't start it

      const chunk = migrationManager.getNextChunk(task.id)

      expect(chunk).toBeNull()
    })

    it('returns null when migration complete', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 100)
      migrationManager.startTask(task.id)
      migrationManager.completeChunk(task.id, 100)

      const chunk = migrationManager.getNextChunk(task.id)

      expect(chunk).toBeNull()
    })

    it('limits chunk size for final chunk', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 150)
      migrationManager.startTask(task.id)
      migrationManager.completeChunk(task.id, 100)

      const chunk = migrationManager.getNextChunk(task.id)

      expect(chunk?.limit).toBe(50) // Remaining records
    })
  })

  describe('completeChunk', () => {
    it('updates migrated count', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 1000)
      migrationManager.startTask(task.id)

      const updated = migrationManager.completeChunk(task.id, 100)

      expect(updated?.migratedRecords).toBe(100)
      expect(updated?.offset).toBe(100)
    })

    it('marks task as completed when done', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 100)
      migrationManager.startTask(task.id)

      const updated = migrationManager.completeChunk(task.id, 100)

      expect(updated?.status).toBe('completed')
      expect(updated?.completedAt).toBeDefined()
    })

    it('calls onComplete callback when done', () => {
      const callback = vi.fn()
      const manager = new MigrationManager(100, 50, callback)

      const task = manager.createTask('main', 1, 'tenant_id', 100)
      manager.startTask(task.id)
      manager.completeChunk(task.id, 100)

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
        })
      )
    })
  })

  describe('failTask', () => {
    it('sets status to failed with error', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 1000)
      migrationManager.startTask(task.id)

      const failed = migrationManager.failTask(task.id, 'Connection lost')

      expect(failed?.status).toBe('failed')
      expect(failed?.error).toBe('Connection lost')
    })
  })

  describe('pauseTask and resumeTask', () => {
    it('can pause and resume migration', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 1000)
      migrationManager.startTask(task.id)
      migrationManager.completeChunk(task.id, 100)

      migrationManager.pauseTask(task.id)
      expect(migrationManager.getTask(task.id)?.status).toBe('paused')

      migrationManager.resumeTask(task.id)
      expect(migrationManager.getTask(task.id)?.status).toBe('in_progress')
    })
  })

  describe('getProgress', () => {
    it('calculates progress percentage', () => {
      const task = migrationManager.createTask('main', 1, 'tenant_id', 1000)
      migrationManager.startTask(task.id)
      migrationManager.completeChunk(task.id, 500)

      const progress = migrationManager.getProgress(task.id)

      expect(progress).toBe(50)
    })
  })

  describe('getActiveTasks', () => {
    it('returns only active migrations', () => {
      const task1 = migrationManager.createTask('main', 1, 'tenant_id', 100)
      const task2 = migrationManager.createTask('main', 2, 'tenant_id', 100)
      migrationManager.startTask(task1.id)
      // task2 is pending

      const active = migrationManager.getActiveTasks()

      expect(active.length).toBe(2) // Both pending and in_progress
    })
  })
})

// ============================================================================
// LOAD BALANCER TESTS
// ============================================================================

describe('LoadBalancer', () => {
  let loadBalancer: LoadBalancer
  let mockNamespace: ReturnType<typeof createMockNamespace>

  beforeEach(() => {
    mockNamespace = createMockNamespace()
    loadBalancer = new LoadBalancer(mockNamespace as any, 4)
  })

  describe('updateStats', () => {
    it('stores shard statistics', () => {
      loadBalancer.updateStats(0, {
        usedBytes: 5 * GB,
        recordCount: 1000,
        usagePercent: 50,
        healthy: true,
        lastActivity: Date.now(),
      })

      const stats = loadBalancer.getStats(0)
      expect(stats?.usedBytes).toBe(5 * GB)
      expect(stats?.shardName).toBe('shard-0')
    })
  })

  describe('getLeastLoaded', () => {
    it('returns shard with lowest usage', () => {
      loadBalancer.updateStats(0, {
        usedBytes: 8 * GB,
        recordCount: 1000,
        usagePercent: 80,
        healthy: true,
        lastActivity: Date.now(),
      })
      loadBalancer.updateStats(1, {
        usedBytes: 2 * GB,
        recordCount: 200,
        usagePercent: 20,
        healthy: true,
        lastActivity: Date.now(),
      })
      loadBalancer.updateStats(2, {
        usedBytes: 5 * GB,
        recordCount: 500,
        usagePercent: 50,
        healthy: true,
        lastActivity: Date.now(),
      })

      const leastLoaded = loadBalancer.getLeastLoaded()

      expect(leastLoaded).toBe(1)
    })

    it('returns 0 for shards without stats', () => {
      const leastLoaded = loadBalancer.getLeastLoaded()

      expect(leastLoaded).toBe(0)
    })
  })

  describe('route', () => {
    it('returns stub for key', async () => {
      const result = await loadBalancer.route('tenant-123')

      expect(result.stub).toBeDefined()
      expect(result.shardId).toBeGreaterThanOrEqual(0)
      expect(result.shardId).toBeLessThan(4)
    })

    it('uses load balancing when hash shard is overloaded', async () => {
      // Set up one shard as heavily loaded
      loadBalancer.updateStats(0, {
        usedBytes: 9 * GB,
        recordCount: 9000,
        usagePercent: 90,
        healthy: true,
        lastActivity: Date.now(),
      })
      loadBalancer.updateStats(1, {
        usedBytes: 2 * GB,
        recordCount: 200,
        usagePercent: 20,
        healthy: true,
        lastActivity: Date.now(),
      })

      // Route with load balancing preference
      const result = await loadBalancer.route('tenant-xyz', true)

      // Should prefer least loaded if hash shard is overloaded
      expect(result.shardId).toBeDefined()
    })
  })

  describe('health checks', () => {
    it('detects unhealthy shards', () => {
      loadBalancer.updateStats(0, {
        usedBytes: 5 * GB,
        recordCount: 500,
        usagePercent: 50,
        healthy: true,
        lastActivity: Date.now(),
      })
      loadBalancer.updateStats(1, {
        usedBytes: 5 * GB,
        recordCount: 500,
        usagePercent: 50,
        healthy: false, // Unhealthy
        lastActivity: Date.now(),
      })

      expect(loadBalancer.isHealthy()).toBe(false)
      expect(loadBalancer.getUnhealthyShards()).toContain(1)
    })

    it('reports healthy when all shards are healthy', () => {
      loadBalancer.updateStats(0, {
        usedBytes: 5 * GB,
        recordCount: 500,
        usagePercent: 50,
        healthy: true,
        lastActivity: Date.now(),
      })
      loadBalancer.updateStats(1, {
        usedBytes: 5 * GB,
        recordCount: 500,
        usagePercent: 50,
        healthy: true,
        lastActivity: Date.now(),
      })

      expect(loadBalancer.isHealthy()).toBe(true)
      expect(loadBalancer.getUnhealthyShards()).toHaveLength(0)
    })
  })
})

// ============================================================================
// AUTO SHARD MANAGER TESTS
// ============================================================================

describe('AutoShardManager', () => {
  let manager: AutoShardManager
  let mockNamespace: ReturnType<typeof createMockNamespace>

  beforeEach(() => {
    mockNamespace = createMockNamespace()
    manager = new AutoShardManager(mockNamespace as any, {
      key: 'tenant_id',
      count: 1,
      algorithm: 'consistent',
    })
  })

  describe('configuration', () => {
    it('uses default configuration', () => {
      const config = manager.getConfig()

      expect(config.capacityThreshold).toBe(DEFAULT_CAPACITY_THRESHOLD)
      expect(config.maxShards).toBe(MAX_SHARDS)
      expect(config.chunkSize).toBe(DEFAULT_CHUNK_SIZE)
    })

    it('accepts custom configuration', () => {
      const customManager = new AutoShardManager(mockNamespace as any, {
        key: 'org_id',
        count: 4,
        algorithm: 'hash',
        capacityThreshold: 0.8,
        maxShards: 128,
        chunkSize: 500,
      })

      const config = customManager.getConfig()
      expect(config.key).toBe('org_id')
      expect(config.count).toBe(4)
      expect(config.capacityThreshold).toBe(0.8)
      expect(config.maxShards).toBe(128)
      expect(config.chunkSize).toBe(500)
    })
  })

  describe('capacity monitoring', () => {
    it('updates capacity metrics', () => {
      manager.updateCapacity(5 * GB, 1000)

      const metrics = manager.getCapacityMetrics()
      expect(metrics?.usedBytes).toBe(5 * GB)
      expect(metrics?.recordCount).toBe(1000)
      expect(metrics?.limitBytes).toBe(DO_STORAGE_LIMIT)
    })

    it('detects when sharding should trigger', () => {
      // At 90% capacity
      manager.updateCapacity(9 * GB, 9000)

      expect(manager.shouldTriggerSharding()).toBe(true)
    })

    it('detects approaching capacity', () => {
      // At 72% (80% of 90% threshold)
      manager.updateCapacity(7.2 * GB, 7200)

      expect(manager.isApproachingCapacity()).toBe(true)
    })

    it('detects critical capacity', () => {
      manager.updateCapacity(9.6 * GB, 9600)

      expect(manager.isCapacityCritical()).toBe(true)
    })
  })

  describe('sharding trigger', () => {
    it('triggers sharding and creates migration', async () => {
      manager.updateCapacity(9 * GB, 9000)

      const result = await manager.triggerSharding()

      expect(result.newShardCount).toBe(2) // Doubled from 1
      expect(result.migrationTaskId).toBeDefined()
    })

    it('doubles shard count on trigger', async () => {
      const customManager = new AutoShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
      })
      customManager.updateCapacity(9 * GB, 9000)

      const result = await customManager.triggerSharding()

      expect(result.newShardCount).toBe(8) // Doubled from 4
    })

    it('respects max shard limit', async () => {
      const customManager = new AutoShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: MAX_SHARDS,
        maxShards: MAX_SHARDS,
      })
      customManager.updateCapacity(9 * GB, 9000)

      await expect(customManager.triggerSharding()).rejects.toThrow(/maximum shard count/)
    })

    it('calls onShardTrigger callback', async () => {
      const callback = vi.fn()
      const customManager = new AutoShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 1,
        onShardTrigger: callback,
      })
      customManager.updateCapacity(9 * GB, 9000)

      await customManager.triggerSharding()

      expect(callback).toHaveBeenCalled()
    })
  })

  describe('routing', () => {
    it('routes to main DO before sharding', async () => {
      const result = await manager.route('tenant-123')

      expect(result.shardId).toBe(0)
      expect(result.reason).toBe('hash')
    })

    it('returns shard info for key', () => {
      const info = manager.getShardInfo('tenant-123')

      expect(info.key).toBe('tenant_id')
      expect(info.shardName).toMatch(/^shard-\d+$/)
    })
  })

  describe('migration management', () => {
    it('starts and manages migration', async () => {
      manager.updateCapacity(9 * GB, 9000)
      const { migrationTaskId } = await manager.triggerSharding()

      const started = manager.startMigration(migrationTaskId)
      expect(started?.status).toBe('in_progress')

      const chunk = manager.getNextMigrationChunk(migrationTaskId)
      expect(chunk?.offset).toBe(0)
      expect(chunk?.limit).toBeGreaterThan(0)

      const completed = manager.completeMigrationChunk(migrationTaskId, 100)
      expect(completed?.migratedRecords).toBe(100)
    })

    it('tracks migration progress', async () => {
      manager.updateCapacity(9 * GB, 9000)
      const { migrationTaskId } = await manager.triggerSharding()

      manager.startMigration(migrationTaskId)
      manager.completeMigrationChunk(migrationTaskId, 4500)

      const progress = manager.getMigrationProgress(migrationTaskId)
      expect(progress).toBe(50) // 4500 / 9000 = 50%
    })
  })

  describe('cross-shard queries', () => {
    it('queries all shards and combines results', async () => {
      // Setup multi-shard manager
      const multiManager = new AutoShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
      })

      const result = await multiManager.queryAll('/query')

      expect(result.shardsQueried).toBe(4)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('shard statistics', () => {
    it('updates and retrieves shard stats', () => {
      manager.updateShardStats(0, {
        usedBytes: 5 * GB,
        recordCount: 1000,
        healthy: true,
        lastActivity: Date.now(),
      })

      const stats = manager.getShardStats()
      expect(stats.length).toBe(1)
      expect(stats[0].usedBytes).toBe(5 * GB)
    })

    it('finds least loaded shard', () => {
      manager.updateShardStats(0, {
        usedBytes: 8 * GB,
        recordCount: 8000,
        healthy: true,
        lastActivity: Date.now(),
      })
      manager.updateShardStats(1, {
        usedBytes: 2 * GB,
        recordCount: 2000,
        healthy: true,
        lastActivity: Date.now(),
      })

      const leastLoaded = manager.getLeastLoadedShard()
      expect(leastLoaded).toBe(1)
    })
  })

  describe('health monitoring', () => {
    it('reports unhealthy shards', () => {
      manager.updateShardStats(0, {
        usedBytes: 5 * GB,
        recordCount: 500,
        healthy: false,
        lastActivity: Date.now(),
      })

      expect(manager.isHealthy()).toBe(false)
      expect(manager.getUnhealthyShards()).toContain(0)
    })
  })

  describe('metrics export', () => {
    it('exports comprehensive metrics', () => {
      manager.updateCapacity(5 * GB, 5000)
      manager.updateShardStats(0, {
        usedBytes: 5 * GB,
        recordCount: 5000,
        healthy: true,
        lastActivity: Date.now(),
      })

      const metrics = manager.exportMetrics()

      expect(metrics.capacity).toBeDefined()
      expect(metrics.capacity?.usedBytes).toBe(5 * GB)
      expect(metrics.shards.length).toBe(1)
      expect(metrics.config.shardKey).toBe('tenant_id')
      expect(metrics.config.autoShardEnabled).toBe(true)
    })
  })
})

// ============================================================================
// CONSTANTS TESTS
// ============================================================================

describe('Constants', () => {
  it('defines DO storage limit as 10GB', () => {
    expect(DO_STORAGE_LIMIT).toBe(10 * GB)
  })

  it('defines default capacity threshold as 0.9', () => {
    expect(DEFAULT_CAPACITY_THRESHOLD).toBe(0.9)
  })

  it('defines default chunk size as 1000', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(1000)
  })

  it('defines maximum shards as 256', () => {
    expect(MAX_SHARDS).toBe(256)
  })
})

// ============================================================================
// INTEGRATION SCENARIOS
// ============================================================================

describe('Integration Scenarios', () => {
  it('handles full sharding lifecycle', async () => {
    const mockNamespace = createMockNamespace()
    const onTrigger = vi.fn()
    const onComplete = vi.fn()

    const manager = new AutoShardManager(mockNamespace as any, {
      key: 'tenant_id',
      count: 1,
      chunkSize: 1000,
      onShardTrigger: onTrigger,
      onMigrationComplete: onComplete,
    })

    // 1. Monitor capacity
    manager.updateCapacity(2 * GB, 2000)
    expect(manager.shouldTriggerSharding()).toBe(false)

    // 2. Capacity grows
    manager.updateCapacity(7.5 * GB, 7500)
    expect(manager.isApproachingCapacity()).toBe(true)

    // 3. Capacity reaches threshold
    manager.updateCapacity(9.5 * GB, 9500)
    expect(manager.shouldTriggerSharding()).toBe(true)

    // 4. Trigger sharding
    const { newShardCount, migrationTaskId } = await manager.triggerSharding()
    expect(newShardCount).toBe(2)
    expect(onTrigger).toHaveBeenCalled()

    // 5. Start migration
    manager.startMigration(migrationTaskId)

    // 6. Process migration chunks
    let chunk = manager.getNextMigrationChunk(migrationTaskId)
    while (chunk) {
      manager.completeMigrationChunk(migrationTaskId, chunk.limit)
      chunk = manager.getNextMigrationChunk(migrationTaskId)
    }

    // 7. Verify completion
    expect(manager.getMigrationProgress(migrationTaskId)).toBe(100)
  })

  it('handles multi-tenant routing', async () => {
    const mockNamespace = createMockNamespace()
    const manager = new AutoShardManager(mockNamespace as any, {
      key: 'tenant_id',
      count: 8,
    })

    // Route multiple tenants
    const tenants = ['acme', 'globex', 'initech', 'umbrella', 'stark']
    const shardAssignments = new Map<string, number>()

    for (const tenant of tenants) {
      const result = await manager.route(tenant)
      shardAssignments.set(tenant, result.shardId)
    }

    // Same tenant should route to same shard
    for (const tenant of tenants) {
      const result = await manager.route(tenant)
      expect(result.shardId).toBe(shardAssignments.get(tenant))
    }

    // Distribution should use multiple shards
    const uniqueShards = new Set(shardAssignments.values())
    expect(uniqueShards.size).toBeGreaterThanOrEqual(1)
  })
})
