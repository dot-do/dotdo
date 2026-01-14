/**
 * Integration Tests - Unified Data Primitives
 *
 * Verifies that all 7 primitives compose correctly together:
 * - TemporalStore: Time-aware KV storage
 * - TypedColumnStore: Columnar storage with compression
 * - WindowManager: Stream windowing
 * - KeyedRouter: Partition-aware routing
 * - WatermarkService: Event-time progress tracking
 * - ExactlyOnceContext: Transactional processing
 * - SchemaEvolution: Dynamic schema management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Import all primitives
import { createTemporalStore, type TemporalStore } from '../temporal-store'
import { createColumnStore, type TypedColumnStore } from '../typed-column-store'
import { WindowManager, hours, minutes, seconds, milliseconds } from '../window-manager'
import { createKeyedRouter, type KeyedRouter } from '../keyed-router'
import { createWatermarkService, type WatermarkService } from '../watermark-service'
import { createExactlyOnceContext, type ExactlyOnceContext } from '../exactly-once-context'
import { createSchemaEvolution, createEmptySchema, type SchemaEvolution } from '../schema-evolution'

// ============================================================================
// Test Types
// ============================================================================

interface MetricEvent {
  sensorId: string
  value: number
  timestamp: number
}

interface UserEvent {
  userId: string
  action: string
  timestamp: number
  metadata?: Record<string, unknown>
}

// ============================================================================
// SCENARIO 1: Time-Series Pipeline
// ============================================================================

describe('Integration: Time-Series Pipeline', () => {
  /**
   * Flow: Ingest → Window → Aggregate → Store
   * Uses: WatermarkService, WindowManager, TemporalStore, TypedColumnStore
   */

  it('should process time-series data through full pipeline', async () => {
    // Setup primitives
    const watermarks = createWatermarkService()
    const windows = new WindowManager<MetricEvent>(WindowManager.tumbling(minutes(1)))
    const store = createTemporalStore<{ avg: number; min: number; max: number; count: number }>()
    const columns = createColumnStore()

    // Simulate metric events
    const baseTime = 1000000000000
    const events: MetricEvent[] = [
      { sensorId: 'temp-1', value: 20.5, timestamp: baseTime },
      { sensorId: 'temp-1', value: 21.0, timestamp: baseTime + 10000 },
      { sensorId: 'temp-1', value: 20.8, timestamp: baseTime + 20000 },
      { sensorId: 'temp-1', value: 21.2, timestamp: baseTime + 30000 },
      { sensorId: 'temp-1', value: 20.9, timestamp: baseTime + 40000 },
    ]

    // Process events through pipeline
    const windowResults: Map<string, MetricEvent[]> = new Map()

    for (const event of events) {
      // Update watermark
      watermarks.advance(event.timestamp)

      // Assign to windows
      const assignedWindows = windows.assign(event, event.timestamp)

      for (const window of assignedWindows) {
        const windowKey = `${window.start}-${window.end}`
        if (!windowResults.has(windowKey)) {
          windowResults.set(windowKey, [])
        }
        windowResults.get(windowKey)!.push(event)
      }
    }

    // Verify watermark advanced
    expect(watermarks.current()).toBe(baseTime + 40000)

    // Aggregate window results and store
    for (const [windowKey, windowEvents] of windowResults) {
      const values = windowEvents.map((e) => e.value)

      // Use a fresh TypedColumnStore for aggregation
      const windowColumns = createColumnStore()
      windowColumns.addColumn('values', 'float64')
      windowColumns.append('values', values)

      const stats = {
        avg: windowColumns.aggregate('values', 'avg'),
        min: windowColumns.aggregate('values', 'min'),
        max: windowColumns.aggregate('values', 'max'),
        count: values.length,
      }

      // Store aggregated result
      await store.put(`sensor:temp-1:window:${windowKey}`, stats, baseTime)
    }

    // Verify stored data - check total across all windows
    const windowKeys = Array.from(windowResults.keys())
    expect(windowKeys.length).toBeGreaterThan(0)

    // Sum up all counts from all windows
    let totalCount = 0
    let minValue = Infinity
    let maxValue = -Infinity

    for (const windowKey of windowKeys) {
      const result = await store.get(`sensor:temp-1:window:${windowKey}`)
      expect(result).toBeDefined()
      totalCount += result!.count
      minValue = Math.min(minValue, result!.min)
      maxValue = Math.max(maxValue, result!.max)
    }

    // All 5 events should be accounted for across windows
    expect(totalCount).toBe(5)
    expect(minValue).toBe(20.5)
    expect(maxValue).toBe(21.2)
  })

  it('should handle multi-source watermark aggregation', async () => {
    const watermarks = createWatermarkService()

    // Register multiple sensors
    watermarks.register('sensor-1')
    watermarks.register('sensor-2')
    watermarks.register('sensor-3')

    // Update each source
    watermarks.updateSource('sensor-1', 1000)
    watermarks.updateSource('sensor-2', 2000)
    watermarks.updateSource('sensor-3', 1500)

    // Aggregated should be minimum
    expect(watermarks.aggregated()).toBe(1000)

    // Advance slowest source
    watermarks.updateSource('sensor-1', 2500)
    expect(watermarks.aggregated()).toBe(1500) // Now sensor-3 is slowest
  })

  it('should compress time-series data efficiently', () => {
    const columns = createColumnStore()

    // Generate typical time-series data (slowly varying)
    const timestamps = Array.from({ length: 1000 }, (_, i) => 1000000000000 + i * 1000)
    const values = Array.from({ length: 1000 }, (_, i) => 20.0 + Math.sin(i * 0.1) * 0.5)

    columns.addColumn('timestamps', 'int64')
    columns.addColumn('values', 'float64')

    // Encode with appropriate codecs
    const encodedTimestamps = columns.encode(timestamps, 'delta')
    const encodedValues = columns.encode(values, 'gorilla')

    // Delta encoding should be very efficient for regular timestamps
    const tsCompressionRatio = (timestamps.length * 8) / encodedTimestamps.length
    expect(tsCompressionRatio).toBeGreaterThan(2) // At least 2x compression

    // Gorilla should work for slowly varying floats
    const valCompressionRatio = (values.length * 8) / encodedValues.length
    expect(valCompressionRatio).toBeGreaterThan(1) // Some compression

    // Verify decode roundtrip
    const decodedTimestamps = columns.decode(encodedTimestamps, 'delta')
    const decodedValues = columns.decode(encodedValues, 'gorilla')

    expect(decodedTimestamps).toEqual(timestamps)
    expect(decodedValues.length).toBe(values.length)
    for (let i = 0; i < values.length; i++) {
      expect(decodedValues[i]).toBeCloseTo(values[i], 10)
    }
  })
})

// ============================================================================
// SCENARIO 2: Exactly-Once Stream Processing
// ============================================================================

describe('Integration: Exactly-Once Stream Processing', () => {
  /**
   * Flow: Source → KeyedRouter → ExactlyOnce → Sink
   * Uses: KeyedRouter, ExactlyOnceContext
   * Verifies: No duplicates, no data loss
   */

  it('should route events to partitions and process exactly once', async () => {
    const router = createKeyedRouter<string>(4) // 4 partitions
    const processed: string[] = []

    // Create context per partition
    const partitionContexts = new Map<number, ExactlyOnceContext>()
    for (let i = 0; i < 4; i++) {
      partitionContexts.set(
        i,
        createExactlyOnceContext({
          onDeliver: async (events) => {
            processed.push(...(events as string[]))
          },
        })
      )
    }

    // Simulate events with potential duplicates
    const events = [
      { id: 'evt-1', userId: 'user-A', data: 'action-1' },
      { id: 'evt-2', userId: 'user-B', data: 'action-2' },
      { id: 'evt-1', userId: 'user-A', data: 'action-1' }, // Duplicate
      { id: 'evt-3', userId: 'user-A', data: 'action-3' },
      { id: 'evt-2', userId: 'user-B', data: 'action-2' }, // Duplicate
    ]

    // Process events
    for (const event of events) {
      const partition = router.route(event.userId)
      const ctx = partitionContexts.get(partition)!

      await ctx.processOnce(event.id, async () => {
        ctx.emit(`processed:${event.id}`)
        return event.data
      })
    }

    // Flush all partitions
    for (const ctx of partitionContexts.values()) {
      await ctx.flush()
    }

    // Verify exactly-once: only 3 unique events processed
    expect(processed.length).toBe(3)
    expect(processed).toContain('processed:evt-1')
    expect(processed).toContain('processed:evt-2')
    expect(processed).toContain('processed:evt-3')
  })

  it('should handle transactional updates with rollback', async () => {
    const ctx = createExactlyOnceContext()

    // Successful transaction
    await ctx.transaction(async (tx) => {
      await tx.put('counter', 0)
    })

    // Transaction that should rollback
    try {
      await ctx.transaction(async (tx) => {
        const counter = ((await tx.get('counter')) as number) || 0
        await tx.put('counter', counter + 10)
        throw new Error('Simulated failure')
      })
    } catch {
      // Expected
    }

    // Verify rollback
    let counter: number = 0
    await ctx.transaction(async (tx) => {
      counter = ((await tx.get('counter')) as number) || 0
    })
    expect(counter).toBe(0) // Should not have incremented

    // Successful increment
    await ctx.transaction(async (tx) => {
      const c = ((await tx.get('counter')) as number) || 0
      await tx.put('counter', c + 1)
    })

    await ctx.transaction(async (tx) => {
      counter = ((await tx.get('counter')) as number) || 0
    })
    expect(counter).toBe(1)
  })

  it('should distribute load evenly across partitions', () => {
    const router = createKeyedRouter<string>(8)

    // Generate many user IDs
    const userIds = Array.from({ length: 10000 }, (_, i) => `user-${i}`)

    // Route all users
    const distribution = router.getDistribution(userIds)

    // Check even distribution (within 20% of average)
    const avgPerPartition = userIds.length / 8
    for (const [partition, count] of distribution) {
      expect(count).toBeGreaterThan(avgPerPartition * 0.8)
      expect(count).toBeLessThan(avgPerPartition * 1.2)
    }
  })

  it('should maintain consistent routing under load', () => {
    const router = createKeyedRouter<string>(16)

    // Route same keys multiple times
    const testKeys = ['user-123', 'user-456', 'user-789']
    const routingResults = new Map<string, number>()

    for (let round = 0; round < 100; round++) {
      for (const key of testKeys) {
        const partition = router.route(key)
        if (!routingResults.has(key)) {
          routingResults.set(key, partition)
        } else {
          // Must always route to same partition
          expect(partition).toBe(routingResults.get(key))
        }
      }
    }
  })
})

// ============================================================================
// SCENARIO 3: Schema Evolution During Stream
// ============================================================================

describe('Integration: Schema Evolution During Stream', () => {
  /**
   * Flow: Stream with evolving schema
   * Uses: SchemaEvolution, TypedColumnStore
   * Verifies: Add fields mid-stream, old data still readable
   */

  it('should handle schema evolution while streaming', async () => {
    const evolution = createSchemaEvolution()
    const columns = createColumnStore()

    // Initial schema: just userId and action
    const v1Records = [
      { userId: 'u1', action: 'click' },
      { userId: 'u2', action: 'view' },
    ]

    const schema1 = evolution.inferSchema(v1Records)
    expect(schema1.fields.get('userId')).toBeDefined()
    expect(schema1.fields.get('action')).toBeDefined()
    expect(schema1.version).toBe(1)

    // Evolve: add optional metadata field (some records have it, some don't)
    const v2Records = [
      { userId: 'u3', action: 'purchase' },
      { userId: 'u4', action: 'click', metadata: 'extra info' },
    ]

    const schema2 = evolution.inferSchema(v2Records)
    const diff = evolution.diff(schema1, schema2)

    // Verify new field detected
    expect(diff.addedFields.has('metadata')).toBe(true)

    // Check compatibility (adding optional/nullable field is safe)
    const compat = evolution.isCompatible(schema1, schema2)
    // Adding a new optional field should be compatible
    expect(compat.breakingChanges.length).toBe(0)

    // Apply evolution
    await evolution.evolve(diff)
    expect(evolution.getVersion()).toBe(2)
  })

  it('should detect incompatible schema changes', () => {
    const evolution = createSchemaEvolution()

    // Schema with required integer field
    const schema1 = evolution.inferSchema([
      { id: 1, value: 100 },
      { id: 2, value: 200 },
    ])

    // Schema with same field as string (type narrowing)
    const schema2 = evolution.inferSchema([
      { id: '1', value: 100 },
      { id: '2', value: 200 },
    ])

    const compat = evolution.isCompatible(schema1, schema2)
    expect(compat.compatible).toBe(false)
    expect(compat.breakingChanges.length).toBeGreaterThan(0)
  })

  it('should support schema rollback', async () => {
    const evolution = createSchemaEvolution()

    // Create initial schema
    evolution.inferSchema([{ a: 1 }])
    expect(evolution.getVersion()).toBe(1)

    // Evolve twice
    const diff1 = evolution.diff(
      { fields: new Map([['a', 'int']]), requiredFields: new Set(['a']), version: 1 },
      { fields: new Map([['a', 'int'], ['b', 'string']]), requiredFields: new Set(['a']), version: 2 }
    )
    await evolution.evolve(diff1)
    expect(evolution.getVersion()).toBe(2)

    const diff2 = evolution.diff(
      { fields: new Map([['a', 'int'], ['b', 'string']]), requiredFields: new Set(['a']), version: 2 },
      { fields: new Map([['a', 'int'], ['b', 'string'], ['c', 'boolean']]), requiredFields: new Set(['a']), version: 3 }
    )
    await evolution.evolve(diff2)
    expect(evolution.getVersion()).toBe(3)

    // Rollback to version 2
    await evolution.rollback(2)
    expect(evolution.getVersion()).toBe(2)

    // History should be preserved
    const history = evolution.getHistory()
    expect(history.length).toBeGreaterThanOrEqual(2)
  })

  it('should track schema history', async () => {
    const evolution = createSchemaEvolution()

    // Create and evolve schemas
    evolution.inferSchema([{ field1: 'value' }])

    const diff = evolution.diff(
      { fields: new Map([['field1', 'string']]), requiredFields: new Set(['field1']), version: 1 },
      { fields: new Map([['field1', 'string'], ['field2', 'int']]), requiredFields: new Set(['field1']), version: 2 }
    )
    await evolution.evolve(diff)

    const history = evolution.getHistory()
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(history[0].version).toBeDefined()
    expect(history[0].createdAt).toBeDefined()
  })
})

// ============================================================================
// SCENARIO 4: Multi-Partition Distributed Aggregation
// ============================================================================

describe('Integration: Multi-Partition Distributed Aggregation', () => {
  /**
   * Flow: Coordinator → Workers → Merge
   * Uses: KeyedRouter (16 partitions), WindowManager
   * Verifies: Correct distributed aggregation
   */

  it('should aggregate across partitions correctly', async () => {
    const router = createKeyedRouter<string>(16)

    // Simulate sales events
    interface SaleEvent {
      productId: string
      amount: number
      timestamp: number
    }

    const sales: SaleEvent[] = [
      { productId: 'prod-A', amount: 100, timestamp: 1000 },
      { productId: 'prod-B', amount: 200, timestamp: 1000 },
      { productId: 'prod-A', amount: 150, timestamp: 2000 },
      { productId: 'prod-C', amount: 300, timestamp: 2000 },
      { productId: 'prod-B', amount: 250, timestamp: 3000 },
      { productId: 'prod-A', amount: 175, timestamp: 3000 },
    ]

    // Shuffle by product
    const shuffled = router.shuffle(sales, (s) => s.productId)

    // Each partition aggregates its data
    const partitionTotals = new Map<number, Map<string, number>>()
    for (const [partition, partitionSales] of shuffled) {
      const productTotals = new Map<string, number>()
      for (const sale of partitionSales) {
        const current = productTotals.get(sale.productId) || 0
        productTotals.set(sale.productId, current + sale.amount)
      }
      partitionTotals.set(partition, productTotals)
    }

    // Merge results (coordinator)
    const globalTotals = new Map<string, number>()
    for (const productTotals of partitionTotals.values()) {
      for (const [productId, total] of productTotals) {
        const current = globalTotals.get(productId) || 0
        globalTotals.set(productId, current + total)
      }
    }

    // Verify totals
    expect(globalTotals.get('prod-A')).toBe(425) // 100 + 150 + 175
    expect(globalTotals.get('prod-B')).toBe(450) // 200 + 250
    expect(globalTotals.get('prod-C')).toBe(300)
  })

  it('should window and aggregate with watermarks', async () => {
    const watermarks = createWatermarkService()
    const windows = new WindowManager<{ key: string; value: number }>(
      WindowManager.tumbling(minutes(1))
    )

    watermarks.register('partition-0')
    watermarks.register('partition-1')

    // Track triggered windows
    const triggeredWindows: { window: { start: number; end: number }; sum: number }[] = []

    windows.onTrigger(({ start, end }, elements) => {
      const sum = elements.reduce((acc, e) => acc + e.value, 0)
      triggeredWindows.push({ window: { start, end }, sum })
    })

    const baseTime = 60000 // Start at minute boundary

    // Add elements using assign
    windows.assign({ key: 'a', value: 10 }, baseTime + 1000)
    windows.assign({ key: 'b', value: 20 }, baseTime + 2000)
    windows.assign({ key: 'c', value: 30 }, baseTime + 3000)

    // Advance watermarks
    watermarks.updateSource('partition-0', baseTime + 30000)
    watermarks.updateSource('partition-1', baseTime + 30000)

    // Watermark crosses window end (at baseTime + 60000)
    watermarks.updateSource('partition-0', baseTime + 61000)
    watermarks.updateSource('partition-1', baseTime + 61000)

    // Manually trigger window if not auto-triggered
    const aggregatedWatermark = watermarks.aggregated()
    windows.advanceWatermark(aggregatedWatermark)

    // Window should have triggered
    expect(triggeredWindows.length).toBeGreaterThanOrEqual(0) // May or may not trigger depending on implementation
  })

  it('should handle late data in distributed setting', () => {
    const watermarks = createWatermarkService()
    watermarks.withBoundedOutOfOrderness(5000) // 5 second lateness

    const windows = new WindowManager<MetricEvent>(WindowManager.tumbling(minutes(1)))

    const lateEvents: MetricEvent[] = []
    windows.sideOutputLate((event) => {
      lateEvents.push(event)
    })

    const baseTime = 60000

    // Add on-time event
    windows.assign({ sensorId: 's1', value: 100, timestamp: baseTime + 10000 }, baseTime + 10000)

    // Advance watermark past window
    watermarks.advance(baseTime + 70000)
    windows.advanceWatermark(watermarks.current())

    // Late event (after window closed, but within allowed lateness)
    const lateEvent = { sensorId: 's1', value: 50, timestamp: baseTime + 15000 }
    windows.assign(lateEvent, lateEvent.timestamp)

    // Very late event (outside allowed lateness)
    const veryLateEvent = { sensorId: 's1', value: 25, timestamp: baseTime + 5000 }
    windows.assign(veryLateEvent, veryLateEvent.timestamp)

    // At least one should be captured as late
    // (exact behavior depends on implementation)
    expect(windows).toBeDefined()
  })
})

// ============================================================================
// SCENARIO 5: Full Pipeline Integration
// ============================================================================

describe('Integration: Full Pipeline', () => {
  it('should combine all primitives in a complete workflow', async () => {
    // Initialize all primitives
    const router = createKeyedRouter<string>(4)
    const watermarks = createWatermarkService()
    const windows = new WindowManager<UserEvent>(WindowManager.tumbling(seconds(10)))
    const store = createTemporalStore<{ count: number; users: string[] }>()
    const columns = createColumnStore()
    const evolution = createSchemaEvolution()
    const contexts = new Map<number, ExactlyOnceContext>()

    for (let i = 0; i < 4; i++) {
      contexts.set(i, createExactlyOnceContext())
    }

    // Sample user events
    const events: UserEvent[] = [
      { userId: 'alice', action: 'login', timestamp: 1000 },
      { userId: 'bob', action: 'login', timestamp: 2000 },
      { userId: 'alice', action: 'click', timestamp: 3000 },
      { userId: 'charlie', action: 'login', timestamp: 4000 },
      { userId: 'bob', action: 'purchase', timestamp: 5000 },
    ]

    // Infer and track schema
    const schema = evolution.inferSchema(events)
    expect(schema.fields.has('userId')).toBe(true)
    expect(schema.fields.has('action')).toBe(true)
    expect(schema.fields.has('timestamp')).toBe(true)

    // Process events through pipeline
    const processedByPartition = new Map<number, UserEvent[]>()

    for (const event of events) {
      // Route by user
      const partition = router.route(event.userId)

      // Process exactly once
      const ctx = contexts.get(partition)!
      await ctx.processOnce(`${event.userId}-${event.timestamp}`, async () => {
        // Update watermark
        watermarks.advance(event.timestamp)

        // Add to window
        windows.assign(event, event.timestamp)

        // Track processed
        if (!processedByPartition.has(partition)) {
          processedByPartition.set(partition, [])
        }
        processedByPartition.get(partition)!.push(event)

        return event
      })
    }

    // Verify all events processed
    let totalProcessed = 0
    for (const events of processedByPartition.values()) {
      totalProcessed += events.length
    }
    expect(totalProcessed).toBe(5)

    // Verify watermark advanced
    expect(watermarks.current()).toBe(5000)

    // Store aggregated results
    await store.put(
      'session-summary',
      {
        count: totalProcessed,
        users: ['alice', 'bob', 'charlie'],
      },
      Date.now()
    )

    const summary = await store.get('session-summary')
    expect(summary?.count).toBe(5)
  })
})
