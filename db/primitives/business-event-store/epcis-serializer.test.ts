/**
 * EPCIS 2.0 Serializer/Deserializer Tests
 *
 * Tests for bidirectional mapping between internal BusinessEvent format and EPCIS 2.0:
 * - JSON-LD serialization with @context
 * - XML serialization (GS1 EPCIS 2.0 schema)
 * - CBV vocabulary integration
 * - All standard event types (ObjectEvent, AggregationEvent, TransactionEvent, TransformationEvent)
 *
 * Reference: https://ref.gs1.org/standards/epcis/
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Serializers
  EPCISSerializer,
  EPCISJsonLdSerializer,
  EPCISXmlSerializer,
  // Types
  type EPCISDocument,
  type EPCISEvent,
  type EPCISObjectEvent,
  type EPCISAggregationEvent,
  type EPCISTransactionEvent,
  type EPCISTransformationEvent,
  // CBV vocabulary helpers
  CBV,
  // Bidirectional mappers
  toEPCIS,
  fromEPCIS,
} from './epcis-serializer'
import {
  BusinessEvent,
  ObjectEvent,
  AggregationEvent,
  TransactionEvent,
  TransformationEvent,
} from './index'

// ============================================================================
// Test Data
// ============================================================================

// Sample EPCs (Electronic Product Codes)
const SGTIN_1 = 'urn:epc:id:sgtin:0614141.107346.2017'
const SGTIN_2 = 'urn:epc:id:sgtin:0614141.107346.2018'
const SGTIN_3 = 'urn:epc:id:sgtin:0614141.107346.2019'
const SSCC_1 = 'urn:epc:id:sscc:0614141.1234567890'
const SGLN_WAREHOUSE = 'urn:epc:id:sgln:0614141.00001.0'
const SGLN_STORE = 'urn:epc:id:sgln:0614141.00002.0'
const PGLN_COMPANY = 'urn:epc:id:pgln:0614141.00001'

// ============================================================================
// CBV Vocabulary Tests
// ============================================================================

describe('CBV (Core Business Vocabulary)', () => {
  describe('Business Steps', () => {
    it('should provide standard business step URNs', () => {
      expect(CBV.bizStep.shipping).toBe('urn:epcglobal:cbv:bizstep:shipping')
      expect(CBV.bizStep.receiving).toBe('urn:epcglobal:cbv:bizstep:receiving')
      expect(CBV.bizStep.commissioning).toBe('urn:epcglobal:cbv:bizstep:commissioning')
      expect(CBV.bizStep.decommissioning).toBe('urn:epcglobal:cbv:bizstep:decommissioning')
      expect(CBV.bizStep.packing).toBe('urn:epcglobal:cbv:bizstep:packing')
      expect(CBV.bizStep.unpacking).toBe('urn:epcglobal:cbv:bizstep:unpacking')
      expect(CBV.bizStep.transforming).toBe('urn:epcglobal:cbv:bizstep:transforming')
      expect(CBV.bizStep.inspecting).toBe('urn:epcglobal:cbv:bizstep:inspecting')
      expect(CBV.bizStep.storing).toBe('urn:epcglobal:cbv:bizstep:storing')
      expect(CBV.bizStep.picking).toBe('urn:epcglobal:cbv:bizstep:picking')
      expect(CBV.bizStep.loading).toBe('urn:epcglobal:cbv:bizstep:loading')
      expect(CBV.bizStep.departing).toBe('urn:epcglobal:cbv:bizstep:departing')
      expect(CBV.bizStep.arriving).toBe('urn:epcglobal:cbv:bizstep:arriving')
    })

    it('should resolve shorthand to full URN', () => {
      expect(CBV.resolveBizStep('shipping')).toBe('urn:epcglobal:cbv:bizstep:shipping')
      expect(CBV.resolveBizStep('urn:epcglobal:cbv:bizstep:shipping')).toBe('urn:epcglobal:cbv:bizstep:shipping')
      expect(CBV.resolveBizStep('custom:step')).toBe('custom:step') // Pass through custom
    })
  })

  describe('Dispositions', () => {
    it('should provide standard disposition URNs', () => {
      expect(CBV.disposition.active).toBe('urn:epcglobal:cbv:disp:active')
      expect(CBV.disposition.in_transit).toBe('urn:epcglobal:cbv:disp:in_transit')
      expect(CBV.disposition.in_progress).toBe('urn:epcglobal:cbv:disp:in_progress')
      expect(CBV.disposition.sellable_accessible).toBe('urn:epcglobal:cbv:disp:sellable_accessible')
      expect(CBV.disposition.sellable_not_accessible).toBe('urn:epcglobal:cbv:disp:sellable_not_accessible')
      expect(CBV.disposition.non_sellable_other).toBe('urn:epcglobal:cbv:disp:non_sellable_other')
      expect(CBV.disposition.recalled).toBe('urn:epcglobal:cbv:disp:recalled')
      expect(CBV.disposition.destroyed).toBe('urn:epcglobal:cbv:disp:destroyed')
      expect(CBV.disposition.encoded).toBe('urn:epcglobal:cbv:disp:encoded')
      expect(CBV.disposition.container_open).toBe('urn:epcglobal:cbv:disp:container_open')
      expect(CBV.disposition.container_closed).toBe('urn:epcglobal:cbv:disp:container_closed')
    })

    it('should resolve shorthand to full URN', () => {
      expect(CBV.resolveDisposition('in_transit')).toBe('urn:epcglobal:cbv:disp:in_transit')
      expect(CBV.resolveDisposition('urn:epcglobal:cbv:disp:active')).toBe('urn:epcglobal:cbv:disp:active')
    })
  })

  describe('Business Transaction Types', () => {
    it('should provide standard transaction type URNs', () => {
      expect(CBV.bizTransactionType.po).toBe('urn:epcglobal:cbv:btt:po')
      expect(CBV.bizTransactionType.inv).toBe('urn:epcglobal:cbv:btt:inv')
      expect(CBV.bizTransactionType.desadv).toBe('urn:epcglobal:cbv:btt:desadv')
      expect(CBV.bizTransactionType.recadv).toBe('urn:epcglobal:cbv:btt:recadv')
      expect(CBV.bizTransactionType.bol).toBe('urn:epcglobal:cbv:btt:bol')
      expect(CBV.bizTransactionType.prodorder).toBe('urn:epcglobal:cbv:btt:prodorder')
    })
  })

  describe('Source/Destination Types', () => {
    it('should provide standard source/destination types', () => {
      expect(CBV.sourceDestType.possessing_party).toBe('urn:epcglobal:cbv:sdt:possessing_party')
      expect(CBV.sourceDestType.owning_party).toBe('urn:epcglobal:cbv:sdt:owning_party')
      expect(CBV.sourceDestType.location).toBe('urn:epcglobal:cbv:sdt:location')
    })
  })
})

// ============================================================================
// Internal to EPCIS Mapping Tests
// ============================================================================

describe('toEPCIS - Internal to EPCIS mapping', () => {
  describe('ObjectEvent mapping', () => {
    it('should map ObjectEvent to EPCIS format', () => {
      const internal = new ObjectEvent({
        what: [SGTIN_1, SGTIN_2],
        when: new Date('2024-06-15T10:30:00Z'),
        whenTimezoneOffset: '-05:00',
        action: 'OBSERVE',
        where: SGLN_WAREHOUSE,
        bizLocation: SGLN_STORE,
        why: 'shipping',
        how: 'in_transit',
        who: PGLN_COMPANY,
      })

      const epcis = toEPCIS(internal) as EPCISObjectEvent

      expect(epcis.type).toBe('ObjectEvent')
      expect(epcis.eventTime).toBe('2024-06-15T10:30:00.000Z')
      expect(epcis.eventTimeZoneOffset).toBe('-05:00')
      expect(epcis.action).toBe('OBSERVE')
      expect(epcis.epcList).toEqual([SGTIN_1, SGTIN_2])
      expect(epcis.readPoint?.id).toBe(SGLN_WAREHOUSE)
      expect(epcis.bizLocation?.id).toBe(SGLN_STORE)
      expect(epcis.bizStep).toBe('urn:epcglobal:cbv:bizstep:shipping')
      expect(epcis.disposition).toBe('urn:epcglobal:cbv:disp:in_transit')
    })

    it('should include recordTime in EPCIS output', () => {
      const internal = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-15T10:30:00Z'),
        action: 'ADD',
      })

      const epcis = toEPCIS(internal) as EPCISObjectEvent

      expect(epcis.recordTime).toBeDefined()
      expect(new Date(epcis.recordTime!).getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should map quantity elements', () => {
      const internal = new ObjectEvent({
        what: [],
        quantityList: [
          { epcClass: 'urn:epc:class:lgtin:0614141.107346.lot123', quantity: 100, uom: 'EA' },
          { epcClass: 'urn:epc:class:lgtin:0614141.107346.lot456', quantity: 50.5, uom: 'KGM' },
        ],
        when: new Date('2024-06-15T10:30:00Z'),
        action: 'OBSERVE',
      })

      const epcis = toEPCIS(internal) as EPCISObjectEvent

      expect(epcis.quantityList).toHaveLength(2)
      expect(epcis.quantityList![0]).toEqual({
        epcClass: 'urn:epc:class:lgtin:0614141.107346.lot123',
        quantity: 100,
        uom: 'EA',
      })
    })

    it('should map source and destination lists', () => {
      const internal = new ObjectEvent({
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

      const epcis = toEPCIS(internal) as EPCISObjectEvent

      expect(epcis.sourceList).toHaveLength(2)
      expect(epcis.sourceList![0]).toEqual({
        type: 'urn:epcglobal:cbv:sdt:possessing_party',
        source: PGLN_COMPANY,
      })
      expect(epcis.destinationList).toHaveLength(1)
      expect(epcis.destinationList![0]).toEqual({
        type: 'urn:epcglobal:cbv:sdt:location',
        destination: SGLN_STORE,
      })
    })

    it('should include eventID from internal id', () => {
      const internal = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date(),
        action: 'ADD',
      })

      const epcis = toEPCIS(internal) as EPCISObjectEvent

      expect(epcis.eventID).toBe(internal.id)
    })

    it('should map extensions to EPCIS extension field', () => {
      const internal = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date(),
        action: 'OBSERVE',
        extensions: {
          'example:temperature': 22.5,
          'custom:sensor': 'sensor-001',
        },
      })

      const epcis = toEPCIS(internal) as EPCISObjectEvent

      expect(epcis['example:temperature']).toBe(22.5)
      expect(epcis['custom:sensor']).toBe('sensor-001')
    })
  })

  describe('AggregationEvent mapping', () => {
    it('should map AggregationEvent to EPCIS format', () => {
      const internal = new AggregationEvent({
        parentID: SSCC_1,
        childEPCs: [SGTIN_1, SGTIN_2],
        when: new Date('2024-06-15T10:30:00Z'),
        action: 'ADD',
        why: 'packing',
        where: SGLN_WAREHOUSE,
      })

      const epcis = toEPCIS(internal) as EPCISAggregationEvent

      expect(epcis.type).toBe('AggregationEvent')
      expect(epcis.parentID).toBe(SSCC_1)
      expect(epcis.childEPCs).toEqual([SGTIN_1, SGTIN_2])
      expect(epcis.action).toBe('ADD')
      expect(epcis.bizStep).toBe('urn:epcglobal:cbv:bizstep:packing')
    })

    it('should map childQuantityList', () => {
      const internal = new AggregationEvent({
        parentID: SSCC_1,
        childEPCs: [],
        childQuantityList: [
          { epcClass: 'urn:epc:class:lgtin:0614141.107346.lot001', quantity: 500 },
        ],
        when: new Date(),
        action: 'ADD',
      })

      const epcis = toEPCIS(internal) as EPCISAggregationEvent

      expect(epcis.childQuantityList).toHaveLength(1)
      expect(epcis.childQuantityList![0].epcClass).toBe('urn:epc:class:lgtin:0614141.107346.lot001')
    })
  })

  describe('TransactionEvent mapping', () => {
    it('should map TransactionEvent to EPCIS format', () => {
      const internal = new TransactionEvent({
        what: [SGTIN_1],
        bizTransactionList: [
          { type: 'po', value: 'PO-12345' },
          { type: 'inv', value: 'INV-67890' },
        ],
        when: new Date('2024-06-15T10:30:00Z'),
        action: 'ADD',
        parentID: SSCC_1,
      })

      const epcis = toEPCIS(internal) as EPCISTransactionEvent

      expect(epcis.type).toBe('TransactionEvent')
      expect(epcis.epcList).toEqual([SGTIN_1])
      expect(epcis.parentID).toBe(SSCC_1)
      expect(epcis.bizTransactionList).toHaveLength(2)
      expect(epcis.bizTransactionList[0]).toEqual({
        type: 'urn:epcglobal:cbv:btt:po',
        bizTransaction: 'PO-12345',
      })
    })
  })

  describe('TransformationEvent mapping', () => {
    it('should map TransformationEvent to EPCIS format', () => {
      const internal = new TransformationEvent({
        inputEPCList: [SGTIN_1, SGTIN_2],
        outputEPCList: [SGTIN_3],
        when: new Date('2024-06-15T10:30:00Z'),
        why: 'transforming',
        transformationID: 'urn:uuid:trans-001',
      })

      const epcis = toEPCIS(internal) as EPCISTransformationEvent

      expect(epcis.type).toBe('TransformationEvent')
      expect(epcis.inputEPCList).toEqual([SGTIN_1, SGTIN_2])
      expect(epcis.outputEPCList).toEqual([SGTIN_3])
      expect(epcis.transformationID).toBe('urn:uuid:trans-001')
      expect(epcis.bizStep).toBe('urn:epcglobal:cbv:bizstep:transforming')
    })

    it('should map input/output quantity lists', () => {
      const internal = new TransformationEvent({
        inputEPCList: [],
        inputQuantityList: [
          { epcClass: 'urn:epc:class:lgtin:raw.001', quantity: 100, uom: 'KGM' },
        ],
        outputEPCList: [],
        outputQuantityList: [
          { epcClass: 'urn:epc:class:lgtin:product.001', quantity: 95, uom: 'KGM' },
        ],
        when: new Date(),
      })

      const epcis = toEPCIS(internal) as EPCISTransformationEvent

      expect(epcis.inputQuantityList).toHaveLength(1)
      expect(epcis.outputQuantityList).toHaveLength(1)
    })
  })

  describe('Digital extensions mapping', () => {
    it('should preserve digital context fields in extensions', () => {
      const internal = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date(),
        action: 'ADD',
        channel: 'web',
        sessionId: 'sess_123',
        deviceId: 'device_456',
        actorType: 'human',
        confidence: 0.95,
        context: { browser: 'chrome', version: '120' },
      })

      const epcis = toEPCIS(internal) as EPCISObjectEvent

      // Digital extensions should be in a namespaced extension
      expect(epcis['dotdo:channel']).toBe('web')
      expect(epcis['dotdo:sessionId']).toBe('sess_123')
      expect(epcis['dotdo:deviceId']).toBe('device_456')
      expect(epcis['dotdo:actorType']).toBe('human')
      expect(epcis['dotdo:confidence']).toBe(0.95)
      expect(epcis['dotdo:context']).toEqual({ browser: 'chrome', version: '120' })
    })
  })
})

// ============================================================================
// EPCIS to Internal Mapping Tests
// ============================================================================

describe('fromEPCIS - EPCIS to Internal mapping', () => {
  describe('ObjectEvent mapping', () => {
    it('should map EPCIS ObjectEvent to internal format', () => {
      const epcis: EPCISObjectEvent = {
        type: 'ObjectEvent',
        eventID: 'evt_test_001',
        eventTime: '2024-06-15T10:30:00.000Z',
        eventTimeZoneOffset: '-05:00',
        recordTime: '2024-06-15T10:30:01.000Z',
        action: 'OBSERVE',
        epcList: [SGTIN_1, SGTIN_2],
        readPoint: { id: SGLN_WAREHOUSE },
        bizLocation: { id: SGLN_STORE },
        bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
        disposition: 'urn:epcglobal:cbv:disp:in_transit',
      }

      const internal = fromEPCIS(epcis) as ObjectEvent

      expect(internal.type).toBe('ObjectEvent')
      expect(internal.what).toEqual([SGTIN_1, SGTIN_2])
      expect(internal.when.toISOString()).toBe('2024-06-15T10:30:00.000Z')
      expect(internal.whenTimezoneOffset).toBe('-05:00')
      expect(internal.action).toBe('OBSERVE')
      expect(internal.where).toBe(SGLN_WAREHOUSE)
      expect(internal.bizLocation).toBe(SGLN_STORE)
      // CBV URNs should be preserved or simplified
      expect(internal.why).toBe('urn:epcglobal:cbv:bizstep:shipping')
      expect(internal.how).toBe('urn:epcglobal:cbv:disp:in_transit')
    })

    it('should map quantityList', () => {
      const epcis: EPCISObjectEvent = {
        type: 'ObjectEvent',
        eventTime: '2024-06-15T10:30:00.000Z',
        action: 'OBSERVE',
        quantityList: [
          { epcClass: 'urn:epc:class:lgtin:0614141.107346.lot123', quantity: 100, uom: 'EA' },
        ],
      }

      const internal = fromEPCIS(epcis) as ObjectEvent

      expect(internal.quantityList).toHaveLength(1)
      expect(internal.quantityList![0].quantity).toBe(100)
    })

    it('should map source and destination lists', () => {
      const epcis: EPCISObjectEvent = {
        type: 'ObjectEvent',
        eventTime: '2024-06-15T10:30:00.000Z',
        action: 'OBSERVE',
        epcList: [SGTIN_1],
        sourceList: [
          { type: 'urn:epcglobal:cbv:sdt:possessing_party', source: PGLN_COMPANY },
        ],
        destinationList: [
          { type: 'urn:epcglobal:cbv:sdt:location', destination: SGLN_STORE },
        ],
      }

      const internal = fromEPCIS(epcis) as ObjectEvent

      expect(internal.sourceList).toHaveLength(1)
      expect(internal.sourceList![0]).toEqual({
        type: 'possessing_party',
        value: PGLN_COMPANY,
      })
      expect(internal.destinationList).toHaveLength(1)
      expect(internal.destinationList![0]).toEqual({
        type: 'location',
        value: SGLN_STORE,
      })
    })
  })

  describe('AggregationEvent mapping', () => {
    it('should map EPCIS AggregationEvent to internal format', () => {
      const epcis: EPCISAggregationEvent = {
        type: 'AggregationEvent',
        eventTime: '2024-06-15T10:30:00.000Z',
        action: 'ADD',
        parentID: SSCC_1,
        childEPCs: [SGTIN_1, SGTIN_2],
        bizStep: 'urn:epcglobal:cbv:bizstep:packing',
      }

      const internal = fromEPCIS(epcis) as AggregationEvent

      expect(internal.type).toBe('AggregationEvent')
      expect(internal.parentID).toBe(SSCC_1)
      expect(internal.childEPCs).toEqual([SGTIN_1, SGTIN_2])
      expect(internal.action).toBe('ADD')
    })
  })

  describe('TransactionEvent mapping', () => {
    it('should map EPCIS TransactionEvent to internal format', () => {
      const epcis: EPCISTransactionEvent = {
        type: 'TransactionEvent',
        eventTime: '2024-06-15T10:30:00.000Z',
        action: 'ADD',
        epcList: [SGTIN_1],
        bizTransactionList: [
          { type: 'urn:epcglobal:cbv:btt:po', bizTransaction: 'PO-12345' },
        ],
      }

      const internal = fromEPCIS(epcis) as TransactionEvent

      expect(internal.type).toBe('TransactionEvent')
      expect(internal.bizTransactionList).toHaveLength(1)
      expect(internal.bizTransactionList[0]).toEqual({
        type: 'po',
        value: 'PO-12345',
      })
    })
  })

  describe('TransformationEvent mapping', () => {
    it('should map EPCIS TransformationEvent to internal format', () => {
      const epcis: EPCISTransformationEvent = {
        type: 'TransformationEvent',
        eventTime: '2024-06-15T10:30:00.000Z',
        inputEPCList: [SGTIN_1, SGTIN_2],
        outputEPCList: [SGTIN_3],
        transformationID: 'urn:uuid:trans-001',
      }

      const internal = fromEPCIS(epcis) as TransformationEvent

      expect(internal.type).toBe('TransformationEvent')
      expect(internal.inputEPCList).toEqual([SGTIN_1, SGTIN_2])
      expect(internal.outputEPCList).toEqual([SGTIN_3])
      expect(internal.transformationID).toBe('urn:uuid:trans-001')
    })
  })

  describe('Extension mapping', () => {
    it('should preserve custom extensions', () => {
      const epcis: EPCISObjectEvent = {
        type: 'ObjectEvent',
        eventTime: '2024-06-15T10:30:00.000Z',
        action: 'OBSERVE',
        epcList: [SGTIN_1],
        'example:temperature': 22.5,
        'custom:sensor': 'sensor-001',
      }

      const internal = fromEPCIS(epcis) as ObjectEvent

      expect(internal.extensions).toEqual({
        'example:temperature': 22.5,
        'custom:sensor': 'sensor-001',
      })
    })

    it('should restore digital context from dotdo namespace', () => {
      const epcis: EPCISObjectEvent = {
        type: 'ObjectEvent',
        eventTime: '2024-06-15T10:30:00.000Z',
        action: 'ADD',
        epcList: [SGTIN_1],
        'dotdo:channel': 'web',
        'dotdo:sessionId': 'sess_123',
        'dotdo:actorType': 'human',
      }

      const internal = fromEPCIS(epcis) as ObjectEvent

      expect(internal.channel).toBe('web')
      expect(internal.sessionId).toBe('sess_123')
      expect(internal.actorType).toBe('human')
    })
  })
})

// ============================================================================
// Round-trip Tests
// ============================================================================

describe('Round-trip serialization', () => {
  it('should preserve ObjectEvent data through round-trip', () => {
    const original = new ObjectEvent({
      what: [SGTIN_1, SGTIN_2],
      when: new Date('2024-06-15T10:30:00Z'),
      whenTimezoneOffset: '-05:00',
      action: 'OBSERVE',
      where: SGLN_WAREHOUSE,
      bizLocation: SGLN_STORE,
      why: 'shipping',
      how: 'in_transit',
      extensions: { 'custom:temp': 22 },
    })

    const epcis = toEPCIS(original)
    const restored = fromEPCIS(epcis) as ObjectEvent

    expect(restored.what).toEqual(original.what)
    expect(restored.when.getTime()).toBe(original.when.getTime())
    expect(restored.action).toBe(original.action)
    expect(restored.where).toBe(original.where)
    expect(restored.bizLocation).toBe(original.bizLocation)
  })

  it('should preserve AggregationEvent data through round-trip', () => {
    const original = new AggregationEvent({
      parentID: SSCC_1,
      childEPCs: [SGTIN_1, SGTIN_2, SGTIN_3],
      when: new Date('2024-06-15T10:30:00Z'),
      action: 'ADD',
      why: 'packing',
    })

    const epcis = toEPCIS(original)
    const restored = fromEPCIS(epcis) as AggregationEvent

    expect(restored.parentID).toBe(original.parentID)
    expect(restored.childEPCs).toEqual(original.childEPCs)
    expect(restored.action).toBe(original.action)
  })

  it('should preserve TransactionEvent data through round-trip', () => {
    const original = new TransactionEvent({
      what: [SGTIN_1],
      bizTransactionList: [
        { type: 'po', value: 'PO-12345' },
        { type: 'inv', value: 'INV-67890' },
      ],
      when: new Date('2024-06-15T10:30:00Z'),
      action: 'ADD',
    })

    const epcis = toEPCIS(original)
    const restored = fromEPCIS(epcis) as TransactionEvent

    expect(restored.bizTransactionList).toHaveLength(2)
    expect(restored.bizTransactionList[0].type).toBe('po')
    expect(restored.bizTransactionList[0].value).toBe('PO-12345')
  })

  it('should preserve TransformationEvent data through round-trip', () => {
    const original = new TransformationEvent({
      inputEPCList: [SGTIN_1, SGTIN_2],
      outputEPCList: [SGTIN_3],
      inputQuantityList: [
        { epcClass: 'urn:epc:class:lgtin:raw.001', quantity: 100 },
      ],
      when: new Date('2024-06-15T10:30:00Z'),
      transformationID: 'urn:uuid:trans-001',
    })

    const epcis = toEPCIS(original)
    const restored = fromEPCIS(epcis) as TransformationEvent

    expect(restored.inputEPCList).toEqual(original.inputEPCList)
    expect(restored.outputEPCList).toEqual(original.outputEPCList)
    expect(restored.transformationID).toBe(original.transformationID)
  })
})

// ============================================================================
// JSON-LD Serializer Tests
// ============================================================================

describe('EPCISJsonLdSerializer', () => {
  let serializer: EPCISJsonLdSerializer

  beforeEach(() => {
    serializer = new EPCISJsonLdSerializer()
  })

  describe('Single event serialization', () => {
    it('should serialize single event with @context', () => {
      const event = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-15T10:30:00Z'),
        action: 'OBSERVE',
      })

      const json = serializer.serializeEvent(event)
      const parsed = JSON.parse(json)

      expect(parsed['@context']).toContain('https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld')
      expect(parsed.type).toBe('ObjectEvent')
    })

    it('should include GS1 Digital Link context', () => {
      const event = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date(),
        action: 'ADD',
      })

      const json = serializer.serializeEvent(event)
      const parsed = JSON.parse(json)

      expect(parsed['@context']).toContain('https://gs1.org/voc/')
    })
  })

  describe('Document serialization', () => {
    it('should serialize multiple events as EPCISDocument', () => {
      const events = [
        new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'ADD' }),
        new ObjectEvent({ what: [SGTIN_2], when: new Date(), action: 'OBSERVE' }),
      ]

      const json = serializer.serializeDocument(events)
      const doc = JSON.parse(json) as EPCISDocument

      expect(doc.type).toBe('EPCISDocument')
      expect(doc.schemaVersion).toBe('2.0')
      expect(doc.epcisBody.eventList).toHaveLength(2)
    })

    it('should include creation date in document', () => {
      const events = [
        new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'ADD' }),
      ]

      const json = serializer.serializeDocument(events)
      const doc = JSON.parse(json) as EPCISDocument

      expect(doc.creationDate).toBeDefined()
      expect(new Date(doc.creationDate).getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should include EPCIS header when provided', () => {
      const events = [
        new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'ADD' }),
      ]
      const header = {
        sender: { id: 'sender-001' },
        receiver: { id: 'receiver-001' },
      }

      const json = serializer.serializeDocument(events, header)
      const doc = JSON.parse(json) as EPCISDocument

      expect(doc.epcisHeader?.sender?.id).toBe('sender-001')
      expect(doc.epcisHeader?.receiver?.id).toBe('receiver-001')
    })
  })

  describe('Deserialization', () => {
    it('should deserialize JSON-LD event', () => {
      const jsonLd = JSON.stringify({
        '@context': ['https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld'],
        type: 'ObjectEvent',
        eventTime: '2024-06-15T10:30:00.000Z',
        action: 'OBSERVE',
        epcList: [SGTIN_1],
      })

      const event = serializer.deserializeEvent(jsonLd)

      expect(event.type).toBe('ObjectEvent')
      expect((event as ObjectEvent).what).toEqual([SGTIN_1])
    })

    it('should deserialize JSON-LD document', () => {
      const doc: EPCISDocument = {
        '@context': ['https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld'],
        type: 'EPCISDocument',
        schemaVersion: '2.0',
        creationDate: '2024-06-15T10:30:00.000Z',
        epcisBody: {
          eventList: [
            {
              type: 'ObjectEvent',
              eventTime: '2024-06-15T10:30:00.000Z',
              action: 'ADD',
              epcList: [SGTIN_1],
            },
            {
              type: 'AggregationEvent',
              eventTime: '2024-06-15T10:31:00.000Z',
              action: 'ADD',
              parentID: SSCC_1,
              childEPCs: [SGTIN_1],
            },
          ],
        },
      }

      const events = serializer.deserializeDocument(JSON.stringify(doc))

      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('ObjectEvent')
      expect(events[1].type).toBe('AggregationEvent')
    })
  })
})

// ============================================================================
// XML Serializer Tests
// ============================================================================

describe('EPCISXmlSerializer', () => {
  let serializer: EPCISXmlSerializer

  beforeEach(() => {
    serializer = new EPCISXmlSerializer()
  })

  describe('Single event serialization', () => {
    it('should serialize ObjectEvent to XML', () => {
      const event = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-15T10:30:00Z'),
        action: 'OBSERVE',
        where: SGLN_WAREHOUSE,
        why: 'shipping',
        how: 'in_transit',
      })

      const xml = serializer.serializeEvent(event)

      expect(xml).toContain('<?xml version="1.0"')
      expect(xml).toContain('<ObjectEvent>')
      expect(xml).toContain('<action>OBSERVE</action>')
      expect(xml).toContain('<epc>' + SGTIN_1 + '</epc>')
      expect(xml).toContain('<eventTime>2024-06-15T10:30:00.000Z</eventTime>')
      expect(xml).toContain('<readPoint>')
      expect(xml).toContain('<id>' + SGLN_WAREHOUSE + '</id>')
    })

    it('should include EPCIS namespace declarations', () => {
      const event = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date(),
        action: 'ADD',
      })

      const xml = serializer.serializeEvent(event)

      expect(xml).toContain('xmlns:epcis="urn:epcglobal:epcis:xsd:2"')
      expect(xml).toContain('xmlns:cbv="urn:epcglobal:cbv:xsd:1"')
    })

    it('should serialize AggregationEvent to XML', () => {
      const event = new AggregationEvent({
        parentID: SSCC_1,
        childEPCs: [SGTIN_1, SGTIN_2],
        when: new Date('2024-06-15T10:30:00Z'),
        action: 'ADD',
      })

      const xml = serializer.serializeEvent(event)

      expect(xml).toContain('<AggregationEvent>')
      expect(xml).toContain('<parentID>' + SSCC_1 + '</parentID>')
      expect(xml).toContain('<childEPCs>')
      expect(xml).toContain('<epc>' + SGTIN_1 + '</epc>')
    })

    it('should serialize TransactionEvent to XML', () => {
      const event = new TransactionEvent({
        what: [SGTIN_1],
        bizTransactionList: [
          { type: 'po', value: 'PO-12345' },
        ],
        when: new Date('2024-06-15T10:30:00Z'),
        action: 'ADD',
      })

      const xml = serializer.serializeEvent(event)

      expect(xml).toContain('<TransactionEvent>')
      expect(xml).toContain('<bizTransactionList>')
      expect(xml).toContain('<bizTransaction type="urn:epcglobal:cbv:btt:po">PO-12345</bizTransaction>')
    })

    it('should serialize TransformationEvent to XML', () => {
      const event = new TransformationEvent({
        inputEPCList: [SGTIN_1],
        outputEPCList: [SGTIN_2],
        when: new Date('2024-06-15T10:30:00Z'),
      })

      const xml = serializer.serializeEvent(event)

      expect(xml).toContain('<TransformationEvent>')
      expect(xml).toContain('<inputEPCList>')
      expect(xml).toContain('<outputEPCList>')
    })

    it('should serialize quantityList elements', () => {
      const event = new ObjectEvent({
        what: [],
        quantityList: [
          { epcClass: 'urn:epc:class:lgtin:0614141.107346.lot123', quantity: 100, uom: 'EA' },
        ],
        when: new Date(),
        action: 'OBSERVE',
      })

      const xml = serializer.serializeEvent(event)

      expect(xml).toContain('<quantityList>')
      expect(xml).toContain('<quantityElement>')
      expect(xml).toContain('<epcClass>urn:epc:class:lgtin:0614141.107346.lot123</epcClass>')
      expect(xml).toContain('<quantity>100</quantity>')
      expect(xml).toContain('<uom>EA</uom>')
    })
  })

  describe('Document serialization', () => {
    it('should serialize events as EPCISDocument', () => {
      const events = [
        new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'ADD' }),
        new ObjectEvent({ what: [SGTIN_2], when: new Date(), action: 'OBSERVE' }),
      ]

      const xml = serializer.serializeDocument(events)

      expect(xml).toContain('<epcis:EPCISDocument')
      expect(xml).toContain('schemaVersion="2.0"')
      expect(xml).toContain('<EPCISBody>')
      expect(xml).toContain('<EventList>')
      expect(xml).toContain('</epcis:EPCISDocument>')
    })

    it('should include creationDate attribute', () => {
      const events = [
        new ObjectEvent({ what: [SGTIN_1], when: new Date(), action: 'ADD' }),
      ]

      const xml = serializer.serializeDocument(events)

      expect(xml).toMatch(/creationDate="[^"]+Z"/)
    })
  })

  describe('Deserialization', () => {
    it('should deserialize XML ObjectEvent', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <ObjectEvent>
          <eventTime>2024-06-15T10:30:00.000Z</eventTime>
          <action>OBSERVE</action>
          <epcList>
            <epc>${SGTIN_1}</epc>
          </epcList>
          <readPoint>
            <id>${SGLN_WAREHOUSE}</id>
          </readPoint>
          <bizStep>urn:epcglobal:cbv:bizstep:shipping</bizStep>
        </ObjectEvent>`

      const event = serializer.deserializeEvent(xml)

      expect(event.type).toBe('ObjectEvent')
      expect((event as ObjectEvent).what).toEqual([SGTIN_1])
      expect((event as ObjectEvent).where).toBe(SGLN_WAREHOUSE)
    })

    it('should deserialize XML EPCISDocument', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <epcis:EPCISDocument xmlns:epcis="urn:epcglobal:epcis:xsd:2" schemaVersion="2.0">
          <EPCISBody>
            <EventList>
              <ObjectEvent>
                <eventTime>2024-06-15T10:30:00.000Z</eventTime>
                <action>ADD</action>
                <epcList>
                  <epc>${SGTIN_1}</epc>
                </epcList>
              </ObjectEvent>
              <AggregationEvent>
                <eventTime>2024-06-15T10:31:00.000Z</eventTime>
                <action>ADD</action>
                <parentID>${SSCC_1}</parentID>
                <childEPCs>
                  <epc>${SGTIN_1}</epc>
                </childEPCs>
              </AggregationEvent>
            </EventList>
          </EPCISBody>
        </epcis:EPCISDocument>`

      const events = serializer.deserializeDocument(xml)

      expect(events).toHaveLength(2)
      expect(events[0].type).toBe('ObjectEvent')
      expect(events[1].type).toBe('AggregationEvent')
    })
  })

  describe('XML round-trip', () => {
    it('should preserve data through XML serialization round-trip', () => {
      const original = new ObjectEvent({
        what: [SGTIN_1, SGTIN_2],
        when: new Date('2024-06-15T10:30:00Z'),
        action: 'OBSERVE',
        where: SGLN_WAREHOUSE,
        bizLocation: SGLN_STORE,
        why: 'shipping',
        how: 'in_transit',
      })

      const xml = serializer.serializeEvent(original)
      const restored = serializer.deserializeEvent(xml) as ObjectEvent

      expect(restored.what).toEqual(original.what)
      expect(restored.when.getTime()).toBe(original.when.getTime())
      expect(restored.action).toBe(original.action)
      expect(restored.where).toBe(original.where)
    })
  })
})

// ============================================================================
// Generic Serializer Factory Tests
// ============================================================================

describe('EPCISSerializer factory', () => {
  it('should create JSON-LD serializer by default', () => {
    const serializer = EPCISSerializer.create()

    expect(serializer).toBeInstanceOf(EPCISJsonLdSerializer)
  })

  it('should create JSON-LD serializer with format option', () => {
    const serializer = EPCISSerializer.create({ format: 'json-ld' })

    expect(serializer).toBeInstanceOf(EPCISJsonLdSerializer)
  })

  it('should create XML serializer with format option', () => {
    const serializer = EPCISSerializer.create({ format: 'xml' })

    expect(serializer).toBeInstanceOf(EPCISXmlSerializer)
  })

  it('should throw for unsupported format', () => {
    expect(() => {
      // @ts-expect-error Testing runtime validation
      EPCISSerializer.create({ format: 'unsupported' })
    }).toThrow(/unsupported.*format/i)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error handling', () => {
  describe('JSON-LD errors', () => {
    it('should throw on invalid JSON', () => {
      const serializer = new EPCISJsonLdSerializer()

      expect(() => {
        serializer.deserializeEvent('not valid json')
      }).toThrow()
    })

    it('should throw on missing event type', () => {
      const serializer = new EPCISJsonLdSerializer()

      expect(() => {
        serializer.deserializeEvent('{"eventTime": "2024-06-15T10:30:00Z"}')
      }).toThrow(/type.*required|missing.*type/i)
    })

    it('should throw on invalid event type', () => {
      const serializer = new EPCISJsonLdSerializer()

      expect(() => {
        serializer.deserializeEvent('{"type": "InvalidEventType", "eventTime": "2024-06-15T10:30:00Z"}')
      }).toThrow(/invalid.*event.*type|unsupported.*type/i)
    })
  })

  describe('XML errors', () => {
    it('should throw on invalid XML', () => {
      const serializer = new EPCISXmlSerializer()

      expect(() => {
        serializer.deserializeEvent('<not valid xml>')
      }).toThrow()
    })

    it('should throw on missing required elements', () => {
      const serializer = new EPCISXmlSerializer()

      expect(() => {
        serializer.deserializeEvent('<ObjectEvent></ObjectEvent>')
      }).toThrow(/required|missing/i)
    })
  })

  describe('Mapping errors', () => {
    it('should throw on unsupported event type in toEPCIS', () => {
      const invalidEvent = {
        type: 'InvalidEventType',
        id: 'test',
        recordTime: new Date(),
        when: new Date(),
        what: [],
      } as unknown as BusinessEvent

      expect(() => {
        toEPCIS(invalidEvent)
      }).toThrow(/unsupported.*event.*type/i)
    })
  })
})

// ============================================================================
// Content-Type Detection Tests
// ============================================================================

describe('Content-Type handling', () => {
  it('should detect JSON-LD from content type', () => {
    const contentType = 'application/ld+json'
    const serializer = EPCISSerializer.fromContentType(contentType)

    expect(serializer).toBeInstanceOf(EPCISJsonLdSerializer)
  })

  it('should detect JSON from content type', () => {
    const contentType = 'application/json'
    const serializer = EPCISSerializer.fromContentType(contentType)

    expect(serializer).toBeInstanceOf(EPCISJsonLdSerializer)
  })

  it('should detect XML from content type', () => {
    const contentType = 'application/xml'
    const serializer = EPCISSerializer.fromContentType(contentType)

    expect(serializer).toBeInstanceOf(EPCISXmlSerializer)
  })

  it('should handle content type with charset', () => {
    const contentType = 'application/json; charset=utf-8'
    const serializer = EPCISSerializer.fromContentType(contentType)

    expect(serializer).toBeInstanceOf(EPCISJsonLdSerializer)
  })

  it('should default to JSON-LD for unknown content type', () => {
    const contentType = 'text/plain'
    const serializer = EPCISSerializer.fromContentType(contentType)

    expect(serializer).toBeInstanceOf(EPCISJsonLdSerializer)
  })
})
