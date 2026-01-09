import { describe, it, expect } from 'vitest'

/**
 * RED Phase Tests for Feature Flag Filter Matching
 *
 * These tests define the expected behavior for filter matching in feature flags.
 * They will FAIL until the evaluateFlag implementation is created.
 *
 * Filters allow targeting specific users based on:
 * - Property filters: Match user properties with various operators
 * - Cohort filters: Match user membership in cohorts
 *
 * Multiple filters use AND logic (all must match for the flag to be enabled).
 */

// Import evaluateFlag from workflows/flags.ts (doesn't exist yet)
import { evaluateFlag } from '../../workflows/flags'

// Type definitions for the tests
interface PropertyFilter {
  type: 'property'
  property: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
  value: string | number | boolean | string[] | number[]
}

interface CohortFilter {
  type: 'cohort'
  cohortId: string
}

type Filter = PropertyFilter | CohortFilter

interface FlagConfig {
  id: string
  traffic: number
  filters?: Filter[]
}

interface EvaluationContext {
  userId: string
  properties?: Record<string, string | number | boolean>
  cohorts?: string[]
}

interface EvaluationResult {
  enabled: boolean
  reason?: string
}

describe('Filter Matching', () => {
  /**
   * Property eq filter tests
   *
   * The 'eq' operator should match when the property value exactly equals the filter value.
   */
  describe('property eq filter', () => {
    it('matches when property equals filter value', () => {
      const flag: FlagConfig = {
        id: 'pro-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'plan', operator: 'eq', value: 'pro' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'pro' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('excludes when property does not equal filter value', () => {
      const flag: FlagConfig = {
        id: 'pro-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'plan', operator: 'eq', value: 'pro' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'free' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('matches boolean property values', () => {
      const flag: FlagConfig = {
        id: 'verified-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'verified', operator: 'eq', value: true }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { verified: true },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('matches numeric property values', () => {
      const flag: FlagConfig = {
        id: 'tier-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'tier', operator: 'eq', value: 3 }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { tier: 3 },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })
  })

  /**
   * Property gt/lt filter tests
   *
   * Numeric comparison operators for targeting based on thresholds.
   */
  describe('property gt/lt filters', () => {
    it('gt matches when property is greater than value', () => {
      const flag: FlagConfig = {
        id: 'high-usage-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'usage', operator: 'gt', value: 100 }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { usage: 150 },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('gt excludes when property is equal to value', () => {
      const flag: FlagConfig = {
        id: 'high-usage-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'usage', operator: 'gt', value: 100 }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { usage: 100 },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('gt excludes when property is less than value', () => {
      const flag: FlagConfig = {
        id: 'high-usage-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'usage', operator: 'gt', value: 100 }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { usage: 50 },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('lt matches when property is less than value', () => {
      const flag: FlagConfig = {
        id: 'low-usage-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'usage', operator: 'lt', value: 100 }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { usage: 50 },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('lt excludes when property is equal to value', () => {
      const flag: FlagConfig = {
        id: 'low-usage-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'usage', operator: 'lt', value: 100 }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { usage: 100 },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('lt excludes when property is greater than value', () => {
      const flag: FlagConfig = {
        id: 'low-usage-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'usage', operator: 'lt', value: 100 }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { usage: 150 },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('gte matches when property is greater than or equal to value', () => {
      const flag: FlagConfig = {
        id: 'gte-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'score', operator: 'gte', value: 80 }],
      }

      const contextEqual: EvaluationContext = {
        userId: 'user-123',
        properties: { score: 80 },
      }

      const contextGreater: EvaluationContext = {
        userId: 'user-456',
        properties: { score: 90 },
      }

      expect(evaluateFlag(flag, contextEqual).enabled).toBe(true)
      expect(evaluateFlag(flag, contextGreater).enabled).toBe(true)
    })

    it('lte matches when property is less than or equal to value', () => {
      const flag: FlagConfig = {
        id: 'lte-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'score', operator: 'lte', value: 80 }],
      }

      const contextEqual: EvaluationContext = {
        userId: 'user-123',
        properties: { score: 80 },
      }

      const contextLess: EvaluationContext = {
        userId: 'user-456',
        properties: { score: 70 },
      }

      expect(evaluateFlag(flag, contextEqual).enabled).toBe(true)
      expect(evaluateFlag(flag, contextLess).enabled).toBe(true)
    })
  })

  /**
   * Property in filter tests
   *
   * The 'in' operator checks if the property value is in an array of allowed values.
   */
  describe('property in filter', () => {
    it('matches when property is in the allowed values array', () => {
      const flag: FlagConfig = {
        id: 'region-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'region', operator: 'in', value: ['us', 'eu'] }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { region: 'us' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('matches when property is another value in the allowed array', () => {
      const flag: FlagConfig = {
        id: 'region-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'region', operator: 'in', value: ['us', 'eu'] }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { region: 'eu' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('excludes when property is not in the allowed values array', () => {
      const flag: FlagConfig = {
        id: 'region-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'region', operator: 'in', value: ['us', 'eu'] }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { region: 'asia' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('works with numeric values in array', () => {
      const flag: FlagConfig = {
        id: 'tier-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'tier', operator: 'in', value: [1, 2, 3] }],
      }

      const contextMatches: EvaluationContext = {
        userId: 'user-123',
        properties: { tier: 2 },
      }

      const contextNoMatch: EvaluationContext = {
        userId: 'user-456',
        properties: { tier: 5 },
      }

      expect(evaluateFlag(flag, contextMatches).enabled).toBe(true)
      expect(evaluateFlag(flag, contextNoMatch).enabled).toBe(false)
    })
  })

  /**
   * Property contains filter tests
   *
   * The 'contains' operator checks if the property value contains the filter value as a substring.
   */
  describe('property contains filter', () => {
    it('matches when property contains the substring', () => {
      const flag: FlagConfig = {
        id: 'email-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'email', operator: 'contains', value: '@company.com' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { email: 'john@company.com' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('excludes when property does not contain the substring', () => {
      const flag: FlagConfig = {
        id: 'email-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'email', operator: 'contains', value: '@company.com' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { email: 'john@gmail.com' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('is case-sensitive by default', () => {
      const flag: FlagConfig = {
        id: 'domain-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'domain', operator: 'contains', value: 'ACME' }],
      }

      const contextUppercase: EvaluationContext = {
        userId: 'user-123',
        properties: { domain: 'ACME Corp' },
      }

      const contextLowercase: EvaluationContext = {
        userId: 'user-456',
        properties: { domain: 'acme corp' },
      }

      expect(evaluateFlag(flag, contextUppercase).enabled).toBe(true)
      expect(evaluateFlag(flag, contextLowercase).enabled).toBe(false)
    })

    it('matches partial string anywhere in value', () => {
      const flag: FlagConfig = {
        id: 'tag-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'tags', operator: 'contains', value: 'beta' }],
      }

      const contextStart: EvaluationContext = {
        userId: 'user-1',
        properties: { tags: 'beta-user' },
      }

      const contextMiddle: EvaluationContext = {
        userId: 'user-2',
        properties: { tags: 'early-beta-access' },
      }

      const contextEnd: EvaluationContext = {
        userId: 'user-3',
        properties: { tags: 'internal-beta' },
      }

      expect(evaluateFlag(flag, contextStart).enabled).toBe(true)
      expect(evaluateFlag(flag, contextMiddle).enabled).toBe(true)
      expect(evaluateFlag(flag, contextEnd).enabled).toBe(true)
    })
  })

  /**
   * Multiple filters AND logic tests
   *
   * When multiple filters are specified, ALL must match for the flag to be enabled.
   */
  describe('multiple filters AND logic', () => {
    it('matches when all filters match', () => {
      const flag: FlagConfig = {
        id: 'premium-feature',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
          { type: 'property', property: 'verified', operator: 'eq', value: true },
        ],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'pro', verified: true },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('excludes when first filter does not match', () => {
      const flag: FlagConfig = {
        id: 'premium-feature',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
          { type: 'property', property: 'verified', operator: 'eq', value: true },
        ],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'free', verified: true },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('excludes when second filter does not match', () => {
      const flag: FlagConfig = {
        id: 'premium-feature',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
          { type: 'property', property: 'verified', operator: 'eq', value: true },
        ],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'pro', verified: false },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('excludes when no filters match', () => {
      const flag: FlagConfig = {
        id: 'premium-feature',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
          { type: 'property', property: 'verified', operator: 'eq', value: true },
        ],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'free', verified: false },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('works with three or more filters', () => {
      const flag: FlagConfig = {
        id: 'ultra-premium-feature',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'enterprise' },
          { type: 'property', property: 'verified', operator: 'eq', value: true },
          { type: 'property', property: 'usage', operator: 'gt', value: 1000 },
        ],
      }

      const contextAllMatch: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'enterprise', verified: true, usage: 1500 },
      }

      const contextOneNoMatch: EvaluationContext = {
        userId: 'user-456',
        properties: { plan: 'enterprise', verified: true, usage: 500 },
      }

      expect(evaluateFlag(flag, contextAllMatch).enabled).toBe(true)
      expect(evaluateFlag(flag, contextOneNoMatch).enabled).toBe(false)
    })

    it('works with mixed filter types (property and cohort)', () => {
      const flag: FlagConfig = {
        id: 'beta-pro-feature',
        traffic: 1.0,
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'pro' },
          { type: 'cohort', cohortId: 'beta-testers' },
        ],
      }

      const contextAllMatch: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'pro' },
        cohorts: ['beta-testers', 'newsletter'],
      }

      const contextNoCohort: EvaluationContext = {
        userId: 'user-456',
        properties: { plan: 'pro' },
        cohorts: ['newsletter'],
      }

      expect(evaluateFlag(flag, contextAllMatch).enabled).toBe(true)
      expect(evaluateFlag(flag, contextNoCohort).enabled).toBe(false)
    })
  })

  /**
   * Cohort filter tests
   *
   * Cohort filters check if the user is a member of a specific cohort.
   */
  describe('cohort filter', () => {
    it('matches when user is in the cohort', () => {
      const flag: FlagConfig = {
        id: 'enterprise-feature',
        traffic: 1.0,
        filters: [{ type: 'cohort', cohortId: 'enterprise-users' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        cohorts: ['enterprise-users', 'beta-testers'],
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('excludes when user is not in the cohort', () => {
      const flag: FlagConfig = {
        id: 'enterprise-feature',
        traffic: 1.0,
        filters: [{ type: 'cohort', cohortId: 'enterprise-users' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        cohorts: ['beta-testers', 'newsletter'],
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('excludes when user has no cohorts', () => {
      const flag: FlagConfig = {
        id: 'enterprise-feature',
        traffic: 1.0,
        filters: [{ type: 'cohort', cohortId: 'enterprise-users' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        cohorts: [],
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('excludes when cohorts array is undefined', () => {
      const flag: FlagConfig = {
        id: 'enterprise-feature',
        traffic: 1.0,
        filters: [{ type: 'cohort', cohortId: 'enterprise-users' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        // cohorts is undefined
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('works with multiple cohort filters (AND logic)', () => {
      const flag: FlagConfig = {
        id: 'vip-beta-feature',
        traffic: 1.0,
        filters: [
          { type: 'cohort', cohortId: 'enterprise-users' },
          { type: 'cohort', cohortId: 'beta-testers' },
        ],
      }

      const contextBothCohorts: EvaluationContext = {
        userId: 'user-123',
        cohorts: ['enterprise-users', 'beta-testers', 'newsletter'],
      }

      const contextOneCohort: EvaluationContext = {
        userId: 'user-456',
        cohorts: ['enterprise-users'],
      }

      expect(evaluateFlag(flag, contextBothCohorts).enabled).toBe(true)
      expect(evaluateFlag(flag, contextOneCohort).enabled).toBe(false)
    })
  })

  /**
   * Missing property handling tests
   *
   * When a filter references a property that doesn't exist in the context,
   * the filter should not match (return false).
   */
  describe('missing property handling', () => {
    it('returns false when property is missing from context', () => {
      const flag: FlagConfig = {
        id: 'plan-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'plan', operator: 'eq', value: 'pro' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { region: 'us' }, // plan is missing
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('returns false when properties object is undefined', () => {
      const flag: FlagConfig = {
        id: 'plan-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'plan', operator: 'eq', value: 'pro' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        // properties is undefined
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('returns false when properties object is empty', () => {
      const flag: FlagConfig = {
        id: 'plan-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'plan', operator: 'eq', value: 'pro' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: {},
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('returns false for gt/lt when property is missing', () => {
      const flag: FlagConfig = {
        id: 'usage-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'usage', operator: 'gt', value: 100 }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'pro' }, // usage is missing
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('returns false for in when property is missing', () => {
      const flag: FlagConfig = {
        id: 'region-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'region', operator: 'in', value: ['us', 'eu'] }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'pro' }, // region is missing
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('returns false for contains when property is missing', () => {
      const flag: FlagConfig = {
        id: 'email-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'email', operator: 'contains', value: '@company.com' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'pro' }, // email is missing
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('handles property value of null as missing', () => {
      const flag: FlagConfig = {
        id: 'plan-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'plan', operator: 'eq', value: 'pro' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: null as unknown as string }, // null value
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })
  })

  /**
   * Edge cases and integration tests
   */
  describe('edge cases', () => {
    it('flag without filters matches all users when traffic is 1.0', () => {
      const flag: FlagConfig = {
        id: 'global-feature',
        traffic: 1.0,
        // No filters
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'free' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('flag with empty filters array matches all users when traffic is 1.0', () => {
      const flag: FlagConfig = {
        id: 'global-feature',
        traffic: 1.0,
        filters: [],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'free' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(true)
    })

    it('traffic of 0 disables flag even when filters match', () => {
      const flag: FlagConfig = {
        id: 'disabled-feature',
        traffic: 0,
        filters: [{ type: 'property', property: 'plan', operator: 'eq', value: 'pro' }],
      }

      const context: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'pro' },
      }

      const result = evaluateFlag(flag, context)
      expect(result.enabled).toBe(false)
    })

    it('neq operator excludes when values are equal', () => {
      const flag: FlagConfig = {
        id: 'not-free-feature',
        traffic: 1.0,
        filters: [{ type: 'property', property: 'plan', operator: 'neq', value: 'free' }],
      }

      const contextFree: EvaluationContext = {
        userId: 'user-123',
        properties: { plan: 'free' },
      }

      const contextPro: EvaluationContext = {
        userId: 'user-456',
        properties: { plan: 'pro' },
      }

      expect(evaluateFlag(flag, contextFree).enabled).toBe(false)
      expect(evaluateFlag(flag, contextPro).enabled).toBe(true)
    })
  })
})
