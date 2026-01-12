/**
 * BusinessEventStore tests
 *
 * RED phase: These tests define the expected behavior of BusinessEventStore.
 * All tests should FAIL until implementation is complete.
 *
 * BusinessEventStore provides universal 5W+H event capture (EPCIS-extended):
 * - What: Object/Entity being tracked (EPC URN, product ID, customer ID)
 * - Where: Location/Context (physical location, service, endpoint)
 * - When: Timestamp with timezone
 * - Why: Business step/reason (shipping, receiving, payment)
 * - Who: Parties involved (organization, user, system)
 * - How: Method/disposition (in_transit, completed, manual)
 *
 * Event Types (EPCIS 2.0 compatible):
 * - ObjectEvent: Single object actions
 * - AggregationEvent: Object grouping/ungrouping
 * - TransactionEvent: Business transaction linking
 * - TransformationEvent: Object transformation (input->output)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  BusinessEventStore,
  createBusinessEventStore,
  // Event Types
  ObjectEvent,
  AggregationEvent,
  TransactionEvent,
  TransformationEvent,
  // Enums and Types
  type BusinessEvent,
  type EventAction,
  type BusinessStep,
  type Disposition,
  type BusinessTransaction,
  type SourceDest,
  type EPCList,
  type QuantityElement,
  type Party,
  type Location,
  type EventQuery,
  type ObjectHistory,
  type CausationChain,
  type EventLink,
  type EventLinkType,
} from './index'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestStore(): BusinessEventStore {
  return createBusinessEventStore()
}

// Sample EPCs (Electronic Product Codes)
const SGTIN_1 = 'urn:epc:id:sgtin:0614141.107346.2017'
const SGTIN_2 = 'urn:epc:id:sgtin:0614141.107346.2018'
const SGTIN_3 = 'urn:epc:id:sgtin:0614141.107346.2019'
const SSCC_1 = 'urn:epc:id:sscc:0614141.1234567890'
const SSCC_2 = 'urn:epc:id:sscc:0614141.1234567891'
const SGLN_WAREHOUSE = 'urn:epc:id:sgln:0614141.00001.0'
const SGLN_STORE = 'urn:epc:id:sgln:0614141.00002.0'
const PGLN_COMPANY = 'urn:epc:id:pgln:0614141.00001'

// ============================================================================
// EVENT SCHEMA TESTS (5W+H)
// ============================================================================

describe('BusinessEventStore', () => {
  describe('5W+H Event Schema', () => {
    describe('What (Object/Entity)', () => {
      it('should capture EPC identifiers', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1, SGTIN_2],
          when: new Date(),
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved).not.toBeNull()
        expect(retrieved?.what).toEqual([SGTIN_1, SGTIN_2])
      })

      it('should support quantity elements with class-level identifiers', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [],
          quantityList: [
            { epcClass: 'urn:epc:class:lgtin:0614141.107346.lot123', quantity: 100, uom: 'EA' },
            { epcClass: 'urn:epc:class:lgtin:0614141.107346.lot456', quantity: 50.5, uom: 'KGM' },
          ],
          when: new Date(),
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.quantityList).toHaveLength(2)
        expect(retrieved?.quantityList?.[0].quantity).toBe(100)
        expect(retrieved?.quantityList?.[1].uom).toBe('KGM')
      })

      it('should allow mixed EPC and quantity identifiers', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          quantityList: [
            { epcClass: 'urn:epc:class:lgtin:0614141.107346.lot789', quantity: 25 },
          ],
          when: new Date(),
          action: 'ADD',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.what).toHaveLength(1)
        expect(retrieved?.quantityList).toHaveLength(1)
      })
    })

    describe('When (Timestamp)', () => {
      it('should capture event time with full precision', async () => {
        const store = createTestStore()
        const eventTime = new Date('2024-06-15T10:30:00.123Z')

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: eventTime,
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.when.getTime()).toBe(eventTime.getTime())
      })

      it('should support timezone offset', async () => {
        const store = createTestStore()
        const eventTime = new Date('2024-06-15T10:30:00-05:00')

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: eventTime,
          whenTimezoneOffset: '-05:00',
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.whenTimezoneOffset).toBe('-05:00')
      })

      it('should capture record time separately from event time', async () => {
        const store = createTestStore()
        const eventTime = new Date('2024-06-15T10:30:00Z')

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: eventTime,
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        // Record time should be set automatically
        expect(retrieved?.recordTime).toBeDefined()
        expect(retrieved?.recordTime.getTime()).toBeGreaterThanOrEqual(eventTime.getTime())
      })
    })

    describe('Where (Location/Context)', () => {
      it('should capture read point (where event occurred)', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          where: SGLN_WAREHOUSE,
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.where).toBe(SGLN_WAREHOUSE)
      })

      it('should capture business location (where objects ended up)', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          where: SGLN_WAREHOUSE,
          bizLocation: SGLN_STORE,
          action: 'ADD',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.where).toBe(SGLN_WAREHOUSE)
        expect(retrieved?.bizLocation).toBe(SGLN_STORE)
      })

      it('should support source and destination locations', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'OBSERVE',
          sourceList: [
            { type: 'possessing_party', value: PGLN_COMPANY },
            { type: 'location', value: SGLN_WAREHOUSE },
          ],
          destinationList: [
            { type: 'location', value: SGLN_STORE },
          ],
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.sourceList).toHaveLength(2)
        expect(retrieved?.destinationList).toHaveLength(1)
      })
    })

    describe('Why (Business Step/Reason)', () => {
      it('should capture business step (what business operation)', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          why: 'shipping',
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.why).toBe('shipping')
      })

      it('should support CBV business step URNs', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          why: 'urn:epcglobal:cbv:bizstep:shipping',
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.why).toBe('urn:epcglobal:cbv:bizstep:shipping')
      })

      it('should capture custom business steps', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          why: 'customer_signup',
          action: 'ADD',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.why).toBe('customer_signup')
      })
    })

    describe('Who (Parties)', () => {
      it('should capture party performing the action', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'OBSERVE',
          who: PGLN_COMPANY,
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.who).toBe(PGLN_COMPANY)
      })

      it('should distinguish actor types (human, agent, system)', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'OBSERVE',
          who: 'user:alice@company.com',
          actorType: 'human',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.who).toBe('user:alice@company.com')
        expect(retrieved?.actorType).toBe('human')
      })

      it('should support AI/agent actors with confidence scores', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'ADD',
          who: 'agent:inventory-bot-v2',
          actorType: 'agent',
          confidence: 0.95,
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.actorType).toBe('agent')
        expect(retrieved?.confidence).toBe(0.95)
      })
    })

    describe('How (Method/Disposition)', () => {
      it('should capture disposition (state of objects)', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'OBSERVE',
          how: 'urn:epcglobal:cbv:disp:in_transit',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.how).toBe('urn:epcglobal:cbv:disp:in_transit')
      })

      it('should support channel information', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'ADD',
          channel: 'web',
          sessionId: 'sess_123abc',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.channel).toBe('web')
        expect(retrieved?.sessionId).toBe('sess_123abc')
      })

      it('should capture device/context information', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'OBSERVE',
          deviceId: 'scanner:warehouse-1-001',
          context: {
            firmware: '2.3.1',
            batteryLevel: 85,
          },
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.deviceId).toBe('scanner:warehouse-1-001')
        expect(retrieved?.context?.firmware).toBe('2.3.1')
      })
    })
  })

  // ============================================================================
  // EVENT TYPE TESTS (EPCIS 2.0)
  // ============================================================================

  describe('Event Types (EPCIS 2.0)', () => {
    describe('ObjectEvent', () => {
      it('should support OBSERVE action', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'OBSERVE',
        })

        expect(event.type).toBe('ObjectEvent')
        expect(event.action).toBe('OBSERVE')

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.type).toBe('ObjectEvent')
        expect(retrieved?.action).toBe('OBSERVE')
      })

      it('should support ADD action', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'ADD',
          why: 'commissioning',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.action).toBe('ADD')
      })

      it('should support DELETE action', async () => {
        const store = createTestStore()

        const event = new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'DELETE',
          why: 'destroying',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.action).toBe('DELETE')
      })
    })

    describe('AggregationEvent', () => {
      it('should link parent container to child objects', async () => {
        const store = createTestStore()

        const event = new AggregationEvent({
          parentID: SSCC_1,
          childEPCs: [SGTIN_1, SGTIN_2, SGTIN_3],
          when: new Date(),
          action: 'ADD',
          why: 'packing',
        })

        expect(event.type).toBe('AggregationEvent')

        const id = await store.capture(event)
        const retrieved = await store.get(id) as AggregationEvent

        expect(retrieved?.parentID).toBe(SSCC_1)
        expect(retrieved?.childEPCs).toEqual([SGTIN_1, SGTIN_2, SGTIN_3])
      })

      it('should support child quantity elements', async () => {
        const store = createTestStore()

        const event = new AggregationEvent({
          parentID: SSCC_1,
          childEPCs: [],
          childQuantityList: [
            { epcClass: 'urn:epc:class:lgtin:0614141.107346.lot001', quantity: 500 },
          ],
          when: new Date(),
          action: 'ADD',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id) as AggregationEvent

        expect(retrieved?.childQuantityList).toHaveLength(1)
      })

      it('should support OBSERVE action for aggregation state', async () => {
        const store = createTestStore()

        const event = new AggregationEvent({
          parentID: SSCC_1,
          childEPCs: [SGTIN_1],
          when: new Date(),
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.action).toBe('OBSERVE')
      })

      it('should support DELETE action for unpacking', async () => {
        const store = createTestStore()

        const event = new AggregationEvent({
          parentID: SSCC_1,
          childEPCs: [SGTIN_1, SGTIN_2],
          when: new Date(),
          action: 'DELETE',
          why: 'unpacking',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id)

        expect(retrieved?.action).toBe('DELETE')
      })
    })

    describe('TransactionEvent', () => {
      it('should link business transactions to objects', async () => {
        const store = createTestStore()

        const event = new TransactionEvent({
          what: [SSCC_1],
          bizTransactionList: [
            { type: 'purchase_order', value: 'PO-12345' },
            { type: 'invoice', value: 'INV-67890' },
          ],
          when: new Date(),
          action: 'ADD',
        })

        expect(event.type).toBe('TransactionEvent')

        const id = await store.capture(event)
        const retrieved = await store.get(id) as TransactionEvent

        expect(retrieved?.bizTransactionList).toHaveLength(2)
        expect(retrieved?.bizTransactionList[0].type).toBe('purchase_order')
        expect(retrieved?.bizTransactionList[1].value).toBe('INV-67890')
      })

      it('should support parent ID for container-level transactions', async () => {
        const store = createTestStore()

        const event = new TransactionEvent({
          parentID: SSCC_1,
          what: [SGTIN_1, SGTIN_2],
          bizTransactionList: [
            { type: 'despatch_advice', value: 'DA-001' },
          ],
          when: new Date(),
          action: 'ADD',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id) as TransactionEvent

        expect(retrieved?.parentID).toBe(SSCC_1)
      })

      it('should support CBV transaction types', async () => {
        const store = createTestStore()

        const event = new TransactionEvent({
          what: [SGTIN_1],
          bizTransactionList: [
            { type: 'urn:epcglobal:cbv:btt:po', value: 'PO-STANDARD' },
          ],
          when: new Date(),
          action: 'OBSERVE',
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id) as TransactionEvent

        expect(retrieved?.bizTransactionList[0].type).toBe('urn:epcglobal:cbv:btt:po')
      })
    })

    describe('TransformationEvent', () => {
      it('should capture input/output transformation', async () => {
        const store = createTestStore()

        const event = new TransformationEvent({
          inputEPCList: [SGTIN_1, SGTIN_2],
          outputEPCList: [SGTIN_3],
          when: new Date(),
          why: 'transforming',
        })

        expect(event.type).toBe('TransformationEvent')

        const id = await store.capture(event)
        const retrieved = await store.get(id) as TransformationEvent

        expect(retrieved?.inputEPCList).toEqual([SGTIN_1, SGTIN_2])
        expect(retrieved?.outputEPCList).toEqual([SGTIN_3])
      })

      it('should support input/output quantity elements', async () => {
        const store = createTestStore()

        const event = new TransformationEvent({
          inputEPCList: [],
          inputQuantityList: [
            { epcClass: 'urn:epc:class:lgtin:raw.material.001', quantity: 100, uom: 'KGM' },
          ],
          outputEPCList: [],
          outputQuantityList: [
            { epcClass: 'urn:epc:class:lgtin:finished.product.001', quantity: 95, uom: 'KGM' },
          ],
          when: new Date(),
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id) as TransformationEvent

        expect(retrieved?.inputQuantityList?.[0].quantity).toBe(100)
        expect(retrieved?.outputQuantityList?.[0].quantity).toBe(95)
      })

      it('should capture transformation ID for multi-step processes', async () => {
        const store = createTestStore()

        const event = new TransformationEvent({
          transformationID: 'urn:uuid:transformation-batch-001',
          inputEPCList: [SGTIN_1],
          outputEPCList: [SGTIN_2, SGTIN_3],
          when: new Date(),
        })

        const id = await store.capture(event)
        const retrieved = await store.get(id) as TransformationEvent

        expect(retrieved?.transformationID).toBe('urn:uuid:transformation-batch-001')
      })
    })
  })

  // ============================================================================
  // EVENT CAPTURE AND RETRIEVAL TESTS
  // ============================================================================

  describe('Event Capture and Retrieval', () => {
    it('should generate unique event IDs', async () => {
      const store = createTestStore()

      const event1 = new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'OBSERVE' })
      const event2 = new ObjectEvent({ what: [SGTIN_2], when: new Date(), action: 'OBSERVE' })

      const id1 = await store.capture(event1)
      const id2 = await store.capture(event2)

      expect(id1).not.toBe(id2)
      expect(typeof id1).toBe('string')
      expect(id1.length).toBeGreaterThan(0)
    })

    it('should retrieve event by ID', async () => {
      const store = createTestStore()

      const event = new ObjectEvent({
        what: [SGTIN_1, SGTIN_2],
        when: new Date('2024-06-15T10:00:00Z'),
        action: 'ADD',
        why: 'commissioning',
        where: SGLN_WAREHOUSE,
      })

      const id = await store.capture(event)
      const retrieved = await store.get(id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.what).toEqual([SGTIN_1, SGTIN_2])
      expect(retrieved?.why).toBe('commissioning')
    })

    it('should return null for non-existent event ID', async () => {
      const store = createTestStore()

      const result = await store.get('non-existent-id')

      expect(result).toBeNull()
    })

    it('should capture batch events atomically', async () => {
      const store = createTestStore()

      const events = [
        new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'OBSERVE' }),
        new ObjectEvent({ what: [SGTIN_2], when: new Date(), action: 'OBSERVE' }),
        new ObjectEvent({ what: [SGTIN_3], when: new Date(), action: 'OBSERVE' }),
      ]

      const ids = await store.captureBatch(events)

      expect(ids).toHaveLength(3)

      for (const id of ids) {
        const retrieved = await store.get(id)
        expect(retrieved).not.toBeNull()
      }
    })
  })

  // ============================================================================
  // QUERY TESTS
  // ============================================================================

  describe('Event Query', () => {
    describe('Temporal Queries', () => {
      it('should query events by time range', async () => {
        const store = createTestStore()

        const t1 = new Date('2024-06-01T00:00:00Z')
        const t2 = new Date('2024-06-15T00:00:00Z')
        const t3 = new Date('2024-06-30T00:00:00Z')

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: t1, action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_2], when: t2, action: 'OBSERVE' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_3], when: t3, action: 'DELETE' }))

        const results = await store.query({
          when: {
            gte: new Date('2024-06-10T00:00:00Z'),
            lte: new Date('2024-06-20T00:00:00Z'),
          },
        })

        expect(results).toHaveLength(1)
        expect(results[0].what).toContain(SGTIN_2)
      })

      it('should query events after a specific time', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date('2024-06-01'), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_2], when: new Date('2024-06-15'), action: 'ADD' }))

        const results = await store.query({
          when: { gte: new Date('2024-06-10') },
        })

        expect(results).toHaveLength(1)
      })

      it('should query events before a specific time', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date('2024-06-01'), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_2], when: new Date('2024-06-15'), action: 'ADD' }))

        const results = await store.query({
          when: { lte: new Date('2024-06-10') },
        })

        expect(results).toHaveLength(1)
      })
    })

    describe('Object Queries', () => {
      it('should query events by exact EPC match', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_2], when: new Date(), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'OBSERVE' }))

        const results = await store.query({ what: SGTIN_1 })

        expect(results).toHaveLength(2)
        results.forEach((r) => expect(r.what).toContain(SGTIN_1))
      })

      it('should query events by EPC wildcard pattern', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: ['urn:epc:id:sgtin:0614141.107346.001'], when: new Date(), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: ['urn:epc:id:sgtin:0614141.107346.002'], when: new Date(), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: ['urn:epc:id:sgtin:0614141.999999.001'], when: new Date(), action: 'ADD' }))

        const results = await store.query({ what: 'urn:epc:id:sgtin:0614141.107346.*' })

        expect(results).toHaveLength(2)
      })

      it('should query events by multiple EPCs', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_2], when: new Date(), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_3], when: new Date(), action: 'ADD' }))

        const results = await store.query({ what: [SGTIN_1, SGTIN_3] })

        expect(results).toHaveLength(2)
      })
    })

    describe('Business Step Queries', () => {
      it('should query events by business step', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'OBSERVE', why: 'shipping' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_2], when: new Date(), action: 'OBSERVE', why: 'receiving' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_3], when: new Date(), action: 'OBSERVE', why: 'shipping' }))

        const results = await store.query({ why: 'shipping' })

        expect(results).toHaveLength(2)
      })

      it('should query events by multiple business steps', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'OBSERVE', why: 'shipping' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_2], when: new Date(), action: 'OBSERVE', why: 'receiving' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_3], when: new Date(), action: 'OBSERVE', why: 'storing' }))

        const results = await store.query({ why: ['shipping', 'receiving'] })

        expect(results).toHaveLength(2)
      })
    })

    describe('Location Queries', () => {
      it('should query events by location', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'OBSERVE', where: SGLN_WAREHOUSE }))
        await store.capture(new ObjectEvent({ what: [SGTIN_2], when: new Date(), action: 'OBSERVE', where: SGLN_STORE }))

        const results = await store.query({ where: SGLN_WAREHOUSE })

        expect(results).toHaveLength(1)
        expect(results[0].where).toBe(SGLN_WAREHOUSE)
      })
    })

    describe('Event Type Queries', () => {
      it('should query events by type', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'ADD' }))
        await store.capture(new AggregationEvent({ parentID: SSCC_1, childEPCs: [SGTIN_2], when: new Date(), action: 'ADD' }))
        await store.capture(new TransactionEvent({ what: [SGTIN_3], bizTransactionList: [{ type: 'po', value: 'PO1' }], when: new Date(), action: 'ADD' }))

        const objectEvents = await store.query({ type: 'ObjectEvent' })
        const aggEvents = await store.query({ type: 'AggregationEvent' })

        expect(objectEvents).toHaveLength(1)
        expect(aggEvents).toHaveLength(1)
      })
    })

    describe('Compound Queries', () => {
      it('should combine multiple query dimensions', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({
          what: [SGTIN_1],
          when: new Date('2024-06-15'),
          action: 'OBSERVE',
          where: SGLN_WAREHOUSE,
          why: 'shipping',
        }))
        await store.capture(new ObjectEvent({
          what: [SGTIN_2],
          when: new Date('2024-06-15'),
          action: 'OBSERVE',
          where: SGLN_WAREHOUSE,
          why: 'receiving',
        }))
        await store.capture(new ObjectEvent({
          what: [SGTIN_3],
          when: new Date('2024-06-20'),
          action: 'OBSERVE',
          where: SGLN_WAREHOUSE,
          why: 'shipping',
        }))

        const results = await store.query({
          where: SGLN_WAREHOUSE,
          why: 'shipping',
          when: {
            gte: new Date('2024-06-10'),
            lte: new Date('2024-06-17'),
          },
        })

        expect(results).toHaveLength(1)
        expect(results[0].what).toContain(SGTIN_1)
      })
    })

    describe('Pagination', () => {
      it('should support limit and offset', async () => {
        const store = createTestStore()

        for (let i = 0; i < 10; i++) {
          await store.capture(new ObjectEvent({
            what: [`urn:epc:id:sgtin:0614141.107346.${i.toString().padStart(4, '0')}`],
            when: new Date(Date.now() + i * 1000),
            action: 'ADD',
          }))
        }

        const page1 = await store.query({}, { limit: 3, offset: 0 })
        const page2 = await store.query({}, { limit: 3, offset: 3 })

        expect(page1).toHaveLength(3)
        expect(page2).toHaveLength(3)
        // Ensure no overlap
        const page1Ids = new Set(page1.map((e) => e.id))
        const page2Ids = new Set(page2.map((e) => e.id))
        expect([...page1Ids].some((id) => page2Ids.has(id))).toBe(false)
      })

      it('should order by time descending by default', async () => {
        const store = createTestStore()

        await store.capture(new ObjectEvent({ what: [SGTIN_1], when: new Date('2024-06-01'), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_2], when: new Date('2024-06-15'), action: 'ADD' }))
        await store.capture(new ObjectEvent({ what: [SGTIN_3], when: new Date('2024-06-10'), action: 'ADD' }))

        const results = await store.query({})

        expect(results[0].when.getTime()).toBeGreaterThanOrEqual(results[1].when.getTime())
        expect(results[1].when.getTime()).toBeGreaterThanOrEqual(results[2].when.getTime())
      })
    })
  })

  // ============================================================================
  // OBJECT TRACKING TESTS
  // ============================================================================

  describe('Object Tracking', () => {
    it('should track object lifecycle', async () => {
      const store = createTestStore()

      // Commissioning
      await store.capture(new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-01T10:00:00Z'),
        action: 'ADD',
        why: 'commissioning',
        where: SGLN_WAREHOUSE,
      }))

      // Packing into container
      await store.capture(new AggregationEvent({
        parentID: SSCC_1,
        childEPCs: [SGTIN_1],
        when: new Date('2024-06-02T10:00:00Z'),
        action: 'ADD',
        why: 'packing',
      }))

      // Shipping
      await store.capture(new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-03T10:00:00Z'),
        action: 'OBSERVE',
        why: 'shipping',
        how: 'urn:epcglobal:cbv:disp:in_transit',
      }))

      // Receiving
      await store.capture(new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-05T10:00:00Z'),
        action: 'OBSERVE',
        why: 'receiving',
        where: SGLN_STORE,
        how: 'urn:epcglobal:cbv:disp:in_progress',
      }))

      const history = await store.trackObject(SGTIN_1)

      expect(history.objectId).toBe(SGTIN_1)
      expect(history.events).toHaveLength(4)
      expect(history.events[0].why).toBe('commissioning')
      expect(history.events[3].where).toBe(SGLN_STORE)
    })

    it('should get current object state', async () => {
      const store = createTestStore()

      await store.capture(new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-01'),
        action: 'ADD',
        where: SGLN_WAREHOUSE,
        how: 'urn:epcglobal:cbv:disp:active',
      }))

      await store.capture(new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-05'),
        action: 'OBSERVE',
        where: SGLN_STORE,
        how: 'urn:epcglobal:cbv:disp:sellable_accessible',
      }))

      const history = await store.trackObject(SGTIN_1)

      expect(history.currentState?.location).toBe(SGLN_STORE)
      expect(history.currentState?.disposition).toBe('urn:epcglobal:cbv:disp:sellable_accessible')
    })

    it('should track object through aggregation events', async () => {
      const store = createTestStore()

      // Pack items into container
      await store.capture(new AggregationEvent({
        parentID: SSCC_1,
        childEPCs: [SGTIN_1, SGTIN_2],
        when: new Date('2024-06-01'),
        action: 'ADD',
      }))

      const history1 = await store.trackObject(SGTIN_1)
      const history2 = await store.trackObject(SGTIN_2)

      expect(history1.currentState?.parentContainer).toBe(SSCC_1)
      expect(history2.currentState?.parentContainer).toBe(SSCC_1)
    })

    it('should return empty history for unknown object', async () => {
      const store = createTestStore()

      const history = await store.trackObject('urn:epc:id:sgtin:unknown.object.001')

      expect(history.events).toHaveLength(0)
      expect(history.currentState).toBeUndefined()
    })
  })

  // ============================================================================
  // EVENT LINKING TESTS
  // ============================================================================

  describe('Event Linking', () => {
    describe('Causation Chains', () => {
      it('should link events with causation relationship', async () => {
        const store = createTestStore()

        const orderId = await store.capture(new ObjectEvent({
          what: ['order:12345'],
          when: new Date('2024-06-01T10:00:00Z'),
          action: 'ADD',
          why: 'order_created',
        }))

        const paymentId = await store.capture(new ObjectEvent({
          what: ['payment:67890'],
          when: new Date('2024-06-01T10:01:00Z'),
          action: 'ADD',
          why: 'payment_processed',
          causedBy: orderId,
        }))

        const fulfillmentId = await store.capture(new ObjectEvent({
          what: ['shipment:11111'],
          when: new Date('2024-06-01T10:02:00Z'),
          action: 'ADD',
          why: 'order_fulfilled',
          causedBy: paymentId,
        }))

        const chain = await store.getCausationChain(fulfillmentId)

        expect(chain.root.id).toBe(orderId)
        expect(chain.events).toHaveLength(3)
        expect(chain.depth).toBe(3)
      })

      it('should get event descendants (effects)', async () => {
        const store = createTestStore()

        const rootId = await store.capture(new ObjectEvent({
          what: ['trigger:001'],
          when: new Date(),
          action: 'ADD',
        }))

        const child1Id = await store.capture(new ObjectEvent({
          what: ['effect:001'],
          when: new Date(),
          action: 'ADD',
          causedBy: rootId,
        }))

        const child2Id = await store.capture(new ObjectEvent({
          what: ['effect:002'],
          when: new Date(),
          action: 'ADD',
          causedBy: rootId,
        }))

        const descendants = await store.getEventDescendants(rootId)

        expect(descendants).toHaveLength(2)
        expect(descendants.map((e) => e.id)).toContain(child1Id)
        expect(descendants.map((e) => e.id)).toContain(child2Id)
      })
    })

    describe('Parent-Child Relationships', () => {
      it('should link events with parent-child relationship', async () => {
        const store = createTestStore()

        const batchId = await store.capture(new ObjectEvent({
          what: ['batch:001'],
          when: new Date(),
          action: 'ADD',
          why: 'batch_started',
        }))

        const item1Id = await store.capture(new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'ADD',
          parentEventId: batchId,
        }))

        const item2Id = await store.capture(new ObjectEvent({
          what: [SGTIN_2],
          when: new Date(),
          action: 'ADD',
          parentEventId: batchId,
        }))

        const children = await store.getChildEvents(batchId)

        expect(children).toHaveLength(2)
      })

      it('should get parent event', async () => {
        const store = createTestStore()

        const parentId = await store.capture(new ObjectEvent({
          what: ['parent:001'],
          when: new Date(),
          action: 'ADD',
        }))

        const childId = await store.capture(new ObjectEvent({
          what: ['child:001'],
          when: new Date(),
          action: 'ADD',
          parentEventId: parentId,
        }))

        const child = await store.get(childId)
        expect(child?.parentEventId).toBe(parentId)

        const parent = await store.getParentEvent(childId)
        expect(parent?.id).toBe(parentId)
      })
    })

    describe('Related Events', () => {
      it('should link related events bidirectionally', async () => {
        const store = createTestStore()

        const event1Id = await store.capture(new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'OBSERVE',
        }))

        const event2Id = await store.capture(new ObjectEvent({
          what: [SGTIN_2],
          when: new Date(),
          action: 'OBSERVE',
        }))

        await store.linkEvents(event1Id, event2Id, 'related')

        const links1 = await store.getEventLinks(event1Id)
        const links2 = await store.getEventLinks(event2Id)

        expect(links1.some((l) => l.targetId === event2Id && l.type === 'related')).toBe(true)
        expect(links2.some((l) => l.targetId === event1Id && l.type === 'related')).toBe(true)
      })
    })

    describe('Correlation IDs', () => {
      it('should correlate events by correlation ID', async () => {
        const store = createTestStore()
        const correlationId = 'req:abc123'

        await store.capture(new ObjectEvent({
          what: ['step:1'],
          when: new Date('2024-06-01T10:00:00Z'),
          action: 'ADD',
          correlationId,
        }))

        await store.capture(new ObjectEvent({
          what: ['step:2'],
          when: new Date('2024-06-01T10:00:01Z'),
          action: 'ADD',
          correlationId,
        }))

        await store.capture(new ObjectEvent({
          what: ['step:3'],
          when: new Date('2024-06-01T10:00:02Z'),
          action: 'ADD',
          correlationId,
        }))

        await store.capture(new ObjectEvent({
          what: ['other:1'],
          when: new Date('2024-06-01T10:00:03Z'),
          action: 'ADD',
          correlationId: 'req:other',
        }))

        const correlated = await store.getCorrelatedEvents(correlationId)

        expect(correlated).toHaveLength(3)
      })
    })
  })

  // ============================================================================
  // EXTENSION FIELDS TESTS
  // ============================================================================

  describe('Extension Fields', () => {
    it('should support custom extension fields', async () => {
      const store = createTestStore()

      const event = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date(),
        action: 'OBSERVE',
        extensions: {
          'example:temperature': 22.5,
          'example:humidity': 45,
          'custom:notes': 'Quality check passed',
        },
      })

      const id = await store.capture(event)
      const retrieved = await store.get(id)

      expect(retrieved?.extensions?.['example:temperature']).toBe(22.5)
      expect(retrieved?.extensions?.['custom:notes']).toBe('Quality check passed')
    })

    it('should query by extension fields', async () => {
      const store = createTestStore()

      await store.capture(new ObjectEvent({
        what: [SGTIN_1],
        when: new Date(),
        action: 'OBSERVE',
        extensions: { 'custom:priority': 'high' },
      }))

      await store.capture(new ObjectEvent({
        what: [SGTIN_2],
        when: new Date(),
        action: 'OBSERVE',
        extensions: { 'custom:priority': 'low' },
      }))

      const results = await store.query({
        extensions: { 'custom:priority': 'high' },
      })

      expect(results).toHaveLength(1)
      expect(results[0].what).toContain(SGTIN_1)
    })
  })

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('should reject events without required fields', async () => {
      // Validation happens in constructor, so we expect a synchronous throw
      expect(() => {
        // @ts-expect-error - Testing runtime validation
        new ObjectEvent({
          // missing 'what' and 'when'
          action: 'OBSERVE',
        })
      }).toThrow()
    })

    it('should reject invalid action types', async () => {
      // Validation happens in constructor, so we expect a synchronous throw
      expect(() => {
        // @ts-expect-error - Testing runtime validation
        new ObjectEvent({
          what: [SGTIN_1],
          when: new Date(),
          action: 'INVALID_ACTION',
        })
      }).toThrow()
    })

    it('should reject linking non-existent events', async () => {
      const store = createTestStore()

      const eventId = await store.capture(new ObjectEvent({
        what: [SGTIN_1],
        when: new Date(),
        action: 'OBSERVE',
      }))

      await expect(store.linkEvents(eventId, 'non-existent-id', 'related')).rejects.toThrow()
    })
  })
})
