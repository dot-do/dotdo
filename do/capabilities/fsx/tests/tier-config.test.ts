/**
 * Tier Configuration - RED Phase TDD Tests
 *
 * Comprehensive failing tests for tiered storage configuration covering:
 * - Tier definitions (hot, warm, cold)
 * - Thresholds for tier selection (size boundaries)
 * - Tier enable/disable options (warmEnabled, coldEnabled)
 * - Promotion policies (rules for automatic tier promotion)
 * - Demotion policies (rules for automatic tier demotion)
 * - Configuration validation
 * - Default values
 * - Edge cases (disabled tiers, invalid thresholds)
 * - Policy evaluation logic
 * - Configuration updates at runtime
 *
 * This is a TDD RED phase test file - all tests should fail initially.
 * The tests define the expected behavior for a TierConfig system that
 * does not yet exist.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// These imports will fail - the TierConfig module does not exist yet
// This is intentional for RED phase TDD
import {
  TierConfig,
  TierConfigBuilder,
  TierConfigValidator,
  PromotionPolicy,
  DemotionPolicy,
  TierThresholds,
  TierConfigError,
  createDefaultTierConfig,
  validateTierConfig,
  mergeTierConfigs,
} from '../storage/tier-config'

import type { StorageTier } from '../core/types'

describe('TierConfig', () => {
  // ===========================================================================
  // 1. Tier Definitions
  // ===========================================================================
  describe('Tier Definitions', () => {
    it('should define three tiers: hot, warm, cold', () => {
      const config = new TierConfig()
      const tiers = config.getAvailableTiers()

      expect(tiers).toContain('hot')
      expect(tiers).toContain('warm')
      expect(tiers).toContain('cold')
      expect(tiers).toHaveLength(3)
    })

    it('should have hot tier as the default/primary tier', () => {
      const config = new TierConfig()
      expect(config.getDefaultTier()).toBe('hot')
    })

    it('should allow checking if a tier is enabled', () => {
      const config = new TierConfig()

      expect(config.isTierEnabled('hot')).toBe(true)
      expect(config.isTierEnabled('warm')).toBe(true)
      expect(config.isTierEnabled('cold')).toBe(true)
    })

    it('should provide tier priority order (hot > warm > cold)', () => {
      const config = new TierConfig()
      const priorities = config.getTierPriorities()

      expect(priorities.hot).toBeLessThan(priorities.warm)
      expect(priorities.warm).toBeLessThan(priorities.cold)
    })

    it('should describe tier characteristics', () => {
      const config = new TierConfig()

      const hotInfo = config.getTierInfo('hot')
      expect(hotInfo.name).toBe('hot')
      expect(hotInfo.description).toContain('low latency')
      expect(hotInfo.storageType).toBe('durable-object')

      const warmInfo = config.getTierInfo('warm')
      expect(warmInfo.name).toBe('warm')
      expect(warmInfo.storageType).toBe('r2')

      const coldInfo = config.getTierInfo('cold')
      expect(coldInfo.name).toBe('cold')
      expect(coldInfo.storageType).toBe('r2-archive')
    })
  })

  // ===========================================================================
  // 2. Threshold Configuration
  // ===========================================================================
  describe('Threshold Configuration', () => {
    it('should have default thresholds', () => {
      const config = new TierConfig()
      const thresholds = config.getThresholds()

      expect(thresholds.hotMaxSize).toBe(1024 * 1024) // 1MB
      expect(thresholds.warmMaxSize).toBe(100 * 1024 * 1024) // 100MB
    })

    it('should allow custom threshold configuration', () => {
      const config = new TierConfig({
        thresholds: {
          hotMaxSize: 512 * 1024, // 512KB
          warmMaxSize: 50 * 1024 * 1024, // 50MB
        },
      })

      expect(config.getThresholds().hotMaxSize).toBe(512 * 1024)
      expect(config.getThresholds().warmMaxSize).toBe(50 * 1024 * 1024)
    })

    it('should select correct tier based on file size', () => {
      const config = new TierConfig({
        thresholds: {
          hotMaxSize: 1000,
          warmMaxSize: 10000,
        },
      })

      expect(config.selectTierForSize(500)).toBe('hot')
      expect(config.selectTierForSize(1000)).toBe('hot') // at threshold
      expect(config.selectTierForSize(1001)).toBe('warm') // just over
      expect(config.selectTierForSize(5000)).toBe('warm')
      expect(config.selectTierForSize(10000)).toBe('warm') // at threshold
      expect(config.selectTierForSize(10001)).toBe('cold') // just over
      expect(config.selectTierForSize(100000)).toBe('cold')
    })

    it('should handle zero-size files in hot tier', () => {
      const config = new TierConfig()
      expect(config.selectTierForSize(0)).toBe('hot')
    })

    it('should handle very large files in cold tier', () => {
      const config = new TierConfig()
      const oneGB = 1024 * 1024 * 1024
      expect(config.selectTierForSize(oneGB)).toBe('cold')
    })

    it('should validate threshold ordering (hot < warm)', () => {
      expect(() => {
        new TierConfig({
          thresholds: {
            hotMaxSize: 10000,
            warmMaxSize: 5000, // smaller than hot - invalid
          },
        })
      }).toThrow(TierConfigError)
    })

    it('should reject negative thresholds', () => {
      expect(() => {
        new TierConfig({
          thresholds: {
            hotMaxSize: -1000,
          },
        })
      }).toThrow(TierConfigError)
    })

    it('should allow partial threshold configuration', () => {
      const config = new TierConfig({
        thresholds: {
          hotMaxSize: 512 * 1024,
          // warmMaxSize uses default
        },
      })

      expect(config.getThresholds().hotMaxSize).toBe(512 * 1024)
      expect(config.getThresholds().warmMaxSize).toBe(100 * 1024 * 1024)
    })
  })

  // ===========================================================================
  // 3. Tier Enable/Disable Configuration
  // ===========================================================================
  describe('Tier Enable/Disable', () => {
    it('should allow disabling warm tier', () => {
      const config = new TierConfig({
        warmEnabled: false,
      })

      expect(config.isTierEnabled('hot')).toBe(true)
      expect(config.isTierEnabled('warm')).toBe(false)
      expect(config.isTierEnabled('cold')).toBe(true)
    })

    it('should allow disabling cold tier', () => {
      const config = new TierConfig({
        coldEnabled: false,
      })

      expect(config.isTierEnabled('hot')).toBe(true)
      expect(config.isTierEnabled('warm')).toBe(true)
      expect(config.isTierEnabled('cold')).toBe(false)
    })

    it('should not allow disabling hot tier', () => {
      expect(() => {
        new TierConfig({
          hotEnabled: false, // hot tier must always be enabled
        } as any)
      }).toThrow(TierConfigError)
    })

    it('should fall back to hot when warm is disabled for medium files', () => {
      const config = new TierConfig({
        warmEnabled: false,
        thresholds: {
          hotMaxSize: 1000,
          warmMaxSize: 10000,
        },
      })

      // Files that would normally go to warm should go to hot instead
      expect(config.selectTierForSize(5000)).toBe('hot')
    })

    it('should fall back to warm when cold is disabled for large files', () => {
      const config = new TierConfig({
        coldEnabled: false,
        thresholds: {
          hotMaxSize: 1000,
          warmMaxSize: 10000,
        },
      })

      // Files that would normally go to cold should go to warm instead
      expect(config.selectTierForSize(50000)).toBe('warm')
    })

    it('should fall back to hot when both warm and cold are disabled', () => {
      const config = new TierConfig({
        warmEnabled: false,
        coldEnabled: false,
      })

      // All files go to hot regardless of size
      expect(config.selectTierForSize(0)).toBe('hot')
      expect(config.selectTierForSize(1000000)).toBe('hot')
      expect(config.selectTierForSize(1000000000)).toBe('hot')
    })

    it('should return only enabled tiers from getAvailableTiers', () => {
      const config = new TierConfig({
        warmEnabled: false,
      })

      const tiers = config.getAvailableTiers()
      expect(tiers).toContain('hot')
      expect(tiers).not.toContain('warm')
      expect(tiers).toContain('cold')
    })
  })

  // ===========================================================================
  // 4. Promotion Policy Configuration
  // ===========================================================================
  describe('Promotion Policy', () => {
    it('should have default promotion policy of "on-access"', () => {
      const config = new TierConfig()
      expect(config.getPromotionPolicy()).toBe('on-access')
    })

    it('should allow setting promotion policy to "none"', () => {
      const config = new TierConfig({
        promotionPolicy: 'none',
      })
      expect(config.getPromotionPolicy()).toBe('none')
    })

    it('should allow setting promotion policy to "aggressive"', () => {
      const config = new TierConfig({
        promotionPolicy: 'aggressive',
      })
      expect(config.getPromotionPolicy()).toBe('aggressive')
    })

    it('should evaluate promotion eligibility based on policy', () => {
      const onAccessConfig = new TierConfig({ promotionPolicy: 'on-access' })
      const noneConfig = new TierConfig({ promotionPolicy: 'none' })
      const aggressiveConfig = new TierConfig({ promotionPolicy: 'aggressive' })

      const metadata = {
        tier: 'warm' as StorageTier,
        accessCount: 3,
        lastAccess: Date.now() - 1000, // 1 second ago
        size: 500, // small enough for hot
      }

      expect(onAccessConfig.shouldPromote(metadata)).toBe(true)
      expect(noneConfig.shouldPromote(metadata)).toBe(false)
      expect(aggressiveConfig.shouldPromote(metadata)).toBe(true)
    })

    it('should not promote if file is too large for target tier', () => {
      const config = new TierConfig({
        promotionPolicy: 'aggressive',
        thresholds: { hotMaxSize: 1000 },
      })

      const metadata = {
        tier: 'warm' as StorageTier,
        accessCount: 100,
        lastAccess: Date.now(),
        size: 5000, // too large for hot
      }

      expect(config.shouldPromote(metadata)).toBe(false)
    })

    it('should support custom promotion thresholds', () => {
      const config = new TierConfig({
        promotionPolicy: 'on-access',
        promotionThresholds: {
          minAccessCount: 5,
          maxAgeDays: 1,
        },
      })

      // Not enough accesses
      expect(
        config.shouldPromote({
          tier: 'warm',
          accessCount: 3,
          lastAccess: Date.now(),
          size: 500,
        })
      ).toBe(false)

      // Enough accesses
      expect(
        config.shouldPromote({
          tier: 'warm',
          accessCount: 5,
          lastAccess: Date.now(),
          size: 500,
        })
      ).toBe(true)

      // Too old
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000
      expect(
        config.shouldPromote({
          tier: 'warm',
          accessCount: 10,
          lastAccess: twoDaysAgo,
          size: 500,
        })
      ).toBe(false)
    })

    it('should determine target promotion tier correctly', () => {
      const config = new TierConfig()

      expect(config.getPromotionTarget('cold')).toBe('warm')
      expect(config.getPromotionTarget('warm')).toBe('hot')
      expect(config.getPromotionTarget('hot')).toBe(null) // already at highest
    })

    it('should skip disabled tiers during promotion', () => {
      const config = new TierConfig({
        warmEnabled: false,
      })

      // Should promote directly from cold to hot
      expect(config.getPromotionTarget('cold')).toBe('hot')
    })
  })

  // ===========================================================================
  // 5. Demotion Policy Configuration
  // ===========================================================================
  describe('Demotion Policy', () => {
    it('should have default demotion policy enabled', () => {
      const config = new TierConfig()
      expect(config.isDemotionEnabled()).toBe(true)
    })

    it('should allow disabling automatic demotion', () => {
      const config = new TierConfig({
        demotionPolicy: 'none',
      })
      expect(config.isDemotionEnabled()).toBe(false)
    })

    it('should have default age thresholds for demotion', () => {
      const config = new TierConfig()
      const thresholds = config.getDemotionThresholds()

      expect(thresholds.hotMaxAgeDays).toBe(1) // 1 day
      expect(thresholds.warmMaxAgeDays).toBe(30) // 30 days
    })

    it('should allow custom age thresholds', () => {
      const config = new TierConfig({
        demotionThresholds: {
          hotMaxAgeDays: 7,
          warmMaxAgeDays: 90,
        },
      })

      const thresholds = config.getDemotionThresholds()
      expect(thresholds.hotMaxAgeDays).toBe(7)
      expect(thresholds.warmMaxAgeDays).toBe(90)
    })

    it('should evaluate demotion eligibility based on age', () => {
      const config = new TierConfig({
        demotionThresholds: {
          hotMaxAgeDays: 1,
          warmMaxAgeDays: 30,
        },
      })

      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000
      const twoMonthsAgo = Date.now() - 60 * 24 * 60 * 60 * 1000

      // Hot file older than 1 day should be demoted
      expect(
        config.shouldDemote({
          tier: 'hot',
          lastAccess: twoDaysAgo,
          size: 500,
        })
      ).toBe(true)

      // Hot file accessed recently should not be demoted
      expect(
        config.shouldDemote({
          tier: 'hot',
          lastAccess: Date.now(),
          size: 500,
        })
      ).toBe(false)

      // Warm file older than 30 days should be demoted
      expect(
        config.shouldDemote({
          tier: 'warm',
          lastAccess: twoMonthsAgo,
          size: 5000,
        })
      ).toBe(true)

      // Cold files should never be demoted (already lowest)
      expect(
        config.shouldDemote({
          tier: 'cold',
          lastAccess: twoMonthsAgo,
          size: 50000,
        })
      ).toBe(false)
    })

    it('should determine target demotion tier correctly', () => {
      const config = new TierConfig()

      expect(config.getDemotionTarget('hot')).toBe('warm')
      expect(config.getDemotionTarget('warm')).toBe('cold')
      expect(config.getDemotionTarget('cold')).toBe(null) // already at lowest
    })

    it('should skip disabled tiers during demotion', () => {
      const config = new TierConfig({
        warmEnabled: false,
      })

      // Should demote directly from hot to cold
      expect(config.getDemotionTarget('hot')).toBe('cold')
    })

    it('should not demote if target tier is disabled', () => {
      const config = new TierConfig({
        coldEnabled: false,
      })

      // Warm files cannot be demoted since cold is disabled
      expect(config.getDemotionTarget('warm')).toBe(null)
    })
  })

  // ===========================================================================
  // 6. Configuration Validation
  // ===========================================================================
  describe('Configuration Validation', () => {
    it('should validate complete configuration', () => {
      const validConfig = {
        thresholds: {
          hotMaxSize: 1024 * 1024,
          warmMaxSize: 100 * 1024 * 1024,
        },
        warmEnabled: true,
        coldEnabled: true,
        promotionPolicy: 'on-access' as const,
        demotionPolicy: 'on-age' as const,
      }

      expect(() => validateTierConfig(validConfig)).not.toThrow()
    })

    it('should reject invalid threshold types', () => {
      expect(() =>
        validateTierConfig({
          thresholds: {
            hotMaxSize: 'not a number' as any,
          },
        })
      ).toThrow(TierConfigError)
    })

    it('should reject invalid policy values', () => {
      expect(() =>
        validateTierConfig({
          promotionPolicy: 'invalid-policy' as any,
        })
      ).toThrow(TierConfigError)
    })

    it('should reject threshold values that violate ordering', () => {
      expect(() =>
        validateTierConfig({
          thresholds: {
            hotMaxSize: 1000000,
            warmMaxSize: 1000, // must be >= hotMaxSize
          },
        })
      ).toThrow(TierConfigError)
    })

    it('should reject invalid demotion thresholds', () => {
      expect(() =>
        validateTierConfig({
          demotionThresholds: {
            hotMaxAgeDays: -1,
          },
        })
      ).toThrow(TierConfigError)
    })

    it('should validate promotion thresholds', () => {
      expect(() =>
        validateTierConfig({
          promotionThresholds: {
            minAccessCount: -5,
          },
        })
      ).toThrow(TierConfigError)
    })

    it('should provide detailed validation errors', () => {
      try {
        validateTierConfig({
          thresholds: {
            hotMaxSize: -1000,
          },
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TierConfigError)
        expect((error as TierConfigError).field).toBe('thresholds.hotMaxSize')
        expect((error as TierConfigError).reason).toContain('negative')
      }
    })
  })

  // ===========================================================================
  // 7. Default Values
  // ===========================================================================
  describe('Default Values', () => {
    it('should create config with all defaults', () => {
      const config = createDefaultTierConfig()

      expect(config.thresholds.hotMaxSize).toBe(1024 * 1024)
      expect(config.thresholds.warmMaxSize).toBe(100 * 1024 * 1024)
      expect(config.warmEnabled).toBe(true)
      expect(config.coldEnabled).toBe(true)
      expect(config.promotionPolicy).toBe('on-access')
      expect(config.demotionPolicy).toBe('on-age')
    })

    it('should allow overriding specific defaults', () => {
      const config = new TierConfig({
        thresholds: { hotMaxSize: 2 * 1024 * 1024 },
      })

      expect(config.getThresholds().hotMaxSize).toBe(2 * 1024 * 1024)
      expect(config.getThresholds().warmMaxSize).toBe(100 * 1024 * 1024) // default
    })

    it('should merge partial configs with defaults', () => {
      const partial = {
        warmEnabled: false,
      }

      const merged = mergeTierConfigs(createDefaultTierConfig(), partial)

      expect(merged.warmEnabled).toBe(false)
      expect(merged.coldEnabled).toBe(true) // from default
      expect(merged.thresholds.hotMaxSize).toBe(1024 * 1024) // from default
    })

    it('should deep merge threshold configurations', () => {
      const base = createDefaultTierConfig()
      const override = {
        thresholds: {
          hotMaxSize: 512 * 1024,
        },
      }

      const merged = mergeTierConfigs(base, override)

      expect(merged.thresholds.hotMaxSize).toBe(512 * 1024)
      expect(merged.thresholds.warmMaxSize).toBe(100 * 1024 * 1024) // preserved
    })
  })

  // ===========================================================================
  // 8. Edge Cases
  // ===========================================================================
  describe('Edge Cases', () => {
    it('should handle Infinity threshold', () => {
      const config = new TierConfig({
        thresholds: {
          hotMaxSize: Infinity,
        },
      })

      // All files go to hot
      expect(config.selectTierForSize(Number.MAX_SAFE_INTEGER)).toBe('hot')
    })

    it('should handle zero thresholds', () => {
      const config = new TierConfig({
        thresholds: {
          hotMaxSize: 0,
          warmMaxSize: 0,
        },
      })

      // Only zero-size files go to hot
      expect(config.selectTierForSize(0)).toBe('hot')
      expect(config.selectTierForSize(1)).toBe('cold')
    })

    it('should handle equal hot and warm thresholds', () => {
      const config = new TierConfig({
        thresholds: {
          hotMaxSize: 1000,
          warmMaxSize: 1000, // same as hot
        },
      })

      // At threshold, should be in hot
      expect(config.selectTierForSize(1000)).toBe('hot')
      // Just over goes to cold (skips warm)
      expect(config.selectTierForSize(1001)).toBe('cold')
    })

    it('should handle promotion when already at hot tier', () => {
      const config = new TierConfig()

      const metadata = {
        tier: 'hot' as StorageTier,
        accessCount: 100,
        lastAccess: Date.now(),
        size: 500,
      }

      expect(config.shouldPromote(metadata)).toBe(false)
    })

    it('should handle demotion when already at cold tier', () => {
      const config = new TierConfig()

      const metadata = {
        tier: 'cold' as StorageTier,
        lastAccess: 0, // very old
        size: 500000,
      }

      expect(config.shouldDemote(metadata)).toBe(false)
    })

    it('should handle missing optional fields in metadata', () => {
      const config = new TierConfig()

      // Minimal metadata
      const metadata = {
        tier: 'warm' as StorageTier,
        size: 500,
      }

      // Should not throw with missing accessCount/lastAccess
      expect(() => config.shouldPromote(metadata)).not.toThrow()
      expect(() => config.shouldDemote(metadata)).not.toThrow()
    })
  })

  // ===========================================================================
  // 9. Runtime Configuration Updates
  // ===========================================================================
  describe('Runtime Configuration Updates', () => {
    it('should allow updating thresholds at runtime', () => {
      const config = new TierConfig()

      config.updateThresholds({
        hotMaxSize: 2 * 1024 * 1024,
      })

      expect(config.getThresholds().hotMaxSize).toBe(2 * 1024 * 1024)
    })

    it('should validate threshold updates', () => {
      const config = new TierConfig()

      expect(() =>
        config.updateThresholds({
          hotMaxSize: -1000,
        })
      ).toThrow(TierConfigError)
    })

    it('should allow enabling/disabling tiers at runtime', () => {
      const config = new TierConfig()

      config.setTierEnabled('warm', false)
      expect(config.isTierEnabled('warm')).toBe(false)

      config.setTierEnabled('warm', true)
      expect(config.isTierEnabled('warm')).toBe(true)
    })

    it('should not allow disabling hot tier at runtime', () => {
      const config = new TierConfig()

      expect(() => config.setTierEnabled('hot', false)).toThrow(TierConfigError)
    })

    it('should allow updating promotion policy at runtime', () => {
      const config = new TierConfig({ promotionPolicy: 'none' })

      config.setPromotionPolicy('aggressive')
      expect(config.getPromotionPolicy()).toBe('aggressive')
    })

    it('should allow updating demotion thresholds at runtime', () => {
      const config = new TierConfig()

      config.updateDemotionThresholds({
        hotMaxAgeDays: 7,
        warmMaxAgeDays: 60,
      })

      const thresholds = config.getDemotionThresholds()
      expect(thresholds.hotMaxAgeDays).toBe(7)
      expect(thresholds.warmMaxAgeDays).toBe(60)
    })

    it('should emit events on configuration changes', () => {
      const config = new TierConfig()
      const changes: Array<{ field: string; oldValue: any; newValue: any }> = []

      config.on('configChange', (change) => {
        changes.push(change)
      })

      config.updateThresholds({ hotMaxSize: 2 * 1024 * 1024 })

      expect(changes).toHaveLength(1)
      expect(changes[0].field).toBe('thresholds.hotMaxSize')
      expect(changes[0].oldValue).toBe(1024 * 1024)
      expect(changes[0].newValue).toBe(2 * 1024 * 1024)
    })

    it('should support snapshotting and restoring configuration', () => {
      const config = new TierConfig({
        thresholds: { hotMaxSize: 512 * 1024 },
        warmEnabled: false,
      })

      const snapshot = config.snapshot()

      config.updateThresholds({ hotMaxSize: 2 * 1024 * 1024 })
      config.setTierEnabled('warm', true)

      config.restore(snapshot)

      expect(config.getThresholds().hotMaxSize).toBe(512 * 1024)
      expect(config.isTierEnabled('warm')).toBe(false)
    })
  })

  // ===========================================================================
  // 10. TierConfigBuilder
  // ===========================================================================
  describe('TierConfigBuilder', () => {
    it('should support fluent configuration building', () => {
      const config = new TierConfigBuilder()
        .withHotMaxSize(512 * 1024)
        .withWarmMaxSize(50 * 1024 * 1024)
        .withPromotionPolicy('aggressive')
        .withDemotionPolicy('none')
        .disableWarmTier()
        .build()

      expect(config.getThresholds().hotMaxSize).toBe(512 * 1024)
      expect(config.getThresholds().warmMaxSize).toBe(50 * 1024 * 1024)
      expect(config.getPromotionPolicy()).toBe('aggressive')
      expect(config.isDemotionEnabled()).toBe(false)
      expect(config.isTierEnabled('warm')).toBe(false)
    })

    it('should validate configuration on build', () => {
      expect(() => {
        new TierConfigBuilder().withHotMaxSize(-1000).build()
      }).toThrow(TierConfigError)
    })

    it('should allow chaining promotion threshold configuration', () => {
      const config = new TierConfigBuilder()
        .withPromotionPolicy('on-access')
        .withMinAccessCount(10)
        .withMaxAgeDaysForPromotion(7)
        .build()

      const thresholds = config.getPromotionThresholds()
      expect(thresholds.minAccessCount).toBe(10)
      expect(thresholds.maxAgeDays).toBe(7)
    })

    it('should allow chaining demotion threshold configuration', () => {
      const config = new TierConfigBuilder()
        .withHotMaxAgeDays(3)
        .withWarmMaxAgeDays(45)
        .build()

      const thresholds = config.getDemotionThresholds()
      expect(thresholds.hotMaxAgeDays).toBe(3)
      expect(thresholds.warmMaxAgeDays).toBe(45)
    })

    it('should create immutable configuration by default', () => {
      const config = new TierConfigBuilder().build()

      expect(() => config.updateThresholds({ hotMaxSize: 2 })).toThrow()
    })

    it('should allow creating mutable configuration', () => {
      const config = new TierConfigBuilder().mutable().build()

      expect(() => config.updateThresholds({ hotMaxSize: 2 * 1024 * 1024 })).not.toThrow()
    })
  })

  // ===========================================================================
  // 11. Serialization and Persistence
  // ===========================================================================
  describe('Serialization', () => {
    it('should serialize to JSON', () => {
      const config = new TierConfig({
        thresholds: { hotMaxSize: 512 * 1024 },
        promotionPolicy: 'aggressive',
      })

      const json = config.toJSON()
      expect(typeof json).toBe('string')

      const parsed = JSON.parse(json)
      expect(parsed.thresholds.hotMaxSize).toBe(512 * 1024)
      expect(parsed.promotionPolicy).toBe('aggressive')
    })

    it('should deserialize from JSON', () => {
      const json = JSON.stringify({
        thresholds: { hotMaxSize: 512 * 1024, warmMaxSize: 50 * 1024 * 1024 },
        promotionPolicy: 'none',
      })

      const config = TierConfig.fromJSON(json)

      expect(config.getThresholds().hotMaxSize).toBe(512 * 1024)
      expect(config.getPromotionPolicy()).toBe('none')
    })

    it('should validate JSON on deserialization', () => {
      const invalidJson = JSON.stringify({
        thresholds: { hotMaxSize: -1000 },
      })

      expect(() => TierConfig.fromJSON(invalidJson)).toThrow(TierConfigError)
    })

    it('should serialize to object', () => {
      const config = new TierConfig()
      const obj = config.toObject()

      expect(obj).toHaveProperty('thresholds')
      expect(obj).toHaveProperty('warmEnabled')
      expect(obj).toHaveProperty('coldEnabled')
      expect(obj).toHaveProperty('promotionPolicy')
    })
  })

  // ===========================================================================
  // 12. Integration with TieredFS
  // ===========================================================================
  describe('Integration', () => {
    it('should be compatible with TieredFS configuration', () => {
      // The TierConfig should produce configuration compatible with TieredFS
      const tierConfig = new TierConfig({
        thresholds: {
          hotMaxSize: 512 * 1024,
          warmMaxSize: 50 * 1024 * 1024,
        },
        promotionPolicy: 'on-access',
      })

      const tieredFsConfig = tierConfig.toTieredFSConfig()

      expect(tieredFsConfig.thresholds?.hotMaxSize).toBe(512 * 1024)
      expect(tieredFsConfig.thresholds?.warmMaxSize).toBe(50 * 1024 * 1024)
      expect(tieredFsConfig.promotionPolicy).toBe('on-access')
    })

    it('should be compatible with TieredR2Storage configuration', () => {
      const tierConfig = new TierConfig({
        demotionThresholds: {
          hotMaxAgeDays: 7,
          warmMaxAgeDays: 60,
        },
      })

      const r2Config = tierConfig.toTieredR2Config()

      expect(r2Config.policy?.hotMaxAgeDays).toBe(7)
      expect(r2Config.policy?.warmMaxAgeDays).toBe(60)
    })
  })
})
