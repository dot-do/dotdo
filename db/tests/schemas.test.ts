// Tests for Zod schemas - see do-grp5.11
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  // Schemas
  JsonValueSchema,
  StorableDataSchema,
  ThingIdSchema,
  EventIdSchema,
  ThingSchema,
  ThingInputSchema,
  ThingUpdateSchema,
  EventSchema,
  EventInputSchema,
  EventQueryOptionsSchema,
  RelationshipSchema,
  RelationshipInputSchema,
  RelationshipQuerySchema,
  RetentionPolicySchema,
  DurabilityConfigSchema,
  BulkUpdateItemSchema,
  // Validation helpers - throwing
  validateThing,
  validateThingInput,
  validateEvent,
  validateEventInput,
  validateRelationship,
  validateRelationshipInput,
  validateThingId,
  validateEventId,
  // Validation helpers - safe
  safeParseThing,
  safeParseThingInput,
  safeParseEvent,
  safeParseEventInput,
  safeParseRelationship,
  safeParseRelationshipInput,
  safeParseThingId,
  safeParseEventId,
  // Utility functions
  formatValidationError,
  isThing,
  isEvent,
  isRelationship,
} from '../schemas'

// =============================================================================
// JSON Value Schema Tests
// =============================================================================

describe('JsonValueSchema', () => {
  it('accepts primitives', () => {
    expect(JsonValueSchema.parse('hello')).toBe('hello')
    expect(JsonValueSchema.parse(42)).toBe(42)
    expect(JsonValueSchema.parse(true)).toBe(true)
    expect(JsonValueSchema.parse(null)).toBe(null)
  })

  it('accepts arrays', () => {
    expect(JsonValueSchema.parse([1, 2, 3])).toEqual([1, 2, 3])
    expect(JsonValueSchema.parse(['a', 'b'])).toEqual(['a', 'b'])
    expect(JsonValueSchema.parse([1, 'mixed', true])).toEqual([1, 'mixed', true])
  })

  it('accepts objects', () => {
    expect(JsonValueSchema.parse({ foo: 'bar' })).toEqual({ foo: 'bar' })
    expect(JsonValueSchema.parse({ nested: { deep: 1 } })).toEqual({ nested: { deep: 1 } })
  })

  it('accepts nested structures', () => {
    const complex = {
      name: 'test',
      items: [1, 2, { nested: true }],
      metadata: { count: 5 }
    }
    expect(JsonValueSchema.parse(complex)).toEqual(complex)
  })

  it('rejects undefined', () => {
    expect(JsonValueSchema.safeParse(undefined).success).toBe(false)
  })

  it('rejects functions', () => {
    expect(JsonValueSchema.safeParse(() => {}).success).toBe(false)
  })
})

// =============================================================================
// ID Schema Tests
// =============================================================================

describe('ThingIdSchema', () => {
  it('accepts valid Thing IDs', () => {
    expect(ThingIdSchema.parse('abc123-xyz456')).toBe('abc123-xyz456')
    expect(ThingIdSchema.parse('luhm21abc-xyz123')).toBe('luhm21abc-xyz123')
    expect(ThingIdSchema.parse('a1b2c3-d4e5f6')).toBe('a1b2c3-d4e5f6')
  })

  it('rejects invalid Thing IDs', () => {
    expect(ThingIdSchema.safeParse('').success).toBe(false)
    expect(ThingIdSchema.safeParse('no-hyphen-here').success).toBe(false) // needs hyphen
    expect(ThingIdSchema.safeParse('ABC-DEF').success).toBe(false) // uppercase
    expect(ThingIdSchema.safeParse('-invalid').success).toBe(false) // starts with hyphen
  })
})

describe('EventIdSchema', () => {
  it('accepts valid Event IDs', () => {
    expect(EventIdSchema.parse('evt-abc123-xyz456')).toBe('evt-abc123-xyz456')
    expect(EventIdSchema.parse('evt-luhm21abc-xyz1')).toBe('evt-luhm21abc-xyz1')
  })

  it('rejects invalid Event IDs', () => {
    expect(EventIdSchema.safeParse('').success).toBe(false)
    expect(EventIdSchema.safeParse('abc-xyz').success).toBe(false) // missing evt- prefix
    expect(EventIdSchema.safeParse('EVT-abc-xyz').success).toBe(false) // uppercase
  })
})

// =============================================================================
// Thing Schema Tests
// =============================================================================

describe('ThingSchema', () => {
  const validThing = {
    $id: 'abc123-xyz456',
    $type: 'Customer',
    $createdAt: Date.now(),
    $updatedAt: Date.now(),
    name: 'Alice',
    email: 'alice@example.com'
  }

  it('accepts valid Things', () => {
    const result = ThingSchema.safeParse(validThing)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.$id).toBe(validThing.$id)
      expect(result.data.$type).toBe('Customer')
    }
  })

  it('accepts additional user properties', () => {
    const thing = { ...validThing, customField: 'custom value', nested: { foo: 'bar' } }
    const result = ThingSchema.safeParse(thing)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.customField).toBe('custom value')
      expect(result.data.nested).toEqual({ foo: 'bar' })
    }
  })

  it('rejects Things without $type', () => {
    const { $type, ...thingWithoutType } = validThing
    const result = ThingSchema.safeParse(thingWithoutType)
    expect(result.success).toBe(false)
  })

  it('rejects Things without $id', () => {
    const { $id, ...thingWithoutId } = validThing
    const result = ThingSchema.safeParse(thingWithoutId)
    expect(result.success).toBe(false)
  })

  it('rejects Things with invalid $id format', () => {
    const thing = { ...validThing, $id: 'invalid' }
    const result = ThingSchema.safeParse(thing)
    expect(result.success).toBe(false)
  })

  it('rejects Things with empty $type', () => {
    const thing = { ...validThing, $type: '' }
    const result = ThingSchema.safeParse(thing)
    expect(result.success).toBe(false)
  })

  it('rejects Things with negative timestamps', () => {
    const thing = { ...validThing, $createdAt: -1 }
    const result = ThingSchema.safeParse(thing)
    expect(result.success).toBe(false)
  })
})

describe('ThingInputSchema', () => {
  it('accepts valid Thing input', () => {
    const input = { $type: 'Customer', name: 'Alice' }
    const result = ThingInputSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('requires $type', () => {
    const input = { name: 'Alice' }
    const result = ThingInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('rejects empty $type', () => {
    const input = { $type: '' }
    const result = ThingInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('ThingUpdateSchema', () => {
  it('accepts valid updates', () => {
    const update = { name: 'Bob', email: 'bob@example.com' }
    const result = ThingUpdateSchema.safeParse(update)
    expect(result.success).toBe(true)
  })

  it('rejects updates with $id', () => {
    const update = { $id: 'new-id', name: 'Bob' }
    const result = ThingUpdateSchema.safeParse(update)
    expect(result.success).toBe(false)
  })

  it('rejects updates with $type', () => {
    const update = { $type: 'NewType', name: 'Bob' }
    const result = ThingUpdateSchema.safeParse(update)
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// Event Schema Tests
// =============================================================================

describe('EventSchema', () => {
  const validEvent = {
    $id: 'evt-abc123-xyz456',
    type: 'user.created',
    $timestamp: Date.now(),
    payload: { userId: 'user-123' }
  }

  it('accepts valid Events', () => {
    const result = EventSchema.safeParse(validEvent)
    expect(result.success).toBe(true)
  })

  it('accepts Events with source', () => {
    const event = { ...validEvent, source: 'api-server' }
    const result = EventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })

  it('accepts Events with correlationId', () => {
    const event = { ...validEvent, correlationId: 'corr-123' }
    const result = EventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })

  it('rejects Events without type', () => {
    const { type, ...eventWithoutType } = validEvent
    const result = EventSchema.safeParse(eventWithoutType)
    expect(result.success).toBe(false)
  })

  it('rejects Events with empty type', () => {
    const event = { ...validEvent, type: '' }
    const result = EventSchema.safeParse(event)
    expect(result.success).toBe(false)
  })

  it('rejects Events without payload', () => {
    const { payload, ...eventWithoutPayload } = validEvent
    const result = EventSchema.safeParse(eventWithoutPayload)
    expect(result.success).toBe(false)
  })

  it('accepts null payload', () => {
    const event = { ...validEvent, payload: null }
    const result = EventSchema.safeParse(event)
    expect(result.success).toBe(true)
  })
})

describe('EventInputSchema', () => {
  it('accepts valid Event input', () => {
    const input = { type: 'user.created', payload: { userId: 'user-123' } }
    const result = EventInputSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('accepts Event input with optional fields', () => {
    const input = {
      type: 'user.created',
      payload: { userId: 'user-123' },
      source: 'api',
      correlationId: 'corr-123'
    }
    const result = EventInputSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('requires type', () => {
    const input = { payload: { userId: 'user-123' } }
    const result = EventInputSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('EventQueryOptionsSchema', () => {
  it('accepts empty options', () => {
    const result = EventQueryOptionsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts undefined', () => {
    const result = EventQueryOptionsSchema.safeParse(undefined)
    expect(result.success).toBe(true)
  })

  it('accepts valid options', () => {
    const options = {
      type: 'user.created',
      since: Date.now() - 1000,
      until: Date.now(),
      limit: 50,
      offset: 10
    }
    const result = EventQueryOptionsSchema.safeParse(options)
    expect(result.success).toBe(true)
  })

  it('rejects negative limit', () => {
    const options = { limit: -1 }
    const result = EventQueryOptionsSchema.safeParse(options)
    expect(result.success).toBe(false)
  })

  it('rejects limit over 1000', () => {
    const options = { limit: 1001 }
    const result = EventQueryOptionsSchema.safeParse(options)
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// Relationship Schema Tests
// =============================================================================

describe('RelationshipSchema', () => {
  const validRelationship = {
    subject: 'abc123-xyz456',
    predicate: 'owns',
    object: 'def456-uvw789',
    $createdAt: Date.now()
  }

  it('accepts valid Relationships', () => {
    const result = RelationshipSchema.safeParse(validRelationship)
    expect(result.success).toBe(true)
  })

  it('accepts Relationships with metadata', () => {
    const rel = { ...validRelationship, weight: 1.0, metadata: { note: 'important' } }
    const result = RelationshipSchema.safeParse(rel)
    expect(result.success).toBe(true)
  })

  it('rejects Relationships without subject', () => {
    const { subject, ...relWithoutSubject } = validRelationship
    const result = RelationshipSchema.safeParse(relWithoutSubject)
    expect(result.success).toBe(false)
  })

  it('rejects Relationships without predicate', () => {
    const { predicate, ...relWithoutPredicate } = validRelationship
    const result = RelationshipSchema.safeParse(relWithoutPredicate)
    expect(result.success).toBe(false)
  })

  it('rejects Relationships with empty predicate', () => {
    const rel = { ...validRelationship, predicate: '' }
    const result = RelationshipSchema.safeParse(rel)
    expect(result.success).toBe(false)
  })
})

describe('RelationshipInputSchema', () => {
  it('accepts valid Relationship input', () => {
    const input = {
      subject: 'abc123-xyz456',
      predicate: 'owns',
      object: 'def456-uvw789'
    }
    const result = RelationshipInputSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('accepts Relationship input with metadata', () => {
    const input = {
      subject: 'abc123-xyz456',
      predicate: 'owns',
      object: 'def456-uvw789',
      weight: 0.5
    }
    const result = RelationshipInputSchema.safeParse(input)
    expect(result.success).toBe(true)
  })
})

// =============================================================================
// Retention Policy and Durability Config Tests
// =============================================================================

describe('RetentionPolicySchema', () => {
  it('accepts maxEvents only', () => {
    const result = RetentionPolicySchema.safeParse({ maxEvents: 1000 })
    expect(result.success).toBe(true)
  })

  it('accepts maxAgeDays only', () => {
    const result = RetentionPolicySchema.safeParse({ maxAgeDays: 30 })
    expect(result.success).toBe(true)
  })

  it('accepts both maxEvents and maxAgeDays', () => {
    const result = RetentionPolicySchema.safeParse({ maxEvents: 1000, maxAgeDays: 30 })
    expect(result.success).toBe(true)
  })

  it('rejects empty policy', () => {
    const result = RetentionPolicySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects negative maxEvents', () => {
    const result = RetentionPolicySchema.safeParse({ maxEvents: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects zero maxAgeDays', () => {
    const result = RetentionPolicySchema.safeParse({ maxAgeDays: 0 })
    expect(result.success).toBe(false)
  })
})

describe('DurabilityConfigSchema', () => {
  it('accepts empty config (all optional)', () => {
    const result = DurabilityConfigSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts retries', () => {
    const result = DurabilityConfigSchema.safeParse({ retries: 3 })
    expect(result.success).toBe(true)
  })

  it('accepts backoff type', () => {
    expect(DurabilityConfigSchema.safeParse({ backoff: 'linear' }).success).toBe(true)
    expect(DurabilityConfigSchema.safeParse({ backoff: 'exponential' }).success).toBe(true)
  })

  it('rejects invalid backoff type', () => {
    const result = DurabilityConfigSchema.safeParse({ backoff: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('rejects negative retries', () => {
    const result = DurabilityConfigSchema.safeParse({ retries: -1 })
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// Validation Helper Tests (Throwing)
// =============================================================================

describe('validateThing', () => {
  it('returns valid Thing', () => {
    const thing = {
      $id: 'abc123-xyz456',
      $type: 'Customer',
      $createdAt: Date.now(),
      $updatedAt: Date.now()
    }
    const result = validateThing(thing)
    expect(result.$id).toBe(thing.$id)
  })

  it('throws on invalid Thing', () => {
    expect(() => validateThing({ $type: 'Customer' })).toThrow()
  })
})

describe('validateThingInput', () => {
  it('returns valid Thing input', () => {
    const input = { $type: 'Customer', name: 'Alice' }
    const result = validateThingInput(input)
    expect(result.$type).toBe('Customer')
  })

  it('throws on missing $type', () => {
    expect(() => validateThingInput({ name: 'Alice' })).toThrow()
  })
})

describe('validateEvent', () => {
  it('returns valid Event', () => {
    const event = {
      $id: 'evt-abc123-xyz456',
      type: 'user.created',
      $timestamp: Date.now(),
      payload: { userId: 'user-123' }
    }
    const result = validateEvent(event)
    expect(result.type).toBe('user.created')
  })

  it('throws on invalid Event', () => {
    expect(() => validateEvent({ type: '' })).toThrow()
  })
})

describe('validateEventInput', () => {
  it('returns valid Event input', () => {
    const input = { type: 'user.created', payload: null }
    const result = validateEventInput(input)
    expect(result.type).toBe('user.created')
  })

  it('throws on missing type', () => {
    expect(() => validateEventInput({ payload: null })).toThrow()
  })
})

describe('validateRelationship', () => {
  it('returns valid Relationship', () => {
    const rel = {
      subject: 'abc123-xyz456',
      predicate: 'owns',
      object: 'def456-uvw789',
      $createdAt: Date.now()
    }
    const result = validateRelationship(rel)
    expect(result.predicate).toBe('owns')
  })

  it('throws on invalid Relationship', () => {
    expect(() => validateRelationship({ subject: 'abc123-xyz456' })).toThrow()
  })
})

describe('validateThingId', () => {
  it('returns valid ID', () => {
    const result = validateThingId('abc123-xyz456')
    expect(result).toBe('abc123-xyz456')
  })

  it('throws on invalid ID', () => {
    expect(() => validateThingId('INVALID')).toThrow()
  })
})

describe('validateEventId', () => {
  it('returns valid ID', () => {
    const result = validateEventId('evt-abc123-xyz456')
    expect(result).toBe('evt-abc123-xyz456')
  })

  it('throws on invalid ID', () => {
    expect(() => validateEventId('abc123-xyz456')).toThrow()
  })
})

// =============================================================================
// Validation Helper Tests (Safe)
// =============================================================================

describe('safeParseThing', () => {
  it('returns success with valid Thing', () => {
    const thing = {
      $id: 'abc123-xyz456',
      $type: 'Customer',
      $createdAt: Date.now(),
      $updatedAt: Date.now()
    }
    const result = safeParseThing(thing)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.$id).toBe(thing.$id)
    }
  })

  it('returns error with invalid Thing', () => {
    const result = safeParseThing({ $type: 'Customer' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeDefined()
    }
  })
})

describe('safeParseThingInput', () => {
  it('returns success with valid input', () => {
    const result = safeParseThingInput({ $type: 'Customer' })
    expect(result.success).toBe(true)
  })

  it('returns error with invalid input', () => {
    const result = safeParseThingInput({})
    expect(result.success).toBe(false)
  })
})

describe('safeParseEvent', () => {
  it('returns success with valid Event', () => {
    const event = {
      $id: 'evt-abc123-xyz456',
      type: 'user.created',
      $timestamp: Date.now(),
      payload: null
    }
    const result = safeParseEvent(event)
    expect(result.success).toBe(true)
  })

  it('returns error with invalid Event', () => {
    const result = safeParseEvent({})
    expect(result.success).toBe(false)
  })
})

describe('safeParseEventInput', () => {
  it('returns success with valid input', () => {
    const result = safeParseEventInput({ type: 'test', payload: null })
    expect(result.success).toBe(true)
  })

  it('returns error with invalid input', () => {
    const result = safeParseEventInput({})
    expect(result.success).toBe(false)
  })
})

describe('safeParseRelationship', () => {
  it('returns success with valid Relationship', () => {
    const rel = {
      subject: 'abc123-xyz456',
      predicate: 'owns',
      object: 'def456-uvw789',
      $createdAt: Date.now()
    }
    const result = safeParseRelationship(rel)
    expect(result.success).toBe(true)
  })

  it('returns error with invalid Relationship', () => {
    const result = safeParseRelationship({})
    expect(result.success).toBe(false)
  })
})

describe('safeParseThingId', () => {
  it('returns success with valid ID', () => {
    const result = safeParseThingId('abc123-xyz456')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('abc123-xyz456')
    }
  })

  it('returns error with invalid ID', () => {
    const result = safeParseThingId('INVALID')
    expect(result.success).toBe(false)
  })
})

describe('safeParseEventId', () => {
  it('returns success with valid ID', () => {
    const result = safeParseEventId('evt-abc123-xyz456')
    expect(result.success).toBe(true)
  })

  it('returns error with invalid ID', () => {
    const result = safeParseEventId('not-an-event-id')
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('formatValidationError', () => {
  it('formats Zod errors', () => {
    const result = ThingSchema.safeParse({ $type: '' })
    if (!result.success) {
      const formatted = formatValidationError(result.error)
      expect(formatted.message).toBe('Validation failed')
      expect(formatted.errors.length).toBeGreaterThan(0)
      expect(formatted.errors[0]?.path).toBeDefined()
      expect(formatted.errors[0]?.message).toBeDefined()
    }
  })
})

describe('isThing', () => {
  it('returns true for valid Thing', () => {
    const thing = {
      $id: 'abc123-xyz456',
      $type: 'Customer',
      $createdAt: Date.now(),
      $updatedAt: Date.now()
    }
    expect(isThing(thing)).toBe(true)
  })

  it('returns false for invalid Thing', () => {
    expect(isThing({ $type: 'Customer' })).toBe(false)
    expect(isThing(null)).toBe(false)
    expect(isThing('string')).toBe(false)
  })
})

describe('isEvent', () => {
  it('returns true for valid Event', () => {
    const event = {
      $id: 'evt-abc123-xyz456',
      type: 'test',
      $timestamp: Date.now(),
      payload: null
    }
    expect(isEvent(event)).toBe(true)
  })

  it('returns false for invalid Event', () => {
    expect(isEvent({ type: 'test' })).toBe(false)
    expect(isEvent(null)).toBe(false)
  })
})

describe('isRelationship', () => {
  it('returns true for valid Relationship', () => {
    const rel = {
      subject: 'abc123-xyz456',
      predicate: 'owns',
      object: 'def456-uvw789',
      $createdAt: Date.now()
    }
    expect(isRelationship(rel)).toBe(true)
  })

  it('returns false for invalid Relationship', () => {
    expect(isRelationship({ subject: 'abc' })).toBe(false)
    expect(isRelationship(null)).toBe(false)
  })
})

// =============================================================================
// BulkUpdateItemSchema Tests
// =============================================================================

describe('BulkUpdateItemSchema', () => {
  it('accepts valid bulk update item', () => {
    const item = { id: 'abc123-xyz456', data: { name: 'Updated' } }
    const result = BulkUpdateItemSchema.safeParse(item)
    expect(result.success).toBe(true)
  })

  it('accepts any non-empty ID for backward compatibility', () => {
    const item = { id: 'simple-id', data: { name: 'Updated' } }
    const result = BulkUpdateItemSchema.safeParse(item)
    expect(result.success).toBe(true)
  })

  it('rejects update data with $id', () => {
    const item = { id: 'abc123-xyz456', data: { $id: 'new-id' } }
    const result = BulkUpdateItemSchema.safeParse(item)
    expect(result.success).toBe(false)
  })

  it('rejects update data with $type', () => {
    const item = { id: 'abc123-xyz456', data: { $type: 'NewType' } }
    const result = BulkUpdateItemSchema.safeParse(item)
    expect(result.success).toBe(false)
  })
})
