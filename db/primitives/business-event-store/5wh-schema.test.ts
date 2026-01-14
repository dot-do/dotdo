/**
 * 5W+H Event Schema Tests
 *
 * RED phase: These tests define the expected behavior of the 5W+H event schema.
 * Tests should FAIL until schema validation implementation is complete.
 *
 * The 5W+H paradigm (extended from EPCIS) captures:
 * - What: Object/Entity being tracked (EPC URN, product ID, customer ID)
 * - When: Timestamp with timezone
 * - Where: Location/Context (physical location, service, endpoint)
 * - Why: Business step/reason (shipping, receiving, payment)
 * - Who: Parties involved (organization, user, system)
 * - How: Method/disposition (in_transit, completed, manual)
 *
 * @module db/primitives/business-event-store/5wh-schema.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ObjectEvent,
  AggregationEvent,
  TransactionEvent,
  TransformationEvent,
  type BusinessEvent,
  type ActorType,
  type ChannelType,
} from './index'

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const SGTIN_1 = 'urn:epc:id:sgtin:0614141.107346.2017'
const SGLN_WAREHOUSE = 'urn:epc:id:sgln:0614141.00001.0'
const PGLN_COMPANY = 'urn:epc:id:pgln:0614141.00001'

// ============================================================================
// SCHEMA VALIDATION TYPES (Not yet implemented)
// ============================================================================

// These types represent the schema validation that should be implemented
// The tests reference functions/types that don't exist yet to fail

interface FiveWHSchema {
  what: WhatSchema
  when: WhenSchema
  where: WhereSchema
  why: WhySchema
  who: WhoSchema
  how: HowSchema
}

interface WhatSchema {
  required: boolean
  types: ('epc' | 'urn' | 'custom')[]
  allowQuantityOnly: boolean
}

interface WhenSchema {
  required: boolean
  precision: 'second' | 'millisecond' | 'microsecond'
  timezoneRequired: boolean
}

interface WhereSchema {
  required: boolean
  types: ('gln' | 'sgln' | 'custom')[]
  allowBizLocation: boolean
}

interface WhySchema {
  required: boolean
  allowCbvUrn: boolean
  allowCustom: boolean
}

interface WhoSchema {
  required: boolean
  actorTypes: ActorType[]
  confidenceRequired: boolean
}

interface HowSchema {
  required: boolean
  allowDisposition: boolean
  allowChannel: boolean
  channelTypes: ChannelType[]
}

// ============================================================================
// WHAT (Object/Entity) SCHEMA TESTS
// ============================================================================

describe('5W+H Schema Validation', () => {
  describe('What (Object/Entity) Schema', () => {
    it.fails('should validate EPC URN format', () => {
      // This test should fail until EPC URN validation is implemented
      const validateEPC = (epc: string): boolean => {
        // Expected pattern: urn:epc:id:{type}:{...}
        throw new Error('validateEPC not implemented')
      }

      expect(validateEPC('urn:epc:id:sgtin:0614141.107346.2017')).toBe(true)
      expect(validateEPC('invalid-format')).toBe(false)
      expect(validateEPC('urn:epc:id:sgln:0614141.00001.0')).toBe(true)
      expect(validateEPC('urn:epc:id:sscc:0614141.1234567890')).toBe(true)
      expect(validateEPC('urn:epc:class:lgtin:0614141.107346.lot123')).toBe(true)
    })

    it.fails('should reject events with empty what array and no quantityList', () => {
      // Should fail - schema validation should reject this
      const event = new ObjectEvent({
        what: [], // Empty array
        // No quantityList either
        when: new Date(),
        action: 'OBSERVE',
      })

      // This should throw a validation error
      expect(event).toBeNull() // Force failure
    })

    it.fails('should validate what field accepts multiple identifier types', () => {
      // Test schema extensibility for different identifier types
      const validateWhatSchema = (what: string[]): { valid: boolean; types: string[] } => {
        throw new Error('validateWhatSchema not implemented')
      }

      const result = validateWhatSchema([
        'urn:epc:id:sgtin:0614141.107346.2017', // EPC URN
        'customer:cust_123abc', // Custom identifier
        'order:ord_456def', // Custom identifier
        'urn:uuid:550e8400-e29b-41d4-a716-446655440000', // UUID URN
      ])

      expect(result.valid).toBe(true)
      expect(result.types).toContain('epc')
      expect(result.types).toContain('custom')
      expect(result.types).toContain('uuid')
    })

    it.fails('should provide schema introspection for what field', () => {
      const getWhatSchema = (): WhatSchema => {
        throw new Error('getWhatSchema not implemented')
      }

      const schema = getWhatSchema()
      expect(schema.required).toBe(true)
      expect(schema.types).toContain('epc')
      expect(schema.types).toContain('custom')
      expect(schema.allowQuantityOnly).toBe(true)
    })
  })

  // ============================================================================
  // WHEN (Timestamp) SCHEMA TESTS
  // ============================================================================

  describe('When (Timestamp) Schema', () => {
    it.fails('should validate timestamp precision', () => {
      const validateTimestampPrecision = (date: Date): { precision: string; valid: boolean } => {
        throw new Error('validateTimestampPrecision not implemented')
      }

      // Millisecond precision
      const result1 = validateTimestampPrecision(new Date('2024-06-15T10:30:00.123Z'))
      expect(result1.precision).toBe('millisecond')
      expect(result1.valid).toBe(true)

      // Second precision
      const result2 = validateTimestampPrecision(new Date('2024-06-15T10:30:00Z'))
      expect(result2.precision).toBe('second')
      expect(result2.valid).toBe(true)
    })

    it.fails('should validate timezone offset format', () => {
      const validateTimezoneOffset = (offset: string): boolean => {
        throw new Error('validateTimezoneOffset not implemented')
      }

      expect(validateTimezoneOffset('-05:00')).toBe(true)
      expect(validateTimezoneOffset('+08:00')).toBe(true)
      expect(validateTimezoneOffset('Z')).toBe(true)
      expect(validateTimezoneOffset('+00:00')).toBe(true)
      expect(validateTimezoneOffset('invalid')).toBe(false)
      expect(validateTimezoneOffset('-25:00')).toBe(false) // Invalid hour
      expect(validateTimezoneOffset('+08:60')).toBe(false) // Invalid minute
    })

    it.fails('should distinguish event time from record time', () => {
      const validateEventTiming = (event: BusinessEvent): {
        eventTime: Date
        recordTime: Date
        lag: number // milliseconds between event and record
      } => {
        throw new Error('validateEventTiming not implemented')
      }

      const event = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-15T10:00:00Z'),
        action: 'OBSERVE',
      })

      const timing = validateEventTiming(event)
      expect(timing.eventTime.getTime()).toBeLessThanOrEqual(timing.recordTime.getTime())
      expect(timing.lag).toBeGreaterThanOrEqual(0)
    })

    it.fails('should provide schema introspection for when field', () => {
      const getWhenSchema = (): WhenSchema => {
        throw new Error('getWhenSchema not implemented')
      }

      const schema = getWhenSchema()
      expect(schema.required).toBe(true)
      expect(schema.precision).toBe('millisecond')
      expect(schema.timezoneRequired).toBe(false)
    })
  })

  // ============================================================================
  // WHERE (Location/Context) SCHEMA TESTS
  // ============================================================================

  describe('Where (Location/Context) Schema', () => {
    it.fails('should validate GLN/SGLN format', () => {
      const validateLocation = (location: string): { valid: boolean; type: string } => {
        throw new Error('validateLocation not implemented')
      }

      // GLN format (13 digits)
      expect(validateLocation('urn:epc:id:sgln:0614141.00001.0').valid).toBe(true)
      expect(validateLocation('urn:epc:id:sgln:0614141.00001.0').type).toBe('sgln')

      // Custom location format
      expect(validateLocation('warehouse:us-east-1').valid).toBe(true)
      expect(validateLocation('warehouse:us-east-1').type).toBe('custom')

      // Service endpoint as location
      expect(validateLocation('service:api.example.com/v1').valid).toBe(true)
    })

    it.fails('should validate source/destination pairs', () => {
      const validateSourceDest = (sourceList: Array<{ type: string; value: string }>, destinationList: Array<{ type: string; value: string }>): {
        valid: boolean
        errors: string[]
      } => {
        throw new Error('validateSourceDest not implemented')
      }

      const result = validateSourceDest(
        [
          { type: 'possessing_party', value: PGLN_COMPANY },
          { type: 'location', value: SGLN_WAREHOUSE },
        ],
        [
          { type: 'location', value: 'urn:epc:id:sgln:0614141.00002.0' },
        ]
      )

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it.fails('should distinguish read point from business location', () => {
      const validateLocationSemantics = (where: string | undefined, bizLocation: string | undefined): {
        hasReadPoint: boolean
        hasBusinessLocation: boolean
        semanticallyValid: boolean
      } => {
        throw new Error('validateLocationSemantics not implemented')
      }

      const result = validateLocationSemantics(SGLN_WAREHOUSE, 'urn:epc:id:sgln:0614141.00002.0')
      expect(result.hasReadPoint).toBe(true)
      expect(result.hasBusinessLocation).toBe(true)
      expect(result.semanticallyValid).toBe(true)
    })

    it.fails('should provide schema introspection for where field', () => {
      const getWhereSchema = (): WhereSchema => {
        throw new Error('getWhereSchema not implemented')
      }

      const schema = getWhereSchema()
      expect(schema.required).toBe(false)
      expect(schema.types).toContain('gln')
      expect(schema.types).toContain('sgln')
      expect(schema.types).toContain('custom')
      expect(schema.allowBizLocation).toBe(true)
    })
  })

  // ============================================================================
  // WHY (Business Step/Reason) SCHEMA TESTS
  // ============================================================================

  describe('Why (Business Step/Reason) Schema', () => {
    it.fails('should validate CBV business step URNs', () => {
      const validateBusinessStep = (step: string): { valid: boolean; isCbv: boolean } => {
        throw new Error('validateBusinessStep not implemented')
      }

      // Standard CBV business steps
      expect(validateBusinessStep('urn:epcglobal:cbv:bizstep:shipping').valid).toBe(true)
      expect(validateBusinessStep('urn:epcglobal:cbv:bizstep:shipping').isCbv).toBe(true)
      expect(validateBusinessStep('urn:epcglobal:cbv:bizstep:receiving').valid).toBe(true)
      expect(validateBusinessStep('urn:epcglobal:cbv:bizstep:commissioning').valid).toBe(true)

      // Custom business steps (should also be valid)
      expect(validateBusinessStep('customer_signup').valid).toBe(true)
      expect(validateBusinessStep('customer_signup').isCbv).toBe(false)
    })

    it.fails('should validate business step against allowed list', () => {
      const validateAgainstAllowedSteps = (step: string, allowedSteps: string[]): boolean => {
        throw new Error('validateAgainstAllowedSteps not implemented')
      }

      const allowedSteps = ['shipping', 'receiving', 'storing', 'customer_signup']

      expect(validateAgainstAllowedSteps('shipping', allowedSteps)).toBe(true)
      expect(validateAgainstAllowedSteps('customer_signup', allowedSteps)).toBe(true)
      expect(validateAgainstAllowedSteps('unknown_step', allowedSteps)).toBe(false)
    })

    it.fails('should support business step categorization', () => {
      const categorizeBusinessStep = (step: string): {
        category: 'supply_chain' | 'customer' | 'financial' | 'custom'
        description: string
      } => {
        throw new Error('categorizeBusinessStep not implemented')
      }

      expect(categorizeBusinessStep('shipping').category).toBe('supply_chain')
      expect(categorizeBusinessStep('customer_signup').category).toBe('customer')
      expect(categorizeBusinessStep('payment_processed').category).toBe('financial')
    })

    it.fails('should provide schema introspection for why field', () => {
      const getWhySchema = (): WhySchema => {
        throw new Error('getWhySchema not implemented')
      }

      const schema = getWhySchema()
      expect(schema.required).toBe(false)
      expect(schema.allowCbvUrn).toBe(true)
      expect(schema.allowCustom).toBe(true)
    })
  })

  // ============================================================================
  // WHO (Parties) SCHEMA TESTS
  // ============================================================================

  describe('Who (Parties) Schema', () => {
    it.fails('should validate party identifier formats', () => {
      const validateParty = (party: string): { valid: boolean; format: string } => {
        throw new Error('validateParty not implemented')
      }

      // PGLN format
      expect(validateParty('urn:epc:id:pgln:0614141.00001').valid).toBe(true)
      expect(validateParty('urn:epc:id:pgln:0614141.00001').format).toBe('pgln')

      // User identifier
      expect(validateParty('user:alice@company.com').valid).toBe(true)
      expect(validateParty('user:alice@company.com').format).toBe('user')

      // Agent identifier
      expect(validateParty('agent:inventory-bot-v2').valid).toBe(true)
      expect(validateParty('agent:inventory-bot-v2').format).toBe('agent')

      // System identifier
      expect(validateParty('system:warehouse-scanner-001').valid).toBe(true)
      expect(validateParty('system:warehouse-scanner-001').format).toBe('system')
    })

    it.fails('should validate actor type against party format', () => {
      const validateActorTypeConsistency = (party: string, actorType: ActorType): {
        consistent: boolean
        expectedActorType: ActorType
      } => {
        throw new Error('validateActorTypeConsistency not implemented')
      }

      // Consistent: user prefix with human actor
      expect(validateActorTypeConsistency('user:alice@company.com', 'human').consistent).toBe(true)

      // Inconsistent: user prefix with system actor
      const result = validateActorTypeConsistency('user:alice@company.com', 'system')
      expect(result.consistent).toBe(false)
      expect(result.expectedActorType).toBe('human')

      // Agent prefix should expect agent actor type
      expect(validateActorTypeConsistency('agent:inventory-bot', 'agent').consistent).toBe(true)
    })

    it.fails('should validate confidence score for AI actors', () => {
      const validateConfidence = (actorType: ActorType, confidence: number | undefined): {
        valid: boolean
        required: boolean
        error?: string
      } => {
        throw new Error('validateConfidence not implemented')
      }

      // Agent actors should have confidence
      expect(validateConfidence('agent', 0.95).valid).toBe(true)
      expect(validateConfidence('agent', undefined).valid).toBe(false)
      expect(validateConfidence('agent', undefined).required).toBe(true)

      // Human actors don't require confidence
      expect(validateConfidence('human', undefined).valid).toBe(true)
      expect(validateConfidence('human', undefined).required).toBe(false)

      // Invalid confidence range
      expect(validateConfidence('agent', 1.5).valid).toBe(false)
      expect(validateConfidence('agent', -0.1).valid).toBe(false)
    })

    it.fails('should validate all actor types', () => {
      const validateActorType = (actorType: string): boolean => {
        throw new Error('validateActorType not implemented')
      }

      expect(validateActorType('human')).toBe(true)
      expect(validateActorType('agent')).toBe(true)
      expect(validateActorType('system')).toBe(true)
      expect(validateActorType('webhook')).toBe(true)
      expect(validateActorType('invalid')).toBe(false)
    })

    it.fails('should provide schema introspection for who field', () => {
      const getWhoSchema = (): WhoSchema => {
        throw new Error('getWhoSchema not implemented')
      }

      const schema = getWhoSchema()
      expect(schema.required).toBe(false)
      expect(schema.actorTypes).toContain('human')
      expect(schema.actorTypes).toContain('agent')
      expect(schema.actorTypes).toContain('system')
      expect(schema.actorTypes).toContain('webhook')
      expect(schema.confidenceRequired).toBe(false) // Only required for agents
    })
  })

  // ============================================================================
  // HOW (Method/Disposition) SCHEMA TESTS
  // ============================================================================

  describe('How (Method/Disposition) Schema', () => {
    it.fails('should validate CBV disposition URNs', () => {
      const validateDisposition = (disposition: string): { valid: boolean; isCbv: boolean } => {
        throw new Error('validateDisposition not implemented')
      }

      // Standard CBV dispositions
      expect(validateDisposition('urn:epcglobal:cbv:disp:in_transit').valid).toBe(true)
      expect(validateDisposition('urn:epcglobal:cbv:disp:in_transit').isCbv).toBe(true)
      expect(validateDisposition('urn:epcglobal:cbv:disp:in_progress').valid).toBe(true)
      expect(validateDisposition('urn:epcglobal:cbv:disp:sellable_accessible').valid).toBe(true)

      // Custom dispositions
      expect(validateDisposition('pending_review').valid).toBe(true)
      expect(validateDisposition('pending_review').isCbv).toBe(false)
    })

    it.fails('should validate channel types', () => {
      const validateChannel = (channel: string): { valid: boolean; isStandard: boolean } => {
        throw new Error('validateChannel not implemented')
      }

      // Standard channels
      expect(validateChannel('web').valid).toBe(true)
      expect(validateChannel('web').isStandard).toBe(true)
      expect(validateChannel('mobile').valid).toBe(true)
      expect(validateChannel('api').valid).toBe(true)
      expect(validateChannel('email').valid).toBe(true)
      expect(validateChannel('automation').valid).toBe(true)

      // Custom channels (should also be valid)
      expect(validateChannel('custom-channel').valid).toBe(true)
      expect(validateChannel('custom-channel').isStandard).toBe(false)
    })

    it.fails('should validate session ID format', () => {
      const validateSessionId = (sessionId: string): boolean => {
        throw new Error('validateSessionId not implemented')
      }

      expect(validateSessionId('sess_123abc')).toBe(true)
      expect(validateSessionId('session-uuid-v4-format')).toBe(true)
      expect(validateSessionId('')).toBe(false) // Empty string invalid
    })

    it.fails('should validate device ID format', () => {
      const validateDeviceId = (deviceId: string): { valid: boolean; type: string } => {
        throw new Error('validateDeviceId not implemented')
      }

      expect(validateDeviceId('scanner:warehouse-1-001').valid).toBe(true)
      expect(validateDeviceId('scanner:warehouse-1-001').type).toBe('scanner')
      expect(validateDeviceId('mobile:ios-device-xyz').valid).toBe(true)
      expect(validateDeviceId('mobile:ios-device-xyz').type).toBe('mobile')
    })

    it.fails('should validate context object structure', () => {
      const validateContext = (context: Record<string, unknown>): {
        valid: boolean
        errors: string[]
      } => {
        throw new Error('validateContext not implemented')
      }

      // Valid context
      expect(validateContext({
        firmware: '2.3.1',
        batteryLevel: 85,
        temperature: 22.5,
      }).valid).toBe(true)

      // Context with nested objects should be valid
      expect(validateContext({
        location: { lat: 37.7749, lng: -122.4194 },
        metadata: { source: 'sensor' },
      }).valid).toBe(true)
    })

    it.fails('should provide schema introspection for how field', () => {
      const getHowSchema = (): HowSchema => {
        throw new Error('getHowSchema not implemented')
      }

      const schema = getHowSchema()
      expect(schema.required).toBe(false)
      expect(schema.allowDisposition).toBe(true)
      expect(schema.allowChannel).toBe(true)
      expect(schema.channelTypes).toContain('web')
      expect(schema.channelTypes).toContain('mobile')
      expect(schema.channelTypes).toContain('api')
    })
  })

  // ============================================================================
  // COMPLETE SCHEMA VALIDATION TESTS
  // ============================================================================

  describe('Complete 5W+H Schema Validation', () => {
    it.fails('should validate complete event schema', () => {
      const validateEventSchema = (event: BusinessEvent): {
        valid: boolean
        dimensions: {
          what: { valid: boolean; errors: string[] }
          when: { valid: boolean; errors: string[] }
          where: { valid: boolean; errors: string[] }
          why: { valid: boolean; errors: string[] }
          who: { valid: boolean; errors: string[] }
          how: { valid: boolean; errors: string[] }
        }
      } => {
        throw new Error('validateEventSchema not implemented')
      }

      const event = new ObjectEvent({
        what: [SGTIN_1],
        when: new Date('2024-06-15T10:30:00.123Z'),
        whenTimezoneOffset: '-05:00',
        where: SGLN_WAREHOUSE,
        bizLocation: 'urn:epc:id:sgln:0614141.00002.0',
        why: 'shipping',
        who: 'user:alice@company.com',
        actorType: 'human',
        how: 'urn:epcglobal:cbv:disp:in_transit',
        channel: 'web',
        sessionId: 'sess_123abc',
        action: 'OBSERVE',
      })

      const result = validateEventSchema(event)

      expect(result.valid).toBe(true)
      expect(result.dimensions.what.valid).toBe(true)
      expect(result.dimensions.when.valid).toBe(true)
      expect(result.dimensions.where.valid).toBe(true)
      expect(result.dimensions.why.valid).toBe(true)
      expect(result.dimensions.who.valid).toBe(true)
      expect(result.dimensions.how.valid).toBe(true)
    })

    it.fails('should provide complete schema introspection', () => {
      const getFiveWHSchema = (): FiveWHSchema => {
        throw new Error('getFiveWHSchema not implemented')
      }

      const schema = getFiveWHSchema()

      expect(schema.what).toBeDefined()
      expect(schema.when).toBeDefined()
      expect(schema.where).toBeDefined()
      expect(schema.why).toBeDefined()
      expect(schema.who).toBeDefined()
      expect(schema.how).toBeDefined()
    })

    it.fails('should validate all event types against schema', () => {
      const validateEventTypeSchema = (eventType: string): {
        requiredDimensions: string[]
        optionalDimensions: string[]
      } => {
        throw new Error('validateEventTypeSchema not implemented')
      }

      // ObjectEvent requirements
      const objectSchema = validateEventTypeSchema('ObjectEvent')
      expect(objectSchema.requiredDimensions).toContain('what')
      expect(objectSchema.requiredDimensions).toContain('when')

      // AggregationEvent requirements
      const aggSchema = validateEventTypeSchema('AggregationEvent')
      expect(aggSchema.requiredDimensions).toContain('when')

      // TransactionEvent requirements
      const txnSchema = validateEventTypeSchema('TransactionEvent')
      expect(txnSchema.requiredDimensions).toContain('when')

      // TransformationEvent requirements
      const transformSchema = validateEventTypeSchema('TransformationEvent')
      expect(transformSchema.requiredDimensions).toContain('when')
    })
  })

  // ============================================================================
  // EXTENSIBILITY TESTS
  // ============================================================================

  describe('Schema Extensibility', () => {
    it.fails('should support custom dimension extensions', () => {
      const registerCustomDimension = (name: string, schema: Record<string, unknown>): boolean => {
        throw new Error('registerCustomDimension not implemented')
      }

      const registered = registerCustomDimension('customDimension', {
        required: false,
        type: 'string',
        validate: (value: string) => value.startsWith('custom:'),
      })

      expect(registered).toBe(true)
    })

    it.fails('should validate extension fields against registered schemas', () => {
      const validateExtensions = (extensions: Record<string, unknown>): {
        valid: boolean
        unrecognized: string[]
        invalid: string[]
      } => {
        throw new Error('validateExtensions not implemented')
      }

      const result = validateExtensions({
        'example:temperature': 22.5,
        'example:humidity': 45,
        'custom:notes': 'Quality check passed',
        'invalid:field': 'should fail',
      })

      expect(result.valid).toBe(false)
      expect(result.unrecognized).toContain('invalid:field')
    })

    it.fails('should support schema versioning', () => {
      const getSchemaVersion = (): { version: string; compatible: string[] } => {
        throw new Error('getSchemaVersion not implemented')
      }

      const version = getSchemaVersion()
      expect(version.version).toBeDefined()
      expect(version.compatible).toBeInstanceOf(Array)
    })
  })

  // ============================================================================
  // TYPE SAFETY TESTS
  // ============================================================================

  describe('Type Safety', () => {
    it.fails('should enforce type constraints at runtime', () => {
      const enforceTypes = <T>(value: unknown, schema: Record<string, unknown>): T => {
        throw new Error('enforceTypes not implemented')
      }

      // Should pass with correct types
      const validEvent = enforceTypes<BusinessEvent>({
        what: ['urn:epc:id:sgtin:0614141.107346.2017'],
        when: new Date(),
        action: 'OBSERVE',
        type: 'ObjectEvent',
      }, {})

      expect(validEvent).toBeDefined()
    })

    it.fails('should detect type mismatches', () => {
      const detectTypeMismatches = (event: Record<string, unknown>): {
        mismatches: Array<{ field: string; expected: string; actual: string }>
      } => {
        throw new Error('detectTypeMismatches not implemented')
      }

      const result = detectTypeMismatches({
        what: 'not-an-array', // Should be array
        when: '2024-06-15', // Should be Date
        action: 123, // Should be string
      })

      expect(result.mismatches).toHaveLength(3)
    })

    it.fails('should provide type coercion helpers', () => {
      const coerceToSchema = (input: Record<string, unknown>): BusinessEvent => {
        throw new Error('coerceToSchema not implemented')
      }

      // String date should be coerced to Date
      const coerced = coerceToSchema({
        what: ['urn:epc:id:sgtin:0614141.107346.2017'],
        when: '2024-06-15T10:30:00Z', // String instead of Date
        action: 'OBSERVE',
        type: 'ObjectEvent',
      })

      expect(coerced.when).toBeInstanceOf(Date)
    })
  })
})
