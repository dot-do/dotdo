import { describe, it, expect } from 'vitest'
import {
  calculateHybridPrice,
  calculateOutcomeFees,
  calculateOverageFees,
  calculateBonusCredits,
  type HybridUsage,
  type HybridBill,
  type MetricThreshold,
} from '../hybrid'
import type { HybridPricing } from '../types'

// ============================================================================
// Test Data Fixtures
// ============================================================================

const basicHybridConfig: HybridPricing = {
  model: 'hybrid',
  base: 500,
}

const fullHybridConfig: HybridPricing = {
  model: 'hybrid',
  base: 500,
  outcomes: {
    TicketResolved: 0.50,
    LeadQualified: 2.00,
    OrderPlaced: 1.50,
  },
  overage: {
    included: 10000,
    perUnit: 0.75,
    unit: 'apiCall',
  },
  bonus: {
    credits: 100,
    description: 'CSAT bonus',
  },
}

// ============================================================================
// calculateHybridPrice Tests
// ============================================================================

describe('calculateHybridPrice', () => {
  describe('base subscription only', () => {
    it('should return base price with no usage', () => {
      const result = calculateHybridPrice(basicHybridConfig, {})

      expect(result.base).toBe(500)
      expect(result.total).toBe(500)
    })

    it('should return base price when no outcomes or overage', () => {
      const result = calculateHybridPrice(basicHybridConfig, {
        outcomes: { SomeOutcome: 100 },
      })

      // No outcome pricing defined, so outcomes are ignored
      expect(result.base).toBe(500)
      expect(result.outcomesFee).toBe(0)
      expect(result.total).toBe(500)
    })
  })

  describe('base + outcomes pricing', () => {
    const configWithOutcomes: HybridPricing = {
      model: 'hybrid',
      base: 500,
      outcomes: {
        TicketResolved: 0.50,
        LeadQualified: 2.00,
      },
    }

    it('should calculate outcome fees correctly', () => {
      const result = calculateHybridPrice(configWithOutcomes, {
        outcomes: {
          TicketResolved: 100,
          LeadQualified: 50,
        },
      })

      // 100 * 0.50 + 50 * 2.00 = 50 + 100 = 150
      expect(result.base).toBe(500)
      expect(result.outcomesFee).toBe(150)
      expect(result.total).toBe(650)
    })

    it('should handle zero outcomes', () => {
      const result = calculateHybridPrice(configWithOutcomes, {
        outcomes: {
          TicketResolved: 0,
          LeadQualified: 0,
        },
      })

      expect(result.outcomesFee).toBe(0)
      expect(result.total).toBe(500)
    })

    it('should ignore outcomes not defined in pricing', () => {
      const result = calculateHybridPrice(configWithOutcomes, {
        outcomes: {
          TicketResolved: 10,
          UnknownOutcome: 1000, // Not in pricing config
        },
      })

      // Only TicketResolved is charged: 10 * 0.50 = 5
      expect(result.outcomesFee).toBe(5)
      expect(result.total).toBe(505)
    })
  })

  describe('base + overage pricing', () => {
    const configWithOverage: HybridPricing = {
      model: 'hybrid',
      base: 500,
      overage: {
        included: 10000,
        perUnit: 0.75,
        unit: 'apiCall',
      },
    }

    it('should not charge overage within included units', () => {
      const result = calculateHybridPrice(configWithOverage, {
        usage: { apiCall: 5000 },
      })

      expect(result.base).toBe(500)
      expect(result.overageFee).toBe(0)
      expect(result.total).toBe(500)
    })

    it('should not charge overage at exactly included units', () => {
      const result = calculateHybridPrice(configWithOverage, {
        usage: { apiCall: 10000 },
      })

      expect(result.overageFee).toBe(0)
      expect(result.total).toBe(500)
    })

    it('should charge overage for units above included', () => {
      const result = calculateHybridPrice(configWithOverage, {
        usage: { apiCall: 15000 },
      })

      // 15000 - 10000 = 5000 overage units * 0.75 = 3750
      expect(result.overageFee).toBe(3750)
      expect(result.total).toBe(4250)
    })

    it('should handle missing usage data', () => {
      const result = calculateHybridPrice(configWithOverage, {})

      expect(result.overageFee).toBe(0)
      expect(result.total).toBe(500)
    })
  })

  describe('base + bonus credits', () => {
    const configWithBonus: HybridPricing = {
      model: 'hybrid',
      base: 500,
      bonus: {
        credits: 100,
        description: 'Performance bonus',
      },
    }

    it('should include bonus credits without metrics', () => {
      const result = calculateHybridPrice(configWithBonus, {})

      // Bonus credits are always included when defined
      expect(result.bonusCredits).toBe(100)
      expect(result.total).toBe(500) // Bonus credits don't reduce total
    })
  })

  describe('full hybrid pricing', () => {
    it('should calculate combined pricing correctly', () => {
      const result = calculateHybridPrice(fullHybridConfig, {
        outcomes: {
          TicketResolved: 200, // 200 * 0.50 = 100
          LeadQualified: 25, // 25 * 2.00 = 50
          OrderPlaced: 40, // 40 * 1.50 = 60
        },
        usage: {
          apiCall: 12000, // 2000 overage * 0.75 = 1500
        },
      })

      expect(result.base).toBe(500)
      expect(result.outcomesFee).toBe(210) // 100 + 50 + 60
      expect(result.overageFee).toBe(1500)
      expect(result.bonusCredits).toBe(100)
      expect(result.total).toBe(2210) // 500 + 210 + 1500
    })

    it('should return itemized breakdown', () => {
      const result = calculateHybridPrice(fullHybridConfig, {
        outcomes: { TicketResolved: 10 },
        usage: { apiCall: 11000 },
      })

      expect(result).toMatchObject({
        base: 500,
        outcomesFee: 5, // 10 * 0.50
        overageFee: 750, // 1000 * 0.75
        bonusCredits: 100,
        total: 1255,
      })
    })
  })
})

// ============================================================================
// calculateOutcomeFees Tests
// ============================================================================

describe('calculateOutcomeFees', () => {
  const outcomePrices: Record<string, number> = {
    TicketResolved: 0.50,
    LeadQualified: 2.00,
  }

  it('should calculate fees for all outcomes', () => {
    const fees = calculateOutcomeFees(outcomePrices, {
      TicketResolved: 100,
      LeadQualified: 50,
    })

    expect(fees).toBe(150)
  })

  it('should return 0 for empty outcomes', () => {
    const fees = calculateOutcomeFees(outcomePrices, {})

    expect(fees).toBe(0)
  })

  it('should handle undefined outcome counts', () => {
    const fees = calculateOutcomeFees(outcomePrices, undefined)

    expect(fees).toBe(0)
  })

  it('should ignore unknown outcome types', () => {
    const fees = calculateOutcomeFees(outcomePrices, {
      TicketResolved: 10,
      UnknownType: 1000,
    })

    expect(fees).toBe(5) // Only TicketResolved counted
  })

  it('should handle fractional outcomes', () => {
    const fees = calculateOutcomeFees(outcomePrices, {
      TicketResolved: 1.5,
    })

    expect(fees).toBe(0.75)
  })
})

// ============================================================================
// calculateOverageFees Tests
// ============================================================================

describe('calculateOverageFees', () => {
  const overage = {
    included: 10000,
    perUnit: 0.75,
    unit: 'apiCall',
  }

  it('should return 0 when usage is below included', () => {
    const fee = calculateOverageFees(overage, { apiCall: 5000 })

    expect(fee).toBe(0)
  })

  it('should return 0 when usage equals included', () => {
    const fee = calculateOverageFees(overage, { apiCall: 10000 })

    expect(fee).toBe(0)
  })

  it('should charge for units over included', () => {
    const fee = calculateOverageFees(overage, { apiCall: 15000 })

    expect(fee).toBe(3750) // 5000 * 0.75
  })

  it('should return 0 for missing usage data', () => {
    const fee = calculateOverageFees(overage, {})

    expect(fee).toBe(0)
  })

  it('should return 0 for undefined usage', () => {
    const fee = calculateOverageFees(overage, undefined)

    expect(fee).toBe(0)
  })

  it('should handle large overage amounts', () => {
    const fee = calculateOverageFees(overage, { apiCall: 1_000_000 })

    // (1000000 - 10000) * 0.75 = 742500
    expect(fee).toBe(742500)
  })
})

// ============================================================================
// calculateBonusCredits Tests
// ============================================================================

describe('calculateBonusCredits', () => {
  it('should return bonus credits when no threshold defined', () => {
    const bonus = { credits: 100, description: 'Base bonus' }
    const result = calculateBonusCredits(bonus, {})

    expect(result).toBe(100)
  })

  it('should return bonus credits when metric exceeds threshold', () => {
    const bonus = { credits: 100, description: 'CSAT bonus' }
    const threshold: MetricThreshold = {
      metric: 'CSAT',
      threshold: 0.95,
    }
    const metrics = { CSAT: 0.98 }

    const result = calculateBonusCredits(bonus, metrics, threshold)

    expect(result).toBe(100)
  })

  it('should return 0 when metric below threshold', () => {
    const bonus = { credits: 100, description: 'CSAT bonus' }
    const threshold: MetricThreshold = {
      metric: 'CSAT',
      threshold: 0.95,
    }
    const metrics = { CSAT: 0.90 }

    const result = calculateBonusCredits(bonus, metrics, threshold)

    expect(result).toBe(0)
  })

  it('should return bonus credits when metric equals threshold', () => {
    const bonus = { credits: 100, description: 'CSAT bonus' }
    const threshold: MetricThreshold = {
      metric: 'CSAT',
      threshold: 0.95,
    }
    const metrics = { CSAT: 0.95 }

    const result = calculateBonusCredits(bonus, metrics, threshold)

    expect(result).toBe(100)
  })

  it('should return 0 when metric data missing', () => {
    const bonus = { credits: 100, description: 'CSAT bonus' }
    const threshold: MetricThreshold = {
      metric: 'CSAT',
      threshold: 0.95,
    }

    const result = calculateBonusCredits(bonus, {}, threshold)

    expect(result).toBe(0)
  })

  it('should return 0 for undefined bonus', () => {
    const result = calculateBonusCredits(undefined, {})

    expect(result).toBe(0)
  })
})

// ============================================================================
// Type Structure Tests
// ============================================================================

describe('HybridBill structure', () => {
  it('should have all required fields', () => {
    const result = calculateHybridPrice(fullHybridConfig, {
      outcomes: { TicketResolved: 10 },
      usage: { apiCall: 11000 },
    })

    expect(result).toHaveProperty('base')
    expect(result).toHaveProperty('outcomesFee')
    expect(result).toHaveProperty('overageFee')
    expect(result).toHaveProperty('bonusCredits')
    expect(result).toHaveProperty('total')
  })

  it('should have optional breakdown details', () => {
    const result = calculateHybridPrice(fullHybridConfig, {
      outcomes: { TicketResolved: 10, LeadQualified: 5 },
      usage: { apiCall: 11000 },
    })

    // Breakdown should show individual outcome fees
    expect(result.outcomeBreakdown).toBeDefined()
    expect(result.outcomeBreakdown?.TicketResolved).toBe(5) // 10 * 0.50
    expect(result.outcomeBreakdown?.LeadQualified).toBe(10) // 5 * 2.00
  })

  it('should include overage details', () => {
    const result = calculateHybridPrice(fullHybridConfig, {
      usage: { apiCall: 15000 },
    })

    expect(result.overageDetails).toBeDefined()
    expect(result.overageDetails?.unit).toBe('apiCall')
    expect(result.overageDetails?.included).toBe(10000)
    expect(result.overageDetails?.used).toBe(15000)
    expect(result.overageDetails?.overage).toBe(5000)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('should handle negative usage gracefully', () => {
    const result = calculateHybridPrice(fullHybridConfig, {
      usage: { apiCall: -100 },
    })

    expect(result.overageFee).toBe(0)
    expect(result.total).toBe(500)
  })

  it('should handle very large outcome counts', () => {
    const result = calculateHybridPrice(fullHybridConfig, {
      outcomes: { TicketResolved: 1_000_000 },
    })

    expect(result.outcomesFee).toBe(500000) // 1M * 0.50
    expect(result.total).toBe(500500)
  })

  it('should handle zero base price', () => {
    const zeroBaseConfig: HybridPricing = {
      model: 'hybrid',
      base: 0,
      outcomes: { TicketResolved: 1.00 },
    }

    const result = calculateHybridPrice(zeroBaseConfig, {
      outcomes: { TicketResolved: 100 },
    })

    expect(result.base).toBe(0)
    expect(result.outcomesFee).toBe(100)
    expect(result.total).toBe(100)
  })

  it('should handle decimal precision correctly', () => {
    const config: HybridPricing = {
      model: 'hybrid',
      base: 99.99,
      outcomes: { Action: 0.001 },
    }

    const result = calculateHybridPrice(config, {
      outcomes: { Action: 333 },
    })

    // 99.99 + (333 * 0.001) = 99.99 + 0.333 = 100.323
    expect(result.total).toBeCloseTo(100.323, 3)
  })
})
