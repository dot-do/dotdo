/**
 * Branded Types Tests - TDD for do-eoxd
 *
 * These tests verify that branded types are used consistently throughout the codebase.
 * Branded types provide compile-time type safety to prevent mixing different ID types.
 *
 * RED Phase: Tests that verify the expected type signatures exist
 * GREEN Phase: Update type definitions to use branded types consistently
 *
 * @module db/tests/branded-types.test
 */

import { describe, it, expect } from 'vitest'
import {
  // Branded types
  type ThingId,
  type EventId,
  type RelationshipId,
  type UserId,
  type TenantId,
  type OrgId,
  type ApiKeyId,
  type CorrelationId,

  // Type guards
  isThingId,
  isEventId,
  isRelationshipId,
  isUserId,
  isTenantId,
  isOrgId,
  isApiKeyId,
  isCorrelationId,

  // Assertion functions
  assertThingId,
  assertEventId,
  assertRelationshipId,
  assertUserId,
  assertTenantId,

  // Factory functions
  toThingId,
  toEventId,
  toRelationshipId,
  toUserId,
  toTenantId,
  toOrgId,
  toApiKeyId,
  toCorrelationId,
  createRelationshipId
} from '../branded-types'

import { generateId, generateEventId } from '../id'
import { createThingsStore, type Thing, type BaseThing } from '../things'
import { createEventsStore, type Event, type BaseEvent } from '../events'
import { createRelationshipsStore, type Relationship, type BaseRelationship } from '../relationships'

// ============================================================================
// TYPE GUARD TESTS
// ============================================================================

describe('Branded Types - Type Guards', () => {
  describe('isThingId', () => {
    it('should return true for valid ThingId format', () => {
      // ThingId format: {timestamp-base36}-{random-6-chars}
      expect(isThingId('luhm21abc-xyz123')).toBe(true)
      expect(isThingId('m5x7y2z-a1b2c3')).toBe(true)
    })

    it('should return false for invalid ThingId format', () => {
      expect(isThingId('')).toBe(false)
      expect(isThingId('nohyphen')).toBe(false) // No hyphen at all
      expect(isThingId('a:b:c')).toBe(false) // RelationshipId format
      expect(isThingId('UPPERCASE-abc')).toBe(false) // Contains uppercase
      expect(isThingId('has spaces-abc')).toBe(false) // Contains spaces
    })

    it('should return false for non-strings', () => {
      expect(isThingId(null as unknown as string)).toBe(false)
      expect(isThingId(undefined as unknown as string)).toBe(false)
      expect(isThingId(123 as unknown as string)).toBe(false)
    })
  })

  describe('isEventId', () => {
    it('should return true for valid EventId format', () => {
      // EventId format: evt-{timestamp-base36}-{random-4-chars}
      expect(isEventId('evt-luhm21abc-xyz1')).toBe(true)
      expect(isEventId('evt-m5x7y2z-a1b2')).toBe(true)
    })

    it('should return false for invalid EventId format', () => {
      expect(isEventId('')).toBe(false)
      expect(isEventId('luhm21abc-xyz123')).toBe(false) // ThingId format
      expect(isEventId('event-123-abc')).toBe(false) // Wrong prefix
      expect(isEventId('evt123abc')).toBe(false) // Missing hyphens
    })
  })

  describe('isRelationshipId', () => {
    it('should return true for valid RelationshipId format', () => {
      // RelationshipId format: subject:predicate:object
      expect(isRelationshipId('thing-123:owns:thing-456')).toBe(true)
      expect(isRelationshipId('user-1:created:post-2')).toBe(true)
    })

    it('should return false for invalid RelationshipId format', () => {
      expect(isRelationshipId('')).toBe(false)
      expect(isRelationshipId('no-colons')).toBe(false)
      expect(isRelationshipId('one:two')).toBe(false) // Only 2 parts
      expect(isRelationshipId('one:two:three:four')).toBe(false) // Too many parts
    })
  })

  describe('isUserId', () => {
    it('should return true for any non-empty string', () => {
      expect(isUserId('user-123')).toBe(true)
      expect(isUserId('email@example.com')).toBe(true)
      expect(isUserId('jwt-sub-claim')).toBe(true)
    })

    it('should return false for empty string', () => {
      expect(isUserId('')).toBe(false)
    })
  })

  describe('isTenantId', () => {
    it('should return true for valid hostname-like strings', () => {
      expect(isTenantId('acme')).toBe(true)
      expect(isTenantId('acme-corp')).toBe(true)
      expect(isTenantId('my123tenant')).toBe(true)
    })

    it('should return false for invalid tenant IDs', () => {
      expect(isTenantId('')).toBe(false)
      expect(isTenantId('-starts-with-hyphen')).toBe(false)
      expect(isTenantId('ends-with-hyphen-')).toBe(false)
      expect(isTenantId('has_underscore')).toBe(false)
    })
  })

  describe('isOrgId and isApiKeyId', () => {
    it('should use ThingId pattern', () => {
      const validId = 'luhm21abc-xyz123'
      expect(isOrgId(validId)).toBe(true)
      expect(isApiKeyId(validId)).toBe(true)
    })
  })

  describe('isCorrelationId', () => {
    it('should return true for any non-empty string', () => {
      expect(isCorrelationId('correlation-123')).toBe(true)
      expect(isCorrelationId('uuid-here')).toBe(true)
    })
  })
})

// ============================================================================
// ASSERTION FUNCTION TESTS
// ============================================================================

describe('Branded Types - Assertion Functions', () => {
  describe('assertThingId', () => {
    it('should not throw for valid ThingId', () => {
      expect(() => assertThingId('luhm21abc-xyz123')).not.toThrow()
    })

    it('should throw for invalid ThingId', () => {
      expect(() => assertThingId('')).toThrow('Invalid ThingId')
      expect(() => assertThingId('invalid')).toThrow('Invalid ThingId')
    })
  })

  describe('assertEventId', () => {
    it('should not throw for valid EventId', () => {
      expect(() => assertEventId('evt-luhm21abc-xyz1')).not.toThrow()
    })

    it('should throw for invalid EventId', () => {
      expect(() => assertEventId('')).toThrow('Invalid EventId')
      expect(() => assertEventId('not-an-event-id')).toThrow('Invalid EventId')
    })
  })

  describe('assertRelationshipId', () => {
    it('should not throw for valid RelationshipId', () => {
      expect(() => assertRelationshipId('a:b:c')).not.toThrow()
    })

    it('should throw for invalid RelationshipId', () => {
      expect(() => assertRelationshipId('')).toThrow('Invalid RelationshipId')
      expect(() => assertRelationshipId('no-colons')).toThrow('Invalid RelationshipId')
    })
  })

  describe('assertUserId', () => {
    it('should not throw for valid UserId', () => {
      expect(() => assertUserId('user-123')).not.toThrow()
    })

    it('should throw for invalid UserId', () => {
      expect(() => assertUserId('')).toThrow('Invalid UserId')
    })
  })

  describe('assertTenantId', () => {
    it('should not throw for valid TenantId', () => {
      expect(() => assertTenantId('acme')).not.toThrow()
    })

    it('should throw for invalid TenantId', () => {
      expect(() => assertTenantId('')).toThrow('Invalid TenantId')
      expect(() => assertTenantId('-invalid')).toThrow('Invalid TenantId')
    })
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('Branded Types - Factory Functions', () => {
  it('toThingId should create a ThingId', () => {
    const id = toThingId('test-id')
    // TypeScript should recognize this as ThingId
    const _typeCheck: ThingId = id
    expect(id).toBe('test-id')
  })

  it('toEventId should create an EventId', () => {
    const id = toEventId('evt-test-id')
    const _typeCheck: EventId = id
    expect(id).toBe('evt-test-id')
  })

  it('toRelationshipId should create a RelationshipId', () => {
    const id = toRelationshipId('a:b:c')
    const _typeCheck: RelationshipId = id
    expect(id).toBe('a:b:c')
  })

  it('createRelationshipId should compose from parts', () => {
    const id = createRelationshipId('subject-1', 'owns', 'object-2')
    const _typeCheck: RelationshipId = id
    expect(id).toBe('subject-1:owns:object-2')
  })

  it('toUserId should create a UserId', () => {
    const id = toUserId('user-123')
    const _typeCheck: UserId = id
    expect(id).toBe('user-123')
  })

  it('toTenantId should create a TenantId', () => {
    const id = toTenantId('acme')
    const _typeCheck: TenantId = id
    expect(id).toBe('acme')
  })

  it('toOrgId should create an OrgId', () => {
    const id = toOrgId('org-123')
    const _typeCheck: OrgId = id
    expect(id).toBe('org-123')
  })

  it('toApiKeyId should create an ApiKeyId', () => {
    const id = toApiKeyId('key-123')
    const _typeCheck: ApiKeyId = id
    expect(id).toBe('key-123')
  })

  it('toCorrelationId should create a CorrelationId', () => {
    const id = toCorrelationId('corr-123')
    const _typeCheck: CorrelationId = id
    expect(id).toBe('corr-123')
  })
})

// ============================================================================
// ID GENERATION TESTS
// ============================================================================

describe('Branded Types - ID Generation', () => {
  describe('generateId', () => {
    it('should return a branded ThingId', () => {
      const id = generateId()
      // Type check: should be assignable to ThingId
      const _typeCheck: ThingId = id
      expect(typeof id).toBe('string')
      expect(isThingId(id)).toBe(true)
    })

    it('should generate unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateId())
      }
      expect(ids.size).toBe(100)
    })
  })

  describe('generateEventId', () => {
    it('should return a branded EventId', () => {
      const id = generateEventId()
      // Type check: should be assignable to EventId
      const _typeCheck: EventId = id
      expect(typeof id).toBe('string')
      expect(isEventId(id)).toBe(true)
    })

    it('should generate unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateEventId())
      }
      expect(ids.size).toBe(100)
    })
  })
})

// ============================================================================
// STORE INTEGRATION TESTS - Verify branded types in store interfaces
// ============================================================================

describe('Branded Types - Store Integration', () => {
  describe('ThingsStore', () => {
    it('should return Thing with branded ThingId in $id', async () => {
      const store = createThingsStore()
      const thing = await store.create({ $type: 'Customer', name: 'Alice' })

      // Type check: thing.$id should be ThingId
      const _typeCheck: ThingId = thing.$id
      expect(isThingId(thing.$id)).toBe(true)
    })

    it('BaseThing.$id should be typed as ThingId', () => {
      // This is a compile-time type check
      type CheckThingId = BaseThing['$id'] extends ThingId ? true : false
      const _check: CheckThingId = true
    })
  })

  describe('EventsStore', () => {
    it('should return Event with branded EventId in $id', async () => {
      const store = createEventsStore()
      const event = await store.emit({ type: 'test.event', payload: {} })

      // Type check: event.$id should be EventId
      const _typeCheck: EventId = event.$id
      expect(isEventId(event.$id)).toBe(true)
    })

    it('BaseEvent.$id should be typed as EventId', () => {
      // This is a compile-time type check
      type CheckEventId = BaseEvent['$id'] extends EventId ? true : false
      const _check: CheckEventId = true
    })

    it('BaseEvent.source should accept ThingId', () => {
      // This is a compile-time type check - source can be ThingId | string
      const thingId: ThingId = toThingId('thing-123-abc')
      const source: BaseEvent['source'] = thingId
      expect(source).toBe('thing-123-abc')
    })

    it('BaseEvent.correlationId should accept CorrelationId', () => {
      const corrId: CorrelationId = toCorrelationId('corr-123')
      const correlationId: BaseEvent['correlationId'] = corrId
      expect(correlationId).toBe('corr-123')
    })
  })

  describe('RelationshipsStore', () => {
    it('should accept ThingId for subject and object', async () => {
      const store = createRelationshipsStore()
      const subjectId = toThingId('luhm21abc-xyz123')
      const objectId = toThingId('luhm21def-uvw456')

      const rel = await store.add({
        subject: subjectId,
        predicate: 'owns',
        object: objectId
      })

      expect(rel.subject).toBe(subjectId)
      expect(rel.object).toBe(objectId)
    })

    it('BaseRelationship.subject should accept ThingId | string', () => {
      // Compile-time check: subject can be ThingId or string for backward compat
      const thingId: ThingId = toThingId('thing-123-abc')
      const subject: BaseRelationship['subject'] = thingId
      expect(subject).toBe('thing-123-abc')

      const stringSubject: BaseRelationship['subject'] = 'plain-string'
      expect(stringSubject).toBe('plain-string')
    })
  })
})

// ============================================================================
// COMPILE-TIME TYPE SAFETY TESTS
// ============================================================================

describe('Branded Types - Compile-Time Type Safety', () => {
  it('should not allow assigning ThingId to EventId at compile time', () => {
    // These tests verify that the branded types prevent accidental mixing
    // If the types were just plain strings, these assignments would compile
    const thingId: ThingId = toThingId('thing-123-abc')
    const eventId: EventId = toEventId('evt-123-abc')

    // Runtime check that they are different values
    expect(thingId).not.toBe(eventId)

    // The following would cause compile errors if uncommented:
    // const wrongAssignment1: EventId = thingId // Error!
    // const wrongAssignment2: ThingId = eventId // Error!
  })

  it('should allow using branded types in generic contexts', () => {
    // Test that branded types work with generic functions
    function processId<T extends string>(id: T): T {
      return id
    }

    const thingId: ThingId = toThingId('thing-123-abc')
    const result = processId(thingId)
    const _check: ThingId = result
    expect(result).toBe(thingId)
  })

  it('should work with type narrowing using type guards', () => {
    const id = 'evt-123-abc1'

    if (isEventId(id)) {
      // TypeScript should narrow the type to EventId
      const _narrowed: EventId = id
      expect(true).toBe(true)
    }
  })
})
