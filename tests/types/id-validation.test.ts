import { describe, it, expect } from 'vitest'

/**
 * RED Phase Tests for ID Type Guard Format Validation
 *
 * Issue: dotdo-30g9o - ID type guards should validate format
 *
 * Current Behavior (BUG):
 * The type guards in types/ids.ts:153+ only check `typeof value === 'string'`
 * and do NOT validate ID formats. This means ALL strings pass validation.
 *
 * Current implementations (lines 153-185):
 *   isThingId:  return typeof value === 'string'  // Always true for string!
 *   isActionId: return typeof value === 'string'  // Always true for string!
 *   isEventId:  return typeof value === 'string'  // Always true for string!
 *   isNounId:   return typeof value === 'string'  // Always true for string!
 *
 * Expected ID Formats (based on code examples in types/ids.ts):
 * - ThingId: alphanumeric slug (lowercase, dashes, dots allowed) e.g., 'acme', 'headless.ly'
 * - ActionId: UUID v4 format e.g., '550e8400-e29b-41d4-a716-446655440000'
 * - EventId: prefixed format 'evt-{id}' e.g., 'evt-123', 'evt-abc456'
 * - NounId: PascalCase identifier e.g., 'Startup', 'Customer', 'PaymentMethod'
 *
 * These tests assert the DESIRED behavior - they will FAIL until type guards
 * are updated to properly validate formats.
 */

import {
  isThingId,
  isActionId,
  isEventId,
  isNounId,
} from '../../types/ids'

// ============================================================================
// EXPECTED ID FORMAT PATTERNS (for documentation and future implementation)
// ============================================================================

/**
 * Expected format patterns for each ID type.
 * These regex patterns document what SHOULD be validated.
 */
export const ID_FORMAT_PATTERNS = {
  // ThingId: lowercase alphanumeric with dashes and dots, no leading/trailing special chars
  // Examples: 'acme', 'my-startup', 'headless.ly', 'tenant-123'
  thingId: /^[a-z][a-z0-9]*(?:[-.]?[a-z0-9]+)*$/,

  // ActionId: UUID v4 format (8-4-4-4-12 hex pattern)
  // Example: '550e8400-e29b-41d4-a716-446655440000'
  actionId: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,

  // EventId: 'evt-' prefix followed by alphanumeric identifier
  // Examples: 'evt-123', 'evt-abc456', 'evt-a1b2c3'
  eventId: /^evt-[a-z0-9]+$/i,

  // NounId: PascalCase identifier (no numbers at start, no dashes)
  // Examples: 'Startup', 'Customer', 'PaymentMethod'
  nounId: /^[A-Z][a-zA-Z0-9]*$/,
}

// ============================================================================
// isThingId - Should validate ThingId format
// ============================================================================

describe('isThingId validates format', () => {
  describe('valid ThingIds', () => {
    it('accepts simple lowercase slug', () => {
      expect(isThingId('acme')).toBe(true)
    })

    it('accepts slug with dashes', () => {
      expect(isThingId('my-startup')).toBe(true)
    })

    it('accepts domain-like slug', () => {
      expect(isThingId('headless.ly')).toBe(true)
    })

    it('accepts slug with numbers', () => {
      expect(isThingId('tenant-123')).toBe(true)
    })
  })

  describe('invalid ThingIds', () => {
    it('rejects empty string', () => {
      // FAILS: Currently returns true because it only checks typeof === 'string'
      expect(isThingId('')).toBe(false)
    })

    it('rejects random gibberish with special chars', () => {
      // FAILS: Currently returns true
      expect(isThingId('not-a-valid-thing-id-format!!!')).toBe(false)
    })

    it('rejects strings with only whitespace', () => {
      // FAILS: Currently returns true
      expect(isThingId('   ')).toBe(false)
      expect(isThingId('\t\n')).toBe(false)
    })

    it('rejects strings with leading/trailing whitespace', () => {
      // FAILS: Currently returns true
      expect(isThingId('  acme  ')).toBe(false)
      expect(isThingId('\nacme\n')).toBe(false)
    })

    it('rejects strings with uppercase (ThingIds should be lowercase)', () => {
      // FAILS: Currently returns true
      expect(isThingId('ACME')).toBe(false)
      expect(isThingId('MyStartup')).toBe(false)
    })

    it('rejects strings starting with numbers', () => {
      // FAILS: Currently returns true
      expect(isThingId('123acme')).toBe(false)
    })

    it('rejects strings with disallowed special characters', () => {
      // FAILS: Currently returns true
      expect(isThingId('acme@corp')).toBe(false)
      expect(isThingId('acme#1')).toBe(false)
      expect(isThingId('acme$corp')).toBe(false)
    })

    it('rejects UUID format (that is ActionId format)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isThingId('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
    })

    it('rejects evt- prefix (that is EventId format)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isThingId('evt-123')).toBe(false)
    })

    it('rejects PascalCase (that is NounId format)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isThingId('Customer')).toBe(false)
    })
  })
})

// ============================================================================
// isActionId - Should validate ActionId format (UUID v4)
// ============================================================================

describe('isActionId validates format', () => {
  describe('valid ActionIds (UUID v4)', () => {
    it('accepts valid UUID v4', () => {
      expect(isActionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })

    it('accepts another valid UUID v4', () => {
      expect(isActionId('6ba7b810-9dad-41d4-80b4-00c04fd430c8')).toBe(true)
    })

    it('accepts UUID with lowercase hex', () => {
      expect(isActionId('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true)
    })
  })

  describe('invalid ActionIds', () => {
    it('rejects empty string', () => {
      // FAILS: Currently returns true
      expect(isActionId('')).toBe(false)
    })

    it('rejects non-UUID strings', () => {
      // FAILS: Currently returns true
      expect(isActionId('not-a-uuid')).toBe(false)
      expect(isActionId('action-123')).toBe(false)
    })

    it('rejects UUID without dashes', () => {
      // FAILS: Currently returns true
      expect(isActionId('550e8400e29b41d4a716446655440000')).toBe(false)
    })

    it('rejects truncated UUID', () => {
      // FAILS: Currently returns true
      expect(isActionId('550e8400-e29b-41d4-a716')).toBe(false)
    })

    it('rejects wrong UUID version (v1 instead of v4)', () => {
      // FAILS: Currently returns true
      expect(isActionId('550e8400-e29b-11d4-a716-446655440000')).toBe(false)
    })

    it('rejects ThingId format (lowercase slug)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isActionId('acme')).toBe(false)
      expect(isActionId('my-startup')).toBe(false)
    })

    it('rejects EventId format (evt- prefix)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isActionId('evt-123')).toBe(false)
    })

    it('rejects NounId format (PascalCase)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isActionId('Customer')).toBe(false)
    })
  })
})

// ============================================================================
// isEventId - Should validate EventId format (evt-{id})
// ============================================================================

describe('isEventId validates format', () => {
  describe('valid EventIds', () => {
    it('accepts evt- prefixed id with numbers', () => {
      expect(isEventId('evt-123')).toBe(true)
    })

    it('accepts evt- with alphanumeric id', () => {
      expect(isEventId('evt-abc456')).toBe(true)
    })

    it('accepts evt- with lowercase hex', () => {
      expect(isEventId('evt-a1b2c3')).toBe(true)
    })
  })

  describe('invalid EventIds', () => {
    it('rejects empty string', () => {
      // FAILS: Currently returns true
      expect(isEventId('')).toBe(false)
    })

    it('rejects strings without evt- prefix', () => {
      // FAILS: Currently returns true
      expect(isEventId('event-123')).toBe(false)
      expect(isEventId('123')).toBe(false)
      expect(isEventId('some-random-id')).toBe(false)
    })

    it('rejects evt prefix without dash', () => {
      // FAILS: Currently returns true
      expect(isEventId('evt123')).toBe(false)
    })

    it('rejects evt- without id after dash', () => {
      // FAILS: Currently returns true
      expect(isEventId('evt-')).toBe(false)
    })

    it('rejects just evt without dash', () => {
      // FAILS: Currently returns true
      expect(isEventId('evt')).toBe(false)
    })

    it('rejects ThingId format (lowercase slug)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isEventId('acme')).toBe(false)
    })

    it('rejects ActionId format (UUID)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isEventId('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
    })

    it('rejects NounId format (PascalCase)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isEventId('Customer')).toBe(false)
    })
  })
})

// ============================================================================
// isNounId - Should validate NounId format (PascalCase)
// ============================================================================

describe('isNounId validates format', () => {
  describe('valid NounIds', () => {
    it('accepts PascalCase single word', () => {
      expect(isNounId('Startup')).toBe(true)
    })

    it('accepts PascalCase multi-word', () => {
      expect(isNounId('PaymentMethod')).toBe(true)
    })

    it('accepts simple PascalCase', () => {
      expect(isNounId('Customer')).toBe(true)
    })

    it('accepts PascalCase with numbers', () => {
      expect(isNounId('OAuth2Provider')).toBe(true)
    })
  })

  describe('invalid NounIds', () => {
    it('rejects empty string', () => {
      // FAILS: Currently returns true
      expect(isNounId('')).toBe(false)
    })

    it('rejects lowercase strings', () => {
      // FAILS: Currently returns true
      expect(isNounId('startup')).toBe(false)
      expect(isNounId('customer')).toBe(false)
    })

    it('rejects strings with dashes', () => {
      // FAILS: Currently returns true
      expect(isNounId('payment-method')).toBe(false)
    })

    it('rejects strings starting with numbers', () => {
      // FAILS: Currently returns true
      expect(isNounId('123Customer')).toBe(false)
    })

    it('rejects strings with special characters', () => {
      // FAILS: Currently returns true
      expect(isNounId('Customer@Corp')).toBe(false)
      expect(isNounId('Customer#1')).toBe(false)
    })

    it('rejects snake_case', () => {
      // FAILS: Currently returns true
      expect(isNounId('payment_method')).toBe(false)
    })

    it('rejects ThingId format (lowercase slug)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isNounId('acme')).toBe(false)
      expect(isNounId('my-startup')).toBe(false)
    })

    it('rejects ActionId format (UUID)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isNounId('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
    })

    it('rejects EventId format (evt- prefix)', () => {
      // FAILS: Currently returns true - should reject wrong ID type
      expect(isNounId('evt-123')).toBe(false)
    })
  })
})

// ============================================================================
// Type guards should distinguish between ID types
// ============================================================================

describe('Type guards distinguish between ID types', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000'
  const thingSlug = 'my-startup'
  const eventIdStr = 'evt-123'
  const nounPascal = 'Customer'

  it('only isActionId accepts UUID format', () => {
    // FAILS: All return true because they only check typeof
    expect(isThingId(uuid)).toBe(false)
    expect(isActionId(uuid)).toBe(true)
    expect(isEventId(uuid)).toBe(false)
    expect(isNounId(uuid)).toBe(false)
  })

  it('only isThingId accepts slug format', () => {
    // FAILS: All return true because they only check typeof
    expect(isThingId(thingSlug)).toBe(true)
    expect(isActionId(thingSlug)).toBe(false)
    expect(isEventId(thingSlug)).toBe(false)
    expect(isNounId(thingSlug)).toBe(false)
  })

  it('only isEventId accepts evt- prefix format', () => {
    // FAILS: All return true because they only check typeof
    expect(isThingId(eventIdStr)).toBe(false)
    expect(isActionId(eventIdStr)).toBe(false)
    expect(isEventId(eventIdStr)).toBe(true)
    expect(isNounId(eventIdStr)).toBe(false)
  })

  it('only isNounId accepts PascalCase format', () => {
    // FAILS: All return true because they only check typeof
    expect(isThingId(nounPascal)).toBe(false)
    expect(isActionId(nounPascal)).toBe(false)
    expect(isEventId(nounPascal)).toBe(false)
    expect(isNounId(nounPascal)).toBe(true)
  })
})

// ============================================================================
// Type guards should work with unknown input
// ============================================================================

describe('Type guards work with unknown input', () => {
  it('isThingId handles non-string input gracefully', () => {
    // Type guards currently only accept string, but should handle unknown
    // If we cast to string to match current signature, it will pass
    // These tests document that guards should reject non-strings
    expect(isThingId(null as unknown as string)).toBe(false)
    expect(isThingId(undefined as unknown as string)).toBe(false)
    expect(isThingId(123 as unknown as string)).toBe(false)
    expect(isThingId({} as unknown as string)).toBe(false)
    expect(isThingId([] as unknown as string)).toBe(false)
  })

  it('isActionId handles non-string input gracefully', () => {
    expect(isActionId(null as unknown as string)).toBe(false)
    expect(isActionId(undefined as unknown as string)).toBe(false)
    expect(isActionId(123 as unknown as string)).toBe(false)
  })

  it('isEventId handles non-string input gracefully', () => {
    expect(isEventId(null as unknown as string)).toBe(false)
    expect(isEventId(undefined as unknown as string)).toBe(false)
    expect(isEventId(123 as unknown as string)).toBe(false)
  })

  it('isNounId handles non-string input gracefully', () => {
    expect(isNounId(null as unknown as string)).toBe(false)
    expect(isNounId(undefined as unknown as string)).toBe(false)
    expect(isNounId(123 as unknown as string)).toBe(false)
  })
})

// ============================================================================
// Security - Type guards should reject malicious input
// ============================================================================

describe('Security - Type guards reject malicious input', () => {
  const maliciousInputs = [
    // SQL injection
    "'; DROP TABLE users; --",
    "1' OR '1'='1",
    "admin'--",

    // Path traversal
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32',

    // XSS
    '<script>alert("xss")</script>',
    'javascript:alert(1)',

    // Command injection
    '; rm -rf /',
    '| cat /etc/passwd',
    '`whoami`',

    // Null byte injection
    'valid-id\x00.txt',

    // Length attacks
    'a'.repeat(10000),
  ]

  it('isThingId rejects all malicious inputs', () => {
    for (const input of maliciousInputs) {
      // FAILS: Currently returns true for all
      expect(isThingId(input)).toBe(false)
    }
  })

  it('isActionId rejects all malicious inputs', () => {
    for (const input of maliciousInputs) {
      // FAILS: Currently returns true for all
      expect(isActionId(input)).toBe(false)
    }
  })

  it('isEventId rejects all malicious inputs', () => {
    for (const input of maliciousInputs) {
      // FAILS: Currently returns true for all
      expect(isEventId(input)).toBe(false)
    }
  })

  it('isNounId rejects all malicious inputs', () => {
    for (const input of maliciousInputs) {
      // FAILS: Currently returns true for all
      expect(isNounId(input)).toBe(false)
    }
  })
})

// ============================================================================
// Demonstrates the fundamental bug: all guards are equivalent
// ============================================================================

describe('Current bug: all type guards return identical results', () => {
  it('all type guards only check typeof string (the bug)', () => {
    // This demonstrates the fundamental problem:
    // The guards are all equivalent because they only do `typeof value === 'string'`
    const anyString = 'literally anything works here!!!@#$%^&*()'

    // FAILS: All should return false for invalid format, but all return true
    expect(isThingId(anyString)).toBe(false)
    expect(isActionId(anyString)).toBe(false)
    expect(isEventId(anyString)).toBe(false)
    expect(isNounId(anyString)).toBe(false)
  })
})
