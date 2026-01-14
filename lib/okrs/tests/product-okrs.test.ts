/**
 * Product OKRs Tests
 *
 * TDD tests for pre-built Product OKRs following red-green-refactor.
 * Write failing tests first, then implement.
 *
 * Product OKRs (owned by Priya):
 * - FeatureAdoption: % users using new features
 * - UserSatisfaction: NPS/CSAT scores
 * - TimeToValue: Onboarding completion time
 */

import { describe, it, expect, vi } from 'vitest'
import { FeatureAdoption, UserSatisfaction, TimeToValue, ProductOKRs } from '../prebuilt/product'

// ============================================================================
// FeatureAdoption Metric Tests
// ============================================================================

describe('FeatureAdoption metric', () => {
  it('has name "FeatureAdoption"', () => {
    expect(FeatureAdoption.name).toBe('FeatureAdoption')
  })

  it('has description about users using new features', () => {
    expect(FeatureAdoption.description).toBe('% users using new features')
  })

  it('has unit of percentage (%)', () => {
    expect(FeatureAdoption.unit).toBe('%')
  })

  it('has a measurement function that returns feature adoption rate', async () => {
    const mockAnalytics = {
      product: {
        featureAdoptionRate: 75.5,
      },
    }

    const result = await FeatureAdoption.measurement(mockAnalytics)
    expect(result).toBe(75.5)
  })

  it('measurement function handles zero adoption', async () => {
    const mockAnalytics = {
      product: {
        featureAdoptionRate: 0,
      },
    }

    const result = await FeatureAdoption.measurement(mockAnalytics)
    expect(result).toBe(0)
  })

  it('measurement function handles 100% adoption', async () => {
    const mockAnalytics = {
      product: {
        featureAdoptionRate: 100,
      },
    }

    const result = await FeatureAdoption.measurement(mockAnalytics)
    expect(result).toBe(100)
  })
})

// ============================================================================
// UserSatisfaction Metric Tests
// ============================================================================

describe('UserSatisfaction metric', () => {
  it('has name "UserSatisfaction"', () => {
    expect(UserSatisfaction.name).toBe('UserSatisfaction')
  })

  it('has description about NPS/CSAT scores', () => {
    expect(UserSatisfaction.description).toBe('NPS/CSAT scores')
  })

  it('has unit of score', () => {
    expect(UserSatisfaction.unit).toBe('score')
  })

  it('has a measurement function that returns satisfaction score', async () => {
    const mockAnalytics = {
      product: {
        userSatisfactionScore: 85,
      },
    }

    const result = await UserSatisfaction.measurement(mockAnalytics)
    expect(result).toBe(85)
  })

  it('measurement function handles negative NPS scores', async () => {
    const mockAnalytics = {
      product: {
        userSatisfactionScore: -20,
      },
    }

    const result = await UserSatisfaction.measurement(mockAnalytics)
    expect(result).toBe(-20)
  })

  it('measurement function handles perfect scores', async () => {
    const mockAnalytics = {
      product: {
        userSatisfactionScore: 100,
      },
    }

    const result = await UserSatisfaction.measurement(mockAnalytics)
    expect(result).toBe(100)
  })
})

// ============================================================================
// TimeToValue Metric Tests
// ============================================================================

describe('TimeToValue metric', () => {
  it('has name "TimeToValue"', () => {
    expect(TimeToValue.name).toBe('TimeToValue')
  })

  it('has description about onboarding completion time', () => {
    expect(TimeToValue.description).toBe('Onboarding completion time')
  })

  it('has unit of minutes', () => {
    expect(TimeToValue.unit).toBe('minutes')
  })

  it('has a measurement function that returns onboarding time', async () => {
    const mockAnalytics = {
      product: {
        onboardingCompletionTime: 15,
      },
    }

    const result = await TimeToValue.measurement(mockAnalytics)
    expect(result).toBe(15)
  })

  it('measurement function handles zero time (instant onboarding)', async () => {
    const mockAnalytics = {
      product: {
        onboardingCompletionTime: 0,
      },
    }

    const result = await TimeToValue.measurement(mockAnalytics)
    expect(result).toBe(0)
  })

  it('measurement function handles long onboarding times', async () => {
    const mockAnalytics = {
      product: {
        onboardingCompletionTime: 120,
      },
    }

    const result = await TimeToValue.measurement(mockAnalytics)
    expect(result).toBe(120)
  })
})

// ============================================================================
// ProductOKRs Export Tests
// ============================================================================

describe('ProductOKRs export', () => {
  it('exports all three Product metrics', () => {
    expect(ProductOKRs).toBeDefined()
    expect(ProductOKRs.FeatureAdoption).toBeDefined()
    expect(ProductOKRs.UserSatisfaction).toBeDefined()
    expect(ProductOKRs.TimeToValue).toBeDefined()
  })

  it('ProductOKRs.FeatureAdoption is the same as FeatureAdoption', () => {
    expect(ProductOKRs.FeatureAdoption).toBe(FeatureAdoption)
  })

  it('ProductOKRs.UserSatisfaction is the same as UserSatisfaction', () => {
    expect(ProductOKRs.UserSatisfaction).toBe(UserSatisfaction)
  })

  it('ProductOKRs.TimeToValue is the same as TimeToValue', () => {
    expect(ProductOKRs.TimeToValue).toBe(TimeToValue)
  })

  it('has exactly three metrics', () => {
    const metricNames = Object.keys(ProductOKRs)
    expect(metricNames).toHaveLength(3)
    expect(metricNames).toContain('FeatureAdoption')
    expect(metricNames).toContain('UserSatisfaction')
    expect(metricNames).toContain('TimeToValue')
  })
})

// ============================================================================
// Metric Type Structure Tests
// ============================================================================

describe('Metric structure', () => {
  it('all metrics have required properties', () => {
    const metrics = [FeatureAdoption, UserSatisfaction, TimeToValue]

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
    const metrics = [FeatureAdoption, UserSatisfaction, TimeToValue]

    for (const metric of metrics) {
      // PascalCase: starts with uppercase, no spaces/underscores
      expect(metric.name).toMatch(/^[A-Z][a-zA-Z]*$/)
    }
  })
})
