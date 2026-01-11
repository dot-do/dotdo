/**
 * Observability tests - Metrics hooks for primitives
 *
 * Tests the metrics instrumentation across all primitives:
 * - TemporalStore: get/set latency, version count gauge
 * - WindowManager: window create/close, late data counter
 * - ExactlyOnceContext: process latency, duplicate counter
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  noopMetrics,
  TestMetricsCollector,
  MetricNames,
  measureLatency,
  measureLatencySync,
} from '../observability'
import { createTemporalStore } from '../temporal-store'
import { WindowManager, EventTimeTrigger, minutes } from '../window-manager'
import { createExactlyOnceContext } from '../exactly-once-context'

// ============================================================================
// OBSERVABILITY MODULE TESTS
// ============================================================================

describe('Observability Module', () => {
  describe('noopMetrics', () => {
    it('should have all required methods', () => {
      expect(noopMetrics.recordLatency).toBeDefined()
      expect(noopMetrics.incrementCounter).toBeDefined()
      expect(noopMetrics.recordGauge).toBeDefined()
    })

    it('should not throw when called', () => {
      expect(() => noopMetrics.recordLatency('test', 100)).not.toThrow()
      expect(() => noopMetrics.incrementCounter('test')).not.toThrow()
      expect(() => noopMetrics.incrementCounter('test', { label: 'value' }, 5)).not.toThrow()
      expect(() => noopMetrics.recordGauge('test', 42)).not.toThrow()
    })
  })

  describe('TestMetricsCollector', () => {
    let collector: TestMetricsCollector

    beforeEach(() => {
      collector = new TestMetricsCollector()
    })

    it('should record latency metrics', () => {
      collector.recordLatency('operation.latency', 100)
      collector.recordLatency('operation.latency', 150)

      const latencies = collector.getLatencies('operation.latency')
      expect(latencies).toEqual([100, 150])
    })

    it('should increment counter metrics', () => {
      collector.incrementCounter('events.processed')
      collector.incrementCounter('events.processed')
      collector.incrementCounter('events.processed', undefined, 3)

      expect(collector.getCounterTotal('events.processed')).toBe(5)
    })

    it('should record gauge metrics', () => {
      collector.recordGauge('queue.size', 10)
      collector.recordGauge('queue.size', 15)
      collector.recordGauge('queue.size', 12)

      expect(collector.getLatestGauge('queue.size')).toBe(12)
    })

    it('should return undefined for non-existent gauge', () => {
      expect(collector.getLatestGauge('nonexistent')).toBeUndefined()
    })

    it('should filter metrics by type', () => {
      collector.recordLatency('op', 100)
      collector.incrementCounter('count')
      collector.recordGauge('gauge', 10)

      expect(collector.getByType('latency')).toHaveLength(1)
      expect(collector.getByType('counter')).toHaveLength(1)
      expect(collector.getByType('gauge')).toHaveLength(1)
    })

    it('should filter metrics by name', () => {
      collector.recordLatency('op1', 100)
      collector.recordLatency('op2', 200)
      collector.recordLatency('op1', 150)

      expect(collector.getByName('op1')).toHaveLength(2)
      expect(collector.getByName('op2')).toHaveLength(1)
    })

    it('should clear all metrics', () => {
      collector.recordLatency('op', 100)
      collector.incrementCounter('count')
      collector.recordGauge('gauge', 10)

      collector.clear()

      expect(collector.metrics).toHaveLength(0)
    })

    it('should preserve labels', () => {
      collector.recordLatency('op', 100, { operation: 'get', key: 'user:1' })
      collector.incrementCounter('count', { status: 'success' })

      const latency = collector.getByName('op')[0]
      expect(latency.labels).toEqual({ operation: 'get', key: 'user:1' })

      const counter = collector.getByName('count')[0]
      expect(counter.labels).toEqual({ status: 'success' })
    })
  })

  describe('measureLatency helper', () => {
    it('should measure async operation latency', async () => {
      const collector = new TestMetricsCollector()

      const result = await measureLatency(collector, 'async.operation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'done'
      })

      expect(result).toBe('done')

      const latencies = collector.getLatencies('async.operation')
      expect(latencies).toHaveLength(1)
      expect(latencies[0]).toBeGreaterThanOrEqual(10)
    })

    it('should record latency even on error', async () => {
      const collector = new TestMetricsCollector()

      await expect(
        measureLatency(collector, 'failing.operation', async () => {
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')

      expect(collector.getLatencies('failing.operation')).toHaveLength(1)
    })
  })

  describe('measureLatencySync helper', () => {
    it('should measure sync operation latency', () => {
      const collector = new TestMetricsCollector()

      const result = measureLatencySync(collector, 'sync.operation', () => {
        let sum = 0
        for (let i = 0; i < 1000; i++) sum += i
        return sum
      })

      expect(result).toBe(499500)

      const latencies = collector.getLatencies('sync.operation')
      expect(latencies).toHaveLength(1)
      expect(latencies[0]).toBeGreaterThanOrEqual(0)
    })

    it('should record latency even on error', () => {
      const collector = new TestMetricsCollector()

      expect(() =>
        measureLatencySync(collector, 'failing.operation', () => {
          throw new Error('Test error')
        })
      ).toThrow('Test error')

      expect(collector.getLatencies('failing.operation')).toHaveLength(1)
    })
  })
})

// ============================================================================
// TEMPORAL STORE METRICS TESTS
// ============================================================================

describe('TemporalStore Metrics', () => {
  let collector: TestMetricsCollector

  beforeEach(() => {
    collector = new TestMetricsCollector()
  })

  it('should record put latency', async () => {
    const store = createTemporalStore({ metrics: collector })

    await store.put('key', { value: 1 }, Date.now())

    const latencies = collector.getLatencies(MetricNames.TEMPORAL_STORE_PUT_LATENCY)
    expect(latencies).toHaveLength(1)
    expect(latencies[0]).toBeGreaterThanOrEqual(0)
  })

  it('should record get latency', async () => {
    const store = createTemporalStore({ metrics: collector })

    await store.put('key', { value: 1 }, Date.now())
    await store.get('key')

    const latencies = collector.getLatencies(MetricNames.TEMPORAL_STORE_GET_LATENCY)
    expect(latencies).toHaveLength(1)
    expect(latencies[0]).toBeGreaterThanOrEqual(0)
  })

  it('should record getAsOf latency', async () => {
    const store = createTemporalStore({ metrics: collector })
    const timestamp = Date.now()

    await store.put('key', { value: 1 }, timestamp)
    await store.getAsOf('key', timestamp)

    const latencies = collector.getLatencies(MetricNames.TEMPORAL_STORE_GET_AS_OF_LATENCY)
    expect(latencies).toHaveLength(1)
  })

  it('should record version count gauge', async () => {
    const store = createTemporalStore({ metrics: collector })
    const now = Date.now()

    await store.put('key', { value: 1 }, now - 2000)
    await store.put('key', { value: 2 }, now - 1000)
    await store.put('key', { value: 3 }, now)

    const gauges = collector.getByName(MetricNames.TEMPORAL_STORE_VERSION_COUNT)
    expect(gauges).toHaveLength(3)
    // Latest gauge should show 3 versions
    expect(collector.getLatestGauge(MetricNames.TEMPORAL_STORE_VERSION_COUNT)).toBe(3)
  })

  it('should record key count gauge', async () => {
    const store = createTemporalStore({ metrics: collector })
    const now = Date.now()

    await store.put('key1', { value: 1 }, now)
    await store.put('key2', { value: 2 }, now)
    await store.put('key3', { value: 3 }, now)

    expect(collector.getLatestGauge(MetricNames.TEMPORAL_STORE_KEY_COUNT)).toBe(3)
  })

  it('should record snapshot latency', async () => {
    const store = createTemporalStore({ metrics: collector })

    await store.put('key', { value: 1 }, Date.now())
    await store.snapshot()

    const latencies = collector.getLatencies(MetricNames.TEMPORAL_STORE_SNAPSHOT_LATENCY)
    expect(latencies).toHaveLength(1)
  })

  it('should record snapshot count gauge', async () => {
    const store = createTemporalStore({ metrics: collector })

    await store.put('key', { value: 1 }, Date.now())
    await store.snapshot()
    await store.snapshot()
    await store.snapshot()

    expect(collector.getLatestGauge(MetricNames.TEMPORAL_STORE_SNAPSHOT_COUNT)).toBe(3)
  })

  it('should record restore latency', async () => {
    const store = createTemporalStore({ metrics: collector })

    await store.put('key', { value: 1 }, Date.now())
    const snapshotId = await store.snapshot()
    await store.restoreSnapshot(snapshotId)

    const latencies = collector.getLatencies(MetricNames.TEMPORAL_STORE_RESTORE_LATENCY)
    expect(latencies).toHaveLength(1)
  })

  it('should record prune latency and versions pruned', async () => {
    const store = createTemporalStore({ metrics: collector })
    const now = Date.now()

    // Add 10 versions
    for (let i = 0; i < 10; i++) {
      await store.put('key', { value: i }, now - 10000 + i * 100)
    }

    // Clear collector to focus on prune metrics
    collector.clear()

    // Prune to keep only 3 versions
    await store.prune({ maxVersions: 3 })

    const latencies = collector.getLatencies(MetricNames.TEMPORAL_STORE_PRUNE_LATENCY)
    expect(latencies).toHaveLength(1)

    const versionsPruned = collector.getCounterTotal(MetricNames.TEMPORAL_STORE_VERSIONS_PRUNED)
    expect(versionsPruned).toBe(7)
  })

  it('should work without metrics (noopMetrics)', async () => {
    const store = createTemporalStore()

    // Should not throw
    await store.put('key', { value: 1 }, Date.now())
    await store.get('key')
    await store.getAsOf('key', Date.now())
    await store.snapshot()
  })
})

// ============================================================================
// WINDOW MANAGER METRICS TESTS
// ============================================================================

describe('WindowManager Metrics', () => {
  let collector: TestMetricsCollector

  beforeEach(() => {
    collector = new TestMetricsCollector()
  })

  it('should record process latency', () => {
    const wm = new WindowManager(WindowManager.tumbling(minutes(5)), { metrics: collector })
    wm.withTrigger(new EventTimeTrigger())

    wm.process({ id: 1 }, Date.now())

    const latencies = collector.getLatencies(MetricNames.WINDOW_MANAGER_PROCESS_LATENCY)
    expect(latencies).toHaveLength(1)
    expect(latencies[0]).toBeGreaterThanOrEqual(0)
  })

  it('should record window created counter', () => {
    const wm = new WindowManager(WindowManager.tumbling(minutes(5)), { metrics: collector })
    wm.withTrigger(new EventTimeTrigger())

    const now = Date.now()
    wm.process({ id: 1 }, now)
    wm.process({ id: 2 }, now + 10 * 60 * 1000) // Different window

    const created = collector.getCounterTotal(MetricNames.WINDOW_MANAGER_WINDOW_CREATED)
    expect(created).toBe(2)
  })

  it('should record elements processed counter', () => {
    const wm = new WindowManager(WindowManager.tumbling(minutes(5)), { metrics: collector })
    wm.withTrigger(new EventTimeTrigger())

    const now = Date.now()
    wm.process({ id: 1 }, now)
    wm.process({ id: 2 }, now + 1000)
    wm.process({ id: 3 }, now + 2000)

    const processed = collector.getCounterTotal(MetricNames.WINDOW_MANAGER_ELEMENTS_PROCESSED)
    expect(processed).toBe(3)
  })

  it('should record active windows gauge', () => {
    const wm = new WindowManager(WindowManager.tumbling(minutes(5)), { metrics: collector })
    wm.withTrigger(new EventTimeTrigger())

    const now = Date.now()
    wm.process({ id: 1 }, now)
    wm.process({ id: 2 }, now + 10 * 60 * 1000) // Different window

    expect(collector.getLatestGauge(MetricNames.WINDOW_MANAGER_ACTIVE_WINDOWS)).toBe(2)
  })

  it('should record late data counter', () => {
    const wm = new WindowManager(WindowManager.tumbling(minutes(5)), { metrics: collector })
    wm.withTrigger(new EventTimeTrigger())

    const now = Date.now()

    // Process element in current window
    wm.process({ id: 1 }, now)

    // Advance watermark past window end
    wm.advanceWatermark(now + 10 * 60 * 1000)

    // Try to process element for old window (late data)
    wm.process({ id: 2 }, now - 10 * 60 * 1000)

    const lateData = collector.getCounterTotal(MetricNames.WINDOW_MANAGER_LATE_DATA)
    expect(lateData).toBeGreaterThan(0)
  })

  it('should record window triggered counter', () => {
    const wm = new WindowManager(WindowManager.tumbling(minutes(5)), { metrics: collector })
    wm.withTrigger(new EventTimeTrigger())

    const now = Date.now()
    const windowStart = Math.floor(now / (5 * 60 * 1000)) * (5 * 60 * 1000)

    // Process element to create window
    wm.process({ id: 1 }, windowStart + 1000)

    // Advance watermark past window end
    wm.advanceWatermark(windowStart + 5 * 60 * 1000 + 1)

    const triggered = collector.getCounterTotal(MetricNames.WINDOW_MANAGER_WINDOW_TRIGGERED)
    expect(triggered).toBe(1)
  })

  it('should record advanceWatermark latency', () => {
    const wm = new WindowManager(WindowManager.tumbling(minutes(5)), { metrics: collector })
    wm.withTrigger(new EventTimeTrigger())

    wm.process({ id: 1 }, Date.now())
    wm.advanceWatermark(Date.now() + 10 * 60 * 1000)

    const latencies = collector.getLatencies(MetricNames.WINDOW_MANAGER_ADVANCE_WATERMARK_LATENCY)
    expect(latencies).toHaveLength(1)
  })

  it('should record window closed counter', () => {
    const wm = new WindowManager(WindowManager.tumbling(minutes(5)), { metrics: collector })
    wm.withTrigger(new EventTimeTrigger())

    const now = Date.now()
    const windowStart = Math.floor(now / (5 * 60 * 1000)) * (5 * 60 * 1000)

    // Process element to create window
    wm.process({ id: 1 }, windowStart + 1000)

    // Advance watermark past window end to trigger
    wm.advanceWatermark(windowStart + 5 * 60 * 1000 + 1)

    // Advance watermark further to close window (past allowed lateness)
    wm.advanceWatermark(windowStart + 10 * 60 * 1000)

    const closed = collector.getCounterTotal(MetricNames.WINDOW_MANAGER_WINDOW_CLOSED)
    expect(closed).toBe(1)
  })

  it('should work without metrics (noopMetrics)', () => {
    const wm = new WindowManager(WindowManager.tumbling(minutes(5)))
    wm.withTrigger(new EventTimeTrigger())

    // Should not throw
    const now = Date.now()
    wm.process({ id: 1 }, now)
    wm.advanceWatermark(now + 10 * 60 * 1000)
  })
})

// ============================================================================
// EXACTLY ONCE CONTEXT METRICS TESTS
// ============================================================================

describe('ExactlyOnceContext Metrics', () => {
  let collector: TestMetricsCollector

  beforeEach(() => {
    collector = new TestMetricsCollector()
  })

  it('should record processOnce latency', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    await ctx.processOnce('event-1', async () => 'result')

    const latencies = collector.getLatencies(MetricNames.EXACTLY_ONCE_PROCESS_LATENCY)
    expect(latencies).toHaveLength(1)
    expect(latencies[0]).toBeGreaterThanOrEqual(0)
  })

  it('should record processed counter', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    await ctx.processOnce('event-1', async () => 'result')
    await ctx.processOnce('event-2', async () => 'result')
    await ctx.processOnce('event-3', async () => 'result')

    const processed = collector.getCounterTotal(MetricNames.EXACTLY_ONCE_PROCESSED)
    expect(processed).toBe(3)
  })

  it('should record duplicate counter', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    await ctx.processOnce('event-1', async () => 'result')
    await ctx.processOnce('event-1', async () => 'should not run') // Duplicate
    await ctx.processOnce('event-1', async () => 'should not run') // Duplicate

    const duplicates = collector.getCounterTotal(MetricNames.EXACTLY_ONCE_DUPLICATES)
    expect(duplicates).toBe(2)
  })

  it('should record processed IDs gauge', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    await ctx.processOnce('event-1', async () => 'result')
    await ctx.processOnce('event-2', async () => 'result')

    expect(collector.getLatestGauge(MetricNames.EXACTLY_ONCE_PROCESSED_IDS)).toBe(2)
  })

  it('should record transaction latency', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    await ctx.transaction(async (tx) => {
      await tx.put('key', 'value')
      return 'done'
    })

    const latencies = collector.getLatencies(MetricNames.EXACTLY_ONCE_TRANSACTION_LATENCY)
    expect(latencies).toHaveLength(1)
  })

  it('should record transactions counter', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    await ctx.transaction(async (tx) => {
      await tx.put('key', 'value')
    })
    await ctx.transaction(async (tx) => {
      await tx.put('key2', 'value2')
    })

    const transactions = collector.getCounterTotal(MetricNames.EXACTLY_ONCE_TRANSACTIONS)
    expect(transactions).toBe(2)
  })

  it('should record transaction rollback counter', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    await expect(
      ctx.transaction(async (tx) => {
        await tx.put('key', 'value')
        throw new Error('Rollback test')
      })
    ).rejects.toThrow('Rollback test')

    const rollbacks = collector.getCounterTotal(MetricNames.EXACTLY_ONCE_TRANSACTION_ROLLBACKS)
    expect(rollbacks).toBe(1)
  })

  it('should record events emitted counter', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    ctx.emit({ type: 'event1' })
    ctx.emit({ type: 'event2' })
    ctx.emit({ type: 'event3' })

    const emitted = collector.getCounterTotal(MetricNames.EXACTLY_ONCE_EVENTS_EMITTED)
    expect(emitted).toBe(3)
  })

  it('should record buffered events gauge', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    ctx.emit({ type: 'event1' })
    ctx.emit({ type: 'event2' })

    expect(collector.getLatestGauge(MetricNames.EXACTLY_ONCE_BUFFERED_EVENTS)).toBe(2)

    await ctx.flush()

    expect(collector.getLatestGauge(MetricNames.EXACTLY_ONCE_BUFFERED_EVENTS)).toBe(0)
  })

  it('should record flush latency', async () => {
    const ctx = createExactlyOnceContext({ metrics: collector })

    ctx.emit({ type: 'event1' })
    await ctx.flush()

    const latencies = collector.getLatencies(MetricNames.EXACTLY_ONCE_FLUSH_LATENCY)
    expect(latencies).toHaveLength(1)
  })

  it('should record events delivered counter', async () => {
    const delivered: unknown[] = []
    const ctx = createExactlyOnceContext({
      metrics: collector,
      onDeliver: async (events) => {
        delivered.push(...events)
      },
    })

    ctx.emit({ type: 'event1' })
    ctx.emit({ type: 'event2' })
    await ctx.flush()

    const deliveredCount = collector.getCounterTotal(MetricNames.EXACTLY_ONCE_EVENTS_DELIVERED)
    expect(deliveredCount).toBe(2)
  })

  it('should work without metrics (noopMetrics)', async () => {
    const ctx = createExactlyOnceContext()

    // Should not throw
    await ctx.processOnce('event-1', async () => 'result')
    await ctx.transaction(async (tx) => {
      await tx.put('key', 'value')
    })
    ctx.emit({ type: 'event' })
    await ctx.flush()
  })
})

// ============================================================================
// ZERO OVERHEAD VERIFICATION
// ============================================================================

describe('Zero Overhead with noopMetrics', () => {
  it('TemporalStore should have minimal overhead without metrics', async () => {
    const storeWithMetrics = createTemporalStore({ metrics: new TestMetricsCollector() })
    const storeWithoutMetrics = createTemporalStore()

    const iterations = 100

    // Warm up
    for (let i = 0; i < 10; i++) {
      await storeWithMetrics.put(`warmup-${i}`, { value: i }, Date.now())
      await storeWithoutMetrics.put(`warmup-${i}`, { value: i }, Date.now())
    }

    // Time with metrics
    const startWithMetrics = performance.now()
    for (let i = 0; i < iterations; i++) {
      await storeWithMetrics.put(`key-${i}`, { value: i }, Date.now())
      await storeWithMetrics.get(`key-${i}`)
    }
    const timeWithMetrics = performance.now() - startWithMetrics

    // Time without metrics
    const startWithoutMetrics = performance.now()
    for (let i = 0; i < iterations; i++) {
      await storeWithoutMetrics.put(`key-${i}`, { value: i }, Date.now())
      await storeWithoutMetrics.get(`key-${i}`)
    }
    const timeWithoutMetrics = performance.now() - startWithoutMetrics

    // noopMetrics should have very minimal overhead (less than 2x slower)
    // In practice, it should be nearly identical
    expect(timeWithoutMetrics).toBeLessThan(timeWithMetrics * 2 + 10)
  })

  it('ExactlyOnceContext should have minimal overhead without metrics', async () => {
    const ctxWithMetrics = createExactlyOnceContext({ metrics: new TestMetricsCollector() })
    const ctxWithoutMetrics = createExactlyOnceContext()

    const iterations = 100

    // Time with metrics
    const startWithMetrics = performance.now()
    for (let i = 0; i < iterations; i++) {
      await ctxWithMetrics.processOnce(`event-m-${i}`, async () => i)
    }
    const timeWithMetrics = performance.now() - startWithMetrics

    // Time without metrics
    const startWithoutMetrics = performance.now()
    for (let i = 0; i < iterations; i++) {
      await ctxWithoutMetrics.processOnce(`event-${i}`, async () => i)
    }
    const timeWithoutMetrics = performance.now() - startWithoutMetrics

    // noopMetrics should have very minimal overhead
    expect(timeWithoutMetrics).toBeLessThan(timeWithMetrics * 2 + 10)
  })
})
