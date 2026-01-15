/**
 * Unified Events Ingestion Benchmarks
 *
 * Wave 5: Performance & Scalability - Task 4 (do-8zzy, do-eokt)
 *
 * Benchmarks for unified event ingestion performance:
 * - Single event storage latency
 * - Batch event storage throughput
 * - Event query performance
 * - Hot path optimization verification
 *
 * Target: Sub-10ms p50 for single events, >1000 events/sec batch throughput
 *
 * @module tests/benchmarks/unified-events/ingestion.bench
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { UnifiedEvent, EventType } from '../../../types/unified-event'

// ============================================================================
// MOCK EVENT STREAM FOR LOCAL BENCHMARKING
// ============================================================================

/**
 * Simple in-memory event store for benchmarking event operations.
 * This allows us to run benchmarks locally without requiring deployed infrastructure.
 */
class MockEventStore {
  private events: Map<string, UnifiedEvent> = new Map()
  private byTraceId: Map<string, Set<string>> = new Map()
  private bySessionId: Map<string, Set<string>> = new Map()
  private byType: Map<string, Set<string>> = new Map()

  /**
   * Store a single event
   */
  store(event: UnifiedEvent): void {
    this.events.set(event.id, event)

    // Index by trace_id
    if (event.trace_id) {
      if (!this.byTraceId.has(event.trace_id)) {
        this.byTraceId.set(event.trace_id, new Set())
      }
      this.byTraceId.get(event.trace_id)!.add(event.id)
    }

    // Index by session_id
    if (event.session_id) {
      if (!this.bySessionId.has(event.session_id)) {
        this.bySessionId.set(event.session_id, new Set())
      }
      this.bySessionId.get(event.session_id)!.add(event.id)
    }

    // Index by event_type
    if (!this.byType.has(event.event_type)) {
      this.byType.set(event.event_type, new Set())
    }
    this.byType.get(event.event_type)!.add(event.id)
  }

  /**
   * Store multiple events in batch
   */
  storeBatch(events: UnifiedEvent[]): void {
    for (const event of events) {
      this.store(event)
    }
  }

  /**
   * Query events by trace_id
   */
  queryByTraceId(traceId: string): UnifiedEvent[] {
    const ids = this.byTraceId.get(traceId)
    if (!ids) return []
    return Array.from(ids).map((id) => this.events.get(id)!).filter(Boolean)
  }

  /**
   * Query events by session_id
   */
  queryBySessionId(sessionId: string): UnifiedEvent[] {
    const ids = this.bySessionId.get(sessionId)
    if (!ids) return []
    return Array.from(ids).map((id) => this.events.get(id)!).filter(Boolean)
  }

  /**
   * Query events by type
   */
  queryByType(eventType: string, limit: number = 100): UnifiedEvent[] {
    const ids = this.byType.get(eventType)
    if (!ids) return []
    return Array.from(ids)
      .slice(0, limit)
      .map((id) => this.events.get(id)!)
      .filter(Boolean)
  }

  /**
   * Get event count
   */
  get size(): number {
    return this.events.size
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events.clear()
    this.byTraceId.clear()
    this.bySessionId.clear()
    this.byType.clear()
  }
}

// ============================================================================
// BENCHMARK HELPERS
// ============================================================================

/**
 * Generate a random unified event
 */
function generateEvent(index: number, traceId?: string, sessionId?: string): UnifiedEvent {
  const eventTypes: EventType[] = ['span', 'log', 'metric', 'vital', 'business', 'system']
  const eventType = eventTypes[index % eventTypes.length]!

  return {
    id: `evt-${Date.now()}-${index}`,
    event_type: eventType,
    event_name: `test-event-${eventType}`,
    ns: 'benchmark-tenant',
    timestamp: new Date().toISOString(),
    trace_id: traceId ?? `trace-${Math.floor(index / 10)}`,
    span_id: `span-${index}`,
    session_id: sessionId ?? `session-${Math.floor(index / 100)}`,
    correlation_id: `corr-${index}`,
    service_name: 'benchmark-service',
    data: {
      index,
      payload: `Event payload for index ${index}`,
      metadata: { generated: true },
    },
  }
}

/**
 * Run a timed operation and return duration in ms
 */
function timed<T>(fn: () => T): { result: T; durationMs: number } {
  const start = performance.now()
  const result = fn()
  const durationMs = performance.now() - start
  return { result, durationMs }
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  const idx = Math.floor(sorted.length * p)
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0
}

/**
 * Calculate statistics from samples
 */
function calculateStats(samples: number[]): {
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  p99: number
} {
  if (samples.length === 0) {
    return { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  }
}

// ============================================================================
// BENCHMARKS
// ============================================================================

describe('Unified Events Ingestion Benchmarks', () => {
  let store: MockEventStore

  beforeEach(() => {
    store = new MockEventStore()
  })

  afterEach(() => {
    store.clear()
  })

  describe('Single Event Storage', () => {
    it('measures single event store latency', () => {
      const iterations = 1000
      const samples: number[] = []

      // Warmup
      for (let i = 0; i < 100; i++) {
        store.store(generateEvent(i))
      }
      store.clear()

      // Benchmark
      for (let i = 0; i < iterations; i++) {
        const event = generateEvent(i)
        const { durationMs } = timed(() => store.store(event))
        samples.push(durationMs)
      }

      const stats = calculateStats(samples)

      console.log('Single Event Store Latency:')
      console.log(`  Iterations: ${iterations}`)
      console.log(`  p50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  p95: ${stats.p95.toFixed(3)}ms`)
      console.log(`  p99: ${stats.p99.toFixed(3)}ms`)
      console.log(`  mean: ${stats.mean.toFixed(3)}ms`)

      // Target: Sub-1ms for in-memory operations
      expect(stats.p50).toBeLessThan(1)
      expect(stats.p99).toBeLessThan(5)
    })

    it('verifies indexing overhead is acceptable', () => {
      const iterations = 500
      const samplesWithIndex: number[] = []
      const samplesWithoutIndex: number[] = []

      // With full indexing (trace_id, session_id, event_type)
      for (let i = 0; i < iterations; i++) {
        const event = generateEvent(i, `trace-${i % 10}`, `session-${i % 5}`)
        const { durationMs } = timed(() => store.store(event))
        samplesWithIndex.push(durationMs)
      }

      store.clear()

      // Without indexing (minimal event)
      const minimalStore = new MockEventStore()
      for (let i = 0; i < iterations; i++) {
        const event: UnifiedEvent = {
          id: `evt-${i}`,
          event_type: 'log',
          event_name: 'minimal',
          ns: 'test',
          timestamp: new Date().toISOString(),
        }
        const { durationMs } = timed(() => minimalStore.store(event))
        samplesWithoutIndex.push(durationMs)
      }

      const statsWithIndex = calculateStats(samplesWithIndex)
      const statsWithoutIndex = calculateStats(samplesWithoutIndex)

      console.log('Indexing Overhead:')
      console.log(`  With indexing p50: ${statsWithIndex.p50.toFixed(3)}ms`)
      console.log(`  Without indexing p50: ${statsWithoutIndex.p50.toFixed(3)}ms`)
      console.log(`  Overhead ratio: ${(statsWithIndex.mean / statsWithoutIndex.mean).toFixed(2)}x`)

      // Indexing should add less than 3x overhead
      expect(statsWithIndex.mean).toBeLessThan(statsWithoutIndex.mean * 3)
    })
  })

  describe('Batch Event Storage', () => {
    it('measures batch store throughput (100 events)', () => {
      const batchSize = 100
      const iterations = 50
      const samples: number[] = []

      // Warmup
      store.storeBatch(Array.from({ length: 100 }, (_, i) => generateEvent(i)))
      store.clear()

      // Benchmark
      for (let iter = 0; iter < iterations; iter++) {
        const events = Array.from({ length: batchSize }, (_, i) => generateEvent(iter * batchSize + i))
        const { durationMs } = timed(() => store.storeBatch(events))
        samples.push(durationMs)
      }

      const stats = calculateStats(samples)
      const eventsPerSecond = (batchSize * 1000) / stats.mean

      console.log(`Batch Store (${batchSize} events):`)
      console.log(`  Iterations: ${iterations}`)
      console.log(`  p50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  p95: ${stats.p95.toFixed(3)}ms`)
      console.log(`  mean: ${stats.mean.toFixed(3)}ms`)
      console.log(`  Throughput: ${eventsPerSecond.toFixed(0)} events/sec`)

      // Target: >10,000 events/sec for in-memory batch operations
      expect(eventsPerSecond).toBeGreaterThan(10000)
    })

    it('measures batch store throughput (1000 events)', () => {
      const batchSize = 1000
      const iterations = 20
      const samples: number[] = []

      // Warmup
      store.storeBatch(Array.from({ length: 500 }, (_, i) => generateEvent(i)))
      store.clear()

      // Benchmark
      for (let iter = 0; iter < iterations; iter++) {
        const events = Array.from({ length: batchSize }, (_, i) => generateEvent(iter * batchSize + i))
        const { durationMs } = timed(() => store.storeBatch(events))
        samples.push(durationMs)
      }

      const stats = calculateStats(samples)
      const eventsPerSecond = (batchSize * 1000) / stats.mean

      console.log(`Batch Store (${batchSize} events):`)
      console.log(`  Iterations: ${iterations}`)
      console.log(`  p50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  p95: ${stats.p95.toFixed(3)}ms`)
      console.log(`  mean: ${stats.mean.toFixed(3)}ms`)
      console.log(`  Throughput: ${eventsPerSecond.toFixed(0)} events/sec`)

      // Target: >5,000 events/sec for larger batches
      expect(eventsPerSecond).toBeGreaterThan(5000)
    })

    it('compares batch vs individual store performance', () => {
      const eventCount = 500
      const events = Array.from({ length: eventCount }, (_, i) => generateEvent(i))

      // Individual stores
      store.clear()
      const { durationMs: individualDuration } = timed(() => {
        for (const event of events) {
          store.store(event)
        }
      })

      // Batch store
      store.clear()
      const { durationMs: batchDuration } = timed(() => {
        store.storeBatch(events)
      })

      const batchSpeedup = individualDuration / batchDuration

      console.log('Batch vs Individual Store:')
      console.log(`  Individual: ${individualDuration.toFixed(3)}ms for ${eventCount} events`)
      console.log(`  Batch: ${batchDuration.toFixed(3)}ms for ${eventCount} events`)
      console.log(`  Batch speedup: ${batchSpeedup.toFixed(2)}x`)

      // Note: In-memory, batch may not be significantly faster
      // Real improvement comes from reduced DB transactions
      expect(batchDuration).toBeLessThanOrEqual(individualDuration * 1.5)
    })
  })

  describe('Event Query Performance', () => {
    beforeEach(() => {
      // Pre-populate store with events
      const events = Array.from({ length: 10000 }, (_, i) => generateEvent(i))
      store.storeBatch(events)
    })

    it('measures trace_id query latency', () => {
      const iterations = 100
      const samples: number[] = []

      for (let i = 0; i < iterations; i++) {
        const traceId = `trace-${i % 1000}`
        const { durationMs } = timed(() => store.queryByTraceId(traceId))
        samples.push(durationMs)
      }

      const stats = calculateStats(samples)

      console.log('Query by trace_id:')
      console.log(`  p50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  p95: ${stats.p95.toFixed(3)}ms`)

      // Target: Sub-1ms for indexed lookups
      expect(stats.p50).toBeLessThan(1)
    })

    it('measures session_id query latency', () => {
      const iterations = 100
      const samples: number[] = []

      for (let i = 0; i < iterations; i++) {
        const sessionId = `session-${i % 100}`
        const { durationMs } = timed(() => store.queryBySessionId(sessionId))
        samples.push(durationMs)
      }

      const stats = calculateStats(samples)

      console.log('Query by session_id:')
      console.log(`  p50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  p95: ${stats.p95.toFixed(3)}ms`)

      expect(stats.p50).toBeLessThan(1)
    })

    it('measures event_type query latency', () => {
      const iterations = 100
      const samples: number[] = []
      const eventTypes = ['span', 'log', 'metric', 'vital', 'business', 'system']

      for (let i = 0; i < iterations; i++) {
        const eventType = eventTypes[i % eventTypes.length]!
        const { durationMs } = timed(() => store.queryByType(eventType, 100))
        samples.push(durationMs)
      }

      const stats = calculateStats(samples)

      console.log('Query by event_type:')
      console.log(`  p50: ${stats.p50.toFixed(3)}ms`)
      console.log(`  p95: ${stats.p95.toFixed(3)}ms`)

      expect(stats.p50).toBeLessThan(2)
    })
  })

  describe('Memory Efficiency', () => {
    it('tracks memory usage for 10k events', () => {
      // Force GC if available
      if (global.gc) {
        global.gc()
      }

      const memBefore = process.memoryUsage().heapUsed
      const eventCount = 10000

      const events = Array.from({ length: eventCount }, (_, i) => generateEvent(i))
      store.storeBatch(events)

      const memAfter = process.memoryUsage().heapUsed
      const memPerEvent = (memAfter - memBefore) / eventCount

      console.log(`Memory for ${eventCount} events:`)
      console.log(`  Total: ${((memAfter - memBefore) / 1024 / 1024).toFixed(2)} MB`)
      console.log(`  Per event: ${memPerEvent.toFixed(0)} bytes`)

      // Target: Less than 5KB per event (including indexes)
      expect(memPerEvent).toBeLessThan(5 * 1024)
    })
  })
})

describe('Benchmark Summary', () => {
  it('prints benchmark summary', () => {
    console.log('\n=== Unified Events Ingestion Benchmark Summary ===')
    console.log('Targets:')
    console.log('  - Single event store: <1ms p50, <5ms p99')
    console.log('  - Batch store (100): >10,000 events/sec')
    console.log('  - Batch store (1000): >5,000 events/sec')
    console.log('  - Query by index: <1ms p50')
    console.log('  - Memory per event: <5KB')
    console.log('================================================\n')
    expect(true).toBe(true)
  })
})
