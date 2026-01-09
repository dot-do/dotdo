import { describe, it, expect } from 'vitest'

/**
 * Sqids Tagged Field Convention Tests
 *
 * These tests verify the sqids utility for encoding/decoding tagged fields.
 * They are expected to FAIL until lib/sqids.ts is implemented.
 *
 * Implementation requirements:
 * - Create lib/sqids.ts with Tag enum, encode(), decode()
 * - Tags are small numbers for efficient encoding
 * - encode() accepts [tag, value, ...] pairs and returns a sqid string
 * - decode() returns a Record<TagName, number> for self-describing output
 *
 * Reference: docs/concepts/sqids.mdx
 */

// Import the module under test (will fail until implemented)
import { sqids, Tag } from '../../lib/sqids'

// ============================================================================
// Tag Enum Definition
// ============================================================================

describe('Tag enum definition', () => {
  describe('Core reference tags (1-10)', () => {
    it('exports NS tag with value 1', () => {
      expect(Tag.NS).toBe(1)
    })

    it('exports TYPE tag with value 2', () => {
      expect(Tag.TYPE).toBe(2)
    })

    it('exports THING tag with value 3', () => {
      expect(Tag.THING).toBe(3)
    })

    it('exports BRANCH tag with value 4', () => {
      expect(Tag.BRANCH).toBe(4)
    })

    it('exports VERSION tag with value 5', () => {
      expect(Tag.VERSION).toBe(5)
    })
  })

  describe('5W+H tags (11-20)', () => {
    it('exports ACTOR tag with value 11', () => {
      expect(Tag.ACTOR).toBe(11)
    })

    it('exports VERB tag with value 12', () => {
      expect(Tag.VERB).toBe(12)
    })

    it('exports TIMESTAMP tag with value 13', () => {
      expect(Tag.TIMESTAMP).toBe(13)
    })

    it('exports LOCATION tag with value 14', () => {
      expect(Tag.LOCATION).toBe(14)
    })
  })

  describe('HOW detail tags (21-30)', () => {
    it('exports METHOD tag with value 21', () => {
      expect(Tag.METHOD).toBe(21)
    })

    it('exports MODEL tag with value 22', () => {
      expect(Tag.MODEL).toBe(22)
    })

    it('exports CHANNEL tag with value 23', () => {
      expect(Tag.CHANNEL).toBe(23)
    })

    it('exports TOOL tag with value 24', () => {
      expect(Tag.TOOL).toBe(24)
    })
  })

  describe('Experiment tags (31-40)', () => {
    it('exports EXPERIMENT tag with value 31', () => {
      expect(Tag.EXPERIMENT).toBe(31)
    })

    it('exports VARIANT tag with value 32', () => {
      expect(Tag.VARIANT).toBe(32)
    })

    it('exports METRIC tag with value 33', () => {
      expect(Tag.METRIC).toBe(33)
    })
  })
})

// ============================================================================
// Encode Function
// ============================================================================

describe('sqids.encode()', () => {
  it('exports encode function', () => {
    expect(typeof sqids.encode).toBe('function')
  })

  describe('minimal thing reference', () => {
    it('encodes single tag-value pair', () => {
      const result = sqids.encode([Tag.THING, 42])

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('returns URL-safe string', () => {
      const result = sqids.encode([Tag.THING, 42])

      // URL-safe characters only (alphanumeric)
      expect(result).toMatch(/^[a-zA-Z0-9]+$/)
    })
  })

  describe('multiple tag-value pairs', () => {
    it('encodes THING with BRANCH', () => {
      const result = sqids.encode([Tag.THING, 42, Tag.BRANCH, 7])

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('encodes full 5W+H event reference', () => {
      const result = sqids.encode([
        Tag.ACTOR, 10,
        Tag.VERB, 5,
        Tag.THING, 42,
        Tag.METHOD, 2,
        Tag.TIMESTAMP, 1705312200
      ])

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('encodes experiment exposure reference', () => {
      const result = sqids.encode([
        Tag.EXPERIMENT, 100,
        Tag.VARIANT, 1,
        Tag.ACTOR, 500,
        Tag.TIMESTAMP, Date.now()
      ])

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('order independence', () => {
    it('produces different outputs for different tag orders (canonical encoding)', () => {
      const a = sqids.encode([Tag.THING, 42, Tag.BRANCH, 7])
      const b = sqids.encode([Tag.BRANCH, 7, Tag.THING, 42])

      // Encoded sqids preserve order, so different orders produce different outputs
      // This allows canonical encoding where order matters
      expect(a).not.toBe(b)
    })
  })

  describe('edge cases', () => {
    it('encodes zero values', () => {
      const result = sqids.encode([Tag.THING, 0])

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('encodes large numbers', () => {
      const result = sqids.encode([Tag.TIMESTAMP, Number.MAX_SAFE_INTEGER])

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('encodes many tag-value pairs', () => {
      const result = sqids.encode([
        Tag.NS, 1,
        Tag.TYPE, 2,
        Tag.THING, 3,
        Tag.BRANCH, 4,
        Tag.VERSION, 5,
        Tag.ACTOR, 6,
        Tag.VERB, 7,
        Tag.TIMESTAMP, 8
      ])

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('throws for empty array', () => {
      expect(() => sqids.encode([])).toThrow()
    })

    it('throws for odd number of elements (unpaired)', () => {
      expect(() => sqids.encode([Tag.THING])).toThrow()
      expect(() => sqids.encode([Tag.THING, 42, Tag.BRANCH])).toThrow()
    })
  })
})

// ============================================================================
// Decode Function
// ============================================================================

describe('sqids.decode()', () => {
  it('exports decode function', () => {
    expect(typeof sqids.decode).toBe('function')
  })

  describe('self-describing output', () => {
    it('decodes to object with tag names as keys', () => {
      const encoded = sqids.encode([Tag.THING, 42, Tag.BRANCH, 7])
      const decoded = sqids.decode(encoded)

      expect(decoded).toHaveProperty('THING')
      expect(decoded).toHaveProperty('BRANCH')
    })

    it('decodes minimal thing reference', () => {
      const encoded = sqids.encode([Tag.THING, 42])
      const decoded = sqids.decode(encoded)

      expect(decoded).toEqual({ THING: 42 })
    })

    it('decodes thing with branch', () => {
      const encoded = sqids.encode([Tag.THING, 42, Tag.BRANCH, 7])
      const decoded = sqids.decode(encoded)

      expect(decoded).toEqual({ THING: 42, BRANCH: 7 })
    })

    it('decodes full 5W+H event reference', () => {
      const encoded = sqids.encode([
        Tag.ACTOR, 10,
        Tag.VERB, 5,
        Tag.THING, 42,
        Tag.METHOD, 2,
        Tag.TIMESTAMP, 1705312200
      ])
      const decoded = sqids.decode(encoded)

      expect(decoded).toEqual({
        ACTOR: 10,
        VERB: 5,
        THING: 42,
        METHOD: 2,
        TIMESTAMP: 1705312200
      })
    })
  })

  describe('edge cases', () => {
    it('decodes zero values correctly', () => {
      const encoded = sqids.encode([Tag.THING, 0])
      const decoded = sqids.decode(encoded)

      expect(decoded).toEqual({ THING: 0 })
    })

    it('decodes large numbers correctly', () => {
      const largeNum = Number.MAX_SAFE_INTEGER
      const encoded = sqids.encode([Tag.TIMESTAMP, largeNum])
      const decoded = sqids.decode(encoded)

      expect(decoded).toEqual({ TIMESTAMP: largeNum })
    })

    it('returns empty object for invalid sqid', () => {
      const decoded = sqids.decode('invalid-sqid-that-does-not-exist')

      expect(decoded).toEqual({})
    })

    it('handles empty string', () => {
      const decoded = sqids.decode('')

      expect(decoded).toEqual({})
    })
  })
})

// ============================================================================
// Encode/Decode Roundtrips
// ============================================================================

describe('encode/decode roundtrip', () => {
  it('roundtrips minimal thing reference', () => {
    const original = [Tag.THING, 42] as const
    const encoded = sqids.encode([...original])
    const decoded = sqids.decode(encoded)

    expect(decoded).toEqual({ THING: 42 })
  })

  it('roundtrips thing with branch', () => {
    const original = [Tag.THING, 42, Tag.BRANCH, 7] as const
    const encoded = sqids.encode([...original])
    const decoded = sqids.decode(encoded)

    expect(decoded).toEqual({ THING: 42, BRANCH: 7 })
  })

  it('roundtrips full 5W+H event', () => {
    const original = [
      Tag.ACTOR, 10,
      Tag.VERB, 5,
      Tag.THING, 42,
      Tag.METHOD, 2,
      Tag.TIMESTAMP, 1705312200
    ] as const
    const encoded = sqids.encode([...original])
    const decoded = sqids.decode(encoded)

    expect(decoded).toEqual({
      ACTOR: 10,
      VERB: 5,
      THING: 42,
      METHOD: 2,
      TIMESTAMP: 1705312200
    })
  })

  it('roundtrips experiment exposure', () => {
    const timestamp = Date.now()
    const original = [
      Tag.EXPERIMENT, 100,
      Tag.VARIANT, 1,
      Tag.ACTOR, 500,
      Tag.TIMESTAMP, timestamp
    ] as const
    const encoded = sqids.encode([...original])
    const decoded = sqids.decode(encoded)

    expect(decoded).toEqual({
      EXPERIMENT: 100,
      VARIANT: 1,
      ACTOR: 500,
      TIMESTAMP: timestamp
    })
  })

  it('roundtrips all core reference tags', () => {
    const original = [
      Tag.NS, 1,
      Tag.TYPE, 2,
      Tag.THING, 3,
      Tag.BRANCH, 4,
      Tag.VERSION, 5
    ] as const
    const encoded = sqids.encode([...original])
    const decoded = sqids.decode(encoded)

    expect(decoded).toEqual({
      NS: 1,
      TYPE: 2,
      THING: 3,
      BRANCH: 4,
      VERSION: 5
    })
  })

  it('roundtrips all 5W+H tags', () => {
    const original = [
      Tag.ACTOR, 100,
      Tag.VERB, 200,
      Tag.TIMESTAMP, 300,
      Tag.LOCATION, 400
    ] as const
    const encoded = sqids.encode([...original])
    const decoded = sqids.decode(encoded)

    expect(decoded).toEqual({
      ACTOR: 100,
      VERB: 200,
      TIMESTAMP: 300,
      LOCATION: 400
    })
  })

  it('roundtrips all HOW detail tags', () => {
    const original = [
      Tag.METHOD, 1,
      Tag.MODEL, 2,
      Tag.CHANNEL, 3,
      Tag.TOOL, 4
    ] as const
    const encoded = sqids.encode([...original])
    const decoded = sqids.decode(encoded)

    expect(decoded).toEqual({
      METHOD: 1,
      MODEL: 2,
      CHANNEL: 3,
      TOOL: 4
    })
  })

  it('roundtrips all experiment tags', () => {
    const original = [
      Tag.EXPERIMENT, 10,
      Tag.VARIANT, 20,
      Tag.METRIC, 30
    ] as const
    const encoded = sqids.encode([...original])
    const decoded = sqids.decode(encoded)

    expect(decoded).toEqual({
      EXPERIMENT: 10,
      VARIANT: 20,
      METRIC: 30
    })
  })
})

// ============================================================================
// Determinism
// ============================================================================

describe('determinism', () => {
  it('same input always produces same output', () => {
    const input = [Tag.THING, 42, Tag.BRANCH, 7]

    const result1 = sqids.encode(input)
    const result2 = sqids.encode(input)
    const result3 = sqids.encode(input)

    expect(result1).toBe(result2)
    expect(result2).toBe(result3)
  })

  it('different inputs produce different outputs', () => {
    const result1 = sqids.encode([Tag.THING, 1])
    const result2 = sqids.encode([Tag.THING, 2])
    const result3 = sqids.encode([Tag.THING, 3])

    expect(result1).not.toBe(result2)
    expect(result2).not.toBe(result3)
    expect(result1).not.toBe(result3)
  })
})

// ============================================================================
// Compactness
// ============================================================================

describe('compactness', () => {
  it('produces short strings for small numbers', () => {
    const result = sqids.encode([Tag.THING, 1])

    // Should be reasonably short for small values
    expect(result.length).toBeLessThan(10)
  })

  it('produces proportionally longer strings for large numbers', () => {
    const small = sqids.encode([Tag.THING, 1])
    const large = sqids.encode([Tag.TIMESTAMP, Number.MAX_SAFE_INTEGER])

    expect(large.length).toBeGreaterThan(small.length)
  })

  it('multiple fields are still compact', () => {
    const result = sqids.encode([Tag.THING, 42, Tag.BRANCH, 7])

    // Should be reasonably compact even with multiple fields
    expect(result.length).toBeLessThan(20)
  })
})

// ============================================================================
// Type Safety (compile-time verification)
// ============================================================================

describe('type safety', () => {
  it('encode accepts number array', () => {
    // TypeScript compile-time check - encode accepts number[]
    const values: number[] = [Tag.THING, 42]
    const result = sqids.encode(values)

    expect(typeof result).toBe('string')
  })

  it('decode returns Record<string, number>', () => {
    const encoded = sqids.encode([Tag.THING, 42])
    const decoded = sqids.decode(encoded)

    // Should be able to access any key and get a number
    expect(typeof decoded.THING).toBe('number')
  })
})
