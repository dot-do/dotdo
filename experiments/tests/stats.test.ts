/**
 * Tests for statistical significance calculations
 */

import { describe, it, expect } from 'vitest'
import {
  calculateSignificance,
  calculateMetricSignificance,
  calculateSampleSize,
  calculatePower,
  checkEarlyStopping,
  bayesianProbability,
} from '../stats'

describe('calculateSignificance', () => {
  it('should detect significant difference when treatment is better', () => {
    const result = calculateSignificance({
      control: { conversions: 150, trials: 1000 },
      treatment: { conversions: 200, trials: 1000 },
    })

    expect(result.isSignificant).toBe(true)
    expect(result.pValue).toBeLessThan(0.05)
    expect(result.effectSize).toBeGreaterThan(0)
    expect(result.treatment.conversionRate).toBeGreaterThan(result.control.conversionRate)
  })

  it('should not detect significance when difference is small', () => {
    const result = calculateSignificance({
      control: { conversions: 100, trials: 1000 },
      treatment: { conversions: 105, trials: 1000 },
    })

    expect(result.isSignificant).toBe(false)
    expect(result.pValue).toBeGreaterThan(0.05)
  })

  it('should calculate correct conversion rates', () => {
    const result = calculateSignificance({
      control: { conversions: 200, trials: 1000 },
      treatment: { conversions: 250, trials: 1000 },
    })

    expect(result.control.conversionRate).toBeCloseTo(0.2)
    expect(result.treatment.conversionRate).toBeCloseTo(0.25)
    expect(result.effectSize).toBeCloseTo(0.25) // 25% improvement
  })

  it('should calculate confidence intervals', () => {
    const result = calculateSignificance({
      control: { conversions: 100, trials: 1000 },
      treatment: { conversions: 100, trials: 1000 },
      confidenceLevel: 0.95,
    })

    expect(result.control.confidenceInterval).toHaveLength(2)
    expect(result.control.confidenceInterval[0]).toBeLessThan(0.1)
    expect(result.control.confidenceInterval[1]).toBeGreaterThan(0.1)
  })

  it('should handle edge case of zero conversions', () => {
    const result = calculateSignificance({
      control: { conversions: 0, trials: 100 },
      treatment: { conversions: 10, trials: 100 },
    })

    expect(result.control.conversionRate).toBe(0)
    expect(result.treatment.conversionRate).toBe(0.1)
    expect(result.pValue).toBeDefined()
  })
})

describe('calculateMetricSignificance', () => {
  it('should detect significant difference in continuous metrics', () => {
    const result = calculateMetricSignificance({
      control: { mean: 50, stdDev: 10, n: 500 },
      treatment: { mean: 55, stdDev: 10, n: 500 },
    })

    expect(result.isSignificant).toBe(true)
    expect(result.effectSize).toBe(0.1) // 10% improvement
  })

  it('should not detect significance when means are similar', () => {
    const result = calculateMetricSignificance({
      control: { mean: 50, stdDev: 15, n: 100 },
      treatment: { mean: 51, stdDev: 15, n: 100 },
    })

    expect(result.isSignificant).toBe(false)
  })

  it('should calculate confidence intervals for means', () => {
    const result = calculateMetricSignificance({
      control: { mean: 100, stdDev: 20, n: 400 },
      treatment: { mean: 110, stdDev: 20, n: 400 },
    })

    expect(result.control.confidenceInterval[0]).toBeLessThan(100)
    expect(result.control.confidenceInterval[1]).toBeGreaterThan(100)
  })
})

describe('calculateSampleSize', () => {
  it('should calculate required sample size for given parameters', () => {
    const n = calculateSampleSize(
      0.1, // 10% baseline conversion rate
      0.2, // 20% minimum detectable effect (2 percentage points)
      0.8, // 80% power
      0.95 // 95% confidence
    )

    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(50000) // Sanity check
  })

  it('should require larger sample for smaller effect sizes', () => {
    const nLargeEffect = calculateSampleSize(0.1, 0.2, 0.8, 0.95)
    const nSmallEffect = calculateSampleSize(0.1, 0.05, 0.8, 0.95)

    expect(nSmallEffect).toBeGreaterThan(nLargeEffect)
  })

  it('should require larger sample for higher power', () => {
    const n80 = calculateSampleSize(0.1, 0.2, 0.8, 0.95)
    const n90 = calculateSampleSize(0.1, 0.2, 0.9, 0.95)

    expect(n90).toBeGreaterThan(n80)
  })
})

describe('calculatePower', () => {
  it('should calculate power given sample sizes', () => {
    const power = calculatePower(0.1, 0.12, 1000, 1000, 0.95)

    expect(power).toBeGreaterThan(0)
    expect(power).toBeLessThanOrEqual(1)
  })

  it('should have higher power with larger samples', () => {
    const powerSmall = calculatePower(0.1, 0.12, 100, 100, 0.95)
    const powerLarge = calculatePower(0.1, 0.12, 1000, 1000, 0.95)

    expect(powerLarge).toBeGreaterThan(powerSmall)
  })

  it('should have higher power with larger effect size', () => {
    const powerSmallEffect = calculatePower(0.1, 0.11, 500, 500, 0.95)
    const powerLargeEffect = calculatePower(0.1, 0.15, 500, 500, 0.95)

    expect(powerLargeEffect).toBeGreaterThan(powerSmallEffect)
  })
})

describe('checkEarlyStopping', () => {
  it('should recommend stopping when treatment is significantly better', () => {
    const result = checkEarlyStopping({
      control: { conversions: 100, trials: 1000 },
      treatment: { conversions: 200, trials: 1000 },
      alphaSpent: 0.01,
    })

    expect(result.shouldStop).toBe(true)
    expect(result.reason).toContain('Success')
  })

  it('should recommend stopping when treatment is significantly worse', () => {
    const result = checkEarlyStopping({
      control: { conversions: 200, trials: 1000 },
      treatment: { conversions: 100, trials: 1000 },
      alphaSpent: 0.01,
    })

    expect(result.shouldStop).toBe(true)
    expect(result.reason).toContain('Futility')
  })

  it('should not recommend stopping when results are inconclusive', () => {
    const result = checkEarlyStopping({
      control: { conversions: 50, trials: 500 },
      treatment: { conversions: 55, trials: 500 },
      alphaSpent: 0.01,
    })

    expect(result.shouldStop).toBe(false)
  })
})

describe('bayesianProbability', () => {
  it('should calculate probability treatment beats control', () => {
    const result = bayesianProbability({
      control: { conversions: 100, trials: 1000 },
      treatment: { conversions: 150, trials: 1000 },
    })

    expect(result.probability).toBeGreaterThan(0.5)
    expect(result.probability).toBeLessThanOrEqual(1)
    expect(result.expectedLift).toBeGreaterThan(0)
  })

  it('should return lower probability when control is better', () => {
    const result = bayesianProbability({
      control: { conversions: 150, trials: 1000 },
      treatment: { conversions: 100, trials: 1000 },
    })

    expect(result.probability).toBeLessThan(0.5)
    expect(result.expectedLift).toBeLessThan(0)
  })

  it('should calculate credible interval', () => {
    const result = bayesianProbability({
      control: { conversions: 100, trials: 1000 },
      treatment: { conversions: 120, trials: 1000 },
    })

    expect(result.credibleInterval).toHaveLength(2)
    expect(result.credibleInterval[0]).toBeLessThan(result.expectedLift)
    expect(result.credibleInterval[1]).toBeGreaterThan(result.expectedLift)
  })

  it('should handle uncertain priors', () => {
    // With very few observations, should be close to 50%
    const result = bayesianProbability({
      control: { conversions: 5, trials: 10 },
      treatment: { conversions: 6, trials: 10 },
    })

    expect(result.probability).toBeGreaterThan(0.3)
    expect(result.probability).toBeLessThan(0.8)
  })
})
