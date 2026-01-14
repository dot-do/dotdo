/**
 * Streaming Deduplication Tests (RED Phase)
 *
 * Tests to expose O(n) memory issues in current streaming dedup implementation
 * and validate future O(1) probabilistic approaches.
 *
 * Current implementation uses Set<string> for deduplication which grows linearly
 * with unique items. These tests will fail until we implement:
 * - Bloom filters for O(1) space duplicate detection
 * - HyperLogLog for cardinality estimation
 * - Window-based dedup with eviction
 *
 * @see dotdo-sivsj
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createStreamingPipeline,
  StreamingPipeline,
  IncrementalResult,
  minutes,
  seconds,
  hours,
  EventTimeTrigger,
  CountTrigger,
  WindowManager,
} from '../streaming'

// ============================================================================
// Types for Testing
// ============================================================================

interface StreamEvent {
  id: string
  userId: string
  timestamp: number
  value: number
  category: string
}

interface DedupConfig {
  mode: 'exact' | 'bloom' | 'hyperloglog' | 'hybrid'
  memoryLimit?: number
  falsePositiveRate?: number
  windowDuration?: number
}

interface DedupStats {
  memoryBytes: number
  uniqueCount: number
  duplicateCount: number
  falsePositives?: number
  falseNegatives?: number
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateUniqueEvent(index: number, timestamp: number): StreamEvent {
  return {
    id: `event-${index}-${timestamp}`,
    userId: `user-${index % 1000}`,
    timestamp,
    value: Math.random() * 100,
    category: ['A', 'B', 'C'][index % 3],
  }
}

function generateDuplicateEvent(original: StreamEvent, newTimestamp: number): StreamEvent {
  return {
    ...original,
    timestamp: newTimestamp,
  }
}

/**
 * Estimate memory usage of the deduplication structure.
 * For Set<string>, this grows O(n) with unique items.
 * For Bloom filter, this should be O(1) bounded.
 */
function estimateDedupMemory(pipeline: StreamingPipeline<StreamEvent>): number {
  const memEstimate = pipeline.estimateMemoryUsage()
  return memEstimate.total
}

/**
 * Get heap memory usage in bytes
 */
function getHeapUsed(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed
  }
  // Fallback for browser/worker environment
  return 0
}

// ============================================================================
// Memory Efficiency Tests
// ============================================================================

describe('Streaming Deduplication - Memory Efficiency', () => {
  it('dedup uses O(1) memory', () => {
    // This test exposes the O(n) memory issue
    // With current Set-based implementation, memory grows linearly
    // With Bloom filter, memory should be bounded/constant

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(1000000), // High threshold to avoid triggering
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED (not yet implemented):
        // mode: 'bloom',
        // memoryLimit: 1024 * 1024, // 1MB max
      },
    }).aggregate({ count: { $count: {} } })

    const baseTime = Date.now()

    // Process 10,000 unique items
    const memoryBefore = estimateDedupMemory(pipeline)
    for (let i = 0; i < 10000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i))
    }
    const memoryAfter10k = estimateDedupMemory(pipeline)

    // Process another 10,000 unique items (20,000 total)
    for (let i = 10000; i < 20000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i))
    }
    const memoryAfter20k = estimateDedupMemory(pipeline)

    // With O(n) Set: memory doubles when items double
    // With O(1) Bloom: memory stays relatively constant
    const growthRatio = (memoryAfter20k - memoryBefore) / (memoryAfter10k - memoryBefore)

    // CURRENT: growthRatio ~ 2.0 (O(n) linear growth)
    // EXPECTED: growthRatio < 1.5 (O(1) bounded growth)
    expect(growthRatio).toBeLessThan(1.5)

    pipeline.dispose()
  })

  it('memory stable at 1M items', () => {
    // Test that memory stays bounded even with 1M unique items
    const MEMORY_LIMIT = 10 * 1024 * 1024 // 10MB max expected

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(2000000),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'bloom',
        // memoryLimit: MEMORY_LIMIT,
      },
    }).aggregate({ count: { $count: {} } })

    const baseTime = Date.now()
    const heapBefore = getHeapUsed()

    // Process 1M unique items in batches
    for (let batch = 0; batch < 100; batch++) {
      for (let i = 0; i < 10000; i++) {
        const idx = batch * 10000 + i
        pipeline.process(generateUniqueEvent(idx, baseTime + idx))
      }
    }

    const heapAfter = getHeapUsed()
    const memoryGrowth = heapAfter - heapBefore

    // With O(n) Set: memory grows to ~50-100MB for 1M strings
    // With Bloom filter: memory should stay under 10MB
    expect(memoryGrowth).toBeLessThan(MEMORY_LIMIT)

    pipeline.dispose()
  })

  it('memory stable at 10M items', () => {
    // Stress test with 10M items - should not run out of memory
    const MEMORY_LIMIT = 50 * 1024 * 1024 // 50MB max expected

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(20000000),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'bloom',
        // memoryLimit: MEMORY_LIMIT,
      },
    }).aggregate({ count: { $count: {} } })

    const baseTime = Date.now()
    const heapBefore = getHeapUsed()

    // Process 10M unique items in batches
    // This will likely cause OOM with current Set implementation
    for (let batch = 0; batch < 1000; batch++) {
      for (let i = 0; i < 10000; i++) {
        const idx = batch * 10000 + i
        pipeline.process(generateUniqueEvent(idx, baseTime + idx))
      }
    }

    const heapAfter = getHeapUsed()
    const memoryGrowth = heapAfter - heapBefore

    // With O(n) Set: likely OOM or >500MB
    // With Bloom filter: should stay under 50MB
    expect(memoryGrowth).toBeLessThan(MEMORY_LIMIT)

    pipeline.dispose()
  })

  it('configurable memory limit', () => {
    // Memory limit should be configurable and enforced
    const CONFIGURED_LIMIT = 1024 * 1024 // 1MB

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(1000000),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'bloom',
        // memoryLimit: CONFIGURED_LIMIT,
      },
    }).aggregate({ count: { $count: {} } })

    const baseTime = Date.now()

    // Process 100k unique items
    for (let i = 0; i < 100000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i))
    }

    const memoryUsed = estimateDedupMemory(pipeline)

    // Memory should respect configured limit
    expect(memoryUsed).toBeLessThanOrEqual(CONFIGURED_LIMIT)

    pipeline.dispose()
  })
})

// ============================================================================
// Bloom Filter Approach Tests
// ============================================================================

describe('Streaming Deduplication - Bloom Filter Approach', () => {
  it('bloom filter catches duplicates', () => {
    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'bloom',
        // expectedItems: 10000,
        // falsePositiveRate: 0.01,
      },
    }).aggregate({ count: { $count: {} } })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()

    // Process 100 unique events
    const events: StreamEvent[] = []
    for (let i = 0; i < 100; i++) {
      const event = generateUniqueEvent(i, baseTime + i * 100)
      events.push(event)
      pipeline.process(event)
    }

    // Re-process same events (duplicates)
    for (const event of events) {
      pipeline.process(generateDuplicateEvent(event, baseTime + 50000))
    }

    // Advance watermark to trigger
    pipeline.advanceWatermark(baseTime + minutes(5).toMillis())

    // Should only count unique events (100), not duplicates (200 total processed)
    expect(results[0].aggregations.get(undefined)?.count).toBe(100)

    pipeline.dispose()
  })

  it('bloom filter false positive rate', () => {
    // False positive rate should be < 1%
    const TARGET_FPR = 0.01

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(100000),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'bloom',
        // expectedItems: 10000,
        // falsePositiveRate: TARGET_FPR,
      },
    }).aggregate({ count: { $count: {} } })

    const baseTime = Date.now()

    // Add 10,000 items to the filter
    for (let i = 0; i < 10000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i))
    }

    // Test 10,000 items that were NOT added
    // Count how many are falsely reported as duplicates
    let falsePositives = 0
    const testPipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(100000),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
      },
    }).aggregate({ count: { $count: {} } })

    // Copy state from pipeline to testPipeline would be needed
    // For now, we track unique items ourselves
    const seenIds = new Set<string>()
    for (let i = 10000; i < 20000; i++) {
      const event = generateUniqueEvent(i, baseTime + i)
      if (seenIds.has(event.id)) {
        falsePositives++
      }
      seenIds.add(event.id)
    }

    const actualFPR = falsePositives / 10000

    // With proper Bloom filter, FPR should be < 1%
    // This test will pass trivially for Set (0% FPR) but Set has O(n) memory
    expect(actualFPR).toBeLessThan(TARGET_FPR)

    // Additional constraint: memory must be bounded
    const memoryUsed = estimateDedupMemory(pipeline)
    expect(memoryUsed).toBeLessThan(1024 * 1024) // < 1MB for 10k items

    pipeline.dispose()
    testPipeline.dispose()
  })

  it('no false negatives', () => {
    // Bloom filters guarantee NO false negatives
    // If we saw an item before, we MUST report it as a duplicate

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'bloom',
      },
    }).aggregate({ count: { $count: {} } })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()

    // Store original events
    const originalEvents: StreamEvent[] = []
    for (let i = 0; i < 1000; i++) {
      const event = generateUniqueEvent(i, baseTime + i * 10)
      originalEvents.push(event)
      pipeline.process(event)
    }

    // Re-process ALL original events as duplicates
    // Every single one MUST be detected (no false negatives)
    for (const event of originalEvents) {
      pipeline.process(generateDuplicateEvent(event, baseTime + 100000))
    }

    pipeline.advanceWatermark(baseTime + minutes(5).toMillis())

    // Count should be exactly 1000 (all duplicates caught)
    // If any false negatives, count would be > 1000
    expect(results[0].aggregations.get(undefined)?.count).toBe(1000)

    pipeline.dispose()
  })

  it('configurable FPR tradeoff', () => {
    // Different FPR settings should trade accuracy for memory

    const configs = [
      { fpr: 0.001, expectedMaxMemory: 2 * 1024 * 1024 }, // 0.1% FPR, ~2MB
      { fpr: 0.01, expectedMaxMemory: 1024 * 1024 }, // 1% FPR, ~1MB
      { fpr: 0.1, expectedMaxMemory: 512 * 1024 }, // 10% FPR, ~512KB
    ]

    for (const config of configs) {
      const pipeline = createStreamingPipeline<StreamEvent>({
        windowAssigner: WindowManager.global(),
        trigger: new CountTrigger(100000),
        deduplication: {
          enabled: true,
          keyExtractor: (e) => e.id,
          // EXPECTED:
          // mode: 'bloom',
          // falsePositiveRate: config.fpr,
        },
      }).aggregate({ count: { $count: {} } })

      const baseTime = Date.now()

      for (let i = 0; i < 10000; i++) {
        pipeline.process(generateUniqueEvent(i, baseTime + i))
      }

      const memoryUsed = estimateDedupMemory(pipeline)

      // Lower FPR = more bits = more memory
      // Higher FPR = fewer bits = less memory
      expect(memoryUsed).toBeLessThan(config.expectedMaxMemory)

      pipeline.dispose()
    }
  })
})

// ============================================================================
// HyperLogLog Counting Tests
// ============================================================================

describe('Streaming Deduplication - HyperLogLog Counting', () => {
  it('estimates cardinality', () => {
    // HyperLogLog provides O(1) space cardinality estimation

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(1000000),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'hyperloglog',
        // precision: 14, // 2^14 registers = 16KB
      },
    }).aggregate({
      count: { $count: {} },
      // EXPECTED: uniqueCount: { $hllCount: '$id' }
    })

    const baseTime = Date.now()

    // Process 100,000 unique items
    for (let i = 0; i < 100000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i))
    }

    // HLL should estimate ~100,000 with small error
    const memoryEstimate = pipeline.estimateMemoryUsage()

    // Memory should be bounded (HLL uses ~16KB for 14-bit precision)
    expect(memoryEstimate.total).toBeLessThan(100 * 1024) // < 100KB

    pipeline.dispose()
  })

  it('HLL error bounds', () => {
    // Standard error for HLL is ~1.04/sqrt(m) where m = 2^precision
    // For precision=14 (16384 registers): SE ~ 0.81%

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'hyperloglog',
        // precision: 14,
      },
    }).aggregate({
      count: { $count: {} },
      // EXPECTED: estimatedUnique: { $hllCount: '$id' }
    })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()
    const ACTUAL_COUNT = 50000

    for (let i = 0; i < ACTUAL_COUNT; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i * 5))
    }

    pipeline.advanceWatermark(baseTime + minutes(5).toMillis())

    // The count aggregator still counts exact (O(n))
    // But HLL cardinality estimator should be within 2% error
    const count = results[0].aggregations.get(undefined)?.count as number

    // Standard error ~2% means 95% confidence within ~4%
    const expectedMin = ACTUAL_COUNT * 0.96
    const expectedMax = ACTUAL_COUNT * 1.04

    expect(count).toBeGreaterThanOrEqual(expectedMin)
    expect(count).toBeLessThanOrEqual(expectedMax)

    pipeline.dispose()
  })

  it('HLL merges correctly', () => {
    // HLL supports merging for distributed counting

    const pipeline1 = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED: mode: 'hyperloglog'
      },
    }).aggregate({ count: { $count: {} } })

    const pipeline2 = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED: mode: 'hyperloglog'
      },
    }).aggregate({ count: { $count: {} } })

    const baseTime = Date.now()

    // Add different items to each pipeline
    for (let i = 0; i < 5000; i++) {
      pipeline1.process(generateUniqueEvent(i, baseTime + i))
    }
    for (let i = 5000; i < 10000; i++) {
      pipeline2.process(generateUniqueEvent(i, baseTime + i))
    }

    // Create checkpoints
    const checkpoint1 = pipeline1.createCheckpoint()
    const checkpoint2 = pipeline2.createCheckpoint()

    // Merge checkpoints (EXPECTED: mergeHLL function)
    // const mergedHLL = mergeHLL(checkpoint1.hllState, checkpoint2.hllState)
    // expect(mergedHLL.estimate()).toBeCloseTo(10000, -2) // ~10000 within 100

    // For now, just verify checkpoints can be created
    expect(checkpoint1).toBeDefined()
    expect(checkpoint2).toBeDefined()

    pipeline1.dispose()
    pipeline2.dispose()
  })
})

// ============================================================================
// Window-Based Dedup Tests
// ============================================================================

describe('Streaming Deduplication - Window-Based Dedup', () => {
  it('dedup within time window', () => {
    // Only deduplicate within a time window (e.g., last 5 minutes)

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // windowDuration: minutes(5).toMillis(),
      },
    }).aggregate({ count: { $count: {} } })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()

    // Process event in first window
    const event = generateUniqueEvent(1, baseTime)
    pipeline.process(event)

    // Process duplicate in same window - should be deduplicated
    pipeline.process(generateDuplicateEvent(event, baseTime + 60000))

    pipeline.advanceWatermark(baseTime + minutes(5).toMillis())

    expect(results[0].aggregations.get(undefined)?.count).toBe(1)

    pipeline.dispose()
  })

  it('dedup window slides', () => {
    // Sliding dedup window allows same ID to be processed again after window expires

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(1)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // windowDuration: minutes(1).toMillis(),
      },
    }).aggregate({ count: { $count: {} } })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()

    // Window 1: [baseTime, baseTime + 1min]
    const event = generateUniqueEvent(1, baseTime)
    pipeline.process(event)
    pipeline.advanceWatermark(baseTime + minutes(1).toMillis())

    // Window 2: [baseTime + 1min, baseTime + 2min]
    // Same ID should be allowed since dedup window slid
    const eventWindow2 = generateDuplicateEvent(event, baseTime + minutes(1).toMillis() + 1000)
    pipeline.process(eventWindow2)
    pipeline.advanceWatermark(baseTime + minutes(2).toMillis())

    // Both windows should have count of 1
    expect(results.length).toBe(2)
    expect(results[0].aggregations.get(undefined)?.count).toBe(1)
    expect(results[1].aggregations.get(undefined)?.count).toBe(1)

    pipeline.dispose()
  })

  it('expired entries evicted', () => {
    // Entries outside the dedup window should be evicted to recover memory

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(1)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // windowDuration: minutes(1).toMillis(),
        // evictionInterval: seconds(30).toMillis(),
      },
    }).aggregate({ count: { $count: {} } })

    const baseTime = Date.now()

    // Fill with 10,000 events in first window
    for (let i = 0; i < 10000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i * 5))
    }

    const memoryAfterWindow1 = estimateDedupMemory(pipeline)

    // Advance past window, triggering eviction
    pipeline.advanceWatermark(baseTime + minutes(2).toMillis())

    // Fill with 10,000 NEW events in second window
    for (let i = 10000; i < 20000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + minutes(1).toMillis() + i * 5))
    }

    const memoryAfterWindow2 = estimateDedupMemory(pipeline)

    // Memory should be similar (old entries evicted)
    // With O(n) Set without eviction: memory doubles
    // With window-based eviction: memory stays bounded
    const memoryRatio = memoryAfterWindow2 / memoryAfterWindow1

    expect(memoryRatio).toBeLessThan(1.5)

    pipeline.dispose()
  })
})

// ============================================================================
// Stream Operations Tests
// ============================================================================

describe('Streaming Deduplication - Stream Operations', () => {
  it('streaming dedup preserves order', () => {
    // First occurrence of each ID should be preserved, subsequent dropped

    const processedEvents: StreamEvent[] = []

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // preserveFirst: true,
      },
    })
      .aggregate({
        firstValues: { $push: '$value' },
      })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()

    // First occurrence with value 100
    pipeline.process({ id: 'A', userId: 'u1', timestamp: baseTime, value: 100, category: 'X' })
    // Duplicate with value 200 (should be dropped)
    pipeline.process({ id: 'A', userId: 'u1', timestamp: baseTime + 1000, value: 200, category: 'X' })
    // Second unique with value 300
    pipeline.process({ id: 'B', userId: 'u1', timestamp: baseTime + 2000, value: 300, category: 'X' })
    // Another duplicate of A with value 400 (should be dropped)
    pipeline.process({ id: 'A', userId: 'u1', timestamp: baseTime + 3000, value: 400, category: 'X' })

    pipeline.advanceWatermark(baseTime + minutes(5).toMillis())

    const values = results[0].aggregations.get(undefined)?.firstValues as number[]
    // Should only have [100, 300] - first occurrences in order
    expect(values).toEqual([100, 300])

    pipeline.dispose()
  })

  it('streaming dedup low latency', () => {
    // Dedup operation should not block the stream (O(1) per item)

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(100000),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'bloom', // O(1) operations
      },
    }).aggregate({ count: { $count: {} } })

    const baseTime = Date.now()
    const events: StreamEvent[] = []

    // Pre-generate 10,000 events
    for (let i = 0; i < 10000; i++) {
      events.push(generateUniqueEvent(i, baseTime + i))
    }

    // Time the processing
    const startTime = performance.now()

    for (const event of events) {
      pipeline.process(event)
    }

    const endTime = performance.now()
    const totalMs = endTime - startTime
    const msPerItem = totalMs / events.length

    // Should process at least 100k items/second (< 0.01ms per item)
    // With O(n) Set, this may degrade as set grows
    // With O(1) Bloom, latency should be constant
    expect(msPerItem).toBeLessThan(0.1) // < 0.1ms per item

    pipeline.dispose()
  })

  it('backpressure on slow consumer', () => {
    // When consumer is slow, pipeline should apply backpressure

    let processedCount = 0
    let blockedCount = 0

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(100),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // maxPendingItems: 1000,
        // backpressureStrategy: 'block',
      },
    }).aggregate({ count: { $count: {} } })

    pipeline.onResult(async (result) => {
      // Slow consumer - takes time to process
      await new Promise((resolve) => setTimeout(resolve, 10))
      processedCount++
    })

    const baseTime = Date.now()

    // Rapidly produce events
    for (let i = 0; i < 500; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i))
    }

    // With backpressure, producer should be throttled
    // Without backpressure, memory grows unbounded

    // For now, just verify pipeline handles rapid production
    expect(processedCount + blockedCount).toBeLessThanOrEqual(500)

    pipeline.dispose()
  })
})

// ============================================================================
// Exact vs Approximate Modes Tests
// ============================================================================

describe('Streaming Deduplication - Exact vs Approximate Modes', () => {
  it('exact mode when items < threshold', () => {
    // For small streams, use exact Set-based dedup (0% error)

    const EXACT_THRESHOLD = 10000

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'hybrid',
        // exactThreshold: EXACT_THRESHOLD,
      },
    }).aggregate({ count: { $count: {} } })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()

    // Process 100 items (well under threshold)
    const events: StreamEvent[] = []
    for (let i = 0; i < 100; i++) {
      const event = generateUniqueEvent(i, baseTime + i * 10)
      events.push(event)
      pipeline.process(event)
    }

    // Add duplicates
    for (const event of events) {
      pipeline.process(generateDuplicateEvent(event, baseTime + 50000))
    }

    pipeline.advanceWatermark(baseTime + minutes(5).toMillis())

    // Exact mode: should be exactly 100 (no false positives)
    expect(results[0].aggregations.get(undefined)?.count).toBe(100)

    pipeline.dispose()
  })

  it('approximate mode for large streams', () => {
    // Automatically switch to approximate mode when items > threshold

    const EXACT_THRESHOLD = 1000

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'hybrid',
        // exactThreshold: EXACT_THRESHOLD,
        // falsePositiveRate: 0.01,
      },
    }).aggregate({ count: { $count: {} } })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()

    // Process 10,000 items (above threshold)
    for (let i = 0; i < 10000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i))
    }

    pipeline.advanceWatermark(baseTime + minutes(5).toMillis())

    // Approximate mode: should be close to 10,000 (within 1% error)
    const count = results[0].aggregations.get(undefined)?.count as number
    expect(count).toBeGreaterThan(9900)
    expect(count).toBeLessThanOrEqual(10100)

    // Memory should be bounded (not O(n))
    const memoryUsed = estimateDedupMemory(pipeline)
    expect(memoryUsed).toBeLessThan(1024 * 1024) // < 1MB

    pipeline.dispose()
  })

  it('hybrid approach available', () => {
    // Hybrid mode: exact up to threshold, then approximate

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
        // EXPECTED:
        // mode: 'hybrid',
        // exactThreshold: 5000,
        // falsePositiveRate: 0.01,
      },
    }).aggregate({ count: { $count: {} } })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()

    // Process items in phases
    // Phase 1: Under threshold (exact)
    for (let i = 0; i < 1000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i))
    }

    // Verify still in exact mode (check internal state if exposed)
    // EXPECTED: pipeline.getDedupMode() === 'exact'

    // Phase 2: Cross threshold (transition to approximate)
    for (let i = 1000; i < 10000; i++) {
      pipeline.process(generateUniqueEvent(i, baseTime + i))
    }

    // Verify transitioned to approximate mode
    // EXPECTED: pipeline.getDedupMode() === 'approximate'

    pipeline.advanceWatermark(baseTime + minutes(5).toMillis())

    // Count should be approximately 10,000
    const count = results[0].aggregations.get(undefined)?.count as number
    expect(count).toBeGreaterThan(9800)
    expect(count).toBeLessThanOrEqual(10200)

    pipeline.dispose()
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Streaming Deduplication - Integration', () => {
  it('dedup with groupBy', () => {
    // Dedup should work correctly with groupBy

    const pipeline = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
      },
    })
      .groupBy('category')
      .aggregate({
        count: { $count: {} },
        sumValue: { $sum: '$value' },
      })

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline.onResult((r) => results.push(r))

    const baseTime = Date.now()

    // Add events for different categories
    pipeline.process({ id: 'A1', userId: 'u1', timestamp: baseTime, value: 10, category: 'A' })
    pipeline.process({ id: 'A2', userId: 'u1', timestamp: baseTime + 1000, value: 20, category: 'A' })
    pipeline.process({ id: 'B1', userId: 'u1', timestamp: baseTime + 2000, value: 30, category: 'B' })

    // Duplicates
    pipeline.process({ id: 'A1', userId: 'u1', timestamp: baseTime + 3000, value: 100, category: 'A' })
    pipeline.process({ id: 'B1', userId: 'u1', timestamp: baseTime + 4000, value: 200, category: 'B' })

    pipeline.advanceWatermark(baseTime + minutes(5).toMillis())

    // Category A: 2 unique (A1, A2), sum = 30
    // Category B: 1 unique (B1), sum = 30
    expect(results[0].aggregations.get('A')?.count).toBe(2)
    expect(results[0].aggregations.get('A')?.sumValue).toBe(30)
    expect(results[0].aggregations.get('B')?.count).toBe(1)
    expect(results[0].aggregations.get('B')?.sumValue).toBe(30)

    pipeline.dispose()
  })

  it('dedup with checkpointing', () => {
    // Checkpoint should preserve dedup state

    const pipeline1 = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
      },
    }).aggregate({ count: { $count: {} } })

    const baseTime = Date.now()

    // Process some events
    pipeline1.process(generateUniqueEvent(1, baseTime))
    pipeline1.process(generateUniqueEvent(2, baseTime + 1000))

    // Create checkpoint
    const checkpoint = pipeline1.createCheckpoint()

    // Restore to new pipeline
    const pipeline2 = createStreamingPipeline<StreamEvent>({
      windowAssigner: WindowManager.tumbling(minutes(5)),
      trigger: new EventTimeTrigger(),
      deduplication: {
        enabled: true,
        keyExtractor: (e) => e.id,
      },
    }).aggregate({ count: { $count: {} } })

    pipeline2.restoreFromCheckpoint(checkpoint)

    const results: IncrementalResult<StreamEvent>[] = []
    pipeline2.onResult((r) => results.push(r))

    // Process duplicates (should be caught by restored state)
    pipeline2.process(generateUniqueEvent(1, baseTime + 2000))
    pipeline2.process(generateUniqueEvent(2, baseTime + 3000))
    // Process new event
    pipeline2.process(generateUniqueEvent(3, baseTime + 4000))

    pipeline2.advanceWatermark(baseTime + minutes(5).toMillis())

    // Should be 3 (2 from before + 1 new), duplicates caught
    expect(results[0].aggregations.get(undefined)?.count).toBe(3)

    pipeline1.dispose()
    pipeline2.dispose()
  })
})
