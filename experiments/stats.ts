/**
 * Statistical Significance Calculations
 *
 * Provides statistical analysis for A/B test results.
 */

import type { SignificanceResult, VariantStats } from './types'

/**
 * Calculate statistical significance using a two-proportion z-test
 *
 * Determines whether the difference between control and treatment
 * conversion rates is statistically significant.
 *
 * @example
 * ```typescript
 * import { calculateSignificance } from '@dotdo/experiments'
 *
 * const result = calculateSignificance({
 *   control: { conversions: 150, trials: 1000 },
 *   treatment: { conversions: 180, trials: 1000 },
 * })
 *
 * console.log(`Significant: ${result.isSignificant}`)
 * console.log(`p-value: ${result.pValue}`)
 * console.log(`Effect size: ${(result.effectSize * 100).toFixed(1)}% improvement`)
 * ```
 */
export function calculateSignificance(input: {
  control: { conversions: number; trials: number }
  treatment: { conversions: number; trials: number }
  confidenceLevel?: number // Default 0.95
}): SignificanceResult {
  const { control, treatment, confidenceLevel = 0.95 } = input

  // Calculate conversion rates
  const p1 = control.conversions / control.trials
  const p2 = treatment.conversions / treatment.trials
  const n1 = control.trials
  const n2 = treatment.trials

  // Pooled proportion
  const pooled = (control.conversions + treatment.conversions) / (n1 + n2)

  // Standard error
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))

  // Z-score
  const z = se > 0 ? (p2 - p1) / se : 0

  // Two-tailed p-value
  const pValue = 2 * (1 - normalCDF(Math.abs(z)))

  // Alpha from confidence level
  const alpha = 1 - confidenceLevel

  // Effect size (relative improvement)
  const effectSize = p1 > 0 ? (p2 - p1) / p1 : 0

  // Calculate confidence intervals
  const zCritical = normalInverse((1 + confidenceLevel) / 2)

  const controlSE = Math.sqrt((p1 * (1 - p1)) / n1)
  const treatmentSE = Math.sqrt((p2 * (1 - p2)) / n2)

  const controlCI: [number, number] = [
    Math.max(0, p1 - zCritical * controlSE),
    Math.min(1, p1 + zCritical * controlSE),
  ]

  const treatmentCI: [number, number] = [
    Math.max(0, p2 - zCritical * treatmentSE),
    Math.min(1, p2 + zCritical * treatmentSE),
  ]

  // Calculate required sample size for desired power
  const power = 0.8
  const mde = 0.05 // 5% minimum detectable effect
  const requiredSampleSize = calculateSampleSize(p1, mde, power, confidenceLevel)

  return {
    isSignificant: pValue < alpha,
    pValue,
    confidenceLevel,
    effectSize,
    minimumDetectableEffect: mde,
    requiredSampleSize,
    power: calculatePower(p1, p2, n1, n2, confidenceLevel),
    control: {
      variantId: 'control',
      exposures: n1,
      conversions: control.conversions,
      conversionRate: p1,
      metricSum: control.conversions,
      metricMean: p1,
      metricStdDev: Math.sqrt(p1 * (1 - p1)),
      confidenceInterval: controlCI,
    },
    treatment: {
      variantId: 'treatment',
      exposures: n2,
      conversions: treatment.conversions,
      conversionRate: p2,
      metricSum: treatment.conversions,
      metricMean: p2,
      metricStdDev: Math.sqrt(p2 * (1 - p2)),
      confidenceInterval: treatmentCI,
    },
  }
}

/**
 * Calculate statistical significance for continuous metrics using t-test
 *
 * @example
 * ```typescript
 * import { calculateMetricSignificance } from '@dotdo/experiments'
 *
 * const result = calculateMetricSignificance({
 *   control: { mean: 45.2, stdDev: 12.5, n: 500 },
 *   treatment: { mean: 48.7, stdDev: 13.1, n: 500 },
 * })
 *
 * console.log(`Significant: ${result.isSignificant}`)
 * console.log(`Effect: ${result.effectSize.toFixed(2)} improvement in metric`)
 * ```
 */
export function calculateMetricSignificance(input: {
  control: { mean: number; stdDev: number; n: number }
  treatment: { mean: number; stdDev: number; n: number }
  confidenceLevel?: number
}): SignificanceResult {
  const { control, treatment, confidenceLevel = 0.95 } = input

  const n1 = control.n
  const n2 = treatment.n
  const mean1 = control.mean
  const mean2 = treatment.mean
  const sd1 = control.stdDev
  const sd2 = treatment.stdDev

  // Pooled standard error
  const se = Math.sqrt((sd1 * sd1) / n1 + (sd2 * sd2) / n2)

  // T-statistic
  const t = se > 0 ? (mean2 - mean1) / se : 0

  // Degrees of freedom (Welch's approximation)
  const v1 = (sd1 * sd1) / n1
  const v2 = (sd2 * sd2) / n2
  const df = Math.pow(v1 + v2, 2) / (Math.pow(v1, 2) / (n1 - 1) + Math.pow(v2, 2) / (n2 - 1))

  // P-value (using normal approximation for large samples)
  const pValue = df > 100 ? 2 * (1 - normalCDF(Math.abs(t))) : 2 * (1 - tCDF(Math.abs(t), df))

  const alpha = 1 - confidenceLevel
  const effectSize = mean1 !== 0 ? (mean2 - mean1) / mean1 : 0

  // Confidence intervals
  const zCritical = normalInverse((1 + confidenceLevel) / 2)
  const controlCI: [number, number] = [mean1 - zCritical * (sd1 / Math.sqrt(n1)), mean1 + zCritical * (sd1 / Math.sqrt(n1))]
  const treatmentCI: [number, number] = [mean2 - zCritical * (sd2 / Math.sqrt(n2)), mean2 + zCritical * (sd2 / Math.sqrt(n2))]

  return {
    isSignificant: pValue < alpha,
    pValue,
    confidenceLevel,
    effectSize,
    control: {
      variantId: 'control',
      exposures: n1,
      conversions: 0,
      conversionRate: 0,
      metricSum: mean1 * n1,
      metricMean: mean1,
      metricStdDev: sd1,
      confidenceInterval: controlCI,
    },
    treatment: {
      variantId: 'treatment',
      exposures: n2,
      conversions: 0,
      conversionRate: 0,
      metricSum: mean2 * n2,
      metricMean: mean2,
      metricStdDev: sd2,
      confidenceInterval: treatmentCI,
    },
  }
}

/**
 * Calculate required sample size per variant for desired statistical power
 */
export function calculateSampleSize(
  baselineConversionRate: number,
  minimumDetectableEffect: number,
  power: number = 0.8,
  confidenceLevel: number = 0.95
): number {
  const p1 = baselineConversionRate
  const p2 = p1 * (1 + minimumDetectableEffect)

  const alpha = 1 - confidenceLevel
  const zAlpha = normalInverse(1 - alpha / 2)
  const zBeta = normalInverse(power)

  const pooledP = (p1 + p2) / 2
  const pooledSE = Math.sqrt(2 * pooledP * (1 - pooledP))
  const effectSE = Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))

  const n = Math.pow((zAlpha * pooledSE + zBeta * effectSE) / (p2 - p1), 2)

  return Math.ceil(n)
}

/**
 * Calculate statistical power given sample sizes
 */
export function calculatePower(
  p1: number,
  p2: number,
  n1: number,
  n2: number,
  confidenceLevel: number = 0.95
): number {
  const alpha = 1 - confidenceLevel
  const zAlpha = normalInverse(1 - alpha / 2)

  const pooledP = (p1 * n1 + p2 * n2) / (n1 + n2)
  const se0 = Math.sqrt(pooledP * (1 - pooledP) * (1 / n1 + 1 / n2))
  const se1 = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2)

  const z = (Math.abs(p2 - p1) - zAlpha * se0) / se1

  return normalCDF(z)
}

/**
 * Check if experiment has reached statistical significance with early stopping
 *
 * Uses sequential analysis to allow checking results before reaching
 * full sample size while controlling for multiple comparisons.
 */
export function checkEarlyStopping(input: {
  control: { conversions: number; trials: number }
  treatment: { conversions: number; trials: number }
  /** Alpha spending function adjustment */
  alphaSpent?: number
  confidenceLevel?: number
}): { shouldStop: boolean; reason: string; significance: SignificanceResult } {
  const { alphaSpent = 0.01, confidenceLevel = 0.95 } = input

  const significance = calculateSignificance({
    control: input.control,
    treatment: input.treatment,
    confidenceLevel,
  })

  // Adjusted alpha for sequential testing
  const adjustedAlpha = (1 - confidenceLevel) * alphaSpent

  // Check for futility (effect in wrong direction)
  if (significance.effectSize < -0.1 && significance.pValue < adjustedAlpha) {
    return {
      shouldStop: true,
      reason: 'Futility: Treatment is significantly worse than control',
      significance,
    }
  }

  // Check for early success
  if (significance.isSignificant && significance.pValue < adjustedAlpha && significance.effectSize > 0) {
    return {
      shouldStop: true,
      reason: 'Success: Treatment is significantly better than control',
      significance,
    }
  }

  // Check if we have enough power
  if (significance.power && significance.power < 0.8) {
    return {
      shouldStop: false,
      reason: 'Insufficient power: Continue collecting data',
      significance,
    }
  }

  return {
    shouldStop: false,
    reason: 'No significant result yet',
    significance,
  }
}

/**
 * Calculate Bayesian probability that treatment beats control
 *
 * Uses Beta-Binomial conjugate prior for conversion rate experiments.
 */
export function bayesianProbability(input: {
  control: { conversions: number; trials: number }
  treatment: { conversions: number; trials: number }
  /** Prior alpha (default: 1 for uniform prior) */
  priorAlpha?: number
  /** Prior beta (default: 1 for uniform prior) */
  priorBeta?: number
  /** Number of Monte Carlo samples */
  samples?: number
}): { probability: number; expectedLift: number; credibleInterval: [number, number] } {
  const { priorAlpha = 1, priorBeta = 1, samples = 10000 } = input

  const controlAlpha = priorAlpha + input.control.conversions
  const controlBeta = priorBeta + input.control.trials - input.control.conversions
  const treatmentAlpha = priorAlpha + input.treatment.conversions
  const treatmentBeta = priorBeta + input.treatment.trials - input.treatment.conversions

  // Monte Carlo simulation
  let treatmentWins = 0
  const lifts: number[] = []

  for (let i = 0; i < samples; i++) {
    const controlSample = sampleBeta(controlAlpha, controlBeta)
    const treatmentSample = sampleBeta(treatmentAlpha, treatmentBeta)

    if (treatmentSample > controlSample) {
      treatmentWins++
    }

    if (controlSample > 0) {
      lifts.push((treatmentSample - controlSample) / controlSample)
    }
  }

  // Sort lifts for credible interval
  lifts.sort((a, b) => a - b)

  const probability = treatmentWins / samples
  const expectedLift = lifts.reduce((sum, l) => sum + l, 0) / lifts.length
  const credibleInterval: [number, number] = [
    lifts[Math.floor(samples * 0.025)] ?? 0,
    lifts[Math.floor(samples * 0.975)] ?? 0,
  ]

  return { probability, expectedLift, credibleInterval }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Standard normal cumulative distribution function
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.sqrt(2)

  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

  return 0.5 * (1.0 + sign * y)
}

/**
 * Inverse normal CDF (quantile function)
 */
function normalInverse(p: number): number {
  // Rational approximation for lower region
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1,
    2.506628277459239e0,
  ]
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ]
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0,
    2.938163982698783e0,
  ]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0]

  const pLow = 0.02425
  const pHigh = 1 - pLow

  let q: number
  let r: number

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    )
  } else if (p <= pHigh) {
    q = p - 0.5
    r = q * q
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    )
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return (
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    )
  }
}

/**
 * Student's t cumulative distribution function (approximation)
 */
function tCDF(t: number, df: number): number {
  // For large df, use normal approximation
  if (df > 100) {
    return normalCDF(t)
  }

  // Regularized incomplete beta function approximation
  const x = df / (df + t * t)
  const a = df / 2
  const b = 0.5

  // Use normal approximation for simplicity
  const correction = (1 + 1 / (4 * df)) * t / Math.sqrt(df)
  return normalCDF(correction)
}

/**
 * Sample from Beta distribution using the ratio of two Gamma distributions
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha, 1)
  const y = sampleGamma(beta, 1)
  return x / (x + y)
}

/**
 * Sample from Gamma distribution using Marsaglia and Tsang method
 */
function sampleGamma(shape: number, scale: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1, scale) * Math.pow(Math.random(), 1 / shape)
  }

  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)

  while (true) {
    let x: number
    let v: number

    do {
      x = randomNormal()
      v = 1 + c * x
    } while (v <= 0)

    v = v * v * v
    const u = Math.random()

    if (u < 1 - 0.0331 * x * x * x * x) {
      return d * v * scale
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v * scale
    }
  }
}

/**
 * Sample from standard normal distribution using Box-Muller transform
 */
function randomNormal(): number {
  const u1 = Math.random()
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}
