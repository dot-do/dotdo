/**
 * Targeting Operators Tests
 *
 * RED phase tests for all targeting operators used in flag evaluation.
 * These tests define the expected behavior for each operator type.
 *
 * @module @dotdo/compat/flags/operators.test
 */

import { describe, it, expect } from 'vitest'
import { evaluate, matchesTargeting, type TargetingRule } from './evaluation'
import type { FlagDefinition, EvaluationContext, TargetingClause } from './types'

// Helper to create a simple test flag with a single targeting rule
function createTestFlag<T>(
  defaultValue: T,
  variations: T[],
  clause: TargetingClause
): FlagDefinition<T> {
  return {
    key: 'test-flag',
    defaultValue,
    variations: variations.map((v, i) => ({ value: v, label: `Variant ${i}` })),
    targeting: {
      rules: [
        {
          id: 'test-rule',
          clauses: [clause],
          variation: 0, // Return first variation when clause matches
        },
      ],
    },
  }
}

// Helper to test clause matching directly
function testClause(clause: TargetingClause, context: EvaluationContext): boolean {
  const rule: TargetingRule = {
    id: 'test-rule',
    clauses: [clause],
    variation: 0,
  }
  return matchesTargeting(rule, context)
}

describe('Targeting Operators', () => {
  // ==========================================================================
  // MEMBERSHIP OPERATORS
  // ==========================================================================

  describe('Membership Operators', () => {
    describe('in operator', () => {
      it('should match when value is in the list', () => {
        const clause: TargetingClause = {
          attribute: 'country',
          operator: 'in',
          values: ['US', 'CA', 'UK'],
        }

        expect(testClause(clause, { country: 'US' })).toBe(true)
        expect(testClause(clause, { country: 'CA' })).toBe(true)
        expect(testClause(clause, { country: 'UK' })).toBe(true)
      })

      it('should not match when value is not in the list', () => {
        const clause: TargetingClause = {
          attribute: 'country',
          operator: 'in',
          values: ['US', 'CA', 'UK'],
        }

        expect(testClause(clause, { country: 'DE' })).toBe(false)
        expect(testClause(clause, { country: 'FR' })).toBe(false)
      })

      it('should handle numeric values', () => {
        const clause: TargetingClause = {
          attribute: 'tier',
          operator: 'in',
          values: [1, 2, 3],
        }

        expect(testClause(clause, { tier: 1 })).toBe(true)
        expect(testClause(clause, { tier: 4 })).toBe(false)
      })

      it('should handle boolean values', () => {
        const clause: TargetingClause = {
          attribute: 'beta',
          operator: 'in',
          values: [true],
        }

        expect(testClause(clause, { beta: true })).toBe(true)
        expect(testClause(clause, { beta: false })).toBe(false)
      })

      it('should not match when attribute is missing', () => {
        const clause: TargetingClause = {
          attribute: 'country',
          operator: 'in',
          values: ['US'],
        }

        expect(testClause(clause, {})).toBe(false)
      })

      it('should handle null values in list', () => {
        const clause: TargetingClause = {
          attribute: 'optional',
          operator: 'in',
          values: [null, 'default'],
        }

        expect(testClause(clause, { optional: null })).toBe(true)
        expect(testClause(clause, { optional: 'default' })).toBe(true)
      })

      it('should handle empty list', () => {
        const clause: TargetingClause = {
          attribute: 'country',
          operator: 'in',
          values: [],
        }

        expect(testClause(clause, { country: 'US' })).toBe(false)
      })
    })

    describe('notIn operator', () => {
      it('should match when value is not in the list', () => {
        const clause: TargetingClause = {
          attribute: 'country',
          operator: 'notIn',
          values: ['US', 'CA', 'UK'],
        }

        expect(testClause(clause, { country: 'DE' })).toBe(true)
        expect(testClause(clause, { country: 'FR' })).toBe(true)
      })

      it('should not match when value is in the list', () => {
        const clause: TargetingClause = {
          attribute: 'country',
          operator: 'notIn',
          values: ['US', 'CA', 'UK'],
        }

        expect(testClause(clause, { country: 'US' })).toBe(false)
        expect(testClause(clause, { country: 'CA' })).toBe(false)
      })

      it('should match when attribute is missing (not in any list)', () => {
        const clause: TargetingClause = {
          attribute: 'country',
          operator: 'notIn',
          values: ['US', 'CA'],
        }

        // Missing attribute is undefined, which is not in the list
        expect(testClause(clause, {})).toBe(true)
      })

      it('should handle empty list (everything matches)', () => {
        const clause: TargetingClause = {
          attribute: 'country',
          operator: 'notIn',
          values: [],
        }

        expect(testClause(clause, { country: 'US' })).toBe(true)
        expect(testClause(clause, { country: 'DE' })).toBe(true)
      })
    })
  })

  // ==========================================================================
  // STRING OPERATORS
  // ==========================================================================

  describe('String Operators', () => {
    describe('contains operator', () => {
      it('should match when string contains substring', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'contains',
          values: ['@example.com'],
        }

        expect(testClause(clause, { email: 'user@example.com' })).toBe(true)
        expect(testClause(clause, { email: 'admin@example.com' })).toBe(true)
      })

      it('should not match when string does not contain substring', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'contains',
          values: ['@example.com'],
        }

        expect(testClause(clause, { email: 'user@other.com' })).toBe(false)
      })

      it('should match any value in the list', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'contains',
          values: ['@example.com', '@test.com'],
        }

        expect(testClause(clause, { email: 'user@example.com' })).toBe(true)
        expect(testClause(clause, { email: 'user@test.com' })).toBe(true)
        expect(testClause(clause, { email: 'user@other.com' })).toBe(false)
      })

      it('should be case-sensitive by default', () => {
        const clause: TargetingClause = {
          attribute: 'name',
          operator: 'contains',
          values: ['Admin'],
        }

        expect(testClause(clause, { name: 'Admin User' })).toBe(true)
        expect(testClause(clause, { name: 'admin user' })).toBe(false)
      })

      it('should not match non-string values', () => {
        const clause: TargetingClause = {
          attribute: 'value',
          operator: 'contains',
          values: ['test'],
        }

        expect(testClause(clause, { value: 123 })).toBe(false)
        expect(testClause(clause, { value: true })).toBe(false)
        expect(testClause(clause, { value: null })).toBe(false)
      })
    })

    describe('startsWith operator', () => {
      it('should match when string starts with prefix', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'startsWith',
          values: ['admin@'],
        }

        expect(testClause(clause, { email: 'admin@example.com' })).toBe(true)
        expect(testClause(clause, { email: 'admin@other.com' })).toBe(true)
      })

      it('should not match when string does not start with prefix', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'startsWith',
          values: ['admin@'],
        }

        expect(testClause(clause, { email: 'user@example.com' })).toBe(false)
        expect(testClause(clause, { email: 'superadmin@example.com' })).toBe(false)
      })

      it('should match any prefix in the list', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'startsWith',
          values: ['admin@', 'support@'],
        }

        expect(testClause(clause, { email: 'admin@example.com' })).toBe(true)
        expect(testClause(clause, { email: 'support@example.com' })).toBe(true)
        expect(testClause(clause, { email: 'user@example.com' })).toBe(false)
      })

      it('should be case-sensitive', () => {
        const clause: TargetingClause = {
          attribute: 'path',
          operator: 'startsWith',
          values: ['/Admin'],
        }

        expect(testClause(clause, { path: '/Admin/users' })).toBe(true)
        expect(testClause(clause, { path: '/admin/users' })).toBe(false)
      })
    })

    describe('endsWith operator', () => {
      it('should match when string ends with suffix', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'endsWith',
          values: ['@example.com'],
        }

        expect(testClause(clause, { email: 'user@example.com' })).toBe(true)
        expect(testClause(clause, { email: 'admin@example.com' })).toBe(true)
      })

      it('should not match when string does not end with suffix', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'endsWith',
          values: ['@example.com'],
        }

        expect(testClause(clause, { email: 'user@example.org' })).toBe(false)
        expect(testClause(clause, { email: 'user@example.com.uk' })).toBe(false)
      })

      it('should match any suffix in the list', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'endsWith',
          values: ['.com', '.org'],
        }

        expect(testClause(clause, { email: 'user@example.com' })).toBe(true)
        expect(testClause(clause, { email: 'user@example.org' })).toBe(true)
        expect(testClause(clause, { email: 'user@example.net' })).toBe(false)
      })
    })

    describe('matches operator (regex)', () => {
      it('should match when string matches regex pattern', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'matches',
          values: ['^[a-z]+@example\\.com$'],
        }

        expect(testClause(clause, { email: 'user@example.com' })).toBe(true)
        expect(testClause(clause, { email: 'admin@example.com' })).toBe(true)
      })

      it('should not match when string does not match regex', () => {
        const clause: TargetingClause = {
          attribute: 'email',
          operator: 'matches',
          values: ['^[a-z]+@example\\.com$'],
        }

        expect(testClause(clause, { email: 'User@example.com' })).toBe(false) // Capital letter
        expect(testClause(clause, { email: 'user@other.com' })).toBe(false)
      })

      it('should match any pattern in the list', () => {
        const clause: TargetingClause = {
          attribute: 'id',
          operator: 'matches',
          values: ['^user-\\d+$', '^admin-\\d+$'],
        }

        expect(testClause(clause, { id: 'user-123' })).toBe(true)
        expect(testClause(clause, { id: 'admin-456' })).toBe(true)
        expect(testClause(clause, { id: 'guest-789' })).toBe(false)
      })

      it('should handle complex regex patterns', () => {
        const clause: TargetingClause = {
          attribute: 'version',
          operator: 'matches',
          values: ['^v?\\d+\\.\\d+\\.\\d+(-[a-z]+)?$'],
        }

        expect(testClause(clause, { version: '1.0.0' })).toBe(true)
        expect(testClause(clause, { version: 'v2.1.0' })).toBe(true)
        expect(testClause(clause, { version: '1.0.0-beta' })).toBe(true)
        expect(testClause(clause, { version: '1.0' })).toBe(false)
      })

      it('should handle invalid regex patterns gracefully', () => {
        const clause: TargetingClause = {
          attribute: 'value',
          operator: 'matches',
          values: ['[invalid(regex'],
        }

        // Should not throw, just return false
        expect(testClause(clause, { value: 'test' })).toBe(false)
      })
    })
  })

  // ==========================================================================
  // NUMERIC OPERATORS
  // ==========================================================================

  describe('Numeric Operators', () => {
    describe('lessThan operator', () => {
      it('should match when value is less than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'age',
          operator: 'lessThan',
          values: [18],
        }

        expect(testClause(clause, { age: 17 })).toBe(true)
        expect(testClause(clause, { age: 10 })).toBe(true)
        expect(testClause(clause, { age: 0 })).toBe(true)
      })

      it('should not match when value is equal to or greater than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'age',
          operator: 'lessThan',
          values: [18],
        }

        expect(testClause(clause, { age: 18 })).toBe(false)
        expect(testClause(clause, { age: 21 })).toBe(false)
      })

      it('should handle negative numbers', () => {
        const clause: TargetingClause = {
          attribute: 'temperature',
          operator: 'lessThan',
          values: [0],
        }

        expect(testClause(clause, { temperature: -10 })).toBe(true)
        expect(testClause(clause, { temperature: 0 })).toBe(false)
        expect(testClause(clause, { temperature: 10 })).toBe(false)
      })

      it('should handle floating point numbers', () => {
        const clause: TargetingClause = {
          attribute: 'score',
          operator: 'lessThan',
          values: [3.14],
        }

        expect(testClause(clause, { score: 3.13 })).toBe(true)
        expect(testClause(clause, { score: 3.14 })).toBe(false)
        expect(testClause(clause, { score: 3.15 })).toBe(false)
      })

      it('should not match non-numeric values', () => {
        const clause: TargetingClause = {
          attribute: 'value',
          operator: 'lessThan',
          values: [10],
        }

        expect(testClause(clause, { value: 'string' })).toBe(false)
        expect(testClause(clause, { value: true })).toBe(false)
        expect(testClause(clause, { value: null })).toBe(false)
      })
    })

    describe('lessThanOrEqual operator', () => {
      it('should match when value is less than or equal to threshold', () => {
        const clause: TargetingClause = {
          attribute: 'age',
          operator: 'lessThanOrEqual',
          values: [18],
        }

        expect(testClause(clause, { age: 17 })).toBe(true)
        expect(testClause(clause, { age: 18 })).toBe(true)
      })

      it('should not match when value is greater than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'age',
          operator: 'lessThanOrEqual',
          values: [18],
        }

        expect(testClause(clause, { age: 19 })).toBe(false)
        expect(testClause(clause, { age: 21 })).toBe(false)
      })
    })

    describe('greaterThan operator', () => {
      it('should match when value is greater than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'age',
          operator: 'greaterThan',
          values: [18],
        }

        expect(testClause(clause, { age: 19 })).toBe(true)
        expect(testClause(clause, { age: 21 })).toBe(true)
      })

      it('should not match when value is equal to or less than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'age',
          operator: 'greaterThan',
          values: [18],
        }

        expect(testClause(clause, { age: 18 })).toBe(false)
        expect(testClause(clause, { age: 17 })).toBe(false)
      })

      it('should handle negative numbers', () => {
        const clause: TargetingClause = {
          attribute: 'temperature',
          operator: 'greaterThan',
          values: [-10],
        }

        expect(testClause(clause, { temperature: -5 })).toBe(true)
        expect(testClause(clause, { temperature: 0 })).toBe(true)
        expect(testClause(clause, { temperature: -10 })).toBe(false)
        expect(testClause(clause, { temperature: -15 })).toBe(false)
      })
    })

    describe('greaterThanOrEqual operator', () => {
      it('should match when value is greater than or equal to threshold', () => {
        const clause: TargetingClause = {
          attribute: 'age',
          operator: 'greaterThanOrEqual',
          values: [18],
        }

        expect(testClause(clause, { age: 18 })).toBe(true)
        expect(testClause(clause, { age: 19 })).toBe(true)
        expect(testClause(clause, { age: 21 })).toBe(true)
      })

      it('should not match when value is less than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'age',
          operator: 'greaterThanOrEqual',
          values: [18],
        }

        expect(testClause(clause, { age: 17 })).toBe(false)
        expect(testClause(clause, { age: 10 })).toBe(false)
      })
    })
  })

  // ==========================================================================
  // DATE OPERATORS
  // ==========================================================================

  describe('Date Operators', () => {
    describe('before operator', () => {
      it('should match when date is before threshold', () => {
        const clause: TargetingClause = {
          attribute: 'createdAt',
          operator: 'before',
          values: ['2024-01-01T00:00:00Z'],
        }

        expect(testClause(clause, { createdAt: '2023-12-31T23:59:59Z' })).toBe(true)
        expect(testClause(clause, { createdAt: '2023-06-15T12:00:00Z' })).toBe(true)
      })

      it('should not match when date is equal to or after threshold', () => {
        const clause: TargetingClause = {
          attribute: 'createdAt',
          operator: 'before',
          values: ['2024-01-01T00:00:00Z'],
        }

        expect(testClause(clause, { createdAt: '2024-01-01T00:00:00Z' })).toBe(false)
        expect(testClause(clause, { createdAt: '2024-01-02T00:00:00Z' })).toBe(false)
      })

      it('should handle Date objects', () => {
        const clause: TargetingClause = {
          attribute: 'createdAt',
          operator: 'before',
          values: ['2024-01-01T00:00:00Z'],
        }

        expect(testClause(clause, { createdAt: new Date('2023-12-31T23:59:59Z') })).toBe(true)
        expect(testClause(clause, { createdAt: new Date('2024-01-02T00:00:00Z') })).toBe(false)
      })

      it('should handle Unix timestamps (milliseconds)', () => {
        const clause: TargetingClause = {
          attribute: 'timestamp',
          operator: 'before',
          values: [1704067200000], // 2024-01-01T00:00:00Z in milliseconds
        }

        expect(testClause(clause, { timestamp: 1704067199000 })).toBe(true) // 1 second before
        expect(testClause(clause, { timestamp: 1704067200000 })).toBe(false) // Equal
        expect(testClause(clause, { timestamp: 1704067201000 })).toBe(false) // 1 second after
      })
    })

    describe('after operator', () => {
      it('should match when date is after threshold', () => {
        const clause: TargetingClause = {
          attribute: 'createdAt',
          operator: 'after',
          values: ['2024-01-01T00:00:00Z'],
        }

        expect(testClause(clause, { createdAt: '2024-01-01T00:00:01Z' })).toBe(true)
        expect(testClause(clause, { createdAt: '2024-06-15T12:00:00Z' })).toBe(true)
      })

      it('should not match when date is equal to or before threshold', () => {
        const clause: TargetingClause = {
          attribute: 'createdAt',
          operator: 'after',
          values: ['2024-01-01T00:00:00Z'],
        }

        expect(testClause(clause, { createdAt: '2024-01-01T00:00:00Z' })).toBe(false)
        expect(testClause(clause, { createdAt: '2023-12-31T23:59:59Z' })).toBe(false)
      })

      it('should handle Date objects', () => {
        const clause: TargetingClause = {
          attribute: 'createdAt',
          operator: 'after',
          values: ['2024-01-01T00:00:00Z'],
        }

        expect(testClause(clause, { createdAt: new Date('2024-01-02T00:00:00Z') })).toBe(true)
        expect(testClause(clause, { createdAt: new Date('2023-12-31T23:59:59Z') })).toBe(false)
      })

      it('should handle Unix timestamps', () => {
        const clause: TargetingClause = {
          attribute: 'timestamp',
          operator: 'after',
          values: [1704067200000],
        }

        expect(testClause(clause, { timestamp: 1704067201000 })).toBe(true)
        expect(testClause(clause, { timestamp: 1704067200000 })).toBe(false)
        expect(testClause(clause, { timestamp: 1704067199000 })).toBe(false)
      })
    })
  })

  // ==========================================================================
  // SEMANTIC VERSION OPERATORS
  // ==========================================================================

  describe('Semantic Version Operators', () => {
    describe('semVerEqual operator', () => {
      it('should match exact version', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerEqual',
          values: ['2.0.0'],
        }

        expect(testClause(clause, { appVersion: '2.0.0' })).toBe(true)
      })

      it('should not match different versions', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerEqual',
          values: ['2.0.0'],
        }

        expect(testClause(clause, { appVersion: '2.0.1' })).toBe(false)
        expect(testClause(clause, { appVersion: '2.1.0' })).toBe(false)
        expect(testClause(clause, { appVersion: '3.0.0' })).toBe(false)
        expect(testClause(clause, { appVersion: '1.9.9' })).toBe(false)
      })

      it('should handle versions with v prefix', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerEqual',
          values: ['2.0.0'],
        }

        expect(testClause(clause, { appVersion: 'v2.0.0' })).toBe(true)
      })

      it('should handle prerelease versions', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerEqual',
          values: ['2.0.0-beta.1'],
        }

        expect(testClause(clause, { appVersion: '2.0.0-beta.1' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.0.0-beta.2' })).toBe(false)
        expect(testClause(clause, { appVersion: '2.0.0' })).toBe(false)
      })

      it('should match any version in the list', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerEqual',
          values: ['1.0.0', '2.0.0', '3.0.0'],
        }

        expect(testClause(clause, { appVersion: '1.0.0' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.0.0' })).toBe(true)
        expect(testClause(clause, { appVersion: '3.0.0' })).toBe(true)
        expect(testClause(clause, { appVersion: '4.0.0' })).toBe(false)
      })
    })

    describe('semVerLessThan operator', () => {
      it('should match when version is less than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerLessThan',
          values: ['2.0.0'],
        }

        expect(testClause(clause, { appVersion: '1.9.9' })).toBe(true)
        expect(testClause(clause, { appVersion: '1.0.0' })).toBe(true)
        expect(testClause(clause, { appVersion: '0.9.0' })).toBe(true)
      })

      it('should not match when version is equal to or greater than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerLessThan',
          values: ['2.0.0'],
        }

        expect(testClause(clause, { appVersion: '2.0.0' })).toBe(false)
        expect(testClause(clause, { appVersion: '2.0.1' })).toBe(false)
        expect(testClause(clause, { appVersion: '3.0.0' })).toBe(false)
      })

      it('should compare major version first', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerLessThan',
          values: ['2.0.0'],
        }

        expect(testClause(clause, { appVersion: '1.99.99' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.0.0' })).toBe(false)
      })

      it('should compare minor version second', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerLessThan',
          values: ['2.5.0'],
        }

        expect(testClause(clause, { appVersion: '2.4.99' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.5.0' })).toBe(false)
      })

      it('should compare patch version last', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerLessThan',
          values: ['2.5.10'],
        }

        expect(testClause(clause, { appVersion: '2.5.9' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.5.10' })).toBe(false)
      })

      it('should handle prerelease versions correctly', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerLessThan',
          values: ['2.0.0'],
        }

        // Prerelease versions are less than the release version
        expect(testClause(clause, { appVersion: '2.0.0-alpha' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.0.0-beta' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.0.0-rc.1' })).toBe(true)
      })
    })

    describe('semVerGreaterThan operator', () => {
      it('should match when version is greater than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerGreaterThan',
          values: ['2.0.0'],
        }

        expect(testClause(clause, { appVersion: '2.0.1' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.1.0' })).toBe(true)
        expect(testClause(clause, { appVersion: '3.0.0' })).toBe(true)
      })

      it('should not match when version is equal to or less than threshold', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerGreaterThan',
          values: ['2.0.0'],
        }

        expect(testClause(clause, { appVersion: '2.0.0' })).toBe(false)
        expect(testClause(clause, { appVersion: '1.9.9' })).toBe(false)
        expect(testClause(clause, { appVersion: '1.0.0' })).toBe(false)
      })

      it('should handle prerelease versions correctly', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerGreaterThan',
          values: ['2.0.0-alpha'],
        }

        expect(testClause(clause, { appVersion: '2.0.0-beta' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.0.0' })).toBe(true)
      })

      it('should handle build metadata', () => {
        const clause: TargetingClause = {
          attribute: 'appVersion',
          operator: 'semVerGreaterThan',
          values: ['2.0.0'],
        }

        // Build metadata should be ignored in comparison
        expect(testClause(clause, { appVersion: '2.0.1+build.123' })).toBe(true)
        expect(testClause(clause, { appVersion: '2.0.0+build.123' })).toBe(false)
      })
    })
  })

  // ==========================================================================
  // SEGMENT OPERATOR
  // ==========================================================================

  describe('Segment Operator', () => {
    describe('segmentMatch operator', () => {
      it('should match when user is in segment', async () => {
        // Create a flag that uses segment matching
        const flag: FlagDefinition<boolean> = {
          key: 'segment-test-flag',
          defaultValue: false,
          variations: [
            { value: true, label: 'On' },
            { value: false, label: 'Off' },
          ],
          targeting: {
            rules: [
              {
                id: 'segment-rule',
                clauses: [
                  {
                    attribute: 'segments',
                    operator: 'segmentMatch',
                    values: ['beta-users', 'premium-users'],
                  },
                ],
                variation: 0,
              },
            ],
          },
        }

        // Context includes segment membership
        const context: EvaluationContext = {
          targetingKey: 'user-123',
          segments: ['beta-users', 'early-adopters'],
        }

        const result = await evaluate('segment-test-flag', false, context, flag)

        expect(result.value).toBe(true)
        expect(result.reason).toBe('TARGETING_MATCH')
      })

      it('should not match when user is not in any specified segment', async () => {
        const flag: FlagDefinition<boolean> = {
          key: 'segment-test-flag',
          defaultValue: false,
          variations: [
            { value: true, label: 'On' },
            { value: false, label: 'Off' },
          ],
          targeting: {
            rules: [
              {
                id: 'segment-rule',
                clauses: [
                  {
                    attribute: 'segments',
                    operator: 'segmentMatch',
                    values: ['beta-users', 'premium-users'],
                  },
                ],
                variation: 0,
              },
            ],
          },
        }

        const context: EvaluationContext = {
          targetingKey: 'user-123',
          segments: ['regular-users'],
        }

        const result = await evaluate('segment-test-flag', false, context, flag)

        expect(result.value).toBe(false)
        expect(result.reason).not.toBe('TARGETING_MATCH')
      })

      it('should handle missing segments attribute', async () => {
        const flag: FlagDefinition<boolean> = {
          key: 'segment-test-flag',
          defaultValue: false,
          variations: [
            { value: true, label: 'On' },
            { value: false, label: 'Off' },
          ],
          targeting: {
            rules: [
              {
                id: 'segment-rule',
                clauses: [
                  {
                    attribute: 'segments',
                    operator: 'segmentMatch',
                    values: ['beta-users'],
                  },
                ],
                variation: 0,
              },
            ],
          },
        }

        const context: EvaluationContext = {
          targetingKey: 'user-123',
          // No segments attribute
        }

        const result = await evaluate('segment-test-flag', false, context, flag)

        expect(result.value).toBe(false)
        expect(result.reason).not.toBe('TARGETING_MATCH')
      })

      it('should match multiple segments with OR logic', async () => {
        const clause: TargetingClause = {
          attribute: 'segments',
          operator: 'segmentMatch',
          values: ['beta-users', 'premium-users', 'enterprise-users'],
        }

        // User in only one of the segments
        expect(testClause(clause, { segments: ['beta-users'] })).toBe(true)
        expect(testClause(clause, { segments: ['premium-users'] })).toBe(true)

        // User in multiple segments
        expect(testClause(clause, { segments: ['beta-users', 'premium-users'] })).toBe(true)

        // User in no matching segments
        expect(testClause(clause, { segments: ['free-users'] })).toBe(false)
      })
    })
  })

  // ==========================================================================
  // OPERATOR NEGATION
  // ==========================================================================

  describe('Operator Negation', () => {
    it('should negate in operator', () => {
      const clause: TargetingClause = {
        attribute: 'country',
        operator: 'in',
        values: ['US', 'CA'],
        negate: true,
      }

      expect(testClause(clause, { country: 'US' })).toBe(false)
      expect(testClause(clause, { country: 'DE' })).toBe(true)
    })

    it('should negate contains operator', () => {
      const clause: TargetingClause = {
        attribute: 'email',
        operator: 'contains',
        values: ['@internal.com'],
        negate: true,
      }

      expect(testClause(clause, { email: 'user@internal.com' })).toBe(false)
      expect(testClause(clause, { email: 'user@external.com' })).toBe(true)
    })

    it('should negate lessThan operator', () => {
      const clause: TargetingClause = {
        attribute: 'age',
        operator: 'lessThan',
        values: [18],
        negate: true,
      }

      expect(testClause(clause, { age: 17 })).toBe(false)
      expect(testClause(clause, { age: 18 })).toBe(true)
      expect(testClause(clause, { age: 21 })).toBe(true)
    })

    it('should negate matches operator', () => {
      const clause: TargetingClause = {
        attribute: 'id',
        operator: 'matches',
        values: ['^test-'],
        negate: true,
      }

      expect(testClause(clause, { id: 'test-123' })).toBe(false)
      expect(testClause(clause, { id: 'prod-123' })).toBe(true)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle undefined attribute value', () => {
      const clause: TargetingClause = {
        attribute: 'optional',
        operator: 'in',
        values: [undefined],
      }

      expect(testClause(clause, { optional: undefined })).toBe(true)
      expect(testClause(clause, {})).toBe(false) // Missing vs explicitly undefined
    })

    it('should handle empty string comparisons', () => {
      const clause: TargetingClause = {
        attribute: 'name',
        operator: 'in',
        values: [''],
      }

      expect(testClause(clause, { name: '' })).toBe(true)
      expect(testClause(clause, { name: 'nonempty' })).toBe(false)
    })

    it('should handle array values in context (for segment matching)', () => {
      const clause: TargetingClause = {
        attribute: 'tags',
        operator: 'in',
        values: ['premium'],
      }

      // When context has array, check if values contains any element from array
      // This behavior may need special handling in the implementation
      expect(testClause(clause, { tags: ['premium', 'beta'] })).toBe(true)
    })

    it('should handle special characters in string operators', () => {
      const clause: TargetingClause = {
        attribute: 'path',
        operator: 'startsWith',
        values: ['/api/v1/'],
      }

      expect(testClause(clause, { path: '/api/v1/users' })).toBe(true)
      expect(testClause(clause, { path: '/api/v2/users' })).toBe(false)
    })

    it('should handle NaN in numeric comparisons', () => {
      const clause: TargetingClause = {
        attribute: 'score',
        operator: 'greaterThan',
        values: [0],
      }

      expect(testClause(clause, { score: NaN })).toBe(false)
    })

    it('should handle Infinity in numeric comparisons', () => {
      const clause: TargetingClause = {
        attribute: 'limit',
        operator: 'greaterThan',
        values: [1000000],
      }

      expect(testClause(clause, { limit: Infinity })).toBe(true)
      expect(testClause(clause, { limit: -Infinity })).toBe(false)
    })
  })
})
