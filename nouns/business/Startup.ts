import { z } from 'zod'
import { defineNoun } from '../types'
import { BusinessPlanSchema, CurrencySchema, TimePeriodSchema, FinancialMetricsSchema } from './Business'
import { SaaSPricingModelSchema, SaaSMetricsSchema, PricingTierSchema } from './SaaS'

/**
 * Funding stage for startups
 */
export const FundingStageSchema = z.enum([
  'pre-seed',
  'seed',
  'series-a',
  'series-b',
  'series-c',
  'series-d',
  'series-e',
  'growth',
  'pre-ipo',
  'public',
  'bootstrapped',
])
export type FundingStage = z.infer<typeof FundingStageSchema>

/**
 * Funding round schema
 */
export const FundingRoundSchema = z.object({
  stage: FundingStageSchema,
  amount: z.number(),
  currency: CurrencySchema.optional(),
  date: z.coerce.date().optional(),
  valuation: z.number().optional(),
  investors: z.array(z.string()).optional(),
  leadInvestor: z.string().optional(),
  terms: z.string().optional(),
})
export type FundingRound = z.infer<typeof FundingRoundSchema>

/**
 * Startup-specific metrics schema
 */
export const StartupMetricsSchema = z.object({
  // Runway metrics
  cashBalance: z.number().optional(),
  burnRate: z.number().optional(),
  runway: z.number().optional(),

  // Growth metrics
  weekOverWeekGrowth: z.number().optional(),
  monthOverMonthGrowth: z.number().optional(),
  yearOverYearGrowth: z.number().optional(),

  // Traction metrics
  totalUsers: z.number().optional(),
  weeklyActiveUsers: z.number().optional(),
  monthlyActiveUsers: z.number().optional(),
  signups: z.number().optional(),
  waitlistSize: z.number().optional(),

  // Revenue velocity
  timeToFirstRevenue: z.number().optional(),
  timeToBreakeven: z.number().optional(),
  timeTo1mArr: z.number().optional(),
  timeTo10mArr: z.number().optional(),

  period: TimePeriodSchema.optional(),
})
export type StartupMetrics = z.infer<typeof StartupMetricsSchema>

/**
 * Investor schema
 */
export const InvestorSchema = z.object({
  name: z.string(),
  type: z.enum(['angel', 'vc', 'corporate', 'family-office', 'accelerator', 'crowdfunding']).optional(),
  portfolio: z.array(z.string()).optional(),
  leadRounds: z.boolean().optional(),
  checkSize: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    currency: CurrencySchema.optional(),
  }).optional(),
})
export type Investor = z.infer<typeof InvestorSchema>

/**
 * Startup business entity schema
 */
export const StartupSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Startup'),
  name: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  plan: BusinessPlanSchema.optional(),
  industry: z.string().optional(),
  mission: z.string().optional(),
  values: z.array(z.string()).optional(),
  targetMarket: z.string().optional(),
  foundedAt: z.coerce.date().optional(),
  teamSize: z.number().optional(),
  currency: CurrencySchema.optional(),
  financials: FinancialMetricsSchema.optional(),

  // SaaS fields (from parent)
  pricingModel: SaaSPricingModelSchema.optional(),
  pricingTiers: z.array(PricingTierSchema).optional(),
  saasMetrics: SaaSMetricsSchema.optional(),

  // Startup-specific fields
  fundingStage: FundingStageSchema.optional(),
  fundingRounds: z.array(FundingRoundSchema).optional(),
  totalFunding: z.number().optional(),
  valuation: z.number().optional(),
  lastValuation: z.number().optional(),
  investors: z.array(z.string()).optional(),
  accelerators: z.array(z.string()).optional(),
  startupMetrics: StartupMetricsSchema.optional(),

  // Founder/Team fields
  founders: z.array(z.string()).optional(),
  advisors: z.array(z.string()).optional(),
  boardMembers: z.array(z.string()).optional(),

  // Product/Market fields
  productUrl: z.string().url().optional(),
  pitchDeckUrl: z.string().url().optional(),
  oneLineDescription: z.string().optional(),
  problemStatement: z.string().optional(),
  solution: z.string().optional(),
  competitiveAdvantage: z.string().optional(),
  tam: z.number().optional(),
  sam: z.number().optional(),
  som: z.number().optional(),

  metadata: z.record(z.unknown()).optional(),
})

export type StartupType = z.infer<typeof StartupSchema>

/**
 * Startup Noun - venture-backed startup business
 *
 * Extends SaaS with startup-specific metrics like runway, burn rate,
 * funding rounds, valuation, and growth velocity.
 */
export const Startup = defineNoun({
  noun: 'Startup',
  plural: 'Startups',
  $type: 'https://schema.org.ai/Startup',
  schema: StartupSchema,
  extends: 'SaaS',
  okrs: [
    // Business OKRs
    'Revenue', 'Costs', 'Profit', 'GrossMargin', 'NetMargin',
    // SaaS OKRs
    'MRR', 'ARR', 'ARPU', 'ChurnRate', 'NRR', 'GRR',
    'LTV', 'CAC', 'LTVCACRatio', 'PaybackPeriod',
    'TrialConversion', 'ActiveUsers', 'DAU', 'MAU',
    // Startup-specific OKRs
    'Runway', 'BurnRate', 'CashBalance',
    'Valuation', 'TotalFunding', 'FundingStage',
    'WeekOverWeekGrowth', 'MonthOverMonthGrowth', 'YearOverYearGrowth',
    'TotalUsers', 'Signups', 'WaitlistSize',
    'TAM', 'SAM', 'SOM',
  ],
})
