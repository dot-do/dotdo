/**
 * Tests for custom assertion helpers
 *
 * These tests verify that the custom Vitest matchers work correctly
 * for validating Thing, Relationship, and Event entities.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  setupEntityAssertions,
  validateThing,
  validateRelationship,
  validateEvent,
  validateEntity,
  findRelationship
} from '../assertions'

// Setup custom matchers before all tests
beforeAll(() => {
  setupEntityAssertions()
})

describe('validateThing', () => {
  it('should validate a correct Thing', () => {
    const thing = {
      $id: 'abc123',
      $type: 'Customer',
      $createdAt: Date.now(),
      $updatedAt: Date.now(),
      name: 'Alice'
    }

    const result = validateThing(thing)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject non-object values', () => {
    expect(validateThing(null).valid).toBe(false)
    expect(validateThing(undefined).valid).toBe(false)
    expect(validateThing('string').valid).toBe(false)
    expect(validateThing(123).valid).toBe(false)
    expect(validateThing([]).valid).toBe(false)
  })

  it('should require $id to be a non-empty string', () => {
    const missingId = { $type: 'Test', $createdAt: Date.now(), $updatedAt: Date.now() }
    const emptyId = { $id: '', $type: 'Test', $createdAt: Date.now(), $updatedAt: Date.now() }
    const wrongTypeId = { $id: 123, $type: 'Test', $createdAt: Date.now(), $updatedAt: Date.now() }

    expect(validateThing(missingId).valid).toBe(false)
    expect(validateThing(emptyId).valid).toBe(false)
    expect(validateThing(wrongTypeId).valid).toBe(false)
  })

  it('should require $type to be a non-empty string', () => {
    const missingType = { $id: 'abc', $createdAt: Date.now(), $updatedAt: Date.now() }
    const emptyType = { $id: 'abc', $type: '', $createdAt: Date.now(), $updatedAt: Date.now() }
    const wrongType = { $id: 'abc', $type: 123, $createdAt: Date.now(), $updatedAt: Date.now() }

    expect(validateThing(missingType).valid).toBe(false)
    expect(validateThing(emptyType).valid).toBe(false)
    expect(validateThing(wrongType).valid).toBe(false)
  })

  it('should require $createdAt to be a positive number', () => {
    const missingCreated = { $id: 'abc', $type: 'Test', $updatedAt: Date.now() }
    const wrongTypeCreated = { $id: 'abc', $type: 'Test', $createdAt: 'now', $updatedAt: Date.now() }
    const negativeCreated = { $id: 'abc', $type: 'Test', $createdAt: -1, $updatedAt: Date.now() }

    expect(validateThing(missingCreated).valid).toBe(false)
    expect(validateThing(wrongTypeCreated).valid).toBe(false)
    expect(validateThing(negativeCreated).valid).toBe(false)
  })

  it('should require $updatedAt to be a positive number', () => {
    const missingUpdated = { $id: 'abc', $type: 'Test', $createdAt: Date.now() }
    const wrongTypeUpdated = { $id: 'abc', $type: 'Test', $createdAt: Date.now(), $updatedAt: 'now' }
    const negativeUpdated = { $id: 'abc', $type: 'Test', $createdAt: Date.now(), $updatedAt: -1 }

    expect(validateThing(missingUpdated).valid).toBe(false)
    expect(validateThing(wrongTypeUpdated).valid).toBe(false)
    expect(validateThing(negativeUpdated).valid).toBe(false)
  })

  it('should require $updatedAt >= $createdAt', () => {
    const invalidTimestamps = {
      $id: 'abc',
      $type: 'Test',
      $createdAt: 1000,
      $updatedAt: 500
    }

    const result = validateThing(invalidTimestamps)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('$updatedAt must be >= $createdAt'))).toBe(true)
  })

  it('should collect all errors', () => {
    const multipleErrors = { $id: '', $type: 123 }
    const result = validateThing(multipleErrors)

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })
})

describe('validateRelationship', () => {
  it('should validate a correct Relationship', () => {
    const relationship = {
      subject: 'thing1',
      predicate: 'owns',
      object: 'thing2',
      $createdAt: Date.now()
    }

    const result = validateRelationship(relationship)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject non-object values', () => {
    expect(validateRelationship(null).valid).toBe(false)
    expect(validateRelationship(undefined).valid).toBe(false)
    expect(validateRelationship('string').valid).toBe(false)
  })

  it('should require subject to be a non-empty string', () => {
    const base = { predicate: 'owns', object: 'thing2', $createdAt: Date.now() }

    expect(validateRelationship({ ...base }).valid).toBe(false)
    expect(validateRelationship({ ...base, subject: '' }).valid).toBe(false)
    expect(validateRelationship({ ...base, subject: 123 }).valid).toBe(false)
  })

  it('should require predicate to be a non-empty string', () => {
    const base = { subject: 'thing1', object: 'thing2', $createdAt: Date.now() }

    expect(validateRelationship({ ...base }).valid).toBe(false)
    expect(validateRelationship({ ...base, predicate: '' }).valid).toBe(false)
    expect(validateRelationship({ ...base, predicate: null }).valid).toBe(false)
  })

  it('should require object to be a non-empty string', () => {
    const base = { subject: 'thing1', predicate: 'owns', $createdAt: Date.now() }

    expect(validateRelationship({ ...base }).valid).toBe(false)
    expect(validateRelationship({ ...base, object: '' }).valid).toBe(false)
    expect(validateRelationship({ ...base, object: [] }).valid).toBe(false)
  })

  it('should require $createdAt to be a positive number', () => {
    const base = { subject: 'thing1', predicate: 'owns', object: 'thing2' }

    expect(validateRelationship({ ...base }).valid).toBe(false)
    expect(validateRelationship({ ...base, $createdAt: 'now' }).valid).toBe(false)
    expect(validateRelationship({ ...base, $createdAt: -1 }).valid).toBe(false)
  })
})

describe('validateEvent', () => {
  it('should validate a correct Event', () => {
    const event = {
      $id: 'evt-123',
      type: 'user.created',
      payload: { userId: '123' },
      $timestamp: Date.now()
    }

    const result = validateEvent(event)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should validate Event with optional fields', () => {
    const event = {
      $id: 'evt-123',
      type: 'user.created',
      payload: { userId: '123' },
      $timestamp: Date.now(),
      source: 'system',
      correlationId: 'corr-456'
    }

    const result = validateEvent(event)
    expect(result.valid).toBe(true)
  })

  it('should allow null payload', () => {
    const event = {
      $id: 'evt-123',
      type: 'ping',
      payload: null,
      $timestamp: Date.now()
    }

    const result = validateEvent(event)
    expect(result.valid).toBe(true)
  })

  it('should reject non-object values', () => {
    expect(validateEvent(null).valid).toBe(false)
    expect(validateEvent('string').valid).toBe(false)
  })

  it('should require $id to be a non-empty string', () => {
    const base = { type: 'test', payload: {}, $timestamp: Date.now() }

    expect(validateEvent({ ...base }).valid).toBe(false)
    expect(validateEvent({ ...base, $id: '' }).valid).toBe(false)
    expect(validateEvent({ ...base, $id: 123 }).valid).toBe(false)
  })

  it('should require type to be a non-empty string', () => {
    const base = { $id: 'evt-1', payload: {}, $timestamp: Date.now() }

    expect(validateEvent({ ...base }).valid).toBe(false)
    expect(validateEvent({ ...base, type: '' }).valid).toBe(false)
    expect(validateEvent({ ...base, type: 123 }).valid).toBe(false)
  })

  it('should require payload field to exist', () => {
    const event = {
      $id: 'evt-123',
      type: 'test',
      $timestamp: Date.now()
    }

    const result = validateEvent(event)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('payload'))).toBe(true)
  })

  it('should require $timestamp to be a positive number', () => {
    const base = { $id: 'evt-1', type: 'test', payload: {} }

    expect(validateEvent({ ...base }).valid).toBe(false)
    expect(validateEvent({ ...base, $timestamp: 'now' }).valid).toBe(false)
    expect(validateEvent({ ...base, $timestamp: -1 }).valid).toBe(false)
  })

  it('should validate optional source field type', () => {
    const event = {
      $id: 'evt-123',
      type: 'test',
      payload: {},
      $timestamp: Date.now(),
      source: 123 // should be string
    }

    const result = validateEvent(event)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('source'))).toBe(true)
  })

  it('should validate optional correlationId field type', () => {
    const event = {
      $id: 'evt-123',
      type: 'test',
      payload: {},
      $timestamp: Date.now(),
      correlationId: 123 // should be string
    }

    const result = validateEvent(event)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('correlationId'))).toBe(true)
  })
})

describe('validateEntity (auto-detection)', () => {
  it('should detect and validate Thing entities', () => {
    const thing = {
      $id: 'abc123',
      $type: 'Customer',
      $createdAt: Date.now(),
      $updatedAt: Date.now()
    }

    const result = validateEntity(thing)
    expect(result.valid).toBe(true)
    expect(result.entityType).toBe('Thing')
  })

  it('should detect and validate Relationship entities', () => {
    const relationship = {
      subject: 'thing1',
      predicate: 'owns',
      object: 'thing2',
      $createdAt: Date.now()
    }

    const result = validateEntity(relationship)
    expect(result.valid).toBe(true)
    expect(result.entityType).toBe('Relationship')
  })

  it('should detect and validate Event entities', () => {
    const event = {
      $id: 'evt-123',
      type: 'user.created',
      payload: {},
      $timestamp: Date.now()
    }

    const result = validateEntity(event)
    expect(result.valid).toBe(true)
    expect(result.entityType).toBe('Event')
  })

  it('should return unknown for unrecognized structures', () => {
    const unknown = { foo: 'bar', baz: 123 }

    const result = validateEntity(unknown)
    expect(result.valid).toBe(false)
    expect(result.entityType).toBe('unknown')
  })
})

describe('findRelationship', () => {
  const relationships = [
    { subject: 'a', predicate: 'owns', object: 'b', $createdAt: 1 },
    { subject: 'b', predicate: 'contains', object: 'c', $createdAt: 2 },
    { subject: 'a', predicate: 'created', object: 'c', $createdAt: 3 }
  ]

  it('should find existing relationship', () => {
    const found = findRelationship(relationships, 'a', 'owns', 'b')
    expect(found).toBeDefined()
    expect(found?.subject).toBe('a')
    expect(found?.predicate).toBe('owns')
    expect(found?.object).toBe('b')
  })

  it('should return undefined for non-existing relationship', () => {
    const found = findRelationship(relationships, 'x', 'owns', 'y')
    expect(found).toBeUndefined()
  })

  it('should match all three components', () => {
    // Exists but different predicate
    expect(findRelationship(relationships, 'a', 'contains', 'b')).toBeUndefined()
    // Exists but different object
    expect(findRelationship(relationships, 'a', 'owns', 'c')).toBeUndefined()
    // Exists but different subject
    expect(findRelationship(relationships, 'b', 'owns', 'b')).toBeUndefined()
  })
})

describe('Custom Vitest Matchers', () => {
  describe('toBeValidThing', () => {
    it('should pass for valid Thing', () => {
      const thing = {
        $id: 'abc123',
        $type: 'Customer',
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
        name: 'Alice'
      }

      expect(thing).toBeValidThing()
    })

    it('should fail for invalid Thing', () => {
      const invalid = { foo: 'bar' }

      expect(() => expect(invalid).toBeValidThing()).toThrow()
    })

    it('should support negation', () => {
      const invalid = { foo: 'bar' }

      expect(invalid).not.toBeValidThing()
    })
  })

  describe('toBeValidRelationship', () => {
    it('should pass for valid Relationship', () => {
      const relationship = {
        subject: 'thing1',
        predicate: 'owns',
        object: 'thing2',
        $createdAt: Date.now()
      }

      expect(relationship).toBeValidRelationship()
    })

    it('should fail for invalid Relationship', () => {
      const invalid = { subject: 'thing1' }

      expect(() => expect(invalid).toBeValidRelationship()).toThrow()
    })
  })

  describe('toBeValidEvent', () => {
    it('should pass for valid Event', () => {
      const event = {
        $id: 'evt-123',
        type: 'user.created',
        payload: { userId: '123' },
        $timestamp: Date.now()
      }

      expect(event).toBeValidEvent()
    })

    it('should fail for invalid Event', () => {
      const invalid = { type: 'test' }

      expect(() => expect(invalid).toBeValidEvent()).toThrow()
    })
  })

  describe('toBeValidEntity', () => {
    it('should pass for valid Thing', () => {
      const thing = {
        $id: 'abc123',
        $type: 'Customer',
        $createdAt: Date.now(),
        $updatedAt: Date.now()
      }

      expect(thing).toBeValidEntity()
    })

    it('should pass for valid Relationship', () => {
      const relationship = {
        subject: 'thing1',
        predicate: 'owns',
        object: 'thing2',
        $createdAt: Date.now()
      }

      expect(relationship).toBeValidEntity()
    })

    it('should pass for valid Event', () => {
      const event = {
        $id: 'evt-123',
        type: 'test',
        payload: {},
        $timestamp: Date.now()
      }

      expect(event).toBeValidEntity()
    })

    it('should fail for unrecognized structure', () => {
      const invalid = { foo: 'bar' }

      expect(() => expect(invalid).toBeValidEntity()).toThrow()
    })
  })

  describe('toHaveThingType', () => {
    it('should pass when type matches', () => {
      const thing = {
        $id: 'abc123',
        $type: 'Customer',
        $createdAt: Date.now(),
        $updatedAt: Date.now()
      }

      expect(thing).toHaveThingType('Customer')
    })

    it('should fail when type does not match', () => {
      const thing = {
        $id: 'abc123',
        $type: 'Customer',
        $createdAt: Date.now(),
        $updatedAt: Date.now()
      }

      expect(() => expect(thing).toHaveThingType('Order')).toThrow()
    })

    it('should fail for invalid Thing', () => {
      const invalid = { $type: 'Test' }

      expect(() => expect(invalid).toHaveThingType('Test')).toThrow()
    })

    it('should support negation', () => {
      const thing = {
        $id: 'abc123',
        $type: 'Customer',
        $createdAt: Date.now(),
        $updatedAt: Date.now()
      }

      expect(thing).not.toHaveThingType('Order')
    })
  })

  describe('toHaveEventType', () => {
    it('should pass when type matches', () => {
      const event = {
        $id: 'evt-123',
        type: 'user.created',
        payload: {},
        $timestamp: Date.now()
      }

      expect(event).toHaveEventType('user.created')
    })

    it('should fail when type does not match', () => {
      const event = {
        $id: 'evt-123',
        type: 'user.created',
        payload: {},
        $timestamp: Date.now()
      }

      expect(() => expect(event).toHaveEventType('user.deleted')).toThrow()
    })

    it('should support negation', () => {
      const event = {
        $id: 'evt-123',
        type: 'user.created',
        payload: {},
        $timestamp: Date.now()
      }

      expect(event).not.toHaveEventType('user.deleted')
    })
  })

  describe('toHaveEventPayload', () => {
    it('should pass when payload matches', () => {
      const event = {
        $id: 'evt-123',
        type: 'user.created',
        payload: { userId: '123', name: 'Alice' },
        $timestamp: Date.now()
      }

      expect(event).toHaveEventPayload({ userId: '123', name: 'Alice' })
    })

    it('should fail when payload does not match', () => {
      const event = {
        $id: 'evt-123',
        type: 'user.created',
        payload: { userId: '123' },
        $timestamp: Date.now()
      }

      expect(() => expect(event).toHaveEventPayload({ userId: '456' })).toThrow()
    })

    it('should work with null payload', () => {
      const event = {
        $id: 'evt-123',
        type: 'ping',
        payload: null,
        $timestamp: Date.now()
      }

      expect(event).toHaveEventPayload(null)
    })

    it('should support negation', () => {
      const event = {
        $id: 'evt-123',
        type: 'user.created',
        payload: { userId: '123' },
        $timestamp: Date.now()
      }

      expect(event).not.toHaveEventPayload({ userId: '456' })
    })
  })

  describe('toContainRelationship', () => {
    it('should pass when relationship exists', () => {
      const relationships = [
        { subject: 'a', predicate: 'owns', object: 'b', $createdAt: Date.now() },
        { subject: 'b', predicate: 'contains', object: 'c', $createdAt: Date.now() }
      ]

      expect(relationships).toContainRelationship('a', 'owns', 'b')
    })

    it('should fail when relationship does not exist', () => {
      const relationships = [
        { subject: 'a', predicate: 'owns', object: 'b', $createdAt: Date.now() }
      ]

      expect(() => expect(relationships).toContainRelationship('x', 'owns', 'y')).toThrow()
    })

    it('should fail for non-array', () => {
      expect(() => expect('not an array').toContainRelationship('a', 'b', 'c')).toThrow()
    })

    it('should fail for array with invalid relationships', () => {
      const invalid = [{ foo: 'bar' }]

      expect(() => expect(invalid).toContainRelationship('a', 'b', 'c')).toThrow()
    })

    it('should support negation', () => {
      const relationships = [
        { subject: 'a', predicate: 'owns', object: 'b', $createdAt: Date.now() }
      ]

      expect(relationships).not.toContainRelationship('x', 'owns', 'y')
    })

    it('should work with empty array', () => {
      expect(() => expect([]).toContainRelationship('a', 'owns', 'b')).toThrow()
    })
  })
})

describe('Integration with real stores', () => {
  it('should validate things created by createThingsStore', async () => {
    // Import dynamically to avoid module resolution issues in unit tests
    const { createThingsStore } = await import('../../db/things')

    const store = createThingsStore()
    const thing = await store.create({ $type: 'Customer', name: 'Alice' })

    expect(thing).toBeValidThing()
    expect(thing).toHaveThingType('Customer')
  })

  it('should validate relationships created by createRelationshipsStore', async () => {
    const { createRelationshipsStore } = await import('../../db/relationships')

    const store = createRelationshipsStore()
    const relationship = await store.add({
      subject: 'thing1',
      predicate: 'owns',
      object: 'thing2'
    })

    expect(relationship).toBeValidRelationship()
  })

  it('should validate events created by createEventsStore', async () => {
    const { createEventsStore } = await import('../../db/events')

    const store = createEventsStore()
    const event = await store.emit({
      type: 'user.created',
      payload: { userId: '123' }
    })

    expect(event).toBeValidEvent()
    expect(event).toHaveEventType('user.created')
  })

  it('should find relationships in array from store', async () => {
    const { createRelationshipsStore } = await import('../../db/relationships')

    const store = createRelationshipsStore()
    await store.add({ subject: 'a', predicate: 'owns', object: 'b' })
    await store.add({ subject: 'b', predicate: 'contains', object: 'c' })

    const relationships = await store.find({})

    expect(relationships).toContainRelationship('a', 'owns', 'b')
    expect(relationships).toContainRelationship('b', 'contains', 'c')
    expect(relationships).not.toContainRelationship('a', 'owns', 'c')
  })
})
