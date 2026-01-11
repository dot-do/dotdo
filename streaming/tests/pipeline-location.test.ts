/**
 * Pipeline Location Metadata Enrichment Tests (RED Phase)
 *
 * Tests for enriching pipeline events with DO location metadata for analytics:
 * - PipelineEventMeta interface with colo, region, cfHint, ns, timestamp
 * - enrichEventWithLocation() function
 * - Integration with emitEvent()
 * - ColoAnalyticsEvent for R2 Iceberg queries
 *
 * All tests should FAIL initially since the implementation does not exist.
 *
 * Issue: dotdo-ga8r5
 */

import { describe, it, expect, vi, beforeEach, afterEach, expectTypeOf } from 'vitest'

// ============================================================================
// Import from non-existent module - this will cause tests to fail
// ============================================================================

import {
  enrichEventWithLocation,
  mapToColoAnalyticsEvent,
  type PipelineEvent,
  type PipelineEventMeta,
  type DOLocation,
  type ColoAnalyticsEvent,
} from '../pipeline-location'

// Import existing location types for reference
import type { ColoCode, Region, CFLocationHint } from '../../types/Location'

// ============================================================================
// MOCK PIPELINE
// ============================================================================

interface MockPipeline {
  events: any[]
  send: ReturnType<typeof vi.fn>
  clear(): void
}

function createMockPipeline(): MockPipeline {
  const events: any[] = []
  return {
    events,
    send: vi.fn(async (batch: any[]) => {
      events.push(...batch)
    }),
    clear() {
      events.length = 0
      this.send.mockClear()
    },
  }
}

// ============================================================================
// MOCK DO LOCATION
// ============================================================================

function createMockDOLocation(overrides: Partial<DOLocation> = {}): DOLocation {
  return {
    colo: 'lax' as ColoCode,
    region: 'us-west' as Region,
    cfHint: 'wnam' as CFLocationHint,
    detectedAt: new Date().toISOString(),
    source: 'cf-colo-header',
    ...overrides,
  }
}

// ============================================================================
// 1. Event Metadata Structure Tests
// ============================================================================

describe('PipelineEventMeta Interface', () => {
  describe('structure', () => {
    it('should include colo field of type ColoCode', () => {
      const meta: PipelineEventMeta = {
        colo: 'lax' as ColoCode,
        region: 'us-west' as Region,
        cfHint: 'wnam' as CFLocationHint,
        ns: 'test-namespace',
        timestamp: new Date().toISOString(),
      }

      expect(meta.colo).toBe('lax')
      expectTypeOf(meta.colo).toEqualTypeOf<ColoCode>()
    })

    it('should include region field of type Region', () => {
      const meta: PipelineEventMeta = {
        colo: 'lax' as ColoCode,
        region: 'us-west' as Region,
        cfHint: 'wnam' as CFLocationHint,
        ns: 'test-namespace',
        timestamp: new Date().toISOString(),
      }

      expect(meta.region).toBe('us-west')
      expectTypeOf(meta.region).toEqualTypeOf<Region>()
    })

    it('should include cfHint field of type CFLocationHint', () => {
      const meta: PipelineEventMeta = {
        colo: 'lax' as ColoCode,
        region: 'us-west' as Region,
        cfHint: 'wnam' as CFLocationHint,
        ns: 'test-namespace',
        timestamp: new Date().toISOString(),
      }

      expect(meta.cfHint).toBe('wnam')
      expectTypeOf(meta.cfHint).toEqualTypeOf<CFLocationHint>()
    })

    it('should include ns field of type string', () => {
      const meta: PipelineEventMeta = {
        colo: 'lax' as ColoCode,
        region: 'us-west' as Region,
        cfHint: 'wnam' as CFLocationHint,
        ns: 'acme.com',
        timestamp: new Date().toISOString(),
      }

      expect(meta.ns).toBe('acme.com')
      expectTypeOf(meta.ns).toEqualTypeOf<string>()
    })

    it('should include timestamp field in ISO format', () => {
      const now = new Date()
      const meta: PipelineEventMeta = {
        colo: 'lax' as ColoCode,
        region: 'us-west' as Region,
        cfHint: 'wnam' as CFLocationHint,
        ns: 'test-namespace',
        timestamp: now.toISOString(),
      }

      expect(meta.timestamp).toBe(now.toISOString())
      expect(meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })
})

describe('PipelineEvent Interface', () => {
  describe('structure', () => {
    it('should include _meta in pipeline events', () => {
      const event: PipelineEvent = {
        verb: 'Customer.created',
        source: 'acme.com',
        data: { name: 'Test Customer' },
        $context: 'acme.com',
        timestamp: new Date().toISOString(),
        _meta: {
          colo: 'lax' as ColoCode,
          region: 'us-west' as Region,
          cfHint: 'wnam' as CFLocationHint,
          ns: 'acme.com',
          timestamp: new Date().toISOString(),
        },
      }

      expect(event._meta).toBeDefined()
      expect(event._meta?.colo).toBe('lax')
      expect(event._meta?.region).toBe('us-west')
      expect(event._meta?.cfHint).toBe('wnam')
    })

    it('should have optional _meta field', () => {
      const event: PipelineEvent = {
        verb: 'Customer.created',
        source: 'acme.com',
        data: { name: 'Test Customer' },
        $context: 'acme.com',
        timestamp: new Date().toISOString(),
      }

      expect(event._meta).toBeUndefined()
    })

    it('should use DO detected location for _meta fields', () => {
      const location = createMockDOLocation({
        colo: 'fra' as ColoCode,
        region: 'eu-west' as Region,
        cfHint: 'weur' as CFLocationHint,
      })

      const event: PipelineEvent = {
        verb: 'Order.placed',
        source: 'shop.example.com',
        data: { orderId: '12345' },
        $context: 'shop.example.com',
        timestamp: new Date().toISOString(),
        _meta: {
          colo: location.colo,
          region: location.region,
          cfHint: location.cfHint,
          ns: 'shop.example.com',
          timestamp: new Date().toISOString(),
        },
      }

      expect(event._meta?.colo).toBe('fra')
      expect(event._meta?.region).toBe('eu-west')
      expect(event._meta?.cfHint).toBe('weur')
    })
  })
})

// ============================================================================
// 2. enrichEventWithLocation() Function Tests
// ============================================================================

describe('enrichEventWithLocation()', () => {
  describe('adding _meta', () => {
    it('should add _meta to event', () => {
      const baseEvent = {
        verb: 'Customer.created',
        source: 'acme.com',
        data: { name: 'Test' },
        $context: 'acme.com',
        timestamp: new Date().toISOString(),
      }
      const location = createMockDOLocation()

      const enriched = enrichEventWithLocation(baseEvent, location)

      expect(enriched._meta).toBeDefined()
      expect(enriched._meta?.colo).toBe('lax')
      expect(enriched._meta?.region).toBe('us-west')
      expect(enriched._meta?.cfHint).toBe('wnam')
    })

    it('should not modify original event (immutable)', () => {
      const baseEvent = {
        verb: 'Customer.created',
        source: 'acme.com',
        data: { name: 'Test' },
        $context: 'acme.com',
        timestamp: new Date().toISOString(),
      }
      const originalEvent = { ...baseEvent }
      const location = createMockDOLocation()

      enrichEventWithLocation(baseEvent, location)

      // Original should be unchanged
      expect(baseEvent).toEqual(originalEvent)
      expect((baseEvent as any)._meta).toBeUndefined()
    })

    it('should extract relevant fields from DOLocation', () => {
      const baseEvent = {
        verb: 'Order.placed',
        source: 'shop.com',
        data: { orderId: '123' },
        $context: 'shop.com',
        timestamp: new Date().toISOString(),
      }
      const location = createMockDOLocation({
        colo: 'sin' as ColoCode,
        region: 'asia-pacific' as Region,
        cfHint: 'apac' as CFLocationHint,
        detectedAt: '2026-01-10T12:00:00.000Z',
        source: 'cf-colo-header',
      })

      const enriched = enrichEventWithLocation(baseEvent, location)

      expect(enriched._meta?.colo).toBe('sin')
      expect(enriched._meta?.region).toBe('asia-pacific')
      expect(enriched._meta?.cfHint).toBe('apac')
      // Should not include detectedAt or source from DOLocation
      expect((enriched._meta as any)?.detectedAt).toBeUndefined()
      expect((enriched._meta as any)?.source).toBeUndefined()
    })

    it('should handle undefined location gracefully', () => {
      const baseEvent = {
        verb: 'Customer.created',
        source: 'acme.com',
        data: { name: 'Test' },
        $context: 'acme.com',
        timestamp: new Date().toISOString(),
      }

      const enriched = enrichEventWithLocation(baseEvent, undefined as unknown as DOLocation)

      // Should return event without _meta or with empty _meta
      expect(enriched.verb).toBe('Customer.created')
      expect(enriched.source).toBe('acme.com')
      // _meta should be undefined or have undefined values
      if (enriched._meta) {
        expect(enriched._meta.colo).toBeUndefined()
        expect(enriched._meta.region).toBeUndefined()
        expect(enriched._meta.cfHint).toBeUndefined()
      }
    })

    it('should include ns from event source', () => {
      const baseEvent = {
        verb: 'Payment.processed',
        source: 'payments.acme.com',
        data: { amount: 100 },
        $context: 'payments.acme.com',
        timestamp: new Date().toISOString(),
      }
      const location = createMockDOLocation()

      const enriched = enrichEventWithLocation(baseEvent, location)

      expect(enriched._meta?.ns).toBe('payments.acme.com')
    })

    it('should include timestamp in ISO format', () => {
      const baseEvent = {
        verb: 'Customer.created',
        source: 'acme.com',
        data: { name: 'Test' },
        $context: 'acme.com',
        timestamp: new Date().toISOString(),
      }
      const location = createMockDOLocation()

      const enriched = enrichEventWithLocation(baseEvent, location)

      expect(enriched._meta?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe('preserving original event fields', () => {
    it('should preserve verb field', () => {
      const baseEvent = {
        verb: 'Invoice.sent',
        source: 'billing.com',
        data: {},
        $context: 'billing.com',
        timestamp: new Date().toISOString(),
      }
      const location = createMockDOLocation()

      const enriched = enrichEventWithLocation(baseEvent, location)

      expect(enriched.verb).toBe('Invoice.sent')
    })

    it('should preserve source field', () => {
      const baseEvent = {
        verb: 'test',
        source: 'custom-source.example.com',
        data: {},
        $context: 'custom-source.example.com',
        timestamp: new Date().toISOString(),
      }
      const location = createMockDOLocation()

      const enriched = enrichEventWithLocation(baseEvent, location)

      expect(enriched.source).toBe('custom-source.example.com')
    })

    it('should preserve data field', () => {
      const complexData = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        nullValue: null,
      }
      const baseEvent = {
        verb: 'test',
        source: 'test.com',
        data: complexData,
        $context: 'test.com',
        timestamp: new Date().toISOString(),
      }
      const location = createMockDOLocation()

      const enriched = enrichEventWithLocation(baseEvent, location)

      expect(enriched.data).toEqual(complexData)
    })

    it('should preserve $context field', () => {
      const baseEvent = {
        verb: 'test',
        source: 'test.com',
        data: {},
        $context: 'parent.namespace.com',
        timestamp: new Date().toISOString(),
      }
      const location = createMockDOLocation()

      const enriched = enrichEventWithLocation(baseEvent, location)

      expect(enriched.$context).toBe('parent.namespace.com')
    })

    it('should preserve timestamp field', () => {
      const eventTimestamp = '2026-01-10T15:30:00.000Z'
      const baseEvent = {
        verb: 'test',
        source: 'test.com',
        data: {},
        $context: 'test.com',
        timestamp: eventTimestamp,
      }
      const location = createMockDOLocation()

      const enriched = enrichEventWithLocation(baseEvent, location)

      expect(enriched.timestamp).toBe(eventTimestamp)
    })
  })

  describe('type safety', () => {
    it('should return PipelineEvent type', () => {
      const baseEvent = {
        verb: 'test',
        source: 'test.com',
        data: {},
        $context: 'test.com',
        timestamp: new Date().toISOString(),
      }
      const location = createMockDOLocation()

      const enriched = enrichEventWithLocation(baseEvent, location)

      expectTypeOf(enriched).toMatchTypeOf<PipelineEvent>()
    })
  })
})

// ============================================================================
// 3. Integration with emitEvent() Tests
// ============================================================================

describe('Integration with emitEvent()', () => {
  let mockPipeline: MockPipeline

  beforeEach(() => {
    mockPipeline = createMockPipeline()
  })

  afterEach(() => {
    mockPipeline.clear()
    vi.restoreAllMocks()
  })

  describe('enrichment behavior', () => {
    it('emitEvent should call enrichEventWithLocation', async () => {
      // This test verifies the integration pattern
      // The actual implementation will wire this up
      const enrichSpy = vi.fn(enrichEventWithLocation)
      const location = createMockDOLocation()

      const baseEvent = {
        verb: 'Customer.created',
        source: 'acme.com',
        data: { name: 'Test' },
        $context: 'acme.com',
        timestamp: new Date().toISOString(),
      }

      // Simulate what emitEvent should do
      const enriched = enrichSpy(baseEvent, location)
      await mockPipeline.send([enriched])

      expect(enrichSpy).toHaveBeenCalledWith(baseEvent, location)
      expect(mockPipeline.events).toHaveLength(1)
      expect(mockPipeline.events[0]._meta).toBeDefined()
    })

    it('Pipeline.send should receive enriched event', async () => {
      const location = createMockDOLocation({
        colo: 'lhr' as ColoCode,
        region: 'eu-west' as Region,
        cfHint: 'weur' as CFLocationHint,
      })

      const baseEvent = {
        verb: 'Order.shipped',
        source: 'warehouse.uk',
        data: { trackingId: 'UK123' },
        $context: 'warehouse.uk',
        timestamp: new Date().toISOString(),
      }

      const enriched = enrichEventWithLocation(baseEvent, location)
      await mockPipeline.send([enriched])

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const sentEvent = mockPipeline.events[0]

      expect(sentEvent._meta).toBeDefined()
      expect(sentEvent._meta.colo).toBe('lhr')
      expect(sentEvent._meta.region).toBe('eu-west')
      expect(sentEvent._meta.cfHint).toBe('weur')
    })

    it('location should be fetched lazily (only when pipeline configured)', async () => {
      // Location detection should only happen if PIPELINE binding exists
      let locationFetched = false

      const getLocation = vi.fn(() => {
        locationFetched = true
        return createMockDOLocation()
      })

      // With pipeline - location should be fetched
      const mockEnv = { PIPELINE: mockPipeline }
      if (mockEnv.PIPELINE) {
        const location = getLocation()
        const event = enrichEventWithLocation({
          verb: 'test',
          source: 'test.com',
          data: {},
          $context: 'test.com',
          timestamp: new Date().toISOString(),
        }, location)
        await mockPipeline.send([event])
      }

      expect(locationFetched).toBe(true)
      expect(getLocation).toHaveBeenCalledTimes(1)
    })

    it('should handle missing location gracefully', async () => {
      const baseEvent = {
        verb: 'Customer.created',
        source: 'acme.com',
        data: { name: 'Test' },
        $context: 'acme.com',
        timestamp: new Date().toISOString(),
      }

      // When location is undefined, event should still be sent
      const enriched = enrichEventWithLocation(baseEvent, undefined as unknown as DOLocation)
      await mockPipeline.send([enriched])

      expect(mockPipeline.events).toHaveLength(1)
      expect(mockPipeline.events[0].verb).toBe('Customer.created')
    })
  })

  describe('batch enrichment', () => {
    it('should enrich all events in a batch', async () => {
      const location = createMockDOLocation()
      const events = [
        { verb: 'event1', source: 'ns', data: {}, $context: 'ns', timestamp: new Date().toISOString() },
        { verb: 'event2', source: 'ns', data: {}, $context: 'ns', timestamp: new Date().toISOString() },
        { verb: 'event3', source: 'ns', data: {}, $context: 'ns', timestamp: new Date().toISOString() },
      ]

      const enrichedBatch = events.map(e => enrichEventWithLocation(e, location))
      await mockPipeline.send(enrichedBatch)

      expect(mockPipeline.events).toHaveLength(3)
      mockPipeline.events.forEach((event) => {
        expect(event._meta).toBeDefined()
        expect(event._meta.colo).toBe('lax')
      })
    })
  })
})

// ============================================================================
// 4. Analytics Query Types Tests
// ============================================================================

describe('ColoAnalyticsEvent Schema', () => {
  describe('structure', () => {
    it('should have event_id field', () => {
      const event: ColoAnalyticsEvent = {
        event_id: 'uuid-123',
        verb: 'Customer.created',
        source_ns: 'acme.com',
        colo: 'lax',
        region: 'us-west',
        cf_hint: 'wnam',
        event_timestamp: '2026-01-10T12:00:00.000Z',
        ingested_at: '2026-01-10T12:00:01.000Z',
      }

      expect(event.event_id).toBe('uuid-123')
      expectTypeOf(event.event_id).toEqualTypeOf<string>()
    })

    it('should have verb field', () => {
      const event: ColoAnalyticsEvent = {
        event_id: 'uuid-123',
        verb: 'Order.placed',
        source_ns: 'shop.com',
        colo: 'fra',
        region: 'eu-west',
        cf_hint: 'weur',
        event_timestamp: '2026-01-10T12:00:00.000Z',
        ingested_at: '2026-01-10T12:00:01.000Z',
      }

      expect(event.verb).toBe('Order.placed')
    })

    it('should have source_ns field', () => {
      const event: ColoAnalyticsEvent = {
        event_id: 'uuid-123',
        verb: 'test',
        source_ns: 'payments.example.com',
        colo: 'sin',
        region: 'asia-pacific',
        cf_hint: 'apac',
        event_timestamp: '2026-01-10T12:00:00.000Z',
        ingested_at: '2026-01-10T12:00:01.000Z',
      }

      expect(event.source_ns).toBe('payments.example.com')
    })

    it('should have colo field as string', () => {
      const event: ColoAnalyticsEvent = {
        event_id: 'uuid-123',
        verb: 'test',
        source_ns: 'test.com',
        colo: 'nrt',
        region: 'asia-pacific',
        cf_hint: 'apac',
        event_timestamp: '2026-01-10T12:00:00.000Z',
        ingested_at: '2026-01-10T12:00:01.000Z',
      }

      expect(event.colo).toBe('nrt')
      expectTypeOf(event.colo).toEqualTypeOf<string>()
    })

    it('should have region field as string', () => {
      const event: ColoAnalyticsEvent = {
        event_id: 'uuid-123',
        verb: 'test',
        source_ns: 'test.com',
        colo: 'syd',
        region: 'oceania',
        cf_hint: 'oc',
        event_timestamp: '2026-01-10T12:00:00.000Z',
        ingested_at: '2026-01-10T12:00:01.000Z',
      }

      expect(event.region).toBe('oceania')
    })

    it('should have cf_hint field as string', () => {
      const event: ColoAnalyticsEvent = {
        event_id: 'uuid-123',
        verb: 'test',
        source_ns: 'test.com',
        colo: 'gru',
        region: 'south-america',
        cf_hint: 'sam',
        event_timestamp: '2026-01-10T12:00:00.000Z',
        ingested_at: '2026-01-10T12:00:01.000Z',
      }

      expect(event.cf_hint).toBe('sam')
    })

    it('should have event_timestamp field', () => {
      const event: ColoAnalyticsEvent = {
        event_id: 'uuid-123',
        verb: 'test',
        source_ns: 'test.com',
        colo: 'lax',
        region: 'us-west',
        cf_hint: 'wnam',
        event_timestamp: '2026-01-10T12:00:00.000Z',
        ingested_at: '2026-01-10T12:00:01.000Z',
      }

      expect(event.event_timestamp).toBe('2026-01-10T12:00:00.000Z')
    })

    it('should have ingested_at field', () => {
      const event: ColoAnalyticsEvent = {
        event_id: 'uuid-123',
        verb: 'test',
        source_ns: 'test.com',
        colo: 'lax',
        region: 'us-west',
        cf_hint: 'wnam',
        event_timestamp: '2026-01-10T12:00:00.000Z',
        ingested_at: '2026-01-10T12:00:01.000Z',
      }

      expect(event.ingested_at).toBe('2026-01-10T12:00:01.000Z')
    })
  })

  describe('mapToColoAnalyticsEvent()', () => {
    it('should map PipelineEvent to ColoAnalyticsEvent schema', () => {
      const pipelineEvent: PipelineEvent = {
        verb: 'Customer.created',
        source: 'acme.com',
        data: { name: 'Test' },
        $context: 'acme.com',
        timestamp: '2026-01-10T12:00:00.000Z',
        _meta: {
          colo: 'lax' as ColoCode,
          region: 'us-west' as Region,
          cfHint: 'wnam' as CFLocationHint,
          ns: 'acme.com',
          timestamp: '2026-01-10T12:00:00.000Z',
        },
      }

      const analyticsEvent = mapToColoAnalyticsEvent(pipelineEvent, 'event-123')

      expect(analyticsEvent.event_id).toBe('event-123')
      expect(analyticsEvent.verb).toBe('Customer.created')
      expect(analyticsEvent.source_ns).toBe('acme.com')
      expect(analyticsEvent.colo).toBe('lax')
      expect(analyticsEvent.region).toBe('us-west')
      expect(analyticsEvent.cf_hint).toBe('wnam')
      expect(analyticsEvent.event_timestamp).toBe('2026-01-10T12:00:00.000Z')
    })

    it('should be queryable by colo', () => {
      const events: ColoAnalyticsEvent[] = [
        {
          event_id: '1',
          verb: 'test',
          source_ns: 'ns1',
          colo: 'lax',
          region: 'us-west',
          cf_hint: 'wnam',
          event_timestamp: '2026-01-10T12:00:00.000Z',
          ingested_at: '2026-01-10T12:00:01.000Z',
        },
        {
          event_id: '2',
          verb: 'test',
          source_ns: 'ns2',
          colo: 'fra',
          region: 'eu-west',
          cf_hint: 'weur',
          event_timestamp: '2026-01-10T12:00:00.000Z',
          ingested_at: '2026-01-10T12:00:01.000Z',
        },
        {
          event_id: '3',
          verb: 'test',
          source_ns: 'ns3',
          colo: 'lax',
          region: 'us-west',
          cf_hint: 'wnam',
          event_timestamp: '2026-01-10T12:00:00.000Z',
          ingested_at: '2026-01-10T12:00:01.000Z',
        },
      ]

      // Simulating SQL: SELECT * FROM events WHERE colo = 'lax'
      const laxEvents = events.filter(e => e.colo === 'lax')

      expect(laxEvents).toHaveLength(2)
      expect(laxEvents.every(e => e.colo === 'lax')).toBe(true)
    })

    it('should be queryable by region', () => {
      const events: ColoAnalyticsEvent[] = [
        {
          event_id: '1',
          verb: 'test',
          source_ns: 'ns1',
          colo: 'lhr',
          region: 'eu-west',
          cf_hint: 'weur',
          event_timestamp: '2026-01-10T12:00:00.000Z',
          ingested_at: '2026-01-10T12:00:01.000Z',
        },
        {
          event_id: '2',
          verb: 'test',
          source_ns: 'ns2',
          colo: 'fra',
          region: 'eu-west',
          cf_hint: 'weur',
          event_timestamp: '2026-01-10T12:00:00.000Z',
          ingested_at: '2026-01-10T12:00:01.000Z',
        },
        {
          event_id: '3',
          verb: 'test',
          source_ns: 'ns3',
          colo: 'sin',
          region: 'asia-pacific',
          cf_hint: 'apac',
          event_timestamp: '2026-01-10T12:00:00.000Z',
          ingested_at: '2026-01-10T12:00:01.000Z',
        },
      ]

      // Simulating SQL: SELECT * FROM events WHERE region = 'eu-west'
      const euEvents = events.filter(e => e.region === 'eu-west')

      expect(euEvents).toHaveLength(2)
      expect(euEvents.every(e => e.region === 'eu-west')).toBe(true)
    })

    it('should support time-based aggregations', () => {
      const events: ColoAnalyticsEvent[] = [
        {
          event_id: '1',
          verb: 'Order.placed',
          source_ns: 'shop',
          colo: 'lax',
          region: 'us-west',
          cf_hint: 'wnam',
          event_timestamp: '2026-01-10T10:00:00.000Z',
          ingested_at: '2026-01-10T10:00:01.000Z',
        },
        {
          event_id: '2',
          verb: 'Order.placed',
          source_ns: 'shop',
          colo: 'lax',
          region: 'us-west',
          cf_hint: 'wnam',
          event_timestamp: '2026-01-10T10:30:00.000Z',
          ingested_at: '2026-01-10T10:30:01.000Z',
        },
        {
          event_id: '3',
          verb: 'Order.placed',
          source_ns: 'shop',
          colo: 'lax',
          region: 'us-west',
          cf_hint: 'wnam',
          event_timestamp: '2026-01-10T11:00:00.000Z',
          ingested_at: '2026-01-10T11:00:01.000Z',
        },
      ]

      // Simulating: SELECT COUNT(*), DATE_TRUNC('hour', event_timestamp) as hour
      //             FROM events GROUP BY hour
      const hourlyAggregation = new Map<string, number>()
      events.forEach(e => {
        const hour = e.event_timestamp.substring(0, 13) // '2026-01-10T10' or '2026-01-10T11'
        hourlyAggregation.set(hour, (hourlyAggregation.get(hour) ?? 0) + 1)
      })

      expect(hourlyAggregation.get('2026-01-10T10')).toBe(2)
      expect(hourlyAggregation.get('2026-01-10T11')).toBe(1)
    })

    it('should support colo + time aggregation for analytics', () => {
      const events: ColoAnalyticsEvent[] = [
        {
          event_id: '1',
          verb: 'request',
          source_ns: 'api',
          colo: 'lax',
          region: 'us-west',
          cf_hint: 'wnam',
          event_timestamp: '2026-01-10T10:00:00.000Z',
          ingested_at: '2026-01-10T10:00:01.000Z',
        },
        {
          event_id: '2',
          verb: 'request',
          source_ns: 'api',
          colo: 'fra',
          region: 'eu-west',
          cf_hint: 'weur',
          event_timestamp: '2026-01-10T10:00:00.000Z',
          ingested_at: '2026-01-10T10:00:01.000Z',
        },
        {
          event_id: '3',
          verb: 'request',
          source_ns: 'api',
          colo: 'lax',
          region: 'us-west',
          cf_hint: 'wnam',
          event_timestamp: '2026-01-10T10:00:00.000Z',
          ingested_at: '2026-01-10T10:00:01.000Z',
        },
      ]

      // Simulating: SELECT colo, COUNT(*) as count FROM events GROUP BY colo
      const coloAggregation = new Map<string, number>()
      events.forEach(e => {
        coloAggregation.set(e.colo, (coloAggregation.get(e.colo) ?? 0) + 1)
      })

      expect(coloAggregation.get('lax')).toBe(2)
      expect(coloAggregation.get('fra')).toBe(1)
    })
  })
})

// ============================================================================
// DOLocation Interface Tests
// ============================================================================

describe('DOLocation Interface', () => {
  it('should have colo field of type ColoCode', () => {
    const location: DOLocation = {
      colo: 'lax' as ColoCode,
      region: 'us-west' as Region,
      cfHint: 'wnam' as CFLocationHint,
      detectedAt: new Date().toISOString(),
      source: 'cf-colo-header',
    }

    expect(location.colo).toBe('lax')
  })

  it('should have region field of type Region', () => {
    const location: DOLocation = {
      colo: 'fra' as ColoCode,
      region: 'eu-west' as Region,
      cfHint: 'weur' as CFLocationHint,
      detectedAt: new Date().toISOString(),
      source: 'cf-colo-header',
    }

    expect(location.region).toBe('eu-west')
  })

  it('should have cfHint field of type CFLocationHint', () => {
    const location: DOLocation = {
      colo: 'sin' as ColoCode,
      region: 'asia-pacific' as Region,
      cfHint: 'apac' as CFLocationHint,
      detectedAt: new Date().toISOString(),
      source: 'cf-colo-header',
    }

    expect(location.cfHint).toBe('apac')
  })

  it('should have detectedAt field', () => {
    const now = new Date().toISOString()
    const location: DOLocation = {
      colo: 'lax' as ColoCode,
      region: 'us-west' as Region,
      cfHint: 'wnam' as CFLocationHint,
      detectedAt: now,
      source: 'cf-colo-header',
    }

    expect(location.detectedAt).toBe(now)
  })

  it('should have source field indicating detection method', () => {
    const location: DOLocation = {
      colo: 'lax' as ColoCode,
      region: 'us-west' as Region,
      cfHint: 'wnam' as CFLocationHint,
      detectedAt: new Date().toISOString(),
      source: 'cf-colo-header',
    }

    expect(location.source).toBe('cf-colo-header')
  })
})
