/**
 * Performance and Load Tests for DO Concurrent Access
 *
 * This test file provides comprehensive performance and load testing for
 * Durable Object concurrent access patterns including:
 *
 * 1. **Throughput Testing** - Measure requests per second under various loads
 * 2. **Latency Analysis** - p50, p95, p99 response times
 * 3. **Concurrent Request Handling** - High-concurrency stress tests
 * 4. **Race Condition Detection** - Timing-based race condition scenarios
 * 5. **Load Patterns** - Ramp-up, sustained, spike testing
 *
 * Uses real Miniflare DO instances via @cloudflare/vitest-pool-workers.
 *
 * @module do/tests/performance-load.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { createThingsStore, type ThingsStore } from '../../db/things'

// ============================================================================
// Types and Interfaces
// ============================================================================

interface PerformanceMetrics {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  totalDurationMs: number
  throughputRps: number
  latencies: number[]
  p50Ms: number
  p95Ms: number
  p99Ms: number
  minMs: number
  maxMs: number
  avgMs: number
}

interface LoadTestConfig {
  concurrency: number
  totalRequests: number
  rampUpMs?: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Helper to simulate delay
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0
  const index = Math.ceil((p / 100) * sortedArr.length) - 1
  return sortedArr[Math.max(0, index)]!
}

/**
 * Measure single request latency
 */
async function measureRequest(
  requestFn: () => Promise<Response>
): Promise<{ success: boolean; latencyMs: number; status: number }> {
  const start = performance.now()
  try {
    const response = await requestFn()
    const latencyMs = performance.now() - start
    await response.text() // Consume body
    return { success: response.ok, latencyMs, status: response.status }
  } catch {
    return { success: false, latencyMs: performance.now() - start, status: 0 }
  }
}

/**
 * Run load test and collect metrics
 */
async function runLoadTest(
  requestFn: () => Promise<Response>,
  config: LoadTestConfig
): Promise<PerformanceMetrics> {
  const { concurrency, totalRequests, rampUpMs = 0 } = config
  const results: { success: boolean; latencyMs: number }[] = []
  const startTime = performance.now()

  // Calculate batch size and delay between batches for ramp-up
  const batchSize = concurrency
  const numBatches = Math.ceil(totalRequests / batchSize)
  const delayBetweenBatches = rampUpMs > 0 ? rampUpMs / numBatches : 0

  let requestsSent = 0

  while (requestsSent < totalRequests) {
    const batchPromises: Promise<{ success: boolean; latencyMs: number; status: number }>[] = []
    const currentBatchSize = Math.min(batchSize, totalRequests - requestsSent)

    for (let i = 0; i < currentBatchSize; i++) {
      batchPromises.push(measureRequest(requestFn))
    }

    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)
    requestsSent += currentBatchSize

    if (delayBetweenBatches > 0 && requestsSent < totalRequests) {
      await delay(delayBetweenBatches)
    }
  }

  const totalDurationMs = performance.now() - startTime
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b)
  const successCount = results.filter(r => r.success).length

  return {
    totalRequests,
    successfulRequests: successCount,
    failedRequests: totalRequests - successCount,
    totalDurationMs,
    throughputRps: (totalRequests / totalDurationMs) * 1000,
    latencies,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    minMs: latencies[0] ?? 0,
    maxMs: latencies[latencies.length - 1] ?? 0,
    avgMs: latencies.reduce((a, b) => a + b, 0) / latencies.length || 0,
  }
}

// ============================================================================
// Performance Tests: Throughput
// ============================================================================

describe('DO Performance: Throughput', () => {
  it('should measure baseline throughput for health endpoint', async () => {
    const testName = `throughput-baseline-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    const metrics = await runLoadTest(
      () => stub.fetch('https://do/'),
      { concurrency: 10, totalRequests: 100 }
    )

    // Log metrics for analysis
    console.log('Baseline Throughput Metrics:', {
      throughputRps: metrics.throughputRps.toFixed(2),
      avgLatencyMs: metrics.avgMs.toFixed(2),
      p99Ms: metrics.p99Ms.toFixed(2),
    })

    // All requests should succeed
    expect(metrics.successfulRequests).toBe(metrics.totalRequests)

    // Throughput should be reasonable (> 10 RPS even in test env)
    expect(metrics.throughputRps).toBeGreaterThan(10)
  })

  it('should maintain throughput under increasing concurrency', async () => {
    const testName = `throughput-scaling-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    const concurrencyLevels = [5, 10, 20, 50]
    const results: { concurrency: number; throughput: number; p99: number }[] = []

    for (const concurrency of concurrencyLevels) {
      const metrics = await runLoadTest(
        () => stub.fetch('https://do/'),
        { concurrency, totalRequests: concurrency * 10 }
      )

      results.push({
        concurrency,
        throughput: metrics.throughputRps,
        p99: metrics.p99Ms,
      })

      // All requests should succeed regardless of concurrency
      expect(metrics.successfulRequests).toBe(metrics.totalRequests)
    }

    console.log('Concurrency Scaling Results:', results)

    // P99 latency should not explode (< 5000ms even at high concurrency)
    for (const result of results) {
      expect(result.p99).toBeLessThan(5000)
    }
  })

  it('should handle burst traffic patterns', async () => {
    const testName = `throughput-burst-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Simulate burst: 100 requests at once
    const burstMetrics = await runLoadTest(
      () => stub.fetch('https://do/'),
      { concurrency: 100, totalRequests: 100 }
    )

    console.log('Burst Traffic Metrics:', {
      throughputRps: burstMetrics.throughputRps.toFixed(2),
      p99Ms: burstMetrics.p99Ms.toFixed(2),
      maxMs: burstMetrics.maxMs.toFixed(2),
    })

    // All burst requests should succeed
    expect(burstMetrics.successfulRequests).toBe(100)

    // Max latency should be bounded (< 10 seconds)
    expect(burstMetrics.maxMs).toBeLessThan(10000)
  })
})

// ============================================================================
// Performance Tests: Latency Distribution
// ============================================================================

describe('DO Performance: Latency Distribution', () => {
  it('should have consistent latency for read operations', async () => {
    const testName = `latency-read-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    const metrics = await runLoadTest(
      () => stub.fetch('https://do/info'),
      { concurrency: 5, totalRequests: 50 }
    )

    console.log('Read Latency Distribution:', {
      minMs: metrics.minMs.toFixed(2),
      avgMs: metrics.avgMs.toFixed(2),
      p50Ms: metrics.p50Ms.toFixed(2),
      p95Ms: metrics.p95Ms.toFixed(2),
      p99Ms: metrics.p99Ms.toFixed(2),
      maxMs: metrics.maxMs.toFixed(2),
    })

    // All should succeed
    expect(metrics.successfulRequests).toBe(50)

    // Latency variance should be reasonable
    // p99 should not be more than 10x the average
    expect(metrics.p99Ms).toBeLessThan(metrics.avgMs * 10 + 100)
  })

  it('should track latency degradation under sustained load', async () => {
    const testName = `latency-sustained-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Run sustained load in phases
    const phases: PerformanceMetrics[] = []

    for (let phase = 0; phase < 3; phase++) {
      const metrics = await runLoadTest(
        () => stub.fetch('https://do/'),
        { concurrency: 20, totalRequests: 100 }
      )
      phases.push(metrics)
    }

    console.log('Sustained Load Phases:', phases.map((p, i) => ({
      phase: i + 1,
      avgMs: p.avgMs.toFixed(2),
      p99Ms: p.p99Ms.toFixed(2),
    })))

    // All phases should complete successfully
    for (const phase of phases) {
      expect(phase.successfulRequests).toBe(phase.totalRequests)
    }

    // Latency should not degrade significantly between phases
    // Last phase p99 should not be more than 3x first phase
    expect(phases[2]!.p99Ms).toBeLessThan(phases[0]!.p99Ms * 3 + 500)
  })
})

// ============================================================================
// Concurrent Access: High Concurrency Stress Tests
// ============================================================================

describe('DO Concurrent Access: Stress Tests', () => {
  it('should handle 200 concurrent requests', async () => {
    const testName = `stress-200-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    const requests = Array.from({ length: 200 }, () =>
      stub.fetch('https://do/')
    )

    const responses = await Promise.all(requests)

    const successCount = responses.filter(r => r.status === 200).length

    // All should succeed (CF DOs serialize internally)
    expect(successCount).toBe(200)

    // Consume bodies
    await Promise.all(responses.map(r => r.text()))
  })

  it('should maintain data consistency under extreme concurrent writes', async () => {
    const store = createThingsStore()

    // Create 50 concurrent entities
    const creates = Array.from({ length: 50 }, (_, i) =>
      store.create({ $type: 'stress', index: i })
    )

    const results = await Promise.all(creates)

    // All creates should succeed
    expect(results).toHaveLength(50)

    // All IDs should be unique
    const ids = new Set(results.map(r => r.$id))
    expect(ids.size).toBe(50)

    // List should return all items
    const all = await store.list({ type: 'stress' })
    expect(all).toHaveLength(50)
  })

  it('should handle mixed read/write under high load', async () => {
    const store = createThingsStore()

    // Pre-populate with entities
    const initial = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.create({ $type: 'mixed', value: i })
      )
    )

    // Mix of operations: reads, updates, creates
    const operations: Promise<unknown>[] = [
      // 30 reads
      ...Array.from({ length: 30 }, () => store.list({ type: 'mixed' })),
      // 20 updates
      ...initial.slice(0, 20).map((item, i) =>
        store.update(item.$id, { value: i * 10 })
      ),
      // 20 creates
      ...Array.from({ length: 20 }, (_, i) =>
        store.create({ $type: 'mixed', value: 100 + i })
      ),
    ]

    const results = await Promise.all(operations)

    // All operations should complete
    expect(results).toHaveLength(70)

    // Final count should be 40 (20 initial + 20 new)
    const finalList = await store.list({ type: 'mixed' })
    expect(finalList).toHaveLength(40)
  })
})

// ============================================================================
// Race Condition Tests
// ============================================================================

describe('DO Race Condition Detection', () => {
  let store: ThingsStore

  beforeEach(() => {
    store = createThingsStore()
  })

  it('should detect lost updates in read-modify-write cycle', async () => {
    // Create counter
    const counter = await store.create({ $type: 'race-counter', value: 0 })

    const incrementCount = 50
    const incrementFn = async () => {
      const current = await store.get(counter.$id)
      if (!current) throw new Error('Counter not found')
      // Intentional race: no atomicity
      await delay(Math.random() * 5)
      await store.update(counter.$id, { value: (current.value as number) + 1 })
    }

    // Run concurrent increments
    await Promise.all(
      Array.from({ length: incrementCount }, () => incrementFn())
    )

    const final = await store.get(counter.$id)

    // Document the race condition
    console.log('Race Condition Result:', {
      expected: incrementCount,
      actual: final?.value,
      lostUpdates: incrementCount - (final?.value as number || 0),
    })

    // This test documents that lost updates CAN occur
    // In a perfect world, value would equal incrementCount
    // But without proper concurrency control, some updates may be lost
    expect(typeof final?.value).toBe('number')
    // We expect some updates to potentially be lost
    expect(final?.value).toBeLessThanOrEqual(incrementCount)
  })

  it('should demonstrate serialization guarantees at DO level', async () => {
    const testName = `race-serial-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // All requests to same DO are serialized by CF runtime
    const requests = Array.from({ length: 30 }, () =>
      stub.fetch('https://do/info')
    )

    const startTime = performance.now()
    const responses = await Promise.all(requests)
    const totalTime = performance.now() - startTime

    // All should succeed
    const infos = await Promise.all(
      responses.map(r => r.json() as Promise<{ id: string }>)
    )

    // All should see same DO instance
    const uniqueIds = new Set(infos.map(i => i.id))
    expect(uniqueIds.size).toBe(1)

    console.log('Serialization Test:', {
      totalRequests: 30,
      totalTimeMs: totalTime.toFixed(2),
      avgTimePerRequest: (totalTime / 30).toFixed(2),
    })
  })

  it('should handle concurrent entity lifecycle operations', async () => {
    // Test: create, update, delete race conditions
    const entities: string[] = []
    const errors: string[] = []

    // Phase 1: Concurrent creates
    const createPromises = Array.from({ length: 20 }, async (_, i) => {
      try {
        const result = await store.create({ $type: 'lifecycle', phase: 'created', index: i })
        entities.push(result.$id)
      } catch (e) {
        errors.push(`create-${i}: ${e}`)
      }
    })
    await Promise.all(createPromises)

    // Phase 2: Concurrent updates and deletes on same entities
    const mixedOps = entities.flatMap((id, i) => [
      store.update(id, { phase: 'updated' }).catch(e => errors.push(`update-${i}: ${e}`)),
      i % 3 === 0
        ? store.delete(id).catch(e => errors.push(`delete-${i}: ${e}`))
        : Promise.resolve(),
    ])
    await Promise.all(mixedOps)

    // Phase 3: Try to access deleted entities
    const accessDeleted = entities
      .filter((_, i) => i % 3 === 0)
      .map(async (id) => {
        const result = await store.get(id)
        return { id, exists: result !== null }
      })
    const deletedResults = await Promise.all(accessDeleted)

    console.log('Lifecycle Race Results:', {
      totalCreated: entities.length,
      errorsEncountered: errors.length,
      deletedButStillExist: deletedResults.filter(r => r.exists).length,
    })

    // Document behavior - some race conditions may occur
    expect(entities.length).toBe(20)
  })

  it('should handle competing bulk operations', async () => {
    // Two bulk operations on overlapping data
    const items1 = Array.from({ length: 10 }, (_, i) => ({
      $type: 'bulk-race',
      batch: 'A',
      index: i,
    }))

    const items2 = Array.from({ length: 10 }, (_, i) => ({
      $type: 'bulk-race',
      batch: 'B',
      index: i,
    }))

    // Run bulk creates concurrently
    const [result1, result2] = await Promise.all([
      store.bulkCreate(items1),
      store.bulkCreate(items2),
    ])

    // Both should succeed
    expect(result1).toHaveLength(10)
    expect(result2).toHaveLength(10)

    // All 20 items should exist
    const all = await store.list({ type: 'bulk-race' })
    expect(all).toHaveLength(20)

    // Verify both batches are present
    const batchA = all.filter(item => (item as { batch: string }).batch === 'A')
    const batchB = all.filter(item => (item as { batch: string }).batch === 'B')
    expect(batchA).toHaveLength(10)
    expect(batchB).toHaveLength(10)
  })
})

// ============================================================================
// Load Testing Patterns
// ============================================================================

describe('DO Load Testing Patterns', () => {
  it('should handle ramp-up load pattern', async () => {
    const testName = `ramp-up-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Ramp up over 500ms
    const metrics = await runLoadTest(
      () => stub.fetch('https://do/'),
      { concurrency: 20, totalRequests: 100, rampUpMs: 500 }
    )

    console.log('Ramp-up Load Pattern:', {
      throughputRps: metrics.throughputRps.toFixed(2),
      successRate: ((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(1) + '%',
      p99Ms: metrics.p99Ms.toFixed(2),
    })

    // All should succeed
    expect(metrics.successfulRequests).toBe(100)
  })

  it('should handle spike load pattern', async () => {
    const testName = `spike-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Baseline: low traffic
    const baseline = await runLoadTest(
      () => stub.fetch('https://do/'),
      { concurrency: 5, totalRequests: 20 }
    )

    // Spike: sudden high traffic
    const spike = await runLoadTest(
      () => stub.fetch('https://do/'),
      { concurrency: 100, totalRequests: 100 }
    )

    // Recovery: back to baseline
    const recovery = await runLoadTest(
      () => stub.fetch('https://do/'),
      { concurrency: 5, totalRequests: 20 }
    )

    console.log('Spike Load Pattern:', {
      baseline: { p99: baseline.p99Ms.toFixed(2), success: baseline.successfulRequests },
      spike: { p99: spike.p99Ms.toFixed(2), success: spike.successfulRequests },
      recovery: { p99: recovery.p99Ms.toFixed(2), success: recovery.successfulRequests },
    })

    // All phases should succeed
    expect(baseline.successfulRequests).toBe(20)
    expect(spike.successfulRequests).toBe(100)
    expect(recovery.successfulRequests).toBe(20)

    // Recovery latency should return close to baseline
    expect(recovery.p99Ms).toBeLessThan(baseline.p99Ms * 5 + 100)
  })

  it('should handle sustained high load', async () => {
    const testName = `sustained-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    const phases: PerformanceMetrics[] = []

    // Run 5 phases of sustained load
    for (let i = 0; i < 5; i++) {
      const metrics = await runLoadTest(
        () => stub.fetch('https://do/'),
        { concurrency: 30, totalRequests: 60 }
      )
      phases.push(metrics)
    }

    console.log('Sustained High Load:', phases.map((p, i) => ({
      phase: i + 1,
      success: p.successfulRequests,
      p99Ms: p.p99Ms.toFixed(2),
      throughputRps: p.throughputRps.toFixed(2),
    })))

    // All phases should complete successfully
    for (const phase of phases) {
      expect(phase.successfulRequests).toBe(60)
    }

    // No significant degradation over time
    const firstP99 = phases[0]!.p99Ms
    const lastP99 = phases[phases.length - 1]!.p99Ms
    expect(lastP99).toBeLessThan(firstP99 * 5 + 200)
  })
})

// ============================================================================
// Concurrent DO Instance Tests
// ============================================================================

describe('DO Concurrent Multi-Instance Access', () => {
  it('should handle concurrent access to multiple DO instances', async () => {
    // Create requests to 10 different DO instances
    const instances = Array.from({ length: 10 }, (_, i) => {
      const testName = `multi-instance-${generateTestId()}-${i}`
      const id = env.DO.idFromName(testName)
      return env.DO.get(id)
    })

    // Each instance gets 10 concurrent requests
    const allRequests = instances.flatMap(stub =>
      Array.from({ length: 10 }, () => stub.fetch('https://do/'))
    )

    const responses = await Promise.all(allRequests)

    // All 100 requests should succeed
    const successCount = responses.filter(r => r.status === 200).length
    expect(successCount).toBe(100)

    // Consume bodies
    await Promise.all(responses.map(r => r.text()))
  })

  it('should isolate data between concurrent DO instances', async () => {
    const instances = Array.from({ length: 5 }, (_, i) => {
      const testName = `isolation-${generateTestId()}-${i}`
      const id = env.DO.idFromName(testName)
      return env.DO.get(id)
    })

    // Get info from all instances concurrently
    const infoResponses = await Promise.all(
      instances.map(stub => stub.fetch('https://do/info'))
    )

    const infos = await Promise.all(
      infoResponses.map(r => r.json() as Promise<{ id: string; keys: number }>)
    )

    // Each instance should have a unique ID
    const uniqueIds = new Set(infos.map(i => i.id))
    expect(uniqueIds.size).toBe(5)

    console.log('Multi-Instance Isolation:', {
      instanceCount: 5,
      uniqueIds: uniqueIds.size,
      allIds: infos.map(i => i.id),
    })
  })

  it('should handle cross-instance request patterns', async () => {
    const instanceCount = 3
    const instances = Array.from({ length: instanceCount }, (_, i) => {
      const testName = `cross-pattern-${generateTestId()}-${i}`
      const id = env.DO.idFromName(testName)
      return env.DO.get(id)
    })

    // Round-robin requests across instances
    const requestCount = 60
    const requests = Array.from({ length: requestCount }, (_, i) => {
      const stub = instances[i % instanceCount]!
      return measureRequest(() => stub.fetch('https://do/'))
    })

    const results = await Promise.all(requests)

    const successCount = results.filter(r => r.success).length
    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length

    console.log('Cross-Instance Pattern:', {
      totalRequests: requestCount,
      successCount,
      avgLatencyMs: avgLatency.toFixed(2),
    })

    expect(successCount).toBe(requestCount)
  })
})

// ============================================================================
// RPC Batch Performance Tests
// ============================================================================

describe('DO RPC Batch Performance', () => {
  it('should measure batch RPC throughput', async () => {
    const testName = `batch-rpc-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Single batch with multiple calls
    const batchCalls = Array.from({ length: 10 }, (_, i) => ({
      id: `call-${i}`,
      method: 'nonexistent.method',
      args: [],
    }))

    const start = performance.now()
    const response = await stub.fetch('https://do/rpc/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: batchCalls }),
    })
    const batchLatency = performance.now() - start

    expect(response.status).toBe(200)

    // Compare to individual calls
    const individualStart = performance.now()
    const individualResponses = await Promise.all(
      batchCalls.map(call =>
        stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: call.method, args: call.args }),
        })
      )
    )
    const individualLatency = performance.now() - individualStart

    console.log('RPC Batch vs Individual:', {
      batchLatencyMs: batchLatency.toFixed(2),
      individualLatencyMs: individualLatency.toFixed(2),
      speedupFactor: (individualLatency / batchLatency).toFixed(2),
    })

    // Batch should complete (may or may not be faster in test env)
    for (const resp of individualResponses) {
      await resp.text()
    }
  })

  it('should handle large batch requests', async () => {
    const testName = `large-batch-${generateTestId()}`
    const id = env.DO.idFromName(testName)
    const stub = env.DO.get(id)

    // Large batch: 50 calls
    const batchCalls = Array.from({ length: 50 }, (_, i) => ({
      id: `large-call-${i}`,
      method: 'nonexistent',
      args: [],
    }))

    const start = performance.now()
    const response = await stub.fetch('https://do/rpc/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: batchCalls }),
    })
    const latency = performance.now() - start

    expect(response.status).toBe(200)

    interface BatchResult {
      id: string
      error?: { code: string }
    }

    const result = await response.json() as { results: BatchResult[] }

    console.log('Large Batch Results:', {
      callCount: batchCalls.length,
      latencyMs: latency.toFixed(2),
      resultCount: result.results?.length || 0,
    })

    expect(result.results).toHaveLength(50)
  })
})

// ============================================================================
// Memory and Resource Tests
// ============================================================================

describe('DO Resource Usage Under Load', () => {
  it('should not leak memory during sustained operations', async () => {
    const store = createThingsStore()

    // Run multiple cycles of create-delete
    for (let cycle = 0; cycle < 5; cycle++) {
      // Create 100 items
      const items = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          store.create({ $type: 'memory-test', cycle, index: i })
        )
      )

      // Delete all
      await Promise.all(items.map(item => store.delete(item.$id)))

      // List should be empty
      const remaining = await store.list({ type: 'memory-test' })
      expect(remaining).toHaveLength(0)
    }

    // Final verification
    const finalList = await store.list({ type: 'memory-test' })
    expect(finalList).toHaveLength(0)

    console.log('Memory Test: Completed 5 cycles of 100 create-delete operations')
  })

  it('should handle rapid reconnection patterns', async () => {
    const testName = `reconnect-${generateTestId()}`

    // Simulate rapid reconnects by getting stub multiple times
    const reconnectCount = 50
    const results: { success: boolean; latencyMs: number }[] = []

    for (let i = 0; i < reconnectCount; i++) {
      const id = env.DO.idFromName(testName)
      const stub = env.DO.get(id)

      const result = await measureRequest(() => stub.fetch('https://do/'))
      results.push(result)
    }

    const successCount = results.filter(r => r.success).length
    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length

    console.log('Reconnection Pattern:', {
      reconnectCount,
      successCount,
      avgLatencyMs: avgLatency.toFixed(2),
    })

    expect(successCount).toBe(reconnectCount)
  })
})
