import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

/**
 * EPCIS Search Query Parameter Tests
 *
 * These tests verify EPCIS query parameter mapping on /api/search.
 * They are expected to FAIL until the EPCIS query param support is implemented.
 *
 * EPCIS 2.0 query parameters map to our 5W+H event model:
 *
 * | 5W+H  | EPCIS Field               | Query Parameter           |
 * |-------|---------------------------|---------------------------|
 * | WHO   | source, destination       | EQ_source, EQ_destination |
 * | WHAT  | epcList, parentID         | MATCH_epc, EQ_parentID    |
 * | WHEN  | eventTime, recordTime     | GE_eventTime, LT_eventTime|
 * | WHERE | readPoint, bizLocation    | EQ_readPoint, EQ_bizLocation |
 * | WHY   | bizStep, disposition      | EQ_bizStep, EQ_disposition|
 * | HOW   | bizTransaction            | EQ_bizTransaction         |
 *
 * Additional:
 * - eventType: ObjectEvent, AggregationEvent, TransactionEvent, etc.
 *
 * Reference: docs/concepts/events.mdx
 */

// Import the middleware
import { search, type SearchConfig, type SearchResponse } from '../../middleware/search'

// ============================================================================
// Test Types
// ============================================================================

interface EPCISSearchResult {
  type: string
  query: string
  filters: Record<string, string>
  results: EPCISEvent[]
  total: number
  limit: number
  offset: number
}

interface EPCISEvent {
  id: string
  eventType: string
  eventTime: string
  recordTime: string
  bizStep?: string
  disposition?: string
  readPoint?: string
  bizLocation?: string
  epcList?: string[]
  parentID?: string
  source?: string
  destination?: string
  bizTransaction?: string
}

interface ErrorResponse {
  error: string
}

// ============================================================================
// Mock Setup
// ============================================================================

const mockDb = {
  query: {
    events: {
      findMany: vi.fn(),
    },
  },
}

// Sample EPCIS events for testing
const sampleEvents: EPCISEvent[] = [
  {
    id: 'evt-001',
    eventType: 'ObjectEvent',
    eventTime: '2026-01-08T10:00:00Z',
    recordTime: '2026-01-08T10:00:01Z',
    bizStep: 'shipping',
    disposition: 'in_transit',
    readPoint: 'urn:epc:id:sgln:0614141.00001.0',
    bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
    epcList: ['urn:epc:id:sgtin:0614141.107346.2017', 'urn:epc:id:sgtin:0614141.107346.2018'],
    source: 'urn:epc:id:sgln:0614141.00001.0',
    destination: 'urn:epc:id:sgln:0614141.00002.0',
    bizTransaction: 'urn:epc:id:gdti:0614141.00001.1234',
  },
  {
    id: 'evt-002',
    eventType: 'ObjectEvent',
    eventTime: '2026-01-08T11:00:00Z',
    recordTime: '2026-01-08T11:00:01Z',
    bizStep: 'receiving',
    disposition: 'active',
    readPoint: 'urn:epc:id:sgln:0614141.00002.0',
    bizLocation: 'urn:epc:id:sgln:0614141.00002.0',
    epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
  },
  {
    id: 'evt-003',
    eventType: 'AggregationEvent',
    eventTime: '2026-01-08T09:00:00Z',
    recordTime: '2026-01-08T09:00:01Z',
    bizStep: 'packing',
    parentID: 'urn:epc:id:sscc:0614141.1234567890',
    epcList: ['urn:epc:id:sgtin:0614141.107346.2019'],
    bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
  },
  {
    id: 'evt-004',
    eventType: 'TransactionEvent',
    eventTime: '2026-01-08T12:00:00Z',
    recordTime: '2026-01-08T12:00:01Z',
    bizStep: 'selling',
    disposition: 'sold',
    epcList: ['urn:epc:id:sgtin:0614141.107346.2020'],
    bizTransaction: 'urn:epc:id:gdti:0614141.00001.5678',
  },
  {
    id: 'evt-005',
    eventType: 'TransformationEvent',
    eventTime: '2026-01-08T08:00:00Z',
    recordTime: '2026-01-08T08:00:01Z',
    bizStep: 'commissioning',
    disposition: 'active',
    bizLocation: 'urn:epc:id:sgln:0614141.00003.0',
  },
]

// ============================================================================
// Helper Functions
// ============================================================================

function createEPCISSearchApp(config?: SearchConfig): Hono {
  const app = new Hono()

  // Mock auth middleware - sets user context
  app.use('*', async (c, next) => {
    c.set('user', { id: 'user-123', role: 'user' })
    c.set('db', mockDb)
    await next()
  })

  app.use(
    '/api/search/*',
    search({
      localTypes: ['events'],
      ...config,
    })
  )
  return app
}

async function epcisSearchRequest(
  app: Hono,
  params: Record<string, string> = {}
): Promise<Response> {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, value)
  }

  const queryString = searchParams.toString()
  const url = `/api/search/events${queryString ? `?${queryString}` : ''}`

  return app.request(url, { method: 'GET' })
}

// ============================================================================
// 1. Event Type Filter Tests
// ============================================================================

describe('EPCIS Search - eventType filter', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('Filter by eventType parameter', () => {
    it('filters by ObjectEvent type', async () => {
      const res = await epcisSearchRequest(app, { eventType: 'ObjectEvent' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      // Should only return ObjectEvent types
      expect(body.results.every((e) => e.eventType === 'ObjectEvent')).toBe(true)
      expect(body.results.length).toBeGreaterThan(0)
    })

    it('filters by AggregationEvent type', async () => {
      const res = await epcisSearchRequest(app, { eventType: 'AggregationEvent' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.eventType === 'AggregationEvent')).toBe(true)
    })

    it('filters by TransactionEvent type', async () => {
      const res = await epcisSearchRequest(app, { eventType: 'TransactionEvent' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.eventType === 'TransactionEvent')).toBe(true)
    })

    it('filters by TransformationEvent type', async () => {
      const res = await epcisSearchRequest(app, { eventType: 'TransformationEvent' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.eventType === 'TransformationEvent')).toBe(true)
    })

    it('filters by AssociationEvent type', async () => {
      const res = await epcisSearchRequest(app, { eventType: 'AssociationEvent' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      // No AssociationEvents in sample data
      expect(body.results.length).toBe(0)
    })

    it('returns 400 for invalid eventType', async () => {
      const res = await epcisSearchRequest(app, { eventType: 'InvalidEventType' })
      expect(res.status).toBe(400)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toMatch(/invalid.*event.*type/i)
    })

    it('passes eventType to database query', async () => {
      await epcisSearchRequest(app, { eventType: 'ObjectEvent' })

      expect(mockDb.query.events.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventType: 'ObjectEvent',
          }),
        })
      )
    })
  })
})

// ============================================================================
// 2. bizStep Filter Tests (WHY)
// ============================================================================

describe('EPCIS Search - bizStep filter (WHY)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('Filter by EQ_bizStep parameter', () => {
    it('filters by shipping bizStep', async () => {
      const res = await epcisSearchRequest(app, { EQ_bizStep: 'shipping' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.bizStep === 'shipping')).toBe(true)
      expect(body.results.length).toBeGreaterThan(0)
    })

    it('filters by receiving bizStep', async () => {
      const res = await epcisSearchRequest(app, { EQ_bizStep: 'receiving' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.bizStep === 'receiving')).toBe(true)
    })

    it('filters by packing bizStep', async () => {
      const res = await epcisSearchRequest(app, { EQ_bizStep: 'packing' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.bizStep === 'packing')).toBe(true)
    })

    it('filters by selling bizStep', async () => {
      const res = await epcisSearchRequest(app, { EQ_bizStep: 'selling' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.bizStep === 'selling')).toBe(true)
    })

    it('filters by commissioning bizStep', async () => {
      const res = await epcisSearchRequest(app, { EQ_bizStep: 'commissioning' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.bizStep === 'commissioning')).toBe(true)
    })

    it('returns empty results for non-existent bizStep', async () => {
      const res = await epcisSearchRequest(app, { EQ_bizStep: 'nonexistent' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.length).toBe(0)
    })

    it('also accepts bizStep as alias for EQ_bizStep', async () => {
      const res = await epcisSearchRequest(app, { bizStep: 'shipping' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.bizStep === 'shipping')).toBe(true)
    })

    it('passes bizStep to database query', async () => {
      await epcisSearchRequest(app, { EQ_bizStep: 'shipping' })

      expect(mockDb.query.events.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            bizStep: 'shipping',
          }),
        })
      )
    })
  })
})

// ============================================================================
// 3. MATCH_epc Pattern Matching Tests (WHAT)
// ============================================================================

describe('EPCIS Search - MATCH_epc pattern matching (WHAT)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('Filter by MATCH_epc parameter', () => {
    it('matches exact EPC identifier', async () => {
      const res = await epcisSearchRequest(app, {
        MATCH_epc: 'urn:epc:id:sgtin:0614141.107346.2017',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      // Should return events containing this EPC
      expect(body.results.length).toBeGreaterThan(0)
      expect(
        body.results.every((e) =>
          e.epcList?.includes('urn:epc:id:sgtin:0614141.107346.2017')
        )
      ).toBe(true)
    })

    it('matches EPC with wildcard pattern', async () => {
      // Wildcard matching for SGTIN class-level (serial number wildcard)
      const res = await epcisSearchRequest(app, {
        MATCH_epc: 'urn:epc:id:sgtin:0614141.107346.*',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.length).toBeGreaterThan(0)
    })

    it('matches EPC by GTIN prefix pattern', async () => {
      const res = await epcisSearchRequest(app, {
        MATCH_epc: 'urn:epc:id:sgtin:0614141.*',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      // Should match all events with EPCs from company 0614141
      expect(body.results.length).toBeGreaterThan(0)
    })

    it('returns empty results for non-matching EPC', async () => {
      const res = await epcisSearchRequest(app, {
        MATCH_epc: 'urn:epc:id:sgtin:9999999.999999.9999',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.length).toBe(0)
    })

    it('validates EPC URN format', async () => {
      const res = await epcisSearchRequest(app, {
        MATCH_epc: 'invalid-epc-format',
      })
      // Should either return 400 or empty results
      expect([200, 400]).toContain(res.status)
    })

    it('matches against parentID as well', async () => {
      const res = await epcisSearchRequest(app, {
        MATCH_epc: 'urn:epc:id:sscc:0614141.1234567890',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.some((e) => e.parentID?.includes('0614141.1234567890'))).toBe(
        true
      )
    })

    it('passes EPC pattern to database query', async () => {
      await epcisSearchRequest(app, {
        MATCH_epc: 'urn:epc:id:sgtin:0614141.107346.2017',
      })

      expect(mockDb.query.events.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            MATCH_epc: 'urn:epc:id:sgtin:0614141.107346.2017',
          }),
        })
      )
    })
  })
})

// ============================================================================
// 4. Time Range Filter Tests (WHEN)
// ============================================================================

describe('EPCIS Search - Time range filters (WHEN)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('Filter by GE_eventTime (greater than or equal)', () => {
    it('filters events after specified time', async () => {
      const res = await epcisSearchRequest(app, {
        GE_eventTime: '2026-01-08T10:00:00Z',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(
        body.results.every((e) => new Date(e.eventTime) >= new Date('2026-01-08T10:00:00Z'))
      ).toBe(true)
    })

    it('handles ISO 8601 date format', async () => {
      const res = await epcisSearchRequest(app, {
        GE_eventTime: '2026-01-08T00:00:00.000Z',
      })
      expect(res.status).toBe(200)
    })

    it('returns 400 for invalid date format', async () => {
      const res = await epcisSearchRequest(app, {
        GE_eventTime: 'not-a-date',
      })
      expect(res.status).toBe(400)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toMatch(/invalid.*date|format/i)
    })
  })

  describe('Filter by LT_eventTime (less than)', () => {
    it('filters events before specified time', async () => {
      const res = await epcisSearchRequest(app, {
        LT_eventTime: '2026-01-08T11:00:00Z',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(
        body.results.every((e) => new Date(e.eventTime) < new Date('2026-01-08T11:00:00Z'))
      ).toBe(true)
    })

    it('handles timezone offsets', async () => {
      const res = await epcisSearchRequest(app, {
        LT_eventTime: '2026-01-08T06:00:00-05:00',
      })
      expect(res.status).toBe(200)
    })
  })

  describe('Combined time range filters', () => {
    it('filters events within time range', async () => {
      const res = await epcisSearchRequest(app, {
        GE_eventTime: '2026-01-08T09:00:00Z',
        LT_eventTime: '2026-01-08T11:00:00Z',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(
        body.results.every((e) => {
          const time = new Date(e.eventTime)
          return time >= new Date('2026-01-08T09:00:00Z') && time < new Date('2026-01-08T11:00:00Z')
        })
      ).toBe(true)
    })

    it('returns empty results for non-overlapping range', async () => {
      const res = await epcisSearchRequest(app, {
        GE_eventTime: '2025-01-01T00:00:00Z',
        LT_eventTime: '2025-01-02T00:00:00Z',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.length).toBe(0)
    })

    it('returns 400 when GE_eventTime > LT_eventTime', async () => {
      const res = await epcisSearchRequest(app, {
        GE_eventTime: '2026-01-08T12:00:00Z',
        LT_eventTime: '2026-01-08T10:00:00Z',
      })
      expect(res.status).toBe(400)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toMatch(/invalid.*range|start.*end/i)
    })
  })

  describe('Filter by recordTime', () => {
    it('filters by GE_recordTime', async () => {
      const res = await epcisSearchRequest(app, {
        GE_recordTime: '2026-01-08T10:00:00Z',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(
        body.results.every((e) => new Date(e.recordTime) >= new Date('2026-01-08T10:00:00Z'))
      ).toBe(true)
    })

    it('filters by LT_recordTime', async () => {
      const res = await epcisSearchRequest(app, {
        LT_recordTime: '2026-01-08T11:00:00Z',
      })
      expect(res.status).toBe(200)
    })
  })

  it('passes time filters to database query', async () => {
    await epcisSearchRequest(app, {
      GE_eventTime: '2026-01-08T10:00:00Z',
      LT_eventTime: '2026-01-08T12:00:00Z',
    })

    expect(mockDb.query.events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          GE_eventTime: '2026-01-08T10:00:00Z',
          LT_eventTime: '2026-01-08T12:00:00Z',
        }),
      })
    )
  })
})

// ============================================================================
// 5. bizLocation Filter Tests (WHERE)
// ============================================================================

describe('EPCIS Search - bizLocation filter (WHERE)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('Filter by EQ_bizLocation parameter', () => {
    it('filters by exact bizLocation', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.bizLocation === 'urn:epc:id:sgln:0614141.00001.0')).toBe(
        true
      )
      expect(body.results.length).toBeGreaterThan(0)
    })

    it('filters by different bizLocation', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_bizLocation: 'urn:epc:id:sgln:0614141.00002.0',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.bizLocation === 'urn:epc:id:sgln:0614141.00002.0')).toBe(
        true
      )
    })

    it('returns empty results for non-existent location', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_bizLocation: 'urn:epc:id:sgln:9999999.99999.0',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.length).toBe(0)
    })

    it('supports WKT_bizLocation for geo queries', async () => {
      // Geo-spatial query using Well-Known Text
      const res = await epcisSearchRequest(app, {
        WKT_bizLocation: 'POINT(-122.4194 37.7749)',
      })
      // Should be supported but may return 400 if geo queries not implemented
      expect([200, 400, 501]).toContain(res.status)
    })
  })

  describe('Filter by EQ_readPoint parameter', () => {
    it('filters by exact readPoint', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_readPoint: 'urn:epc:id:sgln:0614141.00001.0',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.readPoint === 'urn:epc:id:sgln:0614141.00001.0')).toBe(
        true
      )
    })

    it('returns events captured at specific read point', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_readPoint: 'urn:epc:id:sgln:0614141.00002.0',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.length).toBeGreaterThan(0)
    })
  })

  it('passes location filters to database query', async () => {
    await epcisSearchRequest(app, {
      EQ_bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
    })

    expect(mockDb.query.events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
        }),
      })
    )
  })
})

// ============================================================================
// 6. Combined Filters Tests
// ============================================================================

describe('EPCIS Search - Combined filters', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('Multiple EPCIS parameters together', () => {
    it('combines eventType and bizStep filters', async () => {
      const res = await epcisSearchRequest(app, {
        eventType: 'ObjectEvent',
        EQ_bizStep: 'shipping',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(
        body.results.every(
          (e) => e.eventType === 'ObjectEvent' && e.bizStep === 'shipping'
        )
      ).toBe(true)
    })

    it('combines eventType, bizStep, and time range', async () => {
      const res = await epcisSearchRequest(app, {
        eventType: 'ObjectEvent',
        EQ_bizStep: 'shipping',
        GE_eventTime: '2026-01-08T00:00:00Z',
        LT_eventTime: '2026-01-09T00:00:00Z',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(
        body.results.every((e) => {
          const time = new Date(e.eventTime)
          return (
            e.eventType === 'ObjectEvent' &&
            e.bizStep === 'shipping' &&
            time >= new Date('2026-01-08T00:00:00Z') &&
            time < new Date('2026-01-09T00:00:00Z')
          )
        })
      ).toBe(true)
    })

    it('combines MATCH_epc with bizLocation', async () => {
      const res = await epcisSearchRequest(app, {
        MATCH_epc: 'urn:epc:id:sgtin:0614141.107346.*',
        EQ_bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.length).toBeGreaterThanOrEqual(0)
    })

    it('combines all 5W+H filters', async () => {
      const res = await epcisSearchRequest(app, {
        // WHO
        EQ_source: 'urn:epc:id:sgln:0614141.00001.0',
        // WHAT
        MATCH_epc: 'urn:epc:id:sgtin:0614141.107346.*',
        // WHEN
        GE_eventTime: '2026-01-08T00:00:00Z',
        // WHERE
        EQ_bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
        // WHY
        EQ_bizStep: 'shipping',
        // HOW
        EQ_bizTransaction: 'urn:epc:id:gdti:0614141.00001.1234',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      // Should return the matching event(s)
      expect(body.results).toBeDefined()
    })

    it('returns empty results when filters exclude all events', async () => {
      const res = await epcisSearchRequest(app, {
        eventType: 'ObjectEvent',
        EQ_bizStep: 'nonexistent',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.length).toBe(0)
    })

    it('combines with standard pagination parameters', async () => {
      const res = await epcisSearchRequest(app, {
        eventType: 'ObjectEvent',
        limit: '10',
        offset: '0',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.limit).toBe(10)
      expect(body.offset).toBe(0)
    })

    it('combines with full-text search query', async () => {
      const res = await epcisSearchRequest(app, {
        q: 'shipping',
        eventType: 'ObjectEvent',
        EQ_bizStep: 'shipping',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.query).toBe('shipping')
      expect(body.results.every((e) => e.eventType === 'ObjectEvent')).toBe(true)
    })
  })

  it('passes all combined filters to database query', async () => {
    await epcisSearchRequest(app, {
      eventType: 'ObjectEvent',
      EQ_bizStep: 'shipping',
      GE_eventTime: '2026-01-08T10:00:00Z',
      EQ_bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
    })

    expect(mockDb.query.events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: 'ObjectEvent',
          bizStep: 'shipping',
          GE_eventTime: '2026-01-08T10:00:00Z',
          bizLocation: 'urn:epc:id:sgln:0614141.00001.0',
        }),
      })
    )
  })
})

// ============================================================================
// 7. Additional EPCIS Parameter Tests (WHO, HOW)
// ============================================================================

describe('EPCIS Search - WHO parameters (source/destination)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('Filter by EQ_source parameter', () => {
    it('filters by source location', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_source: 'urn:epc:id:sgln:0614141.00001.0',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.source === 'urn:epc:id:sgln:0614141.00001.0')).toBe(true)
    })
  })

  describe('Filter by EQ_destination parameter', () => {
    it('filters by destination location', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_destination: 'urn:epc:id:sgln:0614141.00002.0',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(
        body.results.every((e) => e.destination === 'urn:epc:id:sgln:0614141.00002.0')
      ).toBe(true)
    })
  })
})

describe('EPCIS Search - HOW parameters (bizTransaction)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('Filter by EQ_bizTransaction parameter', () => {
    it('filters by business transaction ID', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_bizTransaction: 'urn:epc:id:gdti:0614141.00001.1234',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(
        body.results.every((e) => e.bizTransaction === 'urn:epc:id:gdti:0614141.00001.1234')
      ).toBe(true)
    })

    it('returns events linked to specific transaction', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_bizTransaction: 'urn:epc:id:gdti:0614141.00001.5678',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.length).toBeGreaterThan(0)
    })
  })
})

describe('EPCIS Search - disposition filter (WHY)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('Filter by EQ_disposition parameter', () => {
    it('filters by in_transit disposition', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_disposition: 'in_transit',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.disposition === 'in_transit')).toBe(true)
    })

    it('filters by active disposition', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_disposition: 'active',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.disposition === 'active')).toBe(true)
    })

    it('filters by sold disposition', async () => {
      const res = await epcisSearchRequest(app, {
        EQ_disposition: 'sold',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.results.every((e) => e.disposition === 'sold')).toBe(true)
    })
  })
})

// ============================================================================
// 8. Response Format Tests
// ============================================================================

describe('EPCIS Search - Response format', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.events.findMany.mockResolvedValue(sampleEvents)
    app = createEPCISSearchApp()
  })

  describe('EPCIS-specific response fields', () => {
    it('includes EPCIS filter params in filters response', async () => {
      const res = await epcisSearchRequest(app, {
        eventType: 'ObjectEvent',
        EQ_bizStep: 'shipping',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      expect(body.filters).toHaveProperty('eventType', 'ObjectEvent')
      expect(body.filters).toHaveProperty('EQ_bizStep', 'shipping')
    })

    it('returns events in EPCIS-compatible format', async () => {
      const res = await epcisSearchRequest(app, { eventType: 'ObjectEvent' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      if (body.results.length > 0) {
        const event = body.results[0]
        expect(event).toHaveProperty('eventType')
        expect(event).toHaveProperty('eventTime')
        expect(event).toHaveProperty('recordTime')
      }
    })

    it('includes epcList array in event results', async () => {
      const res = await epcisSearchRequest(app, { eventType: 'ObjectEvent' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as EPCISSearchResult
      if (body.results.length > 0) {
        const eventWithEpcs = body.results.find((e) => e.epcList)
        expect(eventWithEpcs?.epcList).toBeInstanceOf(Array)
      }
    })
  })
})
