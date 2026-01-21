/**
 * ID Generation Utilities Tests - do-bsno.10
 *
 * Tests for @dotdo/db id.ts module
 * Covers ID generation, format validation, uniqueness, and type safety
 *
 * @module db/tests/id.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateId, generateEventId } from '../id'
import { isThingId, isEventId, type ThingId, type EventId } from '../branded-types'

// ============================================================================
// generateId() TESTS
// ============================================================================

describe('generateId', () => {
  describe('format', () => {
    it('should generate ID in format: {timestamp-base36}-{random-12-chars}', () => {
      const id = generateId()
      const parts = id.split('-')

      expect(parts.length).toBe(2)
      // Timestamp part should be alphanumeric (base36)
      expect(parts[0]).toMatch(/^[a-z0-9]+$/)
      // Random part should be exactly 12 characters (improved collision resistance do-1knp.5)
      expect(parts[1]).toMatch(/^[a-z0-9]{12}$/)
    })

    it('should generate valid ThingId that passes isThingId check', () => {
      for (let i = 0; i < 10; i++) {
        const id = generateId()
        expect(isThingId(id)).toBe(true)
      }
    })

    it('should return a branded ThingId type', () => {
      const id = generateId()
      // TypeScript compile-time check
      const _typeCheck: ThingId = id
      expect(id).toBeDefined()
    })

    it('should generate lowercase IDs only', () => {
      for (let i = 0; i < 20; i++) {
        const id = generateId()
        expect(id).toBe(id.toLowerCase())
      }
    })
  })

  describe('uniqueness', () => {
    it('should generate unique IDs on each call', () => {
      const ids = new Set<string>()
      const count = 1000

      for (let i = 0; i < count; i++) {
        ids.add(generateId())
      }

      expect(ids.size).toBe(count)
    })

    it('should generate unique IDs even when called rapidly', () => {
      const ids: string[] = []

      // Generate IDs as fast as possible
      for (let i = 0; i < 100; i++) {
        ids.push(generateId())
      }

      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('should generate different random suffix even with same timestamp', () => {
      // Mock Date.now to return constant value
      const mockTimestamp = 1705555555555
      vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp)

      try {
        const id1 = generateId()
        const id2 = generateId()

        // Same timestamp part
        expect(id1.split('-')[0]).toBe(id2.split('-')[0])
        // Different random part (with very high probability)
        expect(id1).not.toBe(id2)
      } finally {
        vi.restoreAllMocks()
      }
    })
  })

  describe('timestamp encoding', () => {
    it('should encode timestamp in base36', () => {
      const mockTimestamp = 1705555555555
      vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp)

      try {
        const id = generateId()
        const timestampPart = id.split('-')[0]
        const expectedBase36 = mockTimestamp.toString(36)

        expect(timestampPart).toBe(expectedBase36)
      } finally {
        vi.restoreAllMocks()
      }
    })

    it('should produce sortable IDs by timestamp', () => {
      // Generate IDs with increasing timestamps
      const timestamps = [1000000000000, 1000000001000, 1000000002000]
      const ids: string[] = []

      for (const ts of timestamps) {
        vi.spyOn(Date, 'now').mockReturnValue(ts)
        ids.push(generateId())
        vi.restoreAllMocks()
      }

      // IDs should be in lexicographic order (earlier timestamps first)
      const sortedIds = [...ids].sort()
      expect(sortedIds).toEqual(ids)
    })
  })

  describe('random suffix', () => {
    it('should generate 12-character random suffix (improved collision resistance do-1knp.5)', () => {
      for (let i = 0; i < 20; i++) {
        const id = generateId()
        const randomPart = id.split('-')[1]
        expect(randomPart.length).toBe(12)
      }
    })

    it('should use crypto.randomUUID for better entropy', () => {
      // We can't easily mock crypto.randomUUID, but we can verify
      // the output is using base36 characters
      for (let i = 0; i < 20; i++) {
        const id = generateId()
        const randomPart = id.split('-')[1]
        // Should only contain base36 characters (0-9, a-z)
        expect(randomPart).toMatch(/^[a-z0-9]+$/)
      }
    })
  })

  describe('collision resistance (do-1knp.5)', () => {
    it('should generate unique IDs in high-throughput scenarios (10000 rapid calls)', () => {
      const ids = new Set<string>()
      const count = 10000

      for (let i = 0; i < count; i++) {
        ids.add(generateId())
      }

      expect(ids.size).toBe(count)
    })

    it('should not collide even with same timestamp (mocked)', () => {
      const mockTimestamp = 1705555555555
      vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp)

      try {
        const ids = new Set<string>()
        const count = 1000

        for (let i = 0; i < count; i++) {
          ids.add(generateId())
        }

        // All IDs should be unique even with same timestamp
        expect(ids.size).toBe(count)
      } finally {
        vi.restoreAllMocks()
      }
    })
  })
})

// ============================================================================
// generateEventId() TESTS
// ============================================================================

describe('generateEventId', () => {
  describe('format', () => {
    it('should generate ID in format: evt-{timestamp-base36}-{random-8-chars}', () => {
      const id = generateEventId()
      const parts = id.split('-')

      expect(parts.length).toBe(3)
      expect(parts[0]).toBe('evt')
      // Timestamp part should be alphanumeric (base36)
      expect(parts[1]).toMatch(/^[a-z0-9]+$/)
      // Random part should be exactly 8 characters (improved collision resistance do-1knp.5)
      expect(parts[2]).toMatch(/^[a-z0-9]{8}$/)
    })

    it('should start with evt- prefix', () => {
      for (let i = 0; i < 10; i++) {
        const id = generateEventId()
        expect(id.startsWith('evt-')).toBe(true)
      }
    })

    it('should generate valid EventId that passes isEventId check', () => {
      for (let i = 0; i < 10; i++) {
        const id = generateEventId()
        expect(isEventId(id)).toBe(true)
      }
    })

    it('should return a branded EventId type', () => {
      const id = generateEventId()
      // TypeScript compile-time check
      const _typeCheck: EventId = id
      expect(id).toBeDefined()
    })

    it('should generate lowercase IDs only', () => {
      for (let i = 0; i < 20; i++) {
        const id = generateEventId()
        expect(id).toBe(id.toLowerCase())
      }
    })

    it('should not be mistaken for ThingId', () => {
      for (let i = 0; i < 10; i++) {
        const eventId = generateEventId()
        expect(isThingId(eventId)).toBe(false)
      }
    })
  })

  describe('uniqueness', () => {
    it('should generate unique event IDs on each call', () => {
      const ids = new Set<string>()
      const count = 1000

      for (let i = 0; i < count; i++) {
        ids.add(generateEventId())
      }

      expect(ids.size).toBe(count)
    })

    it('should generate unique IDs even when called rapidly', () => {
      const ids: string[] = []

      for (let i = 0; i < 100; i++) {
        ids.push(generateEventId())
      }

      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  describe('timestamp encoding', () => {
    it('should encode timestamp in base36', () => {
      const mockTimestamp = 1705555555555
      vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp)

      try {
        const id = generateEventId()
        const timestampPart = id.split('-')[1]
        const expectedBase36 = mockTimestamp.toString(36)

        expect(timestampPart).toBe(expectedBase36)
      } finally {
        vi.restoreAllMocks()
      }
    })

    it('should produce sortable event IDs by timestamp', () => {
      const timestamps = [1000000000000, 1000000001000, 1000000002000]
      const ids: string[] = []

      for (const ts of timestamps) {
        vi.spyOn(Date, 'now').mockReturnValue(ts)
        ids.push(generateEventId())
        vi.restoreAllMocks()
      }

      const sortedIds = [...ids].sort()
      expect(sortedIds).toEqual(ids)
    })
  })

  describe('random suffix', () => {
    it('should generate 8-character random suffix (improved collision resistance do-1knp.5)', () => {
      for (let i = 0; i < 20; i++) {
        const id = generateEventId()
        const randomPart = id.split('-')[2]
        expect(randomPart.length).toBe(8)
      }
    })

    it('should use crypto.randomUUID for better entropy', () => {
      for (let i = 0; i < 20; i++) {
        const id = generateEventId()
        const randomPart = id.split('-')[2]
        // Should only contain base36 characters (0-9, a-z)
        expect(randomPart).toMatch(/^[a-z0-9]+$/)
      }
    })
  })

  describe('collision resistance (do-1knp.5)', () => {
    it('should generate unique event IDs in high-throughput scenarios (10000 rapid calls)', () => {
      const ids = new Set<string>()
      const count = 10000

      for (let i = 0; i < count; i++) {
        ids.add(generateEventId())
      }

      expect(ids.size).toBe(count)
    })

    it('should not collide even with same timestamp (mocked)', () => {
      const mockTimestamp = 1705555555555
      vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp)

      try {
        const ids = new Set<string>()
        const count = 1000

        for (let i = 0; i < count; i++) {
          ids.add(generateEventId())
        }

        // All IDs should be unique even with same timestamp
        expect(ids.size).toBe(count)
      } finally {
        vi.restoreAllMocks()
      }
    })
  })
})

// ============================================================================
// CROSS-FUNCTION TESTS
// ============================================================================

describe('ID Generation - Cross-Function Tests', () => {
  it('generateId and generateEventId should never collide', () => {
    const thingIds = new Set<string>()
    const eventIds = new Set<string>()

    for (let i = 0; i < 100; i++) {
      thingIds.add(generateId())
      eventIds.add(generateEventId())
    }

    // Check no overlap
    for (const thingId of thingIds) {
      expect(eventIds.has(thingId)).toBe(false)
    }

    for (const eventId of eventIds) {
      expect(thingIds.has(eventId)).toBe(false)
    }
  })

  it('should distinguish ThingId from EventId by format', () => {
    const thingId = generateId()
    const eventId = generateEventId()

    // Thing ID: no prefix
    expect(thingId.startsWith('evt-')).toBe(false)
    // Event ID: has prefix
    expect(eventId.startsWith('evt-')).toBe(true)

    // Type guards should correctly identify each
    expect(isThingId(thingId)).toBe(true)
    expect(isEventId(thingId)).toBe(false)
    expect(isThingId(eventId)).toBe(false)
    expect(isEventId(eventId)).toBe(true)
  })

  it('IDs from both functions should be URL-safe', () => {
    for (let i = 0; i < 20; i++) {
      const thingId = generateId()
      const eventId = generateEventId()

      // Should only contain URL-safe characters
      expect(thingId).toMatch(/^[a-z0-9-]+$/)
      expect(eventId).toMatch(/^[a-z0-9-]+$/)

      // Should be usable in URLs without encoding
      expect(encodeURIComponent(thingId)).toBe(thingId)
      expect(encodeURIComponent(eventId)).toBe(eventId)
    }
  })

  it('IDs should be reasonable length for database storage', () => {
    for (let i = 0; i < 20; i++) {
      const thingId = generateId()
      const eventId = generateEventId()

      // Thing IDs: timestamp(~8-9 chars) + hyphen + random(12 chars) = ~21-22 chars
      expect(thingId.length).toBeGreaterThanOrEqual(15)
      expect(thingId.length).toBeLessThanOrEqual(25)

      // Event IDs: evt(3) + hyphen + timestamp(~8-9) + hyphen + random(8) = ~22-23 chars
      expect(eventId.length).toBeGreaterThanOrEqual(18)
      expect(eventId.length).toBeLessThanOrEqual(28)
    }
  })
})
