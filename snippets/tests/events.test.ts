import { describe, it, expect } from 'vitest'
import { normalize, detectFormat, EventFormat } from '../events'

/**
 * Events Normalizer Tests (RED Phase)
 *
 * The normalize function should:
 * 1. Detect input format (internal 5W+H, EPCIS, evalite)
 * 2. Convert to normalized 5W+H Event schema
 * 3. Handle batch events
 *
 * These tests are expected to FAIL until the normalize function is implemented.
 *
 * Reference: docs/concepts/events.mdx for the 5W+H schema
 */

// ============================================================================
// Test Types - 5W+H Event Schema
// ============================================================================

interface Event5WH {
  // WHO - Identity
  actor: string
  source?: string
  destination?: string

  // WHAT - Objects
  object: string
  type: string
  quantity?: number

  // WHEN - Time
  timestamp: string // ISO datetime
  recorded: string // ISO datetime

  // WHERE - Location
  ns: string
  location?: string
  readPoint?: string

  // WHY - Purpose
  verb: string
  disposition?: string
  reason?: string

  // HOW - Method
  method?: 'code' | 'generative' | 'agentic' | 'human'
  branch?: string
  model?: string
  tools?: string[]
  channel?: string
  cascade?: Record<string, unknown>
  transaction?: string
  context?: Record<string, unknown>
}

// ============================================================================
// Format Detection Tests
// ============================================================================

describe('detectFormat', () => {
  it('detects internal 5W+H format', () => {
    const internalEvent = {
      actor: 'user:alice',
      object: 'order:123',
      type: 'Order',
      verb: 'created',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'app.example.com.ai',
    }

    expect(detectFormat(internalEvent)).toBe(EventFormat.Internal)
  })

  it('detects EPCIS ObjectEvent format', () => {
    const epcisEvent = {
      eventType: 'ObjectEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      eventTimeZoneOffset: '-06:00',
      epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
      action: 'OBSERVE',
      bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
      disposition: 'urn:epcglobal:cbv:disp:in_transit',
      readPoint: { id: 'urn:epc:id:sgln:0614141.00001.0' },
      bizLocation: { id: 'urn:epc:id:sgln:0614141.00001.1' },
    }

    expect(detectFormat(epcisEvent)).toBe(EventFormat.EPCIS)
  })

  it('detects EPCIS AggregationEvent format', () => {
    const epcisEvent = {
      eventType: 'AggregationEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      parentID: 'urn:epc:id:sscc:0614141.1234567890',
      childEPCs: ['urn:epc:id:sgtin:0614141.107346.2017'],
      action: 'ADD',
    }

    expect(detectFormat(epcisEvent)).toBe(EventFormat.EPCIS)
  })

  it('detects evalite trace format', () => {
    const evaliteEvent = {
      traceId: 'trace-abc123',
      spanId: 'span-def456',
      name: 'type-classifier',
      input: { spec: 'function to add numbers' },
      output: { type: 'code', reasoning: 'deterministic math operation' },
      duration: 1200,
      model: 'claude-3-5-sonnet',
      tokens: { input: 500, output: 100 },
      score: 0.92,
    }

    expect(detectFormat(evaliteEvent)).toBe(EventFormat.Evalite)
  })

  it('returns unknown for unrecognized formats', () => {
    const unknownEvent = {
      foo: 'bar',
      baz: 123,
    }

    expect(detectFormat(unknownEvent)).toBe(EventFormat.Unknown)
  })

  it('handles null input', () => {
    expect(detectFormat(null)).toBe(EventFormat.Unknown)
  })

  it('handles undefined input', () => {
    expect(detectFormat(undefined)).toBe(EventFormat.Unknown)
  })

  it('handles array input', () => {
    // Should detect based on first element
    const events = [
      {
        actor: 'user:alice',
        object: 'order:123',
        type: 'Order',
        verb: 'created',
        timestamp: '2026-01-08T10:00:00Z',
        recorded: '2026-01-08T10:00:01Z',
        ns: 'app.example.com.ai',
      },
    ]

    expect(detectFormat(events)).toBe(EventFormat.Internal)
  })
})

// ============================================================================
// Internal Format Passthrough Tests
// ============================================================================

describe('normalize - Internal format passthrough', () => {
  it('passes through valid 5W+H event unchanged', () => {
    const internalEvent = {
      actor: 'user:alice',
      object: 'order:123',
      type: 'Order',
      verb: 'created',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'app.example.com.ai',
    }

    const result = normalize(internalEvent)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      actor: 'user:alice',
      object: 'order:123',
      type: 'Order',
      verb: 'created',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'app.example.com.ai',
    })
  })

  it('preserves optional WHO fields', () => {
    const event = {
      actor: 'user:alice',
      source: 'warehouse:chicago',
      destination: 'customer:bob',
      object: 'shipment:456',
      type: 'Shipment',
      verb: 'dispatched',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'logistics.example.com.ai',
    }

    const result = normalize(event)

    expect(result[0].source).toBe('warehouse:chicago')
    expect(result[0].destination).toBe('customer:bob')
  })

  it('preserves optional WHAT fields', () => {
    const event = {
      actor: 'user:alice',
      object: 'inventory:item-789',
      type: 'InventoryItem',
      quantity: 100,
      verb: 'received',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'inventory.example.com.ai',
    }

    const result = normalize(event)

    expect(result[0].quantity).toBe(100)
  })

  it('preserves optional WHERE fields', () => {
    const event = {
      actor: 'user:alice',
      object: 'scan:001',
      type: 'Scan',
      verb: 'scanned',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'warehouse.example.com.ai',
      location: 'Building A, Zone 3',
      readPoint: 'scanner:entrance-1',
    }

    const result = normalize(event)

    expect(result[0].location).toBe('Building A, Zone 3')
    expect(result[0].readPoint).toBe('scanner:entrance-1')
  })

  it('preserves optional WHY fields', () => {
    const event = {
      actor: 'user:alice',
      object: 'order:123',
      type: 'Order',
      verb: 'cancelled',
      disposition: 'cancelled',
      reason: 'Customer requested cancellation',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'orders.example.com.ai',
    }

    const result = normalize(event)

    expect(result[0].disposition).toBe('cancelled')
    expect(result[0].reason).toBe('Customer requested cancellation')
  })

  it('preserves optional HOW fields', () => {
    const event = {
      actor: 'agent:assistant',
      object: 'task:456',
      type: 'Task',
      verb: 'completed',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'tasks.example.com.ai',
      method: 'agentic' as const,
      branch: 'experiment-v2',
      model: 'claude-3-5-sonnet',
      tools: ['read_file', 'write_file', 'run_tests'],
      transaction: 'txn:789',
      context: { duration: 1200, tokens: 500 },
    }

    const result = normalize(event)

    expect(result[0].method).toBe('agentic')
    expect(result[0].branch).toBe('experiment-v2')
    expect(result[0].model).toBe('claude-3-5-sonnet')
    expect(result[0].tools).toEqual(['read_file', 'write_file', 'run_tests'])
    expect(result[0].transaction).toBe('txn:789')
    expect(result[0].context).toEqual({ duration: 1200, tokens: 500 })
  })

  it('adds recorded timestamp if missing', () => {
    const event = {
      actor: 'user:alice',
      object: 'order:123',
      type: 'Order',
      verb: 'created',
      timestamp: '2026-01-08T10:00:00Z',
      // No recorded timestamp
      ns: 'app.example.com.ai',
    }

    const result = normalize(event)

    expect(result[0].recorded).toBeDefined()
    expect(typeof result[0].recorded).toBe('string')
  })
})

// ============================================================================
// EPCIS ObjectEvent Conversion Tests
// ============================================================================

describe('normalize - EPCIS ObjectEvent conversion', () => {
  it('converts EPCIS ObjectEvent to 5W+H', () => {
    const epcisEvent = {
      eventType: 'ObjectEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      recordTime: '2026-01-08T10:00:05.000Z',
      eventTimeZoneOffset: '-06:00',
      epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
      action: 'OBSERVE',
      bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
      disposition: 'urn:epcglobal:cbv:disp:in_transit',
      readPoint: { id: 'urn:epc:id:sgln:0614141.00001.0' },
      bizLocation: { id: 'urn:epc:id:sgln:0614141.00001.1' },
    }

    const result = normalize(epcisEvent)

    expect(result).toHaveLength(1)
    const event = result[0] as Event5WH

    // WHEN mapping
    expect(event.timestamp).toBe('2026-01-08T10:00:00.000Z')
    expect(event.recorded).toBe('2026-01-08T10:00:05.000Z')

    // WHAT mapping
    expect(event.object).toBe('urn:epc:id:sgtin:0614141.107346.2017')
    expect(event.type).toBe('ObjectEvent')

    // WHY mapping
    expect(event.verb).toBe('shipping') // Extracted from bizStep
    expect(event.disposition).toBe('in_transit') // Extracted from disposition URN

    // WHERE mapping
    expect(event.readPoint).toBe('urn:epc:id:sgln:0614141.00001.0')
    expect(event.location).toBe('urn:epc:id:sgln:0614141.00001.1')
  })

  it('handles EPCIS source and destination (WHO)', () => {
    const epcisEvent = {
      eventType: 'ObjectEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
      action: 'OBSERVE',
      bizStep: 'urn:epcglobal:cbv:bizstep:receiving',
      sourceList: [{ type: 'urn:epcglobal:cbv:sdt:owning_party', source: 'urn:epc:id:pgln:0614141.00001' }],
      destinationList: [{ type: 'urn:epcglobal:cbv:sdt:owning_party', destination: 'urn:epc:id:pgln:0614141.00002' }],
    }

    const result = normalize(epcisEvent)
    const event = result[0] as Event5WH

    expect(event.source).toBe('urn:epc:id:pgln:0614141.00001')
    expect(event.destination).toBe('urn:epc:id:pgln:0614141.00002')
  })

  it('handles multiple EPCs in epcList', () => {
    const epcisEvent = {
      eventType: 'ObjectEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      epcList: [
        'urn:epc:id:sgtin:0614141.107346.2017',
        'urn:epc:id:sgtin:0614141.107346.2018',
        'urn:epc:id:sgtin:0614141.107346.2019',
      ],
      action: 'OBSERVE',
      bizStep: 'urn:epcglobal:cbv:bizstep:inspecting',
    }

    const result = normalize(epcisEvent)

    // Should create one event per EPC
    expect(result).toHaveLength(3)
    expect(result[0].object).toBe('urn:epc:id:sgtin:0614141.107346.2017')
    expect(result[1].object).toBe('urn:epc:id:sgtin:0614141.107346.2018')
    expect(result[2].object).toBe('urn:epc:id:sgtin:0614141.107346.2019')
  })

  it('handles EPCIS quantityList', () => {
    const epcisEvent = {
      eventType: 'ObjectEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      quantityList: [
        {
          epcClass: 'urn:epc:class:lgtin:0614141.107346.lot1',
          quantity: 500,
          uom: 'KGM',
        },
      ],
      action: 'OBSERVE',
      bizStep: 'urn:epcglobal:cbv:bizstep:commissioning',
    }

    const result = normalize(epcisEvent)
    const event = result[0] as Event5WH

    expect(event.object).toBe('urn:epc:class:lgtin:0614141.107346.lot1')
    expect(event.quantity).toBe(500)
    expect(event.context).toMatchObject({ uom: 'KGM' })
  })

  it('handles EPCIS bizTransactionList (transaction)', () => {
    const epcisEvent = {
      eventType: 'ObjectEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
      action: 'ADD',
      bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
      bizTransactionList: [{ type: 'urn:epcglobal:cbv:btt:po', bizTransaction: 'urn:epc:id:gdti:0614141.00001.1234' }],
    }

    const result = normalize(epcisEvent)
    const event = result[0] as Event5WH

    expect(event.transaction).toBe('urn:epc:id:gdti:0614141.00001.1234')
  })

  it('handles EPCIS action field mapping to verb', () => {
    const addEvent = {
      eventType: 'ObjectEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
      action: 'ADD',
      bizStep: 'urn:epcglobal:cbv:bizstep:packing',
    }

    const deleteEvent = {
      eventType: 'ObjectEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
      action: 'DELETE',
      bizStep: 'urn:epcglobal:cbv:bizstep:destroying',
    }

    const addResult = normalize(addEvent)
    const deleteResult = normalize(deleteEvent)

    // bizStep should be primary verb, action is context
    expect(addResult[0].verb).toBe('packing')
    expect(addResult[0].context).toMatchObject({ action: 'ADD' })

    expect(deleteResult[0].verb).toBe('destroying')
    expect(deleteResult[0].context).toMatchObject({ action: 'DELETE' })
  })
})

// ============================================================================
// EPCIS AggregationEvent Conversion Tests
// ============================================================================

describe('normalize - EPCIS AggregationEvent conversion', () => {
  it('converts EPCIS AggregationEvent to 5W+H', () => {
    const epcisEvent = {
      eventType: 'AggregationEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      parentID: 'urn:epc:id:sscc:0614141.1234567890',
      childEPCs: ['urn:epc:id:sgtin:0614141.107346.2017', 'urn:epc:id:sgtin:0614141.107346.2018'],
      action: 'ADD',
      bizStep: 'urn:epcglobal:cbv:bizstep:packing',
    }

    const result = normalize(epcisEvent)

    expect(result).toHaveLength(1)
    const event = result[0] as Event5WH

    expect(event.type).toBe('AggregationEvent')
    expect(event.object).toBe('urn:epc:id:sscc:0614141.1234567890')
    expect(event.verb).toBe('packing')
    expect(event.context).toMatchObject({
      childEPCs: ['urn:epc:id:sgtin:0614141.107346.2017', 'urn:epc:id:sgtin:0614141.107346.2018'],
      action: 'ADD',
    })
  })
})

// ============================================================================
// EPCIS TransformationEvent Conversion Tests
// ============================================================================

describe('normalize - EPCIS TransformationEvent conversion', () => {
  it('converts EPCIS TransformationEvent to 5W+H', () => {
    const epcisEvent = {
      eventType: 'TransformationEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      inputEPCList: ['urn:epc:id:sgtin:0614141.107346.2017'],
      inputQuantityList: [{ epcClass: 'urn:epc:class:lgtin:0614141.107346.lot1', quantity: 100 }],
      outputEPCList: ['urn:epc:id:sgtin:0614141.107347.3001'],
      outputQuantityList: [{ epcClass: 'urn:epc:class:lgtin:0614141.107347.lot2', quantity: 50 }],
      bizStep: 'urn:epcglobal:cbv:bizstep:transforming',
    }

    const result = normalize(epcisEvent)

    expect(result).toHaveLength(1)
    const event = result[0] as Event5WH

    expect(event.type).toBe('TransformationEvent')
    expect(event.verb).toBe('transforming')
    expect(event.context).toMatchObject({
      inputEPCList: ['urn:epc:id:sgtin:0614141.107346.2017'],
      outputEPCList: ['urn:epc:id:sgtin:0614141.107347.3001'],
    })
  })
})

// ============================================================================
// Evalite Trace Conversion Tests
// ============================================================================

describe('normalize - Evalite trace conversion', () => {
  it('converts evalite trace to 5W+H event', () => {
    const evaliteEvent = {
      traceId: 'trace-abc123',
      spanId: 'span-def456',
      name: 'type-classifier',
      input: { spec: 'function to add numbers' },
      output: { type: 'code', reasoning: 'deterministic math operation' },
      duration: 1200,
      model: 'claude-3-5-sonnet',
      tokens: { input: 500, output: 100 },
      score: 0.92,
    }

    const result = normalize(evaliteEvent)

    expect(result).toHaveLength(1)
    const event = result[0] as Event5WH

    // WHAT mapping
    expect(event.object).toBe('type-classifier')
    expect(event.type).toBe('eval')

    // WHY mapping
    expect(event.verb).toBe('evaluated')

    // HOW mapping
    expect(event.method).toBe('generative')
    expect(event.model).toBe('claude-3-5-sonnet')

    // Context should include eval-specific data
    expect(event.context).toMatchObject({
      traceId: 'trace-abc123',
      spanId: 'span-def456',
      score: 0.92,
      duration: 1200,
      tokens: { input: 500, output: 100 },
      input: { spec: 'function to add numbers' },
      output: { type: 'code', reasoning: 'deterministic math operation' },
    })
  })

  it('handles evalite trace with branch (experiment variant)', () => {
    const evaliteEvent = {
      traceId: 'trace-abc123',
      name: 'code-generator',
      model: 'claude-3-5-sonnet',
      branch: 'experiment-v2',
      score: 0.85,
      duration: 2500,
    }

    const result = normalize(evaliteEvent)
    const event = result[0] as Event5WH

    expect(event.branch).toBe('experiment-v2')
  })

  it('handles evalite trace with tool calls (agentic)', () => {
    const evaliteEvent = {
      traceId: 'trace-abc123',
      name: 'research-agent',
      model: 'claude-3-5-sonnet',
      tools: ['web_search', 'read_document', 'summarize'],
      score: 0.78,
      duration: 15000,
    }

    const result = normalize(evaliteEvent)
    const event = result[0] as Event5WH

    expect(event.method).toBe('agentic')
    expect(event.tools).toEqual(['web_search', 'read_document', 'summarize'])
  })

  it('derives timestamp from evalite trace', () => {
    const evaliteEvent = {
      traceId: 'trace-abc123',
      name: 'classifier',
      startTime: '2026-01-08T10:00:00.000Z',
      endTime: '2026-01-08T10:00:01.200Z',
      model: 'claude-3-5-sonnet',
    }

    const result = normalize(evaliteEvent)
    const event = result[0] as Event5WH

    expect(event.timestamp).toBe('2026-01-08T10:00:00.000Z')
  })

  it('infers ns from evalite trace metadata', () => {
    const evaliteEvent = {
      traceId: 'trace-abc123',
      name: 'classifier',
      model: 'claude-3-5-sonnet',
      metadata: {
        namespace: 'evals.example.com.ai',
        environment: 'production',
      },
    }

    const result = normalize(evaliteEvent)
    const event = result[0] as Event5WH

    expect(event.ns).toBe('evals.example.com.ai')
  })
})

// ============================================================================
// Batch Event Handling Tests
// ============================================================================

describe('normalize - Batch events', () => {
  it('handles array of internal events', () => {
    const events = [
      {
        actor: 'user:alice',
        object: 'order:1',
        type: 'Order',
        verb: 'created',
        timestamp: '2026-01-08T10:00:00Z',
        recorded: '2026-01-08T10:00:01Z',
        ns: 'app.example.com.ai',
      },
      {
        actor: 'user:bob',
        object: 'order:2',
        type: 'Order',
        verb: 'created',
        timestamp: '2026-01-08T10:01:00Z',
        recorded: '2026-01-08T10:01:01Z',
        ns: 'app.example.com.ai',
      },
    ]

    const result = normalize(events)

    expect(result).toHaveLength(2)
    expect(result[0].object).toBe('order:1')
    expect(result[1].object).toBe('order:2')
  })

  it('handles array of EPCIS events', () => {
    const events = [
      {
        eventType: 'ObjectEvent',
        eventTime: '2026-01-08T10:00:00.000Z',
        epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
        action: 'OBSERVE',
        bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
      },
      {
        eventType: 'ObjectEvent',
        eventTime: '2026-01-08T10:01:00.000Z',
        epcList: ['urn:epc:id:sgtin:0614141.107346.2018'],
        action: 'OBSERVE',
        bizStep: 'urn:epcglobal:cbv:bizstep:receiving',
      },
    ]

    const result = normalize(events)

    expect(result).toHaveLength(2)
    expect(result[0].verb).toBe('shipping')
    expect(result[1].verb).toBe('receiving')
  })

  it('handles array of evalite traces', () => {
    const events = [
      {
        traceId: 'trace-1',
        name: 'classifier-1',
        model: 'claude-3-5-sonnet',
        score: 0.9,
      },
      {
        traceId: 'trace-2',
        name: 'classifier-2',
        model: 'claude-3-5-sonnet',
        score: 0.85,
      },
    ]

    const result = normalize(events)

    expect(result).toHaveLength(2)
    expect(result[0].object).toBe('classifier-1')
    expect(result[1].object).toBe('classifier-2')
  })

  it('handles mixed format batch events', () => {
    const events = [
      // Internal format
      {
        actor: 'user:alice',
        object: 'order:1',
        type: 'Order',
        verb: 'created',
        timestamp: '2026-01-08T10:00:00Z',
        recorded: '2026-01-08T10:00:01Z',
        ns: 'app.example.com.ai',
      },
      // EPCIS format
      {
        eventType: 'ObjectEvent',
        eventTime: '2026-01-08T10:01:00.000Z',
        epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
        action: 'OBSERVE',
        bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
      },
      // Evalite format
      {
        traceId: 'trace-1',
        name: 'classifier',
        model: 'claude-3-5-sonnet',
        score: 0.9,
      },
    ]

    const result = normalize(events)

    expect(result).toHaveLength(3)

    // Internal event passthrough
    expect(result[0].object).toBe('order:1')
    expect(result[0].verb).toBe('created')

    // EPCIS conversion
    expect(result[1].object).toBe('urn:epc:id:sgtin:0614141.107346.2017')
    expect(result[1].verb).toBe('shipping')

    // Evalite conversion
    expect(result[2].object).toBe('classifier')
    expect(result[2].verb).toBe('evaluated')
  })

  it('handles EPCIS eventList wrapper', () => {
    const wrapper = {
      '@context': 'https://ref.gs1.org/standards/epcis/epcis-context.jsonld',
      type: 'EPCISDocument',
      eventList: [
        {
          eventType: 'ObjectEvent',
          eventTime: '2026-01-08T10:00:00.000Z',
          epcList: ['urn:epc:id:sgtin:0614141.107346.2017'],
          action: 'OBSERVE',
          bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
        },
        {
          eventType: 'ObjectEvent',
          eventTime: '2026-01-08T10:01:00.000Z',
          epcList: ['urn:epc:id:sgtin:0614141.107346.2018'],
          action: 'OBSERVE',
          bizStep: 'urn:epcglobal:cbv:bizstep:receiving',
        },
      ],
    }

    const result = normalize(wrapper)

    expect(result).toHaveLength(2)
    expect(result[0].verb).toBe('shipping')
    expect(result[1].verb).toBe('receiving')
  })

  it('flattens EPCIS events with multiple EPCs', () => {
    const events = [
      {
        eventType: 'ObjectEvent',
        eventTime: '2026-01-08T10:00:00.000Z',
        epcList: ['urn:epc:id:sgtin:0614141.107346.2017', 'urn:epc:id:sgtin:0614141.107346.2018'],
        action: 'OBSERVE',
        bizStep: 'urn:epcglobal:cbv:bizstep:shipping',
      },
    ]

    const result = normalize(events)

    // Should expand to 2 events (one per EPC)
    expect(result).toHaveLength(2)
  })

  it('returns empty array for empty batch', () => {
    const result = normalize([])
    expect(result).toEqual([])
  })
})

// ============================================================================
// Invalid Format Handling Tests
// ============================================================================

describe('normalize - Invalid format handling', () => {
  it('throws error for null input', () => {
    expect(() => normalize(null)).toThrow()
  })

  it('throws error for undefined input', () => {
    expect(() => normalize(undefined)).toThrow()
  })

  it('throws error for primitive input', () => {
    expect(() => normalize('string' as unknown)).toThrow()
    expect(() => normalize(123 as unknown)).toThrow()
    expect(() => normalize(true as unknown)).toThrow()
  })

  it('throws error for unrecognized object format', () => {
    const unknownEvent = {
      foo: 'bar',
      baz: 123,
    }

    expect(() => normalize(unknownEvent)).toThrow(/unrecognized.*format/i)
  })

  it('includes helpful error message for invalid format', () => {
    const unknownEvent = {
      randomField: 'value',
    }

    expect(() => normalize(unknownEvent)).toThrow()

    try {
      normalize(unknownEvent)
    } catch (e) {
      expect((e as Error).message).toMatch(/format|unknown|invalid/i)
    }
  })

  it('skips invalid events in batch and continues', () => {
    const events = [
      {
        actor: 'user:alice',
        object: 'order:1',
        type: 'Order',
        verb: 'created',
        timestamp: '2026-01-08T10:00:00Z',
        recorded: '2026-01-08T10:00:01Z',
        ns: 'app.example.com.ai',
      },
      {
        // Invalid - missing required fields
        foo: 'bar',
      },
      {
        actor: 'user:bob',
        object: 'order:2',
        type: 'Order',
        verb: 'created',
        timestamp: '2026-01-08T10:01:00Z',
        recorded: '2026-01-08T10:01:01Z',
        ns: 'app.example.com.ai',
      },
    ]

    // Option 1: Throw on any invalid event
    // expect(() => normalize(events)).toThrow()

    // Option 2: Skip invalid events (more lenient)
    // This test checks both behaviors - implementation can choose
    try {
      const result = normalize(events)
      // If it doesn't throw, should skip invalid event
      expect(result).toHaveLength(2)
      expect(result[0].object).toBe('order:1')
      expect(result[1].object).toBe('order:2')
    } catch {
      // If it throws, that's also valid behavior
      expect(true).toBe(true)
    }
  })

  it('handles incomplete internal events gracefully', () => {
    const incompleteEvent = {
      actor: 'user:alice',
      // Missing: object, type, verb, timestamp, ns
    }

    expect(() => normalize(incompleteEvent)).toThrow(/missing.*required/i)
  })

  it('handles incomplete EPCIS events gracefully', () => {
    const incompleteEvent = {
      eventType: 'ObjectEvent',
      // Missing: eventTime, epcList/quantityList
    }

    expect(() => normalize(incompleteEvent)).toThrow()
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('normalize - Edge cases', () => {
  it('handles very long EPC lists efficiently', () => {
    const manyEPCs = Array.from({ length: 1000 }, (_, i) => `urn:epc:id:sgtin:0614141.107346.${i}`)

    const epcisEvent = {
      eventType: 'ObjectEvent',
      eventTime: '2026-01-08T10:00:00.000Z',
      epcList: manyEPCs,
      action: 'OBSERVE',
      bizStep: 'urn:epcglobal:cbv:bizstep:commissioning',
    }

    const start = Date.now()
    const result = normalize(epcisEvent)
    const duration = Date.now() - start

    expect(result).toHaveLength(1000)
    expect(duration).toBeLessThan(1000) // Should complete in under 1 second
  })

  it('handles unicode in event data', () => {
    const event = {
      actor: 'user:alice',
      object: 'product:cafe-latte-\u2615',
      type: 'Product',
      verb: 'created',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'app.example.com.ai',
      context: {
        name: '\u304a\u8336',
        description: 'Caf\u00e9 con leche \ud83c\udf75',
      },
    }

    const result = normalize(event)

    expect(result[0].object).toBe('product:cafe-latte-\u2615')
    expect((result[0].context as Record<string, unknown>).name).toBe('\u304a\u8336')
  })

  it('handles deeply nested context objects', () => {
    const event = {
      actor: 'user:alice',
      object: 'order:123',
      type: 'Order',
      verb: 'created',
      timestamp: '2026-01-08T10:00:00Z',
      recorded: '2026-01-08T10:00:01Z',
      ns: 'app.example.com.ai',
      context: {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep',
              },
            },
          },
        },
      },
    }

    const result = normalize(event)

    expect((result[0].context as Record<string, unknown>).level1).toBeDefined()
  })

  it('handles ISO 8601 timestamps with various formats', () => {
    const timestamps = [
      '2026-01-08T10:00:00Z',
      '2026-01-08T10:00:00.000Z',
      '2026-01-08T10:00:00+00:00',
      '2026-01-08T10:00:00-06:00',
      '2026-01-08T16:00:00+00:00',
    ]

    for (const ts of timestamps) {
      const event = {
        actor: 'user:alice',
        object: 'order:123',
        type: 'Order',
        verb: 'created',
        timestamp: ts,
        recorded: ts,
        ns: 'app.example.com.ai',
      }

      const result = normalize(event)
      expect(result[0].timestamp).toBeDefined()
    }
  })

  it('preserves event order in batch processing', () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      actor: 'user:alice',
      object: `order:${i}`,
      type: 'Order',
      verb: 'created',
      timestamp: `2026-01-08T10:00:${String(i).padStart(2, '0')}Z`,
      recorded: `2026-01-08T10:00:${String(i).padStart(2, '0')}Z`,
      ns: 'app.example.com.ai',
    }))

    const result = normalize(events)

    expect(result).toHaveLength(100)
    for (let i = 0; i < 100; i++) {
      expect(result[i].object).toBe(`order:${i}`)
    }
  })
})
