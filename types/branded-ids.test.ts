/**
 * Type tests for branded ID types
 *
 * These tests verify that ID types are distinct and cannot be mixed.
 * They use TypeScript's type system to detect errors at compile time.
 *
 * RED PHASE: These tests should fail to compile before branded types are implemented.
 * GREEN PHASE: These tests should pass after branded types are added.
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  ThingId,
  EventId,
  RelationshipId,
  CallbackId,
  BrokerMessageId,
} from './index'
import {
  createThingId,
  createEventId,
  createRelationshipId,
  createCallbackId,
  createBrokerMessageId,
} from './index'

describe('Branded ID Types', () => {
  describe('Type Safety', () => {
    it('should create distinct ID types', () => {
      const thingId = createThingId()
      const eventId = createEventId()
      const relationshipId = createRelationshipId()
      const callbackId = createCallbackId()
      const brokerMessageId = createBrokerMessageId()

      // All IDs should be strings at runtime
      expect(typeof thingId).toBe('string')
      expect(typeof eventId).toBe('string')
      expect(typeof relationshipId).toBe('string')
      expect(typeof callbackId).toBe('string')
      expect(typeof brokerMessageId).toBe('string')
    })

    it('should have correct type at compile time', () => {
      const thingId = createThingId()
      const eventId = createEventId()
      const relationshipId = createRelationshipId()

      // Type assertions - these verify the branded types exist
      expectTypeOf(thingId).toMatchTypeOf<ThingId>()
      expectTypeOf(eventId).toMatchTypeOf<EventId>()
      expectTypeOf(relationshipId).toMatchTypeOf<RelationshipId>()
    })

    it('should not allow assigning ThingId to EventId', () => {
      const thingId = createThingId()

      // This should be a type error - ThingId should not be assignable to EventId
      // @ts-expect-error - ThingId is not assignable to EventId
      const eventId: EventId = thingId

      // This line prevents the unused variable warning
      expect(eventId).toBeDefined()
    })

    it('should not allow assigning EventId to ThingId', () => {
      const eventId = createEventId()

      // This should be a type error - EventId should not be assignable to ThingId
      // @ts-expect-error - EventId is not assignable to ThingId
      const thingId: ThingId = eventId

      expect(thingId).toBeDefined()
    })

    it('should not allow assigning RelationshipId to ThingId', () => {
      const relationshipId = createRelationshipId()

      // @ts-expect-error - RelationshipId is not assignable to ThingId
      const thingId: ThingId = relationshipId

      expect(thingId).toBeDefined()
    })

    it('should not allow assigning CallbackId to EventId', () => {
      const callbackId = createCallbackId()

      // @ts-expect-error - CallbackId is not assignable to EventId
      const eventId: EventId = callbackId

      expect(eventId).toBeDefined()
    })

    it('should not allow assigning BrokerMessageId to ThingId', () => {
      const brokerId = createBrokerMessageId()

      // @ts-expect-error - BrokerMessageId is not assignable to ThingId
      const thingId: ThingId = brokerId

      expect(thingId).toBeDefined()
    })
  })

  describe('Function Signatures', () => {
    // These functions accept specific ID types
    function processThing(id: ThingId): string {
      return `thing:${id}`
    }

    function processEvent(id: EventId): string {
      return `event:${id}`
    }

    function processRelationship(id: RelationshipId): string {
      return `rel:${id}`
    }

    it('should accept correct ID type in function', () => {
      const thingId = createThingId()
      const result = processThing(thingId)
      expect(result).toMatch(/^thing:/)
    })

    it('should reject wrong ID type in function', () => {
      const eventId = createEventId()

      // @ts-expect-error - EventId is not assignable to parameter of type ThingId
      const result = processThing(eventId)

      expect(result).toBeDefined()
    })

    it('should reject ThingId in EventId function', () => {
      const thingId = createThingId()

      // @ts-expect-error - ThingId is not assignable to parameter of type EventId
      const result = processEvent(thingId)

      expect(result).toBeDefined()
    })

    it('should reject EventId in RelationshipId function', () => {
      const eventId = createEventId()

      // @ts-expect-error - EventId is not assignable to parameter of type RelationshipId
      const result = processRelationship(eventId)

      expect(result).toBeDefined()
    })
  })

  describe('ID Generation', () => {
    it('should generate unique ThingIds', () => {
      const id1 = createThingId()
      const id2 = createThingId()
      expect(id1).not.toBe(id2)
    })

    it('should generate unique EventIds', () => {
      const id1 = createEventId()
      const id2 = createEventId()
      expect(id1).not.toBe(id2)
    })

    it('should generate unique RelationshipIds', () => {
      const id1 = createRelationshipId()
      const id2 = createRelationshipId()
      expect(id1).not.toBe(id2)
    })

    it('should generate unique CallbackIds', () => {
      const id1 = createCallbackId()
      const id2 = createCallbackId()
      expect(id1).not.toBe(id2)
    })

    it('should generate unique BrokerMessageIds', () => {
      const id1 = createBrokerMessageId()
      const id2 = createBrokerMessageId()
      expect(id1).not.toBe(id2)
    })

    it('should generate IDs with expected prefixes', () => {
      expect(createThingId()).toMatch(/^thing_/)
      expect(createEventId()).toMatch(/^evt_/)
      expect(createRelationshipId()).toMatch(/^rel_/)
      expect(createCallbackId()).toMatch(/^cb_/)
      expect(createBrokerMessageId()).toMatch(/^brk_/)
    })
  })

  describe('String Compatibility', () => {
    it('should allow branded IDs to be used as strings', () => {
      const thingId = createThingId()

      // Branded IDs should still work as strings for concatenation, etc.
      const url = `/things/${thingId}`
      expect(url).toContain('thing_')
    })

    it('should allow branded IDs in string interpolation', () => {
      const eventId = createEventId()
      const message = `Event ID: ${eventId}`
      expect(message).toContain('evt_')
    })

    it('should allow branded IDs in JSON serialization', () => {
      const thingId = createThingId()
      const obj = { id: thingId }
      const json = JSON.stringify(obj)
      expect(json).toContain('thing_')
    })
  })
})
