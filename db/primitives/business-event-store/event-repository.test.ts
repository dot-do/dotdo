/**
 * EventRepository Tests
 *
 * GREEN phase: Tests for EventRepository with compound indexes.
 * Verifies efficient event querying with:
 * - Event storage with timestamps
 * - Compound indexes (type+time, source+type, etc.)
 * - Range queries (time windows)
 * - Cursor-based pagination
 * - Event filtering by multiple dimensions
 *
 * @module db/primitives/business-event-store/event-repository.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ObjectEvent,
  TransactionEvent,
  AggregationEvent,
  type BusinessEvent,
} from './index'
import {
  createEventRepository,
  createInMemoryEventRepository,
  type EventRepository,
  type EventCursor,
  type PaginatedResult,
} from './event-repository'

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const CUSTOMER_1 = 'customer:cust_123abc'
const CUSTOMER_2 = 'customer:cust_456def'
const ORDER_1 = 'order:ord_789ghi'
const ORDER_2 = 'order:ord_012jkl'
const PRODUCT_1 = 'urn:epc:id:sgtin:0614141.107346.2017'
const PRODUCT_2 = 'urn:epc:id:sgtin:0614141.107346.2018'
const SSCC_1 = 'urn:epc:id:sscc:0614141.1234567890'

const LOCATION_WAREHOUSE = 'urn:epc:id:sgln:0614141.00001.0'
const LOCATION_STORE = 'urn:epc:id:sgln:0614141.00002.0'
const LOCATION_FULFILLMENT = 'urn:epc:id:sgln:0614141.00003.0'

const PARTY_SELLER = 'urn:epc:id:pgln:0614141.00001'
const PARTY_BUYER = 'urn:epc:id:pgln:0614141.00002'

// ============================================================================
// BASIC STORAGE TESTS
// ============================================================================

describe('EventRepository - Basic Storage', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should store and retrieve a single event', async () => {
    const event = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
      why: 'customer_signup',
    })

    await repository.store(event)
    const retrieved = await repository.get(event.id)

    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(event.id)
    expect(retrieved?.what).toEqual([CUSTOMER_1])
    expect(retrieved?.why).toBe('customer_signup')
  })

  it('should store batch events', async () => {
    const events = [
      new ObjectEvent({
        what: [CUSTOMER_1],
        when: new Date('2024-06-15T10:00:00Z'),
        action: 'ADD',
      }),
      new ObjectEvent({
        what: [CUSTOMER_2],
        when: new Date('2024-06-15T11:00:00Z'),
        action: 'ADD',
      }),
      new ObjectEvent({
        what: [ORDER_1],
        when: new Date('2024-06-15T12:00:00Z'),
        action: 'ADD',
      }),
    ]

    await repository.storeBatch(events)

    for (const event of events) {
      const retrieved = await repository.get(event.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(event.id)
    }
  })

  it('should return null for non-existent event', async () => {
    const result = await repository.get('non-existent-id')
    expect(result).toBeNull()
  })

  it('should delete events', async () => {
    const event = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })

    await repository.store(event)
    expect(await repository.get(event.id)).not.toBeNull()

    const deleted = await repository.delete(event.id)
    expect(deleted).toBe(true)
    expect(await repository.get(event.id)).toBeNull()
  })

  it('should report correct backend type', () => {
    expect(repository.getBackendType()).toBe('memory')
  })
})

// ============================================================================
// COMPOUND INDEX TESTS - TYPE + TIME
// ============================================================================

describe('EventRepository - Compound Index: Type + Time', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should query events by type', async () => {
    const objectEvent = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'OBSERVE',
    })
    const txnEvent = new TransactionEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T11:00:00Z'),
      bizTransactionList: [{ type: 'purchase_order', value: 'PO-123' }],
      action: 'ADD',
    })
    const aggEvent = new AggregationEvent({
      parentID: SSCC_1,
      childEPCs: [PRODUCT_1, PRODUCT_2],
      when: new Date('2024-06-15T12:00:00Z'),
      action: 'ADD',
    })

    await repository.storeBatch([objectEvent, txnEvent, aggEvent])

    const objectResult = await repository.query({ type: 'ObjectEvent' })
    expect(objectResult.items).toHaveLength(1)
    expect(objectResult.items[0]?.type).toBe('ObjectEvent')

    const txnResult = await repository.query({ type: 'TransactionEvent' })
    expect(txnResult.items).toHaveLength(1)
    expect(txnResult.items[0]?.type).toBe('TransactionEvent')

    const aggResult = await repository.query({ type: 'AggregationEvent' })
    expect(aggResult.items).toHaveLength(1)
    expect(aggResult.items[0]?.type).toBe('AggregationEvent')
  })

  it('should query events by type + time range', async () => {
    const event1 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-01T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-30T10:00:00Z'),
      action: 'OBSERVE',
    })
    const txnEvent = new TransactionEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      bizTransactionList: [{ type: 'po', value: 'PO-1' }],
      action: 'ADD',
    })

    await repository.storeBatch([event1, event2, event3, txnEvent])

    const result = await repository.query({
      type: 'ObjectEvent',
      when: {
        gte: new Date('2024-06-10T00:00:00Z'),
        lte: new Date('2024-06-20T23:59:59Z'),
      },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event2.id)
  })

  it('should query multiple event types', async () => {
    const objectEvent = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'OBSERVE',
    })
    const txnEvent = new TransactionEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T11:00:00Z'),
      bizTransactionList: [{ type: 'po', value: 'PO-1' }],
      action: 'ADD',
    })
    const aggEvent = new AggregationEvent({
      parentID: SSCC_1,
      childEPCs: [PRODUCT_1],
      when: new Date('2024-06-15T12:00:00Z'),
      action: 'ADD',
    })

    await repository.storeBatch([objectEvent, txnEvent, aggEvent])

    const result = await repository.query({
      type: ['ObjectEvent', 'TransactionEvent'],
    })

    expect(result.items).toHaveLength(2)
    const types = result.items.map((e) => e.type)
    expect(types).toContain('ObjectEvent')
    expect(types).toContain('TransactionEvent')
    expect(types).not.toContain('AggregationEvent')
  })
})

// ============================================================================
// COMPOUND INDEX TESTS - SOURCE (WHAT) + TYPE
// ============================================================================

describe('EventRepository - Compound Index: What + Type', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should query by exact object ID', async () => {
    const event1 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [CUSTOMER_2],
      when: new Date('2024-06-15T11:00:00Z'),
      action: 'ADD',
    })
    const event3 = new ObjectEvent({
      what: [CUSTOMER_1, ORDER_1],
      when: new Date('2024-06-15T12:00:00Z'),
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({ what: CUSTOMER_1 })

    expect(result.items).toHaveLength(2)
    expect(result.items.map((e) => e.id)).toContain(event1.id)
    expect(result.items.map((e) => e.id)).toContain(event3.id)
    expect(result.items.map((e) => e.id)).not.toContain(event2.id)
  })

  it('should query by wildcard pattern', async () => {
    const event1 = new ObjectEvent({
      what: ['customer:cust_001'],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: ['customer:cust_002'],
      when: new Date('2024-06-15T11:00:00Z'),
      action: 'ADD',
    })
    const event3 = new ObjectEvent({
      what: ['order:ord_001'],
      when: new Date('2024-06-15T12:00:00Z'),
      action: 'ADD',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({ what: 'customer:.*' })

    expect(result.items).toHaveLength(2)
    expect(result.items.every((e) => e.what[0]?.startsWith('customer:'))).toBe(true)
  })

  it('should query by multiple object IDs (OR)', async () => {
    const event1 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [CUSTOMER_2],
      when: new Date('2024-06-15T11:00:00Z'),
      action: 'ADD',
    })
    const event3 = new ObjectEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T12:00:00Z'),
      action: 'ADD',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({ what: [CUSTOMER_1, CUSTOMER_2] })

    expect(result.items).toHaveLength(2)
    expect(result.items.map((e) => e.id)).toContain(event1.id)
    expect(result.items.map((e) => e.id)).toContain(event2.id)
  })
})

// ============================================================================
// COMPOUND INDEX TESTS - WHAT + TIME (Primary compound index)
// ============================================================================

describe('EventRepository - Compound Index: What + When', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should efficiently query object events in time range', async () => {
    const event1 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-01T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [CUSTOMER_2],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    const event4 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-30T10:00:00Z'),
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3, event4])

    const result = await repository.query({
      what: CUSTOMER_1,
      when: {
        gte: new Date('2024-06-10T00:00:00Z'),
        lte: new Date('2024-06-20T23:59:59Z'),
      },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event2.id)
  })

  it('should query object with wildcard in time range', async () => {
    const event1 = new ObjectEvent({
      what: ['customer:cust_001'],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: ['customer:cust_002'],
      when: new Date('2024-06-15T11:00:00Z'),
      action: 'ADD',
    })
    const event3 = new ObjectEvent({
      what: ['customer:cust_003'],
      when: new Date('2024-06-20T10:00:00Z'),
      action: 'ADD',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({
      what: 'customer:.*',
      when: {
        gte: new Date('2024-06-15T00:00:00Z'),
        lte: new Date('2024-06-15T23:59:59Z'),
      },
    })

    expect(result.items).toHaveLength(2)
    expect(result.items.map((e) => e.id)).toContain(event1.id)
    expect(result.items.map((e) => e.id)).toContain(event2.id)
  })
})

// ============================================================================
// COMPOUND INDEX TESTS - WHERE + TIME
// ============================================================================

describe('EventRepository - Compound Index: Where + When', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should query location events in time range', async () => {
    const event1 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-01T10:00:00Z'),
      where: LOCATION_WAREHOUSE,
      action: 'OBSERVE',
    })
    const event2 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      where: LOCATION_WAREHOUSE,
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [PRODUCT_2],
      when: new Date('2024-06-15T10:00:00Z'),
      where: LOCATION_STORE,
      action: 'OBSERVE',
    })
    const event4 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-30T10:00:00Z'),
      where: LOCATION_WAREHOUSE,
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3, event4])

    const result = await repository.query({
      where: LOCATION_WAREHOUSE,
      when: {
        gte: new Date('2024-06-10T00:00:00Z'),
        lte: new Date('2024-06-20T23:59:59Z'),
      },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event2.id)
  })

  it('should query multiple locations in time range', async () => {
    const event1 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      where: LOCATION_WAREHOUSE,
      action: 'OBSERVE',
    })
    const event2 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T11:00:00Z'),
      where: LOCATION_STORE,
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T12:00:00Z'),
      where: LOCATION_FULFILLMENT,
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({
      where: [LOCATION_WAREHOUSE, LOCATION_STORE],
    })

    expect(result.items).toHaveLength(2)
    expect(result.items.map((e) => e.id)).toContain(event1.id)
    expect(result.items.map((e) => e.id)).toContain(event2.id)
  })
})

// ============================================================================
// COMPOUND INDEX TESTS - WHY + TIME
// ============================================================================

describe('EventRepository - Compound Index: Why + When', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should query business step events in time range', async () => {
    const event1 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-01T10:00:00Z'),
      why: 'shipping',
      action: 'OBSERVE',
    })
    const event2 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      why: 'shipping',
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [PRODUCT_2],
      when: new Date('2024-06-15T10:00:00Z'),
      why: 'receiving',
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({
      why: 'shipping',
      when: {
        gte: new Date('2024-06-10T00:00:00Z'),
        lte: new Date('2024-06-20T23:59:59Z'),
      },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event2.id)
  })

  it('should query multiple business steps', async () => {
    const event1 = new ObjectEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      why: 'order_placed',
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T11:00:00Z'),
      why: 'payment_processed',
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T12:00:00Z'),
      why: 'order_shipped',
      action: 'OBSERVE',
    })
    const event4 = new ObjectEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T13:00:00Z'),
      why: 'order_delivered',
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3, event4])

    const result = await repository.query({
      why: ['order_placed', 'payment_processed', 'order_shipped'],
    })

    expect(result.items).toHaveLength(3)
    expect(result.items.map((e) => e.why)).not.toContain('order_delivered')
  })
})

// ============================================================================
// RANGE QUERIES (TIME WINDOWS)
// ============================================================================

describe('EventRepository - Range Queries (Time Windows)', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should query events within a time range', async () => {
    const event1 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-01T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-30T10:00:00Z'),
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({
      when: {
        gte: new Date('2024-06-10T00:00:00Z'),
        lte: new Date('2024-06-20T23:59:59Z'),
      },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event2.id)
  })

  it('should query events with open-ended start', async () => {
    const event1 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-01T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-30T10:00:00Z'),
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({
      when: {
        lte: new Date('2024-06-15T23:59:59Z'),
      },
    })

    expect(result.items).toHaveLength(2)
    expect(result.items.map((e) => e.id)).toContain(event1.id)
    expect(result.items.map((e) => e.id)).toContain(event2.id)
  })

  it('should query events with open-ended end', async () => {
    const event1 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-01T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-30T10:00:00Z'),
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({
      when: {
        gte: new Date('2024-06-15T00:00:00Z'),
      },
    })

    expect(result.items).toHaveLength(2)
    expect(result.items.map((e) => e.id)).toContain(event2.id)
    expect(result.items.map((e) => e.id)).toContain(event3.id)
  })

  it('should handle precise timestamp boundaries', async () => {
    const exactTime = new Date('2024-06-15T10:00:00.000Z')

    const event1 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T09:59:59.999Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: exactTime,
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00.001Z'),
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({
      when: {
        gte: exactTime,
        lte: exactTime,
      },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event2.id)
  })
})

// ============================================================================
// CURSOR-BASED PAGINATION
// ============================================================================

describe('EventRepository - Cursor-based Pagination', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should return paginated results with cursor', async () => {
    // Create 25 events
    const events: BusinessEvent[] = []
    for (let i = 0; i < 25; i++) {
      events.push(
        new ObjectEvent({
          what: [CUSTOMER_1],
          when: new Date(`2024-06-15T${String(i).padStart(2, '0')}:00:00Z`),
          action: 'OBSERVE',
        })
      )
    }
    await repository.storeBatch(events)

    // First page
    const page1 = await repository.query({ what: CUSTOMER_1 }, { limit: 10 })

    expect(page1.items).toHaveLength(10)
    expect(page1.hasMore).toBe(true)
    expect(page1.cursor).toBeDefined()

    // Second page using cursor
    const page2 = await repository.query(
      { what: CUSTOMER_1 },
      { limit: 10, cursor: page1.cursor }
    )

    expect(page2.items).toHaveLength(10)
    expect(page2.hasMore).toBe(true)
    expect(page2.cursor).toBeDefined()

    // No overlap between pages
    const page1Ids = new Set(page1.items.map((e) => e.id))
    const page2Ids = new Set(page2.items.map((e) => e.id))
    expect([...page1Ids].some((id) => page2Ids.has(id))).toBe(false)

    // Third page (last)
    const page3 = await repository.query(
      { what: CUSTOMER_1 },
      { limit: 10, cursor: page2.cursor }
    )

    expect(page3.items).toHaveLength(5)
    expect(page3.hasMore).toBe(false)
  })

  it('should support cursor with stable ordering', async () => {
    const timestamp = new Date('2024-06-15T10:00:00Z')
    const events: BusinessEvent[] = []
    for (let i = 0; i < 10; i++) {
      events.push(
        new ObjectEvent({
          what: [CUSTOMER_1],
          when: new Date(timestamp.getTime() + i * 1000), // 1 second apart
          why: `step_${i}`,
          action: 'OBSERVE',
        })
      )
    }
    await repository.storeBatch(events)

    // Collect all events using cursor iteration
    const collected: BusinessEvent[] = []
    let cursor: EventCursor | undefined

    do {
      const result = await repository.query(
        { what: CUSTOMER_1 },
        { limit: 3, cursor }
      )
      collected.push(...result.items)
      cursor = result.cursor
    } while (cursor)

    // Should have all events without duplicates
    expect(collected).toHaveLength(10)
    const ids = collected.map((e) => e.id)
    expect(new Set(ids).size).toBe(10)
  })

  it('should include total count when requested', async () => {
    const events: BusinessEvent[] = []
    for (let i = 0; i < 50; i++) {
      events.push(
        new ObjectEvent({
          what: [CUSTOMER_1],
          when: new Date(`2024-06-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`),
          action: 'OBSERVE',
        })
      )
    }
    await repository.storeBatch(events)

    const result = await repository.query(
      { what: CUSTOMER_1 },
      { limit: 10, includeTotal: true }
    )

    expect(result.items).toHaveLength(10)
    expect(result.total).toBe(50)
    expect(result.hasMore).toBe(true)
  })

  it('should support ascending and descending order', async () => {
    const event1 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T11:00:00Z'),
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T12:00:00Z'),
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3])

    // Descending (newest first - default)
    const descResult = await repository.query(
      { what: CUSTOMER_1 },
      { orderDirection: 'desc' }
    )

    expect(descResult.items[0]?.id).toBe(event3.id)
    expect(descResult.items[2]?.id).toBe(event1.id)

    // Ascending (oldest first)
    const ascResult = await repository.query(
      { what: CUSTOMER_1 },
      { orderDirection: 'asc' }
    )

    expect(ascResult.items[0]?.id).toBe(event1.id)
    expect(ascResult.items[2]?.id).toBe(event3.id)
  })
})

// ============================================================================
// MULTI-DIMENSIONAL FILTERING
// ============================================================================

describe('EventRepository - Multi-dimensional Filtering', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should filter by what + where + when', async () => {
    const event1 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      where: LOCATION_WAREHOUSE,
      action: 'OBSERVE',
    })
    const event2 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T11:00:00Z'),
      where: LOCATION_STORE,
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [PRODUCT_2],
      when: new Date('2024-06-15T10:00:00Z'),
      where: LOCATION_WAREHOUSE,
      action: 'OBSERVE',
    })
    const event4 = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-20T10:00:00Z'),
      where: LOCATION_WAREHOUSE,
      action: 'OBSERVE',
    })

    await repository.storeBatch([event1, event2, event3, event4])

    const result = await repository.query({
      what: PRODUCT_1,
      where: LOCATION_WAREHOUSE,
      when: {
        gte: new Date('2024-06-15T00:00:00Z'),
        lte: new Date('2024-06-15T23:59:59Z'),
      },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event1.id)
  })

  it('should filter by why + who + how', async () => {
    const event1 = new ObjectEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      why: 'order_shipped',
      who: PARTY_SELLER,
      how: 'standard_shipping',
      action: 'OBSERVE',
    })
    const event2 = new ObjectEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      why: 'order_shipped',
      who: PARTY_BUYER,
      how: 'standard_shipping',
      action: 'OBSERVE',
    })
    const event3 = new ObjectEvent({
      what: [ORDER_2],
      when: new Date('2024-06-15T10:00:00Z'),
      why: 'order_placed',
      who: PARTY_SELLER,
      how: 'standard_shipping',
      action: 'ADD',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository.query({
      why: 'order_shipped',
      who: PARTY_SELLER,
      how: 'standard_shipping',
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event1.id)
  })

  it('should filter by action type', async () => {
    const addEvent = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    const observeEvent = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T11:00:00Z'),
      action: 'OBSERVE',
    })
    const deleteEvent = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T12:00:00Z'),
      action: 'DELETE',
    })

    await repository.storeBatch([addEvent, observeEvent, deleteEvent])

    const result = await repository.query({ action: ['ADD', 'DELETE'] })

    expect(result.items).toHaveLength(2)
    expect(result.items.every((e) => ['ADD', 'DELETE'].includes(e.action!))).toBe(true)
  })

  it('should filter by extensions', async () => {
    const event1 = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
      extensions: { priority: 'high', source: 'web' },
    })
    const event2 = new ObjectEvent({
      what: [CUSTOMER_2],
      when: new Date('2024-06-15T11:00:00Z'),
      action: 'ADD',
      extensions: { priority: 'low', source: 'api' },
    })

    await repository.storeBatch([event1, event2])

    const result = await repository.query({
      extensions: { priority: 'high' },
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event1.id)
  })
})

// ============================================================================
// QUERY BUILDER API
// ============================================================================

describe('EventRepository - Query Builder API', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should support fluent query builder', async () => {
    const event1 = new ObjectEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      where: LOCATION_WAREHOUSE,
      why: 'order_shipped',
      action: 'OBSERVE',
    })

    await repository.store(event1)

    const result = await repository
      .queryBuilder()
      .what(ORDER_1)
      .when({
        gte: new Date('2024-06-15T00:00:00Z'),
        lte: new Date('2024-06-15T23:59:59Z'),
      })
      .where(LOCATION_WAREHOUSE)
      .why('order_shipped')
      .limit(10)
      .execute()

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(event1.id)
  })

  it('should support type filtering in query builder', async () => {
    const objectEvent = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'OBSERVE',
    })
    const txnEvent = new TransactionEvent({
      what: [ORDER_1],
      when: new Date('2024-06-15T11:00:00Z'),
      bizTransactionList: [{ type: 'purchase_order', value: 'PO-123' }],
      action: 'ADD',
    })

    await repository.storeBatch([objectEvent, txnEvent])

    const result = await repository
      .queryBuilder()
      .type('TransactionEvent')
      .execute()

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.type).toBe('TransactionEvent')
  })

  it('should support action filtering in query builder', async () => {
    const addEvent = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    const observeEvent = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T11:00:00Z'),
      action: 'OBSERVE',
    })
    const deleteEvent = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T12:00:00Z'),
      action: 'DELETE',
    })

    await repository.storeBatch([addEvent, observeEvent, deleteEvent])

    const result = await repository
      .queryBuilder()
      .action(['ADD', 'DELETE'])
      .execute()

    expect(result.items).toHaveLength(2)
    expect(result.items.every((e) => ['ADD', 'DELETE'].includes(e.action!))).toBe(true)
  })

  it('should support count operation', async () => {
    const events: BusinessEvent[] = []
    for (let i = 0; i < 50; i++) {
      events.push(
        new ObjectEvent({
          what: [CUSTOMER_1],
          when: new Date(`2024-06-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`),
          action: 'OBSERVE',
        })
      )
    }
    await repository.storeBatch(events)

    const count = await repository
      .queryBuilder()
      .what(CUSTOMER_1)
      .count()

    expect(count).toBe(50)
  })

  it('should support whatPrefix for type-based queries', async () => {
    const event1 = new ObjectEvent({
      what: ['customer:cust_001'],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    const event2 = new ObjectEvent({
      what: ['customer:cust_002'],
      when: new Date('2024-06-15T11:00:00Z'),
      action: 'ADD',
    })
    const event3 = new ObjectEvent({
      what: ['order:ord_001'],
      when: new Date('2024-06-15T12:00:00Z'),
      action: 'ADD',
    })

    await repository.storeBatch([event1, event2, event3])

    const result = await repository
      .queryBuilder()
      .whatPrefix('customer:')
      .execute()

    expect(result.items).toHaveLength(2)
    expect(result.items.every((e) => e.what[0]?.startsWith('customer:'))).toBe(true)
  })

  it('should support cursor chaining in query builder', async () => {
    const events: BusinessEvent[] = []
    for (let i = 0; i < 25; i++) {
      events.push(
        new ObjectEvent({
          what: [CUSTOMER_1],
          when: new Date(`2024-06-15T${String(i).padStart(2, '0')}:00:00Z`),
          action: 'OBSERVE',
        })
      )
    }
    await repository.storeBatch(events)

    // First page
    const page1 = await repository
      .queryBuilder()
      .what(CUSTOMER_1)
      .limit(10)
      .orderBy('when', 'desc')
      .execute()

    expect(page1.items).toHaveLength(10)
    expect(page1.cursor).toBeDefined()

    // Second page with cursor
    const page2 = await repository
      .queryBuilder()
      .what(CUSTOMER_1)
      .limit(10)
      .orderBy('when', 'desc')
      .cursor(page1.cursor!)
      .execute()

    expect(page2.items).toHaveLength(10)

    // No overlap
    const page1Ids = new Set(page1.items.map((e) => e.id))
    expect(page2.items.every((e) => !page1Ids.has(e.id))).toBe(true)
  })
})

// ============================================================================
// INDEX STATISTICS
// ============================================================================

describe('EventRepository - Index Statistics', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should report index statistics', async () => {
    const events = [
      new ObjectEvent({
        what: [CUSTOMER_1, ORDER_1],
        when: new Date('2024-06-15T10:00:00Z'),
        where: LOCATION_WAREHOUSE,
        why: 'order_placed',
        who: PARTY_SELLER,
        how: 'web',
        action: 'ADD',
      }),
      new ObjectEvent({
        what: [CUSTOMER_2],
        when: new Date('2024-06-15T11:00:00Z'),
        where: LOCATION_STORE,
        why: 'customer_signup',
        who: PARTY_BUYER,
        action: 'ADD',
      }),
    ]

    await repository.storeBatch(events)

    const stats = await repository.getIndexStats()

    expect(stats.totalEvents).toBe(2)
    expect(stats.indexedDimensions.what).toBe(3) // CUSTOMER_1, ORDER_1, CUSTOMER_2
    expect(stats.indexedDimensions.when).toBeGreaterThan(0)
    expect(stats.indexedDimensions.where).toBe(2) // WAREHOUSE, STORE
    expect(stats.indexedDimensions.why).toBe(2) // order_placed, customer_signup
    expect(stats.indexedDimensions.who).toBe(2) // SELLER, BUYER
    expect(stats.indexedDimensions.how).toBe(1) // web
    expect(stats.indexedDimensions.type).toBe(1) // ObjectEvent
    expect(stats.lastUpdated).toBeInstanceOf(Date)
  })

  it('should rebuild indexes', async () => {
    const event = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      where: LOCATION_WAREHOUSE,
      action: 'ADD',
    })

    await repository.store(event)

    // Rebuild indexes
    await repository.rebuildIndexes()

    // Verify event is still queryable
    const result = await repository.query({ what: CUSTOMER_1 })
    expect(result.items).toHaveLength(1)

    // Verify stats are correct
    const stats = await repository.getIndexStats()
    expect(stats.totalEvents).toBe(1)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('EventRepository - Edge Cases', () => {
  let repository: EventRepository

  beforeEach(() => {
    repository = createInMemoryEventRepository()
  })

  it('should handle empty query', async () => {
    const event = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    await repository.store(event)

    const result = await repository.query({})

    expect(result.items).toHaveLength(1)
  })

  it('should handle query with no matches', async () => {
    const event = new ObjectEvent({
      what: [CUSTOMER_1],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    await repository.store(event)

    const result = await repository.query({ what: 'nonexistent:id' })

    expect(result.items).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })

  it('should handle special characters in identifiers', async () => {
    const specialId = 'customer:special/chars:with:colons/and/slashes'

    const event = new ObjectEvent({
      what: [specialId],
      when: new Date('2024-06-15T10:00:00Z'),
      action: 'ADD',
    })
    await repository.store(event)

    const result = await repository.query({ what: specialId })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.what).toContain(specialId)
  })

  it('should handle Unicode in dimension values', async () => {
    const unicodeLocation = 'warehouse:Tokyo-\u6771\u4eac'
    const unicodeWhy = '\u51fa\u8377-shipping'

    const event = new ObjectEvent({
      what: [PRODUCT_1],
      when: new Date('2024-06-15T10:00:00Z'),
      where: unicodeLocation,
      why: unicodeWhy,
      action: 'OBSERVE',
    })
    await repository.store(event)

    const result = await repository.query({
      where: unicodeLocation,
      why: unicodeWhy,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.where).toBe(unicodeLocation)
    expect(result.items[0]?.why).toBe(unicodeWhy)
  })

  it('should handle large batch operations', async () => {
    // Create 1000 events
    const events: BusinessEvent[] = []
    for (let i = 0; i < 1000; i++) {
      events.push(
        new ObjectEvent({
          what: [`item:${i.toString().padStart(4, '0')}`],
          when: new Date(Date.now() + i * 1000),
          action: 'ADD',
        })
      )
    }

    await repository.storeBatch(events)

    const stats = await repository.getIndexStats()
    expect(stats.totalEvents).toBe(1000)
  })

  it('should handle events with same timestamp', async () => {
    const timestamp = new Date('2024-06-15T10:00:00Z')
    const events: BusinessEvent[] = []

    for (let i = 0; i < 10; i++) {
      events.push(
        new ObjectEvent({
          what: [CUSTOMER_1],
          when: timestamp,
          why: `step_${i}`,
          action: 'OBSERVE',
        })
      )
    }

    await repository.storeBatch(events)

    // Should be able to iterate through all with cursor
    const collected: BusinessEvent[] = []
    let cursor: EventCursor | undefined

    do {
      const result = await repository.query(
        { what: CUSTOMER_1 },
        { limit: 3, cursor }
      )
      collected.push(...result.items)
      cursor = result.cursor
    } while (cursor)

    expect(collected).toHaveLength(10)
    expect(new Set(collected.map((e) => e.id)).size).toBe(10)
  })
})

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

describe('EventRepository - Factory Functions', () => {
  it('should create in-memory repository by default', () => {
    const repo = createEventRepository()
    expect(repo.getBackendType()).toBe('memory')
  })

  it('should create in-memory repository with explicit config', () => {
    const repo = createEventRepository({ type: 'memory' })
    expect(repo.getBackendType()).toBe('memory')
  })

  it('should create in-memory repository via dedicated factory', () => {
    const repo = createInMemoryEventRepository()
    expect(repo.getBackendType()).toBe('memory')
  })
})
