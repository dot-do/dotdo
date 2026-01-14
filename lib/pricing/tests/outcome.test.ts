import { describe, it, expect, beforeEach } from 'vitest'
import type { OutcomePricing } from '../types'
import {
  OutcomeTracker,
  createOutcomeTracker,
  calculateOutcomeCost,
  type OutcomeEvent,
  type OutcomeSummary,
  type BillingSignal,
} from '../outcome'

// ============================================================================
// OutcomeTracker Tests
// ============================================================================

describe('OutcomeTracker', () => {
  const pricingConfig: OutcomePricing = {
    model: 'outcome',
    outcomes: {
      TicketResolved: 0.99,
      LeadQualified: 5.0,
      ContentDelivered: 25.0,
    },
  }

  let tracker: OutcomeTracker

  beforeEach(() => {
    tracker = createOutcomeTracker(pricingConfig)
  })

  describe('recordOutcome', () => {
    it('should record a single outcome event', () => {
      const event = tracker.recordOutcome('TicketResolved')

      expect(event.outcome).toBe('TicketResolved')
      expect(event.price).toBe(0.99)
      expect(event.timestamp).toBeInstanceOf(Date)
    })

    it('should record outcome with custom metadata', () => {
      const event = tracker.recordOutcome('LeadQualified', {
        leadId: 'lead-123',
        source: 'website',
      })

      expect(event.outcome).toBe('LeadQualified')
      expect(event.price).toBe(5.0)
      expect(event.metadata?.leadId).toBe('lead-123')
      expect(event.metadata?.source).toBe('website')
    })

    it('should throw for unknown outcome type', () => {
      expect(() => tracker.recordOutcome('UnknownOutcome')).toThrow(
        'Unknown outcome type: UnknownOutcome'
      )
    })

    it('should record multiple outcomes of same type', () => {
      tracker.recordOutcome('TicketResolved')
      tracker.recordOutcome('TicketResolved')
      tracker.recordOutcome('TicketResolved')

      const summary = tracker.getSummary()
      expect(summary.counts.TicketResolved).toBe(3)
    })

    it('should record multiple outcomes of different types', () => {
      tracker.recordOutcome('TicketResolved')
      tracker.recordOutcome('LeadQualified')
      tracker.recordOutcome('ContentDelivered')

      const summary = tracker.getSummary()
      expect(summary.counts.TicketResolved).toBe(1)
      expect(summary.counts.LeadQualified).toBe(1)
      expect(summary.counts.ContentDelivered).toBe(1)
    })
  })

  describe('getSummary', () => {
    it('should return empty summary when no outcomes recorded', () => {
      const summary = tracker.getSummary()

      expect(summary.totalCost).toBe(0)
      expect(summary.totalOutcomes).toBe(0)
      expect(Object.keys(summary.counts)).toHaveLength(0)
    })

    it('should calculate total cost correctly', () => {
      tracker.recordOutcome('TicketResolved') // 0.99
      tracker.recordOutcome('TicketResolved') // 0.99
      tracker.recordOutcome('LeadQualified') // 5.00

      const summary = tracker.getSummary()
      expect(summary.totalCost).toBeCloseTo(6.98, 2)
      expect(summary.totalOutcomes).toBe(3)
    })

    it('should include per-outcome totals', () => {
      tracker.recordOutcome('TicketResolved')
      tracker.recordOutcome('TicketResolved')
      tracker.recordOutcome('LeadQualified')

      const summary = tracker.getSummary()
      expect(summary.costByOutcome.TicketResolved).toBeCloseTo(1.98, 2)
      expect(summary.costByOutcome.LeadQualified).toBe(5.0)
    })
  })

  describe('getEvents', () => {
    it('should return all recorded events', () => {
      tracker.recordOutcome('TicketResolved')
      tracker.recordOutcome('LeadQualified')

      const events = tracker.getEvents()
      expect(events).toHaveLength(2)
      expect(events[0].outcome).toBe('TicketResolved')
      expect(events[1].outcome).toBe('LeadQualified')
    })

    it('should return events in chronological order', () => {
      tracker.recordOutcome('TicketResolved')
      tracker.recordOutcome('LeadQualified')
      tracker.recordOutcome('ContentDelivered')

      const events = tracker.getEvents()
      expect(events[0].timestamp.getTime()).toBeLessThanOrEqual(
        events[1].timestamp.getTime()
      )
      expect(events[1].timestamp.getTime()).toBeLessThanOrEqual(
        events[2].timestamp.getTime()
      )
    })
  })

  describe('reset', () => {
    it('should clear all recorded events', () => {
      tracker.recordOutcome('TicketResolved')
      tracker.recordOutcome('LeadQualified')

      tracker.reset()

      const summary = tracker.getSummary()
      expect(summary.totalOutcomes).toBe(0)
      expect(summary.totalCost).toBe(0)
    })
  })
})

// ============================================================================
// Minimum Charge Tests
// ============================================================================

describe('OutcomeTracker with minimum charge', () => {
  const pricingWithMinimum: OutcomePricing = {
    model: 'outcome',
    outcomes: {
      TicketResolved: 0.99,
      LeadQualified: 5.0,
    },
    minimumCharge: 50,
  }

  it('should apply minimum charge when total is below threshold', () => {
    const tracker = createOutcomeTracker(pricingWithMinimum)
    tracker.recordOutcome('TicketResolved') // 0.99

    const summary = tracker.getSummary()
    expect(summary.totalCost).toBeCloseTo(0.99, 2)
    expect(summary.chargeableAmount).toBe(50) // minimum applies
    expect(summary.minimumApplied).toBe(true)
  })

  it('should not apply minimum charge when total exceeds threshold', () => {
    const tracker = createOutcomeTracker(pricingWithMinimum)

    // Record enough to exceed minimum
    for (let i = 0; i < 20; i++) {
      tracker.recordOutcome('LeadQualified') // 5.00 each = 100 total
    }

    const summary = tracker.getSummary()
    expect(summary.totalCost).toBe(100)
    expect(summary.chargeableAmount).toBe(100)
    expect(summary.minimumApplied).toBe(false)
  })
})

// ============================================================================
// Billing Signal Tests
// ============================================================================

describe('OutcomeTracker billing signals', () => {
  const pricingConfig: OutcomePricing = {
    model: 'outcome',
    outcomes: {
      TicketResolved: 0.99,
      LeadQualified: 5.0,
    },
  }

  it('should emit billing signal on outcome', () => {
    const signals: BillingSignal[] = []
    const tracker = createOutcomeTracker(pricingConfig, {
      onBillingSignal: (signal) => signals.push(signal),
    })

    tracker.recordOutcome('TicketResolved')

    expect(signals).toHaveLength(1)
    expect(signals[0].type).toBe('outcome')
    expect(signals[0].outcome).toBe('TicketResolved')
    expect(signals[0].amount).toBe(0.99)
  })

  it('should include metadata in billing signal', () => {
    const signals: BillingSignal[] = []
    const tracker = createOutcomeTracker(pricingConfig, {
      onBillingSignal: (signal) => signals.push(signal),
    })

    tracker.recordOutcome('LeadQualified', { leadId: 'lead-456' })

    expect(signals[0].metadata?.leadId).toBe('lead-456')
  })
})

// ============================================================================
// calculateOutcomeCost Utility Tests
// ============================================================================

describe('calculateOutcomeCost', () => {
  const pricing: OutcomePricing = {
    model: 'outcome',
    outcomes: {
      TicketResolved: 0.99,
      LeadQualified: 5.0,
      ContentDelivered: 25.0,
    },
  }

  it('should calculate cost for single outcome', () => {
    const cost = calculateOutcomeCost(pricing, { TicketResolved: 1 })
    expect(cost).toBe(0.99)
  })

  it('should calculate cost for multiple outcomes of same type', () => {
    const cost = calculateOutcomeCost(pricing, { TicketResolved: 10 })
    expect(cost).toBeCloseTo(9.9, 2)
  })

  it('should calculate cost for mixed outcomes', () => {
    const cost = calculateOutcomeCost(pricing, {
      TicketResolved: 10, // 9.90
      LeadQualified: 5, // 25.00
      ContentDelivered: 2, // 50.00
    })
    expect(cost).toBeCloseTo(84.9, 2)
  })

  it('should return 0 for empty outcome counts', () => {
    const cost = calculateOutcomeCost(pricing, {})
    expect(cost).toBe(0)
  })

  it('should ignore unknown outcome types', () => {
    const cost = calculateOutcomeCost(pricing, {
      TicketResolved: 1,
      UnknownType: 100,
    })
    expect(cost).toBe(0.99)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('OutcomeTracker edge cases', () => {
  it('should handle zero-priced outcomes', () => {
    const pricing: OutcomePricing = {
      model: 'outcome',
      outcomes: {
        FreeAction: 0,
        PaidAction: 1.0,
      },
    }

    const tracker = createOutcomeTracker(pricing)
    tracker.recordOutcome('FreeAction')
    tracker.recordOutcome('PaidAction')

    const summary = tracker.getSummary()
    expect(summary.totalCost).toBe(1.0)
    expect(summary.totalOutcomes).toBe(2)
  })

  it('should handle very small prices with precision', () => {
    const pricing: OutcomePricing = {
      model: 'outcome',
      outcomes: {
        MicroAction: 0.001,
      },
    }

    const tracker = createOutcomeTracker(pricing)
    for (let i = 0; i < 1000; i++) {
      tracker.recordOutcome('MicroAction')
    }

    const summary = tracker.getSummary()
    expect(summary.totalCost).toBeCloseTo(1.0, 2)
  })

  it('should handle large volumes of outcomes', () => {
    const pricing: OutcomePricing = {
      model: 'outcome',
      outcomes: {
        Action: 0.01,
      },
    }

    const tracker = createOutcomeTracker(pricing)
    for (let i = 0; i < 10000; i++) {
      tracker.recordOutcome('Action')
    }

    const summary = tracker.getSummary()
    expect(summary.totalOutcomes).toBe(10000)
    expect(summary.totalCost).toBeCloseTo(100, 2)
  })
})
