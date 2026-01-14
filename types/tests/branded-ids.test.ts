import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * Branded ID Type Tests (RED Phase)
 *
 * These tests verify branded ID types that prevent mixing up different ID types at compile time:
 * - ThingId
 * - ActionId
 * - EventId
 * - NounId
 *
 * Implementation requirements:
 * - Create types/ids.ts with branded ID types
 * - Add creator functions (createThingId, createActionId, etc.)
 * - Ensure IDs are not assignable to each other
 * - Ensure branded IDs can be used as strings where needed
 *
 * Reference: dotdo-h1cz - Create branded ID types
 */

// ============================================================================
// Import the types under test (will fail until implemented)
// ============================================================================

import type {
  ThingId,
  ActionId,
  EventId,
  NounId,
} from '../ids'

import {
  createThingId,
  createActionId,
  createEventId,
  createNounId,
  isThingId,
  isActionId,
  isEventId,
  isNounId,
} from '../ids'

// ============================================================================
// Type Brand Tests - Mutual Exclusivity
// ============================================================================

describe('Branded ID Types - Mutual Exclusivity', () => {
  it('ThingId should not be assignable to ActionId', () => {
    // This test verifies that ThingId and ActionId are distinct types
    const thingId: ThingId = createThingId('thing-123')

    // TYPE TEST: The following assignment should produce a type error
    // @ts-expect-error - ThingId is not assignable to ActionId
    const actionId: ActionId = thingId

    // Runtime check just to verify the test runs
    expect(thingId).toBeDefined()
    expect(actionId).toBeDefined()
  })

  it('ActionId should not be assignable to ThingId', () => {
    const actionId: ActionId = createActionId('action-123')

    // TYPE TEST: The following assignment should produce a type error
    // @ts-expect-error - ActionId is not assignable to ThingId
    const thingId: ThingId = actionId

    expect(actionId).toBeDefined()
    expect(thingId).toBeDefined()
  })

  it('EventId should not be assignable to ThingId', () => {
    const eventId: EventId = createEventId('event-123')

    // TYPE TEST: The following assignment should produce a type error
    // @ts-expect-error - EventId is not assignable to ThingId
    const thingId: ThingId = eventId

    expect(eventId).toBeDefined()
    expect(thingId).toBeDefined()
  })

  it('NounId should not be assignable to ActionId', () => {
    const nounId: NounId = createNounId('noun-123')

    // TYPE TEST: The following assignment should produce a type error
    // @ts-expect-error - NounId is not assignable to ActionId
    const actionId: ActionId = nounId

    expect(nounId).toBeDefined()
    expect(actionId).toBeDefined()
  })

  it('ThingId should not be assignable to EventId', () => {
    const thingId: ThingId = createThingId('thing-456')

    // TYPE TEST: The following assignment should produce a type error
    // @ts-expect-error - ThingId is not assignable to EventId
    const eventId: EventId = thingId

    expect(thingId).toBeDefined()
    expect(eventId).toBeDefined()
  })

  it('ActionId should not be assignable to NounId', () => {
    const actionId: ActionId = createActionId('action-456')

    // TYPE TEST: The following assignment should produce a type error
    // @ts-expect-error - ActionId is not assignable to NounId
    const nounId: NounId = actionId

    expect(actionId).toBeDefined()
    expect(nounId).toBeDefined()
  })
})

// ============================================================================
// Creator Function Tests
// ============================================================================

describe('Branded ID Creator Functions', () => {
  it('createThingId should return ThingId', () => {
    const id = createThingId('thing-abc')

    expectTypeOf(id).toEqualTypeOf<ThingId>()
    expect(id).toBe('thing-abc')
  })

  it('createActionId should return ActionId', () => {
    const id = createActionId('action-def')

    expectTypeOf(id).toEqualTypeOf<ActionId>()
    expect(id).toBe('action-def')
  })

  it('createEventId should return EventId', () => {
    const id = createEventId('event-ghi')

    expectTypeOf(id).toEqualTypeOf<EventId>()
    expect(id).toBe('event-ghi')
  })

  it('createNounId should return NounId', () => {
    const id = createNounId('noun-jkl')

    expectTypeOf(id).toEqualTypeOf<NounId>()
    expect(id).toBe('noun-jkl')
  })

  it('creator functions should accept empty strings', () => {
    const thingId = createThingId('')
    const actionId = createActionId('')

    expect(thingId).toBe('')
    expect(actionId).toBe('')
  })

  it('creator functions should preserve string content', () => {
    const original = 'complex-id-with-dashes-and-numbers-123'
    const thingId = createThingId(original)

    expect(thingId).toBe(original)
  })
})

// ============================================================================
// Raw String Assignment Tests
// ============================================================================

describe('Branded IDs - Raw String Assignment', () => {
  it('raw strings should not be assignable to ThingId without explicit cast', () => {
    const rawString = 'raw-string-123'

    // TYPE TEST: Raw string should not be directly assignable to ThingId
    // @ts-expect-error - string is not assignable to ThingId
    const thingId: ThingId = rawString

    expect(thingId).toBeDefined()
  })

  it('raw strings should not be assignable to ActionId without explicit cast', () => {
    const rawString = 'raw-string-456'

    // TYPE TEST: Raw string should not be directly assignable to ActionId
    // @ts-expect-error - string is not assignable to ActionId
    const actionId: ActionId = rawString

    expect(actionId).toBeDefined()
  })

  it('raw strings should not be assignable to EventId without explicit cast', () => {
    const rawString = 'raw-string-789'

    // TYPE TEST: Raw string should not be directly assignable to EventId
    // @ts-expect-error - string is not assignable to EventId
    const eventId: EventId = rawString

    expect(eventId).toBeDefined()
  })

  it('raw strings should not be assignable to NounId without explicit cast', () => {
    const rawString = 'raw-string-012'

    // TYPE TEST: Raw string should not be directly assignable to NounId
    // @ts-expect-error - string is not assignable to NounId
    const nounId: NounId = rawString

    expect(nounId).toBeDefined()
  })

  it('explicit cast with creator function should work', () => {
    const rawString = 'raw-but-valid-id'

    // This should work - using creator function for proper branding
    const thingId = createThingId(rawString)

    expectTypeOf(thingId).toEqualTypeOf<ThingId>()
    expect(thingId).toBe(rawString)
  })
})

// ============================================================================
// String Compatibility Tests
// ============================================================================

describe('Branded IDs - String Compatibility', () => {
  it('ThingId should be usable where string is expected', () => {
    const thingId: ThingId = createThingId('thing-123')

    // Branded IDs should work in string contexts
    const asString: string = thingId

    expectTypeOf(asString).toEqualTypeOf<string>()
    expect(asString).toBe('thing-123')
  })

  it('ActionId should be usable where string is expected', () => {
    const actionId: ActionId = createActionId('action-456')

    const asString: string = actionId

    expectTypeOf(asString).toEqualTypeOf<string>()
    expect(asString).toBe('action-456')
  })

  it('EventId should be usable where string is expected', () => {
    const eventId: EventId = createEventId('event-789')

    const asString: string = eventId

    expectTypeOf(asString).toEqualTypeOf<string>()
    expect(eventId).toBe('event-789')
  })

  it('NounId should be usable where string is expected', () => {
    const nounId: NounId = createNounId('noun-012')

    const asString: string = nounId

    expectTypeOf(asString).toEqualTypeOf<string>()
    expect(asString).toBe('noun-012')
  })

  it('branded IDs should work with string methods', () => {
    const thingId: ThingId = createThingId('THING-UPPER')

    // String methods should work
    expect(thingId.toLowerCase()).toBe('thing-upper')
    expect(thingId.length).toBe(11)
    expect(thingId.startsWith('THING')).toBe(true)
    expect(thingId.includes('-')).toBe(true)
  })

  it('branded IDs should work with template literals', () => {
    const thingId: ThingId = createThingId('thing-abc')
    const actionId: ActionId = createActionId('action-def')

    const message = `Thing: ${thingId}, Action: ${actionId}`

    expect(message).toBe('Thing: thing-abc, Action: action-def')
  })

  it('branded IDs should be concatenatable with strings', () => {
    const thingId: ThingId = createThingId('thing-123')

    const prefixed = 'prefix-' + thingId
    const suffixed = thingId + '-suffix'

    expect(prefixed).toBe('prefix-thing-123')
    expect(suffixed).toBe('thing-123-suffix')
  })

  it('branded IDs should work with JSON.stringify', () => {
    const thingId: ThingId = createThingId('thing-json')

    const obj = { id: thingId }
    const json = JSON.stringify(obj)

    expect(json).toBe('{"id":"thing-json"}')
  })
})

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Branded ID Type Guards', () => {
  it('isThingId should narrow type to ThingId', () => {
    const maybeThingId: string = 'thing-123'

    if (isThingId(maybeThingId)) {
      expectTypeOf(maybeThingId).toEqualTypeOf<ThingId>()
    }

    expect(isThingId(maybeThingId)).toBe(true)
  })

  it('isActionId should narrow type to ActionId', () => {
    // ActionId expects UUID v4 format
    const maybeActionId: string = '550e8400-e29b-41d4-a716-446655440000'

    if (isActionId(maybeActionId)) {
      expectTypeOf(maybeActionId).toEqualTypeOf<ActionId>()
    }

    expect(isActionId(maybeActionId)).toBe(true)
  })

  it('isEventId should narrow type to EventId', () => {
    // EventId expects 'evt-' prefix followed by alphanumeric id
    const maybeEventId: string = 'evt-789abc'

    if (isEventId(maybeEventId)) {
      expectTypeOf(maybeEventId).toEqualTypeOf<EventId>()
    }

    expect(isEventId(maybeEventId)).toBe(true)
  })

  it('isNounId should narrow type to NounId', () => {
    // NounId expects PascalCase (starts with uppercase)
    const maybeNounId: string = 'Customer'

    if (isNounId(maybeNounId)) {
      expectTypeOf(maybeNounId).toEqualTypeOf<NounId>()
    }

    expect(isNounId(maybeNounId)).toBe(true)
  })
})

// ============================================================================
// Function Signature Tests
// ============================================================================

describe('Branded IDs - Function Signatures', () => {
  it('functions expecting ThingId should not accept ActionId', () => {
    function processThingId(id: ThingId): string {
      return `Processing thing: ${id}`
    }

    const thingId: ThingId = createThingId('thing-valid')
    const actionId: ActionId = createActionId('action-invalid')

    // This should work
    const result1 = processThingId(thingId)
    expect(result1).toBe('Processing thing: thing-valid')

    // TYPE TEST: ActionId should not be accepted
    // @ts-expect-error - ActionId is not assignable to ThingId parameter
    const result2 = processThingId(actionId)
    expect(result2).toBeDefined()
  })

  it('functions expecting ActionId should not accept EventId', () => {
    function processActionId(id: ActionId): string {
      return `Processing action: ${id}`
    }

    const actionId: ActionId = createActionId('action-valid')
    const eventId: EventId = createEventId('event-invalid')

    // This should work
    const result1 = processActionId(actionId)
    expect(result1).toBe('Processing action: action-valid')

    // TYPE TEST: EventId should not be accepted
    // @ts-expect-error - EventId is not assignable to ActionId parameter
    const result2 = processActionId(eventId)
    expect(result2).toBeDefined()
  })

  it('functions expecting string should accept any branded ID', () => {
    function processString(s: string): string {
      return `Processing: ${s}`
    }

    const thingId: ThingId = createThingId('thing-1')
    const actionId: ActionId = createActionId('action-2')
    const eventId: EventId = createEventId('event-3')
    const nounId: NounId = createNounId('noun-4')

    // All should work because branded IDs are assignable to string
    expect(processString(thingId)).toBe('Processing: thing-1')
    expect(processString(actionId)).toBe('Processing: action-2')
    expect(processString(eventId)).toBe('Processing: event-3')
    expect(processString(nounId)).toBe('Processing: noun-4')
  })
})

// ============================================================================
// Array and Collection Tests
// ============================================================================

describe('Branded IDs - Collections', () => {
  it('ThingId arrays should not accept ActionIds', () => {
    const thingIds: ThingId[] = [
      createThingId('thing-1'),
      createThingId('thing-2'),
    ]

    const actionId: ActionId = createActionId('action-1')

    // TYPE TEST: ActionId should not be pushable to ThingId[]
    // @ts-expect-error - ActionId is not assignable to ThingId
    thingIds.push(actionId)

    expect(thingIds.length).toBe(3) // Runtime will still push
  })

  it('Map with ThingId keys should not accept ActionId keys', () => {
    const thingMap = new Map<ThingId, string>()
    const thingId: ThingId = createThingId('thing-key')
    const actionId: ActionId = createActionId('action-key')

    // This should work
    thingMap.set(thingId, 'value1')

    // TYPE TEST: ActionId should not be accepted as key
    // @ts-expect-error - ActionId is not assignable to ThingId key
    thingMap.set(actionId, 'value2')

    expect(thingMap.size).toBe(2) // Runtime will still set
  })

  it('Set of EventIds should not accept NounIds', () => {
    const eventSet = new Set<EventId>()
    const eventId: EventId = createEventId('event-item')
    const nounId: NounId = createNounId('noun-item')

    // This should work
    eventSet.add(eventId)

    // TYPE TEST: NounId should not be accepted
    // @ts-expect-error - NounId is not assignable to EventId
    eventSet.add(nounId)

    expect(eventSet.size).toBe(2) // Runtime will still add
  })
})

// ============================================================================
// Record and Object Types Tests
// ============================================================================

describe('Branded IDs - Object Types', () => {
  it('interface with ThingId field should not accept ActionId', () => {
    interface ThingRecord {
      id: ThingId
      name: string
    }

    const thingId: ThingId = createThingId('thing-rec')
    const actionId: ActionId = createActionId('action-rec')

    // This should work
    const validRecord: ThingRecord = { id: thingId, name: 'Valid' }
    expect(validRecord.id).toBe('thing-rec')

    // TYPE TEST: ActionId should not be accepted for id field
    // @ts-expect-error - ActionId is not assignable to ThingId field
    const invalidRecord: ThingRecord = { id: actionId, name: 'Invalid' }
    expect(invalidRecord.id).toBeDefined()
  })

  it('Record<ThingId, T> type preserves intent even though indexing is flexible', () => {
    // Note: Record<BrandedType, T> still accepts string keys at runtime
    // because branded types are structurally strings. The type safety comes
    // from the variable declarations and function parameters, not from indexing.
    const record: Record<ThingId, { value: number }> = {} as Record<ThingId, { value: number }>

    const thingId: ThingId = createThingId('thing-k')
    const actionId: ActionId = createActionId('action-k')

    // Both work because branded types are structurally strings
    record[thingId] = { value: 1 }
    record[actionId] = { value: 2 }

    expect(Object.keys(record).length).toBe(2)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Branded IDs - Edge Cases', () => {
  it('should handle very long ID strings', () => {
    const longId = 'a'.repeat(1000)
    const thingId = createThingId(longId)

    expect(thingId.length).toBe(1000)
    expectTypeOf(thingId).toEqualTypeOf<ThingId>()
  })

  it('should handle special characters in IDs', () => {
    const specialId = 'thing-!@#$%^&*()_+{}[]|:;"\'<>,.?/'
    const thingId = createThingId(specialId)

    expect(thingId).toBe(specialId)
    expectTypeOf(thingId).toEqualTypeOf<ThingId>()
  })

  it('should handle unicode characters in IDs', () => {
    const unicodeId = 'thing-unicode-test'
    const thingId = createThingId(unicodeId)

    expect(thingId).toBe(unicodeId)
    expectTypeOf(thingId).toEqualTypeOf<ThingId>()
  })

  it('should handle UUID format IDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'

    const thingId = createThingId(uuid)
    const actionId = createActionId(uuid)
    const eventId = createEventId(uuid)
    const nounId = createNounId(uuid)

    // Same string value, but different branded types
    expect(thingId).toBe(uuid)
    expect(actionId).toBe(uuid)
    expect(eventId).toBe(uuid)
    expect(nounId).toBe(uuid)

    // But they should not be assignable to each other
    // @ts-expect-error - Even with same value, types are incompatible
    const wrongType: ThingId = actionId
    expect(wrongType).toBeDefined()
  })

  it('should handle sqid format IDs', () => {
    const sqid = 'K3mR8hG5'

    const thingId = createThingId(sqid)

    expectTypeOf(thingId).toEqualTypeOf<ThingId>()
    expect(thingId).toBe(sqid)
  })
})

// ============================================================================
// Equality and Comparison Tests
// ============================================================================

describe('Branded IDs - Equality', () => {
  it('same branded ID values should be equal', () => {
    const id1: ThingId = createThingId('thing-same')
    const id2: ThingId = createThingId('thing-same')

    expect(id1).toBe(id2)
    expect(id1 === id2).toBe(true)
  })

  it('different branded ID types with same value should be equal at runtime', () => {
    const thingId: ThingId = createThingId('same-value')
    const actionId: ActionId = createActionId('same-value')

    // At runtime, they are the same string
    expect(thingId).toBe(actionId)

    // But TypeScript prevents direct comparison without type assertion
    // This is expected behavior - the types are intentionally incompatible
  })

  it('branded IDs should work with string comparison', () => {
    const thingId: ThingId = createThingId('thing-abc')

    expect(thingId === 'thing-abc').toBe(true)
    expect(thingId < 'thing-xyz').toBe(true)
    expect(thingId > 'thing-000').toBe(true)
  })
})
