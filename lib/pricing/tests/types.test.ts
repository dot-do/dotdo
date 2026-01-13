import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  PricingModel,
  OutcomePricing,
  ActivityPricing,
  SeatPricing,
  CreditPricing,
  HybridPricing,
  SeatOverflowBehavior,
  CreditTopUp,
  PricingConfig,
} from '../types'

// ============================================================================
// PricingModel Union Type Tests
// ============================================================================

describe('PricingModel', () => {
  it('should support outcome pricing model', () => {
    const model: PricingModel = 'outcome'
    expect(model).toBe('outcome')
  })

  it('should support activity pricing model', () => {
    const model: PricingModel = 'activity'
    expect(model).toBe('activity')
  })

  it('should support seat pricing model', () => {
    const model: PricingModel = 'seat'
    expect(model).toBe('seat')
  })

  it('should support credit pricing model', () => {
    const model: PricingModel = 'credit'
    expect(model).toBe('credit')
  })

  it('should support hybrid pricing model', () => {
    const model: PricingModel = 'hybrid'
    expect(model).toBe('hybrid')
  })
})

// ============================================================================
// OutcomePricing Tests
// ============================================================================

describe('OutcomePricing', () => {
  it('should have outcomes map (string -> number)', () => {
    const pricing: OutcomePricing = {
      model: 'outcome',
      outcomes: {
        TicketResolved: 0.99,
        LeadQualified: 5.0,
        OrderPlaced: 2.5,
      },
    }

    expect(pricing.model).toBe('outcome')
    expect(pricing.outcomes.TicketResolved).toBe(0.99)
    expect(pricing.outcomes.LeadQualified).toBe(5.0)
    expect(pricing.outcomes.OrderPlaced).toBe(2.5)
  })

  it('should support optional description per outcome', () => {
    const pricing: OutcomePricing = {
      model: 'outcome',
      outcomes: {
        TicketResolved: 0.99,
      },
      descriptions: {
        TicketResolved: 'Customer support ticket resolved to satisfaction',
      },
    }

    expect(pricing.descriptions?.TicketResolved).toBe(
      'Customer support ticket resolved to satisfaction'
    )
  })

  it('should support minimum charge', () => {
    const pricing: OutcomePricing = {
      model: 'outcome',
      outcomes: {
        TicketResolved: 0.99,
      },
      minimumCharge: 50,
    }

    expect(pricing.minimumCharge).toBe(50)
  })
})

// ============================================================================
// ActivityPricing Tests
// ============================================================================

describe('ActivityPricing', () => {
  it('should have activities map (string -> number)', () => {
    const pricing: ActivityPricing = {
      model: 'activity',
      activities: {
        apiCall: 0.001,
        messageProcessed: 0.01,
        fileUploaded: 0.05,
      },
    }

    expect(pricing.model).toBe('activity')
    expect(pricing.activities.apiCall).toBe(0.001)
    expect(pricing.activities.messageProcessed).toBe(0.01)
  })

  it('should support rate limits per activity', () => {
    const pricing: ActivityPricing = {
      model: 'activity',
      activities: {
        apiCall: 0.001,
      },
      rateLimits: {
        apiCall: { perMinute: 1000, perDay: 100000 },
      },
    }

    expect(pricing.rateLimits?.apiCall.perMinute).toBe(1000)
    expect(pricing.rateLimits?.apiCall.perDay).toBe(100000)
  })
})

// ============================================================================
// SeatPricing Tests
// ============================================================================

describe('SeatPricing', () => {
  it('should have agents.count and agents.price', () => {
    const pricing: SeatPricing = {
      model: 'seat',
      agents: { count: 5, price: 500 },
      humans: { count: 2, price: 2000 },
    }

    expect(pricing.agents.count).toBe(5)
    expect(pricing.agents.price).toBe(500)
  })

  it('should have humans.count and humans.price', () => {
    const pricing: SeatPricing = {
      model: 'seat',
      agents: { count: 5, price: 500 },
      humans: { count: 2, price: 2000 },
    }

    expect(pricing.humans.count).toBe(2)
    expect(pricing.humans.price).toBe(2000)
  })

  it('should have overflow behavior: queue', () => {
    const pricing: SeatPricing = {
      model: 'seat',
      agents: { count: 5, price: 500 },
      humans: { count: 2, price: 2000 },
      overflow: 'queue',
    }

    expect(pricing.overflow).toBe('queue')
  })

  it('should have overflow behavior: reject', () => {
    const pricing: SeatPricing = {
      model: 'seat',
      agents: { count: 5, price: 500 },
      humans: { count: 2, price: 2000 },
      overflow: 'reject',
    }

    expect(pricing.overflow).toBe('reject')
  })

  it('should have overflow behavior: burst-pricing', () => {
    const pricing: SeatPricing = {
      model: 'seat',
      agents: { count: 5, price: 500 },
      humans: { count: 2, price: 2000 },
      overflow: 'burst-pricing',
    }

    expect(pricing.overflow).toBe('burst-pricing')
  })

  it('should support burst pricing multiplier', () => {
    const pricing: SeatPricing = {
      model: 'seat',
      agents: { count: 5, price: 500 },
      humans: { count: 2, price: 2000 },
      overflow: 'burst-pricing',
      burstMultiplier: 1.5,
    }

    expect(pricing.burstMultiplier).toBe(1.5)
  })
})

// ============================================================================
// CreditPricing Tests
// ============================================================================

describe('CreditPricing', () => {
  it('should have price (cost per credit bundle)', () => {
    const pricing: CreditPricing = {
      model: 'credit',
      price: 100,
      amount: 1000,
    }

    expect(pricing.price).toBe(100)
  })

  it('should have amount (credits per bundle)', () => {
    const pricing: CreditPricing = {
      model: 'credit',
      price: 100,
      amount: 1000,
    }

    expect(pricing.amount).toBe(1000)
  })

  it('should have expiration (days or null for no expiry)', () => {
    const pricing: CreditPricing = {
      model: 'credit',
      price: 100,
      amount: 1000,
      expiration: 365,
    }

    expect(pricing.expiration).toBe(365)
  })

  it('should support no expiration', () => {
    const pricing: CreditPricing = {
      model: 'credit',
      price: 100,
      amount: 1000,
      expiration: null,
    }

    expect(pricing.expiration).toBeNull()
  })

  it('should have topUp configuration', () => {
    const pricing: CreditPricing = {
      model: 'credit',
      price: 100,
      amount: 1000,
      topUp: {
        enabled: true,
        threshold: 100,
        amount: 500,
      },
    }

    expect(pricing.topUp?.enabled).toBe(true)
    expect(pricing.topUp?.threshold).toBe(100)
    expect(pricing.topUp?.amount).toBe(500)
  })

  it('should support rollover option', () => {
    const pricing: CreditPricing = {
      model: 'credit',
      price: 100,
      amount: 1000,
      rollover: true,
    }

    expect(pricing.rollover).toBe(true)
  })
})

// ============================================================================
// HybridPricing Tests
// ============================================================================

describe('HybridPricing', () => {
  it('should have base subscription price', () => {
    const pricing: HybridPricing = {
      model: 'hybrid',
      base: 99,
    }

    expect(pricing.base).toBe(99)
  })

  it('should combine base with outcomes', () => {
    const pricing: HybridPricing = {
      model: 'hybrid',
      base: 99,
      outcomes: {
        TicketResolved: 0.5,
        LeadQualified: 2.0,
      },
    }

    expect(pricing.base).toBe(99)
    expect(pricing.outcomes?.TicketResolved).toBe(0.5)
    expect(pricing.outcomes?.LeadQualified).toBe(2.0)
  })

  it('should support overage pricing', () => {
    const pricing: HybridPricing = {
      model: 'hybrid',
      base: 99,
      overage: {
        included: 1000,
        perUnit: 0.01,
        unit: 'message',
      },
    }

    expect(pricing.overage?.included).toBe(1000)
    expect(pricing.overage?.perUnit).toBe(0.01)
    expect(pricing.overage?.unit).toBe('message')
  })

  it('should support bonus credits', () => {
    const pricing: HybridPricing = {
      model: 'hybrid',
      base: 99,
      bonus: {
        credits: 500,
        description: 'Monthly bonus credits',
      },
    }

    expect(pricing.bonus?.credits).toBe(500)
    expect(pricing.bonus?.description).toBe('Monthly bonus credits')
  })

  it('should support all hybrid components together', () => {
    const pricing: HybridPricing = {
      model: 'hybrid',
      base: 199,
      outcomes: {
        TicketResolved: 0.25,
      },
      overage: {
        included: 5000,
        perUnit: 0.005,
        unit: 'apiCall',
      },
      bonus: {
        credits: 1000,
        description: 'Premium tier bonus',
      },
    }

    expect(pricing.model).toBe('hybrid')
    expect(pricing.base).toBe(199)
    expect(pricing.outcomes?.TicketResolved).toBe(0.25)
    expect(pricing.overage?.included).toBe(5000)
    expect(pricing.bonus?.credits).toBe(1000)
  })
})

// ============================================================================
// PricingConfig Union Type Tests
// ============================================================================

describe('PricingConfig', () => {
  it('should accept OutcomePricing', () => {
    const config: PricingConfig = {
      model: 'outcome',
      outcomes: { TicketResolved: 0.99 },
    }

    expect(config.model).toBe('outcome')
  })

  it('should accept ActivityPricing', () => {
    const config: PricingConfig = {
      model: 'activity',
      activities: { apiCall: 0.001 },
    }

    expect(config.model).toBe('activity')
  })

  it('should accept SeatPricing', () => {
    const config: PricingConfig = {
      model: 'seat',
      agents: { count: 5, price: 500 },
      humans: { count: 2, price: 2000 },
    }

    expect(config.model).toBe('seat')
  })

  it('should accept CreditPricing', () => {
    const config: PricingConfig = {
      model: 'credit',
      price: 100,
      amount: 1000,
    }

    expect(config.model).toBe('credit')
  })

  it('should accept HybridPricing', () => {
    const config: PricingConfig = {
      model: 'hybrid',
      base: 99,
    }

    expect(config.model).toBe('hybrid')
  })
})

// ============================================================================
// Type-Level Tests (compile-time checks)
// ============================================================================

describe('Type-Level Checks', () => {
  it('should have correct type structure for OutcomePricing', () => {
    expectTypeOf<OutcomePricing>().toHaveProperty('model')
    expectTypeOf<OutcomePricing>().toHaveProperty('outcomes')
  })

  it('should have correct type structure for SeatPricing', () => {
    expectTypeOf<SeatPricing>().toHaveProperty('model')
    expectTypeOf<SeatPricing>().toHaveProperty('agents')
    expectTypeOf<SeatPricing>().toHaveProperty('humans')
  })

  it('should have correct type structure for CreditPricing', () => {
    expectTypeOf<CreditPricing>().toHaveProperty('model')
    expectTypeOf<CreditPricing>().toHaveProperty('price')
    expectTypeOf<CreditPricing>().toHaveProperty('amount')
  })

  it('should have correct type structure for HybridPricing', () => {
    expectTypeOf<HybridPricing>().toHaveProperty('model')
    expectTypeOf<HybridPricing>().toHaveProperty('base')
  })

  it('should enforce overflow as union of queue | reject | burst-pricing', () => {
    expectTypeOf<SeatOverflowBehavior>().toEqualTypeOf<'queue' | 'reject' | 'burst-pricing'>()
  })
})
