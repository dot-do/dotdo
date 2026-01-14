/**
 * Pre-built Sales OKRs Tests
 *
 * TDD red-green-refactor: Tests for pre-built Sales metrics.
 *
 * Sales OKRs (owned by Sally):
 * - PipelineHealth: Qualified opportunities in sales pipeline
 * - ConversionRate: Demo to Close conversion percentage
 * - RevenueGrowth: MRR/ARR growth targets
 *
 * Each metric is defined using defineMetric() with:
 * - name: PascalCase metric name
 * - description: Human-readable description
 * - unit: Unit of measurement ('$', '%', 'count', etc.)
 * - measurement: Async function to compute current value from analytics
 */

import { describe, it, expect } from 'vitest'

// Import the metrics under test (will fail until implemented)
import { PipelineHealth, ConversionRate, RevenueGrowth, SalesOKRs } from '../prebuilt/sales'

// ============================================================================
// PipelineHealth Metric Tests
// ============================================================================

describe('PipelineHealth metric', () => {
  it('has name "PipelineHealth"', () => {
    expect(PipelineHealth.name).toBe('PipelineHealth')
  })

  it('has description about qualified opportunities', () => {
    expect(PipelineHealth.description).toBe('Qualified opportunities in pipeline')
  })

  it('has count unit', () => {
    expect(PipelineHealth.unit).toBe('count')
  })

  it('has measurement function', () => {
    expect(typeof PipelineHealth.measurement).toBe('function')
  })

  it('computes pipeline health from analytics.sales.qualifiedOpportunities', async () => {
    const mockAnalytics = {
      sales: { qualifiedOpportunities: 45 },
    }

    const value = await PipelineHealth.measurement(mockAnalytics)
    expect(value).toBe(45)
  })

  it('handles zero opportunities', async () => {
    const mockAnalytics = {
      sales: { qualifiedOpportunities: 0 },
    }

    const value = await PipelineHealth.measurement(mockAnalytics)
    expect(value).toBe(0)
  })

  it('handles large pipeline values', async () => {
    const mockAnalytics = {
      sales: { qualifiedOpportunities: 500 },
    }

    const value = await PipelineHealth.measurement(mockAnalytics)
    expect(value).toBe(500)
  })
})

// ============================================================================
// ConversionRate Metric Tests
// ============================================================================

describe('ConversionRate metric', () => {
  it('has name "ConversionRate"', () => {
    expect(ConversionRate.name).toBe('ConversionRate')
  })

  it('has description about demo to close percentage', () => {
    expect(ConversionRate.description).toBe('Demo to Close conversion rate')
  })

  it('has percentage unit', () => {
    expect(ConversionRate.unit).toBe('%')
  })

  it('has measurement function', () => {
    expect(typeof ConversionRate.measurement).toBe('function')
  })

  it('computes conversion rate from analytics.sales.demoToCloseRate', async () => {
    const mockAnalytics = {
      sales: { demoToCloseRate: 25.5 },
    }

    const value = await ConversionRate.measurement(mockAnalytics)
    expect(value).toBe(25.5)
  })

  it('handles zero conversion rate', async () => {
    const mockAnalytics = {
      sales: { demoToCloseRate: 0 },
    }

    const value = await ConversionRate.measurement(mockAnalytics)
    expect(value).toBe(0)
  })

  it('handles high conversion rates', async () => {
    const mockAnalytics = {
      sales: { demoToCloseRate: 80 },
    }

    const value = await ConversionRate.measurement(mockAnalytics)
    expect(value).toBe(80)
  })

  it('handles decimal conversion rates', async () => {
    const mockAnalytics = {
      sales: { demoToCloseRate: 33.33 },
    }

    const value = await ConversionRate.measurement(mockAnalytics)
    expect(value).toBe(33.33)
  })
})

// ============================================================================
// RevenueGrowth Metric Tests
// ============================================================================

describe('RevenueGrowth metric', () => {
  it('has name "RevenueGrowth"', () => {
    expect(RevenueGrowth.name).toBe('RevenueGrowth')
  })

  it('has description about MRR/ARR targets', () => {
    expect(RevenueGrowth.description).toBe('MRR/ARR growth rate')
  })

  it('has percentage unit', () => {
    expect(RevenueGrowth.unit).toBe('%')
  })

  it('has measurement function', () => {
    expect(typeof RevenueGrowth.measurement).toBe('function')
  })

  it('computes revenue growth from analytics.sales.revenueGrowthRate', async () => {
    const mockAnalytics = {
      sales: { revenueGrowthRate: 15 },
    }

    const value = await RevenueGrowth.measurement(mockAnalytics)
    expect(value).toBe(15)
  })

  it('handles zero growth', async () => {
    const mockAnalytics = {
      sales: { revenueGrowthRate: 0 },
    }

    const value = await RevenueGrowth.measurement(mockAnalytics)
    expect(value).toBe(0)
  })

  it('handles negative growth (contraction)', async () => {
    const mockAnalytics = {
      sales: { revenueGrowthRate: -5 },
    }

    const value = await RevenueGrowth.measurement(mockAnalytics)
    expect(value).toBe(-5)
  })

  it('handles high growth rates', async () => {
    const mockAnalytics = {
      sales: { revenueGrowthRate: 200 },
    }

    const value = await RevenueGrowth.measurement(mockAnalytics)
    expect(value).toBe(200)
  })
})

// ============================================================================
// SalesOKRs Collection Tests
// ============================================================================

describe('SalesOKRs collection', () => {
  it('exports all three Sales metrics', () => {
    expect(SalesOKRs).toBeDefined()
    expect(Object.keys(SalesOKRs)).toHaveLength(3)
  })

  it('includes PipelineHealth', () => {
    expect(SalesOKRs.PipelineHealth).toBe(PipelineHealth)
  })

  it('includes ConversionRate', () => {
    expect(SalesOKRs.ConversionRate).toBe(ConversionRate)
  })

  it('includes RevenueGrowth', () => {
    expect(SalesOKRs.RevenueGrowth).toBe(RevenueGrowth)
  })

  it('has exactly three metrics', () => {
    const metricNames = Object.keys(SalesOKRs)
    expect(metricNames).toHaveLength(3)
    expect(metricNames).toContain('PipelineHealth')
    expect(metricNames).toContain('ConversionRate')
    expect(metricNames).toContain('RevenueGrowth')
  })

  it('all metrics have consistent structure', () => {
    for (const [key, metric] of Object.entries(SalesOKRs)) {
      expect(metric.name).toBe(key)
      expect(typeof metric.description).toBe('string')
      expect(typeof metric.unit).toBe('string')
      expect(typeof metric.measurement).toBe('function')
    }
  })
})

// ============================================================================
// Metric Type Structure Tests
// ============================================================================

describe('Sales metric structure', () => {
  it('all metrics have required properties', () => {
    const metrics = [PipelineHealth, ConversionRate, RevenueGrowth]

    for (const metric of metrics) {
      expect(metric).toHaveProperty('name')
      expect(metric).toHaveProperty('description')
      expect(metric).toHaveProperty('unit')
      expect(metric).toHaveProperty('measurement')
      expect(typeof metric.name).toBe('string')
      expect(typeof metric.description).toBe('string')
      expect(typeof metric.unit).toBe('string')
      expect(typeof metric.measurement).toBe('function')
    }
  })

  it('metric names follow PascalCase convention', () => {
    const metrics = [PipelineHealth, ConversionRate, RevenueGrowth]

    for (const metric of metrics) {
      // PascalCase: starts with uppercase, no spaces/underscores
      expect(metric.name).toMatch(/^[A-Z][a-zA-Z]*$/)
    }
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Sales metrics integration', () => {
  it('all metrics can be measured with complete analytics object', async () => {
    const mockAnalytics = {
      sales: {
        qualifiedOpportunities: 50,
        demoToCloseRate: 30,
        revenueGrowthRate: 25,
      },
    }

    expect(await PipelineHealth.measurement(mockAnalytics)).toBe(50)
    expect(await ConversionRate.measurement(mockAnalytics)).toBe(30)
    expect(await RevenueGrowth.measurement(mockAnalytics)).toBe(25)
  })

  it('metrics work with analytics context that has other namespaces', async () => {
    const mockAnalytics = {
      product: {
        featureAdoptionRate: 75,
        userSatisfactionScore: 85,
        onboardingCompletionTime: 10,
      },
      financial: {
        mrr: 100000,
        churn: 2.5,
        nrr: 115,
        cac: 500,
        ltv: 6000,
      },
      sales: {
        qualifiedOpportunities: 75,
        demoToCloseRate: 35,
        revenueGrowthRate: 40,
      },
    }

    expect(await PipelineHealth.measurement(mockAnalytics)).toBe(75)
    expect(await ConversionRate.measurement(mockAnalytics)).toBe(35)
    expect(await RevenueGrowth.measurement(mockAnalytics)).toBe(40)
  })
})
