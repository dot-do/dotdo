/**
 * ShardMetrics Tests
 *
 * Tests for hot shard detection and metrics collection:
 * - ShardMetricsCollector: Per-shard metric tracking
 * - HotSpotDetector: Hot shard identification and alerting
 * - Distribution scoring: Uniformity analysis
 *
 * @module tests/unified-storage/shard-metrics.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ShardMetricsCollector,
  HotSpotDetector,
  createInstrumentedForward,
  type HotSpotCallback,
  type HotSpotEvent,
  type RequestType,
} from '../../objects/unified-storage/shard-metrics'

// ============================================================================
// SHARD METRICS COLLECTOR TESTS
// ============================================================================

describe('ShardMetricsCollector', () => {
  let collector: ShardMetricsCollector

  beforeEach(() => {
    collector = new ShardMetricsCollector({ shardCount: 8 })
  })

  describe('initialization', () => {
    it('should initialize with specified shard count', () => {
      expect(collector.getShardCount()).toBe(8)
    })

    it('should initialize all shards with zero metrics', () => {
      for (let i = 0; i < 8; i++) {
        const metrics = collector.getShardMetrics(i)
        expect(metrics).toBeDefined()
        expect(metrics!.requestCount).toBe(0)
        expect(metrics!.readCount).toBe(0)
        expect(metrics!.writeCount).toBe(0)
        expect(metrics!.bytesTransferred).toBe(0)
      }
    })
  })

  describe('recordOperation', () => {
    it('should record read operations', () => {
      collector.recordOperation(0, 'read', 1024, 15.5)

      const metrics = collector.getShardMetrics(0)
      expect(metrics!.requestCount).toBe(1)
      expect(metrics!.readCount).toBe(1)
      expect(metrics!.writeCount).toBe(0)
      expect(metrics!.bytesTransferred).toBe(1024)
    })

    it('should record write operations', () => {
      collector.recordOperation(0, 'write', 2048, 25.0)

      const metrics = collector.getShardMetrics(0)
      expect(metrics!.requestCount).toBe(1)
      expect(metrics!.readCount).toBe(0)
      expect(metrics!.writeCount).toBe(1)
      expect(metrics!.bytesTransferred).toBe(2048)
    })

    it('should record other operations', () => {
      collector.recordOperation(0, 'other', 512, 10.0)

      const metrics = collector.getShardMetrics(0)
      expect(metrics!.requestCount).toBe(1)
      expect(metrics!.readCount).toBe(0)
      expect(metrics!.writeCount).toBe(0)
      expect(metrics!.bytesTransferred).toBe(512)
    })

    it('should accumulate multiple operations', () => {
      collector.recordOperation(0, 'read', 1024, 15.5)
      collector.recordOperation(0, 'write', 2048, 25.0)
      collector.recordOperation(0, 'read', 512, 10.0)

      const metrics = collector.getShardMetrics(0)
      expect(metrics!.requestCount).toBe(3)
      expect(metrics!.readCount).toBe(2)
      expect(metrics!.writeCount).toBe(1)
      expect(metrics!.bytesTransferred).toBe(1024 + 2048 + 512)
    })

    it('should track latency', () => {
      collector.recordOperation(0, 'read', 1024, 15.5)
      collector.recordOperation(0, 'read', 1024, 25.0)
      collector.recordOperation(0, 'read', 1024, 10.0)

      const metrics = collector.getShardMetrics(0)
      expect(metrics!.latencyMs.length).toBe(3)
      expect(metrics!.latencyMs).toContain(15.5)
      expect(metrics!.latencyMs).toContain(25.0)
      expect(metrics!.latencyMs).toContain(10.0)
    })

    it('should update lastActivityAt', () => {
      const before = Date.now()
      collector.recordOperation(0, 'read', 1024, 15.5)
      const after = Date.now()

      const metrics = collector.getShardMetrics(0)
      expect(metrics!.lastActivityAt).toBeGreaterThanOrEqual(before)
      expect(metrics!.lastActivityAt).toBeLessThanOrEqual(after)
    })

    it('should auto-initialize unknown shards', () => {
      collector.recordOperation(99, 'read', 1024, 15.5)

      const metrics = collector.getShardMetrics(99)
      expect(metrics).toBeDefined()
      expect(metrics!.requestCount).toBe(1)
    })
  })

  describe('getShardSnapshot', () => {
    it('should return undefined for non-existent shard', () => {
      const snapshot = collector.getShardSnapshot(999)
      expect(snapshot).toBeUndefined()
    })

    it('should return snapshot with latency percentiles', () => {
      // Add operations with varying latencies
      const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      for (const latency of latencies) {
        collector.recordOperation(0, 'read', 1024, latency)
      }

      const snapshot = collector.getShardSnapshot(0)
      expect(snapshot).toBeDefined()
      expect(snapshot!.requestCount).toBe(10)
      expect(snapshot!.averageLatencyMs).toBe(55) // Average of 10-100
      expect(snapshot!.p50LatencyMs).toBe(50) // Median
      expect(snapshot!.p95LatencyMs).toBeGreaterThanOrEqual(90)
      expect(snapshot!.p99LatencyMs).toBeGreaterThanOrEqual(90)
    })

    it('should handle empty latency array', () => {
      const snapshot = collector.getShardSnapshot(0)
      expect(snapshot).toBeDefined()
      expect(snapshot!.averageLatencyMs).toBe(0)
      expect(snapshot!.p50LatencyMs).toBe(0)
      expect(snapshot!.p95LatencyMs).toBe(0)
      expect(snapshot!.p99LatencyMs).toBe(0)
    })
  })

  describe('snapshot', () => {
    it('should return snapshots for all shards', () => {
      // Record operations on some shards
      collector.recordOperation(0, 'read', 1024, 15.5)
      collector.recordOperation(3, 'write', 2048, 25.0)
      collector.recordOperation(7, 'read', 512, 10.0)

      const snapshots = collector.snapshot()
      expect(snapshots.length).toBe(8)
      expect(snapshots[0].requestCount).toBe(1)
      expect(snapshots[3].requestCount).toBe(1)
      expect(snapshots[7].requestCount).toBe(1)
    })
  })

  describe('getTotalRequestCount', () => {
    it('should return total across all shards', () => {
      collector.recordOperation(0, 'read', 1024, 15.5)
      collector.recordOperation(1, 'write', 2048, 25.0)
      collector.recordOperation(2, 'read', 512, 10.0)
      collector.recordOperation(0, 'read', 1024, 15.5)

      expect(collector.getTotalRequestCount()).toBe(4)
    })
  })

  describe('getAverageRequestCount', () => {
    it('should return average across all shards', () => {
      collector.recordOperation(0, 'read', 1024, 15.5)
      collector.recordOperation(1, 'write', 2048, 25.0)
      collector.recordOperation(2, 'read', 512, 10.0)
      collector.recordOperation(3, 'read', 1024, 15.5)

      // 4 requests across 8 shards = 0.5 average
      expect(collector.getAverageRequestCount()).toBe(0.5)
    })
  })

  describe('getWindowMetrics', () => {
    it('should return metrics within time window', async () => {
      // Create collector with short window for testing
      const shortWindowCollector = new ShardMetricsCollector({
        shardCount: 4,
        windowMs: 100, // 100ms window
      })

      shortWindowCollector.recordOperation(0, 'read', 1024, 15.5)
      shortWindowCollector.recordOperation(1, 'write', 2048, 25.0)

      const windowMetrics = shortWindowCollector.getWindowMetrics()
      expect(windowMetrics.get(0)!.requestCount).toBe(1)
      expect(windowMetrics.get(1)!.requestCount).toBe(1)
      expect(windowMetrics.get(2)!.requestCount).toBe(0)
    })
  })

  describe('reset', () => {
    it('should reset all metrics to zero', () => {
      collector.recordOperation(0, 'read', 1024, 15.5)
      collector.recordOperation(1, 'write', 2048, 25.0)

      collector.reset()

      const metrics0 = collector.getShardMetrics(0)
      const metrics1 = collector.getShardMetrics(1)

      expect(metrics0!.requestCount).toBe(0)
      expect(metrics1!.requestCount).toBe(0)
      expect(collector.getTotalRequestCount()).toBe(0)
    })
  })

  describe('reservoir sampling for latency', () => {
    it('should use reservoir sampling when exceeding max samples', () => {
      const smallSampleCollector = new ShardMetricsCollector({
        shardCount: 4,
        maxLatencySamples: 10,
      })

      // Add more operations than max samples
      for (let i = 0; i < 100; i++) {
        smallSampleCollector.recordOperation(0, 'read', 1024, i)
      }

      const metrics = smallSampleCollector.getShardMetrics(0)
      expect(metrics!.latencyMs.length).toBe(10) // Capped at max samples
      expect(metrics!.requestCount).toBe(100) // All operations counted
    })
  })
})

// ============================================================================
// HOT SPOT DETECTOR TESTS
// ============================================================================

describe('HotSpotDetector', () => {
  let collector: ShardMetricsCollector
  let detector: HotSpotDetector

  beforeEach(() => {
    collector = new ShardMetricsCollector({ shardCount: 8 })
    detector = new HotSpotDetector(collector, {
      hotThresholdMultiplier: 2.0,
      minRequestsForHotDetection: 10,
    })
  })

  describe('getHotShards', () => {
    it('should return empty array when not enough data', () => {
      // Only add a few requests (below threshold)
      collector.recordOperation(0, 'read', 1024, 15.5)

      const hotShards = detector.getHotShards()
      expect(hotShards).toEqual([])
    })

    it('should detect hot shard based on request count', () => {
      // Add many requests to shard 0, few to others
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        for (let j = 0; j < 5; j++) {
          collector.recordOperation(i, 'read', 1024, 15.5)
        }
      }

      const hotShards = detector.getHotShards()
      expect(hotShards.length).toBeGreaterThan(0)
      expect(hotShards.some((h) => h.shardIndex === 0)).toBe(true)
      expect(hotShards[0].reason).toBe('request_count')
    })

    it('should detect hot shard based on write count', () => {
      // Add many writes to shard 0, few to others
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'write', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        for (let j = 0; j < 5; j++) {
          collector.recordOperation(i, 'write', 1024, 15.5)
        }
      }

      const hotShards = detector.getHotShards()
      expect(hotShards.length).toBeGreaterThan(0)
      const shard0Hot = hotShards.find((h) => h.shardIndex === 0)
      expect(shard0Hot).toBeDefined()
    })

    it('should detect hot shard based on byte size', () => {
      // Add large transfers to shard 0, small to others
      for (let i = 0; i < 50; i++) {
        collector.recordOperation(0, 'read', 100000, 15.5) // 100KB each
      }
      for (let i = 1; i < 8; i++) {
        for (let j = 0; j < 10; j++) {
          collector.recordOperation(i, 'read', 1000, 15.5) // 1KB each
        }
      }

      const hotShards = detector.getHotShards()
      expect(hotShards.length).toBeGreaterThan(0)
      const shard0Hot = hotShards.find((h) => h.shardIndex === 0)
      expect(shard0Hot).toBeDefined()
    })

    it('should include load ratio in hot shard info', () => {
      // Create significant imbalance
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        collector.recordOperation(i, 'read', 1024, 15.5)
      }

      const hotShards = detector.getHotShards()
      const shard0 = hotShards.find((h) => h.shardIndex === 0)
      expect(shard0).toBeDefined()
      expect(shard0!.loadRatio).toBeGreaterThan(2.0)
    })

    it('should respect configurable threshold', () => {
      // Use higher threshold
      const strictDetector = new HotSpotDetector(collector, {
        hotThresholdMultiplier: 5.0,
        minRequestsForHotDetection: 10,
      })

      // Add moderate imbalance (3x average)
      for (let i = 0; i < 30; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        for (let j = 0; j < 10; j++) {
          collector.recordOperation(i, 'read', 1024, 15.5)
        }
      }

      // With 5x threshold, this shouldn't be detected as hot
      const hotShards = strictDetector.getHotShards()
      expect(hotShards.length).toBe(0)
    })
  })

  describe('isShardHot', () => {
    it('should return true for hot shard', () => {
      // Create hot shard
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        collector.recordOperation(i, 'read', 1024, 15.5)
      }

      expect(detector.isShardHot(0)).toBe(true)
    })

    it('should return false for normal shard', () => {
      // Even distribution
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 10; j++) {
          collector.recordOperation(i, 'read', 1024, 15.5)
        }
      }

      expect(detector.isShardHot(0)).toBe(false)
    })
  })

  describe('getShardLoadRatio', () => {
    it('should return 1.0 for average load', () => {
      // Even distribution
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 10; j++) {
          collector.recordOperation(i, 'read', 1024, 15.5)
        }
      }

      const ratio = detector.getShardLoadRatio(0)
      expect(ratio).toBe(1.0)
    })

    it('should return ratio compared to average', () => {
      // Shard 0 has 20 requests, others have 10 each
      for (let i = 0; i < 20; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        for (let j = 0; j < 10; j++) {
          collector.recordOperation(i, 'read', 1024, 15.5)
        }
      }

      // Average = (20 + 70) / 8 = 11.25
      // Shard 0 ratio = 20 / 11.25 = ~1.78
      const ratio = detector.getShardLoadRatio(0)
      expect(ratio).toBeGreaterThan(1.5)
      expect(ratio).toBeLessThan(2.0)
    })

    it('should return 1.0 when no requests', () => {
      const ratio = detector.getShardLoadRatio(0)
      expect(ratio).toBe(1.0)
    })
  })

  describe('getDistributionScore', () => {
    it('should return 1.0 for no data', () => {
      const score = detector.getDistributionScore()
      expect(score.score).toBe(1.0)
      expect(score.coefficientOfVariation).toBe(0)
    })

    it('should return high score for uniform distribution', () => {
      // Perfectly even distribution
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 100; j++) {
          collector.recordOperation(i, 'read', 1024, 15.5)
        }
      }

      const score = detector.getDistributionScore()
      expect(score.score).toBeGreaterThan(0.9)
      expect(score.coefficientOfVariation).toBeLessThan(0.1)
      expect(score.meanRequestCount).toBe(100)
      expect(score.minRequestCount).toBe(100)
      expect(score.maxRequestCount).toBe(100)
    })

    it('should return low score for imbalanced distribution', () => {
      // Heavily imbalanced
      for (let i = 0; i < 1000; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        collector.recordOperation(i, 'read', 1024, 15.5)
      }

      const score = detector.getDistributionScore()
      expect(score.score).toBeLessThan(0.5)
      expect(score.coefficientOfVariation).toBeGreaterThan(1.0)
      expect(score.hottestShard).toBe(0)
    })

    it('should identify hottest and coldest shards', () => {
      collector.recordOperation(3, 'read', 1024, 15.5)
      collector.recordOperation(3, 'read', 1024, 15.5)
      collector.recordOperation(3, 'read', 1024, 15.5)
      collector.recordOperation(5, 'read', 1024, 15.5)
      // Shards 0, 1, 2, 4, 6, 7 have 0 requests

      const score = detector.getDistributionScore()
      expect(score.hottestShard).toBe(3)
      expect(score.coldestShard).not.toBe(3)
      expect(score.coldestShard).not.toBe(5)
    })

    it('should calculate correct statistics', () => {
      // Known distribution: [10, 20, 30, 40, 50, 60, 70, 80]
      const counts = [10, 20, 30, 40, 50, 60, 70, 80]
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < counts[i]; j++) {
          collector.recordOperation(i, 'read', 1024, 15.5)
        }
      }

      const score = detector.getDistributionScore()
      expect(score.meanRequestCount).toBe(45) // Sum 360 / 8
      expect(score.minRequestCount).toBe(10)
      expect(score.maxRequestCount).toBe(80)
      expect(score.hottestShard).toBe(7)
      expect(score.coldestShard).toBe(0)
    })
  })

  describe('getHotSpotCount', () => {
    it('should return count of hot shards', () => {
      // Create multiple hot shards
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
        collector.recordOperation(1, 'read', 1024, 15.5)
      }
      for (let i = 2; i < 8; i++) {
        collector.recordOperation(i, 'read', 1024, 15.5)
      }

      expect(detector.getHotSpotCount()).toBeGreaterThanOrEqual(1)
    })
  })

  describe('needsRebalancing', () => {
    it('should return true when hot shards exist', () => {
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        collector.recordOperation(i, 'read', 1024, 15.5)
      }

      expect(detector.needsRebalancing()).toBe(true)
    })

    it('should return true when distribution score is low', () => {
      // Heavy imbalance without quite reaching 2x threshold
      for (let i = 0; i < 1000; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      // No other shards have any requests - definitely needs rebalancing

      expect(detector.needsRebalancing()).toBe(true)
    })

    it('should return false for uniform distribution', () => {
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 100; j++) {
          collector.recordOperation(i, 'read', 1024, 15.5)
        }
      }

      expect(detector.needsRebalancing()).toBe(false)
    })
  })

  describe('callbacks', () => {
    it('should call callback when hot spot detected', () => {
      const detectorWithAlerts = new HotSpotDetector(collector, {
        hotThresholdMultiplier: 2.0,
        minRequestsForHotDetection: 10,
        enableAlerts: true,
      })

      const callback = vi.fn()
      detectorWithAlerts.onHotSpot(callback)

      // Create hot spot
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        collector.recordOperation(i, 'read', 1024, 15.5)
      }

      detectorWithAlerts.getHotShards() // Triggers detection

      expect(callback).toHaveBeenCalled()
      const event = callback.mock.calls[0][0] as HotSpotEvent
      expect(event.type).toBe('hot_spot_detected')
      expect(event.shardIndex).toBe(0)
    })

    it('should call callback when hot spot resolved', () => {
      const detectorWithAlerts = new HotSpotDetector(collector, {
        hotThresholdMultiplier: 2.0,
        minRequestsForHotDetection: 10,
        enableAlerts: true,
      })

      const callback = vi.fn()
      detectorWithAlerts.onHotSpot(callback)

      // Create hot spot
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        collector.recordOperation(i, 'read', 1024, 15.5)
      }

      detectorWithAlerts.getHotShards() // First detection

      // Balance out the distribution
      collector.reset()
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 100; j++) {
          collector.recordOperation(i, 'read', 1024, 15.5)
        }
      }

      detectorWithAlerts.getHotShards() // Second detection - should resolve

      const events = callback.mock.calls.map((c) => c[0] as HotSpotEvent)
      expect(events.some((e) => e.type === 'hot_spot_resolved')).toBe(true)
    })

    it('should remove callback with offHotSpot', () => {
      const detectorWithAlerts = new HotSpotDetector(collector, {
        hotThresholdMultiplier: 2.0,
        minRequestsForHotDetection: 10,
        enableAlerts: true,
      })

      const callback = vi.fn()
      detectorWithAlerts.onHotSpot(callback)
      detectorWithAlerts.offHotSpot(callback)

      // Create hot spot
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        collector.recordOperation(i, 'read', 1024, 15.5)
      }

      detectorWithAlerts.getHotShards()

      expect(callback).not.toHaveBeenCalled()
    })

    it('should not call callback when alerts disabled', () => {
      // Default: alerts disabled
      const callback = vi.fn()
      detector.onHotSpot(callback)

      // Create hot spot
      for (let i = 0; i < 100; i++) {
        collector.recordOperation(0, 'read', 1024, 15.5)
      }
      for (let i = 1; i < 8; i++) {
        collector.recordOperation(i, 'read', 1024, 15.5)
      }

      detector.getHotShards()

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const config = detector.getConfig()
      expect(config.hotThresholdMultiplier).toBe(2.0)
      expect(config.minRequestsForHotDetection).toBe(10)
      expect(config.enableAlerts).toBe(false)
    })
  })
})

// ============================================================================
// INSTRUMENTED FORWARD TESTS
// ============================================================================

describe('createInstrumentedForward', () => {
  it('should record successful operations', async () => {
    const collector = new ShardMetricsCollector({ shardCount: 4 })
    const mockForward = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-length': '100' },
      })
    )
    const mockGetShardIndex = vi.fn().mockReturnValue(2)

    const instrumented = createInstrumentedForward(mockForward, mockGetShardIndex, collector)

    const request = new Request('https://example.com/data', {
      method: 'GET',
      headers: { 'content-length': '50' },
    })

    await instrumented('partition-key', request)

    expect(mockGetShardIndex).toHaveBeenCalledWith('partition-key')
    expect(mockForward).toHaveBeenCalledWith('partition-key', request)

    const metrics = collector.getShardMetrics(2)
    expect(metrics!.requestCount).toBe(1)
    expect(metrics!.readCount).toBe(1)
    expect(metrics!.bytesTransferred).toBe(150) // 50 request + 100 response
  })

  it('should record write operations for POST/PUT/PATCH/DELETE', async () => {
    const collector = new ShardMetricsCollector({ shardCount: 4 })
    const mockForward = vi.fn().mockResolvedValue(new Response('ok'))
    const mockGetShardIndex = vi.fn().mockReturnValue(1)

    const instrumented = createInstrumentedForward(mockForward, mockGetShardIndex, collector)

    const methods = ['POST', 'PUT', 'PATCH', 'DELETE']
    for (const method of methods) {
      const request = new Request('https://example.com/data', { method })
      await instrumented('key', request)
    }

    const metrics = collector.getShardMetrics(1)
    expect(metrics!.writeCount).toBe(4)
    expect(metrics!.readCount).toBe(0)
  })

  it('should record failed operations', async () => {
    const collector = new ShardMetricsCollector({ shardCount: 4 })
    const mockForward = vi.fn().mockRejectedValue(new Error('Network error'))
    const mockGetShardIndex = vi.fn().mockReturnValue(3)

    const instrumented = createInstrumentedForward(mockForward, mockGetShardIndex, collector)

    const request = new Request('https://example.com/data', { method: 'GET' })

    await expect(instrumented('key', request)).rejects.toThrow('Network error')

    const metrics = collector.getShardMetrics(3)
    expect(metrics!.requestCount).toBe(1)
    expect(metrics!.bytesTransferred).toBe(0) // Failed, no bytes recorded
  })

  it('should track latency', async () => {
    const collector = new ShardMetricsCollector({ shardCount: 4 })
    const mockForward = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10)) // Simulate latency
      return new Response('ok')
    })
    const mockGetShardIndex = vi.fn().mockReturnValue(0)

    const instrumented = createInstrumentedForward(mockForward, mockGetShardIndex, collector)

    const request = new Request('https://example.com/data', { method: 'GET' })
    await instrumented('key', request)

    const metrics = collector.getShardMetrics(0)
    expect(metrics!.latencyMs.length).toBe(1)
    expect(metrics!.latencyMs[0]).toBeGreaterThan(5) // At least some latency
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration: ShardMetricsCollector + HotSpotDetector', () => {
  it('should work together for real-time monitoring', () => {
    const collector = new ShardMetricsCollector({ shardCount: 16 })
    const detector = new HotSpotDetector(collector, {
      hotThresholdMultiplier: 2.0,
      minRequestsForHotDetection: 50,
      enableAlerts: true,
    })

    const alerts: HotSpotEvent[] = []
    detector.onHotSpot((event) => alerts.push(event))

    // Simulate traffic pattern with hot spot developing
    // Normal distribution initially
    for (let round = 0; round < 10; round++) {
      for (let shard = 0; shard < 16; shard++) {
        collector.recordOperation(shard, 'read', 1024, 15 + Math.random() * 10)
      }
    }

    // Check - should be balanced
    let score = detector.getDistributionScore()
    expect(score.score).toBeGreaterThan(0.9)
    expect(detector.getHotSpotCount()).toBe(0)

    // Now create a hot spot on shard 5
    for (let i = 0; i < 500; i++) {
      collector.recordOperation(5, 'write', 2048, 25)
    }

    // Trigger detection
    const hotShards = detector.getHotShards()
    expect(hotShards.length).toBeGreaterThan(0)
    expect(hotShards.some((h) => h.shardIndex === 5)).toBe(true)

    // Check distribution score dropped
    score = detector.getDistributionScore()
    expect(score.score).toBeLessThan(0.5)
    expect(score.hottestShard).toBe(5)

    // Check alerts were triggered
    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts.some((a) => a.type === 'hot_spot_detected' && a.shardIndex === 5)).toBe(true)
  })

  it('should provide actionable rebalancing recommendations', () => {
    const collector = new ShardMetricsCollector({ shardCount: 8 })
    const detector = new HotSpotDetector(collector, {
      hotThresholdMultiplier: 2.0,
      minRequestsForHotDetection: 20,
    })

    // Create imbalanced distribution
    const distribution = [100, 50, 30, 20, 15, 10, 5, 2]
    for (let shard = 0; shard < 8; shard++) {
      for (let i = 0; i < distribution[shard]; i++) {
        collector.recordOperation(shard, 'read', 1024, 15)
      }
    }

    const score = detector.getDistributionScore()
    const hotShards = detector.getHotShards()

    // Verify analysis
    expect(score.hottestShard).toBe(0)
    expect(score.coldestShard).toBe(7)
    expect(detector.needsRebalancing()).toBe(true)

    // Check specific recommendations
    expect(hotShards.length).toBeGreaterThan(0)
    for (const hot of hotShards) {
      expect(hot.loadRatio).toBeGreaterThan(2.0)
    }
  })
})
