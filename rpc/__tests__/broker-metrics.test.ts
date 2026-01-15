/**
 * Broker Metrics Tests - TDD RED Phase
 *
 * Tests for the BrokerMetricsCollector class which tracks:
 * - Request counts (total and by target)
 * - Error counts (total and by target)
 * - Latency percentiles (p50, p95, p99)
 * - In-flight request tracking
 * - Hibernation wake statistics
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BrokerMetricsCollector, type BrokerMetrics } from '../broker-metrics'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Simulate multiple requests to populate metrics
 */
async function simulateRequests(
  collector: BrokerMetricsCollector,
  target: string,
  count: number,
  latencyFn: () => number = () => 10
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const complete = collector.recordRequestStart(target)
    // Simulate actual work by manipulating time
    vi.advanceTimersByTime(latencyFn())
    complete()
  }
}

// =============================================================================
// Request Count Tests
// =============================================================================

describe('Broker Metrics: Request Counts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should track request count total', () => {
    const collector = new BrokerMetricsCollector()

    // Initially zero
    expect(collector.getMetrics().requests.total).toBe(0)

    // Record some requests
    const complete1 = collector.recordRequestStart('worker-1')
    complete1()
    const complete2 = collector.recordRequestStart('worker-2')
    complete2()
    const complete3 = collector.recordRequestStart('worker-1')
    complete3()

    expect(collector.getMetrics().requests.total).toBe(3)
  })

  it('should track request count by target', () => {
    const collector = new BrokerMetricsCollector()

    // Record requests to different targets
    const c1 = collector.recordRequestStart('worker-a')
    c1()
    const c2 = collector.recordRequestStart('worker-a')
    c2()
    const c3 = collector.recordRequestStart('worker-b')
    c3()
    const c4 = collector.recordRequestStart('worker-c')
    c4()
    const c5 = collector.recordRequestStart('worker-b')
    c5()

    const metrics = collector.getMetrics()
    expect(metrics.requests.byTarget.get('worker-a')).toBe(2)
    expect(metrics.requests.byTarget.get('worker-b')).toBe(2)
    expect(metrics.requests.byTarget.get('worker-c')).toBe(1)
    expect(metrics.requests.byTarget.get('nonexistent')).toBeUndefined()
  })
})

// =============================================================================
// Error Count Tests
// =============================================================================

describe('Broker Metrics: Error Counts', () => {
  it('should track error count total', () => {
    const collector = new BrokerMetricsCollector()

    // Initially zero
    expect(collector.getMetrics().requests.errors).toBe(0)

    // Record some errors
    collector.recordError('worker-1')
    collector.recordError('worker-2')
    collector.recordError('worker-1')

    expect(collector.getMetrics().requests.errors).toBe(3)
  })

  it('should track error count by target', () => {
    const collector = new BrokerMetricsCollector()

    // Record errors for different targets
    collector.recordError('worker-x')
    collector.recordError('worker-x')
    collector.recordError('worker-y')

    const metrics = collector.getMetrics()
    expect(metrics.requests.errorsByTarget.get('worker-x')).toBe(2)
    expect(metrics.requests.errorsByTarget.get('worker-y')).toBe(1)
    expect(metrics.requests.errorsByTarget.get('nonexistent')).toBeUndefined()
  })
})

// =============================================================================
// Latency Percentile Tests
// =============================================================================

describe('Broker Metrics: Latency Percentiles', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should track latency percentiles (p50, p95, p99)', () => {
    const collector = new BrokerMetricsCollector()

    // Simulate 100 requests with varying latencies (1-100ms)
    for (let i = 1; i <= 100; i++) {
      const complete = collector.recordRequestStart('worker-1')
      vi.advanceTimersByTime(i) // Latency = i ms
      complete()
    }

    const metrics = collector.getMetrics()

    // With values 1-100:
    // p50 should be around 50
    expect(metrics.latency.p50).toBeGreaterThanOrEqual(48)
    expect(metrics.latency.p50).toBeLessThanOrEqual(52)

    // p95 should be around 95
    expect(metrics.latency.p95).toBeGreaterThanOrEqual(93)
    expect(metrics.latency.p95).toBeLessThanOrEqual(97)

    // p99 should be around 99
    expect(metrics.latency.p99).toBeGreaterThanOrEqual(97)
    expect(metrics.latency.p99).toBeLessThanOrEqual(100)
  })

  it('should track latency by target', () => {
    const collector = new BrokerMetricsCollector()

    // Fast target (10ms latency)
    for (let i = 0; i < 20; i++) {
      const complete = collector.recordRequestStart('fast-worker')
      vi.advanceTimersByTime(10)
      complete()
    }

    // Slow target (100ms latency)
    for (let i = 0; i < 20; i++) {
      const complete = collector.recordRequestStart('slow-worker')
      vi.advanceTimersByTime(100)
      complete()
    }

    const metrics = collector.getMetrics()

    const fastLatency = metrics.latency.byTarget.get('fast-worker')
    const slowLatency = metrics.latency.byTarget.get('slow-worker')

    expect(fastLatency).toBeDefined()
    expect(slowLatency).toBeDefined()
    expect(fastLatency!.p50).toBe(10)
    expect(slowLatency!.p50).toBe(100)
  })

  it('should handle empty latency samples gracefully', () => {
    const collector = new BrokerMetricsCollector()

    // No requests yet - percentiles should be 0
    const metrics = collector.getMetrics()
    expect(metrics.latency.p50).toBe(0)
    expect(metrics.latency.p95).toBe(0)
    expect(metrics.latency.p99).toBe(0)
  })

  it('should respect maxSamples limit', () => {
    const collector = new BrokerMetricsCollector({ maxSamples: 10 })

    // Record 20 requests
    for (let i = 1; i <= 20; i++) {
      const complete = collector.recordRequestStart('worker-1')
      vi.advanceTimersByTime(i)
      complete()
    }

    // Should only keep the last 10 samples
    expect(collector.getMetrics().latency.samples.length).toBe(10)
    // The oldest samples (1-10) should be gone, only 11-20 remain
    expect(collector.getMetrics().latency.samples).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  })
})

// =============================================================================
// In-Flight Request Tests
// =============================================================================

describe('Broker Metrics: In-Flight Requests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should track in-flight request count', () => {
    const collector = new BrokerMetricsCollector()

    // Initially zero
    expect(collector.getMetrics().inflight.current).toBe(0)

    // Start 3 requests
    const complete1 = collector.recordRequestStart('worker-1')
    const complete2 = collector.recordRequestStart('worker-2')
    const complete3 = collector.recordRequestStart('worker-3')

    expect(collector.getMetrics().inflight.current).toBe(3)

    // Complete 2 requests
    complete1()
    complete2()

    expect(collector.getMetrics().inflight.current).toBe(1)

    // Complete last request
    complete3()

    expect(collector.getMetrics().inflight.current).toBe(0)
  })

  it('should track peak in-flight count', () => {
    const collector = new BrokerMetricsCollector()

    // Initially zero
    expect(collector.getMetrics().inflight.peak).toBe(0)

    // Start 5 requests
    const completers: Array<() => void> = []
    for (let i = 0; i < 5; i++) {
      completers.push(collector.recordRequestStart(`worker-${i}`))
    }

    expect(collector.getMetrics().inflight.peak).toBe(5)

    // Complete all requests
    for (const complete of completers) {
      complete()
    }

    // Peak should remain at 5 even though current is 0
    expect(collector.getMetrics().inflight.current).toBe(0)
    expect(collector.getMetrics().inflight.peak).toBe(5)

    // Start 3 more requests
    const c1 = collector.recordRequestStart('worker-a')
    const c2 = collector.recordRequestStart('worker-b')
    const c3 = collector.recordRequestStart('worker-c')

    // Peak should still be 5 (not exceeded)
    expect(collector.getMetrics().inflight.peak).toBe(5)

    c1()
    c2()
    c3()
  })

  it('should update peak when exceeded', () => {
    const collector = new BrokerMetricsCollector()

    // Start 3 requests
    const c1 = collector.recordRequestStart('worker-1')
    const c2 = collector.recordRequestStart('worker-2')
    const c3 = collector.recordRequestStart('worker-3')

    expect(collector.getMetrics().inflight.peak).toBe(3)

    // Complete some
    c1()
    c2()

    // Start 5 more (total 4 in-flight)
    const c4 = collector.recordRequestStart('worker-4')
    const c5 = collector.recordRequestStart('worker-5')
    const c6 = collector.recordRequestStart('worker-6')
    const c7 = collector.recordRequestStart('worker-7')

    // Peak should now be 5 (1 from before + 4 new)
    expect(collector.getMetrics().inflight.peak).toBe(5)

    // Cleanup
    c3()
    c4()
    c5()
    c6()
    c7()
  })
})

// =============================================================================
// Hibernation Wake Tests
// =============================================================================

describe('Broker Metrics: Hibernation Wake', () => {
  it('should track hibernation wake count', () => {
    const collector = new BrokerMetricsCollector()

    // Initially zero
    expect(collector.getMetrics().hibernation.wakeCount).toBe(0)

    // Record wakes
    collector.recordWake(0, 0)
    collector.recordWake(0, 0)
    collector.recordWake(0, 0)

    expect(collector.getMetrics().hibernation.wakeCount).toBe(3)
  })

  it('should track recovered requests after wake', () => {
    const collector = new BrokerMetricsCollector()

    // Initially zero
    expect(collector.getMetrics().hibernation.recoveredRequests).toBe(0)

    // Record wake with recovered requests
    collector.recordWake(5, 0) // 5 recovered, 0 lost
    collector.recordWake(3, 0) // 3 recovered, 0 lost

    expect(collector.getMetrics().hibernation.recoveredRequests).toBe(8)
  })

  it('should track lost requests after wake', () => {
    const collector = new BrokerMetricsCollector()

    // Initially zero
    expect(collector.getMetrics().hibernation.lostRequests).toBe(0)

    // Record wake with some lost requests
    collector.recordWake(10, 2) // 10 recovered, 2 lost
    collector.recordWake(5, 1)  // 5 recovered, 1 lost

    expect(collector.getMetrics().hibernation.lostRequests).toBe(3)
    expect(collector.getMetrics().hibernation.recoveredRequests).toBe(15)
  })
})

// =============================================================================
// Reset and Export Tests
// =============================================================================

describe('Broker Metrics: Reset and Export', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should reset metrics on demand', () => {
    const collector = new BrokerMetricsCollector()

    // Populate some metrics
    const c1 = collector.recordRequestStart('worker-1')
    vi.advanceTimersByTime(50)
    c1()
    collector.recordError('worker-1')
    collector.recordWake(5, 1)

    // Verify metrics are populated
    expect(collector.getMetrics().requests.total).toBe(1)
    expect(collector.getMetrics().requests.errors).toBe(1)
    expect(collector.getMetrics().hibernation.wakeCount).toBe(1)

    // Reset
    collector.reset()

    // Verify all reset to initial state
    const metrics = collector.getMetrics()
    expect(metrics.requests.total).toBe(0)
    expect(metrics.requests.byTarget.size).toBe(0)
    expect(metrics.requests.errors).toBe(0)
    expect(metrics.requests.errorsByTarget.size).toBe(0)
    expect(metrics.latency.samples.length).toBe(0)
    expect(metrics.latency.p50).toBe(0)
    expect(metrics.latency.p95).toBe(0)
    expect(metrics.latency.p99).toBe(0)
    expect(metrics.latency.byTarget.size).toBe(0)
    expect(metrics.inflight.current).toBe(0)
    expect(metrics.inflight.peak).toBe(0)
    expect(metrics.hibernation.wakeCount).toBe(0)
    expect(metrics.hibernation.recoveredRequests).toBe(0)
    expect(metrics.hibernation.lostRequests).toBe(0)
  })

  it('should export metrics as JSON', () => {
    const collector = new BrokerMetricsCollector()

    // Populate some metrics
    const c1 = collector.recordRequestStart('worker-a')
    vi.advanceTimersByTime(25)
    c1()
    const c2 = collector.recordRequestStart('worker-a')
    vi.advanceTimersByTime(75)
    c2()
    const c3 = collector.recordRequestStart('worker-b')
    vi.advanceTimersByTime(50)
    c3()

    collector.recordError('worker-a')
    collector.recordWake(3, 1)

    const json = collector.toJSON()

    // Should be a plain object (not have Map instances)
    expect(typeof json).toBe('object')
    expect(json).not.toBeNull()

    // Should be serializable
    const serialized = JSON.stringify(json)
    const deserialized = JSON.parse(serialized)

    // Check structure
    expect(deserialized.requests.total).toBe(3)
    expect(deserialized.requests.byTarget['worker-a']).toBe(2)
    expect(deserialized.requests.byTarget['worker-b']).toBe(1)
    expect(deserialized.requests.errors).toBe(1)
    expect(deserialized.requests.errorsByTarget['worker-a']).toBe(1)

    expect(typeof deserialized.latency.p50).toBe('number')
    expect(typeof deserialized.latency.p95).toBe('number')
    expect(typeof deserialized.latency.p99).toBe('number')
    expect(typeof deserialized.latency.sampleCount).toBe('number')
    expect(deserialized.latency.byTarget['worker-a']).toBeDefined()
    expect(deserialized.latency.byTarget['worker-b']).toBeDefined()

    expect(deserialized.inflight.current).toBe(0)
    expect(deserialized.inflight.peak).toBe(1)

    expect(deserialized.hibernation.wakeCount).toBe(1)
    expect(deserialized.hibernation.recoveredRequests).toBe(3)
    expect(deserialized.hibernation.lostRequests).toBe(1)
  })

  it('should export per-target latency without raw samples', () => {
    const collector = new BrokerMetricsCollector()

    // Create some latency samples
    for (let i = 0; i < 10; i++) {
      const c = collector.recordRequestStart('worker-test')
      vi.advanceTimersByTime(i * 10)
      c()
    }

    const json = collector.toJSON()
    const workerLatency = json.latency.byTarget['worker-test'] as Record<string, unknown>

    // Should not include raw samples array (for smaller JSON)
    expect(workerLatency.samples).toBeUndefined()
    // Should include computed percentiles
    expect(workerLatency.p50).toBeDefined()
    expect(workerLatency.p95).toBeDefined()
    expect(workerLatency.p99).toBeDefined()
    expect(workerLatency.sampleCount).toBeDefined()
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Broker Metrics: Edge Cases', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should handle single sample percentiles', () => {
    const collector = new BrokerMetricsCollector()

    const c = collector.recordRequestStart('worker-1')
    vi.advanceTimersByTime(42)
    c()

    const metrics = collector.getMetrics()
    // With a single sample, all percentiles should be that value
    expect(metrics.latency.p50).toBe(42)
    expect(metrics.latency.p95).toBe(42)
    expect(metrics.latency.p99).toBe(42)
  })

  it('should handle zero latency samples', () => {
    const collector = new BrokerMetricsCollector()

    // Complete request instantly (0ms)
    const c = collector.recordRequestStart('worker-1')
    vi.advanceTimersByTime(0)
    c()

    const metrics = collector.getMetrics()
    expect(metrics.latency.p50).toBe(0)
  })

  it('should handle concurrent in-flight tracking correctly', () => {
    const collector = new BrokerMetricsCollector()

    // Start many requests
    const completers: Array<() => void> = []
    for (let i = 0; i < 100; i++) {
      completers.push(collector.recordRequestStart(`worker-${i % 10}`))
    }

    expect(collector.getMetrics().inflight.current).toBe(100)
    expect(collector.getMetrics().inflight.peak).toBe(100)

    // Complete all
    for (const c of completers) {
      c()
    }

    expect(collector.getMetrics().inflight.current).toBe(0)
    expect(collector.getMetrics().inflight.peak).toBe(100)
  })
})

// =============================================================================
// Integration with Broker
// =============================================================================

describe('Broker Metrics: Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should provide accurate metrics for a typical workload', () => {
    const collector = new BrokerMetricsCollector()

    // Simulate a typical workload:
    // - 100 requests to worker-main (fast: 5-15ms)
    // - 50 requests to worker-db (slow: 20-50ms)
    // - 10 errors on worker-db
    // - 2 hibernation wakes

    // Fast worker requests
    for (let i = 0; i < 100; i++) {
      const c = collector.recordRequestStart('worker-main')
      vi.advanceTimersByTime(5 + (i % 11)) // 5-15ms
      c()
    }

    // Slow worker requests with some errors
    for (let i = 0; i < 50; i++) {
      const c = collector.recordRequestStart('worker-db')
      vi.advanceTimersByTime(20 + (i % 31)) // 20-50ms
      c()
      if (i < 10) {
        collector.recordError('worker-db')
      }
    }

    // Hibernation wakes
    collector.recordWake(8, 2)
    collector.recordWake(5, 0)

    const metrics = collector.getMetrics()

    // Request counts
    expect(metrics.requests.total).toBe(150)
    expect(metrics.requests.byTarget.get('worker-main')).toBe(100)
    expect(metrics.requests.byTarget.get('worker-db')).toBe(50)

    // Errors
    expect(metrics.requests.errors).toBe(10)
    expect(metrics.requests.errorsByTarget.get('worker-db')).toBe(10)
    expect(metrics.requests.errorsByTarget.get('worker-main')).toBeUndefined()

    // Hibernation
    expect(metrics.hibernation.wakeCount).toBe(2)
    expect(metrics.hibernation.recoveredRequests).toBe(13)
    expect(metrics.hibernation.lostRequests).toBe(2)

    // Export should work
    const json = collector.toJSON()
    expect(JSON.stringify(json)).toBeTruthy()
  })
})
