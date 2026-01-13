/**
 * @dotdo/segment - Protocols (Schema Validation) Tests
 *
 * Tests for Segment Protocols compatibility:
 * - Tracking Plan management
 * - JSON Schema validation for events
 * - Property validation (required, type, enum)
 * - Violation tracking and reporting
 * - Event blocking based on schema
 *
 * TDD: RED phase - these tests define the expected behavior
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Protocols classes
  TrackingPlan,
  SchemaValidator,
  createTrackingPlan,
  createSchemaValidator,

  // Violation Store
  ViolationStore,
  createViolationStore,

  // Protocol Middleware
  createProtocolMiddleware,
  createValidatorWithStore,

  // Types
  type TrackingPlanConfig,
  type EventSchema,
  type PropertySchema,
  type ValidationResult,
  type Violation,
  type SchemaValidatorOptions,
  type ViolationSummary,
} from '../protocols'
import type { SegmentEvent } from '../types'

describe('@dotdo/segment - Protocols (Schema Validation)', () => {
  // ===========================================================================
  // Tracking Plan Management
  // ===========================================================================

  describe('TrackingPlan', () => {
    it('should create a tracking plan with name and events', () => {
      const plan = createTrackingPlan({
        name: 'E-commerce Tracking Plan',
        description: 'Standard e-commerce event schemas',
        events: {
          'Order Completed': {
            description: 'When a customer completes an order',
            properties: {
              orderId: { type: 'string', required: true },
              total: { type: 'number', required: true },
              products: { type: 'array', required: true },
            },
          },
        },
      })

      expect(plan.name).toBe('E-commerce Tracking Plan')
      expect(plan.getEventSchema('Order Completed')).toBeDefined()
    })

    it('should add event schemas dynamically', () => {
      const plan = new TrackingPlan({ name: 'My Plan', events: {} })

      plan.addEvent('Product Viewed', {
        description: 'When a product is viewed',
        properties: {
          productId: { type: 'string', required: true },
          name: { type: 'string', required: true },
          price: { type: 'number', required: false },
        },
      })

      expect(plan.getEventSchema('Product Viewed')).toBeDefined()
      expect(plan.hasEvent('Product Viewed')).toBe(true)
    })

    it('should remove event schemas', () => {
      const plan = new TrackingPlan({
        name: 'Test Plan',
        events: {
          'Test Event': { properties: {} },
        },
      })

      expect(plan.hasEvent('Test Event')).toBe(true)
      plan.removeEvent('Test Event')
      expect(plan.hasEvent('Test Event')).toBe(false)
    })

    it('should list all event names', () => {
      const plan = new TrackingPlan({
        name: 'Test Plan',
        events: {
          'Event A': { properties: {} },
          'Event B': { properties: {} },
          'Event C': { properties: {} },
        },
      })

      const events = plan.getEventNames()
      expect(events).toContain('Event A')
      expect(events).toContain('Event B')
      expect(events).toContain('Event C')
      expect(events).toHaveLength(3)
    })

    it('should support identify trait schemas', () => {
      const plan = new TrackingPlan({
        name: 'User Plan',
        events: {},
        identifySchema: {
          traits: {
            email: { type: 'string', required: true, format: 'email' },
            name: { type: 'string', required: false },
            plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
          },
        },
      })

      expect(plan.getIdentifySchema()).toBeDefined()
      expect(plan.getIdentifySchema()?.traits.email.required).toBe(true)
    })

    it('should support group trait schemas', () => {
      const plan = new TrackingPlan({
        name: 'Group Plan',
        events: {},
        groupSchema: {
          traits: {
            name: { type: 'string', required: true },
            industry: { type: 'string', required: false },
            employees: { type: 'number', required: false },
          },
        },
      })

      expect(plan.getGroupSchema()).toBeDefined()
    })

    it('should export as JSON', () => {
      const plan = new TrackingPlan({
        name: 'Export Test',
        events: {
          'Test Event': {
            properties: { foo: { type: 'string' } },
          },
        },
      })

      const json = plan.toJSON()
      expect(json.name).toBe('Export Test')
      expect(json.events['Test Event']).toBeDefined()
    })

    it('should import from JSON', () => {
      const json = {
        name: 'Import Test',
        events: {
          'Imported Event': {
            properties: { bar: { type: 'number' } },
          },
        },
      }

      const plan = TrackingPlan.fromJSON(json)
      expect(plan.name).toBe('Import Test')
      expect(plan.hasEvent('Imported Event')).toBe(true)
    })
  })

  // ===========================================================================
  // Schema Validator
  // ===========================================================================

  describe('SchemaValidator', () => {
    let plan: TrackingPlan
    let validator: SchemaValidator

    beforeEach(() => {
      plan = new TrackingPlan({
        name: 'Test Plan',
        events: {
          'Order Completed': {
            properties: {
              orderId: { type: 'string', required: true },
              total: { type: 'number', required: true, minimum: 0 },
              currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
              products: { type: 'array', required: true, minItems: 1 },
            },
          },
          'Button Clicked': {
            properties: {
              buttonId: { type: 'string', required: true },
              label: { type: 'string' },
            },
          },
        },
        identifySchema: {
          traits: {
            email: { type: 'string', required: true, format: 'email' },
            age: { type: 'number', minimum: 0, maximum: 150 },
          },
        },
      })

      validator = new SchemaValidator(plan)
    })

    describe('Track Event Validation', () => {
      it('should validate correct track event', () => {
        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 'order-123',
            total: 99.99,
            currency: 'USD',
            products: [{ id: 'prod-1' }],
          },
        }

        const result = validator.validate(event)
        expect(result.valid).toBe(true)
        expect(result.violations).toHaveLength(0)
      })

      it('should detect missing required properties', () => {
        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 'order-123',
            // Missing: total, products
          },
        }

        const result = validator.validate(event)
        expect(result.valid).toBe(false)
        expect(result.violations.some((v) => v.property === 'total')).toBe(true)
        expect(result.violations.some((v) => v.property === 'products')).toBe(true)
      })

      it('should detect type mismatches', () => {
        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 123, // Should be string
            total: 'not a number', // Should be number
            products: [{}],
          },
        }

        const result = validator.validate(event)
        expect(result.valid).toBe(false)
        expect(
          result.violations.some((v) => v.type === 'type_mismatch' && v.property === 'orderId')
        ).toBe(true)
        expect(
          result.violations.some((v) => v.type === 'type_mismatch' && v.property === 'total')
        ).toBe(true)
      })

      it('should detect invalid enum values', () => {
        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 'order-123',
            total: 99.99,
            currency: 'JPY', // Not in allowed enum
            products: [{ id: 'prod-1' }],
          },
        }

        const result = validator.validate(event)
        expect(result.valid).toBe(false)
        expect(
          result.violations.some((v) => v.type === 'invalid_enum' && v.property === 'currency')
        ).toBe(true)
      })

      it('should detect minimum value violations', () => {
        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 'order-123',
            total: -10, // Must be >= 0
            products: [{ id: 'prod-1' }],
          },
        }

        const result = validator.validate(event)
        expect(result.valid).toBe(false)
        expect(
          result.violations.some((v) => v.type === 'range_violation' && v.property === 'total')
        ).toBe(true)
      })

      it('should detect array minItems violations', () => {
        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 'order-123',
            total: 99.99,
            products: [], // Must have at least 1 item
          },
        }

        const result = validator.validate(event)
        expect(result.valid).toBe(false)
        expect(
          result.violations.some((v) => v.type === 'array_length' && v.property === 'products')
        ).toBe(true)
      })

      it('should handle unknown events based on configuration', () => {
        const strictValidator = new SchemaValidator(plan, {
          allowUnknownEvents: false,
        })

        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Unknown Event', // Not in tracking plan
          properties: {},
        }

        const result = strictValidator.validate(event)
        expect(result.valid).toBe(false)
        expect(result.violations.some((v) => v.type === 'unknown_event')).toBe(true)
      })

      it('should allow unknown events when configured', () => {
        const lenientValidator = new SchemaValidator(plan, {
          allowUnknownEvents: true,
        })

        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Unknown Event',
          properties: { anything: 'goes' },
        }

        const result = lenientValidator.validate(event)
        expect(result.valid).toBe(true)
      })

      it('should handle unknown properties based on configuration', () => {
        const strictValidator = new SchemaValidator(plan, {
          allowUnknownProperties: false,
        })

        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Button Clicked',
          properties: {
            buttonId: 'btn-1',
            unexpectedProperty: 'value', // Not in schema
          },
        }

        const result = strictValidator.validate(event)
        expect(result.valid).toBe(false)
        expect(
          result.violations.some(
            (v) => v.type === 'unknown_property' && v.property === 'unexpectedProperty'
          )
        ).toBe(true)
      })
    })

    describe('Identify Event Validation', () => {
      it('should validate correct identify event', () => {
        const event: SegmentEvent = {
          type: 'identify',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          traits: {
            email: 'test@example.com',
            age: 25,
          },
        }

        const result = validator.validate(event)
        expect(result.valid).toBe(true)
      })

      it('should detect missing required traits', () => {
        const event: SegmentEvent = {
          type: 'identify',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          traits: {
            age: 25,
            // Missing: email (required)
          },
        }

        const result = validator.validate(event)
        expect(result.valid).toBe(false)
        expect(result.violations.some((v) => v.property === 'email')).toBe(true)
      })

      it('should validate trait value ranges', () => {
        const event: SegmentEvent = {
          type: 'identify',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          traits: {
            email: 'test@example.com',
            age: 200, // Exceeds maximum of 150
          },
        }

        const result = validator.validate(event)
        expect(result.valid).toBe(false)
        expect(
          result.violations.some((v) => v.type === 'range_violation' && v.property === 'age')
        ).toBe(true)
      })
    })

    describe('Violation Tracking', () => {
      it('should track violations with event context', () => {
        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-123',
          timestamp: new Date().toISOString(),
          userId: 'user-456',
          event: 'Order Completed',
          properties: {
            orderId: 123, // Wrong type
          },
        }

        const result = validator.validate(event)
        expect(result.violations.length).toBeGreaterThan(0)

        const violation = result.violations[0]
        expect(violation?.eventName).toBe('Order Completed')
        expect(violation?.messageId).toBe('msg-123')
      })

      it('should provide violation details for debugging', () => {
        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 123,
            total: 99.99,
            products: [{}],
          },
        }

        const result = validator.validate(event)
        const typeViolation = result.violations.find(
          (v) => v.property === 'orderId' && v.type === 'type_mismatch'
        )

        expect(typeViolation).toBeDefined()
        expect(typeViolation?.expected).toBe('string')
        expect(typeViolation?.actual).toBe('number')
        expect(typeViolation?.message).toContain('orderId')
      })

      it('should report violations via callback', () => {
        const onViolation = vi.fn()
        const callbackValidator = new SchemaValidator(plan, { onViolation })

        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 123, // Type error
          },
        }

        callbackValidator.validate(event)
        expect(onViolation).toHaveBeenCalled()
      })
    })

    describe('Event Blocking', () => {
      it('should block events with violations when configured', () => {
        const blockingValidator = new SchemaValidator(plan, {
          blockInvalidEvents: true,
        })

        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 'order-123',
            // Missing required properties
          },
        }

        const result = blockingValidator.validate(event)
        expect(result.blocked).toBe(true)
      })

      it('should allow events with violations when not blocking', () => {
        const nonBlockingValidator = new SchemaValidator(plan, {
          blockInvalidEvents: false,
        })

        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Order Completed',
          properties: {
            orderId: 'order-123',
            // Missing required properties
          },
        }

        const result = nonBlockingValidator.validate(event)
        expect(result.blocked).toBe(false)
        expect(result.valid).toBe(false) // Still invalid, just not blocked
      })

      it('should omit invalid properties when configured', () => {
        const omitValidator = new SchemaValidator(plan, {
          omitInvalidProperties: true,
        })

        const event: SegmentEvent = {
          type: 'track',
          messageId: 'msg-1',
          timestamp: new Date().toISOString(),
          userId: 'user-1',
          event: 'Button Clicked',
          properties: {
            buttonId: 'btn-1',
            label: 123, // Wrong type - should be omitted
          },
        }

        const result = omitValidator.validate(event)
        expect(result.sanitizedEvent).toBeDefined()
        expect(result.sanitizedEvent?.properties?.buttonId).toBe('btn-1')
        expect(result.sanitizedEvent?.properties?.label).toBeUndefined()
      })
    })
  })

  // ===========================================================================
  // Property Schema Types
  // ===========================================================================

  describe('Property Schema Types', () => {
    it('should validate string properties', () => {
      const plan = new TrackingPlan({
        name: 'String Test',
        events: {
          TestEvent: {
            properties: {
              stringProp: { type: 'string', required: true },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      const validEvent: SegmentEvent = {
        type: 'track',
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
        userId: 'user-1',
        event: 'TestEvent',
        properties: { stringProp: 'hello' },
      }

      const invalidEvent: SegmentEvent = {
        type: 'track',
        messageId: 'msg-2',
        timestamp: new Date().toISOString(),
        userId: 'user-1',
        event: 'TestEvent',
        properties: { stringProp: 123 },
      }

      expect(validator.validate(validEvent).valid).toBe(true)
      expect(validator.validate(invalidEvent).valid).toBe(false)
    })

    it('should validate number properties with min/max', () => {
      const plan = new TrackingPlan({
        name: 'Number Test',
        events: {
          TestEvent: {
            properties: {
              amount: { type: 'number', minimum: 0, maximum: 100 },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('TestEvent', { amount: 50 })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('TestEvent', { amount: -1 })).valid
      ).toBe(false)
      expect(
        validator.validate(createEvent('TestEvent', { amount: 101 })).valid
      ).toBe(false)
    })

    it('should validate boolean properties', () => {
      const plan = new TrackingPlan({
        name: 'Boolean Test',
        events: {
          TestEvent: {
            properties: {
              isActive: { type: 'boolean', required: true },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('TestEvent', { isActive: true })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('TestEvent', { isActive: false })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('TestEvent', { isActive: 'true' })).valid
      ).toBe(false)
    })

    it('should validate array properties', () => {
      const plan = new TrackingPlan({
        name: 'Array Test',
        events: {
          TestEvent: {
            properties: {
              items: { type: 'array', minItems: 1, maxItems: 5 },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('TestEvent', { items: ['a', 'b'] })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('TestEvent', { items: [] })).valid
      ).toBe(false) // Below minItems
      expect(
        validator.validate(createEvent('TestEvent', { items: [1, 2, 3, 4, 5, 6] })).valid
      ).toBe(false) // Above maxItems
    })

    it('should validate object properties', () => {
      const plan = new TrackingPlan({
        name: 'Object Test',
        events: {
          TestEvent: {
            properties: {
              metadata: { type: 'object', required: true },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('TestEvent', { metadata: { key: 'value' } })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('TestEvent', { metadata: 'not an object' })).valid
      ).toBe(false)
    })

    it('should validate string patterns (regex)', () => {
      const plan = new TrackingPlan({
        name: 'Pattern Test',
        events: {
          TestEvent: {
            properties: {
              sku: { type: 'string', pattern: '^SKU-[0-9]+$' },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('TestEvent', { sku: 'SKU-12345' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('TestEvent', { sku: 'INVALID' })).valid
      ).toBe(false)
    })
  })

  // ===========================================================================
  // Statistics and Reporting
  // ===========================================================================

  describe('Statistics and Reporting', () => {
    it('should track validation statistics', () => {
      const plan = new TrackingPlan({
        name: 'Stats Test',
        events: {
          TestEvent: {
            properties: {
              value: { type: 'string', required: true },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      // Valid events
      validator.validate(createEvent('TestEvent', { value: 'a' }))
      validator.validate(createEvent('TestEvent', { value: 'b' }))

      // Invalid events
      validator.validate(createEvent('TestEvent', { value: 123 }))
      validator.validate(createEvent('TestEvent', {}))

      const stats = validator.getStats()
      expect(stats.totalValidated).toBe(4)
      expect(stats.validCount).toBe(2)
      expect(stats.invalidCount).toBe(2)
      expect(stats.violationsByType.type_mismatch).toBeGreaterThan(0)
    })

    it('should track violations by event name', () => {
      const plan = new TrackingPlan({
        name: 'Event Stats Test',
        events: {
          EventA: { properties: { a: { type: 'string', required: true } } },
          EventB: { properties: { b: { type: 'number', required: true } } },
        },
      })

      const validator = new SchemaValidator(plan)

      validator.validate(createEvent('EventA', {})) // Missing required
      validator.validate(createEvent('EventA', { a: 123 })) // Wrong type
      validator.validate(createEvent('EventB', { b: 'string' })) // Wrong type

      const stats = validator.getStats()
      expect(stats.violationsByEvent['EventA']).toBe(2)
      expect(stats.violationsByEvent['EventB']).toBe(1)
    })

    it('should reset statistics', () => {
      const plan = new TrackingPlan({
        name: 'Reset Test',
        events: {
          TestEvent: { properties: { value: { type: 'string' } } },
        },
      })

      const validator = new SchemaValidator(plan)
      validator.validate(createEvent('TestEvent', { value: 123 }))

      expect(validator.getStats().totalValidated).toBe(1)

      validator.resetStats()

      expect(validator.getStats().totalValidated).toBe(0)
    })
  })

  // ===========================================================================
  // Format Validation
  // ===========================================================================

  describe('Format Validation', () => {
    it('should validate email format', () => {
      const plan = new TrackingPlan({
        name: 'Email Test',
        events: {
          UserRegistered: {
            properties: {
              email: { type: 'string', required: true, format: 'email' },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('UserRegistered', { email: 'valid@example.com' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('UserRegistered', { email: 'user.name+tag@domain.co.uk' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('UserRegistered', { email: 'invalid-email' })).valid
      ).toBe(false)
      expect(
        validator.validate(createEvent('UserRegistered', { email: '@nodomain.com' })).valid
      ).toBe(false)
    })

    it('should validate uri format', () => {
      const plan = new TrackingPlan({
        name: 'URI Test',
        events: {
          LinkClicked: {
            properties: {
              url: { type: 'string', required: true, format: 'uri' },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('LinkClicked', { url: 'https://example.com/path' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('LinkClicked', { url: 'http://localhost:3000' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('LinkClicked', { url: 'not-a-url' })).valid
      ).toBe(false)
    })

    it('should validate date format', () => {
      const plan = new TrackingPlan({
        name: 'Date Test',
        events: {
          AppointmentSet: {
            properties: {
              date: { type: 'string', required: true, format: 'date' },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('AppointmentSet', { date: '2026-01-15' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('AppointmentSet', { date: '2026/01/15' })).valid
      ).toBe(false)
      expect(
        validator.validate(createEvent('AppointmentSet', { date: 'January 15, 2026' })).valid
      ).toBe(false)
    })

    it('should validate date-time format', () => {
      const plan = new TrackingPlan({
        name: 'DateTime Test',
        events: {
          EventScheduled: {
            properties: {
              scheduledAt: { type: 'string', required: true, format: 'date-time' },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('EventScheduled', { scheduledAt: '2026-01-15T14:30:00Z' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('EventScheduled', { scheduledAt: new Date().toISOString() })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('EventScheduled', { scheduledAt: 'not-a-date' })).valid
      ).toBe(false)
    })

    it('should validate uuid format', () => {
      const plan = new TrackingPlan({
        name: 'UUID Test',
        events: {
          ResourceCreated: {
            properties: {
              resourceId: { type: 'string', required: true, format: 'uuid' },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('ResourceCreated', { resourceId: '550e8400-e29b-41d4-a716-446655440000' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('ResourceCreated', { resourceId: 'not-a-uuid' })).valid
      ).toBe(false)
      expect(
        validator.validate(createEvent('ResourceCreated', { resourceId: '550e8400-e29b-41d4-a716' })).valid
      ).toBe(false)
    })

    it('should validate ipv4 format', () => {
      const plan = new TrackingPlan({
        name: 'IPv4 Test',
        events: {
          ConnectionEstablished: {
            properties: {
              ipAddress: { type: 'string', required: true, format: 'ipv4' },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('ConnectionEstablished', { ipAddress: '192.168.1.1' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('ConnectionEstablished', { ipAddress: '255.255.255.255' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('ConnectionEstablished', { ipAddress: '256.1.1.1' })).valid
      ).toBe(false)
      expect(
        validator.validate(createEvent('ConnectionEstablished', { ipAddress: 'not-an-ip' })).valid
      ).toBe(false)
    })

    it('should validate phone format', () => {
      const plan = new TrackingPlan({
        name: 'Phone Test',
        events: {
          PhoneVerified: {
            properties: {
              phone: { type: 'string', required: true, format: 'phone' },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      expect(
        validator.validate(createEvent('PhoneVerified', { phone: '+14155551234' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('PhoneVerified', { phone: '+1 (415) 555-1234' })).valid
      ).toBe(true)
      expect(
        validator.validate(createEvent('PhoneVerified', { phone: 'not-a-phone' })).valid
      ).toBe(false)
    })
  })

  // ===========================================================================
  // Nested Object Validation
  // ===========================================================================

  describe('Nested Object Validation', () => {
    it('should validate nested object properties', () => {
      const plan = new TrackingPlan({
        name: 'Nested Test',
        events: {
          OrderPlaced: {
            properties: {
              shipping: {
                type: 'object',
                required: true,
                properties: {
                  address: { type: 'string', required: true },
                  city: { type: 'string', required: true },
                  zipCode: { type: 'string', required: true },
                },
              },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      // Valid nested object
      const validResult = validator.validate(createEvent('OrderPlaced', {
        shipping: {
          address: '123 Main St',
          city: 'San Francisco',
          zipCode: '94105',
        },
      }))
      expect(validResult.valid).toBe(true)

      // Missing required nested property
      const invalidResult = validator.validate(createEvent('OrderPlaced', {
        shipping: {
          address: '123 Main St',
          // Missing city and zipCode
        },
      }))
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.violations.some((v) => v.property === 'shipping.city')).toBe(true)
      expect(invalidResult.violations.some((v) => v.property === 'shipping.zipCode')).toBe(true)
    })

    it('should validate nested type constraints', () => {
      const plan = new TrackingPlan({
        name: 'Nested Type Test',
        events: {
          PaymentProcessed: {
            properties: {
              card: {
                type: 'object',
                required: true,
                properties: {
                  lastFour: { type: 'string', required: true, minLength: 4, maxLength: 4 },
                  expiryMonth: { type: 'number', required: true, minimum: 1, maximum: 12 },
                  expiryYear: { type: 'number', required: true, minimum: 2024 },
                },
              },
            },
          },
        },
      })

      const validator = new SchemaValidator(plan)

      // Type mismatch in nested property
      const result = validator.validate(createEvent('PaymentProcessed', {
        card: {
          lastFour: 1234, // Should be string
          expiryMonth: 13, // Exceeds maximum
          expiryYear: 2026,
        },
      }))

      expect(result.valid).toBe(false)
      expect(result.violations.some((v) => v.property === 'card.lastFour' && v.type === 'type_mismatch')).toBe(true)
      expect(result.violations.some((v) => v.property === 'card.expiryMonth' && v.type === 'range_violation')).toBe(true)
    })
  })

  // ===========================================================================
  // Violation Store
  // ===========================================================================

  describe('ViolationStore', () => {
    it('should store and retrieve violations', () => {
      const store = createViolationStore()

      const violation: Violation = {
        type: 'type_mismatch',
        property: 'orderId',
        eventName: 'Order Completed',
        messageId: 'msg-1',
        message: 'Expected string but got number',
        expected: 'string',
        actual: 'number',
        timestamp: new Date().toISOString(),
      }

      store.add(violation)

      expect(store.count).toBe(1)
      expect(store.getAll()).toHaveLength(1)
      expect(store.getByEvent('Order Completed')).toHaveLength(1)
      expect(store.getByType('type_mismatch')).toHaveLength(1)
    })

    it('should generate summary statistics', () => {
      const store = createViolationStore()

      // Add multiple violations
      store.add({
        type: 'type_mismatch',
        property: 'orderId',
        eventName: 'Order Completed',
        messageId: 'msg-1',
        message: 'Type error',
        timestamp: new Date().toISOString(),
      })
      store.add({
        type: 'type_mismatch',
        property: 'orderId',
        eventName: 'Order Completed',
        messageId: 'msg-2',
        message: 'Type error',
        timestamp: new Date().toISOString(),
      })
      store.add({
        type: 'missing_required',
        property: 'total',
        eventName: 'Order Completed',
        messageId: 'msg-3',
        message: 'Missing required',
        timestamp: new Date().toISOString(),
      })

      const summary = store.getSummary()

      expect(summary.total).toBe(3)
      expect(summary.byType.type_mismatch).toBe(2)
      expect(summary.byType.missing_required).toBe(1)
      expect(summary.byEvent['Order Completed']).toBe(3)
      expect(summary.topViolations.length).toBeGreaterThan(0)
    })

    it('should export violations for reporting', () => {
      const store = createViolationStore()

      store.add({
        type: 'type_mismatch',
        property: 'value',
        eventName: 'TestEvent',
        messageId: 'msg-1',
        message: 'Test violation',
        timestamp: new Date().toISOString(),
      })

      const exportWithDetails = store.export('My Tracking Plan', true)
      expect(exportWithDetails.trackingPlan).toBe('My Tracking Plan')
      expect(exportWithDetails.summary.total).toBe(1)
      expect(exportWithDetails.violations).toBeDefined()
      expect(exportWithDetails.violations).toHaveLength(1)

      const exportWithoutDetails = store.export('My Tracking Plan', false)
      expect(exportWithoutDetails.violations).toBeUndefined()
    })

    it('should respect max violations limit', () => {
      const store = createViolationStore({ maxViolations: 10 })

      // Add more than max
      for (let i = 0; i < 15; i++) {
        store.add({
          type: 'type_mismatch',
          property: `prop-${i}`,
          eventName: 'TestEvent',
          messageId: `msg-${i}`,
          message: 'Test violation',
          timestamp: new Date().toISOString(),
        })
      }

      // Should have pruned oldest
      expect(store.count).toBeLessThanOrEqual(10)
    })

    it('should clear all violations', () => {
      const store = createViolationStore()

      store.add({
        type: 'type_mismatch',
        property: 'test',
        eventName: 'TestEvent',
        messageId: 'msg-1',
        message: 'Test',
        timestamp: new Date().toISOString(),
      })

      expect(store.count).toBe(1)
      store.clear()
      expect(store.count).toBe(0)
    })
  })

  // ===========================================================================
  // Protocol Middleware
  // ===========================================================================

  describe('Protocol Middleware', () => {
    it('should create middleware that validates events', () => {
      const plan = new TrackingPlan({
        name: 'Middleware Test',
        events: {
          TestEvent: {
            properties: {
              value: { type: 'string', required: true },
            },
          },
        },
      })

      const middleware = createProtocolMiddleware(plan)

      // Valid event passes through
      const validEvent = createEvent('TestEvent', { value: 'hello' })
      const validResult = middleware(validEvent)
      expect(validResult).not.toBeNull()
      expect(validResult?.properties?.value).toBe('hello')

      // Invalid event with blocking disabled still passes (default)
      const invalidEvent = createEvent('TestEvent', { value: 123 })
      const invalidResult = middleware(invalidEvent)
      expect(invalidResult).not.toBeNull()
    })

    it('should block invalid events when configured', () => {
      const plan = new TrackingPlan({
        name: 'Blocking Test',
        events: {
          TestEvent: {
            properties: {
              value: { type: 'string', required: true },
            },
          },
        },
      })

      const middleware = createProtocolMiddleware(plan, {
        blockInvalidEvents: true,
      })

      // Invalid event gets blocked
      const invalidEvent = createEvent('TestEvent', {}) // Missing required
      const result = middleware(invalidEvent)
      expect(result).toBeNull()
    })

    it('should store violations in provided store', () => {
      const plan = new TrackingPlan({
        name: 'Store Test',
        events: {
          TestEvent: {
            properties: {
              value: { type: 'string', required: true },
            },
          },
        },
      })

      const violationStore = createViolationStore()
      const middleware = createProtocolMiddleware(plan, {
        violationStore,
      })

      // Trigger a violation
      middleware(createEvent('TestEvent', { value: 123 })) // Wrong type

      expect(violationStore.count).toBe(1)
    })

    it('should log violations when configured', () => {
      const plan = new TrackingPlan({
        name: 'Logging Test',
        events: {
          TestEvent: {
            properties: {
              value: { type: 'string', required: true },
            },
          },
        },
      })

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const middleware = createProtocolMiddleware(plan, {
        logViolations: true,
      })

      middleware(createEvent('TestEvent', { value: 123 }))

      expect(warnSpy).toHaveBeenCalled()
      expect(warnSpy.mock.calls[0]?.[0]).toContain('[Segment Protocols]')

      warnSpy.mockRestore()
    })
  })

  // ===========================================================================
  // Validator with Store Utility
  // ===========================================================================

  describe('createValidatorWithStore', () => {
    it('should create validator that auto-stores violations', () => {
      const plan = new TrackingPlan({
        name: 'Auto Store Test',
        events: {
          TestEvent: {
            properties: {
              value: { type: 'string', required: true },
            },
          },
        },
      })

      const { validator, store } = createValidatorWithStore(plan)

      // Validate invalid event
      validator.validate(createEvent('TestEvent', { value: 123 }))

      expect(store.count).toBe(1)
    })

    it('should still call custom onViolation callback', () => {
      const plan = new TrackingPlan({
        name: 'Callback Test',
        events: {
          TestEvent: {
            properties: {
              value: { type: 'string', required: true },
            },
          },
        },
      })

      const customCallback = vi.fn()
      const { validator, store } = createValidatorWithStore(plan, {
        onViolation: customCallback,
      })

      validator.validate(createEvent('TestEvent', { value: 123 }))

      expect(store.count).toBe(1)
      expect(customCallback).toHaveBeenCalled()
    })
  })
})

// Helper function to create test events
function createEvent(eventName: string, properties: Record<string, unknown>): SegmentEvent {
  return {
    type: 'track',
    messageId: `msg-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    userId: 'test-user',
    event: eventName,
    properties,
  }
}
