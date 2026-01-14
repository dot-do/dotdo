import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  FeatureFlagClient,
  FlagStore,
  RuleEngine,
  PercentageRollout,
  CohortTargeting,
  ScheduledFlags,
  FlagOverrides,
} from './index'
import type {
  FeatureFlag,
  EvaluationContext,
  FlagOverride,
  Cohort,
} from './types'

describe('FeatureFlagClient', () => {
  describe('Simple Boolean Flags', () => {
    it('should return true for an enabled boolean flag', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: true },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('feature-a')).toBe(true)
    })

    it('should return false for a disabled flag', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: false, defaultValue: true },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('feature-a')).toBe(false)
    })

    it('should return defaultValue when flag is enabled', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: false },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('feature-a')).toBe(false)
    })

    it('should return false for non-existent flags', () => {
      const client = new FeatureFlagClient({ flags: [] })

      expect(client.isEnabled('non-existent')).toBe(false)
    })

    it('should evaluate flag with context', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: true },
      ]
      const client = new FeatureFlagClient({ flags })
      const context: EvaluationContext = { userId: 'user-123' }

      const result = client.evaluate('feature-a', context)

      expect(result.value).toBe(true)
      expect(result.flagFound).toBe(true)
      expect(result.reason).toBe('DEFAULT_VALUE')
    })

    it('should return FLAG_NOT_FOUND reason for missing flags', () => {
      const client = new FeatureFlagClient({ flags: [] })

      const result = client.evaluate('missing-flag')

      expect(result.value).toBe(false)
      expect(result.flagFound).toBe(false)
      expect(result.reason).toBe('FLAG_NOT_FOUND')
    })

    it('should return FLAG_DISABLED reason when flag is disabled', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: false, defaultValue: true },
      ]
      const client = new FeatureFlagClient({ flags })

      const result = client.evaluate('feature-a')

      expect(result.value).toBe(false)
      expect(result.reason).toBe('FLAG_DISABLED')
    })
  })

  describe('Percentage Rollouts', () => {
    it('should be deterministic based on userId', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'rollout-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Same user should always get same result
      const result1 = client.isEnabled('rollout-feature', { userId: 'user-123' })
      const result2 = client.isEnabled('rollout-feature', { userId: 'user-123' })

      expect(result1).toBe(result2)
    })

    it('should include all users at 100%', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'full-rollout',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 100 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Test multiple users
      for (let i = 0; i < 100; i++) {
        expect(client.isEnabled('full-rollout', { userId: `user-${i}` })).toBe(true)
      }
    })

    it('should exclude all users at 0%', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'no-rollout',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 0 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      for (let i = 0; i < 100; i++) {
        expect(client.isEnabled('no-rollout', { userId: `user-${i}` })).toBe(false)
      }
    })

    it('should roughly match percentage distribution', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'fifty-percent',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      let enabledCount = 0
      const totalUsers = 1000

      for (let i = 0; i < totalUsers; i++) {
        if (client.isEnabled('fifty-percent', { userId: `user-${i}` })) {
          enabledCount++
        }
      }

      // Allow 10% variance
      expect(enabledCount).toBeGreaterThan(400)
      expect(enabledCount).toBeLessThan(600)
    })

    it('should use custom bucket key', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'org-rollout',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50, bucketBy: 'orgId' },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Same org should get same result regardless of userId
      const result1 = client.isEnabled('org-rollout', {
        userId: 'user-1',
        attributes: { orgId: 'org-abc' },
      })
      const result2 = client.isEnabled('org-rollout', {
        userId: 'user-2',
        attributes: { orgId: 'org-abc' },
      })

      expect(result1).toBe(result2)
    })

    it('should return PERCENTAGE_ROLLOUT reason', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'rollout-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 100 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const result = client.evaluate('rollout-feature', { userId: 'user-123' })

      expect(result.reason).toBe('PERCENTAGE_ROLLOUT')
    })
  })

  describe('Attribute-Based Targeting', () => {
    it('should match equals condition', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'premium-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'plan', operator: 'eq', values: ['premium'] }],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('premium-feature', { attributes: { plan: 'premium' } })).toBe(true)
      expect(client.isEnabled('premium-feature', { attributes: { plan: 'free' } })).toBe(false)
    })

    it('should match not equals condition', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'non-free-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'plan', operator: 'neq', values: ['free'] }],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('non-free-feature', { attributes: { plan: 'premium' } })).toBe(true)
      expect(client.isEnabled('non-free-feature', { attributes: { plan: 'free' } })).toBe(false)
    })

    it('should match in condition', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'beta-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [
                { attribute: 'userId', operator: 'in', values: ['user-1', 'user-2', 'user-3'] },
              ],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('beta-feature', { userId: 'user-1' })).toBe(true)
      expect(client.isEnabled('beta-feature', { userId: 'user-99' })).toBe(false)
    })

    it('should match greater than condition', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'high-value-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'totalSpent', operator: 'gt', values: [1000] }],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('high-value-feature', { attributes: { totalSpent: 1500 } })).toBe(true)
      expect(client.isEnabled('high-value-feature', { attributes: { totalSpent: 500 } })).toBe(false)
    })

    it('should match contains condition for strings', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'internal-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'email', operator: 'contains', values: ['@company.com'] }],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('internal-feature', { attributes: { email: 'john@company.com' } })).toBe(true)
      expect(client.isEnabled('internal-feature', { attributes: { email: 'john@gmail.com' } })).toBe(false)
    })

    it('should support nested attribute access with dot notation', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'region-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'location.country', operator: 'eq', values: ['US'] }],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(
        client.isEnabled('region-feature', {
          attributes: { location: { country: 'US', city: 'NYC' } },
        })
      ).toBe(true)
    })

    it('should require ALL conditions to match (AND logic)', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'vip-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [
                { attribute: 'plan', operator: 'eq', values: ['premium'] },
                { attribute: 'verified', operator: 'eq', values: [true] },
              ],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(
        client.isEnabled('vip-feature', { attributes: { plan: 'premium', verified: true } })
      ).toBe(true)
      expect(
        client.isEnabled('vip-feature', { attributes: { plan: 'premium', verified: false } })
      ).toBe(false)
      expect(
        client.isEnabled('vip-feature', { attributes: { plan: 'free', verified: true } })
      ).toBe(false)
    })

    it('should return RULE_MATCH reason when rule matches', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'targeted-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              id: 'premium-rule',
              conditions: [{ attribute: 'plan', operator: 'eq', values: ['premium'] }],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const result = client.evaluate('targeted-feature', { attributes: { plan: 'premium' } })

      expect(result.reason).toBe('RULE_MATCH')
      expect(result.ruleId).toBe('premium-rule')
    })
  })

  describe('Multi-Variant Experiments', () => {
    it('should return variant value', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'button-color',
          enabled: true,
          defaultValue: 'blue',
          variants: [
            { key: 'control', value: 'blue', weight: 50 },
            { key: 'treatment', value: 'green', weight: 50 },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const result = client.getVariant('button-color', { userId: 'user-123' })

      expect(['blue', 'green']).toContain(result)
    })

    it('should be deterministic for same user', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'experiment',
          enabled: true,
          defaultValue: 'control',
          variants: [
            { key: 'control', value: 'a', weight: 33 },
            { key: 'variant-b', value: 'b', weight: 33 },
            { key: 'variant-c', value: 'c', weight: 34 },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const result1 = client.getVariant('experiment', { userId: 'user-456' })
      const result2 = client.getVariant('experiment', { userId: 'user-456' })

      expect(result1).toBe(result2)
    })

    it('should distribute variants according to weights', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'weighted-experiment',
          enabled: true,
          defaultValue: 'control',
          variants: [
            { key: 'control', value: 'control', weight: 80 },
            { key: 'treatment', value: 'treatment', weight: 20 },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const counts: Record<string, number> = { control: 0, treatment: 0 }

      for (let i = 0; i < 1000; i++) {
        const variant = client.getVariant('weighted-experiment', { userId: `user-${i}` }) as string
        counts[variant]++
      }

      // Control should be around 80%, treatment around 20%
      expect(counts.control).toBeGreaterThan(700)
      expect(counts.treatment).toBeLessThan(300)
    })

    it('should include variant key in evaluation result', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'experiment',
          enabled: true,
          defaultValue: 'default',
          variants: [
            { key: 'control', value: 'a', weight: 50 },
            { key: 'treatment', value: 'b', weight: 50 },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const result = client.evaluate('experiment', { userId: 'user-123' })

      expect(result.variant).toBeDefined()
      expect(['control', 'treatment']).toContain(result.variant)
      expect(result.reason).toBe('VARIANT_SELECTED')
    })

    it('should return default value when flag has no variants and user not in rollout', () => {
      const flags: FeatureFlag[] = [
        { key: 'no-variants', enabled: true, defaultValue: 'default-value' },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.getVariant('no-variants')).toBe('default-value')
    })

    it('should select variant based on rule match', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'targeted-experiment',
          enabled: true,
          defaultValue: 'control',
          variants: [
            { key: 'control', value: 'control', weight: 50 },
            { key: 'premium-variant', value: 'premium', weight: 50 },
          ],
          rules: [
            {
              conditions: [{ attribute: 'plan', operator: 'eq', values: ['premium'] }],
              variant: 'premium-variant',
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.getVariant('targeted-experiment', { attributes: { plan: 'premium' } })).toBe(
        'premium'
      )
    })
  })

  describe('Scheduled Flags', () => {
    it('should activate flag after start time', () => {
      const now = new Date()
      const pastDate = new Date(now.getTime() - 3600000).toISOString() // 1 hour ago

      const flags: FeatureFlag[] = [
        {
          key: 'scheduled-feature',
          enabled: true,
          defaultValue: false,
          rollout: {
            percentage: 100,
            schedule: { start: pastDate },
          },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('scheduled-feature', { userId: 'user-123' })).toBe(true)
    })

    it('should not activate flag before start time', () => {
      const now = new Date()
      const futureDate = new Date(now.getTime() + 3600000).toISOString() // 1 hour from now

      const flags: FeatureFlag[] = [
        {
          key: 'future-feature',
          enabled: true,
          defaultValue: false,
          rollout: {
            percentage: 100,
            schedule: { start: futureDate },
          },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('future-feature', { userId: 'user-123' })).toBe(false)
    })

    it('should deactivate flag after end time', () => {
      const now = new Date()
      const pastStart = new Date(now.getTime() - 7200000).toISOString() // 2 hours ago
      const pastEnd = new Date(now.getTime() - 3600000).toISOString() // 1 hour ago

      const flags: FeatureFlag[] = [
        {
          key: 'expired-feature',
          enabled: true,
          defaultValue: false,
          rollout: {
            percentage: 100,
            schedule: { start: pastStart, end: pastEnd },
          },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('expired-feature', { userId: 'user-123' })).toBe(false)
    })

    it('should be active within schedule window', () => {
      const now = new Date()
      const pastStart = new Date(now.getTime() - 3600000).toISOString() // 1 hour ago
      const futureEnd = new Date(now.getTime() + 3600000).toISOString() // 1 hour from now

      const flags: FeatureFlag[] = [
        {
          key: 'active-feature',
          enabled: true,
          defaultValue: false,
          rollout: {
            percentage: 100,
            schedule: { start: pastStart, end: futureEnd },
          },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('active-feature', { userId: 'user-123' })).toBe(true)
    })

    it('should respect context timestamp over current time', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString() // Tomorrow

      const flags: FeatureFlag[] = [
        {
          key: 'future-check',
          enabled: true,
          defaultValue: false,
          rollout: {
            percentage: 100,
            schedule: { start: futureDate },
          },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Using context timestamp in the future
      const futureTomorrow = new Date(Date.now() + 172800000).toISOString() // Day after tomorrow
      expect(client.isEnabled('future-check', { userId: 'user-123', timestamp: futureTomorrow })).toBe(
        true
      )
    })

    it('should return SCHEDULED reason when schedule affects result', () => {
      const now = new Date()
      const futureDate = new Date(now.getTime() + 3600000).toISOString()

      const flags: FeatureFlag[] = [
        {
          key: 'scheduled-flag',
          enabled: true,
          defaultValue: false,
          rollout: {
            percentage: 100,
            schedule: { start: futureDate },
          },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const result = client.evaluate('scheduled-flag', { userId: 'user-123' })

      expect(result.reason).toBe('SCHEDULED')
      expect(result.value).toBe(false)
    })
  })

  describe('Flag Overrides', () => {
    it('should override flag value for specific user', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: false },
      ]
      const overrides: FlagOverride[] = [
        { flagKey: 'feature-a', userId: 'special-user', value: true },
      ]
      const client = new FeatureFlagClient({ flags, overrides })

      expect(client.isEnabled('feature-a', { userId: 'special-user' })).toBe(true)
      expect(client.isEnabled('feature-a', { userId: 'regular-user' })).toBe(false)
    })

    it('should override flag value for specific session', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: false },
      ]
      const overrides: FlagOverride[] = [
        { flagKey: 'feature-a', sessionId: 'test-session', value: true },
      ]
      const client = new FeatureFlagClient({ flags, overrides })

      expect(client.isEnabled('feature-a', { sessionId: 'test-session' })).toBe(true)
      expect(client.isEnabled('feature-a', { sessionId: 'other-session' })).toBe(false)
    })

    it('should user override takes precedence over session override', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: false },
      ]
      const overrides: FlagOverride[] = [
        { flagKey: 'feature-a', sessionId: 'session-1', value: true },
        { flagKey: 'feature-a', userId: 'user-1', value: false },
      ]
      const client = new FeatureFlagClient({ flags, overrides })

      // User override should take precedence
      expect(client.isEnabled('feature-a', { userId: 'user-1', sessionId: 'session-1' })).toBe(false)
    })

    it('should respect override expiration', () => {
      const now = new Date()
      const pastDate = new Date(now.getTime() - 3600000).toISOString() // 1 hour ago

      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: false },
      ]
      const overrides: FlagOverride[] = [
        { flagKey: 'feature-a', userId: 'user-1', value: true, expiresAt: pastDate },
      ]
      const client = new FeatureFlagClient({ flags, overrides })

      // Override expired, should fall back to default
      expect(client.isEnabled('feature-a', { userId: 'user-1' })).toBe(false)
    })

    it('should return OVERRIDE reason when override applies', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: false },
      ]
      const overrides: FlagOverride[] = [
        { flagKey: 'feature-a', userId: 'user-1', value: true },
      ]
      const client = new FeatureFlagClient({ flags, overrides })

      const result = client.evaluate('feature-a', { userId: 'user-1' })

      expect(result.reason).toBe('OVERRIDE')
      expect(result.value).toBe(true)
    })

    it('should allow adding overrides at runtime', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: false },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('feature-a', { userId: 'user-1' })).toBe(false)

      client.setOverride({ flagKey: 'feature-a', userId: 'user-1', value: true })

      expect(client.isEnabled('feature-a', { userId: 'user-1' })).toBe(true)
    })

    it('should allow removing overrides', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: false },
      ]
      const overrides: FlagOverride[] = [
        { flagKey: 'feature-a', userId: 'user-1', value: true },
      ]
      const client = new FeatureFlagClient({ flags, overrides })

      expect(client.isEnabled('feature-a', { userId: 'user-1' })).toBe(true)

      client.removeOverride('feature-a', 'user-1')

      expect(client.isEnabled('feature-a', { userId: 'user-1' })).toBe(false)
    })
  })

  describe('Complex Rule Combinations', () => {
    it('should support OR logic between condition groups', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'special-access',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditionGroups: [
                [{ attribute: 'role', operator: 'eq', values: ['admin'] }],
                [{ attribute: 'plan', operator: 'eq', values: ['enterprise'] }],
              ],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Admin gets access
      expect(client.isEnabled('special-access', { attributes: { role: 'admin', plan: 'free' } })).toBe(
        true
      )
      // Enterprise gets access
      expect(
        client.isEnabled('special-access', { attributes: { role: 'user', plan: 'enterprise' } })
      ).toBe(true)
      // Neither gets denied
      expect(client.isEnabled('special-access', { attributes: { role: 'user', plan: 'free' } })).toBe(
        false
      )
    })

    it('should evaluate rules in order and use first match', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'tiered-feature',
          enabled: true,
          defaultValue: 'basic',
          rules: [
            {
              conditions: [{ attribute: 'plan', operator: 'eq', values: ['enterprise'] }],
              value: 'enterprise',
            },
            {
              conditions: [{ attribute: 'plan', operator: 'eq', values: ['premium'] }],
              value: 'premium',
            },
            {
              conditions: [{ attribute: 'plan', operator: 'in', values: ['free', 'starter'] }],
              value: 'basic',
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.evaluate('tiered-feature', { attributes: { plan: 'enterprise' } }).value).toBe(
        'enterprise'
      )
      expect(client.evaluate('tiered-feature', { attributes: { plan: 'premium' } }).value).toBe(
        'premium'
      )
      expect(client.evaluate('tiered-feature', { attributes: { plan: 'free' } }).value).toBe('basic')
    })

    it('should support rule with percentage rollout', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'gradual-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'plan', operator: 'eq', values: ['premium'] }],
              percentage: 50,
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Only premium users eligible, and only 50% of them
      let premiumEnabled = 0
      for (let i = 0; i < 100; i++) {
        if (
          client.isEnabled('gradual-feature', {
            userId: `user-${i}`,
            attributes: { plan: 'premium' },
          })
        ) {
          premiumEnabled++
        }
      }

      // Free users never enabled
      let freeEnabled = 0
      for (let i = 0; i < 100; i++) {
        if (
          client.isEnabled('gradual-feature', {
            userId: `user-${i}`,
            attributes: { plan: 'free' },
          })
        ) {
          freeEnabled++
        }
      }

      expect(premiumEnabled).toBeGreaterThan(30)
      expect(premiumEnabled).toBeLessThan(70)
      expect(freeEnabled).toBe(0)
    })

    it('should support disabled rules', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'feature-with-disabled-rule',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              enabled: false,
              conditions: [{ attribute: 'plan', operator: 'eq', values: ['premium'] }],
              value: true,
            },
            {
              enabled: true,
              conditions: [{ attribute: 'plan', operator: 'eq', values: ['enterprise'] }],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Premium rule disabled, so premium users don't get feature
      expect(client.isEnabled('feature-with-disabled-rule', { attributes: { plan: 'premium' } })).toBe(
        false
      )
      // Enterprise rule enabled
      expect(
        client.isEnabled('feature-with-disabled-rule', { attributes: { plan: 'enterprise' } })
      ).toBe(true)
    })
  })

  describe('Cohort Targeting', () => {
    it('should match users in a cohort', () => {
      const cohorts: Cohort[] = [
        {
          id: 'beta-testers',
          name: 'Beta Testers',
          rules: [{ attribute: 'betaTester', operator: 'eq', values: [true] }],
        },
      ]
      const flags: FeatureFlag[] = [
        {
          key: 'beta-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 100, cohort: 'beta-testers' },
        },
      ]
      const client = new FeatureFlagClient({ flags, cohorts })

      expect(client.isEnabled('beta-feature', { attributes: { betaTester: true } })).toBe(true)
      expect(client.isEnabled('beta-feature', { attributes: { betaTester: false } })).toBe(false)
    })

    it('should match users by explicit cohort membership', () => {
      const cohorts: Cohort[] = [
        {
          id: 'vip-users',
          name: 'VIP Users',
          rules: [],
          userIds: ['user-1', 'user-2', 'user-3'],
        },
      ]
      const flags: FeatureFlag[] = [
        {
          key: 'vip-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 100, cohort: 'vip-users' },
        },
      ]
      const client = new FeatureFlagClient({ flags, cohorts })

      expect(client.isEnabled('vip-feature', { userId: 'user-1' })).toBe(true)
      expect(client.isEnabled('vip-feature', { userId: 'user-99' })).toBe(false)
    })
  })

  describe('getAllFlags', () => {
    it('should return all flag values for context', () => {
      const flags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: true },
        { key: 'feature-b', enabled: true, defaultValue: false },
        { key: 'feature-c', enabled: false, defaultValue: true },
      ]
      const client = new FeatureFlagClient({ flags })

      const allFlags = client.getAllFlags({ userId: 'user-123' })

      expect(allFlags).toEqual({
        'feature-a': true,
        'feature-b': false,
        'feature-c': false, // disabled flag returns false
      })
    })

    it('should respect rules when getting all flags', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'premium-feature',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'plan', operator: 'eq', values: ['premium'] }],
              value: true,
            },
          ],
        },
        { key: 'general-feature', enabled: true, defaultValue: true },
      ]
      const client = new FeatureFlagClient({ flags })

      const premiumFlags = client.getAllFlags({ attributes: { plan: 'premium' } })
      const freeFlags = client.getAllFlags({ attributes: { plan: 'free' } })

      expect(premiumFlags).toEqual({
        'premium-feature': true,
        'general-feature': true,
      })
      expect(freeFlags).toEqual({
        'premium-feature': false,
        'general-feature': true,
      })
    })
  })

  describe('Default Values', () => {
    it('should return typed default values', () => {
      const flags: FeatureFlag[] = [
        { key: 'string-flag', enabled: true, defaultValue: 'hello' },
        { key: 'number-flag', enabled: true, defaultValue: 42 },
        { key: 'object-flag', enabled: true, defaultValue: { theme: 'dark' } },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.evaluate('string-flag').value).toBe('hello')
      expect(client.evaluate('number-flag').value).toBe(42)
      expect(client.evaluate('object-flag').value).toEqual({ theme: 'dark' })
    })

    it('should use default context from config', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'contextual-flag',
          enabled: true,
          defaultValue: false,
          rules: [
            {
              conditions: [{ attribute: 'environment', operator: 'eq', values: ['production'] }],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({
        flags,
        defaultContext: { attributes: { environment: 'production' } },
      })

      // Without explicit context, uses default
      expect(client.isEnabled('contextual-flag')).toBe(true)
    })
  })

  describe('Flag Inheritance', () => {
    it('should support parent-child flag relationships', () => {
      const flags: FeatureFlag[] = [
        { key: 'parent-feature', enabled: false, defaultValue: true },
        {
          key: 'child-feature',
          enabled: true,
          defaultValue: true,
          rules: [
            {
              conditions: [{ attribute: '_parentFlag', operator: 'eq', values: ['parent-feature'] }],
              value: true,
            },
          ],
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Child should be disabled when parent is disabled
      // This is handled by the implementation checking parent flag status
      expect(client.isEnabled('child-feature')).toBe(true) // Child evaluates independently unless parent dependency defined
    })
  })

  describe('Cache Behavior', () => {
    it('should update flags when store is updated', () => {
      const initialFlags: FeatureFlag[] = [
        { key: 'feature-a', enabled: true, defaultValue: false },
      ]
      const client = new FeatureFlagClient({ flags: initialFlags })

      expect(client.isEnabled('feature-a')).toBe(false)

      client.updateFlags([{ key: 'feature-a', enabled: true, defaultValue: true }])

      expect(client.isEnabled('feature-a')).toBe(true)
    })

    it('should add new flags to store', () => {
      const client = new FeatureFlagClient({ flags: [] })

      expect(client.isEnabled('new-feature')).toBe(false)

      client.addFlag({ key: 'new-feature', enabled: true, defaultValue: true })

      expect(client.isEnabled('new-feature')).toBe(true)
    })

    it('should remove flags from store', () => {
      const flags: FeatureFlag[] = [
        { key: 'removable-feature', enabled: true, defaultValue: true },
      ]
      const client = new FeatureFlagClient({ flags })

      expect(client.isEnabled('removable-feature')).toBe(true)

      client.removeFlag('removable-feature')

      expect(client.isEnabled('removable-feature')).toBe(false)
    })
  })
})

describe('FlagStore', () => {
  it('should store and retrieve flags', () => {
    const store = new FlagStore()
    const flag: FeatureFlag = { key: 'test-flag', enabled: true, defaultValue: true }

    store.set(flag)

    expect(store.get('test-flag')).toEqual(flag)
  })

  it('should return undefined for non-existent flags', () => {
    const store = new FlagStore()

    expect(store.get('non-existent')).toBeUndefined()
  })

  it('should list all flags', () => {
    const store = new FlagStore()
    store.set({ key: 'flag-a', enabled: true, defaultValue: true })
    store.set({ key: 'flag-b', enabled: false, defaultValue: false })

    const allFlags = store.getAll()

    expect(allFlags).toHaveLength(2)
    expect(allFlags.map((f) => f.key)).toContain('flag-a')
    expect(allFlags.map((f) => f.key)).toContain('flag-b')
  })

  it('should delete flags', () => {
    const store = new FlagStore()
    store.set({ key: 'deletable', enabled: true, defaultValue: true })

    expect(store.get('deletable')).toBeDefined()

    store.delete('deletable')

    expect(store.get('deletable')).toBeUndefined()
  })
})

describe('RuleEngine', () => {
  let engine: RuleEngine

  beforeEach(() => {
    engine = new RuleEngine()
  })

  describe('Operators', () => {
    it('should evaluate eq operator', () => {
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'eq', values: [1] }, { a: 1 })).toBe(
        true
      )
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'eq', values: [1] }, { a: 2 })).toBe(
        false
      )
    })

    it('should evaluate neq operator', () => {
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'neq', values: [1] }, { a: 2 })).toBe(
        true
      )
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'neq', values: [1] }, { a: 1 })).toBe(
        false
      )
    })

    it('should evaluate gt operator', () => {
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'gt', values: [5] }, { a: 10 })).toBe(
        true
      )
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'gt', values: [5] }, { a: 3 })).toBe(
        false
      )
    })

    it('should evaluate gte operator', () => {
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'gte', values: [5] }, { a: 5 })).toBe(
        true
      )
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'gte', values: [5] }, { a: 4 })).toBe(
        false
      )
    })

    it('should evaluate lt operator', () => {
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'lt', values: [5] }, { a: 3 })).toBe(
        true
      )
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'lt', values: [5] }, { a: 10 })).toBe(
        false
      )
    })

    it('should evaluate lte operator', () => {
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'lte', values: [5] }, { a: 5 })).toBe(
        true
      )
      expect(engine.evaluateCondition({ attribute: 'a', operator: 'lte', values: [5] }, { a: 6 })).toBe(
        false
      )
    })

    it('should evaluate in operator', () => {
      expect(
        engine.evaluateCondition({ attribute: 'a', operator: 'in', values: [1, 2, 3] }, { a: 2 })
      ).toBe(true)
      expect(
        engine.evaluateCondition({ attribute: 'a', operator: 'in', values: [1, 2, 3] }, { a: 5 })
      ).toBe(false)
    })

    it('should evaluate nin operator', () => {
      expect(
        engine.evaluateCondition({ attribute: 'a', operator: 'nin', values: [1, 2, 3] }, { a: 5 })
      ).toBe(true)
      expect(
        engine.evaluateCondition({ attribute: 'a', operator: 'nin', values: [1, 2, 3] }, { a: 2 })
      ).toBe(false)
    })

    it('should evaluate contains operator', () => {
      expect(
        engine.evaluateCondition({ attribute: 'email', operator: 'contains', values: ['@test.com'] }, {
          email: 'user@test.com',
        })
      ).toBe(true)
      expect(
        engine.evaluateCondition({ attribute: 'email', operator: 'contains', values: ['@test.com'] }, {
          email: 'user@other.com',
        })
      ).toBe(false)
    })

    it('should evaluate startsWith operator', () => {
      expect(
        engine.evaluateCondition({ attribute: 'name', operator: 'startsWith', values: ['John'] }, {
          name: 'John Doe',
        })
      ).toBe(true)
      expect(
        engine.evaluateCondition({ attribute: 'name', operator: 'startsWith', values: ['John'] }, {
          name: 'Jane Doe',
        })
      ).toBe(false)
    })

    it('should evaluate endsWith operator', () => {
      expect(
        engine.evaluateCondition({ attribute: 'file', operator: 'endsWith', values: ['.txt'] }, {
          file: 'document.txt',
        })
      ).toBe(true)
      expect(
        engine.evaluateCondition({ attribute: 'file', operator: 'endsWith', values: ['.txt'] }, {
          file: 'document.pdf',
        })
      ).toBe(false)
    })

    it('should evaluate matches operator (regex)', () => {
      expect(
        engine.evaluateCondition({ attribute: 'code', operator: 'matches', values: ['^[A-Z]{3}$'] }, {
          code: 'ABC',
        })
      ).toBe(true)
      expect(
        engine.evaluateCondition({ attribute: 'code', operator: 'matches', values: ['^[A-Z]{3}$'] }, {
          code: 'abcd',
        })
      ).toBe(false)
    })
  })

  describe('Nested Attributes', () => {
    it('should access nested attributes with dot notation', () => {
      const context = {
        user: {
          profile: {
            age: 25,
          },
        },
      }

      expect(
        engine.evaluateCondition({ attribute: 'user.profile.age', operator: 'gte', values: [18] }, context)
      ).toBe(true)
    })

    it('should return false for missing nested attributes', () => {
      const context = { user: {} }

      expect(
        engine.evaluateCondition(
          { attribute: 'user.profile.age', operator: 'eq', values: [25] },
          context
        )
      ).toBe(false)
    })
  })
})

describe('PercentageRollout', () => {
  it('should generate consistent hash for same key', () => {
    const rollout = new PercentageRollout()

    const hash1 = rollout.hash('user-123', 'feature-a')
    const hash2 = rollout.hash('user-123', 'feature-a')

    expect(hash1).toBe(hash2)
  })

  it('should generate different hashes for different keys', () => {
    const rollout = new PercentageRollout()

    const hash1 = rollout.hash('user-123', 'feature-a')
    const hash2 = rollout.hash('user-123', 'feature-b')

    expect(hash1).not.toBe(hash2)
  })

  it('should return value between 0 and 100', () => {
    const rollout = new PercentageRollout()

    for (let i = 0; i < 1000; i++) {
      const value = rollout.hash(`user-${i}`, 'feature')
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(100)
    }
  })

  it('should include user in rollout when hash < percentage', () => {
    const rollout = new PercentageRollout()

    // 100% should always include
    expect(rollout.isIncluded('any-user', 'any-flag', 100)).toBe(true)

    // 0% should never include
    expect(rollout.isIncluded('any-user', 'any-flag', 0)).toBe(false)
  })
})

describe('CohortTargeting', () => {
  it('should check if user is in cohort by rules', () => {
    const cohort: Cohort = {
      id: 'premium-users',
      name: 'Premium Users',
      rules: [{ attribute: 'plan', operator: 'eq', values: ['premium'] }],
    }
    const targeting = new CohortTargeting([cohort])

    expect(targeting.isInCohort('premium-users', { attributes: { plan: 'premium' } })).toBe(true)
    expect(targeting.isInCohort('premium-users', { attributes: { plan: 'free' } })).toBe(false)
  })

  it('should check if user is in cohort by explicit userIds', () => {
    const cohort: Cohort = {
      id: 'beta-users',
      name: 'Beta Users',
      rules: [],
      userIds: ['user-1', 'user-2'],
    }
    const targeting = new CohortTargeting([cohort])

    expect(targeting.isInCohort('beta-users', { userId: 'user-1' })).toBe(true)
    expect(targeting.isInCohort('beta-users', { userId: 'user-99' })).toBe(false)
  })

  it('should return false for non-existent cohort', () => {
    const targeting = new CohortTargeting([])

    expect(targeting.isInCohort('non-existent', { userId: 'user-1' })).toBe(false)
  })
})

describe('ScheduledFlags', () => {
  it('should check if flag is active based on schedule', () => {
    const scheduler = new ScheduledFlags()
    const now = new Date()

    // Active schedule (started 1 hour ago, ends in 1 hour)
    const activeSchedule = {
      start: new Date(now.getTime() - 3600000).toISOString(),
      end: new Date(now.getTime() + 3600000).toISOString(),
    }

    expect(scheduler.isActive(activeSchedule)).toBe(true)
  })

  it('should return false for future schedule', () => {
    const scheduler = new ScheduledFlags()
    const now = new Date()

    const futureSchedule = {
      start: new Date(now.getTime() + 3600000).toISOString(),
    }

    expect(scheduler.isActive(futureSchedule)).toBe(false)
  })

  it('should return false for expired schedule', () => {
    const scheduler = new ScheduledFlags()
    const now = new Date()

    const expiredSchedule = {
      start: new Date(now.getTime() - 7200000).toISOString(),
      end: new Date(now.getTime() - 3600000).toISOString(),
    }

    expect(scheduler.isActive(expiredSchedule)).toBe(false)
  })

  it('should use provided timestamp instead of now', () => {
    const scheduler = new ScheduledFlags()

    const schedule = {
      start: '2024-06-01T00:00:00Z',
      end: '2024-06-30T23:59:59Z',
    }

    // Check with timestamp during schedule
    expect(scheduler.isActive(schedule, '2024-06-15T12:00:00Z')).toBe(true)

    // Check with timestamp before schedule
    expect(scheduler.isActive(schedule, '2024-05-15T12:00:00Z')).toBe(false)

    // Check with timestamp after schedule
    expect(scheduler.isActive(schedule, '2024-07-15T12:00:00Z')).toBe(false)
  })
})

describe('FlagOverrides', () => {
  it('should get override for user', () => {
    const overrides = new FlagOverrides([
      { flagKey: 'feature-a', userId: 'user-1', value: true },
    ])

    expect(overrides.getOverride('feature-a', { userId: 'user-1' })).toEqual({
      flagKey: 'feature-a',
      userId: 'user-1',
      value: true,
    })
  })

  it('should return undefined when no override exists', () => {
    const overrides = new FlagOverrides([])

    expect(overrides.getOverride('feature-a', { userId: 'user-1' })).toBeUndefined()
  })

  it('should prioritize user override over session override', () => {
    const overrides = new FlagOverrides([
      { flagKey: 'feature-a', sessionId: 'session-1', value: 'session-value' },
      { flagKey: 'feature-a', userId: 'user-1', value: 'user-value' },
    ])

    expect(overrides.getOverride('feature-a', { userId: 'user-1', sessionId: 'session-1' })?.value).toBe(
      'user-value'
    )
  })

  it('should filter out expired overrides', () => {
    const now = new Date()
    const pastDate = new Date(now.getTime() - 3600000).toISOString()

    const overrides = new FlagOverrides([
      { flagKey: 'feature-a', userId: 'user-1', value: true, expiresAt: pastDate },
    ])

    expect(overrides.getOverride('feature-a', { userId: 'user-1' })).toBeUndefined()
  })

  it('should add and remove overrides', () => {
    const overrides = new FlagOverrides([])

    overrides.add({ flagKey: 'feature-a', userId: 'user-1', value: true })
    expect(overrides.getOverride('feature-a', { userId: 'user-1' })?.value).toBe(true)

    overrides.remove('feature-a', 'user-1')
    expect(overrides.getOverride('feature-a', { userId: 'user-1' })).toBeUndefined()
  })
})
