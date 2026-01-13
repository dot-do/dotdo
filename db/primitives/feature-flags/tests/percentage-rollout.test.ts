/**
 * Percentage Rollout Tests for Feature Flags
 *
 * RED phase - these tests define the expected behavior for percentage-based
 * feature flag rollouts. They should fail initially until the implementation
 * meets the requirements.
 *
 * Test cases:
 * 1. 0% rollout - all users get control
 * 2. 100% rollout - all users get treatment
 * 3. 50% rollout - roughly half get treatment
 * 4. Consistent bucketing - same user always same result
 * 5. Different flags - same user different buckets
 * 6. Gradual rollout - 10% -> 25% -> 50% -> 100%
 * 7. Rollback - 50% -> 25% keeps users who were in 25%
 * 8. Statistical distribution - 10% +/- reasonable variance
 * 9. Salt changes - rebucketing on salt rotation
 * 10. User ID types - string, number, UUID
 * 11. Edge cases - empty userId, null, undefined
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  FeatureFlagClient,
  PercentageRollout,
  createFeatureFlagClient,
} from '../../../../primitives/feature-flags'
import type { FeatureFlag, RolloutConfig } from '../../../../primitives/feature-flags/types'

describe('Percentage Rollout', () => {
  describe('1. 0% rollout - all users get control', () => {
    it('should return false for all users when rollout is 0%', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'zero-percent-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 0 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Test 100 different users - none should be enabled
      for (let i = 0; i < 100; i++) {
        expect(client.isEnabled('zero-percent-feature', { userId: `user-${i}` })).toBe(false)
      }
    })

    it('should return false even for users with high hash values at 0%', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'zero-test',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 0 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Use known user IDs that might have high hash values
      const testUsers = [
        'user-zzzzz',
        'admin-root',
        'test-maximum',
        'high-hash-user',
        '99999999',
      ]

      for (const userId of testUsers) {
        expect(client.isEnabled('zero-test', { userId })).toBe(false)
      }
    })
  })

  describe('2. 100% rollout - all users get treatment', () => {
    it('should return true for all users when rollout is 100%', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'full-rollout-feature',
          enabled: true,
          defaultValue: true,
          rollout: { percentage: 100 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Test 100 different users - all should be enabled
      for (let i = 0; i < 100; i++) {
        expect(client.isEnabled('full-rollout-feature', { userId: `user-${i}` })).toBe(true)
      }
    })

    it('should return true even for users with low hash values at 100%', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'hundred-test',
          enabled: true,
          defaultValue: true,
          rollout: { percentage: 100 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const testUsers = ['user-aaaaa', 'first-user', 'test-minimum', 'low-hash-user', '00000000']

      for (const userId of testUsers) {
        expect(client.isEnabled('hundred-test', { userId })).toBe(true)
      }
    })
  })

  describe('3. 50% rollout - roughly half get treatment', () => {
    it('should enable approximately 50% of users', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'half-rollout',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      let enabledCount = 0
      const totalUsers = 1000

      for (let i = 0; i < totalUsers; i++) {
        if (client.isEnabled('half-rollout', { userId: `user-${i}` })) {
          enabledCount++
        }
      }

      // Allow 10% variance (40-60% range)
      expect(enabledCount).toBeGreaterThan(400)
      expect(enabledCount).toBeLessThan(600)
    })

    it('should have a mix of enabled and disabled users', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'fifty-percent',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const results = new Set<boolean>()

      for (let i = 0; i < 100; i++) {
        results.add(client.isEnabled('fifty-percent', { userId: `user-${i}` }))
        if (results.size === 2) break
      }

      // Should have both true and false results
      expect(results.size).toBe(2)
    })
  })

  describe('4. Consistent bucketing - same user always same result', () => {
    it('should return consistent result for same userId across multiple evaluations', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'consistent-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const userId = 'consistent-test-user-12345'

      // Evaluate 100 times - should always be the same
      const firstResult = client.isEnabled('consistent-feature', { userId })

      for (let i = 0; i < 100; i++) {
        expect(client.isEnabled('consistent-feature', { userId })).toBe(firstResult)
      }
    })

    it('should maintain consistency across client instances', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'cross-instance-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]

      const client1 = new FeatureFlagClient({ flags })
      const client2 = new FeatureFlagClient({ flags })
      const client3 = new FeatureFlagClient({ flags })

      const userId = 'multi-instance-user'

      const result1 = client1.isEnabled('cross-instance-feature', { userId })
      const result2 = client2.isEnabled('cross-instance-feature', { userId })
      const result3 = client3.isEnabled('cross-instance-feature', { userId })

      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })

    it('should maintain consistency with different session IDs for same user', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'session-independent',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const userId = 'session-test-user'
      const sessions = ['session-1', 'session-2', 'session-abc', 'different-session']

      const results = sessions.map((sessionId) =>
        client.isEnabled('session-independent', { userId, sessionId })
      )

      // All results should be the same since we're bucketing by userId
      expect(new Set(results).size).toBe(1)
    })
  })

  describe('5. Different flags - same user different buckets', () => {
    it('should bucket users independently for different flag keys', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'feature-alpha',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
        {
          key: 'feature-beta',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // With enough users, some should be in different buckets for different flags
      let differentCount = 0
      const totalUsers = 1000

      for (let i = 0; i < totalUsers; i++) {
        const userId = `user-${i}`
        const alphaResult = client.isEnabled('feature-alpha', { userId })
        const betaResult = client.isEnabled('feature-beta', { userId })

        if (alphaResult !== betaResult) {
          differentCount++
        }
      }

      // At 50%/50%, roughly 50% should be in different states
      // (25% in alpha only, 25% in beta only)
      expect(differentCount).toBeGreaterThan(300)
      expect(differentCount).toBeLessThan(700)
    })

    it('should use flag key as part of hash to ensure independence', () => {
      const rollout = new PercentageRollout()

      const userId = 'test-user-independence'

      const hashAlpha = rollout.hash(userId, 'feature-alpha')
      const hashBeta = rollout.hash(userId, 'feature-beta')

      // Same user should get different hash values for different flags
      expect(hashAlpha).not.toBe(hashBeta)
    })
  })

  describe('6. Gradual rollout - 10% -> 25% -> 50% -> 100%', () => {
    it('should monotonically increase included users as percentage increases', () => {
      const getUsersIncludedAt = (percentage: number): Set<string> => {
        const flags: FeatureFlag[] = [
          {
            key: 'gradual-feature',
            enabled: true,
            defaultValue: false,
            rollout: { percentage },
          },
        ]
        const client = new FeatureFlagClient({ flags })

        const included = new Set<string>()
        for (let i = 0; i < 1000; i++) {
          const userId = `user-${i}`
          if (client.isEnabled('gradual-feature', { userId })) {
            included.add(userId)
          }
        }
        return included
      }

      const usersAt10 = getUsersIncludedAt(10)
      const usersAt25 = getUsersIncludedAt(25)
      const usersAt50 = getUsersIncludedAt(50)
      const usersAt100 = getUsersIncludedAt(100)

      // Users at lower percentages should be subsets of higher percentages
      expect(usersAt10.size).toBeLessThanOrEqual(usersAt25.size)
      expect(usersAt25.size).toBeLessThanOrEqual(usersAt50.size)
      expect(usersAt50.size).toBeLessThanOrEqual(usersAt100.size)

      // All users at 10% should also be at 25%, 50%, and 100%
      for (const userId of usersAt10) {
        expect(usersAt25.has(userId)).toBe(true)
        expect(usersAt50.has(userId)).toBe(true)
        expect(usersAt100.has(userId)).toBe(true)
      }

      // All users at 25% should also be at 50% and 100%
      for (const userId of usersAt25) {
        expect(usersAt50.has(userId)).toBe(true)
        expect(usersAt100.has(userId)).toBe(true)
      }

      // All users at 50% should also be at 100%
      for (const userId of usersAt50) {
        expect(usersAt100.has(userId)).toBe(true)
      }
    })

    it('should add roughly 15% more users when going from 10% to 25%', () => {
      const flags10: FeatureFlag[] = [
        {
          key: 'gradual-test',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 10 },
        },
      ]
      const flags25: FeatureFlag[] = [
        {
          key: 'gradual-test',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 25 },
        },
      ]

      const client10 = new FeatureFlagClient({ flags: flags10 })
      const client25 = new FeatureFlagClient({ flags: flags25 })

      let count10 = 0
      let count25 = 0

      for (let i = 0; i < 1000; i++) {
        const userId = `user-${i}`
        if (client10.isEnabled('gradual-test', { userId })) count10++
        if (client25.isEnabled('gradual-test', { userId })) count25++
      }

      const difference = count25 - count10

      // Should add approximately 150 users (15% of 1000)
      expect(difference).toBeGreaterThan(100)
      expect(difference).toBeLessThan(200)
    })
  })

  describe('7. Rollback - 50% -> 25% keeps users who were in 25%', () => {
    it('should keep all users who were in 25% when rolling back from 50% to 25%', () => {
      const getUsersIncludedAt = (percentage: number): Set<string> => {
        const flags: FeatureFlag[] = [
          {
            key: 'rollback-feature',
            enabled: true,
            defaultValue: false,
            rollout: { percentage },
          },
        ]
        const client = new FeatureFlagClient({ flags })

        const included = new Set<string>()
        for (let i = 0; i < 1000; i++) {
          const userId = `user-${i}`
          if (client.isEnabled('rollback-feature', { userId })) {
            included.add(userId)
          }
        }
        return included
      }

      const usersAt50 = getUsersIncludedAt(50)
      const usersAt25 = getUsersIncludedAt(25)

      // After rollback, users at 25% should be exactly a subset of users at 50%
      for (const userId of usersAt25) {
        expect(usersAt50.has(userId)).toBe(true)
      }

      // usersAt25 should be strictly smaller than usersAt50
      expect(usersAt25.size).toBeLessThan(usersAt50.size)
    })

    it('should lose approximately 25% of users when rolling back from 50% to 25%', () => {
      const flags50: FeatureFlag[] = [
        {
          key: 'rollback-test',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const flags25: FeatureFlag[] = [
        {
          key: 'rollback-test',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 25 },
        },
      ]

      const client50 = new FeatureFlagClient({ flags: flags50 })
      const client25 = new FeatureFlagClient({ flags: flags25 })

      let retainedCount = 0
      let lostCount = 0

      for (let i = 0; i < 1000; i++) {
        const userId = `user-${i}`
        const wasIn50 = client50.isEnabled('rollback-test', { userId })
        const isIn25 = client25.isEnabled('rollback-test', { userId })

        if (wasIn50 && isIn25) retainedCount++
        if (wasIn50 && !isIn25) lostCount++
      }

      // Should retain approximately 250 users (25% of 1000) who are in both
      expect(retainedCount).toBeGreaterThan(200)
      expect(retainedCount).toBeLessThan(300)

      // Should lose approximately 250 users (50% - 25% = 25% of 1000)
      expect(lostCount).toBeGreaterThan(200)
      expect(lostCount).toBeLessThan(300)
    })
  })

  describe('8. Statistical distribution - 10% +/- reasonable variance', () => {
    it('should have 10% rollout within 3% variance (7-13%)', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'ten-percent-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 10 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      let enabledCount = 0
      const totalUsers = 10000

      for (let i = 0; i < totalUsers; i++) {
        if (client.isEnabled('ten-percent-feature', { userId: `user-${i}` })) {
          enabledCount++
        }
      }

      const actualPercentage = (enabledCount / totalUsers) * 100

      // Allow 3% variance for 10% rollout
      expect(actualPercentage).toBeGreaterThan(7)
      expect(actualPercentage).toBeLessThan(13)
    })

    it('should have even distribution across multiple batches', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'distribution-test',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 20 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const batchCounts: number[] = []

      // Run 10 batches of 1000 users each
      for (let batch = 0; batch < 10; batch++) {
        let batchEnabled = 0
        for (let i = 0; i < 1000; i++) {
          const userId = `batch-${batch}-user-${i}`
          if (client.isEnabled('distribution-test', { userId })) {
            batchEnabled++
          }
        }
        batchCounts.push(batchEnabled)
      }

      // Each batch should be within 15-25% (20% +/- 5%)
      for (const count of batchCounts) {
        expect(count).toBeGreaterThan(150)
        expect(count).toBeLessThan(250)
      }

      // Standard deviation should be reasonable
      const mean = batchCounts.reduce((a, b) => a + b, 0) / batchCounts.length
      const variance =
        batchCounts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / batchCounts.length
      const stdDev = Math.sqrt(variance)

      // Standard deviation should be less than 5% of total users per batch
      expect(stdDev).toBeLessThan(50)
    })

    it('should produce uniform hash distribution', () => {
      const rollout = new PercentageRollout()
      const buckets = new Array(10).fill(0)

      // Hash 10000 users and count distribution across 10 buckets
      for (let i = 0; i < 10000; i++) {
        const hash = rollout.hash(`user-${i}`, 'distribution-flag')
        const bucket = Math.floor(hash / 10)
        buckets[bucket]++
      }

      // Each bucket should have approximately 1000 users (10% of 10000)
      for (const bucketCount of buckets) {
        expect(bucketCount).toBeGreaterThan(800) // Allow 20% variance
        expect(bucketCount).toBeLessThan(1200)
      }
    })
  })

  describe('9. Salt changes - rebucketing on salt rotation', () => {
    it('should allow rebucketing when salt/seed changes', () => {
      // This test requires salt support in RolloutConfig
      // The implementation should support a 'salt' parameter that changes bucketing
      const flagsWithSalt1: FeatureFlag[] = [
        {
          key: 'salted-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50, salt: 'salt-v1' } as RolloutConfig & { salt: string },
        },
      ]
      const flagsWithSalt2: FeatureFlag[] = [
        {
          key: 'salted-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50, salt: 'salt-v2' } as RolloutConfig & { salt: string },
        },
      ]

      const client1 = new FeatureFlagClient({ flags: flagsWithSalt1 })
      const client2 = new FeatureFlagClient({ flags: flagsWithSalt2 })

      // Collect users who get different results with different salts
      let changedCount = 0
      for (let i = 0; i < 1000; i++) {
        const userId = `user-${i}`
        const result1 = client1.isEnabled('salted-feature', { userId })
        const result2 = client2.isEnabled('salted-feature', { userId })
        if (result1 !== result2) changedCount++
      }

      // With salt change, approximately 50% of users should get different results
      // (Half of each group switches)
      expect(changedCount).toBeGreaterThan(300)
      expect(changedCount).toBeLessThan(700)
    })

    it('should maintain consistency when salt stays the same', () => {
      const createClientWithSalt = (salt: string) => {
        const flags: FeatureFlag[] = [
          {
            key: 'consistent-salt-feature',
            enabled: true,
            defaultValue: false,
            rollout: { percentage: 50, salt } as RolloutConfig & { salt: string },
          },
        ]
        return new FeatureFlagClient({ flags })
      }

      const client1 = createClientWithSalt('same-salt')
      const client2 = createClientWithSalt('same-salt')

      for (let i = 0; i < 100; i++) {
        const userId = `user-${i}`
        expect(client1.isEnabled('consistent-salt-feature', { userId })).toBe(
          client2.isEnabled('consistent-salt-feature', { userId })
        )
      }
    })
  })

  describe('10. User ID types - string, number, UUID', () => {
    it('should handle string user IDs', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'string-id-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const stringIds = [
        'user-123',
        'john.doe@example.com',
        'UPPERCASE-USER',
        'mixed-Case-123',
        'user_with_underscore',
        'user-with-dashes',
        'simple',
      ]

      for (const userId of stringIds) {
        const result = client.isEnabled('string-id-feature', { userId })
        expect(typeof result).toBe('boolean')
      }
    })

    it('should handle numeric user IDs as strings', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'numeric-id-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const numericIds = ['123', '999999', '0', '1', '9007199254740991'] // Max safe integer

      for (const userId of numericIds) {
        const result = client.isEnabled('numeric-id-feature', { userId })
        expect(typeof result).toBe('boolean')
      }
    })

    it('should handle UUID user IDs', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'uuid-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const uuids = [
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        '550e8400-e29b-41d4-a716-446655440000',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      ]

      for (const userId of uuids) {
        const result = client.isEnabled('uuid-feature', { userId })
        expect(typeof result).toBe('boolean')
      }
    })

    it('should produce consistent results for UUID format user IDs', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'uuid-consistency',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      const firstResult = client.isEnabled('uuid-consistency', { userId: uuid })

      for (let i = 0; i < 10; i++) {
        expect(client.isEnabled('uuid-consistency', { userId: uuid })).toBe(firstResult)
      }
    })

    it('should differentiate between similar but different IDs', () => {
      const rollout = new PercentageRollout()

      // These IDs are similar but should produce different hashes
      const hash1 = rollout.hash('user-123', 'feature')
      const hash2 = rollout.hash('user-124', 'feature')
      const hash3 = rollout.hash('user-12', 'feature')
      const hash4 = rollout.hash('user-1234', 'feature')

      const hashes = [hash1, hash2, hash3, hash4]
      const uniqueHashes = new Set(hashes)

      // All should be different
      expect(uniqueHashes.size).toBe(4)
    })
  })

  describe('11. Edge cases - empty userId, null, undefined', () => {
    it('should handle empty string userId', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'empty-id-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Should not throw and should return a deterministic result
      const result = client.isEnabled('empty-id-feature', { userId: '' })
      expect(typeof result).toBe('boolean')

      // Should be consistent
      expect(client.isEnabled('empty-id-feature', { userId: '' })).toBe(result)
    })

    it('should handle undefined userId gracefully', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'undefined-id-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Should not throw
      expect(() => {
        client.isEnabled('undefined-id-feature', { userId: undefined })
      }).not.toThrow()

      const result = client.isEnabled('undefined-id-feature', { userId: undefined })
      expect(typeof result).toBe('boolean')
    })

    it('should handle null userId by falling back to sessionId or anonymous', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'null-id-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // With sessionId as fallback
      const resultWithSession = client.isEnabled('null-id-feature', {
        userId: undefined,
        sessionId: 'session-123',
      })
      expect(typeof resultWithSession).toBe('boolean')

      // Same session should get same result
      expect(
        client.isEnabled('null-id-feature', { userId: undefined, sessionId: 'session-123' })
      ).toBe(resultWithSession)
    })

    it('should handle context with no userId or sessionId (anonymous)', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'anonymous-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Should use 'anonymous' bucket key
      const result = client.isEnabled('anonymous-feature', {})
      expect(typeof result).toBe('boolean')

      // All anonymous users should get the same result
      expect(client.isEnabled('anonymous-feature', {})).toBe(result)
      expect(client.isEnabled('anonymous-feature')).toBe(result)
    })

    it('should handle special characters in userId', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'special-char-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const specialUserIds = [
        'user:123',
        'user/path',
        'user\\backslash',
        'user with spaces',
        "user'quote",
        'user"doublequote',
        'user\ttab',
        'user\nnewline',
        'emoji-user-\u{1F600}',
        '\u0000nullchar', // null character
        'unicode-\u4E2D\u6587', // Chinese characters
      ]

      for (const userId of specialUserIds) {
        expect(() => {
          client.isEnabled('special-char-feature', { userId })
        }).not.toThrow()
      }
    })

    it('should handle very long userId', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'long-id-feature',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const longUserId = 'user-' + 'a'.repeat(10000)

      const result = client.isEnabled('long-id-feature', { userId: longUserId })
      expect(typeof result).toBe('boolean')

      // Should be consistent
      expect(client.isEnabled('long-id-feature', { userId: longUserId })).toBe(result)
    })
  })

  describe('Additional percentage rollout edge cases', () => {
    it('should handle percentage values at boundaries', () => {
      const testPercentage = (pct: number) => {
        const flags: FeatureFlag[] = [
          {
            key: `boundary-${pct}`,
            enabled: true,
            defaultValue: false,
            rollout: { percentage: pct },
          },
        ]
        const client = new FeatureFlagClient({ flags })
        return client.isEnabled(`boundary-${pct}`, { userId: 'test-user' })
      }

      // Should handle exact boundaries without errors
      expect(typeof testPercentage(0)).toBe('boolean')
      expect(typeof testPercentage(1)).toBe('boolean')
      expect(typeof testPercentage(50)).toBe('boolean')
      expect(typeof testPercentage(99)).toBe('boolean')
      expect(typeof testPercentage(100)).toBe('boolean')
    })

    it('should handle decimal percentage values', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'decimal-percentage',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 33.33 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      let enabledCount = 0
      for (let i = 0; i < 3000; i++) {
        if (client.isEnabled('decimal-percentage', { userId: `user-${i}` })) {
          enabledCount++
        }
      }

      // Should be approximately 33.33%
      const actualPercentage = (enabledCount / 3000) * 100
      expect(actualPercentage).toBeGreaterThan(28)
      expect(actualPercentage).toBeLessThan(38)
    })

    it('should handle percentage > 100 as 100%', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'over-hundred',
          enabled: true,
          defaultValue: true,
          rollout: { percentage: 150 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Should treat as 100%
      for (let i = 0; i < 100; i++) {
        expect(client.isEnabled('over-hundred', { userId: `user-${i}` })).toBe(true)
      }
    })

    it('should handle negative percentage as 0%', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'negative-percent',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: -10 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      // Should treat as 0%
      for (let i = 0; i < 100; i++) {
        expect(client.isEnabled('negative-percent', { userId: `user-${i}` })).toBe(false)
      }
    })

    it('should correctly report PERCENTAGE_ROLLOUT as the reason', () => {
      const flags: FeatureFlag[] = [
        {
          key: 'reason-test',
          enabled: true,
          defaultValue: false,
          rollout: { percentage: 50 },
        },
      ]
      const client = new FeatureFlagClient({ flags })

      const result = client.evaluate('reason-test', { userId: 'test-user' })

      expect(result.reason).toBe('PERCENTAGE_ROLLOUT')
      expect(result.flagFound).toBe(true)
    })
  })
})
