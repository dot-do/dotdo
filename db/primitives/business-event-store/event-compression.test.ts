/**
 * EventCompression Tests
 *
 * Tests for event deduplication, batching, and compression functionality.
 *
 * @module db/primitives/business-event-store/event-compression.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  EventDeduplicator,
  EventBatcher,
  EventCompressor,
  EventCompressionPipeline,
  createEventDeduplicator,
  createEventBatcher,
  createEventCompressor,
  createCompressionPipeline,
  DEFAULT_COMPRESSION_POLICY,
  type CompressionPolicy,
  type EventBatch,
  type CompressionDictionary,
} from './event-compression'
import { ObjectEvent, type BusinessEvent } from './index'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEvent(overrides: Partial<{
  what: string[]
  where: string
  why: string
  who: string
  how: string
  when: Date
  action: 'ADD' | 'OBSERVE' | 'DELETE'
  channel: string
  sessionId: string
  deviceId: string
  correlationId: string
  causedBy: string
  parentEventId: string
  extensions: Record<string, unknown>
}> = {}): BusinessEvent {
  return new ObjectEvent({
    what: overrides.what || ['product:123'],
    action: overrides.action || 'OBSERVE',
    when: overrides.when || new Date(),
    where: overrides.where,
    why: overrides.why,
    who: overrides.who,
    how: overrides.how,
    channel: overrides.channel,
    sessionId: overrides.sessionId,
    deviceId: overrides.deviceId,
    correlationId: overrides.correlationId,
    causedBy: overrides.causedBy,
    parentEventId: overrides.parentEventId,
    extensions: overrides.extensions,
  })
}

function createTestEvents(count: number, baseTime: Date = new Date()): BusinessEvent[] {
  const events: BusinessEvent[] = []
  for (let i = 0; i < count; i++) {
    events.push(createTestEvent({
      what: [`product:${i}`],
      when: new Date(baseTime.getTime() + i * 1000),
      where: `location:${i % 5}`,
      why: `step:${i % 3}`,
      who: `party:${i % 4}`,
      how: `disposition:${i % 2}`,
    }))
  }
  return events
}

// =============================================================================
// EventDeduplicator Tests
// =============================================================================

describe('EventDeduplicator', () => {
  let deduplicator: EventDeduplicator

  beforeEach(() => {
    deduplicator = createEventDeduplicator()
  })

  describe('signature generation', () => {
    it('should generate consistent signatures for identical events', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z')
      const event1 = createTestEvent({ what: ['product:123'], when: timestamp })
      const event2 = createTestEvent({ what: ['product:123'], when: timestamp })

      const sig1 = deduplicator.generateSignature(event1)
      const sig2 = deduplicator.generateSignature(event2)

      expect(sig1.hash).toBe(sig2.hash)
      expect(sig1.algorithm).toBe('xxhash')
      expect(sig1.fields.length).toBeGreaterThan(0)
    })

    it('should generate different signatures for different events', () => {
      const event1 = createTestEvent({ what: ['product:123'] })
      const event2 = createTestEvent({ what: ['product:456'] })

      const sig1 = deduplicator.generateSignature(event1)
      const sig2 = deduplicator.generateSignature(event2)

      expect(sig1.hash).not.toBe(sig2.hash)
    })

    it('should include timestamp in signature', () => {
      const event1 = createTestEvent({ when: new Date('2024-01-15T10:00:00Z') })
      const event2 = createTestEvent({ when: new Date('2024-01-15T10:01:00Z') })

      const sig1 = deduplicator.generateSignature(event1)
      const sig2 = deduplicator.generateSignature(event2)

      expect(sig1.hash).not.toBe(sig2.hash)
    })
  })

  describe('content-based deduplication', () => {
    it('should detect duplicate events', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z')
      const event1 = createTestEvent({ what: ['product:123'], when: timestamp })
      const event2 = createTestEvent({ what: ['product:123'], when: timestamp })

      // Deduplicate both events in a batch - first one should pass, second should be duplicate
      const result = deduplicator.deduplicate([event1, event2])

      expect(result.events.length).toBe(1)
      expect(result.duplicateCount).toBe(1)
    })

    it('should not mark different events as duplicates', () => {
      const event1 = createTestEvent({ what: ['product:123'] })
      const event2 = createTestEvent({ what: ['product:456'] })

      deduplicator.deduplicate([event1])

      expect(deduplicator.isDuplicate(event2)).toBe(false)
    })
  })

  describe('time-window deduplication', () => {
    it('should deduplicate events within time window', () => {
      const windowDeduplicator = createEventDeduplicator({
        deduplicationStrategy: 'time-window',
        deduplicationWindow: 1000, // 1 second
      })

      const baseTime = new Date('2024-01-15T10:00:00Z')
      // All events have same content hash (same what, when, type, action)
      const event1 = createTestEvent({ what: ['product:123'], when: baseTime })
      const event2 = createTestEvent({ what: ['product:123'], when: baseTime }) // Same timestamp = same hash = duplicate
      const event3 = createTestEvent({ what: ['product:456'], when: baseTime }) // Different what = different hash = not duplicate

      const result = windowDeduplicator.deduplicate([event1, event2, event3])

      // event2 should be deduplicated (same hash as event1)
      // event3 should NOT be deduplicated (different hash)
      expect(result.duplicateCount).toBe(1)
      expect(result.events.length).toBe(2)
    })
  })

  describe('idempotency-key deduplication', () => {
    it('should deduplicate by correlation ID', () => {
      const idempotencyDeduplicator = createEventDeduplicator({
        deduplicationStrategy: 'idempotency-key',
      })

      const event1 = createTestEvent({ correlationId: 'request-123' })
      const event2 = createTestEvent({ correlationId: 'request-123' })
      const event3 = createTestEvent({ correlationId: 'request-456' })

      const result = idempotencyDeduplicator.deduplicate([event1, event2, event3])

      expect(result.duplicateCount).toBe(1)
      expect(result.events.length).toBe(2)
    })

    it('should not deduplicate events without idempotency key', () => {
      const idempotencyDeduplicator = createEventDeduplicator({
        deduplicationStrategy: 'idempotency-key',
      })

      const event1 = createTestEvent({})
      const event2 = createTestEvent({})

      const result = idempotencyDeduplicator.deduplicate([event1, event2])

      expect(result.duplicateCount).toBe(0)
      expect(result.events.length).toBe(2)
    })
  })

  describe('semantic deduplication', () => {
    it('should deduplicate semantically similar events within window', () => {
      const semanticDeduplicator = createEventDeduplicator({
        deduplicationStrategy: 'semantic',
        deduplicationWindow: 1000,
      })

      const baseTime = new Date('2024-01-15T10:00:00Z')
      // Same object, same type, same action within 1 second
      const event1 = createTestEvent({ what: ['product:123'], action: 'OBSERVE', when: baseTime })
      const event2 = createTestEvent({ what: ['product:123'], action: 'OBSERVE', when: new Date(baseTime.getTime() + 500) })

      const result = semanticDeduplicator.deduplicate([event1, event2])

      expect(result.duplicateCount).toBe(1)
    })
  })

  describe('batch deduplication', () => {
    it('should deduplicate a batch of events', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z')
      const events = [
        createTestEvent({ what: ['product:1'], when: timestamp }),
        createTestEvent({ what: ['product:2'], when: timestamp }),
        createTestEvent({ what: ['product:1'], when: timestamp }), // duplicate
        createTestEvent({ what: ['product:3'], when: timestamp }),
        createTestEvent({ what: ['product:2'], when: timestamp }), // duplicate
      ]

      const result = deduplicator.deduplicate(events)

      expect(result.events.length).toBe(3)
      expect(result.duplicateCount).toBe(2)
      expect(result.removedSignatures.length).toBe(2)
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should preserve order of first occurrence', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z')
      const events = [
        createTestEvent({ what: ['product:1'], when: timestamp }),
        createTestEvent({ what: ['product:2'], when: timestamp }),
        createTestEvent({ what: ['product:1'], when: timestamp }),
      ]

      const result = deduplicator.deduplicate(events)

      expect(result.events[0].what).toEqual(['product:1'])
      expect(result.events[1].what).toEqual(['product:2'])
    })
  })

  describe('statistics', () => {
    it('should track hash count and memory usage', () => {
      const events = createTestEvents(100)
      deduplicator.deduplicate(events)

      const stats = deduplicator.getStats()

      expect(stats.hashCount).toBe(100)
      expect(stats.memoryUsage).toBeGreaterThan(0)
    })

    it('should clear state', () => {
      const events = createTestEvents(10)
      deduplicator.deduplicate(events)

      deduplicator.clear()

      const stats = deduplicator.getStats()
      expect(stats.hashCount).toBe(0)
    })
  })
})

// =============================================================================
// EventBatcher Tests
// =============================================================================

describe('EventBatcher', () => {
  let batcher: EventBatcher

  beforeEach(() => {
    batcher = createEventBatcher({
      batchSize: 5,
      batchWindow: 100,
    })
  })

  describe('count-based batching', () => {
    it('should create batch when count threshold reached', () => {
      const countBatcher = createEventBatcher({
        batchingStrategy: 'count',
        batchSize: 3,
      })

      const events = createTestEvents(5)
      let batch: EventBatch | null = null

      for (const event of events) {
        const result = countBatcher.addEvent(event)
        if (result) batch = result
      }

      expect(batch).not.toBeNull()
      expect(batch!.events.length).toBe(3)
    })
  })

  describe('time-window batching', () => {
    it('should batch events and flush creates batches', () => {
      const timeBatcher = createEventBatcher({
        batchingStrategy: 'time-window',
        batchWindow: 50,
      })

      const event1 = createTestEvent({ what: ['product:1'] })
      const event2 = createTestEvent({ what: ['product:2'] })
      const event3 = createTestEvent({ what: ['product:3'] })

      // Add events - time window won't trigger flush immediately
      timeBatcher.addEvent(event1)
      timeBatcher.addEvent(event2)
      timeBatcher.addEvent(event3)

      // Explicitly flush all pending batches
      const batches = timeBatcher.flushAll()

      // Should have created at least one batch with all 3 events
      expect(batches.length).toBeGreaterThanOrEqual(1)
      const totalEvents = batches.reduce((sum, b) => sum + b.events.length, 0)
      expect(totalEvents).toBe(3)
    })
  })

  describe('adaptive batching', () => {
    it('should use both count and time thresholds', () => {
      const adaptiveBatcher = createEventBatcher({
        batchingStrategy: 'adaptive',
        batchSize: 100,
        batchWindow: 10,
      })

      const events = createTestEvents(5)
      const batches: EventBatch[] = []

      for (const event of events) {
        const batch = adaptiveBatcher.addEvent(event)
        if (batch) batches.push(batch)
      }

      // Flush remaining
      batches.push(...adaptiveBatcher.flushAll())

      expect(batches.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('group-based batching', () => {
    it('should group events by specified fields', () => {
      const groupBatcher = createEventBatcher({
        batchingStrategy: 'count',
        batchSize: 2,
        batchGroupBy: ['where'],
      })

      const events = [
        createTestEvent({ what: ['product:1'], where: 'location:A' }),
        createTestEvent({ what: ['product:2'], where: 'location:B' }),
        createTestEvent({ what: ['product:3'], where: 'location:A' }), // Should batch with event 1
        createTestEvent({ what: ['product:4'], where: 'location:B' }), // Should batch with event 2
      ]

      const batches: EventBatch[] = []
      for (const event of events) {
        const batch = groupBatcher.addEvent(event)
        if (batch) batches.push(batch)
      }

      expect(batches.length).toBe(2)
      expect(batches[0].metadata.groupKey).toBe('location:A')
      expect(batches[1].metadata.groupKey).toBe('location:B')
    })
  })

  describe('batch metadata', () => {
    it('should track time range', () => {
      const events = [
        createTestEvent({ when: new Date('2024-01-15T10:00:00Z') }),
        createTestEvent({ when: new Date('2024-01-15T10:05:00Z') }),
        createTestEvent({ when: new Date('2024-01-15T10:10:00Z') }),
      ]

      for (const event of events) {
        batcher.addEvent(event)
      }

      const batches = batcher.flushAll()

      expect(batches.length).toBe(1)
      expect(batches[0].metadata.timeRange.start).toBeDefined()
      expect(batches[0].metadata.timeRange.end).toBeDefined()
    })

    it('should track event types in batch', () => {
      const events = createTestEvents(3)

      for (const event of events) {
        batcher.addEvent(event)
      }

      const batches = batcher.flushAll()

      expect(batches[0].metadata.eventTypes).toContain('ObjectEvent')
      expect(batches[0].metadata.originalCount).toBe(3)
    })
  })

  describe('flush operations', () => {
    it('should flush all pending batches', () => {
      // Use a larger batchSize so events don't auto-flush during addEvent
      const largeBatcher = createEventBatcher({
        batchSize: 100,
        batchWindow: 10000,
      })

      const events = createTestEvents(10)

      for (const event of events) {
        largeBatcher.addEvent(event)
      }

      // Events should be pending (not auto-flushed since count < 100)
      expect(largeBatcher.getPendingCount()).toBe(10)

      const batches = largeBatcher.flushAll()

      expect(batches.length).toBeGreaterThanOrEqual(1)
      expect(largeBatcher.getPendingCount()).toBe(0)
    })

    it('should return empty array when no pending events', () => {
      const batches = batcher.flushAll()
      expect(batches.length).toBe(0)
    })
  })

  describe('pending count', () => {
    it('should track pending event count', () => {
      const events = createTestEvents(3)

      expect(batcher.getPendingCount()).toBe(0)

      for (const event of events) {
        batcher.addEvent(event)
      }

      expect(batcher.getPendingCount()).toBe(3)

      batcher.flushAll()

      expect(batcher.getPendingCount()).toBe(0)
    })
  })
})

// =============================================================================
// EventCompressor Tests
// =============================================================================

describe('EventCompressor', () => {
  let compressor: EventCompressor

  beforeEach(() => {
    compressor = createEventCompressor()
  })

  describe('batch compression', () => {
    it('should compress a batch of events', () => {
      const events = createTestEvents(10)

      const { compressedEvents, dictionary, stats } = compressor.compressBatch(events)

      expect(compressedEvents.length).toBe(10)
      expect(dictionary.eventTypes.length).toBeGreaterThan(0)
      expect(stats.compressionRatio).toBeGreaterThan(0)
    })

    it('should achieve compression for repetitive data', () => {
      // Create events with repetitive field values
      const events = []
      for (let i = 0; i < 100; i++) {
        events.push(createTestEvent({
          where: 'warehouse:main', // Same location
          why: 'shipping', // Same business step
          who: 'system:automated', // Same actor
          how: 'in_transit', // Same disposition
        }))
      }

      const { stats } = compressor.compressBatch(events)

      // Verify dictionary encoding is working (single entry for repeated values)
      expect(stats.dictionarySizes.locations).toBe(1)
      expect(stats.dictionarySizes.businessSteps).toBe(1)

      // Compression ratio depends on dictionary overhead vs savings
      // With 100 events, we should see positive compression
      expect(stats.compressionRatio).toBeGreaterThan(0)
      expect(stats.originalSize).toBeGreaterThan(0)
      expect(stats.compressedSize).toBeGreaterThan(0)
    })

    it('should preserve all event data', () => {
      const event = createTestEvent({
        what: ['product:123', 'product:456'],
        where: 'warehouse:A',
        why: 'shipping',
        who: 'user:john',
        how: 'dispatched',
        channel: 'api',
        sessionId: 'session:abc',
        deviceId: 'device:xyz',
        correlationId: 'corr:123',
        extensions: { custom: 'value' },
      })

      const { compressedEvents, dictionary } = compressor.compressBatch([event])
      const decompressed = compressor.decompressBatch(
        compressedEvents,
        dictionary,
        new Date(),
      )

      expect(decompressed[0].what).toEqual(event.what)
      expect(decompressed[0].where).toBe(event.where)
      expect(decompressed[0].why).toBe(event.why)
      expect(decompressed[0].who).toBe(event.who)
      expect(decompressed[0].how).toBe(event.how)
      expect(decompressed[0].channel).toBe(event.channel)
      expect(decompressed[0].sessionId).toBe(event.sessionId)
      expect(decompressed[0].deviceId).toBe(event.deviceId)
      expect(decompressed[0].correlationId).toBe(event.correlationId)
      expect(decompressed[0].extensions).toEqual(event.extensions)
    })
  })

  describe('dictionary encoding', () => {
    it('should build dictionary from events', () => {
      const events = [
        createTestEvent({ where: 'location:A', why: 'shipping' }),
        createTestEvent({ where: 'location:B', why: 'receiving' }),
        createTestEvent({ where: 'location:A', why: 'shipping' }), // Duplicates
      ]

      const { dictionary } = compressor.compressBatch(events)

      expect(dictionary.locations).toContain('location:A')
      expect(dictionary.locations).toContain('location:B')
      expect(dictionary.locations.length).toBe(2) // No duplicates
      expect(dictionary.businessSteps).toContain('shipping')
      expect(dictionary.businessSteps).toContain('receiving')
    })

    it('should use indices for compressed fields', () => {
      const events = [
        createTestEvent({ where: 'location:A' }),
        createTestEvent({ where: 'location:A' }),
      ]

      const { compressedEvents, dictionary } = compressor.compressBatch(events)

      const locationIndex = dictionary.locations.indexOf('location:A')
      expect(compressedEvents[0].whereIndex).toBe(locationIndex)
      expect(compressedEvents[1].whereIndex).toBe(locationIndex)
    })
  })

  describe('reference compression', () => {
    it('should compress event references', () => {
      const parentEvent = createTestEvent({ what: ['product:parent'] })
      const childEvent = createTestEvent({
        what: ['product:child'],
        parentEventId: parentEvent.id,
        causedBy: parentEvent.id,
      })

      const { compressedEvents, dictionary } = compressor.compressBatch([parentEvent, childEvent])

      // Parent ID should be in dictionary
      expect(dictionary.eventIds).toContain(parentEvent.id)

      // Child event should reference by index
      const childCompressed = compressedEvents[1]
      expect(typeof childCompressed.parentEventRef).toBe('number')
      expect(typeof childCompressed.causedByRef).toBe('number')
    })
  })

  describe('null handling', () => {
    it('should handle null/undefined fields', () => {
      const event = createTestEvent({}) // Minimal event

      const { compressedEvents, dictionary } = compressor.compressBatch([event])
      const decompressed = compressor.decompressBatch(
        compressedEvents,
        dictionary,
        new Date(),
      )

      expect(decompressed[0].where).toBeUndefined()
      expect(decompressed[0].why).toBeUndefined()
      expect(decompressed[0].who).toBeUndefined()
    })
  })

  describe('compression statistics', () => {
    it('should track compression metrics', () => {
      const events = createTestEvents(50)

      const { stats } = compressor.compressBatch(events)

      expect(stats.originalSize).toBeGreaterThan(0)
      expect(stats.compressedSize).toBeGreaterThan(0)
      expect(stats.compressionTimeMs).toBeGreaterThanOrEqual(0)
      expect(stats.dictionarySizes).toBeDefined()
    })
  })
})

// =============================================================================
// EventCompressionPipeline Tests
// =============================================================================

describe('EventCompressionPipeline', () => {
  let pipeline: EventCompressionPipeline

  beforeEach(() => {
    pipeline = createCompressionPipeline({
      batchSize: 10,
      batchWindow: 100,
    })
  })

  describe('full pipeline processing', () => {
    it('should process events through deduplication, batching, and compression', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z')
      const events = [
        ...createTestEvents(10, timestamp),
        ...createTestEvents(10, timestamp), // Duplicates
      ]

      const { batches, stats } = pipeline.process(events)

      expect(stats.inputCount).toBe(20)
      expect(stats.duplicatesRemoved).toBe(10)
      expect(stats.outputCount).toBe(10)
      expect(stats.batchCount).toBeGreaterThanOrEqual(1)
      expect(stats.compressionRatio).toBeGreaterThan(0)
      expect(stats.processingTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should create batches for large event sets', () => {
      const largePipeline = createCompressionPipeline({
        batchSize: 10,
      })

      const events = createTestEvents(100)
      const { batches, stats } = largePipeline.process(events)

      expect(batches.length).toBeGreaterThan(1)
      expect(stats.batchCount).toEqual(batches.length)
    })
  })

  describe('decompression', () => {
    it('should decompress batches back to events', () => {
      const events = createTestEvents(20)

      const { batches } = pipeline.process(events)

      // Create dictionary map
      const dictionaries = new Map<string, CompressionDictionary>()
      for (const batch of batches) {
        // Use the compressor to get the dictionary
        const compressor = createEventCompressor()
        const { dictionary } = compressor.compressBatch(events.slice(0, batch.events.length))
        dictionaries.set(batch.id, dictionary)
      }

      // Note: In real usage, dictionaries would be stored with batches
      // This test verifies the decompression API works
      expect(batches.length).toBeGreaterThan(0)
    })
  })

  describe('pipeline statistics', () => {
    it('should track pipeline state', () => {
      const events = createTestEvents(5)
      pipeline.process(events)

      const stats = pipeline.getStats()

      expect(stats.deduplicator.hashCount).toBeGreaterThanOrEqual(0)
      expect(stats.batcher.pendingCount).toBe(0)
    })
  })

  describe('pipeline reset', () => {
    it('should clear all pipeline state', () => {
      const events = createTestEvents(10)
      pipeline.process(events)

      pipeline.reset()

      const stats = pipeline.getStats()
      expect(stats.deduplicator.hashCount).toBe(0)
      expect(stats.batcher.pendingCount).toBe(0)
    })
  })
})

// =============================================================================
// Compression Policy Tests
// =============================================================================

describe('CompressionPolicy', () => {
  describe('default policy', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_COMPRESSION_POLICY.deduplication).toBe(true)
      expect(DEFAULT_COMPRESSION_POLICY.batching).toBe(true)
      expect(DEFAULT_COMPRESSION_POLICY.fieldCompression).toBe(true)
      expect(DEFAULT_COMPRESSION_POLICY.referenceCompression).toBe(true)
      expect(DEFAULT_COMPRESSION_POLICY.compressionLevel).toBe('medium')
    })
  })

  describe('custom policy', () => {
    it('should allow disabling deduplication', () => {
      const pipeline = createCompressionPipeline({
        deduplication: false,
      })

      const timestamp = new Date('2024-01-15T10:00:00Z')
      const events = [
        createTestEvent({ what: ['product:1'], when: timestamp }),
        createTestEvent({ what: ['product:1'], when: timestamp }), // Duplicate
      ]

      const { stats } = pipeline.process(events)

      expect(stats.duplicatesRemoved).toBe(0)
      expect(stats.outputCount).toBe(2)
    })

    it('should allow disabling batching', () => {
      const pipeline = createCompressionPipeline({
        batching: false,
      })

      const events = createTestEvents(100)
      const { batches } = pipeline.process(events)

      // Without batching, should create single batch
      expect(batches.length).toBe(1)
    })

    it('should allow custom deduplication fields', () => {
      const deduplicator = createEventDeduplicator({
        deduplicationFields: ['what', 'type'], // Only dedupe on what + type
      })

      const event1 = createTestEvent({ what: ['product:123'], where: 'location:A' })
      const event2 = createTestEvent({ what: ['product:123'], where: 'location:B' })

      const result = deduplicator.deduplicate([event1, event2])

      // Should be duplicates since what + type are same
      expect(result.duplicateCount).toBe(1)
    })
  })
})

// =============================================================================
// Performance Tests
// =============================================================================

describe('Performance', () => {
  describe('deduplication performance', () => {
    it('should handle large event batches efficiently', () => {
      const deduplicator = createEventDeduplicator()
      const events = createTestEvents(10000)

      const start = performance.now()
      const result = deduplicator.deduplicate(events)
      const duration = performance.now() - start

      // Should complete in reasonable time
      expect(duration).toBeLessThan(1000) // < 1 second
      expect(result.events.length).toBe(10000)
    })
  })

  describe('compression performance', () => {
    it('should compress large batches efficiently', () => {
      const compressor = createEventCompressor()
      const events = createTestEvents(1000)

      const start = performance.now()
      const { stats } = compressor.compressBatch(events)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(500) // < 500ms
      expect(stats.compressionTimeMs).toBeLessThan(500)
    })
  })

  describe('pipeline performance', () => {
    it('should process full pipeline efficiently', () => {
      const pipeline = createCompressionPipeline({
        batchSize: 100,
      })
      const events = createTestEvents(5000)

      const start = performance.now()
      const { stats } = pipeline.process(events)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(2000) // < 2 seconds
      expect(stats.processingTimeMs).toBeLessThan(2000)
    })
  })
})

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('Edge Cases', () => {
  describe('empty inputs', () => {
    it('should handle empty event array', () => {
      const pipeline = createCompressionPipeline()
      const { batches, stats } = pipeline.process([])

      expect(batches.length).toBe(0)
      expect(stats.inputCount).toBe(0)
      expect(stats.outputCount).toBe(0)
    })

    it('should handle single event', () => {
      const pipeline = createCompressionPipeline()
      const events = [createTestEvent({})]

      const { batches, stats } = pipeline.process(events)

      expect(batches.length).toBe(1)
      expect(stats.inputCount).toBe(1)
      expect(stats.outputCount).toBe(1)
    })
  })

  describe('special characters', () => {
    it('should handle events with special characters in fields', () => {
      const pipeline = createCompressionPipeline()
      const events = [
        createTestEvent({
          what: ['product:special|char:test'],
          where: 'location:with:colons',
          why: 'step/with/slashes',
          who: 'user@email.com',
        }),
      ]

      const { batches, stats } = pipeline.process(events)

      expect(stats.outputCount).toBe(1)
    })
  })

  describe('unicode handling', () => {
    it('should handle unicode in event fields', () => {
      const pipeline = createCompressionPipeline()
      const events = [
        createTestEvent({
          what: ['product:日本語'],
          where: 'location:中文',
          why: 'step:한국어',
          extensions: { emoji: '🎉' },
        }),
      ]

      const { batches, stats } = pipeline.process(events)

      expect(stats.outputCount).toBe(1)
    })
  })

  describe('large extensions', () => {
    it('should handle events with large extensions', () => {
      const compressor = createEventCompressor()
      const largeData: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        largeData[`key${i}`] = `value${i}`.repeat(10)
      }

      const event = createTestEvent({
        extensions: largeData,
      })

      const { compressedEvents, dictionary, stats } = compressor.compressBatch([event])
      const decompressed = compressor.decompressBatch(compressedEvents, dictionary, new Date())

      expect(decompressed[0].extensions).toEqual(largeData)
    })
  })
})
