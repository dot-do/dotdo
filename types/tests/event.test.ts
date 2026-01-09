import { describe, it, expect } from 'vitest'

/**
 * 5W+H Event Type Tests (RED Phase)
 *
 * These tests verify the 5W+H Event type that captures WHO, WHAT, WHEN, WHERE, WHY, and HOW.
 * This model maps 1:1 to EPCIS 2.0 for supply chain interoperability.
 *
 * Implementation requirements:
 * - Create types/event.ts with the Event interface
 * - Define FunctionMethod type enum for HOW.method field
 * - Create EventSchema for runtime validation
 * - Export from types/index.ts
 *
 * Reference: docs/plans/2026-01-08-functions-experiments-events-design.md
 * Reference: docs/concepts/events.mdx
 */

// These imports should fail until the types are implemented
import type {
  Event,
  EventData,
  FunctionMethod,
  EventWho,
  EventWhat,
  EventWhen,
  EventWhere,
  EventWhy,
  EventHow,
} from '../event'

import { EventSchema, validateEvent, createEvent } from '../event'

// ============================================================================
// Type Definition Tests
// ============================================================================

describe('Event Type Definition', () => {
  it('should define Event interface with all 5W+H fields', () => {
    // This test verifies the Event type exists with all required fields
    const event: Event = {
      // WHO
      actor: 'user-123',
      source: 'https://api.example.com',
      destination: 'https://webhook.example.com',

      // WHAT
      object: 'K3mR8', // Sqid reference
      type: 'Customer',
      quantity: 1,

      // WHEN
      timestamp: new Date('2026-01-08T12:00:00Z'),
      recorded: new Date('2026-01-08T12:00:01Z'),

      // WHERE
      ns: 'https://startups.studio',
      location: 'us-east-1',
      readPoint: '/api/customers',

      // WHY
      verb: 'created',
      disposition: 'active',
      reason: 'New customer registration',

      // HOW
      method: 'code',
      branch: 'main',
      model: undefined,
      tools: undefined,
      channel: undefined,
      cascade: undefined,
      transaction: 'txn-12345',
      context: { source: 'signup-form' },
    }

    expect(event).toBeDefined()
    expect(event.actor).toBe('user-123')
    expect(event.verb).toBe('created')
  })

  it('should define EventData as a partial event for creation', () => {
    // EventData should only require the mandatory fields
    const data: EventData = {
      actor: 'user-123',
      object: 'K3mR8',
      type: 'Customer',
      verb: 'created',
      ns: 'https://startups.studio',
    }

    expect(data.actor).toBe('user-123')
    expect(data.timestamp).toBeUndefined() // Should be auto-filled
    expect(data.recorded).toBeUndefined() // Should be auto-filled
  })
})

// ============================================================================
// WHO Field Tests (actor, source, destination)
// ============================================================================

describe('Event WHO Fields', () => {
  it('should require actor field', () => {
    const who: EventWho = {
      actor: 'user-123',
    }

    expect(who.actor).toBe('user-123')
  })

  it('should allow optional source and destination', () => {
    const who: EventWho = {
      actor: 'agent-456',
      source: 'https://source.example.com',
      destination: 'https://dest.example.com',
    }

    expect(who.source).toBe('https://source.example.com')
    expect(who.destination).toBe('https://dest.example.com')
  })

  it('should validate actor is non-empty string', () => {
    const result = validateEvent({
      actor: '',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'actor' })
    )
  })

  it('should validate source is a valid URL when provided', () => {
    const result = validateEvent({
      actor: 'user-123',
      source: 'not-a-url',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'source' })
    )
  })
})

// ============================================================================
// WHAT Field Tests (object, type, quantity)
// ============================================================================

describe('Event WHAT Fields', () => {
  it('should require object and type fields', () => {
    const what: EventWhat = {
      object: 'K3mR8',
      type: 'Customer',
    }

    expect(what.object).toBe('K3mR8')
    expect(what.type).toBe('Customer')
  })

  it('should allow optional quantity', () => {
    const what: EventWhat = {
      object: 'batch-001',
      type: 'Product',
      quantity: 100,
    }

    expect(what.quantity).toBe(100)
  })

  it('should validate object is non-empty string', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: '',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'object' })
    )
  })

  it('should validate type is non-empty string', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: '',
      verb: 'created',
      ns: 'https://example.com',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'type' })
    )
  })

  it('should validate quantity is positive number when provided', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Product',
      quantity: -5,
      verb: 'created',
      ns: 'https://example.com',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'quantity' })
    )
  })
})

// ============================================================================
// WHEN Field Tests (timestamp, recorded)
// ============================================================================

describe('Event WHEN Fields', () => {
  it('should support Date objects for timestamps', () => {
    const when: EventWhen = {
      timestamp: new Date('2026-01-08T12:00:00Z'),
      recorded: new Date('2026-01-08T12:00:01Z'),
    }

    expect(when.timestamp).toBeInstanceOf(Date)
    expect(when.recorded).toBeInstanceOf(Date)
  })

  it('should support ISO string timestamps', () => {
    const when: EventWhen = {
      timestamp: '2026-01-08T12:00:00Z',
      recorded: '2026-01-08T12:00:01Z',
    }

    expect(when.timestamp).toBe('2026-01-08T12:00:00Z')
  })

  it('should auto-generate timestamp and recorded if not provided', () => {
    const event = createEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
    })

    expect(event.timestamp).toBeDefined()
    expect(event.recorded).toBeDefined()
    expect(event.timestamp).toBeInstanceOf(Date)
    expect(event.recorded).toBeInstanceOf(Date)
  })

  it('should validate timestamp is before or equal to recorded', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
      timestamp: new Date('2026-01-08T12:00:00Z'),
      recorded: new Date('2026-01-08T11:00:00Z'), // Before timestamp - invalid
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'recorded' })
    )
  })

  it('should validate timestamps are valid dates', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
      timestamp: 'invalid-date',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'timestamp' })
    )
  })
})

// ============================================================================
// WHERE Field Tests (ns, location, readPoint)
// ============================================================================

describe('Event WHERE Fields', () => {
  it('should require ns (namespace) field', () => {
    const where: EventWhere = {
      ns: 'https://startups.studio',
    }

    expect(where.ns).toBe('https://startups.studio')
  })

  it('should allow optional location and readPoint', () => {
    const where: EventWhere = {
      ns: 'https://startups.studio',
      location: 'warehouse-01',
      readPoint: '/api/inventory/scan',
    }

    expect(where.location).toBe('warehouse-01')
    expect(where.readPoint).toBe('/api/inventory/scan')
  })

  it('should validate ns is a valid URL', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'not-a-url',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'ns' })
    )
  })

  it('should validate ns is non-empty', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: '',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'ns' })
    )
  })
})

// ============================================================================
// WHY Field Tests (verb, disposition, reason)
// ============================================================================

describe('Event WHY Fields', () => {
  it('should require verb field', () => {
    const why: EventWhy = {
      verb: 'created',
    }

    expect(why.verb).toBe('created')
  })

  it('should allow optional disposition and reason', () => {
    const why: EventWhy = {
      verb: 'shipped',
      disposition: 'in_transit',
      reason: 'Customer order fulfillment',
    }

    expect(why.disposition).toBe('in_transit')
    expect(why.reason).toBe('Customer order fulfillment')
  })

  it('should validate verb is non-empty string', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: '',
      ns: 'https://example.com',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'verb' })
    )
  })

  it('should accept common verb values', () => {
    const verbs = ['created', 'updated', 'deleted', 'shipped', 'received', 'processed', 'failed']

    for (const verb of verbs) {
      const result = validateEvent({
        actor: 'user-123',
        object: 'K3m',
        type: 'Thing',
        verb,
        ns: 'https://example.com',
      })

      expect(result.success).toBe(true)
    }
  })
})

// ============================================================================
// HOW Field Tests (method, branch, model, tools, channel, cascade, transaction, context)
// ============================================================================

describe('Event HOW Fields', () => {
  it('should define FunctionMethod type with valid values', () => {
    const methods: FunctionMethod[] = ['code', 'generative', 'agentic', 'human']

    expect(methods).toContain('code')
    expect(methods).toContain('generative')
    expect(methods).toContain('agentic')
    expect(methods).toContain('human')
  })

  it('should allow all HOW fields as optional', () => {
    const how: EventHow = {}

    expect(how.method).toBeUndefined()
    expect(how.branch).toBeUndefined()
    expect(how.model).toBeUndefined()
    expect(how.tools).toBeUndefined()
    expect(how.channel).toBeUndefined()
    expect(how.cascade).toBeUndefined()
    expect(how.transaction).toBeUndefined()
    expect(how.context).toBeUndefined()
  })

  it('should support method field with FunctionMethod type', () => {
    const how: EventHow = {
      method: 'generative',
    }

    expect(how.method).toBe('generative')
  })

  it('should support branch field for experiment variants', () => {
    const how: EventHow = {
      method: 'code',
      branch: 'experiment-v2',
    }

    expect(how.branch).toBe('experiment-v2')
  })

  it('should support model field for AI model tracking', () => {
    const how: EventHow = {
      method: 'generative',
      model: 'claude-3-5-sonnet',
    }

    expect(how.model).toBe('claude-3-5-sonnet')
  })

  it('should support tools array for agentic functions', () => {
    const how: EventHow = {
      method: 'agentic',
      tools: ['search', 'calculator', 'browser'],
    }

    expect(how.tools).toEqual(['search', 'calculator', 'browser'])
  })

  it('should support channel field for human-in-the-loop', () => {
    const how: EventHow = {
      method: 'human',
      channel: 'slack',
    }

    expect(how.channel).toBe('slack')
  })

  it('should support cascade field for tracking cascade path', () => {
    const how: EventHow = {
      method: 'agentic',
      cascade: {
        attempts: [
          { method: 'code', failed: true, reason: 'type mismatch' },
          { method: 'generative', failed: true, reason: 'invalid output' },
          { method: 'agentic', failed: false },
        ],
      },
    }

    expect(how.cascade).toBeDefined()
    expect(how.cascade?.attempts).toHaveLength(3)
  })

  it('should support transaction field for business transaction ID', () => {
    const how: EventHow = {
      transaction: 'txn-order-12345',
    }

    expect(how.transaction).toBe('txn-order-12345')
  })

  it('should support context field for additional data', () => {
    const how: EventHow = {
      context: {
        requestId: 'req-abc123',
        userAgent: 'Mozilla/5.0',
        ip: '192.168.1.1',
      },
    }

    expect(how.context).toEqual({
      requestId: 'req-abc123',
      userAgent: 'Mozilla/5.0',
      ip: '192.168.1.1',
    })
  })

  it('should validate method is a valid FunctionMethod', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
      method: 'invalid-method' as FunctionMethod,
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'method' })
    )
  })

  it('should validate tools is an array of strings when provided', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
      tools: 'not-an-array' as unknown as string[],
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'tools' })
    )
  })
})

// ============================================================================
// Event Schema Tests
// ============================================================================

describe('EventSchema', () => {
  it('should export EventSchema for runtime validation', () => {
    expect(EventSchema).toBeDefined()
  })

  it('should parse valid event data', () => {
    const result = EventSchema.safeParse({
      actor: 'user-123',
      object: 'K3mR8',
      type: 'Customer',
      verb: 'created',
      ns: 'https://startups.studio',
      timestamp: new Date(),
      recorded: new Date(),
    })

    expect(result.success).toBe(true)
  })

  it('should reject invalid event data', () => {
    const result = EventSchema.safeParse({
      // Missing required fields
      actor: 'user-123',
    })

    expect(result.success).toBe(false)
  })

  it('should coerce string dates to Date objects', () => {
    const result = EventSchema.safeParse({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
      timestamp: '2026-01-08T12:00:00Z',
      recorded: '2026-01-08T12:00:01Z',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.timestamp).toBeInstanceOf(Date)
      expect(result.data.recorded).toBeInstanceOf(Date)
    }
  })
})

// ============================================================================
// createEvent Function Tests
// ============================================================================

describe('createEvent', () => {
  it('should create a complete event from minimal data', () => {
    const event = createEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Customer',
      verb: 'created',
      ns: 'https://startups.studio',
    })

    // Required fields
    expect(event.actor).toBe('user-123')
    expect(event.object).toBe('K3m')
    expect(event.type).toBe('Customer')
    expect(event.verb).toBe('created')
    expect(event.ns).toBe('https://startups.studio')

    // Auto-generated fields
    expect(event.timestamp).toBeDefined()
    expect(event.recorded).toBeDefined()
  })

  it('should preserve provided optional fields', () => {
    const event = createEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Customer',
      verb: 'created',
      ns: 'https://startups.studio',
      source: 'https://api.example.com',
      method: 'code',
      branch: 'main',
    })

    expect(event.source).toBe('https://api.example.com')
    expect(event.method).toBe('code')
    expect(event.branch).toBe('main')
  })

  it('should not override provided timestamp', () => {
    const customTimestamp = new Date('2026-01-01T00:00:00Z')

    const event = createEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Customer',
      verb: 'created',
      ns: 'https://startups.studio',
      timestamp: customTimestamp,
    })

    expect(event.timestamp).toEqual(customTimestamp)
  })

  it('should throw on invalid data', () => {
    expect(() => {
      createEvent({
        actor: '', // Invalid: empty
        object: 'K3m',
        type: 'Customer',
        verb: 'created',
        ns: 'https://startups.studio',
      })
    }).toThrow()
  })
})

// ============================================================================
// validateEvent Function Tests
// ============================================================================

describe('validateEvent', () => {
  it('should return success for valid event', () => {
    const result = validateEvent({
      actor: 'user-123',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
    })

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should return errors for multiple invalid fields', () => {
    const result = validateEvent({
      actor: '',
      object: '',
      type: '',
      verb: '',
      ns: '',
    })

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })

  it('should include field path in error details', () => {
    const result = validateEvent({
      actor: '',
      object: 'K3m',
      type: 'Thing',
      verb: 'created',
      ns: 'https://example.com',
    })

    expect(result.success).toBe(false)
    expect(result.errors[0]).toHaveProperty('field')
    expect(result.errors[0]).toHaveProperty('message')
  })
})

// ============================================================================
// EPCIS Compatibility Tests
// ============================================================================

describe('EPCIS Compatibility', () => {
  it('should map to EPCIS WHO fields', () => {
    // EPCIS: source, destination
    // 5W+H: source, destination
    const event: Event = {
      actor: 'urn:epc:id:sgln:0614141.00001.0',
      source: 'urn:epc:id:sgln:0614141.00001.0',
      destination: 'urn:epc:id:sgln:0614141.00002.0',
      object: 'urn:epc:id:sgtin:0614141.107346.2017',
      type: 'ObjectEvent',
      verb: 'shipping',
      ns: 'https://gs1.example.com',
      timestamp: new Date(),
      recorded: new Date(),
    }

    expect(event.source).toBeDefined()
    expect(event.destination).toBeDefined()
  })

  it('should map to EPCIS WHAT fields', () => {
    // EPCIS: epcList, parentID
    // 5W+H: object, type, quantity
    const event: Event = {
      actor: 'scanner-001',
      object: 'urn:epc:id:sgtin:0614141.107346.2017',
      type: 'AggregationEvent',
      quantity: 24,
      verb: 'aggregating',
      ns: 'https://gs1.example.com',
      timestamp: new Date(),
      recorded: new Date(),
    }

    expect(event.object).toBeDefined()
    expect(event.type).toBe('AggregationEvent')
    expect(event.quantity).toBe(24)
  })

  it('should map to EPCIS WHEN fields', () => {
    // EPCIS: eventTime, recordTime
    // 5W+H: timestamp, recorded
    const eventTime = new Date('2026-01-08T10:00:00Z')
    const recordTime = new Date('2026-01-08T10:00:05Z')

    const event: Event = {
      actor: 'scanner-001',
      object: 'urn:epc:id:sgtin:0614141.107346.2017',
      type: 'ObjectEvent',
      verb: 'receiving',
      ns: 'https://gs1.example.com',
      timestamp: eventTime, // Maps to eventTime
      recorded: recordTime, // Maps to recordTime
    }

    expect(event.timestamp).toEqual(eventTime)
    expect(event.recorded).toEqual(recordTime)
  })

  it('should map to EPCIS WHERE fields', () => {
    // EPCIS: readPoint, bizLocation
    // 5W+H: readPoint, location, ns
    const event: Event = {
      actor: 'scanner-001',
      object: 'urn:epc:id:sgtin:0614141.107346.2017',
      type: 'ObjectEvent',
      verb: 'receiving',
      ns: 'https://gs1.example.com',
      location: 'urn:epc:id:sgln:0614141.00001.0', // Maps to bizLocation
      readPoint: 'urn:epc:id:sgln:0614141.00001.1', // Maps to readPoint
      timestamp: new Date(),
      recorded: new Date(),
    }

    expect(event.location).toBeDefined()
    expect(event.readPoint).toBeDefined()
  })

  it('should map to EPCIS WHY fields', () => {
    // EPCIS: bizStep, disposition
    // 5W+H: verb, disposition
    const event: Event = {
      actor: 'scanner-001',
      object: 'urn:epc:id:sgtin:0614141.107346.2017',
      type: 'ObjectEvent',
      verb: 'shipping', // Maps to bizStep
      disposition: 'in_transit', // Maps to disposition
      ns: 'https://gs1.example.com',
      timestamp: new Date(),
      recorded: new Date(),
    }

    expect(event.verb).toBe('shipping')
    expect(event.disposition).toBe('in_transit')
  })

  it('should map to EPCIS HOW fields', () => {
    // EPCIS: bizTransaction
    // 5W+H: transaction
    const event: Event = {
      actor: 'scanner-001',
      object: 'urn:epc:id:sgtin:0614141.107346.2017',
      type: 'TransactionEvent',
      verb: 'receiving',
      ns: 'https://gs1.example.com',
      transaction: 'urn:epc:id:gdti:0614141.00001.1234', // Maps to bizTransaction
      timestamp: new Date(),
      recorded: new Date(),
    }

    expect(event.transaction).toBeDefined()
  })
})

// ============================================================================
// Evalite Integration Tests
// ============================================================================

describe('Evalite Event Format', () => {
  it('should support eval events with model and context', () => {
    const evalEvent: Event = {
      // WHO
      actor: 'evalite-runner',

      // WHAT
      object: 'type-classifier',
      type: 'eval',

      // WHEN
      timestamp: new Date(),
      recorded: new Date(),

      // WHERE
      ns: 'https://evals.startups.studio',

      // WHY
      verb: 'evaluated',

      // HOW
      method: 'generative',
      branch: 'main',
      model: 'claude-3-5-sonnet',
      context: {
        score: 0.92,
        latency: 1200,
        tokens: { input: 500, output: 100 },
      },
    }

    expect(evalEvent.type).toBe('eval')
    expect(evalEvent.verb).toBe('evaluated')
    expect(evalEvent.model).toBe('claude-3-5-sonnet')
    expect(evalEvent.context).toHaveProperty('score')
    expect(evalEvent.context).toHaveProperty('tokens')
  })
})

// ============================================================================
// Subscription DSL Compatibility Tests
// ============================================================================

describe('Subscription DSL Event Structure', () => {
  it('should have structure compatible with $.on handlers', () => {
    // Events used with $.on.Customer.created should have predictable structure
    const event: Event = {
      actor: 'user-123',
      object: 'cust-456',
      type: 'Customer',
      verb: 'created',
      ns: 'https://app.example.com',
      timestamp: new Date(),
      recorded: new Date(),
    }

    // These are the fields commonly accessed in event handlers
    expect(event.actor).toBeDefined()
    expect(event.verb).toBeDefined()
    expect(event.object).toBeDefined()
    expect(event.type).toBeDefined()
    expect(event.ns).toBeDefined()
    expect(event.timestamp).toBeDefined()
  })

  it('should support pattern matching on verb', () => {
    // For $.on.*.failed pattern matching
    const failedEvent: Event = {
      actor: 'system',
      object: 'job-789',
      type: 'Job',
      verb: 'failed',
      ns: 'https://app.example.com',
      reason: 'Timeout exceeded',
      timestamp: new Date(),
      recorded: new Date(),
    }

    expect(failedEvent.verb).toBe('failed')
    expect(failedEvent.reason).toBe('Timeout exceeded')
  })
})
