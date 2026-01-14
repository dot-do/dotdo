import { describe, it, expect, beforeEach } from 'vitest'
import {
  createPercentageBucketing,
  generateFlagSalt,
  validateVariantWeights,
  expectedRolloutPercentage,
  simulateRollout,
  simulateVariantDistribution,
  percentageBucketing,
  type WeightedVariant,
  type PercentageBucketingConfig,
} from '../percentage-bucketing'

describe('PercentageBucketing', () => {
  // ===========================================================================
  // 1. Deterministic Bucketing
  // ===========================================================================
  describe('deterministic bucketing', () => {
    it('should return same bucket for same user/flag combination', () => {
      const bucketing = createPercentageBucketing()

      const bucket1 = bucketing.getBucket('feature-x', 'user-123')
      const bucket2 = bucketing.getBucket('feature-x', 'user-123')
      const bucket3 = bucketing.getBucket('feature-x', 'user-123')

      expect(bucket1).toBe(bucket2)
      expect(bucket2).toBe(bucket3)
    })

    it('should return same bucket across different instances', () => {
      const bucketing1 = createPercentageBucketing()
      const bucketing2 = createPercentageBucketing()

      const bucket1 = bucketing1.getBucket('feature-x', 'user-456')
      const bucket2 = bucketing2.getBucket('feature-x', 'user-456')

      expect(bucket1).toBe(bucket2)
    })

    it('should return different buckets for different users', () => {
      const bucketing = createPercentageBucketing()

      const buckets = new Set<number>()
      for (let i = 0; i < 100; i++) {
        buckets.add(bucketing.getBucket('feature-x', `user-${i}`))
      }

      // Should have good distribution - at least 50 unique buckets for 100 users
      expect(buckets.size).toBeGreaterThan(50)
    })

    it('should return different buckets for different flags (same user)', () => {
      const bucketing = createPercentageBucketing()

      const bucket1 = bucketing.getBucket('feature-a', 'user-123')
      const bucket2 = bucketing.getBucket('feature-b', 'user-123')
      const bucket3 = bucketing.getBucket('feature-c', 'user-123')

      // Different flags should generally produce different buckets
      // Not guaranteed for all cases due to hash collisions, but highly likely
      const buckets = new Set([bucket1, bucket2, bucket3])
      expect(buckets.size).toBeGreaterThanOrEqual(2)
    })

    it('should return bucket within valid range', () => {
      const bucketing = createPercentageBucketing({ bucketCount: 10000 })

      for (let i = 0; i < 100; i++) {
        const bucket = bucketing.getBucket('test-flag', `user-${i}`)
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(10000)
      }
    })
  })

  // ===========================================================================
  // 2. Consistent Hashing
  // ===========================================================================
  describe('consistent hashing', () => {
    it('should produce well-distributed buckets', () => {
      const bucketing = createPercentageBucketing({ bucketCount: 100 })
      const bucketCounts = new Array(100).fill(0)

      // Generate many users and count bucket distribution
      const userCount = 10000
      for (let i = 0; i < userCount; i++) {
        const bucket = bucketing.getBucket('test-flag', `user-${i}`)
        bucketCounts[bucket]++
      }

      // Each bucket should have roughly userCount/100 = 100 users
      // Allow +-50% variance for statistical noise
      const expectedPerBucket = userCount / 100
      let withinRange = 0
      for (const count of bucketCounts) {
        if (count >= expectedPerBucket * 0.5 && count <= expectedPerBucket * 1.5) {
          withinRange++
        }
      }

      // At least 90% of buckets should be within range
      expect(withinRange).toBeGreaterThanOrEqual(90)
    })

    it('should be stable when bucket count changes are avoided', () => {
      // Test that same config produces same results
      const config: PercentageBucketingConfig = { bucketCount: 5000 }
      const bucketing1 = createPercentageBucketing(config)
      const bucketing2 = createPercentageBucketing(config)

      for (let i = 0; i < 50; i++) {
        const userId = `stability-test-${i}`
        expect(bucketing1.getBucket('flag', userId)).toBe(bucketing2.getBucket('flag', userId))
      }
    })
  })

  // ===========================================================================
  // 3. Configurable Bucket Count
  // ===========================================================================
  describe('configurable bucket count', () => {
    it('should default to 10000 buckets (0.01% precision)', () => {
      const bucketing = createPercentageBucketing()
      expect(bucketing.getBucketCount()).toBe(10000)
    })

    it('should respect custom bucket count', () => {
      const bucketing = createPercentageBucketing({ bucketCount: 1000 })
      expect(bucketing.getBucketCount()).toBe(1000)

      for (let i = 0; i < 100; i++) {
        const bucket = bucketing.getBucket('test', `user-${i}`)
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(1000)
      }
    })

    it('should work with small bucket counts', () => {
      const bucketing = createPercentageBucketing({ bucketCount: 10 })

      const buckets = new Set<number>()
      for (let i = 0; i < 100; i++) {
        const bucket = bucketing.getBucket('test', `user-${i}`)
        buckets.add(bucket)
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(10)
      }

      // Should hit most buckets with 100 users in 10 buckets
      expect(buckets.size).toBeGreaterThanOrEqual(8)
    })

    it('should work with large bucket counts', () => {
      const bucketing = createPercentageBucketing({ bucketCount: 100000 })
      expect(bucketing.getBucketCount()).toBe(100000)

      for (let i = 0; i < 100; i++) {
        const bucket = bucketing.getBucket('test', `user-${i}`)
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(100000)
      }
    })
  })

  // ===========================================================================
  // 4. Salt per Flag (Correlation Prevention)
  // ===========================================================================
  describe('salt per flag', () => {
    it('should produce different buckets with different salts', () => {
      const bucketing = createPercentageBucketing()

      const bucket1 = bucketing.getBucket('feature', 'user-1', 'salt-a')
      const bucket2 = bucketing.getBucket('feature', 'user-1', 'salt-b')
      const bucket3 = bucketing.getBucket('feature', 'user-1', 'salt-c')

      // Different salts should produce different buckets
      const buckets = new Set([bucket1, bucket2, bucket3])
      expect(buckets.size).toBeGreaterThanOrEqual(2)
    })

    it('should use flagKey as default salt', () => {
      const bucketing = createPercentageBucketing()

      // Without salt, flagKey is used
      const bucket1 = bucketing.getBucket('my-flag', 'user-1')
      // With flagKey as explicit salt, should be the same
      const bucket2 = bucketing.getBucket('my-flag', 'user-1', 'my-flag')

      expect(bucket1).toBe(bucket2)
    })

    it('should prevent correlation between flags with different salts', () => {
      const bucketing = createPercentageBucketing({ bucketCount: 100 })

      // Collect bucket pairs for many users
      const correlations: number[] = []
      for (let i = 0; i < 1000; i++) {
        const userId = `user-${i}`
        const bucket1 = bucketing.getBucket('flag-1', userId, 'unique-salt-1')
        const bucket2 = bucketing.getBucket('flag-2', userId, 'unique-salt-2')
        // Track if buckets are equal
        if (bucket1 === bucket2) correlations.push(1)
      }

      // With good salt separation, bucket equality should be ~1% (1/100)
      // Allow up to 3% to account for variance
      expect(correlations.length / 1000).toBeLessThan(0.03)
    })

    it('should generate unique salts', () => {
      const salts = new Set<string>()
      for (let i = 0; i < 100; i++) {
        salts.add(generateFlagSalt())
      }
      expect(salts.size).toBe(100)
    })
  })

  // ===========================================================================
  // 5. Sticky Bucketing with Override Support
  // ===========================================================================
  describe('sticky bucketing', () => {
    it('should allow setting bucket overrides', () => {
      const bucketing = createPercentageBucketing()

      const originalBucket = bucketing.getBucket('feature-x', 'user-1')
      const overrideBucket = (originalBucket + 500) % 10000

      bucketing.setOverride('feature-x', 'user-1', overrideBucket)
      expect(bucketing.getBucket('feature-x', 'user-1')).toBe(overrideBucket)
    })

    it('should allow removing overrides', () => {
      const bucketing = createPercentageBucketing()

      const originalBucket = bucketing.getBucket('feature-x', 'user-1')
      bucketing.setOverride('feature-x', 'user-1', 5000)
      bucketing.removeOverride('feature-x', 'user-1')

      expect(bucketing.getBucket('feature-x', 'user-1')).toBe(originalBucket)
    })

    it('should allow clearing all overrides', () => {
      const bucketing = createPercentageBucketing()

      const original1 = bucketing.getBucket('flag-1', 'user-1')
      const original2 = bucketing.getBucket('flag-2', 'user-2')

      bucketing.setOverride('flag-1', 'user-1', 1000)
      bucketing.setOverride('flag-2', 'user-2', 2000)

      bucketing.clearOverrides()

      expect(bucketing.getBucket('flag-1', 'user-1')).toBe(original1)
      expect(bucketing.getBucket('flag-2', 'user-2')).toBe(original2)
    })

    it('should validate override bucket range', () => {
      const bucketing = createPercentageBucketing({ bucketCount: 1000 })

      expect(() => bucketing.setOverride('flag', 'user', -1)).toThrow()
      expect(() => bucketing.setOverride('flag', 'user', 1000)).toThrow()
      expect(() => bucketing.setOverride('flag', 'user', 999)).not.toThrow()
    })

    it('should support preloaded overrides via config', () => {
      const overrides = new Map<string, number>()
      overrides.set('feature:vip-user', 0) // Always in bucket 0

      const bucketing = createPercentageBucketing({ overrides })

      expect(bucketing.getBucket('feature', 'vip-user')).toBe(0)
    })
  })

  // ===========================================================================
  // 6. Gradual Rollout Support
  // ===========================================================================
  describe('gradual rollout', () => {
    it('should return false for 0% rollout', () => {
      const bucketing = createPercentageBucketing()

      for (let i = 0; i < 100; i++) {
        expect(bucketing.isInRollout('flag', `user-${i}`, 0)).toBe(false)
      }
    })

    it('should return true for 100% rollout', () => {
      const bucketing = createPercentageBucketing()

      for (let i = 0; i < 100; i++) {
        expect(bucketing.isInRollout('flag', `user-${i}`, 100)).toBe(true)
      }
    })

    it('should respect percentage boundaries', () => {
      const bucketing = createPercentageBucketing({ bucketCount: 100 })

      // Count users in 50% rollout
      let inCount = 0
      const totalUsers = 10000

      for (let i = 0; i < totalUsers; i++) {
        if (bucketing.isInRollout('test-flag', `user-${i}`, 50)) {
          inCount++
        }
      }

      // Should be approximately 50% (within 5% tolerance)
      const actualPercentage = (inCount / totalUsers) * 100
      expect(actualPercentage).toBeGreaterThan(45)
      expect(actualPercentage).toBeLessThan(55)
    })

    it('should support gradual increase (10% -> 50% -> 100%)', () => {
      const bucketing = createPercentageBucketing()
      const userId = 'consistent-user'

      // Track which rollouts the user is in
      const in10 = bucketing.isInRollout('gradual-flag', userId, 10)
      const in50 = bucketing.isInRollout('gradual-flag', userId, 50)
      const in100 = bucketing.isInRollout('gradual-flag', userId, 100)

      // If user is in 10%, they must be in 50% and 100%
      if (in10) {
        expect(in50).toBe(true)
        expect(in100).toBe(true)
      }

      // If user is in 50%, they must be in 100%
      if (in50) {
        expect(in100).toBe(true)
      }

      // 100% should always be true
      expect(in100).toBe(true)
    })

    it('should maintain consistency during gradual rollout increases', () => {
      const bucketing = createPercentageBucketing()
      const users = Array.from({ length: 1000 }, (_, i) => `user-${i}`)

      // Users in 10% rollout
      const in10 = users.filter((u) => bucketing.isInRollout('flag', u, 10))
      // Users in 50% rollout
      const in50 = users.filter((u) => bucketing.isInRollout('flag', u, 50))

      // All users in 10% should also be in 50%
      for (const user of in10) {
        expect(in50).toContain(user)
      }
    })

    it('should use simulateRollout helper correctly', () => {
      const result = simulateRollout('test-flag', 10000, 25)

      expect(result.inCount + result.outCount).toBe(10000)
      expect(result.actualPercentage).toBeGreaterThan(20)
      expect(result.actualPercentage).toBeLessThan(30)
    })
  })

  // ===========================================================================
  // 7. Weighted Variants
  // ===========================================================================
  describe('weighted variants', () => {
    it('should return single variant when only one provided', () => {
      const bucketing = createPercentageBucketing()
      const variants: WeightedVariant<string>[] = [{ value: 'only-option', weight: 100 }]

      expect(bucketing.getVariant('flag', 'user-1', variants)).toBe('only-option')
      expect(bucketing.getVariant('flag', 'user-2', variants)).toBe('only-option')
    })

    it('should throw error for empty variants array', () => {
      const bucketing = createPercentageBucketing()
      expect(() => bucketing.getVariant('flag', 'user', [])).toThrow('Variants array cannot be empty')
    })

    it('should distribute variants according to weights', () => {
      const bucketing = createPercentageBucketing()
      const variants: WeightedVariant<string>[] = [
        { value: 'control', weight: 50 },
        { value: 'treatment', weight: 50 },
      ]

      const distribution = new Map<string, number>()
      const totalUsers = 10000

      for (let i = 0; i < totalUsers; i++) {
        const variant = bucketing.getVariant('ab-test', `user-${i}`, variants)
        distribution.set(variant, (distribution.get(variant) ?? 0) + 1)
      }

      const controlPct = ((distribution.get('control') ?? 0) / totalUsers) * 100
      const treatmentPct = ((distribution.get('treatment') ?? 0) / totalUsers) * 100

      // Should be approximately 50/50 (within 5% tolerance)
      expect(controlPct).toBeGreaterThan(45)
      expect(controlPct).toBeLessThan(55)
      expect(treatmentPct).toBeGreaterThan(45)
      expect(treatmentPct).toBeLessThan(55)
    })

    it('should handle unequal weights', () => {
      const bucketing = createPercentageBucketing()
      const variants: WeightedVariant<string>[] = [
        { value: 'a', weight: 10 },
        { value: 'b', weight: 30 },
        { value: 'c', weight: 60 },
      ]

      const distribution = simulateVariantDistribution('unequal-test', 10000, variants)

      const aPct = ((distribution.get('a') ?? 0) / 10000) * 100
      const bPct = ((distribution.get('b') ?? 0) / 10000) * 100
      const cPct = ((distribution.get('c') ?? 0) / 10000) * 100

      // Check distribution is roughly correct (within 5% of expected)
      expect(aPct).toBeGreaterThan(5)
      expect(aPct).toBeLessThan(15)
      expect(bPct).toBeGreaterThan(25)
      expect(bPct).toBeLessThan(35)
      expect(cPct).toBeGreaterThan(55)
      expect(cPct).toBeLessThan(65)
    })

    it('should return consistent variant for same user', () => {
      const bucketing = createPercentageBucketing()
      const variants: WeightedVariant<number>[] = [
        { value: 1, weight: 33 },
        { value: 2, weight: 33 },
        { value: 3, weight: 34 },
      ]

      const variant1 = bucketing.getVariant('multivar-flag', 'sticky-user', variants)
      const variant2 = bucketing.getVariant('multivar-flag', 'sticky-user', variants)
      const variant3 = bucketing.getVariant('multivar-flag', 'sticky-user', variants)

      expect(variant1).toBe(variant2)
      expect(variant2).toBe(variant3)
    })

    it('should validate variant weights sum to 100', () => {
      expect(
        validateVariantWeights([
          { value: 'a', weight: 50 },
          { value: 'b', weight: 50 },
        ])
      ).toBe(true)

      expect(
        validateVariantWeights([
          { value: 'a', weight: 25 },
          { value: 'b', weight: 25 },
          { value: 'c', weight: 50 },
        ])
      ).toBe(true)

      expect(
        validateVariantWeights([
          { value: 'a', weight: 40 },
          { value: 'b', weight: 40 },
        ])
      ).toBe(false)
    })
  })

  // ===========================================================================
  // 8. Bucketing Audit
  // ===========================================================================
  describe('bucketing audit', () => {
    it('should not record audit by default', () => {
      const bucketing = createPercentageBucketing()
      bucketing.getBucket('flag', 'user')

      expect(bucketing.getAuditLog()).toHaveLength(0)
    })

    it('should record audit when enabled', () => {
      const bucketing = createPercentageBucketing({ enableAudit: true })

      bucketing.getBucket('test-flag', 'user-123', 'custom-salt')
      const log = bucketing.getAuditLog()

      expect(log).toHaveLength(1)
      expect(log[0]).toMatchObject({
        flagKey: 'test-flag',
        userId: 'user-123',
        salt: 'custom-salt',
        overrideApplied: false,
        bucketCount: 10000,
      })
      expect(log[0]!.timestamp).toBeGreaterThan(0)
      expect(log[0]!.hashValue).toBeGreaterThanOrEqual(0)
      expect(log[0]!.bucket).toBeGreaterThanOrEqual(0)
      expect(log[0]!.bucket).toBeLessThan(10000)
    })

    it('should record override in audit', () => {
      const bucketing = createPercentageBucketing({ enableAudit: true })

      bucketing.setOverride('flag', 'user', 5555)
      bucketing.getBucket('flag', 'user')

      const log = bucketing.getAuditLog()
      expect(log[0]).toMatchObject({
        flagKey: 'flag',
        userId: 'user',
        bucket: 5555,
        overrideApplied: true,
      })
    })

    it('should respect maxAuditRecords limit', () => {
      const bucketing = createPercentageBucketing({
        enableAudit: true,
        maxAuditRecords: 5,
      })

      for (let i = 0; i < 10; i++) {
        bucketing.getBucket('flag', `user-${i}`)
      }

      const log = bucketing.getAuditLog()
      expect(log).toHaveLength(5)
      // Should have the last 5 entries
      expect(log[0]!.userId).toBe('user-5')
      expect(log[4]!.userId).toBe('user-9')
    })

    it('should clear audit log', () => {
      const bucketing = createPercentageBucketing({ enableAudit: true })

      bucketing.getBucket('flag', 'user-1')
      bucketing.getBucket('flag', 'user-2')
      expect(bucketing.getAuditLog()).toHaveLength(2)

      bucketing.clearAuditLog()
      expect(bucketing.getAuditLog()).toHaveLength(0)
    })

    it('should return a copy of audit log', () => {
      const bucketing = createPercentageBucketing({ enableAudit: true })
      bucketing.getBucket('flag', 'user')

      const log1 = bucketing.getAuditLog()
      const log2 = bucketing.getAuditLog()

      expect(log1).not.toBe(log2)
      expect(log1).toEqual(log2)
    })
  })

  // ===========================================================================
  // 9. Utility Functions
  // ===========================================================================
  describe('utility functions', () => {
    it('should calculate expected rollout percentage', () => {
      // For 10000 buckets (default)
      expect(expectedRolloutPercentage(0)).toBe(0)
      expect(expectedRolloutPercentage(100)).toBe(100)
      expect(expectedRolloutPercentage(50)).toBe(50)
      expect(expectedRolloutPercentage(33.33)).toBeCloseTo(33.33, 1)

      // For custom bucket count
      expect(expectedRolloutPercentage(50, 100)).toBe(50)
      expect(expectedRolloutPercentage(33, 100)).toBe(33)
    })

    it('should generate 16-character hex salts', () => {
      const salt = generateFlagSalt()
      expect(salt).toMatch(/^[0-9a-f]{16}$/)
    })
  })

  // ===========================================================================
  // 10. Default Instance
  // ===========================================================================
  describe('default instance', () => {
    it('should export a default bucketing instance', () => {
      expect(percentageBucketing).toBeDefined()
      expect(typeof percentageBucketing.getBucket).toBe('function')
      expect(typeof percentageBucketing.isInRollout).toBe('function')
      expect(typeof percentageBucketing.getVariant).toBe('function')
    })

    it('should work correctly with default instance', () => {
      const bucket = percentageBucketing.getBucket('default-test', 'user-1')
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(10000)

      expect(percentageBucketing.isInRollout('default-test', 'user-1', 100)).toBe(true)
      expect(percentageBucketing.isInRollout('default-test', 'user-1', 0)).toBe(false)
    })
  })

  // ===========================================================================
  // 11. Edge Cases
  // ===========================================================================
  describe('edge cases', () => {
    it('should handle empty strings', () => {
      const bucketing = createPercentageBucketing()

      // Empty flag key
      const bucket1 = bucketing.getBucket('', 'user')
      expect(bucket1).toBeGreaterThanOrEqual(0)

      // Empty user id
      const bucket2 = bucketing.getBucket('flag', '')
      expect(bucket2).toBeGreaterThanOrEqual(0)

      // Both empty
      const bucket3 = bucketing.getBucket('', '')
      expect(bucket3).toBeGreaterThanOrEqual(0)
    })

    it('should handle special characters', () => {
      const bucketing = createPercentageBucketing()

      const specialIds = ['user@example.com', 'user:123', 'user/path', 'user.with.dots', 'user#hash', 'emoji\u{1F600}']

      for (const id of specialIds) {
        const bucket = bucketing.getBucket('flag', id)
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(10000)
      }
    })

    it('should handle very long strings', () => {
      const bucketing = createPercentageBucketing()
      const longString = 'x'.repeat(10000)

      const bucket = bucketing.getBucket(longString, longString)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(10000)
    })

    it('should handle unicode strings', () => {
      const bucketing = createPercentageBucketing()

      const unicodeIds = ['\u4e2d\u6587', '\u65e5\u672c\u8a9e', '\ud55c\uad6d\uc5b4', '\u0410\u0411\u0412', '\u0391\u0392\u0393']

      for (const id of unicodeIds) {
        const bucket = bucketing.getBucket('\u529f\u80fd', id)
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(10000)
      }
    })

    it('should handle percentage edge values', () => {
      const bucketing = createPercentageBucketing()

      expect(bucketing.isInRollout('flag', 'user', -1)).toBe(false)
      expect(bucketing.isInRollout('flag', 'user', 0.001)).toBe(false) // Very small but > 0
      expect(bucketing.isInRollout('flag', 'user', 99.999)).toBe(true) // Very close to 100
      expect(bucketing.isInRollout('flag', 'user', 101)).toBe(true)
    })
  })
})
