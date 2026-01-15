/**
 * Pipeline Cost Calculator Tests
 *
 * TDD tests for `do cost` command that calculates Cloudflare Pipeline costs.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateCost,
  compareCosts,
  getRecommendation,
  PRICING,
  REGION_MULTIPLIERS,
  SUPPORTED_REGIONS,
  getRegionPricing,
} from '../commands/cost'
import type { CostInputs, CostBreakdown, Region } from '../commands/cost'

// ============================================================================
// PRICING Constants Tests
// ============================================================================

describe('PRICING constants', () => {
  it('has R2 storage pricing', () => {
    expect(PRICING.r2StoragePerGbMonth).toBe(0.015)
    expect(PRICING.r2InfrequentPerGbMonth).toBe(0.01)
  })

  it('has R2 operation pricing', () => {
    expect(PRICING.r2ClassAPerMillion).toBe(4.50)
    expect(PRICING.r2ClassBPerMillion).toBe(0.36)
  })

  it('has Pipeline pricing', () => {
    expect(PRICING.pipelinePerMillion).toBe(0.50)
    expect(PRICING.pipelinePerGbWritten).toBe(0.10)
  })

  it('has egress pricing', () => {
    expect(PRICING.egressPerGb).toBe(0.045)
  })
})

// ============================================================================
// calculateCost Tests
// ============================================================================

describe('calculateCost', () => {
  const baseInputs: CostInputs = {
    eventsPerDay: 1_000_000,
    avgEventSizeBytes: 500,
    queriesPerDay: 1000,
    retentionDays: 30,
  }

  describe('single pipeline mode', () => {
    it('calculates total cost greater than zero', () => {
      const result = calculateCost(baseInputs, 'single')

      expect(result.total).toBeGreaterThan(0)
    })

    it('calculates storage cost based on retention', () => {
      const result = calculateCost(baseInputs, 'single')

      expect(result.storage).toBeGreaterThan(0)
    })

    it('calculates pipeline operations cost', () => {
      const result = calculateCost(baseInputs, 'single')

      expect(result.pipelineOps).toBeGreaterThan(0)
    })

    it('calculates R2 write costs', () => {
      const result = calculateCost(baseInputs, 'single')

      expect(result.r2Writes).toBeGreaterThan(0)
    })

    it('calculates R2 read costs', () => {
      const result = calculateCost(baseInputs, 'single')

      expect(result.r2Reads).toBeGreaterThan(0)
    })

    it('total equals sum of all components', () => {
      const result = calculateCost(baseInputs, 'single')

      const expectedTotal = result.storage + result.pipelineOps + result.r2Writes + result.r2Reads + result.egress
      expect(result.total).toBeCloseTo(expectedTotal, 10)
    })
  })

  describe('multi pipeline mode', () => {
    it('has higher pipeline ops cost than single', () => {
      const single = calculateCost(baseInputs, 'single')
      const multi = calculateCost(baseInputs, 'multi')

      expect(multi.pipelineOps).toBeGreaterThan(single.pipelineOps)
    })

    it('pipeline cost scales with number of pipelines', () => {
      const single = calculateCost(baseInputs, 'single')
      const multi = calculateCost(baseInputs, 'multi')

      // Multi uses 4 pipelines, so should be ~4x the pipeline ops cost
      expect(multi.pipelineOps).toBeCloseTo(single.pipelineOps * 4, 2)
    })
  })

  describe('scaling behavior', () => {
    it('cost increases with more events per day', () => {
      const lowVolume = calculateCost({ ...baseInputs, eventsPerDay: 100_000 }, 'single')
      const highVolume = calculateCost({ ...baseInputs, eventsPerDay: 10_000_000 }, 'single')

      expect(highVolume.total).toBeGreaterThan(lowVolume.total)
    })

    it('cost increases with larger event sizes', () => {
      const smallEvents = calculateCost({ ...baseInputs, avgEventSizeBytes: 100 }, 'single')
      const largeEvents = calculateCost({ ...baseInputs, avgEventSizeBytes: 2000 }, 'single')

      expect(largeEvents.storage).toBeGreaterThan(smallEvents.storage)
    })

    it('cost increases with longer retention', () => {
      const shortRetention = calculateCost({ ...baseInputs, retentionDays: 7 }, 'single')
      const longRetention = calculateCost({ ...baseInputs, retentionDays: 90 }, 'single')

      expect(longRetention.storage).toBeGreaterThan(shortRetention.storage)
    })

    it('cost increases with more queries', () => {
      const fewQueries = calculateCost({ ...baseInputs, queriesPerDay: 100 }, 'single')
      const manyQueries = calculateCost({ ...baseInputs, queriesPerDay: 100_000 }, 'single')

      expect(manyQueries.r2Reads).toBeGreaterThan(fewQueries.r2Reads)
    })
  })

  describe('optional parameters', () => {
    it('handles infrequentAccessPercent', () => {
      const allStandard = calculateCost({ ...baseInputs, infrequentAccessPercent: 0 }, 'single')
      const allInfrequent = calculateCost({ ...baseInputs, infrequentAccessPercent: 1 }, 'single')

      // Infrequent access is cheaper
      expect(allInfrequent.storage).toBeLessThan(allStandard.storage)
    })

    it('handles typeSpecificQueryRatio', () => {
      // This parameter affects query efficiency in multi-pipeline mode
      const lowRatio = calculateCost({ ...baseInputs, typeSpecificQueryRatio: 0.1 }, 'multi')
      const highRatio = calculateCost({ ...baseInputs, typeSpecificQueryRatio: 0.9 }, 'multi')

      // Higher type-specific ratio means more efficient queries in multi-pipeline
      expect(lowRatio.total).toBeDefined()
      expect(highRatio.total).toBeDefined()
    })
  })
})

// ============================================================================
// compareCosts Tests
// ============================================================================

describe('compareCosts', () => {
  const baseInputs: CostInputs = {
    eventsPerDay: 1_000_000,
    avgEventSizeBytes: 500,
    queriesPerDay: 1000,
    retentionDays: 30,
  }

  it('returns single and multi cost breakdowns', () => {
    const result = compareCosts(baseInputs)

    expect(result.single).toBeDefined()
    expect(result.multi).toBeDefined()
    expect(result.single.total).toBeGreaterThan(0)
    expect(result.multi.total).toBeGreaterThan(0)
  })

  it('calculates savings percentage', () => {
    const result = compareCosts(baseInputs)

    expect(typeof result.savings).toBe('number')
    // Savings can be positive (single cheaper) or negative (multi cheaper)
    expect(result.savings).not.toBeNaN()
  })

  it('savings reflects cost difference', () => {
    const result = compareCosts(baseInputs)

    // Verify savings calculation: (single - multi) / single * 100
    const expectedSavings = ((result.single.total - result.multi.total) / result.single.total) * 100
    expect(result.savings).toBeCloseTo(expectedSavings, 5)
  })
})

// ============================================================================
// getRecommendation Tests
// ============================================================================

describe('getRecommendation', () => {
  it('recommends single for low volume', () => {
    expect(getRecommendation(100_000)).toBe('single')
    expect(getRecommendation(500_000)).toBe('single')
    expect(getRecommendation(999_999)).toBe('single')
  })

  it('recommends evaluate for medium volume', () => {
    expect(getRecommendation(1_000_000)).toBe('evaluate')
    expect(getRecommendation(5_000_000)).toBe('evaluate')
    expect(getRecommendation(10_000_000)).toBe('evaluate')
  })

  it('recommends multi for high volume', () => {
    expect(getRecommendation(10_000_001)).toBe('multi')
    expect(getRecommendation(50_000_000)).toBe('multi')
    expect(getRecommendation(100_000_000)).toBe('multi')
  })

  it('handles edge cases', () => {
    expect(getRecommendation(0)).toBe('single')
    expect(getRecommendation(1)).toBe('single')
  })
})

// ============================================================================
// CostBreakdown Type Tests
// ============================================================================

describe('CostBreakdown structure', () => {
  it('has all required fields', () => {
    const result = calculateCost({
      eventsPerDay: 1_000_000,
      avgEventSizeBytes: 500,
      queriesPerDay: 1000,
      retentionDays: 30,
    }, 'single')

    // Type check: all fields should exist
    const breakdown: CostBreakdown = result
    expect(typeof breakdown.storage).toBe('number')
    expect(typeof breakdown.pipelineOps).toBe('number')
    expect(typeof breakdown.r2Writes).toBe('number')
    expect(typeof breakdown.r2Reads).toBe('number')
    expect(typeof breakdown.egress).toBe('number')
    expect(typeof breakdown.total).toBe('number')
  })

  it('all values are non-negative', () => {
    const result = calculateCost({
      eventsPerDay: 1_000_000,
      avgEventSizeBytes: 500,
      queriesPerDay: 1000,
      retentionDays: 30,
    }, 'single')

    expect(result.storage).toBeGreaterThanOrEqual(0)
    expect(result.pipelineOps).toBeGreaterThanOrEqual(0)
    expect(result.r2Writes).toBeGreaterThanOrEqual(0)
    expect(result.r2Reads).toBeGreaterThanOrEqual(0)
    expect(result.egress).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Realistic Scenario Tests
// ============================================================================

describe('Realistic scenarios', () => {
  it('calculates cost for startup (100k events/day)', () => {
    const result = calculateCost({
      eventsPerDay: 100_000,
      avgEventSizeBytes: 256,
      queriesPerDay: 500,
      retentionDays: 30,
    }, 'single')

    // Should be relatively affordable
    expect(result.total).toBeLessThan(100) // Less than $100/month
  })

  it('calculates cost for scale-up (10M events/day)', () => {
    const result = calculateCost({
      eventsPerDay: 10_000_000,
      avgEventSizeBytes: 512,
      queriesPerDay: 10_000,
      retentionDays: 90,
    }, 'single')

    expect(result.total).toBeGreaterThan(100) // More than $100/month
  })

  it('calculates cost for enterprise (100M events/day)', () => {
    const single = calculateCost({
      eventsPerDay: 100_000_000,
      avgEventSizeBytes: 1024,
      queriesPerDay: 100_000,
      retentionDays: 365,
    }, 'single')

    const multi = calculateCost({
      eventsPerDay: 100_000_000,
      avgEventSizeBytes: 1024,
      queriesPerDay: 100_000,
      retentionDays: 365,
    }, 'multi')

    // Both should have significant costs
    expect(single.total).toBeGreaterThan(1000)
    expect(multi.total).toBeGreaterThan(1000)
  })
})

// ============================================================================
// Region Support Tests
// ============================================================================

describe('Region Support', () => {
  const baseInputs: CostInputs = {
    eventsPerDay: 1_000_000,
    avgEventSizeBytes: 500,
    queriesPerDay: 1000,
    retentionDays: 30,
  }

  describe('SUPPORTED_REGIONS', () => {
    it('exports list of supported regions', () => {
      expect(SUPPORTED_REGIONS).toBeDefined()
      expect(Array.isArray(SUPPORTED_REGIONS)).toBe(true)
      expect(SUPPORTED_REGIONS.length).toBeGreaterThan(0)
    })

    it('includes major cloud regions', () => {
      expect(SUPPORTED_REGIONS).toContain('us-east')
      expect(SUPPORTED_REGIONS).toContain('us-west')
      expect(SUPPORTED_REGIONS).toContain('eu-west')
      expect(SUPPORTED_REGIONS).toContain('ap-southeast')
    })

    it('has a default region', () => {
      expect(SUPPORTED_REGIONS).toContain('global')
    })
  })

  describe('REGION_MULTIPLIERS', () => {
    it('exports region pricing multipliers', () => {
      expect(REGION_MULTIPLIERS).toBeDefined()
      expect(typeof REGION_MULTIPLIERS).toBe('object')
    })

    it('has multiplier for each supported region', () => {
      for (const region of SUPPORTED_REGIONS) {
        expect(REGION_MULTIPLIERS[region as Region]).toBeDefined()
        expect(typeof REGION_MULTIPLIERS[region as Region]).toBe('number')
      }
    })

    it('global region has multiplier of 1.0 (baseline)', () => {
      expect(REGION_MULTIPLIERS['global']).toBe(1.0)
    })

    it('EU regions have higher multipliers (data sovereignty costs)', () => {
      expect(REGION_MULTIPLIERS['eu-west']).toBeGreaterThan(1.0)
      expect(REGION_MULTIPLIERS['eu-central']).toBeGreaterThan(1.0)
    })

    it('APAC regions have varying multipliers', () => {
      expect(REGION_MULTIPLIERS['ap-southeast']).toBeGreaterThan(0)
      expect(REGION_MULTIPLIERS['ap-northeast']).toBeGreaterThan(0)
    })
  })

  describe('getRegionPricing', () => {
    it('returns base pricing for global region', () => {
      const pricing = getRegionPricing('global')

      expect(pricing.r2StoragePerGbMonth).toBe(PRICING.r2StoragePerGbMonth)
      expect(pricing.pipelinePerMillion).toBe(PRICING.pipelinePerMillion)
    })

    it('applies multiplier for non-global regions', () => {
      const euPricing = getRegionPricing('eu-west')
      const multiplier = REGION_MULTIPLIERS['eu-west']

      expect(euPricing.r2StoragePerGbMonth).toBeCloseTo(PRICING.r2StoragePerGbMonth * multiplier, 6)
      expect(euPricing.pipelinePerMillion).toBeCloseTo(PRICING.pipelinePerMillion * multiplier, 6)
    })

    it('returns adjusted egress pricing for regions', () => {
      const apacPricing = getRegionPricing('ap-southeast')
      const multiplier = REGION_MULTIPLIERS['ap-southeast']

      expect(apacPricing.egressPerGb).toBeCloseTo(PRICING.egressPerGb * multiplier, 6)
    })

    it('throws error for invalid region', () => {
      expect(() => getRegionPricing('invalid-region' as Region)).toThrow(/invalid region/i)
    })
  })

  describe('calculateCost with region', () => {
    it('accepts optional region parameter', () => {
      const result = calculateCost({ ...baseInputs, region: 'us-east' }, 'single')

      expect(result.total).toBeGreaterThan(0)
    })

    it('defaults to global region when not specified', () => {
      const withRegion = calculateCost({ ...baseInputs, region: 'global' }, 'single')
      const withoutRegion = calculateCost(baseInputs, 'single')

      expect(withRegion.total).toBeCloseTo(withoutRegion.total, 6)
    })

    it('EU region costs more than US region', () => {
      const usResult = calculateCost({ ...baseInputs, region: 'us-east' }, 'single')
      const euResult = calculateCost({ ...baseInputs, region: 'eu-west' }, 'single')

      expect(euResult.total).toBeGreaterThan(usResult.total)
    })

    it('APAC region has different cost than US', () => {
      const usResult = calculateCost({ ...baseInputs, region: 'us-west' }, 'single')
      const apacResult = calculateCost({ ...baseInputs, region: 'ap-southeast' }, 'single')

      // Costs should differ based on region multiplier
      expect(apacResult.total).not.toBeCloseTo(usResult.total, 2)
    })

    it('region affects all cost components', () => {
      const globalResult = calculateCost({ ...baseInputs, region: 'global' }, 'single')
      const euResult = calculateCost({ ...baseInputs, region: 'eu-central' }, 'single')

      // Each component should be affected by regional pricing
      expect(euResult.storage).toBeGreaterThan(globalResult.storage)
      expect(euResult.pipelineOps).toBeGreaterThan(globalResult.pipelineOps)
      expect(euResult.r2Writes).toBeGreaterThan(globalResult.r2Writes)
      expect(euResult.r2Reads).toBeGreaterThan(globalResult.r2Reads)
    })
  })

  describe('compareCosts with region', () => {
    it('accepts region parameter', () => {
      const result = compareCosts({ ...baseInputs, region: 'eu-west' })

      expect(result.single).toBeDefined()
      expect(result.multi).toBeDefined()
    })

    it('comparison reflects regional pricing', () => {
      const globalComparison = compareCosts({ ...baseInputs, region: 'global' })
      const euComparison = compareCosts({ ...baseInputs, region: 'eu-west' })

      // EU costs should be higher for both modes
      expect(euComparison.single.total).toBeGreaterThan(globalComparison.single.total)
      expect(euComparison.multi.total).toBeGreaterThan(globalComparison.multi.total)
    })
  })
})

// ============================================================================
// CLI Argument Tests
// ============================================================================

describe('CLI Arguments', () => {
  // These tests verify the CLI accepts the expected arguments
  // The actual command execution is tested via integration tests

  describe('region flag', () => {
    it('--region flag is documented in command options', async () => {
      const { costCommand } = await import('../commands/cost')

      // Check that analyze subcommand has --region option
      const analyzeCmd = costCommand.commands.find((c: { name: () => string }) => c.name() === 'analyze')
      expect(analyzeCmd).toBeDefined()

      const regionOption = analyzeCmd?.options.find((o: { long: string }) => o.long === '--region')
      expect(regionOption).toBeDefined()
    })

    it('compare subcommand accepts --region flag', async () => {
      const { costCommand } = await import('../commands/cost')

      const compareCmd = costCommand.commands.find((c: { name: () => string }) => c.name() === 'compare')
      expect(compareCmd).toBeDefined()

      const regionOption = compareCmd?.options.find((o: { long: string }) => o.long === '--region')
      expect(regionOption).toBeDefined()
    })
  })
})
