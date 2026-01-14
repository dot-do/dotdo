/**
 * Statistical Analysis Helpers for A/B Testing
 *
 * Provides statistical significance testing for experiment analysis:
 * - Chi-squared test for conversion rate differences
 * - Z-test for proportions
 * - T-test for mean comparisons
 * - Sample size calculations
 * - Confidence interval estimation
 * - Power analysis
 * - Bayesian probability calculations
 *
 * @module db/primitives/feature-flags/statistics
 */

import type { VariantMetrics, GoalMetrics } from './conversion-tracker'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Result of a statistical significance test
 */
export interface SignificanceResult {
  /** Whether the result is statistically significant */
  isSignificant: boolean
  /** p-value from the test */
  pValue: number
  /** Confidence level (1 - alpha) */
  confidence: number
  /** Test statistic value */
  testStatistic: number
  /** Type of test performed */
  testType: 'chi-squared' | 'z-test' | 't-test'
  /** Degrees of freedom (for chi-squared and t-test) */
  degreesOfFreedom?: number
  /** Effect size (Cohen's d, h, or w) */
  effectSize?: number
  /** Effect size interpretation */
  effectSizeInterpretation?: 'negligible' | 'small' | 'medium' | 'large'
}

/**
 * Confidence interval for a metric
 */
export interface ConfidenceInterval {
  /** Lower bound */
  lower: number
  /** Point estimate */
  estimate: number
  /** Upper bound */
  upper: number
  /** Confidence level */
  confidenceLevel: number
  /** Margin of error */
  marginOfError: number
}

/**
 * Sample size calculation result
 */
export interface SampleSizeResult {
  /** Required sample size per variant */
  sampleSizePerVariant: number
  /** Total required sample size */
  totalSampleSize: number
  /** Expected minimum detectable effect */
  mde: number
  /** Statistical power */
  power: number
  /** Significance level (alpha) */
  alpha: number
}

/**
 * Comparison result between two variants
 */
export interface VariantComparison {
  /** Control variant key */
  control: string
  /** Treatment variant key */
  treatment: string
  /** Control metrics */
  controlMetrics: {
    sampleSize: number
    conversions: number
    conversionRate: number
    mean?: number
    standardDeviation?: number
  }
  /** Treatment metrics */
  treatmentMetrics: {
    sampleSize: number
    conversions: number
    conversionRate: number
    mean?: number
    standardDeviation?: number
  }
  /** Relative lift (treatment over control) */
  relativeLift: number
  /** Absolute lift */
  absoluteLift: number
  /** Confidence interval for the lift */
  liftConfidenceInterval: ConfidenceInterval
  /** Statistical significance result */
  significance: SignificanceResult
  /** Probability that treatment is better than control (Bayesian) */
  probabilityToBeatControl: number
  /** Recommended decision */
  recommendation: 'winner' | 'loser' | 'inconclusive' | 'continue'
}

/**
 * Full experiment analysis result
 */
export interface ExperimentAnalysis {
  /** Experiment ID */
  experimentId: string
  /** Goal ID */
  goalId: string
  /** Overall sample size */
  totalSampleSize: number
  /** Whether minimum sample size has been reached */
  hasMinimumSample: boolean
  /** Required minimum sample size */
  minimumSampleSize: number
  /** Pairwise comparisons (treatment vs control) */
  comparisons: VariantComparison[]
  /** Best performing variant */
  bestVariant: string | null
  /** Statistical power achieved */
  power: number
  /** Overall recommendation */
  overallRecommendation: 'significant_winner' | 'no_difference' | 'need_more_data'
  /** Days of data analyzed */
  daysOfData?: number
  /** Estimated days until significance */
  estimatedDaysToSignificance?: number
}

/**
 * Options for statistical analysis
 */
export interface AnalysisOptions {
  /** Significance level (alpha), default 0.05 */
  alpha?: number
  /** Desired statistical power, default 0.8 */
  power?: number
  /** Minimum detectable effect (relative), default 0.05 */
  mde?: number
  /** Minimum sample size per variant, default 100 */
  minSampleSize?: number
  /** Use one-tailed or two-tailed test, default 'two-tailed' */
  tails?: 'one-tailed' | 'two-tailed'
  /** Bayesian prior (alpha, beta for Beta distribution), default [1, 1] */
  prior?: [number, number]
}

// =============================================================================
// STATISTICAL FUNCTIONS
// =============================================================================

/**
 * Standard normal CDF (cumulative distribution function)
 * Using the error function approximation
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
 * Inverse standard normal CDF (quantile function)
 * Using rational approximation
 */
function normalInverseCDF(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity

  // Coefficients for approximation
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.383577518672690e2,
    -3.066479806614716e1,
    2.506628277459239e0,
  ]
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ]
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838e0,
    -2.549732539343734e0,
    4.374664141464968e0,
    2.938163982698783e0,
  ]
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996e0,
    3.754408661907416e0,
  ]

  const pLow = 0.02425
  const pHigh = 1 - pLow

  let q: number, r: number

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= pHigh) {
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
}

/**
 * Chi-squared CDF approximation using Wilson-Hilferty transformation
 */
function chiSquaredCDF(x: number, df: number): number {
  if (x <= 0) return 0
  if (df <= 0) return 0

  // Wilson-Hilferty transformation
  const z = Math.pow(x / df, 1 / 3) - (1 - 2 / (9 * df))
  const stdErr = Math.sqrt(2 / (9 * df))
  return normalCDF(z / stdErr)
}

/**
 * T-distribution CDF approximation
 */
function tDistributionCDF(t: number, df: number): number {
  // For large df, use normal approximation
  if (df > 100) {
    return normalCDF(t)
  }

  // Using the incomplete beta function relationship
  const x = df / (df + t * t)
  const a = df / 2
  const b = 0.5

  // Regularized incomplete beta function approximation
  // This is a simplified version; for production, use a proper library
  let result = incompleteBeta(x, a, b)

  if (t >= 0) {
    return 1 - 0.5 * result
  } else {
    return 0.5 * result
  }
}

/**
 * Incomplete beta function approximation
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x === 0) return 0
  if (x === 1) return 1

  // Simple series expansion for small x
  const terms = 100
  let sum = 0
  let term = 1

  for (let n = 0; n < terms; n++) {
    if (n > 0) {
      term *= (n - 1 - b) / n * x
    }
    sum += term / (a + n)
  }

  return Math.pow(x, a) * sum / beta(a, b)
}

/**
 * Beta function
 */
function beta(a: number, b: number): number {
  return Math.exp(logGamma(a) + logGamma(b) - logGamma(a + b))
}

/**
 * Log gamma function (Stirling approximation)
 */
function logGamma(x: number): number {
  if (x <= 0) return Infinity

  // Coefficients for Lanczos approximation
  const g = 7
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ]

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  }

  x -= 1
  let a = c[0]
  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i)
  }

  const t = x + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

// =============================================================================
// STATISTICAL TESTS
// =============================================================================

/**
 * Perform a two-proportion z-test
 */
export function zTestProportions(
  n1: number,
  x1: number,
  n2: number,
  x2: number,
  alpha: number = 0.05,
  tails: 'one-tailed' | 'two-tailed' = 'two-tailed'
): SignificanceResult {
  const p1 = x1 / n1
  const p2 = x2 / n2

  // Pooled proportion
  const pPooled = (x1 + x2) / (n1 + n2)

  // Standard error
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2))

  // Z statistic
  const z = se > 0 ? (p1 - p2) / se : 0

  // P-value
  let pValue: number
  if (tails === 'one-tailed') {
    pValue = 1 - normalCDF(Math.abs(z))
  } else {
    pValue = 2 * (1 - normalCDF(Math.abs(z)))
  }

  // Cohen's h (effect size for proportions)
  const phi1 = 2 * Math.asin(Math.sqrt(p1))
  const phi2 = 2 * Math.asin(Math.sqrt(p2))
  const cohensH = Math.abs(phi1 - phi2)

  let effectSizeInterpretation: 'negligible' | 'small' | 'medium' | 'large'
  if (cohensH < 0.2) {
    effectSizeInterpretation = 'negligible'
  } else if (cohensH < 0.5) {
    effectSizeInterpretation = 'small'
  } else if (cohensH < 0.8) {
    effectSizeInterpretation = 'medium'
  } else {
    effectSizeInterpretation = 'large'
  }

  return {
    isSignificant: pValue < alpha,
    pValue,
    confidence: 1 - alpha,
    testStatistic: z,
    testType: 'z-test',
    effectSize: cohensH,
    effectSizeInterpretation,
  }
}

/**
 * Perform a chi-squared test for independence
 */
export function chiSquaredTest(
  observed: number[][],
  alpha: number = 0.05
): SignificanceResult {
  const rows = observed.length
  const cols = observed[0].length

  // Calculate row and column totals
  const rowTotals = observed.map(row => row.reduce((a, b) => a + b, 0))
  const colTotals: number[] = []
  for (let j = 0; j < cols; j++) {
    colTotals.push(observed.reduce((sum, row) => sum + row[j], 0))
  }
  const total = rowTotals.reduce((a, b) => a + b, 0)

  // Calculate expected values and chi-squared statistic
  let chiSquared = 0
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const expected = (rowTotals[i] * colTotals[j]) / total
      if (expected > 0) {
        chiSquared += Math.pow(observed[i][j] - expected, 2) / expected
      }
    }
  }

  const df = (rows - 1) * (cols - 1)
  const pValue = 1 - chiSquaredCDF(chiSquared, df)

  // Cramer's V (effect size)
  const n = total
  const minDim = Math.min(rows - 1, cols - 1)
  const cramersV = Math.sqrt(chiSquared / (n * minDim))

  let effectSizeInterpretation: 'negligible' | 'small' | 'medium' | 'large'
  if (cramersV < 0.1) {
    effectSizeInterpretation = 'negligible'
  } else if (cramersV < 0.3) {
    effectSizeInterpretation = 'small'
  } else if (cramersV < 0.5) {
    effectSizeInterpretation = 'medium'
  } else {
    effectSizeInterpretation = 'large'
  }

  return {
    isSignificant: pValue < alpha,
    pValue,
    confidence: 1 - alpha,
    testStatistic: chiSquared,
    testType: 'chi-squared',
    degreesOfFreedom: df,
    effectSize: cramersV,
    effectSizeInterpretation,
  }
}

/**
 * Perform a two-sample t-test
 */
export function tTest(
  values1: number[],
  values2: number[],
  alpha: number = 0.05,
  tails: 'one-tailed' | 'two-tailed' = 'two-tailed'
): SignificanceResult {
  const n1 = values1.length
  const n2 = values2.length

  if (n1 < 2 || n2 < 2) {
    return {
      isSignificant: false,
      pValue: 1,
      confidence: 1 - alpha,
      testStatistic: 0,
      testType: 't-test',
      degreesOfFreedom: 0,
    }
  }

  const mean1 = values1.reduce((a, b) => a + b, 0) / n1
  const mean2 = values2.reduce((a, b) => a + b, 0) / n2

  const var1 = values1.reduce((sum, x) => sum + Math.pow(x - mean1, 2), 0) / (n1 - 1)
  const var2 = values2.reduce((sum, x) => sum + Math.pow(x - mean2, 2), 0) / (n2 - 1)

  // Welch's t-test (unequal variances)
  const se = Math.sqrt(var1 / n1 + var2 / n2)
  const t = se > 0 ? (mean1 - mean2) / se : 0

  // Welch-Satterthwaite degrees of freedom
  const dfNum = Math.pow(var1 / n1 + var2 / n2, 2)
  const dfDen = Math.pow(var1 / n1, 2) / (n1 - 1) + Math.pow(var2 / n2, 2) / (n2 - 1)
  const df = dfDen > 0 ? dfNum / dfDen : n1 + n2 - 2

  // P-value
  let pValue: number
  if (tails === 'one-tailed') {
    pValue = 1 - tDistributionCDF(Math.abs(t), df)
  } else {
    pValue = 2 * (1 - tDistributionCDF(Math.abs(t), df))
  }

  // Cohen's d (effect size)
  const pooledStd = Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))
  const cohensD = pooledStd > 0 ? Math.abs(mean1 - mean2) / pooledStd : 0

  let effectSizeInterpretation: 'negligible' | 'small' | 'medium' | 'large'
  if (cohensD < 0.2) {
    effectSizeInterpretation = 'negligible'
  } else if (cohensD < 0.5) {
    effectSizeInterpretation = 'small'
  } else if (cohensD < 0.8) {
    effectSizeInterpretation = 'medium'
  } else {
    effectSizeInterpretation = 'large'
  }

  return {
    isSignificant: pValue < alpha,
    pValue,
    confidence: 1 - alpha,
    testStatistic: t,
    testType: 't-test',
    degreesOfFreedom: df,
    effectSize: cohensD,
    effectSizeInterpretation,
  }
}

// =============================================================================
// CONFIDENCE INTERVALS
// =============================================================================

/**
 * Calculate confidence interval for a proportion
 */
export function proportionConfidenceInterval(
  n: number,
  x: number,
  confidenceLevel: number = 0.95
): ConfidenceInterval {
  const p = x / n
  const alpha = 1 - confidenceLevel
  const z = normalInverseCDF(1 - alpha / 2)

  // Wilson score interval (more accurate for small samples)
  const center = (p + z * z / (2 * n)) / (1 + z * z / n)
  const margin = (z / (1 + z * z / n)) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))

  return {
    lower: Math.max(0, center - margin),
    estimate: p,
    upper: Math.min(1, center + margin),
    confidenceLevel,
    marginOfError: margin,
  }
}

/**
 * Calculate confidence interval for the difference between two proportions
 */
export function proportionDifferenceCI(
  n1: number,
  x1: number,
  n2: number,
  x2: number,
  confidenceLevel: number = 0.95
): ConfidenceInterval {
  const p1 = x1 / n1
  const p2 = x2 / n2
  const diff = p1 - p2

  const alpha = 1 - confidenceLevel
  const z = normalInverseCDF(1 - alpha / 2)

  // Standard error of the difference
  const se = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
  const margin = z * se

  return {
    lower: diff - margin,
    estimate: diff,
    upper: diff + margin,
    confidenceLevel,
    marginOfError: margin,
  }
}

/**
 * Calculate confidence interval for relative lift
 */
export function relativeLiftCI(
  n1: number,
  x1: number,
  n2: number,
  x2: number,
  confidenceLevel: number = 0.95
): ConfidenceInterval {
  const p1 = x1 / n1
  const p2 = x2 / n2

  if (p2 === 0) {
    return {
      lower: 0,
      estimate: 0,
      upper: Infinity,
      confidenceLevel,
      marginOfError: Infinity,
    }
  }

  const lift = (p1 - p2) / p2

  // Delta method for variance of ratio
  const alpha = 1 - confidenceLevel
  const z = normalInverseCDF(1 - alpha / 2)

  const var1 = p1 * (1 - p1) / n1
  const var2 = p2 * (1 - p2) / n2
  const seRatio = Math.sqrt(var1 / (p2 * p2) + (p1 * p1 * var2) / (p2 * p2 * p2 * p2))
  const margin = z * seRatio

  return {
    lower: lift - margin,
    estimate: lift,
    upper: lift + margin,
    confidenceLevel,
    marginOfError: margin,
  }
}

// =============================================================================
// SAMPLE SIZE CALCULATIONS
// =============================================================================

/**
 * Calculate required sample size for detecting an effect
 */
export function calculateSampleSize(
  baselineRate: number,
  mde: number,
  alpha: number = 0.05,
  power: number = 0.8,
  tails: 'one-tailed' | 'two-tailed' = 'two-tailed'
): SampleSizeResult {
  const p1 = baselineRate
  const p2 = baselineRate * (1 + mde)

  // Z values
  const zAlpha = tails === 'two-tailed'
    ? normalInverseCDF(1 - alpha / 2)
    : normalInverseCDF(1 - alpha)
  const zBeta = normalInverseCDF(power)

  // Pooled proportion for sample size calculation
  const pPooled = (p1 + p2) / 2

  // Sample size formula for two proportions
  const numerator = Math.pow(zAlpha * Math.sqrt(2 * pPooled * (1 - pPooled)) +
                            zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2)
  const denominator = Math.pow(p2 - p1, 2)

  const sampleSizePerVariant = Math.ceil(numerator / denominator)

  return {
    sampleSizePerVariant,
    totalSampleSize: sampleSizePerVariant * 2,
    mde,
    power,
    alpha,
  }
}

/**
 * Calculate statistical power given current sample sizes
 */
export function calculatePower(
  n1: number,
  n2: number,
  p1: number,
  p2: number,
  alpha: number = 0.05,
  tails: 'one-tailed' | 'two-tailed' = 'two-tailed'
): number {
  if (n1 === 0 || n2 === 0) return 0

  const pPooled = (p1 * n1 + p2 * n2) / (n1 + n2)
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2))

  if (se === 0) return 0

  const zAlpha = tails === 'two-tailed'
    ? normalInverseCDF(1 - alpha / 2)
    : normalInverseCDF(1 - alpha)

  const effectSE = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
  const ncp = Math.abs(p2 - p1) / effectSE // Non-centrality parameter

  const criticalValue = zAlpha
  const power = 1 - normalCDF(criticalValue - ncp)

  return Math.min(1, Math.max(0, power))
}

// =============================================================================
// BAYESIAN ANALYSIS
// =============================================================================

/**
 * Calculate probability that treatment is better than control (Bayesian)
 */
export function probabilityToBeat(
  controlConversions: number,
  controlSampleSize: number,
  treatmentConversions: number,
  treatmentSampleSize: number,
  prior: [number, number] = [1, 1], // Beta(1,1) = uniform prior
  simulations: number = 10000
): number {
  // Beta distribution parameters with prior
  const alphaControl = prior[0] + controlConversions
  const betaControl = prior[1] + controlSampleSize - controlConversions
  const alphaTreatment = prior[0] + treatmentConversions
  const betaTreatment = prior[1] + treatmentSampleSize - treatmentConversions

  // Monte Carlo simulation
  let wins = 0
  for (let i = 0; i < simulations; i++) {
    const controlRate = sampleBeta(alphaControl, betaControl)
    const treatmentRate = sampleBeta(alphaTreatment, betaTreatment)
    if (treatmentRate > controlRate) {
      wins++
    }
  }

  return wins / simulations
}

/**
 * Sample from a Beta distribution using the rejection method
 */
function sampleBeta(alpha: number, beta: number): number {
  // Use the relationship between Beta and Gamma distributions
  const x = sampleGamma(alpha, 1)
  const y = sampleGamma(beta, 1)
  return x / (x + y)
}

/**
 * Sample from a Gamma distribution using Marsaglia and Tsang's method
 */
function sampleGamma(shape: number, scale: number): number {
  if (shape < 1) {
    // Use transformation for shape < 1
    return sampleGamma(1 + shape, scale) * Math.pow(Math.random(), 1 / shape)
  }

  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)

  while (true) {
    let x: number
    let v: number

    do {
      x = normalRandom()
      v = 1 + c * x
    } while (v <= 0)

    v = v * v * v
    const u = Math.random()

    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v * scale
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v * scale
    }
  }
}

/**
 * Generate a standard normal random variable using Box-Muller transform
 */
function normalRandom(): number {
  const u1 = Math.random()
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// =============================================================================
// EXPERIMENT ANALYSIS
// =============================================================================

/**
 * Perform full statistical analysis of an experiment
 */
export function analyzeExperiment(
  metrics: GoalMetrics,
  options: AnalysisOptions = {}
): ExperimentAnalysis {
  const alpha = options.alpha ?? 0.05
  const power = options.power ?? 0.8
  const mde = options.mde ?? 0.05
  const minSampleSize = options.minSampleSize ?? 100
  const prior = options.prior ?? [1, 1]

  const variantKeys = Object.keys(metrics.variants)
  const controlKey = metrics.controlVariant ?? variantKeys[0]
  const controlMetrics = metrics.variants[controlKey]

  if (!controlMetrics) {
    return {
      experimentId: metrics.experimentId,
      goalId: metrics.goalId,
      totalSampleSize: metrics.totalSampleSize,
      hasMinimumSample: false,
      minimumSampleSize: minSampleSize * variantKeys.length,
      comparisons: [],
      bestVariant: null,
      power: 0,
      overallRecommendation: 'need_more_data',
    }
  }

  const comparisons: VariantComparison[] = []
  let bestVariant: string | null = null
  let bestLift = -Infinity
  let hasSignificantWinner = false

  // Compare each treatment variant to control
  for (const variantKey of variantKeys) {
    if (variantKey === controlKey) continue

    const treatmentMetrics = metrics.variants[variantKey]
    if (!treatmentMetrics) continue

    // Calculate lifts
    const absoluteLift = treatmentMetrics.conversionRate - controlMetrics.conversionRate
    const relativeLift = controlMetrics.conversionRate > 0
      ? absoluteLift / controlMetrics.conversionRate
      : 0

    // Statistical significance test
    const significance = zTestProportions(
      treatmentMetrics.sampleSize,
      treatmentMetrics.conversions,
      controlMetrics.sampleSize,
      controlMetrics.conversions,
      alpha,
      options.tails ?? 'two-tailed'
    )

    // Confidence interval for lift
    const liftCI = relativeLiftCI(
      treatmentMetrics.sampleSize,
      treatmentMetrics.conversions,
      controlMetrics.sampleSize,
      controlMetrics.conversions,
      1 - alpha
    )

    // Bayesian probability
    const probToBeat = probabilityToBeat(
      controlMetrics.conversions,
      controlMetrics.sampleSize,
      treatmentMetrics.conversions,
      treatmentMetrics.sampleSize,
      prior
    )

    // Determine recommendation
    let recommendation: 'winner' | 'loser' | 'inconclusive' | 'continue'
    if (significance.isSignificant && relativeLift > 0) {
      recommendation = 'winner'
      hasSignificantWinner = true
    } else if (significance.isSignificant && relativeLift < 0) {
      recommendation = 'loser'
    } else if (treatmentMetrics.sampleSize < minSampleSize || controlMetrics.sampleSize < minSampleSize) {
      recommendation = 'continue'
    } else {
      recommendation = 'inconclusive'
    }

    comparisons.push({
      control: controlKey,
      treatment: variantKey,
      controlMetrics: {
        sampleSize: controlMetrics.sampleSize,
        conversions: controlMetrics.conversions,
        conversionRate: controlMetrics.conversionRate,
        mean: controlMetrics.meanValue,
        standardDeviation: controlMetrics.standardDeviation,
      },
      treatmentMetrics: {
        sampleSize: treatmentMetrics.sampleSize,
        conversions: treatmentMetrics.conversions,
        conversionRate: treatmentMetrics.conversionRate,
        mean: treatmentMetrics.meanValue,
        standardDeviation: treatmentMetrics.standardDeviation,
      },
      relativeLift,
      absoluteLift,
      liftConfidenceInterval: liftCI,
      significance,
      probabilityToBeatControl: probToBeat,
      recommendation,
    })

    // Track best variant
    if (relativeLift > bestLift && significance.isSignificant) {
      bestLift = relativeLift
      bestVariant = variantKey
    }
  }

  // Calculate achieved power
  const achievedPower = controlMetrics.conversionRate > 0
    ? calculatePower(
        controlMetrics.sampleSize,
        controlMetrics.sampleSize,
        controlMetrics.conversionRate,
        controlMetrics.conversionRate * (1 + mde),
        alpha
      )
    : 0

  // Check if minimum sample has been reached
  const hasMinimumSample = Object.values(metrics.variants).every(v => v.sampleSize >= minSampleSize)

  // Overall recommendation
  let overallRecommendation: 'significant_winner' | 'no_difference' | 'need_more_data'
  if (hasSignificantWinner && hasMinimumSample) {
    overallRecommendation = 'significant_winner'
  } else if (hasMinimumSample && achievedPower >= power) {
    overallRecommendation = 'no_difference'
  } else {
    overallRecommendation = 'need_more_data'
  }

  return {
    experimentId: metrics.experimentId,
    goalId: metrics.goalId,
    totalSampleSize: metrics.totalSampleSize,
    hasMinimumSample,
    minimumSampleSize: minSampleSize * variantKeys.length,
    comparisons,
    bestVariant,
    power: achievedPower,
    overallRecommendation,
  }
}

/**
 * Estimate days until statistical significance
 */
export function estimateDaysToSignificance(
  currentSampleSize: number,
  dailyTraffic: number,
  baselineRate: number,
  mde: number = 0.05,
  alpha: number = 0.05,
  power: number = 0.8
): number {
  const required = calculateSampleSize(baselineRate, mde, alpha, power)
  const remaining = Math.max(0, required.totalSampleSize - currentSampleSize)
  return dailyTraffic > 0 ? Math.ceil(remaining / dailyTraffic) : Infinity
}
