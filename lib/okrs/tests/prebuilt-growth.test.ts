/**
 * Growth OKRs Tests
 *
 * TDD tests for pre-built Growth OKRs following red-green-refactor.
 * Write failing tests first, then implement.
 *
 * Growth OKRs (owned by Mark - Marketing):
 * - BrandAwareness: Traffic, social reach
 * - ContentEngagement: Views, shares, time on page
 * - LeadGeneration: MQLs generated
 *
 * These metrics compute from web analytics data.
 */

import { describe, it, expect } from 'vitest'

// Import the metrics under test (will fail until implemented)
import { BrandAwareness, ContentEngagement, LeadGeneration, GrowthOKRs } from '../prebuilt/growth'

// ============================================================================
// BrandAwareness Metric Tests
// ============================================================================

describe('BrandAwareness metric', () => {
  it('has name "BrandAwareness"', () => {
    expect(BrandAwareness.name).toBe('BrandAwareness')
  })

  it('has description about traffic and social reach', () => {
    expect(BrandAwareness.description).toBe('Traffic and social reach')
  })

  it('has unit of count', () => {
    expect(BrandAwareness.unit).toBe('count')
  })

  it('has a measurement function', () => {
    expect(typeof BrandAwareness.measurement).toBe('function')
  })

  it('computes brand awareness from analytics.growth.brandAwareness', async () => {
    const mockAnalytics = {
      growth: {
        brandAwareness: 150000,
      },
    }

    const result = await BrandAwareness.measurement(mockAnalytics)
    expect(result).toBe(150000)
  })

  it('handles zero brand awareness', async () => {
    const mockAnalytics = {
      growth: {
        brandAwareness: 0,
      },
    }

    const result = await BrandAwareness.measurement(mockAnalytics)
    expect(result).toBe(0)
  })

  it('handles large traffic numbers', async () => {
    const mockAnalytics = {
      growth: {
        brandAwareness: 10000000,
      },
    }

    const result = await BrandAwareness.measurement(mockAnalytics)
    expect(result).toBe(10000000)
  })
})

// ============================================================================
// ContentEngagement Metric Tests
// ============================================================================

describe('ContentEngagement metric', () => {
  it('has name "ContentEngagement"', () => {
    expect(ContentEngagement.name).toBe('ContentEngagement')
  })

  it('has description about views, shares, time on page', () => {
    expect(ContentEngagement.description).toBe('Views, shares, time on page')
  })

  it('has unit of score', () => {
    expect(ContentEngagement.unit).toBe('score')
  })

  it('has a measurement function', () => {
    expect(typeof ContentEngagement.measurement).toBe('function')
  })

  it('computes content engagement from analytics.growth.contentEngagement', async () => {
    const mockAnalytics = {
      growth: {
        contentEngagement: 85.5,
      },
    }

    const result = await ContentEngagement.measurement(mockAnalytics)
    expect(result).toBe(85.5)
  })

  it('handles zero engagement', async () => {
    const mockAnalytics = {
      growth: {
        contentEngagement: 0,
      },
    }

    const result = await ContentEngagement.measurement(mockAnalytics)
    expect(result).toBe(0)
  })

  it('handles perfect engagement scores', async () => {
    const mockAnalytics = {
      growth: {
        contentEngagement: 100,
      },
    }

    const result = await ContentEngagement.measurement(mockAnalytics)
    expect(result).toBe(100)
  })
})

// ============================================================================
// LeadGeneration Metric Tests
// ============================================================================

describe('LeadGeneration metric', () => {
  it('has name "LeadGeneration"', () => {
    expect(LeadGeneration.name).toBe('LeadGeneration')
  })

  it('has description about MQLs generated', () => {
    expect(LeadGeneration.description).toBe('MQLs generated')
  })

  it('has unit of count', () => {
    expect(LeadGeneration.unit).toBe('count')
  })

  it('has a measurement function', () => {
    expect(typeof LeadGeneration.measurement).toBe('function')
  })

  it('computes lead generation from analytics.growth.leadGeneration', async () => {
    const mockAnalytics = {
      growth: {
        leadGeneration: 500,
      },
    }

    const result = await LeadGeneration.measurement(mockAnalytics)
    expect(result).toBe(500)
  })

  it('handles zero leads', async () => {
    const mockAnalytics = {
      growth: {
        leadGeneration: 0,
      },
    }

    const result = await LeadGeneration.measurement(mockAnalytics)
    expect(result).toBe(0)
  })

  it('handles high lead counts', async () => {
    const mockAnalytics = {
      growth: {
        leadGeneration: 10000,
      },
    }

    const result = await LeadGeneration.measurement(mockAnalytics)
    expect(result).toBe(10000)
  })
})

// ============================================================================
// GrowthOKRs Export Tests
// ============================================================================

describe('GrowthOKRs export', () => {
  it('exports all three Growth metrics', () => {
    expect(GrowthOKRs).toBeDefined()
    expect(GrowthOKRs.BrandAwareness).toBeDefined()
    expect(GrowthOKRs.ContentEngagement).toBeDefined()
    expect(GrowthOKRs.LeadGeneration).toBeDefined()
  })

  it('GrowthOKRs.BrandAwareness is the same as BrandAwareness', () => {
    expect(GrowthOKRs.BrandAwareness).toBe(BrandAwareness)
  })

  it('GrowthOKRs.ContentEngagement is the same as ContentEngagement', () => {
    expect(GrowthOKRs.ContentEngagement).toBe(ContentEngagement)
  })

  it('GrowthOKRs.LeadGeneration is the same as LeadGeneration', () => {
    expect(GrowthOKRs.LeadGeneration).toBe(LeadGeneration)
  })

  it('has exactly three metrics', () => {
    const metricNames = Object.keys(GrowthOKRs)
    expect(metricNames).toHaveLength(3)
    expect(metricNames).toContain('BrandAwareness')
    expect(metricNames).toContain('ContentEngagement')
    expect(metricNames).toContain('LeadGeneration')
  })
})

// ============================================================================
// Metric Type Structure Tests
// ============================================================================

describe('Growth metric structure', () => {
  it('all metrics have required properties', () => {
    const metrics = [BrandAwareness, ContentEngagement, LeadGeneration]

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
    const metrics = [BrandAwareness, ContentEngagement, LeadGeneration]

    for (const metric of metrics) {
      // PascalCase: starts with uppercase, no spaces/underscores
      expect(metric.name).toMatch(/^[A-Z][a-zA-Z]*$/)
    }
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Growth metrics integration', () => {
  it('all metrics can be measured with complete analytics object', async () => {
    const mockAnalytics = {
      growth: {
        brandAwareness: 250000,
        contentEngagement: 72.5,
        leadGeneration: 850,
      },
    }

    expect(await BrandAwareness.measurement(mockAnalytics)).toBe(250000)
    expect(await ContentEngagement.measurement(mockAnalytics)).toBe(72.5)
    expect(await LeadGeneration.measurement(mockAnalytics)).toBe(850)
  })

  it('metrics work with web analytics data', async () => {
    // Simulating web analytics sourced growth data
    const mockAnalytics = {
      growth: {
        brandAwareness: 500000, // Monthly unique visitors + social impressions
        contentEngagement: 65, // Composite score from views, shares, avg time
        leadGeneration: 1200, // Marketing Qualified Leads
      },
    }

    const awareness = await BrandAwareness.measurement(mockAnalytics)
    const engagement = await ContentEngagement.measurement(mockAnalytics)
    const leads = await LeadGeneration.measurement(mockAnalytics)

    expect(awareness).toBeGreaterThan(0)
    expect(engagement).toBeGreaterThanOrEqual(0)
    expect(engagement).toBeLessThanOrEqual(100)
    expect(leads).toBeGreaterThan(0)
  })
})
