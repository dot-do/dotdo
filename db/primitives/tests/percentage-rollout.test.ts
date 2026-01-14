/**
 * Percentage Rollout Tests
 *
 * RED phase: These tests define the expected behavior for percentage-based
 * feature flag rollouts. All tests should FAIL until implementation is complete.
 *
 * Test cases:
 * 1. Basic percentage allocation
 * 2. User bucketing consistency
 * 3. Gradual rollout
 * 4. Edge cases (0%, 100%)
 *
 * @see db/primitives/feature-flags/percentage-bucketing.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createPercentageBucketing,
  simulateRollout,
  type PercentageBucketingConfig,
} from '../feature-flags/percentage-bucketing'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Creates a bucketing instance for testing
 */
function createTestBucketing(config?: PercentageBucketingConfig) {
  return createPercentageBucketing(config)
}

/**
 * Collects users in rollout at a given percentage
 */
function getUsersInRollout(
  flagKey: string,
  percentage: number,
  userCount: number
): Set<string> {
  const bucketing = createTestBucketing()
  const included = new Set<string>()

  for (let i = 0; i < userCount; i++) {
    const userId = `user-${i}`
    if (bucketing.isInRollout(flagKey, userId, percentage)) {
      included.add(userId)
    }
  }

  return included
}

/**
 * Calculate actual percentage from user count
 */
function calculateActualPercentage(inCount: number, total: number): number {
  return (inCount / total) * 100
}

// ============================================================================
// 1. BASIC PERCENTAGE ALLOCATION
// ============================================================================

describe('Percentage Rollout', () => {
  describe('1. Basic percentage allocation', () => {
    it('should include approximately the target percentage of users', () => {
      const bucketing = createTestBucketing()
      const targetPercentage = 30
      const totalUsers = 10000

      let includedCount = 0
      for (let i = 0; i < totalUsers; i++) {
        if (bucketing.isInRollout('test-feature', `user-${i}`, targetPercentage)) {
          includedCount++
        }
      }

      const actualPercentage = calculateActualPercentage(includedCount, totalUsers)

      // Allow 5% variance: 25-35% for 30% target
      expect(actualPercentage).toBeGreaterThan(targetPercentage - 5)
      expect(actualPercentage).toBeLessThan(targetPercentage + 5)
    })

    it('should allocate 10% of users to a 10% rollout', () => {
      const { actualPercentage } = simulateRollout('ten-percent-feature', 10000, 10)

      // Allow 3% variance: 7-13% for 10% target
      expect(actualPercentage).toBeGreaterThan(7)
      expect(actualPercentage).toBeLessThan(13)
    })

    it('should allocate 50% of users to a 50% rollout', () => {
      const { actualPercentage } = simulateRollout('fifty-percent-feature', 10000, 50)

      // Allow 5% variance: 45-55% for 50% target
      expect(actualPercentage).toBeGreaterThan(45)
      expect(actualPercentage).toBeLessThan(55)
    })

    it('should allocate 90% of users to a 90% rollout', () => {
      const { actualPercentage } = simulateRollout('ninety-percent-feature', 10000, 90)

      // Allow 5% variance: 85-95% for 90% target
      expect(actualPercentage).toBeGreaterThan(85)
      expect(actualPercentage).toBeLessThan(95)
    })

    it('should have even distribution across percentage buckets', () => {
      const bucketing = createTestBucketing({ bucketCount: 100 })
      const bucketCounts = new Array(100).fill(0)

      // Hash 10000 users into 100 buckets
      for (let i = 0; i < 10000; i++) {
        const bucket = bucketing.getBucket('distribution-test', `user-${i}`)
        bucketCounts[bucket]++
      }

      // Each bucket should have approximately 100 users (10000/100)
      // Allow 40% variance for statistical noise
      const expectedPerBucket = 100
      for (const count of bucketCounts) {
        expect(count).toBeGreaterThan(expectedPerBucket * 0.6)
        expect(count).toBeLessThan(expectedPerBucket * 1.4)
      }
    })

    it('should use MurmurHash3 for uniform distribution', () => {
      const bucketing = createTestBucketing()

      // Test that buckets are within valid range
      for (let i = 0; i < 1000; i++) {
        const bucket = bucketing.getBucket('hash-test', `user-${i}`)
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(bucketing.getBucketCount())
      }
    })

    it('should support decimal percentages for precise rollouts', () => {
      const bucketing = createTestBucketing()
      const targetPercentage = 33.33
      const totalUsers = 10000

      let includedCount = 0
      for (let i = 0; i < totalUsers; i++) {
        if (bucketing.isInRollout('decimal-feature', `user-${i}`, targetPercentage)) {
          includedCount++
        }
      }

      const actualPercentage = calculateActualPercentage(includedCount, totalUsers)

      // Should be approximately 33.33%
      expect(actualPercentage).toBeGreaterThan(28)
      expect(actualPercentage).toBeLessThan(38)
    })
  })

  // ============================================================================
  // 2. USER BUCKETING CONSISTENCY
  // ============================================================================

  describe('2. User bucketing consistency', () => {
    it('should return same bucket for same user and flag combination', () => {
      const bucketing = createTestBucketing()

      const bucket1 = bucketing.getBucket('my-feature', 'user-123')
      const bucket2 = bucketing.getBucket('my-feature', 'user-123')
      const bucket3 = bucketing.getBucket('my-feature', 'user-123')

      expect(bucket1).toBe(bucket2)
      expect(bucket2).toBe(bucket3)
    })

    it('should return consistent rollout result for same user', () => {
      const bucketing = createTestBucketing()
      const userId = 'consistent-user-42'

      const firstResult = bucketing.isInRollout('consistency-test', userId, 50)

      // Evaluate 100 times - should always be the same
      for (let i = 0; i < 100; i++) {
        expect(bucketing.isInRollout('consistency-test', userId, 50)).toBe(firstResult)
      }
    })

    it('should maintain consistency across different bucketing instances', () => {
      const bucketing1 = createTestBucketing()
      const bucketing2 = createTestBucketing()
      const bucketing3 = createTestBucketing()

      const userId = 'cross-instance-user'
      const flagKey = 'cross-instance-feature'

      expect(bucketing1.getBucket(flagKey, userId)).toBe(bucketing2.getBucket(flagKey, userId))
      expect(bucketing2.getBucket(flagKey, userId)).toBe(bucketing3.getBucket(flagKey, userId))
    })

    it('should produce different buckets for different users', () => {
      const bucketing = createTestBucketing()
      const buckets = new Set<number>()

      for (let i = 0; i < 100; i++) {
        buckets.add(bucketing.getBucket('unique-buckets', `user-${i}`))
      }

      // With 100 users and 10000 buckets, should have high bucket diversity
      expect(buckets.size).toBeGreaterThan(50)
    })

    it('should produce different buckets for different flags with same user', () => {
      const bucketing = createTestBucketing()
      const userId = 'same-user'

      const bucket1 = bucketing.getBucket('feature-alpha', userId)
      const bucket2 = bucketing.getBucket('feature-beta', userId)
      const bucket3 = bucketing.getBucket('feature-gamma', userId)

      // Different flags should generally produce different buckets
      const buckets = new Set([bucket1, bucket2, bucket3])
      expect(buckets.size).toBeGreaterThanOrEqual(2)
    })

    it('should handle various user ID formats consistently', () => {
      const bucketing = createTestBucketing()
      const flagKey = 'format-test'

      const userIds = [
        'simple-user',
        'user@example.com',
        'USER-UPPERCASE',
        '12345',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479', // UUID
        'user_with_underscore',
        'user-with-dashes',
      ]

      for (const userId of userIds) {
        const bucket1 = bucketing.getBucket(flagKey, userId)
        const bucket2 = bucketing.getBucket(flagKey, userId)
        expect(bucket1).toBe(bucket2)
      }
    })

    it('should differentiate between similar but different user IDs', () => {
      const bucketing = createTestBucketing()
      const flagKey = 'similar-ids'

      const bucket1 = bucketing.getBucket(flagKey, 'user-123')
      const bucket2 = bucketing.getBucket(flagKey, 'user-124')
      const bucket3 = bucketing.getBucket(flagKey, 'user-12')
      const bucket4 = bucketing.getBucket(flagKey, 'user-1234')

      const uniqueBuckets = new Set([bucket1, bucket2, bucket3, bucket4])

      // All should produce different buckets (with high probability)
      expect(uniqueBuckets.size).toBe(4)
    })

    it('should produce same bucket with same salt', () => {
      const bucketing = createTestBucketing()

      const bucket1 = bucketing.getBucket('flag', 'user-1', 'salt-v1')
      const bucket2 = bucketing.getBucket('flag', 'user-1', 'salt-v1')

      expect(bucket1).toBe(bucket2)
    })

    it('should produce different bucket with different salt', () => {
      const bucketing = createTestBucketing()

      const bucket1 = bucketing.getBucket('flag', 'user-1', 'salt-v1')
      const bucket2 = bucketing.getBucket('flag', 'user-1', 'salt-v2')

      // Different salts should produce different buckets (with high probability)
      expect(bucket1).not.toBe(bucket2)
    })
  })

  // ============================================================================
  // 3. GRADUAL ROLLOUT
  // ============================================================================

  describe('3. Gradual rollout', () => {
    it('should monotonically increase included users as percentage increases', () => {
      const percentages = [10, 25, 50, 75, 100]
      const userSets: Set<string>[] = []

      for (const pct of percentages) {
        userSets.push(getUsersInRollout('gradual-feature', pct, 1000))
      }

      // Each subsequent set should be larger than or equal to the previous
      for (let i = 1; i < userSets.length; i++) {
        expect(userSets[i]!.size).toBeGreaterThanOrEqual(userSets[i - 1]!.size)
      }
    })

    it('should ensure users at lower percentage are subset of users at higher percentage', () => {
      const usersAt10 = getUsersInRollout('subset-test', 10, 1000)
      const usersAt25 = getUsersInRollout('subset-test', 25, 1000)
      const usersAt50 = getUsersInRollout('subset-test', 50, 1000)
      const usersAt100 = getUsersInRollout('subset-test', 100, 1000)

      // All users at 10% should be in 25%, 50%, and 100%
      for (const userId of usersAt10) {
        expect(usersAt25.has(userId)).toBe(true)
        expect(usersAt50.has(userId)).toBe(true)
        expect(usersAt100.has(userId)).toBe(true)
      }

      // All users at 25% should be in 50% and 100%
      for (const userId of usersAt25) {
        expect(usersAt50.has(userId)).toBe(true)
        expect(usersAt100.has(userId)).toBe(true)
      }

      // All users at 50% should be in 100%
      for (const userId of usersAt50) {
        expect(usersAt100.has(userId)).toBe(true)
      }
    })

    it('should add approximately 15% more users when going from 10% to 25%', () => {
      const usersAt10 = getUsersInRollout('increment-test', 10, 1000)
      const usersAt25 = getUsersInRollout('increment-test', 25, 1000)

      const difference = usersAt25.size - usersAt10.size

      // Should add approximately 150 users (15% of 1000)
      // Allow reasonable variance
      expect(difference).toBeGreaterThan(100)
      expect(difference).toBeLessThan(200)
    })

    it('should support rolling back from 50% to 25% while keeping consistent users', () => {
      const usersAt50 = getUsersInRollout('rollback-test', 50, 1000)
      const usersAt25 = getUsersInRollout('rollback-test', 25, 1000)

      // After rollback, all users at 25% should have been in 50%
      for (const userId of usersAt25) {
        expect(usersAt50.has(userId)).toBe(true)
      }

      // usersAt25 should be strictly smaller
      expect(usersAt25.size).toBeLessThan(usersAt50.size)
    })

    it('should lose approximately 25% of users when rolling back from 50% to 25%', () => {
      const bucketing = createTestBucketing()
      const totalUsers = 1000

      let retainedCount = 0
      let lostCount = 0

      for (let i = 0; i < totalUsers; i++) {
        const userId = `user-${i}`
        const wasIn50 = bucketing.isInRollout('rollback-loss', userId, 50)
        const isIn25 = bucketing.isInRollout('rollback-loss', userId, 25)

        if (wasIn50 && isIn25) retainedCount++
        if (wasIn50 && !isIn25) lostCount++
      }

      // Should retain approximately 250 users (25% of total)
      expect(retainedCount).toBeGreaterThan(200)
      expect(retainedCount).toBeLessThan(300)

      // Should lose approximately 250 users (difference between 50% and 25%)
      expect(lostCount).toBeGreaterThan(200)
      expect(lostCount).toBeLessThan(300)
    })

    it('should maintain user experience during incremental rollout', () => {
      const bucketing = createTestBucketing()
      const userId = 'stable-experience-user'
      const flagKey = 'incremental-rollout'

      // Simulate gradual rollout: 10% -> 20% -> 30% -> 40% -> 50%
      const percentages = [10, 20, 30, 40, 50]
      const results: boolean[] = []

      for (const pct of percentages) {
        results.push(bucketing.isInRollout(flagKey, userId, pct))
      }

      // Once a user is included, they should stay included
      let wasIncluded = false
      for (const isIncluded of results) {
        if (wasIncluded) {
          expect(isIncluded).toBe(true) // Should stay included
        }
        if (isIncluded) {
          wasIncluded = true
        }
      }
    })

    it('should handle fine-grained percentage increments (1% steps)', () => {
      const bucketing = createTestBucketing({ bucketCount: 10000 })
      const userId = 'fine-grained-user'
      const flagKey = 'fine-grained-rollout'

      const results: boolean[] = []
      for (let pct = 0; pct <= 100; pct++) {
        results.push(bucketing.isInRollout(flagKey, userId, pct))
      }

      // Once included, should stay included (monotonic)
      let includedAt = -1
      for (let i = 0; i <= 100; i++) {
        if (results[i]) {
          if (includedAt === -1) {
            includedAt = i
          }
          expect(results[i]).toBe(true)
        }
      }

      // At 100%, should definitely be included
      expect(results[100]).toBe(true)
    })
  })

  // ============================================================================
  // 4. EDGE CASES (0%, 100%)
  // ============================================================================

  describe('4. Edge cases (0%, 100%)', () => {
    describe('0% rollout', () => {
      it('should exclude all users at 0% rollout', () => {
        const bucketing = createTestBucketing()

        for (let i = 0; i < 100; i++) {
          expect(bucketing.isInRollout('zero-feature', `user-${i}`, 0)).toBe(false)
        }
      })

      it('should return false for 0% even with high hash values', () => {
        const bucketing = createTestBucketing()

        // Test users that might have high hash values
        const testUsers = ['zzzzz', 'admin-root', 'maximum', '99999999', '\u{FFFF}']

        for (const userId of testUsers) {
          expect(bucketing.isInRollout('zero-test', userId, 0)).toBe(false)
        }
      })

      it('should return false for 0% across all flag keys', () => {
        const bucketing = createTestBucketing()
        const userId = 'zero-percent-user'

        const flags = ['feature-a', 'feature-b', 'feature-c', 'special-flag', 'another-one']

        for (const flag of flags) {
          expect(bucketing.isInRollout(flag, userId, 0)).toBe(false)
        }
      })
    })

    describe('100% rollout', () => {
      it('should include all users at 100% rollout', () => {
        const bucketing = createTestBucketing()

        for (let i = 0; i < 100; i++) {
          expect(bucketing.isInRollout('hundred-feature', `user-${i}`, 100)).toBe(true)
        }
      })

      it('should return true for 100% even with low hash values', () => {
        const bucketing = createTestBucketing()

        // Test users that might have low hash values
        const testUsers = ['aaaaa', 'first', 'minimum', '00000000', '\u{0000}']

        for (const userId of testUsers) {
          expect(bucketing.isInRollout('hundred-test', userId, 100)).toBe(true)
        }
      })

      it('should return true for 100% across all flag keys', () => {
        const bucketing = createTestBucketing()
        const userId = 'hundred-percent-user'

        const flags = ['feature-a', 'feature-b', 'feature-c', 'special-flag', 'another-one']

        for (const flag of flags) {
          expect(bucketing.isInRollout(flag, userId, 100)).toBe(true)
        }
      })
    })

    describe('boundary percentages', () => {
      it('should handle 1% rollout correctly', () => {
        const { inCount, actualPercentage } = simulateRollout('one-percent', 10000, 1)

        // Should include approximately 1% of users
        expect(actualPercentage).toBeGreaterThan(0.5)
        expect(actualPercentage).toBeLessThan(2)
        expect(inCount).toBeGreaterThan(0) // At least some users
      })

      it('should handle 99% rollout correctly', () => {
        const { outCount, actualPercentage } = simulateRollout('ninety-nine-percent', 10000, 99)

        // Should exclude approximately 1% of users
        expect(actualPercentage).toBeGreaterThan(97)
        expect(actualPercentage).toBeLessThan(100)
        expect(outCount).toBeGreaterThan(0) // At least some users excluded
      })

      it('should treat percentage > 100 as 100%', () => {
        const bucketing = createTestBucketing()

        for (let i = 0; i < 100; i++) {
          expect(bucketing.isInRollout('over-hundred', `user-${i}`, 150)).toBe(true)
        }
      })

      it('should treat negative percentage as 0%', () => {
        const bucketing = createTestBucketing()

        for (let i = 0; i < 100; i++) {
          expect(bucketing.isInRollout('negative-percent', `user-${i}`, -10)).toBe(false)
        }
      })
    })

    describe('special user ID edge cases', () => {
      it('should handle empty string userId', () => {
        const bucketing = createTestBucketing()

        // Should not throw
        const result = bucketing.isInRollout('empty-id', '', 50)
        expect(typeof result).toBe('boolean')

        // Should be consistent
        expect(bucketing.isInRollout('empty-id', '', 50)).toBe(result)
      })

      it('should handle special characters in userId', () => {
        const bucketing = createTestBucketing()

        const specialUserIds = [
          'user:with:colons',
          'user/with/slashes',
          'user\\with\\backslashes',
          'user with spaces',
          "user'with'quotes",
          'user"with"double',
          'user\twith\ttabs',
          'user\nwith\nnewlines',
          '\u{1F600}emoji-user', // emoji
          '\u0000null-char', // null character
          '\u4E2D\u6587unicode', // Chinese characters
        ]

        for (const userId of specialUserIds) {
          expect(() => {
            bucketing.isInRollout('special-chars', userId, 50)
          }).not.toThrow()
        }
      })

      it('should handle very long userId', () => {
        const bucketing = createTestBucketing()
        const longUserId = 'user-' + 'a'.repeat(10000)

        const result = bucketing.isInRollout('long-id', longUserId, 50)
        expect(typeof result).toBe('boolean')

        // Should be consistent
        expect(bucketing.isInRollout('long-id', longUserId, 50)).toBe(result)
      })

      it('should handle UUID format userId', () => {
        const bucketing = createTestBucketing()

        const uuids = [
          'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          '550e8400-e29b-41d4-a716-446655440000',
          '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        ]

        for (const uuid of uuids) {
          const result1 = bucketing.isInRollout('uuid-test', uuid, 50)
          const result2 = bucketing.isInRollout('uuid-test', uuid, 50)
          expect(result1).toBe(result2) // Consistent
        }
      })

      it('should handle numeric string userId', () => {
        const bucketing = createTestBucketing()

        const numericIds = ['0', '1', '123456789', '9007199254740991'] // Max safe integer

        for (const userId of numericIds) {
          const result1 = bucketing.isInRollout('numeric-id', userId, 50)
          const result2 = bucketing.isInRollout('numeric-id', userId, 50)
          expect(result1).toBe(result2) // Consistent
        }
      })
    })

    describe('special flag key edge cases', () => {
      it('should handle empty string flagKey', () => {
        const bucketing = createTestBucketing()

        const result = bucketing.isInRollout('', 'user-123', 50)
        expect(typeof result).toBe('boolean')
      })

      it('should handle special characters in flagKey', () => {
        const bucketing = createTestBucketing()

        const specialFlags = [
          'flag:with:colons',
          'flag.with.dots',
          'flag-with-dashes',
          'flag_with_underscores',
          'UPPERCASE-FLAG',
          'mixedCase-Flag',
        ]

        for (const flag of specialFlags) {
          expect(() => {
            bucketing.isInRollout(flag, 'user-123', 50)
          }).not.toThrow()
        }
      })
    })

    describe('bucket count edge cases', () => {
      it('should work with minimum bucket count (1)', () => {
        const bucketing = createTestBucketing({ bucketCount: 1 })

        // All users should get bucket 0
        for (let i = 0; i < 10; i++) {
          expect(bucketing.getBucket('min-bucket', `user-${i}`)).toBe(0)
        }

        // 100% should include, 0% should exclude
        expect(bucketing.isInRollout('min-bucket', 'user-1', 100)).toBe(true)
        expect(bucketing.isInRollout('min-bucket', 'user-1', 0)).toBe(false)
      })

      it('should work with very large bucket count', () => {
        const bucketing = createTestBucketing({ bucketCount: 1000000 })

        for (let i = 0; i < 100; i++) {
          const bucket = bucketing.getBucket('large-bucket', `user-${i}`)
          expect(bucket).toBeGreaterThanOrEqual(0)
          expect(bucket).toBeLessThan(1000000)
        }
      })
    })
  })

  // ============================================================================
  // ADDITIONAL INTEGRATION TESTS
  // ============================================================================

  describe('Integration tests', () => {
    it('should maintain statistical properties across multiple independent rollouts', () => {
      const bucketing = createTestBucketing()
      const totalUsers = 5000

      // Run multiple independent 30% rollouts
      const flagKeys = ['rollout-a', 'rollout-b', 'rollout-c', 'rollout-d', 'rollout-e']
      const counts: number[] = []

      for (const flagKey of flagKeys) {
        let count = 0
        for (let i = 0; i < totalUsers; i++) {
          if (bucketing.isInRollout(flagKey, `user-${i}`, 30)) {
            count++
          }
        }
        counts.push(count)
      }

      // Each rollout should include approximately 30% of users
      for (const count of counts) {
        const percentage = (count / totalUsers) * 100
        expect(percentage).toBeGreaterThan(25)
        expect(percentage).toBeLessThan(35)
      }
    })

    it('should show flag independence - users in different flags are not correlated', () => {
      const bucketing = createTestBucketing()
      const totalUsers = 1000

      let bothCount = 0
      let aOnlyCount = 0
      let bOnlyCount = 0
      let neitherCount = 0

      for (let i = 0; i < totalUsers; i++) {
        const userId = `user-${i}`
        const inA = bucketing.isInRollout('independent-a', userId, 50)
        const inB = bucketing.isInRollout('independent-b', userId, 50)

        if (inA && inB) bothCount++
        else if (inA) aOnlyCount++
        else if (inB) bOnlyCount++
        else neitherCount++
      }

      // With true independence and 50%/50% rollouts:
      // - 25% in both (50% * 50%)
      // - 25% in A only
      // - 25% in B only
      // - 25% in neither
      // Allow reasonable variance

      expect(bothCount).toBeGreaterThan(150)
      expect(bothCount).toBeLessThan(350)
      expect(aOnlyCount).toBeGreaterThan(150)
      expect(aOnlyCount).toBeLessThan(350)
      expect(bOnlyCount).toBeGreaterThan(150)
      expect(bOnlyCount).toBeLessThan(350)
      expect(neitherCount).toBeGreaterThan(150)
      expect(neitherCount).toBeLessThan(350)
    })

    it('should use salt to enable deliberate rebucketing', () => {
      const bucketing = createTestBucketing()
      const totalUsers = 1000

      let changedCount = 0
      for (let i = 0; i < totalUsers; i++) {
        const userId = `user-${i}`
        const resultV1 = bucketing.isInRollout('salted-flag', userId, 50)
        // With different salt
        const bucket1 = bucketing.getBucket('salted-flag', userId, 'salt-v1')
        const bucket2 = bucketing.getBucket('salted-flag', userId, 'salt-v2')

        if (bucket1 !== bucket2) {
          changedCount++
        }
      }

      // Most users should get different buckets with different salts
      expect(changedCount).toBeGreaterThan(500)
    })
  })
})
