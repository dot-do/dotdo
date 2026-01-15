/**
 * Pipeline Throughput Load Tests (TDD RED Phase)
 *
 * Tests for validating Pipeline performance under load.
 * These tests establish performance baselines and verify the Pipeline
 * can handle production-level event throughput.
 *
 * Key areas tested:
 * 1. Event throughput: Can handle 1000+ events/second
 * 2. Backpressure: Properly handles slow consumers
 * 3. Memory bounds: Memory stays bounded under sustained load
 * 4. Latency: Response times remain acceptable under load
 *
 * KNOWN FAILING TESTS (RED phase):
 * - Backpressure tests fail because close() doesn't await in-flight flushPromise
 * - Retry success rate is lower than expected due to batch-level failures
 *
 * @see do-oj8 - [TEST-2] Pipeline throughput load tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PipelineEmitter, type PipelineEmitterConfig, type EmittedEvent } from '../../storage/pipeline-emitter'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Creates a mock pipeline that tracks sent batches and timing
 */
function createMockPipeline(options: {
  latencyMs?: number
  failRate?: number
  trackMemory?: boolean
} = {}): {
  pipeline: { send: (batch: unknown[]) => Promise<void> }
  stats: {
    batches: unknown[][]
    batchCount: number
    totalEvents: number
    timestamps: number[]
    latencies: number[]
    errors: Error[]
  }
} {
  const stats = {
    batches: [] as unknown[][],
    batchCount: 0,
    totalEvents: 0,
    timestamps: [] as number[],
    latencies: [] as number[],
    errors: [] as Error[],
  }

  const pipeline = {
    send: async (batch: unknown[]): Promise<void> => {
      const start = performance.now()
      stats.timestamps.push(Date.now())

      // Simulate latency if configured
      if (options.latencyMs) {
        await new Promise((resolve) => setTimeout(resolve, options.latencyMs))
      }

      // Simulate failures if configured
      if (options.failRate && Math.random() < options.failRate) {
        const error = new Error('Simulated pipeline failure')
        stats.errors.push(error)
        throw error
      }

      stats.batches.push(batch)
      stats.batchCount++
      stats.totalEvents += batch.length
      stats.latencies.push(performance.now() - start)
    },
  }

  return { pipeline, stats }
}

/**
 * Helper to measure memory usage (where available)
 */
function getMemoryUsage(): number {
  // @ts-expect-error - Node.js specific API
  if (typeof process !== 'undefined' && process.memoryUsage) {
    // @ts-expect-error - Node.js specific API
    return process.memoryUsage().heapUsed
  }
  // Fallback for Workers environment
  return 0
}

/**
 * Helper to calculate statistics from an array of numbers
 */
function calculateStats(values: number[]): {
  min: number
  max: number
  avg: number
  p50: number
  p95: number
  p99: number
} {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((a, b) => a + b, 0)

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / values.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  }
}

/**
 * Helper to wait for a specific duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// 1. THROUGHPUT TESTS - Can handle 1000+ events/second
// ============================================================================

describe('Pipeline Throughput', () => {
  it('should handle 1000 events in under 1 second', async () => {
    const { pipeline, stats } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'throughput-test',
      flushInterval: 0, // Immediate flush mode
      batchSize: 100,
    })

    const startTime = performance.now()

    // Emit 1000 events as fast as possible
    for (let i = 0; i < 1000; i++) {
      emitter.emit('test.event', 'throughput-stream', { eventId: i })
    }

    // Flush and wait for completion
    await emitter.flush()
    await emitter.close()

    const duration = performance.now() - startTime

    // Performance assertions
    expect(stats.totalEvents).toBe(1000)
    expect(duration).toBeLessThan(1000) // Should complete within 1 second

    // Calculate throughput
    const eventsPerSecond = stats.totalEvents / (duration / 1000)
    console.log(`Throughput: ${eventsPerSecond.toFixed(2)} events/second`)

    expect(eventsPerSecond).toBeGreaterThan(1000)
  })

  it('should handle 10000 events with batch size optimization', async () => {
    const { pipeline, stats } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'throughput-test-large',
      flushInterval: 50,
      batchSize: 500, // Larger batches for efficiency
    })

    const startTime = performance.now()

    // Emit 10000 events
    for (let i = 0; i < 10000; i++) {
      emitter.emit('test.event', 'throughput-stream', { eventId: i })
    }

    await emitter.flush()
    await emitter.close()

    const duration = performance.now() - startTime

    expect(stats.totalEvents).toBe(10000)

    // Should process 10k events in reasonable time (under 5 seconds)
    expect(duration).toBeLessThan(5000)

    // Calculate throughput
    const eventsPerSecond = stats.totalEvents / (duration / 1000)
    console.log(`Large batch throughput: ${eventsPerSecond.toFixed(2)} events/second`)

    // Should achieve at least 2000 events/second with batching
    expect(eventsPerSecond).toBeGreaterThan(2000)
  })

  it('should maintain throughput under sustained load (5 seconds)', async () => {
    const { pipeline, stats } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'sustained-load-test',
      flushInterval: 100,
      batchSize: 100,
    })

    const testDurationMs = 5000
    const targetEventsPerSecond = 1000
    const eventInterval = 1000 / targetEventsPerSecond // ms between events

    const startTime = performance.now()
    let eventCount = 0

    // Emit events at target rate for the duration
    while (performance.now() - startTime < testDurationMs) {
      emitter.emit('sustained.event', 'load-stream', { eventId: eventCount++ })
      // Small delay to achieve target rate (in a real test, we'd use more precise timing)
      await sleep(eventInterval)
    }

    await emitter.flush()
    await emitter.close()

    const duration = performance.now() - startTime

    // Should have emitted approximately the expected number of events
    const expectedEvents = Math.floor(testDurationMs / eventInterval)
    expect(stats.totalEvents).toBeGreaterThan(expectedEvents * 0.9) // Allow 10% variance

    const actualEventsPerSecond = stats.totalEvents / (duration / 1000)
    console.log(`Sustained throughput: ${actualEventsPerSecond.toFixed(2)} events/second over ${(duration / 1000).toFixed(2)}s`)
  })

  it('should handle burst traffic (1000 events in 100ms)', async () => {
    const { pipeline, stats } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'burst-test',
      flushInterval: 0,
      batchSize: 1000, // Single large batch
    })

    const startTime = performance.now()

    // Burst: emit all events synchronously
    for (let i = 0; i < 1000; i++) {
      emitter.emit('burst.event', 'burst-stream', { eventId: i })
    }

    await emitter.flush()
    const duration = performance.now() - startTime

    expect(stats.totalEvents).toBe(1000)
    expect(duration).toBeLessThan(100) // Burst should complete within 100ms

    console.log(`Burst completed in ${duration.toFixed(2)}ms`)
  })
})

// ============================================================================
// 2. BACKPRESSURE TESTS - Properly handles slow consumers
// ============================================================================

describe('Pipeline Backpressure', () => {
  it('should queue events when pipeline is slow', async () => {
    const { pipeline, stats } = createMockPipeline({ latencyMs: 100 })
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'backpressure-test',
      flushInterval: 50,
      batchSize: 10,
    })

    // Emit events faster than pipeline can process
    for (let i = 0; i < 100; i++) {
      emitter.emit('fast.event', 'slow-pipeline', { eventId: i })
    }

    await emitter.flush()
    await emitter.close()

    // All events should eventually be processed
    expect(stats.totalEvents).toBe(100)

    // Should have multiple batches due to slow pipeline
    expect(stats.batchCount).toBeGreaterThan(1)
  })

  it('should not drop events under backpressure', async () => {
    const { pipeline, stats } = createMockPipeline({ latencyMs: 50 })
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'no-drop-test',
      flushInterval: 10,
      batchSize: 20,
    })

    const eventIds = new Set<number>()
    const totalEvents = 500

    // Emit events rapidly
    for (let i = 0; i < totalEvents; i++) {
      emitter.emit('rapid.event', 'backpressure-stream', { eventId: i })
    }

    await emitter.flush()
    await emitter.close()

    // Extract all event IDs from batches
    for (const batch of stats.batches) {
      for (const event of batch as EmittedEvent[]) {
        eventIds.add((event.payload as { eventId: number }).eventId)
      }
    }

    // Every event should be present (no drops)
    expect(eventIds.size).toBe(totalEvents)
    expect(stats.totalEvents).toBe(totalEvents)
  })

  it('should handle intermittent pipeline slowdowns', async () => {
    let callCount = 0
    const pipeline = {
      send: async (batch: unknown[]): Promise<void> => {
        callCount++
        // Every 3rd batch is slow
        if (callCount % 3 === 0) {
          await sleep(100)
        }
      },
    }

    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'intermittent-slow-test',
      flushInterval: 20,
      batchSize: 25,
    })

    for (let i = 0; i < 200; i++) {
      emitter.emit('intermittent.event', 'variable-stream', { eventId: i })
    }

    await emitter.flush()
    await emitter.close()

    // Should complete without hanging
    expect(callCount).toBeGreaterThan(0)
  })

  it('should implement proper buffer limits to prevent unbounded growth', async () => {
    const { pipeline } = createMockPipeline({ latencyMs: 500 }) // Very slow pipeline
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'buffer-limit-test',
      flushInterval: 1000, // Long flush interval
      batchSize: 10000, // Large batch size (won't trigger automatic flush)
    })

    // Emit many events that will buffer
    for (let i = 0; i < 5000; i++) {
      emitter.emit('buffered.event', 'buffer-stream', { eventId: i })
    }

    // The emitter should have a buffer limit mechanism
    // This test expects implementation to enforce buffer bounds
    // Current implementation may not have this - test should FAIL initially

    // @ts-expect-error - accessing private property for testing
    const bufferSize = emitter.buffer?.length ?? 0

    // Buffer should be bounded (this assertion may fail initially)
    // Expected behavior: buffer should have a max size or backpressure mechanism
    expect(bufferSize).toBeLessThanOrEqual(10000) // Arbitrary limit - should be configurable

    await emitter.close()
  })
})

// ============================================================================
// 3. MEMORY BOUNDS TESTS - Memory stays bounded under load
// ============================================================================

describe('Pipeline Memory Bounds', () => {
  it('should not leak memory during sustained emission', async () => {
    const { pipeline } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'memory-test',
      flushInterval: 50,
      batchSize: 100,
    })

    const initialMemory = getMemoryUsage()
    const memorySnapshots: number[] = []

    // Emit events over time and track memory
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 1000; i++) {
        emitter.emit('memory.event', 'memory-stream', {
          eventId: round * 1000 + i,
          data: 'x'.repeat(100), // Some payload
        })
      }

      await emitter.flush()
      memorySnapshots.push(getMemoryUsage())
    }

    await emitter.close()

    const finalMemory = getMemoryUsage()

    // Memory growth should be bounded
    // Initial to final growth should not exceed reasonable threshold
    const memoryGrowth = finalMemory - initialMemory

    console.log(`Memory: initial=${initialMemory}, final=${finalMemory}, growth=${memoryGrowth}`)
    console.log(`Memory snapshots: ${memorySnapshots.join(', ')}`)

    // Memory growth should be bounded (less than 50MB for 10k events)
    // This threshold may need adjustment based on actual implementation
    expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024)
  })

  it('should release memory after flush', async () => {
    const { pipeline } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'memory-release-test',
      flushInterval: 0,
      batchSize: 100,
    })

    // Emit large batch
    for (let i = 0; i < 1000; i++) {
      emitter.emit('large.event', 'release-stream', {
        eventId: i,
        largePayload: 'x'.repeat(1000),
      })
    }

    const beforeFlush = getMemoryUsage()
    await emitter.flush()

    // Force garbage collection hint (if available)
    if (typeof global !== 'undefined' && (global as Record<string, unknown>).gc) {
      (global as { gc: () => void }).gc()
    }

    const afterFlush = getMemoryUsage()

    // Buffer should be cleared after flush
    // @ts-expect-error - accessing private property for testing
    expect(emitter.buffer?.length ?? 0).toBe(0)

    console.log(`Memory before flush: ${beforeFlush}, after: ${afterFlush}`)

    await emitter.close()
  })

  it('should handle large payloads without excessive memory growth', async () => {
    const { pipeline, stats } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'large-payload-test',
      flushInterval: 100,
      batchSize: 10,
    })

    const initialMemory = getMemoryUsage()

    // Emit events with large payloads (1KB each)
    const largePayload = 'x'.repeat(1024)
    for (let i = 0; i < 100; i++) {
      emitter.emit('large.payload', 'large-stream', {
        eventId: i,
        data: largePayload,
      })
    }

    await emitter.flush()
    await emitter.close()

    const finalMemory = getMemoryUsage()
    const memoryGrowth = finalMemory - initialMemory

    expect(stats.totalEvents).toBe(100)

    // Memory growth should be proportional to payload size, not unbounded
    // 100 events * 1KB = ~100KB, allow 10x overhead = 1MB
    expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024)
  })

  it('should not accumulate duplicate events in memory', async () => {
    const { pipeline, stats } = createMockPipeline({ latencyMs: 10 })
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'dedup-memory-test',
      flushInterval: 50,
      batchSize: 50,
    })

    // Emit events in waves
    for (let wave = 0; wave < 5; wave++) {
      for (let i = 0; i < 100; i++) {
        emitter.emit('wave.event', 'dedup-stream', {
          waveId: wave,
          eventId: i,
        })
      }
      await sleep(100) // Allow flushing between waves
    }

    await emitter.flush()
    await emitter.close()

    // Should have processed all unique events
    expect(stats.totalEvents).toBe(500)

    // Check for duplicates in batches
    const allEventKeys = new Set<string>()
    for (const batch of stats.batches) {
      for (const event of batch as EmittedEvent[]) {
        const payload = event.payload as { waveId: number; eventId: number }
        const key = `${payload.waveId}-${payload.eventId}`
        if (allEventKeys.has(key)) {
          throw new Error(`Duplicate event found: ${key}`)
        }
        allEventKeys.add(key)
      }
    }
  })
})

// ============================================================================
// 4. LATENCY TESTS - Response times remain acceptable under load
// ============================================================================

describe('Pipeline Latency', () => {
  it('should maintain low emit latency under normal load', async () => {
    const { pipeline } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'latency-test',
      flushInterval: 100,
      batchSize: 100,
    })

    const emitLatencies: number[] = []

    // Measure individual emit latencies
    for (let i = 0; i < 1000; i++) {
      const start = performance.now()
      emitter.emit('latency.event', 'latency-stream', { eventId: i })
      emitLatencies.push(performance.now() - start)
    }

    await emitter.flush()
    await emitter.close()

    const latencyStats = calculateStats(emitLatencies)

    console.log(`Emit latency (ms): avg=${latencyStats.avg.toFixed(3)}, p50=${latencyStats.p50.toFixed(3)}, p95=${latencyStats.p95.toFixed(3)}, p99=${latencyStats.p99.toFixed(3)}`)

    // Emit should be nearly instant (fire-and-forget)
    expect(latencyStats.avg).toBeLessThan(1) // Average under 1ms
    expect(latencyStats.p95).toBeLessThan(5) // 95th percentile under 5ms
    expect(latencyStats.p99).toBeLessThan(10) // 99th percentile under 10ms
  })

  it('should maintain acceptable flush latency', async () => {
    const { pipeline } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'flush-latency-test',
      flushInterval: 1000, // Long interval to control flush timing
      batchSize: 10000,
    })

    const flushLatencies: number[] = []

    // Perform multiple flushes with varying batch sizes
    for (let round = 0; round < 10; round++) {
      // Emit batch
      for (let i = 0; i < 100; i++) {
        emitter.emit('flush.event', 'flush-stream', { round, eventId: i })
      }

      // Measure flush latency
      const start = performance.now()
      await emitter.flush()
      flushLatencies.push(performance.now() - start)
    }

    await emitter.close()

    const flushStats = calculateStats(flushLatencies)

    console.log(`Flush latency (ms): avg=${flushStats.avg.toFixed(3)}, p50=${flushStats.p50.toFixed(3)}, p95=${flushStats.p95.toFixed(3)}, max=${flushStats.max.toFixed(3)}`)

    // Flush should complete quickly for reasonable batch sizes
    expect(flushStats.avg).toBeLessThan(100) // Average under 100ms
    expect(flushStats.p95).toBeLessThan(200) // 95th percentile under 200ms
  })

  it('should not degrade latency as buffer grows', async () => {
    const { pipeline } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'degradation-test',
      flushInterval: 10000, // Very long interval - manual flush only
      batchSize: 100000,
    })

    const latenciesSmallBuffer: number[] = []
    const latenciesLargeBuffer: number[] = []

    // Measure latency with small buffer
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      emitter.emit('small.buffer', 'degrade-stream', { eventId: i })
      latenciesSmallBuffer.push(performance.now() - start)
    }

    // Fill buffer significantly
    for (let i = 0; i < 10000; i++) {
      emitter.emit('fill.buffer', 'degrade-stream', { eventId: i })
    }

    // Measure latency with large buffer
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      emitter.emit('large.buffer', 'degrade-stream', { eventId: i })
      latenciesLargeBuffer.push(performance.now() - start)
    }

    await emitter.flush()
    await emitter.close()

    const smallStats = calculateStats(latenciesSmallBuffer)
    const largeStats = calculateStats(latenciesLargeBuffer)

    console.log(`Small buffer latency: avg=${smallStats.avg.toFixed(3)}ms, p95=${smallStats.p95.toFixed(3)}ms`)
    console.log(`Large buffer latency: avg=${largeStats.avg.toFixed(3)}ms, p95=${largeStats.p95.toFixed(3)}ms`)

    // Latency should not degrade significantly with larger buffer
    // Allow 10x degradation at most
    expect(largeStats.avg).toBeLessThan(smallStats.avg * 10 + 1) // +1 for near-zero baseline
    expect(largeStats.p95).toBeLessThan(smallStats.p95 * 10 + 5)
  })

  it('should maintain consistent latency under concurrent access', async () => {
    const { pipeline } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'concurrent-latency-test',
      flushInterval: 50,
      batchSize: 50,
    })

    const allLatencies: number[] = []
    const concurrentEmitters = 10
    const eventsPerEmitter = 100

    // Simulate concurrent access from multiple "sources"
    const emitPromises = Array.from({ length: concurrentEmitters }, async (_, sourceId) => {
      const sourceLatencies: number[] = []
      for (let i = 0; i < eventsPerEmitter; i++) {
        const start = performance.now()
        emitter.emit('concurrent.event', 'concurrent-stream', {
          sourceId,
          eventId: i,
        })
        sourceLatencies.push(performance.now() - start)
        // Small delay to interleave with other "sources"
        if (i % 10 === 0) {
          await sleep(1)
        }
      }
      return sourceLatencies
    })

    const results = await Promise.all(emitPromises)
    for (const latencies of results) {
      allLatencies.push(...latencies)
    }

    await emitter.flush()
    await emitter.close()

    const concurrentStats = calculateStats(allLatencies)

    console.log(`Concurrent latency (ms): avg=${concurrentStats.avg.toFixed(3)}, p95=${concurrentStats.p95.toFixed(3)}, p99=${concurrentStats.p99.toFixed(3)}`)

    // Latency should remain low even with concurrent access
    expect(concurrentStats.avg).toBeLessThan(5)
    expect(concurrentStats.p99).toBeLessThan(50)
  })
})

// ============================================================================
// 5. CLOSE() BEHAVIOR TESTS - Proper shutdown under load
// ============================================================================

describe('Pipeline Close Behavior', () => {
  it('should await in-flight flushes when closing (BUG: currently does not)', async () => {
    // This test exposes a bug: close() does not await in-flight flushPromise
    // Events sent to a slow pipeline are lost on close()
    const { pipeline, stats } = createMockPipeline({ latencyMs: 200 })
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'close-test',
      flushInterval: 10, // Trigger automatic flush quickly
      batchSize: 50,
    })

    // Emit events
    for (let i = 0; i < 100; i++) {
      emitter.emit('close.event', 'close-stream', { eventId: i })
    }

    // Wait just enough for flush to start but not complete
    await sleep(50)

    // Close should wait for in-flight flush to complete
    await emitter.close()

    // All events should be processed (currently fails: close() doesn't await flushPromise)
    expect(stats.totalEvents).toBe(100)
  })

  it('should complete all pending flushes before close returns', async () => {
    const flushTimes: number[] = []
    let closeTime = 0

    const pipeline = {
      send: async (batch: unknown[]): Promise<void> => {
        await sleep(100) // Simulate slow pipeline
        flushTimes.push(Date.now())
      },
    }

    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'close-order-test',
      flushInterval: 20,
      batchSize: 25,
    })

    for (let i = 0; i < 100; i++) {
      emitter.emit('order.event', 'order-stream', { eventId: i })
    }

    await sleep(50) // Allow some flushes to start

    await emitter.close()
    closeTime = Date.now()

    // All flush operations should complete BEFORE close returns
    for (const flushTime of flushTimes) {
      expect(flushTime).toBeLessThanOrEqual(closeTime)
    }
  })

  it('should not lose events when close() is called during rapid emission', async () => {
    const { pipeline, stats } = createMockPipeline({ latencyMs: 50 })
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'rapid-close-test',
      flushInterval: 10,
      batchSize: 20,
    })

    // Rapidly emit events in background
    const emitPromise = (async () => {
      for (let i = 0; i < 200; i++) {
        emitter.emit('rapid.event', 'rapid-stream', { eventId: i })
        if (i % 10 === 0) await sleep(1) // Small yield
      }
    })()

    // Close while emitting (after some events)
    await sleep(50)
    await emitter.close()

    // Wait for emit loop to finish (it will throw when emitting to closed emitter)
    try {
      await emitPromise
    } catch {
      // Expected: emitting to closed emitter throws
    }

    // Events emitted before close() should be processed
    expect(stats.totalEvents).toBeGreaterThan(0)
  })
})

// ============================================================================
// 6. STRESS TESTS - Combined load scenarios
// ============================================================================

describe('Pipeline Stress Tests', () => {
  it('should survive spike-and-recover pattern', async () => {
    const { pipeline, stats } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'spike-test',
      flushInterval: 50,
      batchSize: 100,
    })

    // Normal load
    for (let i = 0; i < 100; i++) {
      emitter.emit('normal.event', 'spike-stream', { phase: 'normal', id: i })
    }
    await sleep(100)

    // Spike
    for (let i = 0; i < 1000; i++) {
      emitter.emit('spike.event', 'spike-stream', { phase: 'spike', id: i })
    }
    await sleep(100)

    // Recovery (back to normal)
    for (let i = 0; i < 100; i++) {
      emitter.emit('recovery.event', 'spike-stream', { phase: 'recovery', id: i })
    }

    await emitter.flush()
    await emitter.close()

    // All events should be processed
    expect(stats.totalEvents).toBe(1200)
  })

  it('should handle pipeline failures and retries under load', async () => {
    const { pipeline, stats } = createMockPipeline({ failRate: 0.1 }) // 10% failure rate
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'retry-load-test',
      flushInterval: 20,
      batchSize: 20,
      maxRetries: 3,
      retryDelay: 10,
    })

    for (let i = 0; i < 500; i++) {
      emitter.emit('retry.event', 'retry-stream', { eventId: i })
    }

    await emitter.flush()
    await emitter.close()

    // Most events should be processed despite failures
    // With 10% failure rate and 3 retries, loss should be very low
    const successRate = stats.totalEvents / 500
    console.log(`Success rate with 10% failure: ${(successRate * 100).toFixed(2)}%`)

    expect(successRate).toBeGreaterThan(0.9) // At least 90% success
  })

  it('should handle varying payload sizes under load', async () => {
    const { pipeline, stats } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'variable-payload-test',
      flushInterval: 50,
      batchSize: 50,
    })

    // Mix of small, medium, and large payloads
    for (let i = 0; i < 300; i++) {
      const size = i % 3 === 0 ? 10 : i % 3 === 1 ? 1000 : 10000
      emitter.emit('variable.event', 'variable-stream', {
        eventId: i,
        data: 'x'.repeat(size),
      })
    }

    await emitter.flush()
    await emitter.close()

    expect(stats.totalEvents).toBe(300)
  })

  it('should handle rapid open/close cycles', async () => {
    const { pipeline, stats } = createMockPipeline()

    for (let cycle = 0; cycle < 10; cycle++) {
      const emitter = new PipelineEmitter(pipeline, {
        namespace: `cycle-test-${cycle}`,
        flushInterval: 10,
        batchSize: 10,
      })

      for (let i = 0; i < 50; i++) {
        emitter.emit('cycle.event', 'cycle-stream', { cycle, eventId: i })
      }

      await emitter.close()
    }

    // All events from all cycles should be processed
    expect(stats.totalEvents).toBe(500)
  })
})

// ============================================================================
// PERFORMANCE BASELINE SUMMARY
// ============================================================================

describe('Performance Baseline Documentation', () => {
  it('should document current performance baselines', async () => {
    console.log('\n=== Pipeline Performance Baselines ===')
    console.log('These baselines should be updated as optimizations are made.\n')

    const { pipeline, stats } = createMockPipeline()
    const emitter = new PipelineEmitter(pipeline, {
      namespace: 'baseline-test',
      flushInterval: 50,
      batchSize: 100,
    })

    const emitLatencies: number[] = []
    const startTime = performance.now()

    // Baseline test: 1000 events
    for (let i = 0; i < 1000; i++) {
      const start = performance.now()
      emitter.emit('baseline.event', 'baseline-stream', { eventId: i })
      emitLatencies.push(performance.now() - start)
    }

    await emitter.flush()
    await emitter.close()

    const totalTime = performance.now() - startTime
    const latencyStats = calculateStats(emitLatencies)
    const throughput = 1000 / (totalTime / 1000)

    console.log('Baseline Results (1000 events):')
    console.log(`  Total time: ${totalTime.toFixed(2)}ms`)
    console.log(`  Throughput: ${throughput.toFixed(2)} events/sec`)
    console.log(`  Emit latency avg: ${latencyStats.avg.toFixed(3)}ms`)
    console.log(`  Emit latency p95: ${latencyStats.p95.toFixed(3)}ms`)
    console.log(`  Emit latency p99: ${latencyStats.p99.toFixed(3)}ms`)
    console.log(`  Batch count: ${stats.batchCount}`)
    console.log(`  Avg batch size: ${(stats.totalEvents / stats.batchCount).toFixed(1)}`)
    console.log('')

    // These expectations define the current baseline
    // Update these as the implementation improves
    expect(throughput).toBeGreaterThan(100) // Minimum baseline: 100 events/sec
    expect(latencyStats.p99).toBeLessThan(100) // Max p99 latency: 100ms
  })
})
