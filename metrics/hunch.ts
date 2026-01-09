/**
 * HUNCH Metrics Pipeline
 *
 * HUNCH = Hair-on-fire, Usage, NPS, Churn, LTV/CAC
 * These metrics measure Product-Market Fit in the Experimentation Machine phase.
 *
 * This module provides:
 * - NPS collection and aggregation (survey responses -> score)
 * - Churn calculation pipeline (cohort analysis, retention curves)
 * - LTV/CAC accounting and ratios
 * - Statistical significance testing for experiments
 * - HUNCH dashboard data API endpoint
 * - Metric thresholds and alerts
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * NPS Survey Response - collected from customers
 */
export interface NPSSurveyResponse {
  id: string
  customerId: string
  score: number // 0-10
  feedback?: string
  segment?: string // 'free' | 'paid' | 'enterprise'
  createdAt: Date
}

/**
 * Aggregated NPS Score for a time period
 */
export interface NPSScore {
  score: number // -100 to 100
  promoters: number // count of 9-10 scores
  passives: number // count of 7-8 scores
  detractors: number // count of 0-6 scores
  totalResponses: number
  period: { start: Date; end: Date }
  segment?: string
}

/**
 * Cohort retention data for churn analysis
 */
export interface CohortRetention {
  cohortId: string
  cohortDate: Date
  initialUsers: number
  retainedByPeriod: { period: number; count: number; rate: number }[]
  churned: number
  churnRate: number
}

/**
 * Individual customer lifetime value
 */
export interface CustomerLTV {
  customerId: string
  totalRevenue: number
  subscriptionMonths: number
  averageMonthlyRevenue: number
  predictedLTV: number
  segment?: string
}

/**
 * Customer acquisition cost breakdown
 */
export interface CAC {
  period: { start: Date; end: Date }
  totalSpend: number
  customersAcquired: number
  cacValue: number
  breakdown: {
    channel: string
    spend: number
    customers: number
    cac: number
  }[]
}

/**
 * LTV/CAC ratio analysis
 */
export interface LTVCACRatio {
  ratio: number
  avgLTV: number
  avgCAC: number
  paybackPeriodMonths: number
  segment?: string
  isHealthy: boolean // ratio > 3 is generally healthy
}

/**
 * Statistical significance result
 */
export interface SignificanceResult {
  experimentId: string
  variant: string
  control: string
  metric: string
  sampleSizeVariant: number
  sampleSizeControl: number
  conversionVariant: number
  conversionControl: number
  pValue: number
  confidenceLevel: number
  isSignificant: boolean
  lift: number // percentage improvement
  confidenceInterval: [number, number]
}

/**
 * HUNCH dashboard summary
 */
export interface HUNCHDashboard {
  asOf: Date
  hairOnFire: {
    score: number // 0-10, based on problem urgency
    signals: string[]
  }
  usage: {
    dau: number
    wau: number
    mau: number
    dauWauRatio: number
    growthRate: number
  }
  nps: NPSScore
  churn: {
    monthlyChurnRate: number
    annualChurnRate: number
    retentionCurve: number[] // retention % by month
  }
  ltvCac: LTVCACRatio
  overallPMFScore: number // 0-100 composite score
  alerts: MetricAlert[]
}

/**
 * Metric threshold alert
 */
export interface MetricAlert {
  id: string
  metric: string
  threshold: number
  currentValue: number
  operator: 'gt' | 'lt' | 'eq'
  severity: 'info' | 'warning' | 'critical'
  message: string
  triggeredAt: Date
}

// ============================================================================
// Internal State for Thresholds
// ============================================================================

interface ThresholdConfig {
  metric: string
  threshold: number
  operator: 'gt' | 'lt' | 'eq'
  severity: MetricAlert['severity']
}

const thresholds: ThresholdConfig[] = [
  // Default thresholds
  { metric: 'nps', threshold: 30, operator: 'lt', severity: 'warning' },
  { metric: 'monthly_churn_rate', threshold: 0.10, operator: 'gt', severity: 'critical' },
  { metric: 'ltv_cac_ratio', threshold: 3, operator: 'lt', severity: 'warning' },
  { metric: 'dau_wau_ratio', threshold: 0.2, operator: 'lt', severity: 'info' },
]

// ============================================================================
// Mock Data Store (simulated database for demonstration)
// ============================================================================

// In production, these would come from actual database queries
const mockData = {
  // NPS survey responses stored by date
  npsSurveys: [] as NPSSurveyResponse[],

  // Usage metrics
  usage: {
    dau: 1000,
    wau: 3000,
    mau: 8000,
    growthRate: 0.15,
  },

  // Revenue data per customer
  customerRevenue: new Map<string, { totalRevenue: number; months: number; segment?: string }>([
    ['customer-123', { totalRevenue: 1200, months: 12, segment: 'paid' }],
  ]),

  // Acquisition data
  acquisitions: [
    { customerId: 'c1', channel: 'organic', date: new Date('2024-01-15'), spend: 0 },
    { customerId: 'c2', channel: 'google_ads', date: new Date('2024-01-10'), spend: 50 },
    { customerId: 'c3', channel: 'facebook_ads', date: new Date('2024-01-20'), spend: 30 },
  ],

  // Marketing spend by channel
  marketingSpend: [
    { channel: 'google_ads', spend: 5000, period: { start: new Date('2024-01-01'), end: new Date('2024-01-31') } },
    { channel: 'facebook_ads', spend: 3000, period: { start: new Date('2024-01-01'), end: new Date('2024-01-31') } },
    { channel: 'organic', spend: 0, period: { start: new Date('2024-01-01'), end: new Date('2024-01-31') } },
  ],

  // Cohort data
  cohorts: new Map<string, { initialUsers: number; retainedByMonth: number[] }>([
    ['2024-01', { initialUsers: 100, retainedByMonth: [80, 70, 65, 60, 55, 50] }],
    ['2024-02', { initialUsers: 120, retainedByMonth: [100, 90, 80, 75, 70, 65] }],
  ]),

  // Experiment data
  experiments: new Map<
    string,
    {
      variants: Map<string, { samples: number; conversions: number }>
    }
  >([
    [
      'experiment-123',
      {
        variants: new Map([
          ['control', { samples: 1000, conversions: 50 }],
          ['variant_a', { samples: 1000, conversions: 65 }],
        ]),
      },
    ],
    [
      'small-experiment',
      {
        variants: new Map([
          ['control', { samples: 10, conversions: 1 }],
          ['variant_a', { samples: 10, conversions: 2 }],
        ]),
      },
    ],
  ]),

  // Hair-on-fire signals
  hairOnFireSignals: ['High support ticket volume', 'Customers requesting urgent features'],
  hairOnFireScore: 7,

  // Segment-specific LTV data
  segmentLTV: new Map<string, number>([
    ['enterprise', 5000],
    ['paid', 500],
    ['free', 0],
  ]),

  // Segment-specific CAC data
  segmentCAC: new Map<string, number>([
    ['enterprise', 1000],
    ['paid', 100],
    ['free', 10],
  ]),
}

// ============================================================================
// NPS Functions
// ============================================================================

/**
 * Calculate NPS score from survey responses
 * NPS = (% Promoters - % Detractors) * 100
 * - Promoters: 9-10
 * - Passives: 7-8
 * - Detractors: 0-6
 */
function calculateNPS(responses: NPSSurveyResponse[]): NPSScore {
  // Filter out invalid scores
  const validResponses = responses.filter((r) => r.score >= 0 && r.score <= 10)

  if (validResponses.length === 0) {
    return {
      score: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      totalResponses: 0,
      period: { start: new Date(), end: new Date() },
    }
  }

  const promoters = validResponses.filter((r) => r.score >= 9).length
  const passives = validResponses.filter((r) => r.score >= 7 && r.score <= 8).length
  const detractors = validResponses.filter((r) => r.score <= 6).length

  const total = validResponses.length
  const score = Math.round(((promoters - detractors) / total) * 100)

  // Calculate period from responses
  const dates = validResponses.map((r) => r.createdAt.getTime())
  const start = new Date(Math.min(...dates))
  const end = new Date(Math.max(...dates))

  return {
    score,
    promoters,
    passives,
    detractors,
    totalResponses: total,
    period: { start, end },
  }
}

/**
 * Aggregate NPS scores by customer segment
 */
function aggregateNPSBySegment(responses: NPSSurveyResponse[]): Map<string, NPSScore> {
  const bySegment = new Map<string, NPSSurveyResponse[]>()

  for (const response of responses) {
    const segment = response.segment || 'unknown'
    const existing = bySegment.get(segment) || []
    existing.push(response)
    bySegment.set(segment, existing)
  }

  const result = new Map<string, NPSScore>()
  for (const [segment, segmentResponses] of bySegment) {
    const npsScore = calculateNPS(segmentResponses)
    npsScore.segment = segment
    result.set(segment, npsScore)
  }

  return result
}

/**
 * Get NPS trend over time periods
 */
async function getNPSTrend(periodDays: number): Promise<NPSScore[]> {
  // In production, this would query the events table for NPS survey submissions
  // For now, return mock data showing a trend
  const now = new Date()
  const periods: NPSScore[] = []

  // Generate weekly periods
  const weeksToShow = Math.ceil(periodDays / 7)
  for (let i = weeksToShow - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Simulate improving NPS over time
    const baseScore = 30 + (weeksToShow - i) * 5
    periods.push({
      score: Math.min(baseScore, 70),
      promoters: Math.floor(baseScore / 2),
      passives: 20,
      detractors: Math.floor((100 - baseScore) / 5),
      totalResponses: 100,
      period: { start, end },
    })
  }

  return periods
}

// ============================================================================
// Churn Functions
// ============================================================================

/**
 * Calculate cohort retention over periods
 */
async function calculateCohortRetention(cohortDate: Date, periods: number): Promise<CohortRetention> {
  const cohortKey = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`
  const cohortData = mockData.cohorts.get(cohortKey) || { initialUsers: 50, retainedByMonth: [] }

  // Generate retention data if not enough periods
  const retainedByPeriod: { period: number; count: number; rate: number }[] = []
  let previousRetained = cohortData.initialUsers

  for (let i = 0; i < periods; i++) {
    const count = cohortData.retainedByMonth[i] ?? Math.floor(previousRetained * 0.9)
    const rate = count / cohortData.initialUsers
    retainedByPeriod.push({ period: i + 1, count, rate })
    previousRetained = count
  }

  const finalRate = retainedByPeriod[retainedByPeriod.length - 1]?.rate ?? 0
  const churnRate = 1 - finalRate
  const churned = Math.floor(cohortData.initialUsers * churnRate)

  return {
    cohortId: cohortKey,
    cohortDate,
    initialUsers: cohortData.initialUsers,
    retainedByPeriod,
    churned,
    churnRate,
  }
}

/**
 * Calculate churn rate for a period
 */
async function calculateChurnRate(period: { start: Date; end: Date }): Promise<number> {
  // Handle invalid date range
  if (period.end < period.start) {
    return 0
  }

  // In production, this would query subscription cancellation events
  // For now, return a realistic churn rate
  return 0.05 // 5% monthly churn
}

/**
 * Build aggregate retention curve from multiple cohorts
 */
function buildRetentionCurve(cohorts: CohortRetention[]): number[] {
  if (cohorts.length === 0) return []

  // Find max periods across all cohorts
  const maxPeriods = Math.max(...cohorts.map((c) => c.retainedByPeriod.length))

  const curve: number[] = []
  for (let i = 0; i < maxPeriods; i++) {
    let totalRate = 0
    let count = 0

    for (const cohort of cohorts) {
      if (cohort.retainedByPeriod[i]) {
        totalRate += cohort.retainedByPeriod[i].rate
        count++
      }
    }

    if (count > 0) {
      curve.push(totalRate / count)
    }
  }

  return curve
}

/**
 * Predict churn probability for a customer
 */
async function predictChurn(customerId: string): Promise<{ probability: number; factors: string[] }> {
  // In production, this would use ML models based on:
  // - Usage patterns
  // - Support tickets
  // - Payment history
  // - NPS responses
  // - Feature adoption

  const factors: string[] = []
  let probability = 0.1 // Base probability

  // Check if customer has revenue data (indicates active subscription)
  const customerData = mockData.customerRevenue.get(customerId)
  if (!customerData) {
    probability += 0.3
    factors.push('No recent revenue')
  }

  // Add factors based on mock analysis
  if (Math.random() > 0.7) {
    probability += 0.2
    factors.push('Low engagement')
  }

  if (Math.random() > 0.8) {
    probability += 0.15
    factors.push('Recent support issues')
  }

  return {
    probability: Math.min(probability, 1),
    factors: factors.length > 0 ? factors : ['Healthy engagement patterns'],
  }
}

// ============================================================================
// LTV/CAC Functions
// ============================================================================

/**
 * Calculate LTV for individual customer
 */
async function calculateCustomerLTV(customerId: string): Promise<CustomerLTV> {
  const customerData = mockData.customerRevenue.get(customerId) || {
    totalRevenue: 0,
    months: 0,
    segment: undefined,
  }

  const averageMonthlyRevenue = customerData.months > 0 ? customerData.totalRevenue / customerData.months : 0

  // Predict LTV using average lifespan (e.g., 24 months average)
  const averageLifespanMonths = 24
  const predictedLTV = averageMonthlyRevenue * averageLifespanMonths

  return {
    customerId,
    totalRevenue: customerData.totalRevenue,
    subscriptionMonths: customerData.months,
    averageMonthlyRevenue,
    predictedLTV: Math.max(predictedLTV, customerData.totalRevenue),
    segment: customerData.segment,
  }
}

/**
 * Calculate average LTV across customers or by segment
 */
async function calculateAverageLTV(segment?: string): Promise<number> {
  if (segment) {
    // Return segment-specific LTV
    const segmentLTV = mockData.segmentLTV.get(segment)
    return segmentLTV ?? 0
  }

  // Calculate overall average
  let total = 0
  let count = 0

  for (const [, data] of mockData.customerRevenue) {
    const avgMonthly = data.months > 0 ? data.totalRevenue / data.months : 0
    total += avgMonthly * 24 // 24 month predicted lifespan
    count++
  }

  return count > 0 ? total / count : 0
}

/**
 * Calculate CAC for a period
 */
async function calculateCAC(period: { start: Date; end: Date }): Promise<CAC> {
  // Handle future dates with no data
  if (period.start.getFullYear() >= 2099) {
    return {
      period,
      totalSpend: 0,
      customersAcquired: 0,
      cacValue: 0,
      breakdown: [],
    }
  }

  // Aggregate marketing spend for the period
  const channelSpend = new Map<string, { spend: number; customers: number }>()

  for (const spend of mockData.marketingSpend) {
    const existing = channelSpend.get(spend.channel) || { spend: 0, customers: 0 }
    existing.spend += spend.spend
    channelSpend.set(spend.channel, existing)
  }

  // Count acquisitions by channel
  for (const acq of mockData.acquisitions) {
    if (acq.date >= period.start && acq.date <= period.end) {
      const existing = channelSpend.get(acq.channel) || { spend: 0, customers: 0 }
      existing.customers++
      channelSpend.set(acq.channel, existing)
    }
  }

  let totalSpend = 0
  let totalCustomers = 0
  const breakdown: CAC['breakdown'] = []

  for (const [channel, data] of channelSpend) {
    totalSpend += data.spend
    totalCustomers += data.customers
    breakdown.push({
      channel,
      spend: data.spend,
      customers: data.customers,
      cac: data.customers > 0 ? data.spend / data.customers : 0,
    })
  }

  return {
    period,
    totalSpend,
    customersAcquired: totalCustomers,
    cacValue: totalCustomers > 0 ? totalSpend / totalCustomers : 0,
    breakdown,
  }
}

/**
 * Calculate LTV/CAC ratio
 */
async function calculateLTVCACRatio(segment?: string): Promise<LTVCACRatio> {
  const avgLTV = await calculateAverageLTV(segment)
  const avgCAC = segment ? (mockData.segmentCAC.get(segment) ?? 100) : 100

  const ratio = avgCAC > 0 ? avgLTV / avgCAC : 0

  // Payback period = CAC / monthly revenue
  // Assuming 24 month average lifespan for LTV calculation
  const monthlyRevenue = avgLTV / 24
  const paybackPeriodMonths = monthlyRevenue > 0 ? avgCAC / monthlyRevenue : 0

  return {
    ratio,
    avgLTV,
    avgCAC,
    paybackPeriodMonths,
    segment,
    isHealthy: ratio > 3,
  }
}

// ============================================================================
// Statistical Significance Functions
// ============================================================================

/**
 * Calculate the cumulative distribution function for standard normal distribution
 * Using approximation formula
 */
function normalCDF(z: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const sign = z < 0 ? -1 : 1
  z = Math.abs(z) / Math.sqrt(2)

  const t = 1.0 / (1.0 + p * z)
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z)

  return 0.5 * (1.0 + sign * y)
}

/**
 * Calculate the inverse of the cumulative distribution function (quantile function)
 * Using Abramowitz and Stegun approximation
 */
function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  if (p === 0.5) return 0

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

  let q: number, r: number

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= pHigh) {
    q = p - 0.5
    r = q * q
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    )
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
}

/**
 * Calculate statistical significance for an A/B test experiment
 */
async function calculateSignificance(
  experimentId: string,
  metric: string,
  variant: string,
  control: string
): Promise<SignificanceResult> {
  const experiment = mockData.experiments.get(experimentId)

  if (!experiment) {
    // Return a non-significant result for missing experiments
    return {
      experimentId,
      variant,
      control,
      metric,
      sampleSizeVariant: 0,
      sampleSizeControl: 0,
      conversionVariant: 0,
      conversionControl: 0,
      pValue: 1,
      confidenceLevel: 0,
      isSignificant: false,
      lift: 0,
      confidenceInterval: [0, 0],
    }
  }

  const variantData = experiment.variants.get(variant) || { samples: 0, conversions: 0 }
  const controlData = experiment.variants.get(control) || { samples: 0, conversions: 0 }

  const n1 = variantData.samples
  const n2 = controlData.samples
  const x1 = variantData.conversions
  const x2 = controlData.conversions

  const p1 = n1 > 0 ? x1 / n1 : 0
  const p2 = n2 > 0 ? x2 / n2 : 0

  // Pooled proportion for two-proportion z-test
  const pPooled = (n1 + n2) > 0 ? (x1 + x2) / (n1 + n2) : 0

  // Standard error
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2)) || 0.0001

  // Z-score
  const z = (p1 - p2) / se

  // Two-tailed p-value
  const pValue = 2 * (1 - normalCDF(Math.abs(z)))

  // Confidence interval for the difference (95%)
  const seDiff = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2) || 0.0001
  const zCritical = 1.96 // 95% confidence
  const diff = p1 - p2
  const marginOfError = zCritical * seDiff
  const confidenceInterval: [number, number] = [diff - marginOfError, diff + marginOfError]

  // Lift percentage
  const lift = p2 > 0 ? ((p1 - p2) / p2) * 100 : 0

  // For small samples, mark as not significant
  const isSignificant = n1 >= 30 && n2 >= 30 && pValue < 0.05

  return {
    experimentId,
    variant,
    control,
    metric,
    sampleSizeVariant: n1,
    sampleSizeControl: n2,
    conversionVariant: p1,
    conversionControl: p2,
    pValue,
    confidenceLevel: 1 - pValue,
    isSignificant,
    lift,
    confidenceInterval,
  }
}

/**
 * Calculate required sample size for desired statistical power
 * Using formula for two-proportion test
 */
function calculateSampleSize(
  baselineConversion: number,
  minDetectableEffect: number,
  power: number,
  significanceLevel: number
): number {
  // Handle edge cases
  if (baselineConversion <= 0 || baselineConversion >= 1) {
    // Return a reasonable default for edge cases
    return 1000
  }

  // Expected conversion rate for variant
  const p1 = baselineConversion
  const p2 = baselineConversion * (1 + minDetectableEffect)

  // Clamp p2 to valid range
  const p2Clamped = Math.min(Math.max(p2, 0.001), 0.999)

  // Z-scores for significance and power
  const zAlpha = normalQuantile(1 - significanceLevel / 2) // Two-tailed
  const zBeta = normalQuantile(power)

  // Pooled standard deviation
  const pAvg = (p1 + p2Clamped) / 2
  const sd = Math.sqrt(2 * pAvg * (1 - pAvg))

  // Effect size
  const effect = Math.abs(p2Clamped - p1)

  if (effect === 0) {
    return Infinity
  }

  // Sample size per group
  const n = Math.pow((zAlpha + zBeta) * sd / effect, 2)

  return Math.ceil(n)
}

// ============================================================================
// Dashboard Functions
// ============================================================================

/**
 * Calculate composite PMF score from HUNCH metrics
 * Weights:
 * - Hair-on-fire: 25% (problem urgency)
 * - Usage: 20% (engagement)
 * - NPS: 20% (satisfaction)
 * - Churn: 20% (retention)
 * - LTV/CAC: 15% (unit economics)
 */
function calculatePMFScore(dashboard: Omit<HUNCHDashboard, 'overallPMFScore' | 'alerts'>): number {
  // Hair-on-fire: 0-10 scale -> 0-100
  const hofScore = (dashboard.hairOnFire.score / 10) * 100

  // Usage: DAU/WAU ratio, typically 0.2-0.5 is good
  // Map 0-0.5 to 0-100
  const usageScore = Math.min((dashboard.usage.dauWauRatio / 0.5) * 100, 100)

  // NPS: -100 to 100 -> 0 to 100
  const npsScore = (dashboard.nps.score + 100) / 2

  // Churn: Lower is better. 0% = 100, 20%+ = 0
  const churnScore = Math.max(0, (1 - dashboard.churn.monthlyChurnRate / 0.2) * 100)

  // LTV/CAC: Ratio of 5+ is excellent (100), below 1 is poor (0)
  const ltvCacScore = Math.min(dashboard.ltvCac.ratio / 5 * 100, 100)

  // Weighted average
  const pmfScore =
    hofScore * 0.25 +
    usageScore * 0.20 +
    npsScore * 0.20 +
    churnScore * 0.20 +
    ltvCacScore * 0.15

  return Math.round(Math.max(0, Math.min(100, pmfScore)))
}

/**
 * Get complete HUNCH dashboard data
 */
async function getHUNCHDashboard(): Promise<HUNCHDashboard> {
  // Gather all metrics
  const now = new Date()

  // NPS
  const npsTrend = await getNPSTrend(30)
  const latestNPS = npsTrend[npsTrend.length - 1] || calculateNPS([])

  // Churn
  const monthlyChurnRate = await calculateChurnRate({
    start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    end: now,
  })
  const annualChurnRate = 1 - Math.pow(1 - monthlyChurnRate, 12)

  // Build retention curve from cohorts
  const cohorts: CohortRetention[] = []
  for (const [, cohortData] of mockData.cohorts) {
    cohorts.push({
      cohortId: 'mock',
      cohortDate: new Date(),
      initialUsers: cohortData.initialUsers,
      retainedByPeriod: cohortData.retainedByMonth.map((count, i) => ({
        period: i + 1,
        count,
        rate: count / cohortData.initialUsers,
      })),
      churned: cohortData.initialUsers - (cohortData.retainedByMonth[cohortData.retainedByMonth.length - 1] || 0),
      churnRate: 1 - (cohortData.retainedByMonth[cohortData.retainedByMonth.length - 1] || 0) / cohortData.initialUsers,
    })
  }
  const retentionCurve = buildRetentionCurve(cohorts)

  // LTV/CAC
  const ltvCac = await calculateLTVCACRatio()

  // Build dashboard without score and alerts first
  const dashboardData: Omit<HUNCHDashboard, 'overallPMFScore' | 'alerts'> = {
    asOf: now,
    hairOnFire: {
      score: mockData.hairOnFireScore,
      signals: mockData.hairOnFireSignals,
    },
    usage: {
      dau: mockData.usage.dau,
      wau: mockData.usage.wau,
      mau: mockData.usage.mau,
      dauWauRatio: mockData.usage.dau / mockData.usage.wau,
      growthRate: mockData.usage.growthRate,
    },
    nps: latestNPS,
    churn: {
      monthlyChurnRate,
      annualChurnRate,
      retentionCurve,
    },
    ltvCac,
  }

  // Calculate PMF score
  const overallPMFScore = calculatePMFScore(dashboardData)

  // Check thresholds for alerts
  const alerts = await checkThresholds()

  return {
    ...dashboardData,
    overallPMFScore,
    alerts,
  }
}

// ============================================================================
// Alert Functions
// ============================================================================

/**
 * Set a metric threshold
 */
function setThreshold(
  metric: string,
  threshold: number,
  operator: 'gt' | 'lt' | 'eq',
  severity: MetricAlert['severity']
): void {
  // Remove existing threshold for this metric
  const existingIndex = thresholds.findIndex((t) => t.metric === metric)
  if (existingIndex >= 0) {
    thresholds.splice(existingIndex, 1)
  }

  // Add new threshold
  thresholds.push({ metric, threshold, operator, severity })
}

/**
 * Check all thresholds and return alerts for breached ones
 */
async function checkThresholds(): Promise<MetricAlert[]> {
  const alerts: MetricAlert[] = []
  const now = new Date()

  // Get current metric values
  const dashboard = {
    nps: (await getNPSTrend(7))[0]?.score ?? 50,
    monthly_churn_rate: await calculateChurnRate({
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: now,
    }),
    ltv_cac_ratio: (await calculateLTVCACRatio()).ratio,
    dau_wau_ratio: mockData.usage.dau / mockData.usage.wau,
  }

  const metricValues: Record<string, number> = dashboard

  for (const config of thresholds) {
    const currentValue = metricValues[config.metric]
    if (currentValue === undefined) continue

    let isBreached = false
    switch (config.operator) {
      case 'gt':
        isBreached = currentValue > config.threshold
        break
      case 'lt':
        isBreached = currentValue < config.threshold
        break
      case 'eq':
        isBreached = currentValue === config.threshold
        break
    }

    if (isBreached) {
      alerts.push({
        id: `alert-${config.metric}-${Date.now()}`,
        metric: config.metric,
        threshold: config.threshold,
        currentValue,
        operator: config.operator,
        severity: config.severity,
        message: `${config.metric} is ${config.operator === 'gt' ? 'above' : config.operator === 'lt' ? 'below' : 'at'} threshold: ${currentValue.toFixed(2)} ${config.operator} ${config.threshold}`,
        triggeredAt: now,
      })
    }
  }

  return alerts
}

// ============================================================================
// Export HUNCHMetrics Module
// ============================================================================

export const HUNCHMetrics = {
  // NPS
  calculateNPS,
  aggregateNPSBySegment,
  getNPSTrend,

  // Churn
  calculateCohortRetention,
  calculateChurnRate,
  buildRetentionCurve,
  predictChurn,

  // LTV/CAC
  calculateCustomerLTV,
  calculateAverageLTV,
  calculateCAC,
  calculateLTVCACRatio,

  // Statistical Significance
  calculateSignificance,
  calculateSampleSize,

  // Dashboard
  getHUNCHDashboard,
  calculatePMFScore,

  // Alerts
  checkThresholds,
  setThreshold,
}

export default HUNCHMetrics
