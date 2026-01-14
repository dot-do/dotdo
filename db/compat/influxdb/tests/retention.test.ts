/**
 * @dotdo/influxdb - Retention Policy tests
 *
 * Tests for TemporalStore-based retention and shard management
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RetentionManager, ShardManager, type ShardInfo } from '../retention'
import type { StoredPoint } from '../storage'

describe('RetentionManager', () => {
  let manager: RetentionManager

  beforeEach(() => {
    manager = new RetentionManager()
  })

  describe('Policy Configuration', () => {
    it('creates retention policy with duration', () => {
      manager.createPolicy('short_term', {
        duration: '7d',
        shardGroupDuration: '1d',
      })

      const policy = manager.getPolicy('short_term')
      expect(policy).toBeDefined()
      expect(policy!.duration).toBe('7d')
    })

    it('updates existing policy', () => {
      manager.createPolicy('my_policy', { duration: '7d' })
      manager.updatePolicy('my_policy', { duration: '30d' })

      const policy = manager.getPolicy('my_policy')
      expect(policy!.duration).toBe('30d')
    })

    it('removes policy', () => {
      manager.createPolicy('temp', { duration: '1d' })
      manager.removePolicy('temp')

      const policy = manager.getPolicy('temp')
      expect(policy).toBeUndefined()
    })

    it('lists all policies', () => {
      manager.createPolicy('policy1', { duration: '7d' })
      manager.createPolicy('policy2', { duration: '30d' })

      const policies = manager.listPolicies()
      expect(policies).toHaveLength(2)
      expect(policies.map((p) => p.name)).toContain('policy1')
      expect(policies.map((p) => p.name)).toContain('policy2')
    })
  })

  describe('Data Pruning', () => {
    it('prunes data older than retention duration', async () => {
      manager.createPolicy('short_term', { duration: '1h' })

      const baseTime = Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago

      // Add old data
      for (let i = 0; i < 100; i++) {
        manager.addPoint('test-bucket', 'short_term', {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 },
          timestamp: baseTime + i * 1000,
        })
      }

      // Add recent data
      const recentTime = Date.now()
      for (let i = 0; i < 50; i++) {
        manager.addPoint('test-bucket', 'short_term', {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 60 },
          timestamp: recentTime - i * 1000,
        })
      }

      const stats = await manager.runRetention('test-bucket', 'short_term')

      expect(stats.pointsRemoved).toBe(100)
      expect(stats.pointsRetained).toBe(50)
    })

    it('handles infinite retention (no pruning)', async () => {
      manager.createPolicy('forever', { duration: 'inf' })

      const baseTime = Date.now() - 365 * 24 * 60 * 60 * 1000 // 1 year ago

      for (let i = 0; i < 100; i++) {
        manager.addPoint('test-bucket', 'forever', {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 },
          timestamp: baseTime + i * 1000,
        })
      }

      const stats = await manager.runRetention('test-bucket', 'forever')

      expect(stats.pointsRemoved).toBe(0)
      expect(stats.pointsRetained).toBe(100)
    })
  })

  describe('Time-Based Queries', () => {
    beforeEach(() => {
      manager.createPolicy('default', { duration: '30d' })

      const baseTime = Date.now() - 7 * 24 * 60 * 60 * 1000 // 7 days ago

      for (let i = 0; i < 1000; i++) {
        manager.addPoint('test-bucket', 'default', {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 + Math.sin(i / 100) * 25 },
          timestamp: baseTime + i * 60 * 1000, // 1 minute intervals
        })
      }
    })

    it('queries data within time range', () => {
      const baseTime = Date.now() - 7 * 24 * 60 * 60 * 1000
      const points = manager.queryRange(
        'test-bucket',
        'default',
        baseTime,
        baseTime + 60 * 60 * 1000 // First hour
      )

      expect(points.length).toBe(60) // 60 minutes
    })

    it('returns all data for open-ended range', () => {
      const points = manager.queryRange('test-bucket', 'default')
      expect(points.length).toBe(1000)
    })
  })
})

describe('ShardManager', () => {
  let manager: ShardManager

  beforeEach(() => {
    manager = new ShardManager()
  })

  describe('Shard Creation', () => {
    it('creates shards for time periods', () => {
      const shardGroupDuration = 24 * 60 * 60 * 1000 // 1 day
      const timestamp = Date.now()

      const shard = manager.getOrCreateShard('my-bucket', timestamp, shardGroupDuration)

      expect(shard).toBeDefined()
      expect(shard.id).toBeDefined()
      expect(shard.startTime).toBeLessThanOrEqual(timestamp)
      expect(shard.endTime).toBeGreaterThan(timestamp)
    })

    it('reuses existing shard for same time period', () => {
      const shardGroupDuration = 24 * 60 * 60 * 1000
      const timestamp = Date.now()

      const shard1 = manager.getOrCreateShard('my-bucket', timestamp, shardGroupDuration)
      const shard2 = manager.getOrCreateShard('my-bucket', timestamp + 1000, shardGroupDuration)

      expect(shard1.id).toBe(shard2.id)
    })

    it('creates new shard for different time period', () => {
      const shardGroupDuration = 24 * 60 * 60 * 1000
      const timestamp1 = Date.now()
      const timestamp2 = timestamp1 + 2 * shardGroupDuration

      const shard1 = manager.getOrCreateShard('my-bucket', timestamp1, shardGroupDuration)
      const shard2 = manager.getOrCreateShard('my-bucket', timestamp2, shardGroupDuration)

      expect(shard1.id).not.toBe(shard2.id)
    })
  })

  describe('Shard Management', () => {
    it('lists all shards for a bucket', () => {
      const shardGroupDuration = 24 * 60 * 60 * 1000
      const baseTime = Date.now()

      manager.getOrCreateShard('my-bucket', baseTime, shardGroupDuration)
      manager.getOrCreateShard('my-bucket', baseTime - 2 * shardGroupDuration, shardGroupDuration)
      manager.getOrCreateShard('my-bucket', baseTime - 4 * shardGroupDuration, shardGroupDuration)

      const shards = manager.listShards('my-bucket')

      expect(shards).toHaveLength(3)
    })

    it('drops old shards', () => {
      const shardGroupDuration = 24 * 60 * 60 * 1000
      const baseTime = Date.now()

      // Create shards spanning several days
      for (let i = 0; i < 10; i++) {
        manager.getOrCreateShard(
          'my-bucket',
          baseTime - i * shardGroupDuration,
          shardGroupDuration
        )
      }

      // Drop shards older than 5 days
      // Shards at i=6,7,8,9 have endTime <= baseTime - 5d
      const cutoff = baseTime - 5 * shardGroupDuration
      const dropped = manager.dropShardsBefore('my-bucket', cutoff)

      expect(dropped).toBe(4) // i=6,7,8,9 (shards with endTime <= cutoff)
      expect(manager.listShards('my-bucket')).toHaveLength(6) // i=0,1,2,3,4,5 remain
    })
  })

  describe('Data Distribution', () => {
    it('writes data to correct shard', () => {
      const shardGroupDuration = 60 * 60 * 1000 // 1 hour
      const baseTime = Date.now()

      const point: StoredPoint = {
        measurement: 'cpu',
        tags: { host: 'server01' },
        fields: { value: 50 },
        timestamp: baseTime,
      }

      const shard = manager.getOrCreateShard('my-bucket', point.timestamp, shardGroupDuration)
      manager.writeToShard(shard.id, point)

      const points = manager.readFromShard(shard.id)
      expect(points).toHaveLength(1)
      expect(points[0].timestamp).toBe(baseTime)
    })

    it('reads data from multiple shards', () => {
      const shardGroupDuration = 60 * 60 * 1000 // 1 hour
      const baseTime = Date.now()

      // Write to multiple shards
      for (let hour = 0; hour < 5; hour++) {
        const timestamp = baseTime - hour * shardGroupDuration - 30 * 60 * 1000 // middle of each hour
        const shard = manager.getOrCreateShard('my-bucket', timestamp, shardGroupDuration)
        manager.writeToShard(shard.id, {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 + hour },
          timestamp,
        })
      }

      const startTime = baseTime - 5 * shardGroupDuration
      const endTime = baseTime
      const points = manager.readFromShards('my-bucket', startTime, endTime)

      expect(points).toHaveLength(5)
    })
  })

  describe('Shard Stats', () => {
    it('tracks shard statistics', () => {
      const shardGroupDuration = 60 * 60 * 1000
      const timestamp = Date.now()

      const shard = manager.getOrCreateShard('my-bucket', timestamp, shardGroupDuration)

      // Write many points
      for (let i = 0; i < 1000; i++) {
        manager.writeToShard(shard.id, {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: Math.random() * 100 },
          timestamp: timestamp + i * 1000,
        })
      }

      const stats = manager.getShardStats(shard.id)

      expect(stats).toBeDefined()
      expect(stats!.pointCount).toBe(1000)
      expect(stats!.seriesCount).toBe(1)
    })

    it('computes total bucket stats', () => {
      const shardGroupDuration = 60 * 60 * 1000
      const baseTime = Date.now()

      // Create multiple shards with data
      for (let hour = 0; hour < 3; hour++) {
        const timestamp = baseTime - hour * shardGroupDuration
        const shard = manager.getOrCreateShard('my-bucket', timestamp, shardGroupDuration)

        for (let i = 0; i < 100; i++) {
          manager.writeToShard(shard.id, {
            measurement: 'cpu',
            tags: { host: `server${hour}` },
            fields: { value: 50 },
            timestamp: timestamp + i * 1000,
          })
        }
      }

      const stats = manager.getBucketStats('my-bucket')

      expect(stats.totalPoints).toBe(300)
      expect(stats.totalShards).toBe(3)
      expect(stats.totalSeries).toBe(3)
    })
  })
})
