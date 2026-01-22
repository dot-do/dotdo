/**
 * Property-Based Testing with fast-check - do-7kenx
 *
 * Demonstrates property-based testing patterns for @dotdo/db
 * using the fast-check library. Property-based tests verify that
 * code behaves correctly for all possible inputs, not just specific
 * example-based test cases.
 *
 * @module db/tests/property-based.test
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { generateId, generateEventId } from '../id'
import {
  isThingId,
  isEventId,
  isRelationshipId,
  isTenantId,
  createRelationshipId,
} from '../branded-types'

// ============================================================================
// ID GENERATION PROPERTIES
// ============================================================================

describe('Property-Based: ID Generation', () => {
  describe('generateId properties', () => {
    it('should always produce valid ThingIds', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const id = generateId()
          expect(isThingId(id)).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    it('should always produce unique IDs across runs', () => {
      fc.assert(
        fc.property(fc.integer({ min: 10, max: 100 }), (count) => {
          const ids = new Set<string>()
          for (let i = 0; i < count; i++) {
            ids.add(generateId())
          }
          expect(ids.size).toBe(count)
        }),
        { numRuns: 20 }
      )
    })

    it('should always produce lowercase URL-safe IDs', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const id = generateId()
          // Only lowercase alphanumeric and hyphens
          expect(id).toMatch(/^[a-z0-9-]+$/)
          // Should not need URL encoding
          expect(encodeURIComponent(id)).toBe(id)
        }),
        { numRuns: 100 }
      )
    })

    it('should produce IDs with consistent structure', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const id = generateId()
          const parts = id.split('-')

          // Format: {timestamp-base36}-{random-12-chars}
          expect(parts.length).toBe(2)
          expect(parts[0].length).toBeGreaterThan(0)
          expect(parts[1].length).toBe(12)
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('generateEventId properties', () => {
    it('should always produce valid EventIds', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const id = generateEventId()
          expect(isEventId(id)).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    it('should always start with evt- prefix', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const id = generateEventId()
          expect(id.startsWith('evt-')).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    it('should never be mistaken for ThingId', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const eventId = generateEventId()
          expect(isThingId(eventId)).toBe(false)
        }),
        { numRuns: 100 }
      )
    })
  })
})

// ============================================================================
// ID VALIDATION PROPERTIES
// ============================================================================

// Custom arbitrary for base36 strings (lowercase alphanumeric)
const base36Char = fc.constantFrom(...'0123456789abcdefghijklmnopqrstuvwxyz'.split(''))

function base36String(minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc.array(base36Char, { minLength, maxLength }).map((chars) => chars.join(''))
}

describe('Property-Based: ID Validation', () => {
  describe('isThingId validation', () => {
    // Arbitrary for valid ThingId-like strings
    const validThingIdArb = fc
      .tuple(base36String(1, 12), base36String(1, 12))
      .map(([a, b]) => `${a}-${b}`)

    it('should accept all validly formatted ThingIds', () => {
      fc.assert(
        fc.property(validThingIdArb, (id) => {
          expect(isThingId(id)).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    it('should reject strings with uppercase characters', () => {
      const uppercaseChar = fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
      const uppercaseString = fc.array(uppercaseChar, { minLength: 1, maxLength: 10 }).map((c) => c.join(''))

      fc.assert(
        fc.property(uppercaseString, (uppercase) => {
          expect(isThingId(uppercase)).toBe(false)
        }),
        { numRuns: 50 }
      )
    })

    it('should reject empty strings', () => {
      expect(isThingId('')).toBe(false)
    })

    it('should reject strings with special characters', () => {
      const specialChar = fc.constantFrom(...'!@#$%^&*()+=[]{}|;:\'",.<>?/\\`~'.split(''))
      const specialString = fc.array(specialChar, { minLength: 1, maxLength: 10 }).map((c) => c.join(''))

      fc.assert(
        fc.property(specialString, (special) => {
          expect(isThingId(special)).toBe(false)
        }),
        { numRuns: 50 }
      )
    })
  })

  describe('isEventId validation', () => {
    // Arbitrary for valid EventId-like strings
    const validEventIdArb = fc
      .tuple(base36String(1, 10), base36String(1, 8))
      .map(([ts, rand]) => `evt-${ts}-${rand}`)

    it('should accept all validly formatted EventIds', () => {
      fc.assert(
        fc.property(validEventIdArb, (id) => {
          expect(isEventId(id)).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    it('should reject non-prefixed IDs', () => {
      const idWithoutPrefix = base36String(5, 20)

      fc.assert(
        fc.property(idWithoutPrefix, (id) => {
          // IDs without evt- prefix should not be valid EventIds
          // (unless they accidentally match the pattern, which is very unlikely)
          if (!id.startsWith('evt-')) {
            expect(isEventId(id)).toBe(false)
          }
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('isTenantId validation', () => {
    // Arbitrary for valid TenantIds (hostname-like)
    const validTenantIdArb = base36String(1, 63)

    it('should accept alphanumeric tenant IDs', () => {
      fc.assert(
        fc.property(validTenantIdArb, (id) => {
          expect(isTenantId(id)).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    it('should accept tenant IDs with internal hyphens', () => {
      fc.assert(
        fc.property(fc.tuple(base36String(1, 10), base36String(1, 10)), ([a, b]) => {
          const id = `${a}-${b}`
          expect(isTenantId(id)).toBe(true)
        }),
        { numRuns: 50 }
      )
    })

    it('should reject empty tenant IDs', () => {
      expect(isTenantId('')).toBe(false)
    })
  })

  describe('isRelationshipId validation', () => {
    // Arbitrary for valid RelationshipIds (strings without colons)
    const nonColonString = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => !s.includes(':'))

    const validRelationshipIdArb = fc
      .tuple(nonColonString, nonColonString, nonColonString)
      .map(([s, p, o]) => `${s}:${p}:${o}`)

    it('should accept validly formatted RelationshipIds', () => {
      fc.assert(
        fc.property(validRelationshipIdArb, (id) => {
          expect(isRelationshipId(id)).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    it('createRelationshipId should always produce valid RelationshipIds', () => {
      fc.assert(
        fc.property(
          fc.tuple(nonColonString, nonColonString, nonColonString),
          ([subject, predicate, object]) => {
            const id = createRelationshipId(subject, predicate, object)
            expect(isRelationshipId(id)).toBe(true)
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})

// ============================================================================
// ROUNDTRIP PROPERTIES
// ============================================================================

describe('Property-Based: Roundtrip Properties', () => {
  it('generated ThingIds should always pass isThingId check', () => {
    // This is a key invariant: generator and validator must agree
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (count) => {
        for (let i = 0; i < count; i++) {
          const id = generateId()
          if (!isThingId(id)) {
            throw new Error(`Generated ThingId '${id}' failed isThingId check`)
          }
        }
        return true
      }),
      { numRuns: 20 }
    )
  })

  it('generated EventIds should always pass isEventId check', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (count) => {
        for (let i = 0; i < count; i++) {
          const id = generateEventId()
          if (!isEventId(id)) {
            throw new Error(`Generated EventId '${id}' failed isEventId check`)
          }
        }
        return true
      }),
      { numRuns: 20 }
    )
  })

  it('ThingIds and EventIds should never overlap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 100 }), (count) => {
        const thingIds: string[] = []
        const eventIds: string[] = []

        for (let i = 0; i < count; i++) {
          thingIds.push(generateId())
          eventIds.push(generateEventId())
        }

        // No ThingId should pass EventId check
        for (const tid of thingIds) {
          if (isEventId(tid)) {
            throw new Error(`ThingId '${tid}' incorrectly passed isEventId check`)
          }
        }

        // No EventId should pass ThingId check
        for (const eid of eventIds) {
          if (isThingId(eid)) {
            throw new Error(`EventId '${eid}' incorrectly passed isThingId check`)
          }
        }

        return true
      }),
      { numRuns: 20 }
    )
  })
})
