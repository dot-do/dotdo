/**
 * Business EPCIS Transformer Tests
 *
 * Tests for transforming GS1 EPCIS (Electronic Product Code Information Services)
 * events to the unified event schema.
 *
 * EPCIS event types:
 * - ObjectEvent: Tracks what happened to objects (products/assets)
 * - AggregationEvent: Tracks packing/unpacking of objects
 * - TransactionEvent: Links objects to business transactions
 * - TransformationEvent: Tracks manufacturing/processing
 * - AssociationEvent: Tracks relationships between objects (EPCIS 2.0)
 */

import { describe, expect, it } from 'vitest'
import {
  transformEPCISEvent,
  transformEPCISEvents,
  BUSINESS_STEPS,
  DISPOSITIONS,
  type EPCISEvent,
  type EPCISTransformContext,
} from '../business-epcis'

describe('transformEPCISEvent', () => {
  // Helper to create a minimal valid EPCIS event
  function createMinimalEvent(overrides: Partial<EPCISEvent> = {}): EPCISEvent {
    return {
      eventType: 'ObjectEvent',
      eventTime: '2024-01-15T10:30:00Z',
      ...overrides,
    }
  }

  describe('BUSINESS_STEPS constant', () => {
    it('includes common shipping/receiving steps', () => {
      expect(BUSINESS_STEPS['urn:epcglobal:cbv:bizstep:shipping']).toBe('shipping')
      expect(BUSINESS_STEPS['urn:epcglobal:cbv:bizstep:receiving']).toBe('receiving')
    })

    it('includes warehouse operations', () => {
      expect(BUSINESS_STEPS['urn:epcglobal:cbv:bizstep:packing']).toBe('packing')
      expect(BUSINESS_STEPS['urn:epcglobal:cbv:bizstep:unpacking']).toBe('unpacking')
      expect(BUSINESS_STEPS['urn:epcglobal:cbv:bizstep:picking']).toBe('picking')
      expect(BUSINESS_STEPS['urn:epcglobal:cbv:bizstep:stocking']).toBe('stocking')
    })

    it('includes lifecycle steps', () => {
      expect(BUSINESS_STEPS['urn:epcglobal:cbv:bizstep:commissioning']).toBe('commissioning')
      expect(BUSINESS_STEPS['urn:epcglobal:cbv:bizstep:decommissioning']).toBe('decommissioning')
    })
  })

  describe('DISPOSITIONS constant', () => {
    it('includes transit dispositions', () => {
      expect(DISPOSITIONS['urn:epcglobal:cbv:disp:in_transit']).toBe('in_transit')
      expect(DISPOSITIONS['urn:epcglobal:cbv:disp:in_progress']).toBe('in_progress')
    })

    it('includes condition dispositions', () => {
      expect(DISPOSITIONS['urn:epcglobal:cbv:disp:damaged']).toBe('damaged')
      expect(DISPOSITIONS['urn:epcglobal:cbv:disp:expired']).toBe('expired')
      expect(DISPOSITIONS['urn:epcglobal:cbv:disp:destroyed']).toBe('destroyed')
    })

    it('includes sellability dispositions', () => {
      expect(DISPOSITIONS['urn:epcglobal:cbv:disp:sellable_accessible']).toBe('sellable_accessible')
      expect(DISPOSITIONS['urn:epcglobal:cbv:disp:retail_sold']).toBe('retail_sold')
    })
  })

  describe('core identity mapping', () => {
    it('sets event_type to track', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.event_type).toBe('track')
    })

    it('maps eventType to event_name', () => {
      const objectEvent = createMinimalEvent({ eventType: 'ObjectEvent' })
      const aggEvent = createMinimalEvent({ eventType: 'AggregationEvent' })
      const transEvent = createMinimalEvent({ eventType: 'TransactionEvent' })
      const transformEvent = createMinimalEvent({ eventType: 'TransformationEvent' })
      const assocEvent = createMinimalEvent({ eventType: 'AssociationEvent' })

      expect(transformEPCISEvent(objectEvent).event_name).toBe('ObjectEvent')
      expect(transformEPCISEvent(aggEvent).event_name).toBe('AggregationEvent')
      expect(transformEPCISEvent(transEvent).event_name).toBe('TransactionEvent')
      expect(transformEPCISEvent(transformEvent).event_name).toBe('TransformationEvent')
      expect(transformEPCISEvent(assocEvent).event_name).toBe('AssociationEvent')
    })

    it('generates a unique id', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.id).toBeDefined()
      expect(result.id.startsWith('epcis-')).toBe(true)
    })

    it('uses eventID if provided', () => {
      const event = createMinimalEvent({ eventID: 'event-12345' })
      const result = transformEPCISEvent(event)

      expect(result.id).toBe('epcis-event-12345')
    })

    it('generates different ids for different calls', () => {
      const event = createMinimalEvent()
      const result1 = transformEPCISEvent(event)
      const result2 = transformEPCISEvent(event)

      expect(result1.id).not.toBe(result2.id)
    })

    it('sets ns from context', () => {
      const event = createMinimalEvent()
      const context: EPCISTransformContext = { ns: 'supply-chain' }
      const result = transformEPCISEvent(event, context)

      expect(result.ns).toBe('supply-chain')
    })

    it('defaults ns to epcis when not provided', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.ns).toBe('epcis')
    })
  })

  describe('timestamp mapping', () => {
    it('maps eventTime to timestamp as ISO string', () => {
      const event = createMinimalEvent({ eventTime: '2024-01-15T10:30:00Z' })
      const result = transformEPCISEvent(event)

      expect(result.timestamp).toBe('2024-01-15T10:30:00.000Z')
    })

    it('handles timezone offset in eventTime', () => {
      const event = createMinimalEvent({ eventTime: '2024-01-15T10:30:00+05:00' })
      const result = transformEPCISEvent(event)

      // Should be converted to UTC
      expect(result.timestamp).toBe('2024-01-15T05:30:00.000Z')
    })

    it('preserves milliseconds', () => {
      const event = createMinimalEvent({ eventTime: '2024-01-15T10:30:00.123Z' })
      const result = transformEPCISEvent(event)

      expect(result.timestamp).toBe('2024-01-15T10:30:00.123Z')
    })
  })

  describe('business step mapping', () => {
    it('normalizes URN format bizStep to simple name', () => {
      const event = createMinimalEvent({
        bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
      })
      const result = transformEPCISEvent(event)

      expect(result.biz_step).toBe('shipping')
    })

    it('handles simple bizStep names', () => {
      const event = createMinimalEvent({ bizStep: 'shipping' })
      const result = transformEPCISEvent(event)

      expect(result.biz_step).toBe('shipping')
    })

    it('handles custom bizStep URNs', () => {
      const event = createMinimalEvent({
        bizStep: 'urn:example:custom:bizstep:quality_check',
      })
      const result = transformEPCISEvent(event)

      expect(result.biz_step).toBe('quality_check')
    })

    it('sets biz_step to null when not provided', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.biz_step).toBeNull()
    })
  })

  describe('disposition mapping', () => {
    it('normalizes URN format disposition to simple name', () => {
      const event = createMinimalEvent({
        disposition: 'urn:epcglobal:cbv:disp:in_transit',
      })
      const result = transformEPCISEvent(event)

      expect(result.biz_disposition).toBe('in_transit')
    })

    it('handles simple disposition names', () => {
      const event = createMinimalEvent({ disposition: 'in_transit' })
      const result = transformEPCISEvent(event)

      expect(result.biz_disposition).toBe('in_transit')
    })

    it('sets biz_disposition to null when not provided', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.biz_disposition).toBeNull()
    })
  })

  describe('location mapping', () => {
    it('maps readPoint.id to biz_read_point', () => {
      const event = createMinimalEvent({
        readPoint: { id: 'urn:epc:id:sgln:0614141.00001.0' },
      })
      const result = transformEPCISEvent(event)

      expect(result.biz_read_point).toBe('urn:epc:id:sgln:0614141.00001.0')
    })

    it('maps bizLocation.id to biz_location', () => {
      const event = createMinimalEvent({
        bizLocation: { id: 'urn:epc:id:sgln:0614141.00001.0' },
      })
      const result = transformEPCISEvent(event)

      expect(result.biz_location).toBe('urn:epc:id:sgln:0614141.00001.0')
    })

    it('sets locations to null when not provided', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.biz_read_point).toBeNull()
      expect(result.biz_location).toBeNull()
    })
  })

  describe('business transaction mapping', () => {
    it('extracts first bizTransaction to biz_transaction', () => {
      const event = createMinimalEvent({
        bizTransactionList: [
          { type: 'urn:epcglobal:cbv:btt:po', bizTransaction: 'PO-2024-001' },
          { type: 'urn:epcglobal:cbv:btt:inv', bizTransaction: 'INV-2024-001' },
        ],
      })
      const result = transformEPCISEvent(event)

      expect(result.biz_transaction).toBe('PO-2024-001')
    })

    it('handles empty bizTransactionList', () => {
      const event = createMinimalEvent({ bizTransactionList: [] })
      const result = transformEPCISEvent(event)

      expect(result.biz_transaction).toBeNull()
    })

    it('sets biz_transaction to null when not provided', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.biz_transaction).toBeNull()
    })
  })

  describe('action mapping', () => {
    it('maps ADD action to add verb', () => {
      const event = createMinimalEvent({ action: 'ADD' })
      const result = transformEPCISEvent(event)

      expect(result.action_verb).toBe('add')
    })

    it('maps OBSERVE action to observe verb', () => {
      const event = createMinimalEvent({ action: 'OBSERVE' })
      const result = transformEPCISEvent(event)

      expect(result.action_verb).toBe('observe')
    })

    it('maps DELETE action to remove verb', () => {
      const event = createMinimalEvent({ action: 'DELETE' })
      const result = transformEPCISEvent(event)

      expect(result.action_verb).toBe('remove')
    })

    it('defaults to observe when action not provided', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.action_verb).toBe('observe')
    })
  })

  describe('resource mapping', () => {
    it('extracts first EPC as resource_id', () => {
      const event = createMinimalEvent({
        epcList: [
          'urn:epc:id:sgtin:0614141.107346.2017',
          'urn:epc:id:sgtin:0614141.107346.2018',
        ],
      })
      const result = transformEPCISEvent(event)

      expect(result.resource_id).toBe('urn:epc:id:sgtin:0614141.107346.2017')
      expect(result.resource_type).toBe('product')
    })

    it('uses parentID as resource_id for AggregationEvent', () => {
      const event = createMinimalEvent({
        eventType: 'AggregationEvent',
        parentID: 'urn:epc:id:sscc:0614141.1234567890',
        childEPCs: ['urn:epc:id:sgtin:0614141.107346.2017'],
      })
      const result = transformEPCISEvent(event)

      expect(result.resource_id).toBe('urn:epc:id:sscc:0614141.1234567890')
      expect(result.resource_type).toBe('container')
    })

    it('sets resource_id to null when no EPCs', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.resource_id).toBeNull()
      expect(result.resource_type).toBeNull()
    })
  })

  describe('context mapping', () => {
    it('maps actorId from context', () => {
      const event = createMinimalEvent()
      const context: EPCISTransformContext = { actorId: 'operator-123' }
      const result = transformEPCISEvent(event, context)

      expect(result.actor_id).toBe('operator-123')
    })

    it('maps correlationId from context', () => {
      const event = createMinimalEvent()
      const context: EPCISTransformContext = { correlationId: 'shipment-xyz' }
      const result = transformEPCISEvent(event, context)

      expect(result.correlation_id).toBe('shipment-xyz')
    })
  })

  describe('data payload mapping', () => {
    it('stores epcList in data', () => {
      const event = createMinimalEvent({
        epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
      })
      const result = transformEPCISEvent(event)

      expect(result.data?.epcList).toEqual(['urn:epc:id:sgtin:0614141.107346.2017'])
    })

    it('stores childEPCs in data', () => {
      const event = createMinimalEvent({
        eventType: 'AggregationEvent',
        childEPCs: [
          'urn:epc:id:sgtin:0614141.107346.2017',
          'urn:epc:id:sgtin:0614141.107346.2018',
        ],
      })
      const result = transformEPCISEvent(event)

      expect(result.data?.childEPCs).toEqual([
        'urn:epc:id:sgtin:0614141.107346.2017',
        'urn:epc:id:sgtin:0614141.107346.2018',
      ])
    })

    it('stores bizTransactionList in data', () => {
      const transactions = [
        { type: 'urn:epcglobal:cbv:btt:po', bizTransaction: 'PO-2024-001' },
      ]
      const event = createMinimalEvent({ bizTransactionList: transactions })
      const result = transformEPCISEvent(event)

      expect(result.data?.bizTransactionList).toEqual(transactions)
    })

    it('stores extensions in data', () => {
      const event = createMinimalEvent({
        extensions: { temperature: 4.5, humidity: 65 },
      })
      const result = transformEPCISEvent(event)

      expect(result.data?.extensions).toEqual({ temperature: 4.5, humidity: 65 })
    })
  })

  describe('partition fields', () => {
    it('derives hour from eventTime', () => {
      const event = createMinimalEvent({ eventTime: '2024-01-15T14:30:00Z' })
      const result = transformEPCISEvent(event)

      expect(result.hour).toBe(14)
    })

    it('derives day from eventTime', () => {
      const event = createMinimalEvent({ eventTime: '2024-01-15T14:30:00Z' })
      const result = transformEPCISEvent(event)

      expect(result.day).toBe('2024-01-15')
    })

    it('sets event_source to epcis', () => {
      const event = createMinimalEvent()
      const result = transformEPCISEvent(event)

      expect(result.event_source).toBe('epcis')
    })
  })

  describe('complete event transformation', () => {
    it('transforms a full ObjectEvent', () => {
      const event: EPCISEvent = {
        eventType: 'ObjectEvent',
        eventTime: '2024-01-15T10:30:00Z',
        eventID: 'obj-event-001',
        epcList: [
          'urn:epc:id:sgtin:0614141.107346.2017',
          'urn:epc:id:sgtin:0614141.107346.2018',
        ],
        action: 'OBSERVE',
        bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
        disposition: 'urn:epcglobal:cbv:disp:in_transit',
        readPoint: { id: 'urn:epc:id:sgln:0614141.00001.1' },
        bizLocation: { id: 'urn:epc:id:sgln:0614141.00001.0' },
        bizTransactionList: [
          { type: 'urn:epcglobal:cbv:btt:po', bizTransaction: 'PO-2024-001' },
        ],
      }
      const context: EPCISTransformContext = {
        ns: 'warehouse',
        actorId: 'scanner-001',
        correlationId: 'shipment-abc',
      }

      const result = transformEPCISEvent(event, context)

      // Core identity
      expect(result.id).toBe('epcis-obj-event-001')
      expect(result.event_type).toBe('track')
      expect(result.event_name).toBe('ObjectEvent')
      expect(result.ns).toBe('warehouse')

      // Timing
      expect(result.timestamp).toBe('2024-01-15T10:30:00.000Z')

      // Business context
      expect(result.biz_step).toBe('shipping')
      expect(result.biz_disposition).toBe('in_transit')
      expect(result.biz_location).toBe('urn:epc:id:sgln:0614141.00001.0')
      expect(result.biz_read_point).toBe('urn:epc:id:sgln:0614141.00001.1')
      expect(result.biz_transaction).toBe('PO-2024-001')

      // Resource
      expect(result.resource_type).toBe('product')
      expect(result.resource_id).toBe('urn:epc:id:sgtin:0614141.107346.2017')

      // Actor
      expect(result.actor_id).toBe('scanner-001')
      expect(result.correlation_id).toBe('shipment-abc')

      // Action
      expect(result.action_verb).toBe('observe')

      // Partition
      expect(result.hour).toBe(10)
      expect(result.day).toBe('2024-01-15')
      expect(result.event_source).toBe('epcis')
    })

    it('transforms an AggregationEvent (packing)', () => {
      const event: EPCISEvent = {
        eventType: 'AggregationEvent',
        eventTime: '2024-01-15T08:00:00Z',
        parentID: 'urn:epc:id:sscc:0614141.1234567890',
        childEPCs: [
          'urn:epc:id:sgtin:0614141.107346.2017',
          'urn:epc:id:sgtin:0614141.107346.2018',
          'urn:epc:id:sgtin:0614141.107346.2019',
        ],
        action: 'ADD',
        bizStep: 'urn:epcglobal:cbv:bizstep:packing',
        disposition: 'urn:epcglobal:cbv:disp:container_closed',
      }

      const result = transformEPCISEvent(event)

      expect(result.event_name).toBe('AggregationEvent')
      expect(result.resource_type).toBe('container')
      expect(result.resource_id).toBe('urn:epc:id:sscc:0614141.1234567890')
      expect(result.action_verb).toBe('add')
      expect(result.biz_step).toBe('packing')
      expect(result.biz_disposition).toBe('container_closed')
      expect(result.data?.childEPCs).toHaveLength(3)
    })

    it('transforms a TransformationEvent', () => {
      const event: EPCISEvent = {
        eventType: 'TransformationEvent',
        eventTime: '2024-01-15T12:00:00Z',
        inputEPCList: [
          'urn:epc:id:sgtin:0614141.107346.1001',
          'urn:epc:id:sgtin:0614141.107346.1002',
        ],
        outputEPCList: ['urn:epc:id:sgtin:0614141.107347.2001'],
        bizStep: 'urn:epcglobal:cbv:bizstep:assembling',
        bizLocation: { id: 'urn:epc:id:sgln:0614141.00002.0' },
      }

      const result = transformEPCISEvent(event)

      expect(result.event_name).toBe('TransformationEvent')
      expect(result.biz_step).toBe('assembling')
      expect(result.data?.inputEPCList).toHaveLength(2)
      expect(result.data?.outputEPCList).toHaveLength(1)
    })

    it('transforms minimal event with defaults', () => {
      const event: EPCISEvent = {
        eventType: 'ObjectEvent',
        eventTime: '2024-01-15T10:30:00Z',
      }

      const result = transformEPCISEvent(event)

      expect(result.event_type).toBe('track')
      expect(result.event_name).toBe('ObjectEvent')
      expect(result.ns).toBe('epcis')
      expect(result.biz_step).toBeNull()
      expect(result.biz_disposition).toBeNull()
      expect(result.biz_location).toBeNull()
      expect(result.biz_read_point).toBeNull()
      expect(result.biz_transaction).toBeNull()
      expect(result.resource_id).toBeNull()
      expect(result.actor_id).toBeNull()
      expect(result.action_verb).toBe('observe')
    })
  })
})

describe('transformEPCISEvents', () => {
  it('transforms multiple events', () => {
    const events: EPCISEvent[] = [
      {
        eventType: 'ObjectEvent',
        eventTime: '2024-01-15T10:00:00Z',
        epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
        bizStep: 'urn:epcglobal:cbv:bizstep:commissioning',
      },
      {
        eventType: 'ObjectEvent',
        eventTime: '2024-01-15T11:00:00Z',
        epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
        bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
      },
    ]
    const context: EPCISTransformContext = { ns: 'supply-chain' }

    const results = transformEPCISEvents(events, context)

    expect(results).toHaveLength(2)
    expect(results[0].biz_step).toBe('commissioning')
    expect(results[1].biz_step).toBe('shipping')
    expect(results[0].ns).toBe('supply-chain')
    expect(results[1].ns).toBe('supply-chain')
  })

  it('applies context to all events', () => {
    const events: EPCISEvent[] = [
      { eventType: 'ObjectEvent', eventTime: '2024-01-15T10:00:00Z' },
      { eventType: 'ObjectEvent', eventTime: '2024-01-15T11:00:00Z' },
    ]
    const context: EPCISTransformContext = {
      ns: 'warehouse',
      actorId: 'system',
      correlationId: 'batch-001',
    }

    const results = transformEPCISEvents(events, context)

    expect(results[0].ns).toBe('warehouse')
    expect(results[0].actor_id).toBe('system')
    expect(results[0].correlation_id).toBe('batch-001')
    expect(results[1].ns).toBe('warehouse')
    expect(results[1].actor_id).toBe('system')
    expect(results[1].correlation_id).toBe('batch-001')
  })

  it('handles empty array', () => {
    const results = transformEPCISEvents([])

    expect(results).toEqual([])
  })
})
