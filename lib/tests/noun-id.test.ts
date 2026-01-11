import { describe, it, expect } from 'vitest'

/**
 * Noun/id Format Parsing Tests (RED Phase)
 *
 * These tests verify the parseNounId and formatNounId utilities for
 * working with Thing references in the Noun/id format used throughout dotdo.
 *
 * They are expected to FAIL until lib/noun-id.ts is implemented.
 *
 * Format specification:
 * - Basic: 'Noun/id' (e.g., 'Customer/acme')
 * - Nested: 'Noun/id/Noun/id' (e.g., 'Startup/acme/Product/widget')
 * - With branch: 'Noun/id@branch' (e.g., 'Startup/acme@experiment')
 * - With version: 'Noun/id@v123' (e.g., 'Startup/acme@v1234')
 * - With relative version: 'Noun/id@~N' (e.g., 'Startup/acme@~1')
 * - With timestamp: 'Noun/id@YYYY-MM-DD' or 'Noun/id@ISO8601'
 */

import {
  parseNounId,
  formatNounId,
  isPascalCase,
  isValidNounId,
  type NounIdRef,
} from '../noun-id'

// ============================================================================
// Simple Parsing
// ============================================================================

describe('parseNounId - simple parsing', () => {
  describe('basic Noun/id format', () => {
    it('parses simple Noun/id reference', () => {
      const result = parseNounId('Customer/acme')

      expect(result).toEqual({
        noun: 'Customer',
        id: 'acme',
      })
    })

    it('parses Noun/id with dots in id', () => {
      const result = parseNounId('Startup/headless.ly')

      expect(result).toEqual({
        noun: 'Startup',
        id: 'headless.ly',
      })
    })

    it('parses Noun/id with dashes in id', () => {
      const result = parseNounId('Organization/my-company')

      expect(result).toEqual({
        noun: 'Organization',
        id: 'my-company',
      })
    })

    it('parses Noun/id with underscores in id', () => {
      const result = parseNounId('Product/super_widget')

      expect(result).toEqual({
        noun: 'Product',
        id: 'super_widget',
      })
    })

    it('parses Noun/id with numbers in id', () => {
      const result = parseNounId('Version/v2024')

      expect(result).toEqual({
        noun: 'Version',
        id: 'v2024',
      })
    })

    it('parses Noun/id with mixed special characters in id', () => {
      const result = parseNounId('Domain/api.example-site_v2.com')

      expect(result).toEqual({
        noun: 'Domain',
        id: 'api.example-site_v2.com',
      })
    })
  })

  describe('various PascalCase nouns', () => {
    it('parses single-word PascalCase noun', () => {
      const result = parseNounId('User/john')

      expect(result.noun).toBe('User')
    })

    it('parses multi-word PascalCase noun', () => {
      const result = parseNounId('CustomerAccount/primary')

      expect(result.noun).toBe('CustomerAccount')
    })

    it('parses acronym-containing PascalCase noun', () => {
      const result = parseNounId('APIKey/secret123')

      expect(result.noun).toBe('APIKey')
    })

    it('parses long PascalCase noun', () => {
      const result = parseNounId('CustomerBillingAddress/home')

      expect(result.noun).toBe('CustomerBillingAddress')
    })
  })
})

// ============================================================================
// Nested Paths
// ============================================================================

describe('parseNounId - nested paths', () => {
  describe('two-level nesting', () => {
    it('parses two-level nested path', () => {
      const result = parseNounId('Startup/acme/Product/widget')

      expect(result).toEqual({
        noun: 'Startup',
        id: 'acme',
        path: {
          noun: 'Product',
          id: 'widget',
        },
      })
    })

    it('parses two-level nested path with special characters', () => {
      const result = parseNounId('Organization/my-org/Team/dev-team')

      expect(result).toEqual({
        noun: 'Organization',
        id: 'my-org',
        path: {
          noun: 'Team',
          id: 'dev-team',
        },
      })
    })
  })

  describe('three-level nesting', () => {
    it('parses three-level nested path', () => {
      const result = parseNounId('Org/acme/Team/engineering/Member/alice')

      expect(result).toEqual({
        noun: 'Org',
        id: 'acme',
        path: {
          noun: 'Team',
          id: 'engineering',
          path: {
            noun: 'Member',
            id: 'alice',
          },
        },
      })
    })
  })

  describe('deeply nested paths', () => {
    it('parses four-level nested path', () => {
      const result = parseNounId(
        'Company/acme/Division/tech/Team/backend/Member/bob'
      )

      expect(result).toEqual({
        noun: 'Company',
        id: 'acme',
        path: {
          noun: 'Division',
          id: 'tech',
          path: {
            noun: 'Team',
            id: 'backend',
            path: {
              noun: 'Member',
              id: 'bob',
            },
          },
        },
      })
    })
  })
})

// ============================================================================
// Branch Syntax
// ============================================================================

describe('parseNounId - branch syntax', () => {
  describe('simple branch references', () => {
    it('parses branch reference with @main', () => {
      const result = parseNounId('Startup/acme@main')

      expect(result).toEqual({
        noun: 'Startup',
        id: 'acme',
        branch: 'main',
      })
    })

    it('parses branch reference with @experiment', () => {
      const result = parseNounId('Startup/acme@experiment')

      expect(result).toEqual({
        noun: 'Startup',
        id: 'acme',
        branch: 'experiment',
      })
    })

    it('parses branch reference with hyphenated branch name', () => {
      const result = parseNounId('Feature/login@feature-branch')

      expect(result).toEqual({
        noun: 'Feature',
        id: 'login',
        branch: 'feature-branch',
      })
    })

    it('parses branch reference with underscored branch name', () => {
      const result = parseNounId('Config/settings@dev_test')

      expect(result).toEqual({
        noun: 'Config',
        id: 'settings',
        branch: 'dev_test',
      })
    })

    it('parses branch reference with numbered branch name', () => {
      const result = parseNounId('Release/app@release-2024-01')

      expect(result).toEqual({
        noun: 'Release',
        id: 'app',
        branch: 'release-2024-01',
      })
    })
  })

  describe('nested paths with branches', () => {
    it('parses nested path with branch on leaf', () => {
      const result = parseNounId('Startup/acme/Product/widget@experiment')

      expect(result).toEqual({
        noun: 'Startup',
        id: 'acme',
        path: {
          noun: 'Product',
          id: 'widget',
          branch: 'experiment',
        },
      })
    })
  })
})

// ============================================================================
// Version Syntax
// ============================================================================

describe('parseNounId - version syntax', () => {
  describe('specific version references', () => {
    it('parses version reference @v1234', () => {
      const result = parseNounId('Startup/acme@v1234')

      expect(result).toEqual({
        noun: 'Startup',
        id: 'acme',
        version: 1234,
      })
    })

    it('parses version reference @v1', () => {
      const result = parseNounId('Document/readme@v1')

      expect(result).toEqual({
        noun: 'Document',
        id: 'readme',
        version: 1,
      })
    })

    it('parses version reference with large number', () => {
      const result = parseNounId('Entity/data@v9999999')

      expect(result).toEqual({
        noun: 'Entity',
        id: 'data',
        version: 9999999,
      })
    })

    it('parses version reference @v0', () => {
      const result = parseNounId('Draft/initial@v0')

      expect(result).toEqual({
        noun: 'Draft',
        id: 'initial',
        version: 0,
      })
    })
  })

  describe('relative version references', () => {
    it('parses relative version @~1', () => {
      const result = parseNounId('Startup/acme@~1')

      expect(result).toEqual({
        noun: 'Startup',
        id: 'acme',
        relativeVersion: 1,
      })
    })

    it('parses relative version @~5', () => {
      const result = parseNounId('Startup/acme@~5')

      expect(result).toEqual({
        noun: 'Startup',
        id: 'acme',
        relativeVersion: 5,
      })
    })

    it('parses relative version @~10', () => {
      const result = parseNounId('History/events@~10')

      expect(result).toEqual({
        noun: 'History',
        id: 'events',
        relativeVersion: 10,
      })
    })

    it('parses relative version @~100', () => {
      const result = parseNounId('Log/audit@~100')

      expect(result).toEqual({
        noun: 'Log',
        id: 'audit',
        relativeVersion: 100,
      })
    })
  })
})

// ============================================================================
// Timestamp Syntax
// ============================================================================

describe('parseNounId - timestamp syntax', () => {
  describe('date-only timestamps', () => {
    it('parses date timestamp @2024-01-08', () => {
      const result = parseNounId('Startup/acme@2024-01-08')

      expect(result.noun).toBe('Startup')
      expect(result.id).toBe('acme')
      expect(result.timestamp).toBeInstanceOf(Date)
      expect(result.timestamp?.getFullYear()).toBe(2024)
      expect(result.timestamp?.getMonth()).toBe(0) // January is 0
      expect(result.timestamp?.getDate()).toBe(8)
    })

    it('parses date timestamp @2023-12-31', () => {
      const result = parseNounId('Report/annual@2023-12-31')

      expect(result.noun).toBe('Report')
      expect(result.id).toBe('annual')
      expect(result.timestamp).toBeInstanceOf(Date)
      expect(result.timestamp?.getFullYear()).toBe(2023)
      expect(result.timestamp?.getMonth()).toBe(11) // December is 11
      expect(result.timestamp?.getDate()).toBe(31)
    })

    it('parses date timestamp @2020-02-29 (leap year)', () => {
      const result = parseNounId('Event/special@2020-02-29')

      expect(result.timestamp).toBeInstanceOf(Date)
      expect(result.timestamp?.getFullYear()).toBe(2020)
      expect(result.timestamp?.getMonth()).toBe(1) // February is 1
      expect(result.timestamp?.getDate()).toBe(29)
    })
  })

  describe('ISO 8601 timestamps', () => {
    it('parses ISO 8601 timestamp with time', () => {
      const result = parseNounId('Startup/acme@2024-01-08T12:00:00Z')

      expect(result.noun).toBe('Startup')
      expect(result.id).toBe('acme')
      expect(result.timestamp).toBeInstanceOf(Date)
      expect(result.timestamp?.toISOString()).toBe('2024-01-08T12:00:00.000Z')
    })

    it('parses ISO 8601 timestamp with timezone offset', () => {
      const result = parseNounId('Meeting/standup@2024-01-08T09:00:00-05:00')

      expect(result.timestamp).toBeInstanceOf(Date)
      // 9:00 AM EST = 14:00 UTC
      expect(result.timestamp?.getUTCHours()).toBe(14)
    })

    it('parses ISO 8601 timestamp with milliseconds', () => {
      const result = parseNounId('Event/click@2024-01-08T12:30:45.123Z')

      expect(result.timestamp).toBeInstanceOf(Date)
      expect(result.timestamp?.getUTCMilliseconds()).toBe(123)
    })
  })
})

// ============================================================================
// Combined Syntax
// ============================================================================

describe('parseNounId - combined syntax', () => {
  describe('nested paths with modifiers', () => {
    it('parses nested path with branch on leaf', () => {
      const result = parseNounId('Startup/acme/Product/widget@experiment')

      expect(result).toEqual({
        noun: 'Startup',
        id: 'acme',
        path: {
          noun: 'Product',
          id: 'widget',
          branch: 'experiment',
        },
      })
    })

    it('parses nested path with version on leaf', () => {
      const result = parseNounId('Org/acme/Document/readme@v5')

      expect(result).toEqual({
        noun: 'Org',
        id: 'acme',
        path: {
          noun: 'Document',
          id: 'readme',
          version: 5,
        },
      })
    })

    it('parses nested path with relative version on leaf', () => {
      const result = parseNounId('Team/backend/Config/settings@~2')

      expect(result).toEqual({
        noun: 'Team',
        id: 'backend',
        path: {
          noun: 'Config',
          id: 'settings',
          relativeVersion: 2,
        },
      })
    })

    it('parses nested path with timestamp on leaf', () => {
      const result = parseNounId('Company/acme/Report/quarterly@2024-01-01')

      expect(result.noun).toBe('Company')
      expect(result.id).toBe('acme')
      expect(result.path?.noun).toBe('Report')
      expect(result.path?.id).toBe('quarterly')
      expect(result.path?.timestamp).toBeInstanceOf(Date)
    })

    it('parses three-level nested path with branch', () => {
      const result = parseNounId(
        'Org/acme/Team/eng/Project/dashboard@feature'
      )

      expect(result).toEqual({
        noun: 'Org',
        id: 'acme',
        path: {
          noun: 'Team',
          id: 'eng',
          path: {
            noun: 'Project',
            id: 'dashboard',
            branch: 'feature',
          },
        },
      })
    })
  })
})

// ============================================================================
// Format Function (Reverse)
// ============================================================================

describe('formatNounId', () => {
  describe('simple formatting', () => {
    it('formats simple Noun/id reference', () => {
      const result = formatNounId({ noun: 'Customer', id: 'acme' })

      expect(result).toBe('Customer/acme')
    })

    it('formats Noun/id with special characters in id', () => {
      const result = formatNounId({ noun: 'Startup', id: 'headless.ly' })

      expect(result).toBe('Startup/headless.ly')
    })

    it('formats Noun/id with dashes', () => {
      const result = formatNounId({ noun: 'Organization', id: 'my-company' })

      expect(result).toBe('Organization/my-company')
    })
  })

  describe('nested path formatting', () => {
    it('formats two-level nested path', () => {
      const result = formatNounId({
        noun: 'Startup',
        id: 'acme',
        path: { noun: 'Product', id: 'widget' },
      })

      expect(result).toBe('Startup/acme/Product/widget')
    })

    it('formats three-level nested path', () => {
      const result = formatNounId({
        noun: 'Org',
        id: 'acme',
        path: {
          noun: 'Team',
          id: 'eng',
          path: { noun: 'Member', id: 'alice' },
        },
      })

      expect(result).toBe('Org/acme/Team/eng/Member/alice')
    })
  })

  describe('branch formatting', () => {
    it('formats with branch', () => {
      const result = formatNounId({
        noun: 'Startup',
        id: 'acme',
        branch: 'experiment',
      })

      expect(result).toBe('Startup/acme@experiment')
    })

    it('formats nested path with branch', () => {
      const result = formatNounId({
        noun: 'Startup',
        id: 'acme',
        path: { noun: 'Product', id: 'widget', branch: 'feature' },
      })

      expect(result).toBe('Startup/acme/Product/widget@feature')
    })
  })

  describe('version formatting', () => {
    it('formats with version', () => {
      const result = formatNounId({
        noun: 'Document',
        id: 'readme',
        version: 1234,
      })

      expect(result).toBe('Document/readme@v1234')
    })

    it('formats with relative version', () => {
      const result = formatNounId({
        noun: 'Startup',
        id: 'acme',
        relativeVersion: 5,
      })

      expect(result).toBe('Startup/acme@~5')
    })
  })

  describe('timestamp formatting', () => {
    it('formats with date timestamp', () => {
      const result = formatNounId({
        noun: 'Startup',
        id: 'acme',
        timestamp: new Date('2024-01-08'),
      })

      expect(result).toBe('Startup/acme@2024-01-08')
    })

    it('formats with datetime timestamp', () => {
      const result = formatNounId({
        noun: 'Event',
        id: 'click',
        timestamp: new Date('2024-01-08T12:00:00Z'),
      })

      // Should format as ISO string when time component is non-zero
      expect(result).toBe('Event/click@2024-01-08T12:00:00.000Z')
    })
  })
})

// ============================================================================
// Roundtrip Tests
// ============================================================================

describe('parseNounId/formatNounId roundtrip', () => {
  describe('simple roundtrips', () => {
    it('roundtrips simple Noun/id', () => {
      const original = 'Customer/acme'
      const parsed = parseNounId(original)
      const formatted = formatNounId(parsed)

      expect(formatted).toBe(original)
    })

    it('roundtrips Noun/id with special characters', () => {
      const original = 'Startup/headless.ly'
      const parsed = parseNounId(original)
      const formatted = formatNounId(parsed)

      expect(formatted).toBe(original)
    })
  })

  describe('nested path roundtrips', () => {
    it('roundtrips two-level nested path', () => {
      const original = 'Startup/acme/Product/widget'
      const parsed = parseNounId(original)
      const formatted = formatNounId(parsed)

      expect(formatted).toBe(original)
    })

    it('roundtrips three-level nested path', () => {
      const original = 'Org/acme/Team/eng/Member/alice'
      const parsed = parseNounId(original)
      const formatted = formatNounId(parsed)

      expect(formatted).toBe(original)
    })
  })

  describe('branch roundtrips', () => {
    it('roundtrips with branch', () => {
      const original = 'Startup/acme@experiment'
      const parsed = parseNounId(original)
      const formatted = formatNounId(parsed)

      expect(formatted).toBe(original)
    })

    it('roundtrips nested path with branch', () => {
      const original = 'Startup/acme/Product/widget@feature'
      const parsed = parseNounId(original)
      const formatted = formatNounId(parsed)

      expect(formatted).toBe(original)
    })
  })

  describe('version roundtrips', () => {
    it('roundtrips with version', () => {
      const original = 'Document/readme@v1234'
      const parsed = parseNounId(original)
      const formatted = formatNounId(parsed)

      expect(formatted).toBe(original)
    })

    it('roundtrips with relative version', () => {
      const original = 'Startup/acme@~5'
      const parsed = parseNounId(original)
      const formatted = formatNounId(parsed)

      expect(formatted).toBe(original)
    })
  })

  describe('timestamp roundtrips', () => {
    it('roundtrips with date timestamp', () => {
      const original = 'Startup/acme@2024-01-08'
      const parsed = parseNounId(original)
      const formatted = formatNounId(parsed)

      expect(formatted).toBe(original)
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('parseNounId - edge cases', () => {
  describe('error handling', () => {
    it('throws on empty string', () => {
      expect(() => parseNounId('')).toThrow()
    })

    it('throws on missing id (just noun)', () => {
      expect(() => parseNounId('Customer')).toThrow()
    })

    it('throws on missing id (noun with slash)', () => {
      expect(() => parseNounId('Customer/')).toThrow()
    })

    it('throws on missing noun (just slash and id)', () => {
      expect(() => parseNounId('/acme')).toThrow()
    })

    it('throws on just a slash', () => {
      expect(() => parseNounId('/')).toThrow()
    })

    it('throws on double slashes', () => {
      expect(() => parseNounId('Customer//acme')).toThrow()
    })

    it('throws on incomplete nested path', () => {
      expect(() => parseNounId('Startup/acme/Product')).toThrow()
    })

    it('throws on trailing slash', () => {
      expect(() => parseNounId('Customer/acme/')).toThrow()
    })
  })

  describe('invalid noun (not PascalCase)', () => {
    it('throws on lowercase noun', () => {
      expect(() => parseNounId('customer/acme')).toThrow()
    })

    it('throws on UPPERCASE noun', () => {
      expect(() => parseNounId('CUSTOMER/acme')).toThrow()
    })

    it('throws on snake_case noun', () => {
      expect(() => parseNounId('customer_account/acme')).toThrow()
    })

    it('throws on kebab-case noun', () => {
      expect(() => parseNounId('customer-account/acme')).toThrow()
    })

    it('throws on camelCase noun', () => {
      expect(() => parseNounId('customerAccount/acme')).toThrow()
    })

    it('throws on noun starting with number', () => {
      expect(() => parseNounId('123Customer/acme')).toThrow()
    })
  })

  describe('unicode and special characters', () => {
    it('parses id with unicode characters', () => {
      const result = parseNounId('Customer/cafe')

      expect(result.id).toBe('cafe')
    })

    it('parses id with emoji (if supported)', () => {
      // This may throw or parse depending on implementation
      // Testing that the function handles it consistently
      const input = 'Company/acme-tech'
      const result = parseNounId(input)

      expect(result.id).toBe('acme-tech')
    })

    it('handles URL-encoded slashes in id', () => {
      // %2F is URL-encoded slash - should be decoded to /
      // Implementation may treat this specially or throw
      expect(() => parseNounId('File/path%2Fto%2Ffile')).not.toThrow()
    })

    it('handles URL-encoded @ in id', () => {
      // %40 is URL-encoded @ - should be decoded
      const result = parseNounId('Email/user%40example.com.ai')

      expect(result.id).toBe('user@example.com.ai')
    })
  })

  describe('whitespace handling', () => {
    it('throws on leading whitespace', () => {
      expect(() => parseNounId(' Customer/acme')).toThrow()
    })

    it('throws on trailing whitespace', () => {
      expect(() => parseNounId('Customer/acme ')).toThrow()
    })

    it('throws on whitespace in noun', () => {
      expect(() => parseNounId('Customer Account/acme')).toThrow()
    })

    it('throws on whitespace in id', () => {
      expect(() => parseNounId('Customer/acme corp')).toThrow()
    })
  })

  describe('modifier edge cases', () => {
    it('throws on empty branch name', () => {
      expect(() => parseNounId('Customer/acme@')).toThrow()
    })

    it('throws on @ without modifier', () => {
      expect(() => parseNounId('Customer/acme@')).toThrow()
    })

    it('throws on multiple @ symbols', () => {
      expect(() => parseNounId('Customer/acme@main@v1')).toThrow()
    })

    it('parses modifier that looks like branch but could be version', () => {
      // 'v' without number should be treated as branch
      const result = parseNounId('Customer/acme@v')

      expect(result.branch).toBe('v')
      expect(result.version).toBeUndefined()
    })
  })
})

// ============================================================================
// Validation Functions
// ============================================================================

describe('isPascalCase', () => {
  describe('valid PascalCase', () => {
    it('returns true for simple PascalCase', () => {
      expect(isPascalCase('Customer')).toBe(true)
    })

    it('returns true for multi-word PascalCase', () => {
      expect(isPascalCase('CustomerAccount')).toBe(true)
    })

    it('returns true for acronym PascalCase', () => {
      expect(isPascalCase('APIKey')).toBe(true)
    })

    it('returns true for long PascalCase', () => {
      expect(isPascalCase('CustomerBillingAddressDetails')).toBe(true)
    })

    it('returns true for single uppercase letter', () => {
      expect(isPascalCase('A')).toBe(true)
    })
  })

  describe('invalid PascalCase', () => {
    it('returns false for lowercase', () => {
      expect(isPascalCase('customer')).toBe(false)
    })

    it('returns false for camelCase', () => {
      expect(isPascalCase('customerAccount')).toBe(false)
    })

    it('returns false for snake_case', () => {
      expect(isPascalCase('customer_account')).toBe(false)
    })

    it('returns false for kebab-case', () => {
      expect(isPascalCase('customer-account')).toBe(false)
    })

    it('returns false for UPPERCASE', () => {
      expect(isPascalCase('CUSTOMER')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isPascalCase('')).toBe(false)
    })

    it('returns false for string starting with number', () => {
      expect(isPascalCase('123Customer')).toBe(false)
    })

    it('returns false for string with spaces', () => {
      expect(isPascalCase('Customer Account')).toBe(false)
    })
  })
})

describe('isValidNounId', () => {
  describe('valid Noun/id formats', () => {
    it('returns true for simple Noun/id', () => {
      expect(isValidNounId('Customer/acme')).toBe(true)
    })

    it('returns true for nested path', () => {
      expect(isValidNounId('Startup/acme/Product/widget')).toBe(true)
    })

    it('returns true for Noun/id with branch', () => {
      expect(isValidNounId('Startup/acme@main')).toBe(true)
    })

    it('returns true for Noun/id with version', () => {
      expect(isValidNounId('Startup/acme@v1234')).toBe(true)
    })

    it('returns true for Noun/id with relative version', () => {
      expect(isValidNounId('Startup/acme@~5')).toBe(true)
    })

    it('returns true for Noun/id with timestamp', () => {
      expect(isValidNounId('Startup/acme@2024-01-08')).toBe(true)
    })
  })

  describe('invalid Noun/id formats', () => {
    it('returns false for empty string', () => {
      expect(isValidNounId('')).toBe(false)
    })

    it('returns false for missing id', () => {
      expect(isValidNounId('Customer')).toBe(false)
    })

    it('returns false for lowercase noun', () => {
      expect(isValidNounId('customer/acme')).toBe(false)
    })

    it('returns false for incomplete nested path', () => {
      expect(isValidNounId('Startup/acme/Product')).toBe(false)
    })

    it('returns false for empty branch', () => {
      expect(isValidNounId('Customer/acme@')).toBe(false)
    })
  })
})

// ============================================================================
// Branch Name Validation
// ============================================================================

describe('parseNounId - branch name restrictions', () => {
  describe('valid branch names', () => {
    it('accepts alphanumeric branch names', () => {
      const result = parseNounId('Startup/acme@feature123')

      expect(result.branch).toBe('feature123')
    })

    it('accepts branch names with hyphens', () => {
      const result = parseNounId('Startup/acme@feature-branch')

      expect(result.branch).toBe('feature-branch')
    })

    it('accepts branch names with underscores', () => {
      const result = parseNounId('Startup/acme@feature_branch')

      expect(result.branch).toBe('feature_branch')
    })

    it('accepts branch names with dots', () => {
      const result = parseNounId('Startup/acme@release.1.0')

      expect(result.branch).toBe('release.1.0')
    })
  })

  describe('branch name edge cases', () => {
    it('throws on branch name with spaces', () => {
      expect(() => parseNounId('Startup/acme@feature branch')).toThrow()
    })

    it('throws on branch name with slash', () => {
      expect(() => parseNounId('Startup/acme@feature/branch')).toThrow()
    })

    it('throws on branch name starting with hyphen', () => {
      expect(() => parseNounId('Startup/acme@-feature')).toThrow()
    })

    it('throws on branch name starting with dot', () => {
      expect(() => parseNounId('Startup/acme@.hidden')).toThrow()
    })
  })
})

// ============================================================================
// ID Validation
// ============================================================================

describe('parseNounId - id character validation', () => {
  describe('valid id characters', () => {
    it('accepts lowercase letters', () => {
      const result = parseNounId('Customer/abc')

      expect(result.id).toBe('abc')
    })

    it('accepts uppercase letters', () => {
      const result = parseNounId('Customer/ABC')

      expect(result.id).toBe('ABC')
    })

    it('accepts numbers', () => {
      const result = parseNounId('Customer/123')

      expect(result.id).toBe('123')
    })

    it('accepts dots', () => {
      const result = parseNounId('Domain/example.com.ai')

      expect(result.id).toBe('example.com.ai')
    })

    it('accepts hyphens', () => {
      const result = parseNounId('Slug/my-slug')

      expect(result.id).toBe('my-slug')
    })

    it('accepts underscores', () => {
      const result = parseNounId('Key/api_key')

      expect(result.id).toBe('api_key')
    })

    it('accepts mixed valid characters', () => {
      const result = parseNounId('Resource/api.example-site_v2.com')

      expect(result.id).toBe('api.example-site_v2.com')
    })
  })

  describe('id starting character restrictions', () => {
    it('accepts id starting with letter', () => {
      const result = parseNounId('Customer/acme')

      expect(result.id).toBe('acme')
    })

    it('accepts id starting with number', () => {
      const result = parseNounId('Order/123abc')

      expect(result.id).toBe('123abc')
    })

    it('throws on id starting with hyphen', () => {
      expect(() => parseNounId('Customer/-acme')).toThrow()
    })

    it('throws on id starting with dot', () => {
      expect(() => parseNounId('Customer/.hidden')).toThrow()
    })
  })
})

// ============================================================================
// Type Safety
// ============================================================================

describe('type safety', () => {
  it('parseNounId returns NounIdRef', () => {
    const result: NounIdRef = parseNounId('Customer/acme')

    expect(result.noun).toBe('Customer')
    expect(result.id).toBe('acme')
  })

  it('formatNounId accepts NounIdRef', () => {
    const ref: NounIdRef = { noun: 'Customer', id: 'acme' }
    const result: string = formatNounId(ref)

    expect(typeof result).toBe('string')
  })

  it('NounIdRef path is optional', () => {
    const ref: NounIdRef = { noun: 'Customer', id: 'acme' }

    expect(ref.path).toBeUndefined()
  })

  it('NounIdRef branch is optional', () => {
    const ref: NounIdRef = { noun: 'Customer', id: 'acme' }

    expect(ref.branch).toBeUndefined()
  })

  it('NounIdRef version fields are optional', () => {
    const ref: NounIdRef = { noun: 'Customer', id: 'acme' }

    expect(ref.version).toBeUndefined()
    expect(ref.relativeVersion).toBeUndefined()
    expect(ref.timestamp).toBeUndefined()
  })

  it('NounIdRef with all optional fields defined', () => {
    const ref: NounIdRef = {
      noun: 'Startup',
      id: 'acme',
      path: { noun: 'Product', id: 'widget' },
      branch: 'main',
      // Note: in practice only one of version/relativeVersion/timestamp would be set
    }

    expect(ref.noun).toBe('Startup')
    expect(ref.path?.noun).toBe('Product')
    expect(ref.branch).toBe('main')
  })
})

// ============================================================================
// Performance/Stress Tests
// ============================================================================

describe('parseNounId - performance', () => {
  it('handles very long ids', () => {
    const longId = 'a'.repeat(1000)
    const result = parseNounId(`Customer/${longId}`)

    expect(result.id).toBe(longId)
    expect(result.id.length).toBe(1000)
  })

  it('handles deeply nested paths (10 levels)', () => {
    const parts = []
    for (let i = 0; i < 10; i++) {
      parts.push(`Level${i}/item${i}`)
    }
    const input = parts.join('/')
    const result = parseNounId(input)

    expect(result.noun).toBe('Level0')
    expect(result.id).toBe('item0')

    // Verify nesting depth
    let current: NounIdRef | undefined = result
    let depth = 0
    while (current) {
      depth++
      current = current.path
    }
    expect(depth).toBe(10)
  })

  it('handles very long branch names', () => {
    const longBranch = 'feature-' + 'x'.repeat(200)
    const result = parseNounId(`Startup/acme@${longBranch}`)

    expect(result.branch).toBe(longBranch)
  })
})
