/**
 * SaaS OKRs Tests
 *
 * TDD red-green-refactor: Tests for pre-built SaaS metrics.
 *
 * Requirements:
 * - MRR (Monthly Recurring Revenue)
 * - Churn (monthly churn rate)
 * - NRR (Net Revenue Retention)
 * - CAC (Customer Acquisition Cost)
 * - LTV (Lifetime Value)
 *
 * Each metric is defined using defineMetric() with:
 * - name: PascalCase metric name
 * - description: Human-readable description
 * - unit: Unit of measurement ('$', '%', 'months', etc.)
 * - measurement: Async function to compute current value from analytics
 */

import { describe, it, expect, vi } from 'vitest'

// Import the metrics under test (will fail until implemented)
import { MRR, Churn, NRR, CAC, LTV, SaaSKRs } from '../prebuilt/saas'
import { defineMetric } from '../define'
import type { MetricDefinition } from '../define'

// ============================================================================
// defineMetric Function Tests
// ============================================================================

describe('defineMetric', () => {
  it('creates a MetricDefinition from config', () => {
    const metric = defineMetric({
      name: 'TestMetric',
      description: 'A test metric',
      unit: '$',
      measurement: async () => 100,
    })

    expect(metric.name).toBe('TestMetric')
    expect(metric.description).toBe('A test metric')
    expect(metric.unit).toBe('$')
    expect(typeof metric.measurement).toBe('function')
  })

  it('returns the same structure that was passed in', () => {
    const config = {
      name: 'Revenue',
      description: 'Total revenue',
      unit: '$',
      measurement: async (analytics: any) => analytics.financial.revenue,
    }

    const metric = defineMetric(config)

    expect(metric.name).toBe(config.name)
    expect(metric.description).toBe(config.description)
    expect(metric.unit).toBe(config.unit)
    expect(metric.measurement).toBe(config.measurement)
  })

  it('measurement function receives analytics context', async () => {
    const mockAnalytics = {
      financial: { mrr: 50000 },
    }

    const metric = defineMetric({
      name: 'MRR',
      description: 'Monthly Recurring Revenue',
      unit: '$',
      measurement: async (analytics) => analytics.financial.mrr,
    })

    const value = await metric.measurement(mockAnalytics)
    expect(value).toBe(50000)
  })
})

// ============================================================================
// MRR (Monthly Recurring Revenue) Tests
// ============================================================================

describe('MRR metric', () => {
  it('has correct name', () => {
    expect(MRR.name).toBe('MRR')
  })

  it('has correct description', () => {
    expect(MRR.description).toBe('Monthly Recurring Revenue')
  })

  it('has dollar unit', () => {
    expect(MRR.unit).toBe('$')
  })

  it('has measurement function', () => {
    expect(typeof MRR.measurement).toBe('function')
  })

  it('computes MRR from analytics.financial.mrr', async () => {
    const mockAnalytics = {
      financial: { mrr: 75000 },
    }

    const value = await MRR.measurement(mockAnalytics)
    expect(value).toBe(75000)
  })
})

// ============================================================================
// Churn (Monthly Churn Rate) Tests
// ============================================================================

describe('Churn metric', () => {
  it('has correct name', () => {
    expect(Churn.name).toBe('Churn')
  })

  it('has correct description', () => {
    expect(Churn.description).toBe('Monthly Churn Rate')
  })

  it('has percentage unit', () => {
    expect(Churn.unit).toBe('%')
  })

  it('has measurement function', () => {
    expect(typeof Churn.measurement).toBe('function')
  })

  it('computes churn from analytics.financial.churn', async () => {
    const mockAnalytics = {
      financial: { churn: 3.5 },
    }

    const value = await Churn.measurement(mockAnalytics)
    expect(value).toBe(3.5)
  })
})

// ============================================================================
// NRR (Net Revenue Retention) Tests
// ============================================================================

describe('NRR metric', () => {
  it('has correct name', () => {
    expect(NRR.name).toBe('NRR')
  })

  it('has correct description', () => {
    expect(NRR.description).toBe('Net Revenue Retention')
  })

  it('has percentage unit', () => {
    expect(NRR.unit).toBe('%')
  })

  it('has measurement function', () => {
    expect(typeof NRR.measurement).toBe('function')
  })

  it('computes NRR from analytics.financial.nrr', async () => {
    const mockAnalytics = {
      financial: { nrr: 115 },
    }

    const value = await NRR.measurement(mockAnalytics)
    expect(value).toBe(115)
  })
})

// ============================================================================
// CAC (Customer Acquisition Cost) Tests
// ============================================================================

describe('CAC metric', () => {
  it('has correct name', () => {
    expect(CAC.name).toBe('CAC')
  })

  it('has correct description', () => {
    expect(CAC.description).toBe('Customer Acquisition Cost')
  })

  it('has dollar unit', () => {
    expect(CAC.unit).toBe('$')
  })

  it('has measurement function', () => {
    expect(typeof CAC.measurement).toBe('function')
  })

  it('computes CAC from analytics.financial.cac', async () => {
    const mockAnalytics = {
      financial: { cac: 250 },
    }

    const value = await CAC.measurement(mockAnalytics)
    expect(value).toBe(250)
  })
})

// ============================================================================
// LTV (Lifetime Value) Tests
// ============================================================================

describe('LTV metric', () => {
  it('has correct name', () => {
    expect(LTV.name).toBe('LTV')
  })

  it('has correct description', () => {
    expect(LTV.description).toBe('Customer Lifetime Value')
  })

  it('has dollar unit', () => {
    expect(LTV.unit).toBe('$')
  })

  it('has measurement function', () => {
    expect(typeof LTV.measurement).toBe('function')
  })

  it('computes LTV from analytics.financial.ltv', async () => {
    const mockAnalytics = {
      financial: { ltv: 3000 },
    }

    const value = await LTV.measurement(mockAnalytics)
    expect(value).toBe(3000)
  })
})

// ============================================================================
// SaaSKRs Collection Tests
// ============================================================================

describe('SaaSKRs collection', () => {
  it('exports all five SaaS metrics', () => {
    expect(SaaSKRs).toBeDefined()
    expect(Object.keys(SaaSKRs)).toHaveLength(5)
  })

  it('includes MRR', () => {
    expect(SaaSKRs.MRR).toBe(MRR)
  })

  it('includes Churn', () => {
    expect(SaaSKRs.Churn).toBe(Churn)
  })

  it('includes NRR', () => {
    expect(SaaSKRs.NRR).toBe(NRR)
  })

  it('includes CAC', () => {
    expect(SaaSKRs.CAC).toBe(CAC)
  })

  it('includes LTV', () => {
    expect(SaaSKRs.LTV).toBe(LTV)
  })

  it('all metrics have consistent structure', () => {
    for (const [key, metric] of Object.entries(SaaSKRs)) {
      expect(metric.name).toBe(key)
      expect(typeof metric.description).toBe('string')
      expect(typeof metric.unit).toBe('string')
      expect(typeof metric.measurement).toBe('function')
    }
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('SaaS metrics integration', () => {
  it('all metrics can be measured with complete analytics object', async () => {
    const mockAnalytics = {
      financial: {
        mrr: 100000,
        churn: 2.5,
        nrr: 120,
        cac: 500,
        ltv: 6000,
      },
    }

    expect(await MRR.measurement(mockAnalytics)).toBe(100000)
    expect(await Churn.measurement(mockAnalytics)).toBe(2.5)
    expect(await NRR.measurement(mockAnalytics)).toBe(120)
    expect(await CAC.measurement(mockAnalytics)).toBe(500)
    expect(await LTV.measurement(mockAnalytics)).toBe(6000)
  })

  it('LTV:CAC ratio can be computed from metrics', async () => {
    const mockAnalytics = {
      financial: {
        ltv: 6000,
        cac: 500,
      },
    }

    const ltvValue = await LTV.measurement(mockAnalytics)
    const cacValue = await CAC.measurement(mockAnalytics)
    const ratio = ltvValue / cacValue

    expect(ratio).toBe(12) // 6000 / 500 = 12x
  })
})
