/**
 * Feature Flags Types Contract Tests
 *
 * TDD RED Phase: These tests define the expected type contracts
 * for OpenFeature-compatible feature flag types.
 *
 * Test Coverage:
 * - FlagDefinition interface (key, defaultValue, description, variations, targeting, etc.)
 * - FlagVariation interface (value, label, weight)
 * - TargetingRule interface (id, description, clauses, variation/rollout)
 * - TargetingClause interface (contextKind, attribute, operator, values, negate)
 * - EvaluationContext interface (targetingKey, custom attributes)
 * - EvaluationDetails interface (value, variant, reason, errorCode, flagMetadata)
 * - EvaluationReason union types
 * - ErrorCode union types
 * - TargetingOperator union types
 *
 * @module @dotdo/compat/flags/types.test
 */
import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  FlagDefinition,
  FlagVariation,
  TargetingRule,
  TargetingClause,
  TargetingOperator,
  Rollout,
  EvaluationContext,
  EvaluationDetails,
  EvaluationReason,
  ErrorCode,
  FlagProvider,
} from './types'
import {
  isValidFlagDefinition,
  isValidEvaluationContext,
  isValidTargetingRule,
} from './types'

// ============================================================================
// FLAG DEFINITION TESTS
// ============================================================================

describe('FlagDefinition', () => {
  describe('required fields', () => {
    it('should require key field', () => {
      const flag: FlagDefinition<boolean> = {
        key: 'feature-enabled',
        defaultValue: false,
      }
      expectTypeOf(flag.key).toBeString()
      expect(flag.key).toBe('feature-enabled')
    })

    it('should require defaultValue field', () => {
      const flag: FlagDefinition<boolean> = {
        key: 'feature-enabled',
        defaultValue: false,
      }
      expectTypeOf(flag.defaultValue).toMatchTypeOf<boolean>()
      expect(flag.defaultValue).toBe(false)
    })
  })

  describe('optional fields', () => {
    it('should support optional description', () => {
      const flag: FlagDefinition<boolean> = {
        key: 'feature-enabled',
        defaultValue: false,
        description: 'Enable the new feature',
      }
      expectTypeOf(flag.description).toMatchTypeOf<string | undefined>()
    })

    it('should support optional variations array', () => {
      const flag: FlagDefinition<string> = {
        key: 'theme',
        defaultValue: 'light',
        variations: [
          { value: 'light', label: 'Light Theme' },
          { value: 'dark', label: 'Dark Theme' },
        ],
      }
      expectTypeOf(flag.variations).toMatchTypeOf<FlagVariation<string>[] | undefined>()
    })

    it('should support optional targeting rules', () => {
      const flag: FlagDefinition<boolean> = {
        key: 'feature-enabled',
        defaultValue: false,
        targeting: [
          {
            id: 'rule-1',
            variation: true,
            clauses: [],
          },
        ],
      }
      expectTypeOf(flag.targeting).toMatchTypeOf<TargetingRule<boolean>[] | undefined>()
    })

    it('should support optional prerequisites array', () => {
      const flag: FlagDefinition<boolean> = {
        key: 'advanced-feature',
        defaultValue: false,
        prerequisites: [
          {
            key: 'basic-feature',
            variation: true,
          },
        ],
      }
      expectTypeOf(flag.prerequisites).toMatchTypeOf<
        Array<{ key: string; variation: unknown }> | undefined
      >()
    })

    it('should support optional tags array', () => {
      const flag: FlagDefinition<boolean> = {
        key: 'feature-enabled',
        defaultValue: false,
        tags: ['beta', 'experimental'],
      }
      expectTypeOf(flag.tags).toMatchTypeOf<string[] | undefined>()
    })

    it('should support optional temporary flag marker', () => {
      const flag: FlagDefinition<boolean> = {
        key: 'temporary-feature',
        defaultValue: false,
        temporary: true,
      }
      expectTypeOf(flag.temporary).toMatchTypeOf<boolean | undefined>()
    })
  })

  describe('generic type support', () => {
    it('should support boolean flags', () => {
      const flag: FlagDefinition<boolean> = {
        key: 'feature-enabled',
        defaultValue: false,
      }
      expectTypeOf(flag.defaultValue).toBeBoolean()
    })

    it('should support string flags', () => {
      const flag: FlagDefinition<string> = {
        key: 'theme',
        defaultValue: 'light',
      }
      expectTypeOf(flag.defaultValue).toBeString()
    })

    it('should support number flags', () => {
      const flag: FlagDefinition<number> = {
        key: 'max-retries',
        defaultValue: 3,
      }
      expectTypeOf(flag.defaultValue).toBeNumber()
    })

    it('should support object flags', () => {
      const flag: FlagDefinition<{ theme: string; locale: string }> = {
        key: 'config',
        defaultValue: { theme: 'light', locale: 'en' },
      }
      expectTypeOf(flag.defaultValue).toMatchTypeOf<{ theme: string; locale: string }>()
    })
  })
})

// ============================================================================
// FLAG VARIATION TESTS
// ============================================================================

describe('FlagVariation', () => {
  it('should require value field', () => {
    const variation: FlagVariation<string> = {
      value: 'dark',
    }
    expectTypeOf(variation.value).toBeString()
    expect(variation.value).toBe('dark')
  })

  it('should support optional label', () => {
    const variation: FlagVariation<string> = {
      value: 'dark',
      label: 'Dark Theme',
    }
    expectTypeOf(variation.label).toMatchTypeOf<string | undefined>()
  })

  it('should support optional weight for rollouts', () => {
    const variation: FlagVariation<string> = {
      value: 'dark',
      weight: 50,
    }
    expectTypeOf(variation.weight).toMatchTypeOf<number | undefined>()
  })

  it('should maintain generic type consistency', () => {
    const boolVariation: FlagVariation<boolean> = {
      value: true,
      label: 'Enabled',
    }
    expectTypeOf(boolVariation.value).toBeBoolean()

    const numberVariation: FlagVariation<number> = {
      value: 42,
      label: 'Answer',
    }
    expectTypeOf(numberVariation.value).toBeNumber()
  })
})

// ============================================================================
// TARGETING RULE TESTS
// ============================================================================

describe('TargetingRule', () => {
  describe('required fields', () => {
    it('should require id field', () => {
      const rule: TargetingRule<boolean> = {
        id: 'rule-1',
        clauses: [],
        variation: true,
      }
      expectTypeOf(rule.id).toBeString()
      expect(rule.id).toBe('rule-1')
    })

    it('should require clauses array', () => {
      const rule: TargetingRule<boolean> = {
        id: 'rule-1',
        clauses: [],
        variation: true,
      }
      expectTypeOf(rule.clauses).toMatchTypeOf<TargetingClause[]>()
    })

    it('should require either variation or rollout', () => {
      const ruleWithVariation: TargetingRule<boolean> = {
        id: 'rule-1',
        clauses: [],
        variation: true,
      }
      expectTypeOf(ruleWithVariation.variation).toMatchTypeOf<boolean | undefined>()

      const ruleWithRollout: TargetingRule<string> = {
        id: 'rule-2',
        clauses: [],
        rollout: {
          variations: [
            { value: 'control', weight: 50 },
            { value: 'treatment', weight: 50 },
          ],
        },
      }
      expectTypeOf(ruleWithRollout.rollout).toMatchTypeOf<Rollout<string> | undefined>()
    })
  })

  describe('optional fields', () => {
    it('should support optional description', () => {
      const rule: TargetingRule<boolean> = {
        id: 'rule-1',
        description: 'Enable for beta users',
        clauses: [],
        variation: true,
      }
      expectTypeOf(rule.description).toMatchTypeOf<string | undefined>()
    })
  })
})

// ============================================================================
// TARGETING CLAUSE TESTS
// ============================================================================

describe('TargetingClause', () => {
  describe('required fields', () => {
    it('should require attribute field', () => {
      const clause: TargetingClause = {
        attribute: 'email',
        operator: 'in',
        values: ['test@example.com'],
      }
      expectTypeOf(clause.attribute).toBeString()
      expect(clause.attribute).toBe('email')
    })

    it('should require operator field', () => {
      const clause: TargetingClause = {
        attribute: 'email',
        operator: 'in',
        values: ['test@example.com'],
      }
      expectTypeOf(clause.operator).toMatchTypeOf<TargetingOperator>()
    })

    it('should require values array', () => {
      const clause: TargetingClause = {
        attribute: 'email',
        operator: 'in',
        values: ['test@example.com'],
      }
      expectTypeOf(clause.values).toMatchTypeOf<unknown[]>()
    })
  })

  describe('optional fields', () => {
    it('should support optional contextKind', () => {
      const clause: TargetingClause = {
        contextKind: 'user',
        attribute: 'email',
        operator: 'in',
        values: ['test@example.com'],
      }
      expectTypeOf(clause.contextKind).toMatchTypeOf<string | undefined>()
    })

    it('should support optional negate flag', () => {
      const clause: TargetingClause = {
        attribute: 'email',
        operator: 'in',
        values: ['test@example.com'],
        negate: true,
      }
      expectTypeOf(clause.negate).toMatchTypeOf<boolean | undefined>()
    })
  })
})

// ============================================================================
// TARGETING OPERATOR TESTS
// ============================================================================

describe('TargetingOperator', () => {
  it('should support "in" operator', () => {
    const operator: TargetingOperator = 'in'
    expectTypeOf(operator).toMatchTypeOf<'in'>()
  })

  it('should support "startsWith" operator', () => {
    const operator: TargetingOperator = 'startsWith'
    expectTypeOf(operator).toMatchTypeOf<'startsWith'>()
  })

  it('should support "endsWith" operator', () => {
    const operator: TargetingOperator = 'endsWith'
    expectTypeOf(operator).toMatchTypeOf<'endsWith'>()
  })

  it('should support "matches" operator (regex)', () => {
    const operator: TargetingOperator = 'matches'
    expectTypeOf(operator).toMatchTypeOf<'matches'>()
  })

  it('should support "contains" operator', () => {
    const operator: TargetingOperator = 'contains'
    expectTypeOf(operator).toMatchTypeOf<'contains'>()
  })

  it('should support "lessThan" operator', () => {
    const operator: TargetingOperator = 'lessThan'
    expectTypeOf(operator).toMatchTypeOf<'lessThan'>()
  })

  it('should support "lessThanOrEqual" operator', () => {
    const operator: TargetingOperator = 'lessThanOrEqual'
    expectTypeOf(operator).toMatchTypeOf<'lessThanOrEqual'>()
  })

  it('should support "greaterThan" operator', () => {
    const operator: TargetingOperator = 'greaterThan'
    expectTypeOf(operator).toMatchTypeOf<'greaterThan'>()
  })

  it('should support "greaterThanOrEqual" operator', () => {
    const operator: TargetingOperator = 'greaterThanOrEqual'
    expectTypeOf(operator).toMatchTypeOf<'greaterThanOrEqual'>()
  })

  it('should support "semVerEqual" operator', () => {
    const operator: TargetingOperator = 'semVerEqual'
    expectTypeOf(operator).toMatchTypeOf<'semVerEqual'>()
  })

  it('should support "semVerLessThan" operator', () => {
    const operator: TargetingOperator = 'semVerLessThan'
    expectTypeOf(operator).toMatchTypeOf<'semVerLessThan'>()
  })

  it('should support "semVerGreaterThan" operator', () => {
    const operator: TargetingOperator = 'semVerGreaterThan'
    expectTypeOf(operator).toMatchTypeOf<'semVerGreaterThan'>()
  })
})

// ============================================================================
// ROLLOUT TESTS
// ============================================================================

describe('Rollout', () => {
  it('should require variations array with weights', () => {
    const rollout: Rollout<string> = {
      variations: [
        { value: 'control', weight: 50 },
        { value: 'treatment', weight: 50 },
      ],
    }
    expectTypeOf(rollout.variations).toMatchTypeOf<FlagVariation<string>[]>()
    expect(rollout.variations).toHaveLength(2)
  })

  it('should support optional bucketBy attribute', () => {
    const rollout: Rollout<string> = {
      variations: [
        { value: 'control', weight: 50 },
        { value: 'treatment', weight: 50 },
      ],
      bucketBy: 'userId',
    }
    expectTypeOf(rollout.bucketBy).toMatchTypeOf<string | undefined>()
  })

  it('should support optional seed for consistent bucketing', () => {
    const rollout: Rollout<string> = {
      variations: [
        { value: 'control', weight: 50 },
        { value: 'treatment', weight: 50 },
      ],
      seed: 12345,
    }
    expectTypeOf(rollout.seed).toMatchTypeOf<number | undefined>()
  })
})

// ============================================================================
// EVALUATION CONTEXT TESTS
// ============================================================================

describe('EvaluationContext', () => {
  it('should support optional targetingKey', () => {
    const context: EvaluationContext = {
      targetingKey: 'user-123',
    }
    expectTypeOf(context.targetingKey).toMatchTypeOf<string | undefined>()
  })

  it('should support custom string attributes', () => {
    const context: EvaluationContext = {
      email: 'test@example.com',
      name: 'Test User',
    }
    expect(context.email).toBe('test@example.com')
    expect(context.name).toBe('Test User')
  })

  it('should support custom number attributes', () => {
    const context: EvaluationContext = {
      age: 30,
      accountValue: 1000,
    }
    expect(context.age).toBe(30)
    expect(context.accountValue).toBe(1000)
  })

  it('should support custom boolean attributes', () => {
    const context: EvaluationContext = {
      isPremium: true,
      isVerified: false,
    }
    expect(context.isPremium).toBe(true)
    expect(context.isVerified).toBe(false)
  })

  it('should support custom array attributes', () => {
    const context: EvaluationContext = {
      tags: ['beta', 'early-adopter'],
      roles: ['user', 'moderator'],
    }
    expect(context.tags).toEqual(['beta', 'early-adopter'])
  })

  it('should support nested object attributes', () => {
    const context: EvaluationContext = {
      targetingKey: 'user-123',
      company: {
        id: 'company-456',
        name: 'Acme Inc',
        employees: 100,
      },
    }
    expect(context.company).toEqual({
      id: 'company-456',
      name: 'Acme Inc',
      employees: 100,
    })
  })

  it('should allow empty context', () => {
    const context: EvaluationContext = {}
    expect(context).toEqual({})
  })
})

// ============================================================================
// EVALUATION DETAILS TESTS
// ============================================================================

describe('EvaluationDetails', () => {
  describe('required fields', () => {
    it('should require value field', () => {
      const details: EvaluationDetails<boolean> = {
        value: true,
        reason: 'STATIC',
      }
      expectTypeOf(details.value).toBeBoolean()
      expect(details.value).toBe(true)
    })

    it('should require reason field', () => {
      const details: EvaluationDetails<boolean> = {
        value: true,
        reason: 'STATIC',
      }
      expectTypeOf(details.reason).toMatchTypeOf<EvaluationReason>()
    })
  })

  describe('optional fields', () => {
    it('should support optional variant index', () => {
      const details: EvaluationDetails<string> = {
        value: 'dark',
        variant: 1,
        reason: 'TARGETING_MATCH',
      }
      expectTypeOf(details.variant).toMatchTypeOf<number | undefined>()
    })

    it('should support optional errorCode', () => {
      const details: EvaluationDetails<boolean> = {
        value: false,
        reason: 'ERROR',
        errorCode: 'FLAG_NOT_FOUND',
      }
      expectTypeOf(details.errorCode).toMatchTypeOf<ErrorCode | undefined>()
    })

    it('should support optional errorMessage', () => {
      const details: EvaluationDetails<boolean> = {
        value: false,
        reason: 'ERROR',
        errorCode: 'FLAG_NOT_FOUND',
        errorMessage: 'Flag "unknown-flag" not found',
      }
      expectTypeOf(details.errorMessage).toMatchTypeOf<string | undefined>()
    })

    it('should support optional flagMetadata', () => {
      const details: EvaluationDetails<boolean> = {
        value: true,
        reason: 'STATIC',
        flagMetadata: {
          flagKey: 'feature-enabled',
          version: 1,
        },
      }
      expectTypeOf(details.flagMetadata).toMatchTypeOf<Record<string, unknown> | undefined>()
    })
  })

  describe('generic type support', () => {
    it('should support boolean evaluation', () => {
      const details: EvaluationDetails<boolean> = {
        value: true,
        reason: 'STATIC',
      }
      expectTypeOf(details.value).toBeBoolean()
    })

    it('should support string evaluation', () => {
      const details: EvaluationDetails<string> = {
        value: 'dark',
        reason: 'TARGETING_MATCH',
      }
      expectTypeOf(details.value).toBeString()
    })

    it('should support number evaluation', () => {
      const details: EvaluationDetails<number> = {
        value: 42,
        reason: 'DEFAULT',
      }
      expectTypeOf(details.value).toBeNumber()
    })

    it('should support object evaluation', () => {
      const details: EvaluationDetails<{ theme: string }> = {
        value: { theme: 'dark' },
        reason: 'STATIC',
      }
      expectTypeOf(details.value).toMatchTypeOf<{ theme: string }>()
    })
  })
})

// ============================================================================
// EVALUATION REASON TESTS
// ============================================================================

describe('EvaluationReason', () => {
  it('should support "STATIC" reason', () => {
    const reason: EvaluationReason = 'STATIC'
    expectTypeOf(reason).toMatchTypeOf<'STATIC'>()
  })

  it('should support "DEFAULT" reason', () => {
    const reason: EvaluationReason = 'DEFAULT'
    expectTypeOf(reason).toMatchTypeOf<'DEFAULT'>()
  })

  it('should support "TARGETING_MATCH" reason', () => {
    const reason: EvaluationReason = 'TARGETING_MATCH'
    expectTypeOf(reason).toMatchTypeOf<'TARGETING_MATCH'>()
  })

  it('should support "SPLIT" reason for rollouts', () => {
    const reason: EvaluationReason = 'SPLIT'
    expectTypeOf(reason).toMatchTypeOf<'SPLIT'>()
  })

  it('should support "CACHED" reason', () => {
    const reason: EvaluationReason = 'CACHED'
    expectTypeOf(reason).toMatchTypeOf<'CACHED'>()
  })

  it('should support "DISABLED" reason', () => {
    const reason: EvaluationReason = 'DISABLED'
    expectTypeOf(reason).toMatchTypeOf<'DISABLED'>()
  })

  it('should support "ERROR" reason', () => {
    const reason: EvaluationReason = 'ERROR'
    expectTypeOf(reason).toMatchTypeOf<'ERROR'>()
  })
})

// ============================================================================
// ERROR CODE TESTS
// ============================================================================

describe('ErrorCode', () => {
  it('should support "PROVIDER_NOT_READY" error', () => {
    const code: ErrorCode = 'PROVIDER_NOT_READY'
    expectTypeOf(code).toMatchTypeOf<'PROVIDER_NOT_READY'>()
  })

  it('should support "FLAG_NOT_FOUND" error', () => {
    const code: ErrorCode = 'FLAG_NOT_FOUND'
    expectTypeOf(code).toMatchTypeOf<'FLAG_NOT_FOUND'>()
  })

  it('should support "PARSE_ERROR" error', () => {
    const code: ErrorCode = 'PARSE_ERROR'
    expectTypeOf(code).toMatchTypeOf<'PARSE_ERROR'>()
  })

  it('should support "TYPE_MISMATCH" error', () => {
    const code: ErrorCode = 'TYPE_MISMATCH'
    expectTypeOf(code).toMatchTypeOf<'TYPE_MISMATCH'>()
  })

  it('should support "TARGETING_KEY_MISSING" error', () => {
    const code: ErrorCode = 'TARGETING_KEY_MISSING'
    expectTypeOf(code).toMatchTypeOf<'TARGETING_KEY_MISSING'>()
  })

  it('should support "GENERAL" error', () => {
    const code: ErrorCode = 'GENERAL'
    expectTypeOf(code).toMatchTypeOf<'GENERAL'>()
  })
})

// ============================================================================
// FLAG PROVIDER INTERFACE TESTS
// ============================================================================

describe('FlagProvider', () => {
  it('should have metadata property', () => {
    const provider: FlagProvider = {
      metadata: {
        name: 'test-provider',
      },
      resolveBooleanEvaluation: async () => ({
        value: true,
        reason: 'DEFAULT',
      }),
      resolveStringEvaluation: async () => ({
        value: 'test',
        reason: 'DEFAULT',
      }),
      resolveNumberEvaluation: async () => ({
        value: 0,
        reason: 'DEFAULT',
      }),
      resolveObjectEvaluation: async () => ({
        value: {},
        reason: 'DEFAULT',
      }),
    }
    expectTypeOf(provider.metadata).toMatchTypeOf<{ name: string }>()
  })

  it('should have resolveBooleanEvaluation method', () => {
    const provider: FlagProvider = {
      metadata: { name: 'test' },
      resolveBooleanEvaluation: async (flagKey, defaultValue, context) => ({
        value: defaultValue,
        reason: 'DEFAULT',
      }),
      resolveStringEvaluation: async () => ({ value: '', reason: 'DEFAULT' }),
      resolveNumberEvaluation: async () => ({ value: 0, reason: 'DEFAULT' }),
      resolveObjectEvaluation: async () => ({ value: {}, reason: 'DEFAULT' }),
    }
    expectTypeOf(provider.resolveBooleanEvaluation).toBeFunction()
  })

  it('should have resolveStringEvaluation method', () => {
    const provider: FlagProvider = {
      metadata: { name: 'test' },
      resolveBooleanEvaluation: async () => ({ value: false, reason: 'DEFAULT' }),
      resolveStringEvaluation: async (flagKey, defaultValue, context) => ({
        value: defaultValue,
        reason: 'DEFAULT',
      }),
      resolveNumberEvaluation: async () => ({ value: 0, reason: 'DEFAULT' }),
      resolveObjectEvaluation: async () => ({ value: {}, reason: 'DEFAULT' }),
    }
    expectTypeOf(provider.resolveStringEvaluation).toBeFunction()
  })

  it('should have resolveNumberEvaluation method', () => {
    const provider: FlagProvider = {
      metadata: { name: 'test' },
      resolveBooleanEvaluation: async () => ({ value: false, reason: 'DEFAULT' }),
      resolveStringEvaluation: async () => ({ value: '', reason: 'DEFAULT' }),
      resolveNumberEvaluation: async (flagKey, defaultValue, context) => ({
        value: defaultValue,
        reason: 'DEFAULT',
      }),
      resolveObjectEvaluation: async () => ({ value: {}, reason: 'DEFAULT' }),
    }
    expectTypeOf(provider.resolveNumberEvaluation).toBeFunction()
  })

  it('should have resolveObjectEvaluation method', () => {
    const provider: FlagProvider = {
      metadata: { name: 'test' },
      resolveBooleanEvaluation: async () => ({ value: false, reason: 'DEFAULT' }),
      resolveStringEvaluation: async () => ({ value: '', reason: 'DEFAULT' }),
      resolveNumberEvaluation: async () => ({ value: 0, reason: 'DEFAULT' }),
      resolveObjectEvaluation: async (flagKey, defaultValue, context) => ({
        value: defaultValue,
        reason: 'DEFAULT',
      }),
    }
    expectTypeOf(provider.resolveObjectEvaluation).toBeFunction()
  })
})

// ============================================================================
// VALIDATOR TESTS
// ============================================================================

describe('isValidFlagDefinition', () => {
  it('should return true for valid flag definition', () => {
    const flag = {
      key: 'feature-enabled',
      defaultValue: false,
    }
    expect(isValidFlagDefinition(flag)).toBe(true)
  })

  it('should return true for flag with all fields', () => {
    const flag = {
      key: 'feature-enabled',
      defaultValue: false,
      description: 'Enable feature',
      variations: [{ value: true }, { value: false }],
      targeting: [],
      tags: ['beta'],
    }
    expect(isValidFlagDefinition(flag)).toBe(true)
  })

  it('should return false for missing key', () => {
    const flag = {
      defaultValue: false,
    }
    expect(isValidFlagDefinition(flag)).toBe(false)
  })

  it('should return false for missing defaultValue', () => {
    const flag = {
      key: 'feature-enabled',
    }
    expect(isValidFlagDefinition(flag)).toBe(false)
  })

  it('should return false for null', () => {
    expect(isValidFlagDefinition(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(isValidFlagDefinition(undefined)).toBe(false)
  })
})

describe('isValidEvaluationContext', () => {
  it('should return true for valid context', () => {
    const context = {
      targetingKey: 'user-123',
      email: 'test@example.com',
    }
    expect(isValidEvaluationContext(context)).toBe(true)
  })

  it('should return true for empty context', () => {
    expect(isValidEvaluationContext({})).toBe(true)
  })

  it('should return false for null', () => {
    expect(isValidEvaluationContext(null)).toBe(false)
  })

  it('should return false for non-object', () => {
    expect(isValidEvaluationContext('not an object')).toBe(false)
    expect(isValidEvaluationContext(123)).toBe(false)
  })
})

describe('isValidTargetingRule', () => {
  it('should return true for valid targeting rule', () => {
    const rule = {
      id: 'rule-1',
      clauses: [],
      variation: true,
    }
    expect(isValidTargetingRule(rule)).toBe(true)
  })

  it('should return true for rule with rollout', () => {
    const rule = {
      id: 'rule-1',
      clauses: [],
      rollout: {
        variations: [
          { value: 'a', weight: 50 },
          { value: 'b', weight: 50 },
        ],
      },
    }
    expect(isValidTargetingRule(rule)).toBe(true)
  })

  it('should return false for missing id', () => {
    const rule = {
      clauses: [],
      variation: true,
    }
    expect(isValidTargetingRule(rule)).toBe(false)
  })

  it('should return false for missing clauses', () => {
    const rule = {
      id: 'rule-1',
      variation: true,
    }
    expect(isValidTargetingRule(rule)).toBe(false)
  })

  it('should return false for missing variation and rollout', () => {
    const rule = {
      id: 'rule-1',
      clauses: [],
    }
    expect(isValidTargetingRule(rule)).toBe(false)
  })

  it('should return false for null', () => {
    expect(isValidTargetingRule(null)).toBe(false)
  })
})

// ============================================================================
// ADDITIONAL TYPE GUARD TESTS
// ============================================================================

import {
  isFlagVariation,
  isTargetingClause,
  isRollout,
  validateFlagDefinition,
  validateTargetingClause,
  createBooleanFlag,
  createStringFlag,
  emailDomainClause,
  userIdClause,
  percentageRollout,
  getTotalWeight,
  isValidRolloutWeights,
  FlagBuilder,
  TargetingRuleBuilder,
} from './types'

describe('isFlagVariation', () => {
  it('should return true for valid variation with value only', () => {
    expect(isFlagVariation({ value: 'control' })).toBe(true)
  })

  it('should return true for variation with all fields', () => {
    expect(isFlagVariation({ value: 'control', label: 'Control', weight: 50 })).toBe(true)
  })

  it('should return false for missing value', () => {
    expect(isFlagVariation({ label: 'Control', weight: 50 })).toBe(false)
  })

  it('should return false for invalid label type', () => {
    expect(isFlagVariation({ value: 'control', label: 123 })).toBe(false)
  })

  it('should return false for invalid weight type', () => {
    expect(isFlagVariation({ value: 'control', weight: '50' })).toBe(false)
  })

  it('should return false for null', () => {
    expect(isFlagVariation(null)).toBe(false)
  })

  it('should return false for non-object', () => {
    expect(isFlagVariation('control')).toBe(false)
  })
})

describe('isTargetingClause', () => {
  it('should return true for valid clause', () => {
    const clause = { attribute: 'email', operator: 'endsWith', values: ['@company.com'] }
    expect(isTargetingClause(clause)).toBe(true)
  })

  it('should return false for missing attribute', () => {
    const clause = { operator: 'in', values: ['test'] }
    expect(isTargetingClause(clause)).toBe(false)
  })

  it('should return false for missing operator', () => {
    const clause = { attribute: 'email', values: ['test'] }
    expect(isTargetingClause(clause)).toBe(false)
  })

  it('should return false for missing values', () => {
    const clause = { attribute: 'email', operator: 'in' }
    expect(isTargetingClause(clause)).toBe(false)
  })

  it('should return false for null', () => {
    expect(isTargetingClause(null)).toBe(false)
  })
})

describe('isRollout', () => {
  it('should return true for valid rollout', () => {
    const rollout = {
      variations: [
        { value: 'control', weight: 50 },
        { value: 'treatment', weight: 50 },
      ],
    }
    expect(isRollout(rollout)).toBe(true)
  })

  it('should return true for rollout with all options', () => {
    const rollout = {
      variations: [{ value: 'a', weight: 50 }, { value: 'b', weight: 50 }],
      bucketBy: 'userId',
      seed: 12345,
    }
    expect(isRollout(rollout)).toBe(true)
  })

  it('should return false for missing variations', () => {
    expect(isRollout({ bucketBy: 'userId' })).toBe(false)
  })

  it('should return false for invalid variations', () => {
    expect(isRollout({ variations: [{ label: 'no value' }] })).toBe(false)
  })

  it('should return false for invalid bucketBy type', () => {
    expect(isRollout({ variations: [{ value: 'a' }], bucketBy: 123 })).toBe(false)
  })

  it('should return false for invalid seed type', () => {
    expect(isRollout({ variations: [{ value: 'a' }], seed: '123' })).toBe(false)
  })

  it('should return false for null', () => {
    expect(isRollout(null)).toBe(false)
  })
})

// ============================================================================
// VALIDATION HELPERS TESTS
// ============================================================================

describe('validateFlagDefinition', () => {
  it('should return valid for correct flag', () => {
    const result = validateFlagDefinition({ key: 'test', defaultValue: false })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should return errors for non-object', () => {
    const result = validateFlagDefinition('not an object')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Flag definition must be an object')
  })

  it('should return error for missing key', () => {
    const result = validateFlagDefinition({ defaultValue: false })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required field: key')
  })

  it('should return error for empty key', () => {
    const result = validateFlagDefinition({ key: '  ', defaultValue: false })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Field "key" cannot be empty')
  })

  it('should return error for missing defaultValue', () => {
    const result = validateFlagDefinition({ key: 'test' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required field: defaultValue')
  })

  it('should return error for invalid description type', () => {
    const result = validateFlagDefinition({ key: 'test', defaultValue: false, description: 123 })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Field "description" must be a string')
  })

  it('should return error for invalid variations', () => {
    const result = validateFlagDefinition({ key: 'test', defaultValue: false, variations: 'invalid' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Field "variations" must be an array')
  })

  it('should return error for invalid targeting', () => {
    const result = validateFlagDefinition({ key: 'test', defaultValue: false, targeting: 'invalid' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Field "targeting" must be an array')
  })

  it('should return error for invalid tags', () => {
    const result = validateFlagDefinition({ key: 'test', defaultValue: false, tags: [1, 2, 3] })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('All tags must be strings')
  })
})

describe('validateTargetingClause', () => {
  it('should return valid for correct clause', () => {
    const result = validateTargetingClause({ attribute: 'email', operator: 'in', values: ['test'] })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should return error for missing attribute', () => {
    const result = validateTargetingClause({ operator: 'in', values: ['test'] })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required field: attribute')
  })

  it('should return error for missing operator', () => {
    const result = validateTargetingClause({ attribute: 'email', values: ['test'] })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required field: operator')
  })

  it('should return error for missing values', () => {
    const result = validateTargetingClause({ attribute: 'email', operator: 'in' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required field: values')
  })

  it('should return error for non-object', () => {
    const result = validateTargetingClause('invalid')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Targeting clause must be an object')
  })
})

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('createBooleanFlag', () => {
  it('should create a boolean flag with defaults', () => {
    const flag = createBooleanFlag('feature', false)
    expect(flag.key).toBe('feature')
    expect(flag.defaultValue).toBe(false)
    expect(flag.variations).toHaveLength(2)
  })

  it('should create a boolean flag with options', () => {
    const flag = createBooleanFlag('feature', true, {
      description: 'A test feature',
      tags: ['beta'],
      temporary: true,
    })
    expect(flag.description).toBe('A test feature')
    expect(flag.tags).toEqual(['beta'])
    expect(flag.temporary).toBe(true)
  })
})

describe('createStringFlag', () => {
  it('should create a string flag with variations', () => {
    const flag = createStringFlag('theme', 'light', ['light', 'dark', 'system'])
    expect(flag.key).toBe('theme')
    expect(flag.defaultValue).toBe('light')
    expect(flag.variations).toHaveLength(3)
    expect(flag.variations![0].value).toBe('light')
  })

  it('should create a string flag with options', () => {
    const flag = createStringFlag('theme', 'light', ['light', 'dark'], {
      description: 'Theme preference',
    })
    expect(flag.description).toBe('Theme preference')
  })
})

describe('emailDomainClause', () => {
  it('should create an email domain clause', () => {
    const clause = emailDomainClause(['@company.com', '@partner.com'])
    expect(clause.attribute).toBe('email')
    expect(clause.operator).toBe('endsWith')
    expect(clause.values).toEqual(['@company.com', '@partner.com'])
  })
})

describe('userIdClause', () => {
  it('should create a user ID clause', () => {
    const clause = userIdClause(['user-1', 'user-2'])
    expect(clause.attribute).toBe('targetingKey')
    expect(clause.operator).toBe('in')
    expect(clause.values).toEqual(['user-1', 'user-2'])
  })
})

describe('percentageRollout', () => {
  it('should create a percentage rollout', () => {
    const rollout = percentageRollout(10)
    expect(rollout.variations).toHaveLength(2)
    expect(rollout.variations[0]).toEqual({ value: false, weight: 90 })
    expect(rollout.variations[1]).toEqual({ value: true, weight: 10 })
  })

  it('should clamp percentage to 0-100', () => {
    const rollout1 = percentageRollout(-10)
    expect(rollout1.variations[1].weight).toBe(0)

    const rollout2 = percentageRollout(150)
    expect(rollout2.variations[1].weight).toBe(100)
  })

  it('should accept options', () => {
    const rollout = percentageRollout(50, { bucketBy: 'orgId', seed: 123 })
    expect(rollout.bucketBy).toBe('orgId')
    expect(rollout.seed).toBe(123)
  })
})

describe('getTotalWeight', () => {
  it('should sum weights correctly', () => {
    const variations = [
      { value: 'a', weight: 25 },
      { value: 'b', weight: 50 },
      { value: 'c', weight: 25 },
    ]
    expect(getTotalWeight(variations)).toBe(100)
  })

  it('should treat missing weights as 0', () => {
    const variations = [
      { value: 'a', weight: 50 },
      { value: 'b' },
    ]
    expect(getTotalWeight(variations)).toBe(50)
  })
})

describe('isValidRolloutWeights', () => {
  it('should return true for weights summing to 100', () => {
    const variations = [
      { value: 'a', weight: 50 },
      { value: 'b', weight: 50 },
    ]
    expect(isValidRolloutWeights(variations)).toBe(true)
  })

  it('should return false for weights not summing to 100', () => {
    const variations = [
      { value: 'a', weight: 40 },
      { value: 'b', weight: 40 },
    ]
    expect(isValidRolloutWeights(variations)).toBe(false)
  })
})

// ============================================================================
// FLAG BUILDER TESTS
// ============================================================================

describe('FlagBuilder', () => {
  describe('static constructors', () => {
    it('should create boolean flag builder', () => {
      const flag = FlagBuilder.boolean('feature').build()
      expect(flag.key).toBe('feature')
      expect(flag.defaultValue).toBe(false)
      expect(flag.variations).toHaveLength(2)
    })

    it('should create boolean flag with custom default', () => {
      const flag = FlagBuilder.boolean('feature', true).build()
      expect(flag.defaultValue).toBe(true)
    })

    it('should create string flag builder', () => {
      const flag = FlagBuilder.string('theme', 'light').build()
      expect(flag.key).toBe('theme')
      expect(flag.defaultValue).toBe('light')
    })

    it('should create number flag builder', () => {
      const flag = FlagBuilder.number('retries', 3).build()
      expect(flag.key).toBe('retries')
      expect(flag.defaultValue).toBe(3)
    })

    it('should create generic flag builder', () => {
      const flag = FlagBuilder.create('config', { theme: 'dark' }).build()
      expect(flag.defaultValue).toEqual({ theme: 'dark' })
    })
  })

  describe('fluent methods', () => {
    it('should set description', () => {
      const flag = FlagBuilder.boolean('feature')
        .description('A test feature')
        .build()
      expect(flag.description).toBe('A test feature')
    })

    it('should add variations', () => {
      const flag = FlagBuilder.string('theme', 'light')
        .variation('light', 'Light')
        .variation('dark', 'Dark')
        .variation('system', 'System', 50)
        .build()
      expect(flag.variations).toHaveLength(3)
      expect(flag.variations![2].weight).toBe(50)
    })

    it('should set all variations at once', () => {
      const flag = FlagBuilder.string('theme', 'light')
        .variations([{ value: 'a' }, { value: 'b' }])
        .build()
      expect(flag.variations).toHaveLength(2)
    })

    it('should add targeting rules', () => {
      const flag = FlagBuilder.boolean('feature')
        .targeting({
          id: 'rule-1',
          clauses: [],
          variation: true,
        })
        .build()
      expect(flag.targeting).toHaveLength(1)
    })

    it('should add prerequisites', () => {
      const flag = FlagBuilder.boolean('advanced')
        .prerequisite('basic', true)
        .build()
      expect(flag.prerequisites).toHaveLength(1)
      expect(flag.prerequisites![0]).toEqual({ key: 'basic', variation: true })
    })

    it('should add tags', () => {
      const flag = FlagBuilder.boolean('feature')
        .tags('beta', 'experimental')
        .build()
      expect(flag.tags).toEqual(['beta', 'experimental'])
    })

    it('should mark as temporary', () => {
      const flag = FlagBuilder.boolean('feature')
        .temporary()
        .build()
      expect(flag.temporary).toBe(true)
    })

    it('should chain all methods', () => {
      const flag = FlagBuilder.boolean('feature')
        .description('Test')
        .tags('test')
        .temporary()
        .targeting({ id: 'r1', clauses: [], variation: true })
        .prerequisite('other', true)
        .build()

      expect(flag.description).toBe('Test')
      expect(flag.tags).toEqual(['test'])
      expect(flag.temporary).toBe(true)
      expect(flag.targeting).toHaveLength(1)
      expect(flag.prerequisites).toHaveLength(1)
    })
  })
})

// ============================================================================
// TARGETING RULE BUILDER TESTS
// ============================================================================

describe('TargetingRuleBuilder', () => {
  it('should create a basic rule', () => {
    const rule = TargetingRuleBuilder.create<boolean>('rule-1')
      .variation(true)
      .build()
    expect(rule.id).toBe('rule-1')
    expect(rule.variation).toBe(true)
    expect(rule.clauses).toEqual([])
  })

  it('should set description', () => {
    const rule = TargetingRuleBuilder.create<boolean>('rule-1')
      .description('Enable for beta users')
      .variation(true)
      .build()
    expect(rule.description).toBe('Enable for beta users')
  })

  it('should add clauses', () => {
    const rule = TargetingRuleBuilder.create<boolean>('rule-1')
      .clause(emailDomainClause(['@company.com']))
      .clause({ attribute: 'plan', operator: 'in', values: ['enterprise'] })
      .variation(true)
      .build()
    expect(rule.clauses).toHaveLength(2)
  })

  it('should set rollout instead of variation', () => {
    const rule = TargetingRuleBuilder.create<boolean>('rule-1')
      .rollout(percentageRollout(50))
      .build()
    expect(rule.rollout).toBeDefined()
    expect(rule.variation).toBeUndefined()
  })

  it('should override rollout with variation', () => {
    const rule = TargetingRuleBuilder.create<boolean>('rule-1')
      .rollout(percentageRollout(50))
      .variation(true)
      .build()
    expect(rule.variation).toBe(true)
    expect(rule.rollout).toBeUndefined()
  })

  it('should override variation with rollout', () => {
    const rule = TargetingRuleBuilder.create<boolean>('rule-1')
      .variation(true)
      .rollout(percentageRollout(50))
      .build()
    expect(rule.rollout).toBeDefined()
    expect(rule.variation).toBeUndefined()
  })
})
