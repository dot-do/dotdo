import { describe, it, expect } from 'vitest'
import { evaluate, matchesTargeting } from './evaluation'
import type {
  FlagDefinition,
  EvaluationContext,
  EvaluationDetails,
  TargetingRule,
} from './types'

describe('Evaluation Engine', () => {
  describe('Basic Evaluation', () => {
    it('should return DEFAULT reason with error when flag not found', async () => {
      const result = await evaluate('nonexistent-flag', false, {})

      expect(result.value).toBe(false)
      expect(result.reason).toBe('DEFAULT')
      expect(result.errorCode).toBe('FLAG_NOT_FOUND')
      expect(result.errorMessage).toBeDefined()
    })

    it('should return STATIC reason with first variation when no targeting', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'simple-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 100 },
          { value: false, label: 'Off', weight: 0 },
        ],
      }

      const result = await evaluate('simple-flag', false, {}, flag)

      expect(result.value).toBe(true)
      expect(result.reason).toBe('STATIC')
      expect(result.variant).toBe('On')
    })

    it('should use defaultValue when context is empty', async () => {
      const flag: FlagDefinition<string> = {
        key: 'test-flag',
        defaultValue: 'default',
        variations: [
          { value: 'A', label: 'Variant A', weight: 50 },
          { value: 'B', label: 'Variant B', weight: 50 },
        ],
      }

      const result = await evaluate('test-flag', 'fallback', {}, flag)

      expect(result.value).toBe('default')
      expect(result.reason).toBe('DEFAULT')
    })

    it('should return DEFAULT reason when flag is disabled', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'disabled-flag',
        defaultValue: false,
        variations: [{ value: true, label: 'On', weight: 100 }],
        enabled: false,
      }

      const result = await evaluate('disabled-flag', false, { targetingKey: 'user-123' }, flag)

      expect(result.value).toBe(false)
      expect(result.reason).toBe('DISABLED')
    })
  })

  describe('Targeting Match', () => {
    it('should return TARGETING_MATCH when single clause matches', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'targeted-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 100 },
          { value: false, label: 'Off', weight: 0 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'Beta users',
              clauses: [
                {
                  contextKind: 'user',
                  attribute: 'beta',
                  operator: 'in',
                  values: [true],
                  negate: false,
                },
              ],
              variation: 0, // On
            },
          ],
        },
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
        beta: true,
      }

      const result = await evaluate('targeted-flag', false, context, flag)

      expect(result.value).toBe(true)
      expect(result.reason).toBe('TARGETING_MATCH')
      expect(result.variant).toBe('On')
    })

    it('should require all clauses to match (AND logic)', async () => {
      const flag: FlagDefinition<string> = {
        key: 'multi-clause-flag',
        defaultValue: 'default',
        variations: [
          { value: 'premium', label: 'Premium', weight: 100 },
          { value: 'free', label: 'Free', weight: 0 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'Premium beta users',
              clauses: [
                {
                  contextKind: 'user',
                  attribute: 'tier',
                  operator: 'in',
                  values: ['premium'],
                  negate: false,
                },
                {
                  contextKind: 'user',
                  attribute: 'beta',
                  operator: 'in',
                  values: [true],
                  negate: false,
                },
              ],
              variation: 0, // Premium
            },
          ],
        },
      }

      // Only beta, not premium - should not match
      const context1: EvaluationContext = {
        targetingKey: 'user-123',
        beta: true,
        tier: 'free',
      }
      const result1 = await evaluate('multi-clause-flag', 'default', context1, flag)
      expect(result1.value).toBe('default')
      expect(result1.reason).not.toBe('TARGETING_MATCH')

      // Both beta and premium - should match
      const context2: EvaluationContext = {
        targetingKey: 'user-456',
        beta: true,
        tier: 'premium',
      }
      const result2 = await evaluate('multi-clause-flag', 'default', context2, flag)
      expect(result2.value).toBe('premium')
      expect(result2.reason).toBe('TARGETING_MATCH')
    })

    it('should invert match when negate is true', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'negate-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 100 },
          { value: false, label: 'Off', weight: 0 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'Not internal users',
              clauses: [
                {
                  contextKind: 'user',
                  attribute: 'internal',
                  operator: 'in',
                  values: [true],
                  negate: true, // Match when NOT internal
                },
              ],
              variation: 0, // On
            },
          ],
        },
      }

      // Internal user - should not match (because of negate)
      const context1: EvaluationContext = {
        targetingKey: 'user-123',
        internal: true,
      }
      const result1 = await evaluate('negate-flag', false, context1, flag)
      expect(result1.value).toBe(false)
      expect(result1.reason).not.toBe('TARGETING_MATCH')

      // External user - should match
      const context2: EvaluationContext = {
        targetingKey: 'user-456',
        internal: false,
      }
      const result2 = await evaluate('negate-flag', false, context2, flag)
      expect(result2.value).toBe(true)
      expect(result2.reason).toBe('TARGETING_MATCH')
    })

    it('should handle multiple rules and return first match', async () => {
      const flag: FlagDefinition<string> = {
        key: 'multi-rule-flag',
        defaultValue: 'default',
        variations: [
          { value: 'admin', label: 'Admin', weight: 100 },
          { value: 'beta', label: 'Beta', weight: 100 },
          { value: 'normal', label: 'Normal', weight: 100 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'Admins',
              clauses: [
                {
                  contextKind: 'user',
                  attribute: 'role',
                  operator: 'in',
                  values: ['admin'],
                  negate: false,
                },
              ],
              variation: 0, // Admin
            },
            {
              id: 'rule-2',
              description: 'Beta users',
              clauses: [
                {
                  contextKind: 'user',
                  attribute: 'beta',
                  operator: 'in',
                  values: [true],
                  negate: false,
                },
              ],
              variation: 1, // Beta
            },
          ],
        },
      }

      // Admin user - should match first rule
      const context1: EvaluationContext = {
        targetingKey: 'user-123',
        role: 'admin',
        beta: true,
      }
      const result1 = await evaluate('multi-rule-flag', 'default', context1, flag)
      expect(result1.value).toBe('admin')
      expect(result1.reason).toBe('TARGETING_MATCH')

      // Beta user (not admin) - should match second rule
      const context2: EvaluationContext = {
        targetingKey: 'user-456',
        role: 'user',
        beta: true,
      }
      const result2 = await evaluate('multi-rule-flag', 'default', context2, flag)
      expect(result2.value).toBe('beta')
      expect(result2.reason).toBe('TARGETING_MATCH')
    })
  })

  describe('Rollout Evaluation', () => {
    it('should return SPLIT reason for percentage rollout', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'rollout-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 50 },
          { value: false, label: 'Off', weight: 50 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: '50/50 rollout',
              clauses: [],
              rollout: {
                variations: [
                  { variation: 0, weight: 50000 }, // 50% On
                  { variation: 1, weight: 50000 }, // 50% Off
                ],
                bucketBy: 'targetingKey',
              },
            },
          ],
        },
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
      }

      const result = await evaluate('rollout-flag', false, context, flag)

      expect(result.value).toBeTypeOf('boolean')
      expect(result.reason).toBe('SPLIT')
      expect(['On', 'Off']).toContain(result.variant)
    })

    it('should consistently bucket same user to same variation', async () => {
      const flag: FlagDefinition<string> = {
        key: 'consistent-flag',
        defaultValue: 'control',
        variations: [
          { value: 'A', label: 'Variant A', weight: 33 },
          { value: 'B', label: 'Variant B', weight: 33 },
          { value: 'C', label: 'Variant C', weight: 34 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'ABC test',
              clauses: [],
              rollout: {
                variations: [
                  { variation: 0, weight: 33333 }, // ~33%
                  { variation: 1, weight: 33333 }, // ~33%
                  { variation: 2, weight: 33334 }, // ~34%
                ],
                bucketBy: 'targetingKey',
              },
            },
          ],
        },
      }

      const context: EvaluationContext = {
        targetingKey: 'user-stable-123',
      }

      // Evaluate multiple times - should always get same result
      const results: string[] = []
      for (let i = 0; i < 10; i++) {
        const result = await evaluate('consistent-flag', 'control', context, flag)
        results.push(result.value)
      }

      // All results should be identical
      expect(new Set(results).size).toBe(1)
    })

    it('should use custom bucketBy attribute', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'custom-bucket-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 50 },
          { value: false, label: 'Off', weight: 50 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'Bucket by company',
              clauses: [],
              rollout: {
                variations: [
                  { variation: 0, weight: 50000 },
                  { variation: 1, weight: 50000 },
                ],
                bucketBy: 'companyId',
              },
            },
          ],
        },
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
        companyId: 'company-456',
      }

      const result = await evaluate('custom-bucket-flag', false, context, flag)

      expect(result.reason).toBe('SPLIT')

      // Same company should get same result
      const context2: EvaluationContext = {
        targetingKey: 'user-789', // Different user
        companyId: 'company-456', // Same company
      }
      const result2 = await evaluate('custom-bucket-flag', false, context2, flag)

      expect(result2.value).toBe(result.value)
    })

    it('should distribute users roughly according to weights', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'weighted-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 10 }, // 10%
          { value: false, label: 'Off', weight: 90 }, // 90%
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: '10/90 split',
              clauses: [],
              rollout: {
                variations: [
                  { variation: 0, weight: 10000 }, // 10%
                  { variation: 1, weight: 90000 }, // 90%
                ],
                bucketBy: 'targetingKey',
              },
            },
          ],
        },
      }

      // Test with 100 different users
      const results: boolean[] = []
      for (let i = 0; i < 100; i++) {
        const context: EvaluationContext = {
          targetingKey: `user-${i}`,
        }
        const result = await evaluate('weighted-flag', false, context, flag)
        results.push(result.value)
      }

      const trueCount = results.filter(v => v === true).length
      const falseCount = results.filter(v => v === false).length

      // Should be roughly 10% true, 90% false (with some variance)
      expect(trueCount).toBeGreaterThan(0)
      expect(trueCount).toBeLessThan(30) // Allow variance, but should be closer to 10
      expect(falseCount).toBeGreaterThan(70)
    })

    it('should handle 0% rollout (no users get new variation)', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'zero-rollout-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 0 },
          { value: false, label: 'Off', weight: 100 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: '0% rollout',
              clauses: [],
              rollout: {
                variations: [
                  { variation: 0, weight: 0 },
                  { variation: 1, weight: 100000 },
                ],
                bucketBy: 'targetingKey',
              },
            },
          ],
        },
      }

      // Test with multiple users
      for (let i = 0; i < 20; i++) {
        const context: EvaluationContext = {
          targetingKey: `user-${i}`,
        }
        const result = await evaluate('zero-rollout-flag', false, context, flag)
        expect(result.value).toBe(false)
      }
    })

    it('should handle 100% rollout (all users get new variation)', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'full-rollout-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 100 },
          { value: false, label: 'Off', weight: 0 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: '100% rollout',
              clauses: [],
              rollout: {
                variations: [
                  { variation: 0, weight: 100000 },
                  { variation: 1, weight: 0 },
                ],
                bucketBy: 'targetingKey',
              },
            },
          ],
        },
      }

      // Test with multiple users
      for (let i = 0; i < 20; i++) {
        const context: EvaluationContext = {
          targetingKey: `user-${i}`,
        }
        const result = await evaluate('full-rollout-flag', false, context, flag)
        expect(result.value).toBe(true)
      }
    })

    it('should return error when bucketBy attribute is missing', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'missing-bucket-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 50 },
          { value: false, label: 'Off', weight: 50 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'Bucket by missing attribute',
              clauses: [],
              rollout: {
                variations: [
                  { variation: 0, weight: 50000 },
                  { variation: 1, weight: 50000 },
                ],
                bucketBy: 'customAttribute',
              },
            },
          ],
        },
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
        // customAttribute is missing
      }

      const result = await evaluate('missing-bucket-flag', false, context, flag)

      expect(result.value).toBe(false)
      expect(result.reason).toBe('ERROR')
      expect(result.errorCode).toBe('TARGETING_KEY_MISSING')
    })
  })

  describe('Prerequisites', () => {
    it('should evaluate prerequisite before main flag', async () => {
      const prerequisiteFlag: FlagDefinition<boolean> = {
        key: 'feature-enabled',
        defaultValue: false,
        variations: [
          { value: true, label: 'Enabled', weight: 100 },
          { value: false, label: 'Disabled', weight: 0 },
        ],
      }

      const mainFlag: FlagDefinition<string> = {
        key: 'premium-feature',
        defaultValue: 'off',
        variations: [
          { value: 'on', label: 'On', weight: 100 },
          { value: 'off', label: 'Off', weight: 0 },
        ],
        prerequisites: [
          {
            key: 'feature-enabled',
            variation: 0, // Must be 'Enabled'
          },
        ],
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
      }

      // Mock flag registry
      const flags = new Map([
        ['feature-enabled', prerequisiteFlag],
        ['premium-feature', mainFlag],
      ])

      const result = await evaluate('premium-feature', 'off', context, mainFlag, flags)

      // Prerequisite returns 'Disabled', so main flag should use off variation
      expect(result.value).toBe('off')
      expect(result.reason).toBe('PREREQUISITE_FAILED')
    })

    it('should return off variation when prerequisite fails', async () => {
      const prerequisiteFlag: FlagDefinition<boolean> = {
        key: 'account-active',
        defaultValue: false,
        variations: [
          { value: true, label: 'Active', weight: 0 }, // variation 0
          { value: false, label: 'Inactive', weight: 100 }, // variation 1
        ],
      }

      const mainFlag: FlagDefinition<string> = {
        key: 'advanced-feature',
        defaultValue: 'basic',
        variations: [
          { value: 'advanced', label: 'Advanced', weight: 100 },
          { value: 'basic', label: 'Basic', weight: 0 },
        ],
        prerequisites: [
          {
            key: 'account-active',
            variation: 0, // Requires Active (true)
          },
        ],
        offVariation: 1, // Return 'basic' when prerequisites fail
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
      }

      const flags = new Map([
        ['account-active', prerequisiteFlag],
        ['advanced-feature', mainFlag],
      ])

      const result = await evaluate('advanced-feature', 'basic', context, mainFlag, flags)

      expect(result.value).toBe('basic')
      expect(result.reason).toBe('PREREQUISITE_FAILED')
    })

    it('should handle multiple prerequisites (all must pass)', async () => {
      const prereq1: FlagDefinition<boolean> = {
        key: 'feature-a-enabled',
        defaultValue: true,
        variations: [
          { value: true, label: 'Enabled', weight: 100 },
          { value: false, label: 'Disabled', weight: 0 },
        ],
      }

      const prereq2: FlagDefinition<boolean> = {
        key: 'feature-b-enabled',
        defaultValue: true,
        variations: [
          { value: true, label: 'Enabled', weight: 100 },
          { value: false, label: 'Disabled', weight: 0 },
        ],
      }

      const mainFlag: FlagDefinition<string> = {
        key: 'combined-feature',
        defaultValue: 'off',
        variations: [
          { value: 'on', label: 'On', weight: 100 },
          { value: 'off', label: 'Off', weight: 0 },
        ],
        prerequisites: [
          { key: 'feature-a-enabled', variation: 0 },
          { key: 'feature-b-enabled', variation: 0 },
        ],
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
      }

      const flags = new Map([
        ['feature-a-enabled', prereq1],
        ['feature-b-enabled', prereq2],
        ['combined-feature', mainFlag],
      ])

      const result = await evaluate('combined-feature', 'off', context, mainFlag, flags)

      // Both prerequisites return 'Enabled', so main flag should evaluate
      expect(result.value).toBe('on')
      expect(result.reason).not.toBe('PREREQUISITE_FAILED')
    })

    it('should handle recursive prerequisites', async () => {
      const prereq1: FlagDefinition<boolean> = {
        key: 'base-feature',
        defaultValue: true,
        variations: [
          { value: true, label: 'Enabled', weight: 100 },
          { value: false, label: 'Disabled', weight: 0 },
        ],
      }

      const prereq2: FlagDefinition<boolean> = {
        key: 'mid-feature',
        defaultValue: true,
        variations: [
          { value: true, label: 'Enabled', weight: 100 },
          { value: false, label: 'Disabled', weight: 0 },
        ],
        prerequisites: [
          { key: 'base-feature', variation: 0 },
        ],
      }

      const mainFlag: FlagDefinition<string> = {
        key: 'top-feature',
        defaultValue: 'off',
        variations: [
          { value: 'on', label: 'On', weight: 100 },
          { value: 'off', label: 'Off', weight: 0 },
        ],
        prerequisites: [
          { key: 'mid-feature', variation: 0 },
        ],
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
      }

      const flags = new Map([
        ['base-feature', prereq1],
        ['mid-feature', prereq2],
        ['top-feature', mainFlag],
      ])

      const result = await evaluate('top-feature', 'off', context, mainFlag, flags)

      // All prerequisites pass, so main flag should evaluate
      expect(result.value).toBe('on')
      expect(result.reason).not.toBe('PREREQUISITE_FAILED')
    })

    it('should detect and prevent circular prerequisites', async () => {
      const flag1: FlagDefinition<boolean> = {
        key: 'flag-a',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 100 },
          { value: false, label: 'Off', weight: 0 },
        ],
        prerequisites: [
          { key: 'flag-b', variation: 0 },
        ],
      }

      const flag2: FlagDefinition<boolean> = {
        key: 'flag-b',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 100 },
          { value: false, label: 'Off', weight: 0 },
        ],
        prerequisites: [
          { key: 'flag-a', variation: 0 },
        ],
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
      }

      const flags = new Map([
        ['flag-a', flag1],
        ['flag-b', flag2],
      ])

      const result = await evaluate('flag-a', false, context, flag1, flags)

      expect(result.value).toBe(false)
      expect(result.reason).toBe('ERROR')
      expect(result.errorCode).toBe('GENERAL')
      expect(result.errorMessage).toContain('circular')
    })
  })

  describe('matchesTargeting helper', () => {
    it('should return true when all clauses match', () => {
      const rule: TargetingRule = {
        id: 'rule-1',
        description: 'Test rule',
        clauses: [
          {
            contextKind: 'user',
            attribute: 'email',
            operator: 'in',
            values: ['test@example.com.ai'],
            negate: false,
          },
        ],
        variation: 0,
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
        email: 'test@example.com.ai',
      }

      expect(matchesTargeting(rule, context)).toBe(true)
    })

    it('should return false when any clause does not match', () => {
      const rule: TargetingRule = {
        id: 'rule-1',
        description: 'Test rule',
        clauses: [
          {
            contextKind: 'user',
            attribute: 'email',
            operator: 'in',
            values: ['test@example.com.ai'],
            negate: false,
          },
          {
            contextKind: 'user',
            attribute: 'tier',
            operator: 'in',
            values: ['premium'],
            negate: false,
          },
        ],
        variation: 0,
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
        email: 'test@example.com.ai',
        tier: 'free', // Does not match
      }

      expect(matchesTargeting(rule, context)).toBe(false)
    })

    it('should return false when attribute is missing from context', () => {
      const rule: TargetingRule = {
        id: 'rule-1',
        description: 'Test rule',
        clauses: [
          {
            contextKind: 'user',
            attribute: 'customAttribute',
            operator: 'in',
            values: ['value'],
            negate: false,
          },
        ],
        variation: 0,
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
        // customAttribute is missing
      }

      expect(matchesTargeting(rule, context)).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('should handle flag with no variations', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'no-variations-flag',
        defaultValue: false,
        variations: [],
      }

      const result = await evaluate('no-variations-flag', false, { targetingKey: 'user-123' }, flag)

      expect(result.value).toBe(false)
      expect(result.reason).toBe('DEFAULT')
    })

    it('should handle missing targetingKey in context', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'targeting-key-required',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 100 },
          { value: false, label: 'Off', weight: 0 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'Rollout',
              clauses: [],
              rollout: {
                variations: [
                  { variation: 0, weight: 50000 },
                  { variation: 1, weight: 50000 },
                ],
                bucketBy: 'targetingKey',
              },
            },
          ],
        },
      }

      const context: EvaluationContext = {
        // No targetingKey
      }

      const result = await evaluate('targeting-key-required', false, context, flag)

      expect(result.value).toBe(false)
      expect(result.reason).toBe('ERROR')
      expect(result.errorCode).toBe('TARGETING_KEY_MISSING')
    })

    it('should handle invalid variation index', async () => {
      const flag: FlagDefinition<string> = {
        key: 'invalid-variation',
        defaultValue: 'default',
        variations: [
          { value: 'A', label: 'Variant A', weight: 100 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'Invalid variation reference',
              clauses: [],
              variation: 999, // Out of bounds
            },
          ],
        },
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
      }

      const result = await evaluate('invalid-variation', 'default', context, flag)

      expect(result.value).toBe('default')
      expect(result.reason).toBe('ERROR')
      expect(result.errorCode).toBe('GENERAL')
    })

    it('should handle null and undefined values in context', async () => {
      const flag: FlagDefinition<boolean> = {
        key: 'null-value-flag',
        defaultValue: false,
        variations: [
          { value: true, label: 'On', weight: 100 },
          { value: false, label: 'Off', weight: 0 },
        ],
        targeting: {
          rules: [
            {
              id: 'rule-1',
              description: 'Check null value',
              clauses: [
                {
                  contextKind: 'user',
                  attribute: 'nullableField',
                  operator: 'in',
                  values: [null],
                  negate: false,
                },
              ],
              variation: 0,
            },
          ],
        },
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
        nullableField: null,
      }

      const result = await evaluate('null-value-flag', false, context, flag)

      expect(result.value).toBe(true)
      expect(result.reason).toBe('TARGETING_MATCH')
    })

    it('should handle complex nested object values', async () => {
      const flag: FlagDefinition<string> = {
        key: 'complex-flag',
        defaultValue: 'default',
        variations: [
          { value: 'matched', label: 'Matched', weight: 100 },
          { value: 'default', label: 'Default', weight: 0 },
        ],
      }

      const context: EvaluationContext = {
        targetingKey: 'user-123',
        metadata: {
          company: {
            id: 'company-456',
            name: 'Test Corp',
          },
        },
      }

      const result = await evaluate('complex-flag', 'default', context, flag)

      // Should not throw error with complex context
      expect(result.value).toBeDefined()
    })
  })
})
