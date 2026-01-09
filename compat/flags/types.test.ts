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
