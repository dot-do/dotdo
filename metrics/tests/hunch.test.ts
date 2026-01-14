import { describe, it, expect, beforeAll, vi } from 'vitest'

/**
 * HUNCH Metrics Pipeline Tests
 *
 * HUNCH = Hair-on-fire, Usage, NPS, Churn, LTV/CAC
 * These metrics measure Product-Market Fit in the Experimentation Machine phase.
 *
 * This is RED phase TDD - tests should FAIL until the HUNCH metrics pipeline
 * is implemented in metrics/hunch.ts.
 *
 * Implementation requirements:
 * - NPS collection and aggregation (survey responses -> score)
 * - Churn calculation pipeline (cohort analysis, retention curves)
 * - LTV/CAC accounting and ratios
 * - Statistical significance testing for experiments
 * - HUNCH dashboard data API endpoint
 * - Metric thresholds and alerts
 */

// ============================================================================
// Schema Types (Expected Interface)
// ============================================================================

/**
 * NPS Survey Response - collected from customers
 */
interface NPSSurveyResponse {
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
interface NPSScore {
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
interface CohortRetention {
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
interface CustomerLTV {
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
interface CAC {
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
interface LTVCACRatio {
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
interface SignificanceResult {
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
interface HUNCHDashboard {
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
interface MetricAlert {
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
// Dynamic Import for RED Phase TDD
// ============================================================================

let HUNCHMetrics: {
  // NPS
  calculateNPS: (responses: NPSSurveyResponse[]) => NPSScore
  aggregateNPSBySegment: (responses: NPSSurveyResponse[]) => Map<string, NPSScore>
  getNPSTrend: (periodDays: number) => Promise<NPSScore[]>

  // Churn
  calculateCohortRetention: (cohortDate: Date, periods: number) => Promise<CohortRetention>
  calculateChurnRate: (period: { start: Date; end: Date }) => Promise<number>
  buildRetentionCurve: (cohorts: CohortRetention[]) => number[]
  predictChurn: (customerId: string) => Promise<{ probability: number; factors: string[] }>

  // LTV/CAC
  calculateCustomerLTV: (customerId: string) => Promise<CustomerLTV>
  calculateAverageLTV: (segment?: string) => Promise<number>
  calculateCAC: (period: { start: Date; end: Date }) => Promise<CAC>
  calculateLTVCACRatio: (segment?: string) => Promise<LTVCACRatio>

  // Statistical Significance
  calculateSignificance: (
    experimentId: string,
    metric: string,
    variant: string,
    control: string
  ) => Promise<SignificanceResult>
  calculateSampleSize: (
    baselineConversion: number,
    minDetectableEffect: number,
    power: number,
    significanceLevel: number
  ) => number

  // Dashboard
  getHUNCHDashboard: () => Promise<HUNCHDashboard>
  calculatePMFScore: (dashboard: Omit<HUNCHDashboard, 'overallPMFScore' | 'alerts'>) => number

  // Alerts
  checkThresholds: () => Promise<MetricAlert[]>
  setThreshold: (
    metric: string,
    threshold: number,
    operator: 'gt' | 'lt' | 'eq',
    severity: MetricAlert['severity']
  ) => void
} | undefined

let hunchRoutes: unknown | undefined

beforeAll(async () => {
  try {
    const module = await import('../hunch')
    HUNCHMetrics = module.HUNCHMetrics ?? module.default
  } catch {
    // Module doesn't exist yet - this is expected in RED phase
  }

  try {
    const routesModule = await import('../../api/hunch')
    hunchRoutes = routesModule.hunchRoutes ?? routesModule.default
  } catch {
    // Routes don't exist yet - this is expected in RED phase
  }
})

// ============================================================================
// NPS Collection and Aggregation Tests
// ============================================================================

describe('NPS Collection and Aggregation', () => {
  describe('NPS Score Calculation', () => {
    it('HUNCHMetrics module is exported', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics should be exported from metrics/hunch.ts').toBeDefined()
    })

    it('calculateNPS function is exported', () => {
      expect(HUNCHMetrics?.calculateNPS, 'calculateNPS should be exported').toBeDefined()
    })

    it('calculates NPS from survey responses', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const responses: NPSSurveyResponse[] = [
        { id: '1', customerId: 'c1', score: 10, createdAt: new Date() },
        { id: '2', customerId: 'c2', score: 9, createdAt: new Date() },
        { id: '3', customerId: 'c3', score: 8, createdAt: new Date() },
        { id: '4', customerId: 'c4', score: 7, createdAt: new Date() },
        { id: '5', customerId: 'c5', score: 5, createdAt: new Date() },
      ]

      const result = HUNCHMetrics!.calculateNPS(responses)

      // 2 promoters (9, 10), 2 passives (7, 8), 1 detractor (5)
      // NPS = (2/5 - 1/5) * 100 = 20
      expect(result.score).toBe(20)
      expect(result.promoters).toBe(2)
      expect(result.passives).toBe(2)
      expect(result.detractors).toBe(1)
      expect(result.totalResponses).toBe(5)
    })

    it('handles all promoters scenario (NPS = 100)', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const responses: NPSSurveyResponse[] = [
        { id: '1', customerId: 'c1', score: 10, createdAt: new Date() },
        { id: '2', customerId: 'c2', score: 9, createdAt: new Date() },
        { id: '3', customerId: 'c3', score: 10, createdAt: new Date() },
      ]

      const result = HUNCHMetrics!.calculateNPS(responses)
      expect(result.score).toBe(100)
    })

    it('handles all detractors scenario (NPS = -100)', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const responses: NPSSurveyResponse[] = [
        { id: '1', customerId: 'c1', score: 0, createdAt: new Date() },
        { id: '2', customerId: 'c2', score: 3, createdAt: new Date() },
        { id: '3', customerId: 'c3', score: 6, createdAt: new Date() },
      ]

      const result = HUNCHMetrics!.calculateNPS(responses)
      expect(result.score).toBe(-100)
    })

    it('returns zero for empty responses', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const result = HUNCHMetrics!.calculateNPS([])
      expect(result.score).toBe(0)
      expect(result.totalResponses).toBe(0)
    })
  })

  describe('NPS Segmentation', () => {
    it('aggregateNPSBySegment function is exported', () => {
      expect(HUNCHMetrics?.aggregateNPSBySegment, 'aggregateNPSBySegment should be exported').toBeDefined()
    })

    it('calculates NPS by customer segment', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const responses: NPSSurveyResponse[] = [
        { id: '1', customerId: 'c1', score: 10, segment: 'enterprise', createdAt: new Date() },
        { id: '2', customerId: 'c2', score: 9, segment: 'enterprise', createdAt: new Date() },
        { id: '3', customerId: 'c3', score: 5, segment: 'free', createdAt: new Date() },
        { id: '4', customerId: 'c4', score: 4, segment: 'free', createdAt: new Date() },
      ]

      const bySegment = HUNCHMetrics!.aggregateNPSBySegment(responses)

      expect(bySegment.get('enterprise')?.score).toBe(100) // All promoters
      expect(bySegment.get('free')?.score).toBe(-100) // All detractors
    })
  })

  describe('NPS Trend Analysis', () => {
    it('getNPSTrend function is exported', () => {
      expect(HUNCHMetrics?.getNPSTrend, 'getNPSTrend should be exported').toBeDefined()
    })

    it('returns NPS scores over time periods', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const trend = await HUNCHMetrics!.getNPSTrend(30) // Last 30 days

      expect(Array.isArray(trend)).toBe(true)
      trend.forEach((score) => {
        expect(score.score).toBeGreaterThanOrEqual(-100)
        expect(score.score).toBeLessThanOrEqual(100)
        expect(score.period.start).toBeInstanceOf(Date)
        expect(score.period.end).toBeInstanceOf(Date)
      })
    })
  })
})

// ============================================================================
// Churn Calculation Pipeline Tests
// ============================================================================

describe('Churn Calculation Pipeline', () => {
  describe('Cohort Retention Analysis', () => {
    it('calculateCohortRetention function is exported', () => {
      expect(HUNCHMetrics?.calculateCohortRetention, 'calculateCohortRetention should be exported').toBeDefined()
    })

    it('calculates retention for a cohort over periods', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const cohortDate = new Date('2024-01-01')
      const retention = await HUNCHMetrics!.calculateCohortRetention(cohortDate, 6)

      expect(retention.cohortDate).toEqual(cohortDate)
      expect(retention.initialUsers).toBeGreaterThan(0)
      expect(retention.retainedByPeriod.length).toBe(6)

      // Retention should decrease over time (generally)
      retention.retainedByPeriod.forEach((period, index) => {
        expect(period.period).toBe(index + 1)
        expect(period.rate).toBeGreaterThanOrEqual(0)
        expect(period.rate).toBeLessThanOrEqual(1)
      })
    })

    it('calculates churn rate from retention', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const cohortDate = new Date('2024-01-01')
      const retention = await HUNCHMetrics!.calculateCohortRetention(cohortDate, 6)

      // Churn rate = 1 - final retention rate
      const expectedChurnRate = 1 - (retention.retainedByPeriod[5]?.rate ?? 0)
      expect(retention.churnRate).toBeCloseTo(expectedChurnRate, 2)
    })
  })

  describe('Monthly Churn Rate', () => {
    it('calculateChurnRate function is exported', () => {
      expect(HUNCHMetrics?.calculateChurnRate, 'calculateChurnRate should be exported').toBeDefined()
    })

    it('calculates churn rate for a period', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const churnRate = await HUNCHMetrics!.calculateChurnRate({
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      })

      expect(churnRate).toBeGreaterThanOrEqual(0)
      expect(churnRate).toBeLessThanOrEqual(1)
    })
  })

  describe('Retention Curve Building', () => {
    it('buildRetentionCurve function is exported', () => {
      expect(HUNCHMetrics?.buildRetentionCurve, 'buildRetentionCurve should be exported').toBeDefined()
    })

    it('builds aggregate retention curve from multiple cohorts', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const cohorts: CohortRetention[] = [
        {
          cohortId: 'jan-2024',
          cohortDate: new Date('2024-01-01'),
          initialUsers: 100,
          retainedByPeriod: [
            { period: 1, count: 80, rate: 0.8 },
            { period: 2, count: 70, rate: 0.7 },
            { period: 3, count: 65, rate: 0.65 },
          ],
          churned: 35,
          churnRate: 0.35,
        },
        {
          cohortId: 'feb-2024',
          cohortDate: new Date('2024-02-01'),
          initialUsers: 120,
          retainedByPeriod: [
            { period: 1, count: 100, rate: 0.83 },
            { period: 2, count: 90, rate: 0.75 },
            { period: 3, count: 80, rate: 0.67 },
          ],
          churned: 40,
          churnRate: 0.33,
        },
      ]

      const curve = HUNCHMetrics!.buildRetentionCurve(cohorts)

      expect(curve.length).toBe(3)
      // Average of 0.8 and 0.83 for period 1
      expect(curve[0]).toBeCloseTo(0.815, 2)
    })
  })

  describe('Churn Prediction', () => {
    it('predictChurn function is exported', () => {
      expect(HUNCHMetrics?.predictChurn, 'predictChurn should be exported').toBeDefined()
    })

    it('predicts churn probability for a customer', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const prediction = await HUNCHMetrics!.predictChurn('customer-123')

      expect(prediction.probability).toBeGreaterThanOrEqual(0)
      expect(prediction.probability).toBeLessThanOrEqual(1)
      expect(Array.isArray(prediction.factors)).toBe(true)
    })
  })
})

// ============================================================================
// LTV/CAC Accounting Tests
// ============================================================================

describe('LTV/CAC Accounting', () => {
  describe('Customer Lifetime Value', () => {
    it('calculateCustomerLTV function is exported', () => {
      expect(HUNCHMetrics?.calculateCustomerLTV, 'calculateCustomerLTV should be exported').toBeDefined()
    })

    it('calculates LTV for individual customer', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const ltv = await HUNCHMetrics!.calculateCustomerLTV('customer-123')

      expect(ltv.customerId).toBe('customer-123')
      expect(ltv.totalRevenue).toBeGreaterThanOrEqual(0)
      expect(ltv.subscriptionMonths).toBeGreaterThanOrEqual(0)
      expect(ltv.averageMonthlyRevenue).toBeGreaterThanOrEqual(0)
      expect(ltv.predictedLTV).toBeGreaterThanOrEqual(ltv.totalRevenue)
    })

    it('calculateAverageLTV function is exported', () => {
      expect(HUNCHMetrics?.calculateAverageLTV, 'calculateAverageLTV should be exported').toBeDefined()
    })

    it('calculates average LTV across all customers', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const avgLTV = await HUNCHMetrics!.calculateAverageLTV()
      expect(avgLTV).toBeGreaterThanOrEqual(0)
    })

    it('calculates average LTV by segment', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const enterpriseLTV = await HUNCHMetrics!.calculateAverageLTV('enterprise')
      const freeLTV = await HUNCHMetrics!.calculateAverageLTV('free')

      expect(enterpriseLTV).toBeGreaterThanOrEqual(0)
      expect(freeLTV).toBeGreaterThanOrEqual(0)
      // Enterprise should typically have higher LTV
      expect(enterpriseLTV).toBeGreaterThan(freeLTV)
    })
  })

  describe('Customer Acquisition Cost', () => {
    it('calculateCAC function is exported', () => {
      expect(HUNCHMetrics?.calculateCAC, 'calculateCAC should be exported').toBeDefined()
    })

    it('calculates CAC for a period', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const cac = await HUNCHMetrics!.calculateCAC({
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      })

      expect(cac.totalSpend).toBeGreaterThanOrEqual(0)
      expect(cac.customersAcquired).toBeGreaterThanOrEqual(0)
      if (cac.customersAcquired > 0) {
        expect(cac.cacValue).toBe(cac.totalSpend / cac.customersAcquired)
      }
    })

    it('provides CAC breakdown by channel', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const cac = await HUNCHMetrics!.calculateCAC({
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      })

      expect(Array.isArray(cac.breakdown)).toBe(true)
      cac.breakdown.forEach((channel) => {
        expect(channel.channel).toBeDefined()
        expect(channel.spend).toBeGreaterThanOrEqual(0)
        expect(channel.customers).toBeGreaterThanOrEqual(0)
      })
    })
  })

  describe('LTV/CAC Ratio', () => {
    it('calculateLTVCACRatio function is exported', () => {
      expect(HUNCHMetrics?.calculateLTVCACRatio, 'calculateLTVCACRatio should be exported').toBeDefined()
    })

    it('calculates LTV/CAC ratio', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const ratio = await HUNCHMetrics!.calculateLTVCACRatio()

      expect(ratio.avgLTV).toBeGreaterThanOrEqual(0)
      expect(ratio.avgCAC).toBeGreaterThanOrEqual(0)
      if (ratio.avgCAC > 0) {
        expect(ratio.ratio).toBe(ratio.avgLTV / ratio.avgCAC)
      }
    })

    it('marks ratio as healthy when > 3', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const ratio = await HUNCHMetrics!.calculateLTVCACRatio()

      // isHealthy should be true when ratio > 3
      expect(ratio.isHealthy).toBe(ratio.ratio > 3)
    })

    it('calculates payback period in months', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const ratio = await HUNCHMetrics!.calculateLTVCACRatio()

      // Payback period = CAC / (LTV / average customer lifetime months)
      expect(ratio.paybackPeriodMonths).toBeGreaterThanOrEqual(0)
    })

    it('calculates LTV/CAC by segment', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const enterpriseRatio = await HUNCHMetrics!.calculateLTVCACRatio('enterprise')
      const freeRatio = await HUNCHMetrics!.calculateLTVCACRatio('free')

      expect(enterpriseRatio.segment).toBe('enterprise')
      expect(freeRatio.segment).toBe('free')
    })
  })
})

// ============================================================================
// Statistical Significance Testing
// ============================================================================

describe('Statistical Significance Testing', () => {
  describe('A/B Test Significance', () => {
    it('calculateSignificance function is exported', () => {
      expect(HUNCHMetrics?.calculateSignificance, 'calculateSignificance should be exported').toBeDefined()
    })

    it('calculates statistical significance for an experiment', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const result = await HUNCHMetrics!.calculateSignificance(
        'experiment-123',
        'conversion_rate',
        'variant_a',
        'control'
      )

      expect(result.experimentId).toBe('experiment-123')
      expect(result.metric).toBe('conversion_rate')
      expect(result.variant).toBe('variant_a')
      expect(result.control).toBe('control')
      expect(result.pValue).toBeGreaterThanOrEqual(0)
      expect(result.pValue).toBeLessThanOrEqual(1)
      expect(result.confidenceLevel).toBeGreaterThanOrEqual(0)
      expect(result.confidenceLevel).toBeLessThanOrEqual(1)
    })

    it('marks as significant when p-value < 0.05', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const result = await HUNCHMetrics!.calculateSignificance(
        'experiment-123',
        'conversion_rate',
        'variant_a',
        'control'
      )

      // isSignificant should match p-value threshold
      expect(result.isSignificant).toBe(result.pValue < 0.05)
    })

    it('calculates lift percentage', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const result = await HUNCHMetrics!.calculateSignificance(
        'experiment-123',
        'conversion_rate',
        'variant_a',
        'control'
      )

      // Lift = (variant - control) / control * 100
      const expectedLift =
        ((result.conversionVariant - result.conversionControl) / result.conversionControl) * 100
      expect(result.lift).toBeCloseTo(expectedLift, 2)
    })

    it('provides confidence interval', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const result = await HUNCHMetrics!.calculateSignificance(
        'experiment-123',
        'conversion_rate',
        'variant_a',
        'control'
      )

      expect(Array.isArray(result.confidenceInterval)).toBe(true)
      expect(result.confidenceInterval.length).toBe(2)
      expect(result.confidenceInterval[0]).toBeLessThanOrEqual(result.confidenceInterval[1])
    })
  })

  describe('Sample Size Calculation', () => {
    it('calculateSampleSize function is exported', () => {
      expect(HUNCHMetrics?.calculateSampleSize, 'calculateSampleSize should be exported').toBeDefined()
    })

    it('calculates required sample size for desired power', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      // Baseline 5% conversion, want to detect 20% relative improvement (6% absolute)
      // 80% power, 95% confidence
      const sampleSize = HUNCHMetrics!.calculateSampleSize(
        0.05, // baseline conversion
        0.20, // minimum detectable effect (20% relative)
        0.80, // statistical power
        0.05 // significance level
      )

      expect(sampleSize).toBeGreaterThan(0)
      expect(Number.isInteger(sampleSize)).toBe(true)
    })

    it('requires larger sample for smaller effects', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const smallEffectSize = HUNCHMetrics!.calculateSampleSize(0.05, 0.10, 0.80, 0.05)
      const largeEffectSize = HUNCHMetrics!.calculateSampleSize(0.05, 0.50, 0.80, 0.05)

      // Smaller effect requires more samples
      expect(smallEffectSize).toBeGreaterThan(largeEffectSize)
    })

    it('requires larger sample for higher power', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const lowPower = HUNCHMetrics!.calculateSampleSize(0.05, 0.20, 0.70, 0.05)
      const highPower = HUNCHMetrics!.calculateSampleSize(0.05, 0.20, 0.95, 0.05)

      // Higher power requires more samples
      expect(highPower).toBeGreaterThan(lowPower)
    })
  })
})

// ============================================================================
// HUNCH Dashboard API Tests
// ============================================================================

describe('HUNCH Dashboard API', () => {
  describe('Dashboard Data Aggregation', () => {
    it('getHUNCHDashboard function is exported', () => {
      expect(HUNCHMetrics?.getHUNCHDashboard, 'getHUNCHDashboard should be exported').toBeDefined()
    })

    it('returns complete HUNCH dashboard data', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const dashboard = await HUNCHMetrics!.getHUNCHDashboard()

      // Check Hair-on-fire
      expect(dashboard.hairOnFire.score).toBeGreaterThanOrEqual(0)
      expect(dashboard.hairOnFire.score).toBeLessThanOrEqual(10)
      expect(Array.isArray(dashboard.hairOnFire.signals)).toBe(true)

      // Check Usage
      expect(dashboard.usage.dau).toBeGreaterThanOrEqual(0)
      expect(dashboard.usage.wau).toBeGreaterThanOrEqual(dashboard.usage.dau)
      expect(dashboard.usage.mau).toBeGreaterThanOrEqual(dashboard.usage.wau)
      expect(dashboard.usage.dauWauRatio).toBeGreaterThanOrEqual(0)
      expect(dashboard.usage.dauWauRatio).toBeLessThanOrEqual(1)

      // Check NPS
      expect(dashboard.nps.score).toBeGreaterThanOrEqual(-100)
      expect(dashboard.nps.score).toBeLessThanOrEqual(100)

      // Check Churn
      expect(dashboard.churn.monthlyChurnRate).toBeGreaterThanOrEqual(0)
      expect(dashboard.churn.monthlyChurnRate).toBeLessThanOrEqual(1)
      expect(Array.isArray(dashboard.churn.retentionCurve)).toBe(true)

      // Check LTV/CAC
      expect(dashboard.ltvCac.ratio).toBeGreaterThanOrEqual(0)
    })

    it('includes PMF score calculation', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const dashboard = await HUNCHMetrics!.getHUNCHDashboard()

      expect(dashboard.overallPMFScore).toBeGreaterThanOrEqual(0)
      expect(dashboard.overallPMFScore).toBeLessThanOrEqual(100)
    })

    it('includes timestamp', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const dashboard = await HUNCHMetrics!.getHUNCHDashboard()
      expect(dashboard.asOf).toBeInstanceOf(Date)
    })
  })

  describe('PMF Score Calculation', () => {
    it('calculatePMFScore function is exported', () => {
      expect(HUNCHMetrics?.calculatePMFScore, 'calculatePMFScore should be exported').toBeDefined()
    })

    it('calculates composite PMF score from HUNCH metrics', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const dashboardData: Omit<HUNCHDashboard, 'overallPMFScore' | 'alerts'> = {
        asOf: new Date(),
        hairOnFire: { score: 8, signals: ['urgent problem'] },
        usage: { dau: 1000, wau: 3000, mau: 8000, dauWauRatio: 0.33, growthRate: 0.1 },
        nps: {
          score: 50,
          promoters: 60,
          passives: 30,
          detractors: 10,
          totalResponses: 100,
          period: { start: new Date(), end: new Date() },
        },
        churn: { monthlyChurnRate: 0.05, annualChurnRate: 0.46, retentionCurve: [1, 0.9, 0.8, 0.75] },
        ltvCac: { ratio: 4, avgLTV: 400, avgCAC: 100, paybackPeriodMonths: 3, isHealthy: true },
      }

      const pmfScore = HUNCHMetrics!.calculatePMFScore(dashboardData)

      expect(pmfScore).toBeGreaterThanOrEqual(0)
      expect(pmfScore).toBeLessThanOrEqual(100)
    })

    it('weights Hair-on-fire heavily', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const baseData: Omit<HUNCHDashboard, 'overallPMFScore' | 'alerts'> = {
        asOf: new Date(),
        hairOnFire: { score: 5, signals: [] },
        usage: { dau: 1000, wau: 3000, mau: 8000, dauWauRatio: 0.33, growthRate: 0.1 },
        nps: {
          score: 50,
          promoters: 60,
          passives: 30,
          detractors: 10,
          totalResponses: 100,
          period: { start: new Date(), end: new Date() },
        },
        churn: { monthlyChurnRate: 0.05, annualChurnRate: 0.46, retentionCurve: [1, 0.9, 0.8, 0.75] },
        ltvCac: { ratio: 4, avgLTV: 400, avgCAC: 100, paybackPeriodMonths: 3, isHealthy: true },
      }

      const lowHairOnFire = HUNCHMetrics!.calculatePMFScore({
        ...baseData,
        hairOnFire: { score: 2, signals: [] },
      })

      const highHairOnFire = HUNCHMetrics!.calculatePMFScore({
        ...baseData,
        hairOnFire: { score: 9, signals: ['urgent', 'critical'] },
      })

      // High hair-on-fire should significantly increase PMF score
      expect(highHairOnFire).toBeGreaterThan(lowHairOnFire)
    })
  })

  describe('API Routes', () => {
    it('hunchRoutes is exported from api/hunch.ts', () => {
      expect(hunchRoutes, 'hunchRoutes should be exported from api/hunch.ts').toBeDefined()
    })
  })
})

// ============================================================================
// Metric Thresholds and Alerts Tests
// ============================================================================

describe('Metric Thresholds and Alerts', () => {
  describe('Threshold Configuration', () => {
    it('setThreshold function is exported', () => {
      expect(HUNCHMetrics?.setThreshold, 'setThreshold should be exported').toBeDefined()
    })

    it('allows setting custom thresholds', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      // Should not throw
      expect(() => {
        HUNCHMetrics!.setThreshold('nps', 30, 'lt', 'warning')
        HUNCHMetrics!.setThreshold('churn_rate', 0.10, 'gt', 'critical')
        HUNCHMetrics!.setThreshold('ltv_cac_ratio', 3, 'lt', 'warning')
      }).not.toThrow()
    })
  })

  describe('Alert Generation', () => {
    it('checkThresholds function is exported', () => {
      expect(HUNCHMetrics?.checkThresholds, 'checkThresholds should be exported').toBeDefined()
    })

    it('returns alerts for breached thresholds', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const alerts = await HUNCHMetrics!.checkThresholds()

      expect(Array.isArray(alerts)).toBe(true)
      alerts.forEach((alert) => {
        expect(alert.id).toBeDefined()
        expect(alert.metric).toBeDefined()
        expect(alert.threshold).toBeDefined()
        expect(alert.currentValue).toBeDefined()
        expect(['gt', 'lt', 'eq']).toContain(alert.operator)
        expect(['info', 'warning', 'critical']).toContain(alert.severity)
        expect(alert.message).toBeDefined()
        expect(alert.triggeredAt).toBeInstanceOf(Date)
      })
    })

    it('includes alerts in dashboard response', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const dashboard = await HUNCHMetrics!.getHUNCHDashboard()

      expect(Array.isArray(dashboard.alerts)).toBe(true)
    })
  })

  describe('Default Thresholds', () => {
    it('has default threshold for NPS (warning if < 30)', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      // Set NPS below threshold and check for alert
      const alerts = await HUNCHMetrics!.checkThresholds()
      const npsAlert = alerts.find((a) => a.metric === 'nps' && a.currentValue < 30)

      if (npsAlert) {
        expect(npsAlert.severity).toBe('warning')
        expect(npsAlert.operator).toBe('lt')
      }
    })

    it('has default threshold for churn rate (critical if > 10%)', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const alerts = await HUNCHMetrics!.checkThresholds()
      const churnAlert = alerts.find((a) => a.metric === 'monthly_churn_rate' && a.currentValue > 0.1)

      if (churnAlert) {
        expect(churnAlert.severity).toBe('critical')
        expect(churnAlert.operator).toBe('gt')
      }
    })

    it('has default threshold for LTV/CAC ratio (warning if < 3)', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const alerts = await HUNCHMetrics!.checkThresholds()
      const ratioAlert = alerts.find((a) => a.metric === 'ltv_cac_ratio' && a.currentValue < 3)

      if (ratioAlert) {
        expect(ratioAlert.severity).toBe('warning')
        expect(ratioAlert.operator).toBe('lt')
      }
    })

    it('has default threshold for DAU/WAU ratio (info if < 0.2)', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const alerts = await HUNCHMetrics!.checkThresholds()
      const engagementAlert = alerts.find((a) => a.metric === 'dau_wau_ratio' && a.currentValue < 0.2)

      if (engagementAlert) {
        expect(engagementAlert.severity).toBe('info')
        expect(engagementAlert.operator).toBe('lt')
      }
    })
  })
})

// ============================================================================
// Integration with Events System Tests
// ============================================================================

describe('Integration with Events System', () => {
  describe('Event-driven Metric Updates', () => {
    it('NPS responses are captured from events', async () => {
      // Events table should track NPS survey submissions
      // e.g., events with verb 'submitted' and source 'Survey/nps'
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      // The NPS trend function should read from events
      const trend = await HUNCHMetrics!.getNPSTrend(7)
      expect(Array.isArray(trend)).toBe(true)
    })

    it('churn events are tracked', async () => {
      // Events table should track subscription cancellations
      // e.g., events with verb 'cancelled' and source 'Subscription/*'
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const churnRate = await HUNCHMetrics!.calculateChurnRate({
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      })

      expect(typeof churnRate).toBe('number')
    })

    it('revenue events feed LTV calculation', async () => {
      // Events table should track payments/charges
      // e.g., events with verb 'charged' and source 'Payment/*'
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const ltv = await HUNCHMetrics!.calculateCustomerLTV('customer-123')
      expect(typeof ltv.totalRevenue).toBe('number')
    })

    it('acquisition events feed CAC calculation', async () => {
      // Events table should track customer acquisitions with attribution
      // e.g., events with verb 'acquired' and source 'Customer/*'
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const cac = await HUNCHMetrics!.calculateCAC({
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      })

      expect(typeof cac.totalSpend).toBe('number')
      expect(typeof cac.customersAcquired).toBe('number')
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling Tests
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  describe('Empty Data Handling', () => {
    it('handles zero survey responses gracefully', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const result = HUNCHMetrics!.calculateNPS([])
      expect(result.score).toBe(0)
      expect(result.totalResponses).toBe(0)
    })

    it('handles zero customers for LTV calculation', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      // Should not throw, should return 0
      const avgLTV = await HUNCHMetrics!.calculateAverageLTV('nonexistent-segment')
      expect(avgLTV).toBe(0)
    })

    it('handles zero acquisitions for CAC calculation', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const cac = await HUNCHMetrics!.calculateCAC({
        start: new Date('2099-01-01'),
        end: new Date('2099-01-31'),
      })

      // Should handle gracefully (0 or Infinity)
      expect(cac.customersAcquired).toBe(0)
    })
  })

  describe('Invalid Input Handling', () => {
    it('validates NPS scores are 0-10', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const invalidResponses: NPSSurveyResponse[] = [
        { id: '1', customerId: 'c1', score: 11, createdAt: new Date() }, // Invalid
        { id: '2', customerId: 'c2', score: -1, createdAt: new Date() }, // Invalid
        { id: '3', customerId: 'c3', score: 8, createdAt: new Date() }, // Valid
      ]

      // Should only count valid scores or throw error
      const result = HUNCHMetrics!.calculateNPS(invalidResponses)
      expect(result.totalResponses).toBeLessThanOrEqual(3)
    })

    it('handles invalid date ranges', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      // End before start
      const churnRate = await HUNCHMetrics!.calculateChurnRate({
        start: new Date('2024-12-31'),
        end: new Date('2024-01-01'),
      })

      // Should return 0 or throw meaningful error
      expect(churnRate).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Statistical Edge Cases', () => {
    it('handles very small sample sizes in significance testing', async () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      const result = await HUNCHMetrics!.calculateSignificance(
        'small-experiment',
        'conversion_rate',
        'variant_a',
        'control'
      )

      // With small samples, should not be significant
      if (result.sampleSizeVariant < 30 || result.sampleSizeControl < 30) {
        expect(result.isSignificant).toBe(false)
      }
    })

    it('handles 0% baseline conversion in sample size calc', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      // Should handle edge case gracefully
      expect(() => {
        HUNCHMetrics!.calculateSampleSize(0, 0.20, 0.80, 0.05)
      }).not.toThrow()
    })

    it('handles 100% baseline conversion in sample size calc', () => {
      expect(HUNCHMetrics, 'HUNCHMetrics must be defined').toBeDefined()

      // Should handle edge case gracefully
      expect(() => {
        HUNCHMetrics!.calculateSampleSize(1.0, 0.20, 0.80, 0.05)
      }).not.toThrow()
    })
  })
})
