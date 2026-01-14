import { z } from 'zod'
import { defineNoun } from '../types'
import { BusinessPlanSchema, CurrencySchema, TimePeriodSchema, FinancialMetricsSchema } from './Business'

/**
 * Pricing model for SaaS products
 */
export const SaaSPricingModelSchema = z.enum([
  'freemium',
  'free-trial',
  'subscription',
  'usage-based',
  'tiered',
  'per-seat',
  'hybrid',
])
export type SaaSPricingModel = z.infer<typeof SaaSPricingModelSchema>

/**
 * SaaS-specific metrics schema
 */
export const SaaSMetricsSchema = z.object({
  // Revenue metrics
  mrr: z.number().optional(),
  arr: z.number().optional(),
  arpu: z.number().optional(),
  arpa: z.number().optional(),

  // Growth metrics
  mrrGrowth: z.number().optional(),
  revenueGrowth: z.number().optional(),
  netRevenuRetention: z.number().optional(),
  grossRevenueRetention: z.number().optional(),
  expansionMrr: z.number().optional(),
  contractionMrr: z.number().optional(),

  // Customer metrics
  totalCustomers: z.number().optional(),
  newCustomers: z.number().optional(),
  churnedCustomers: z.number().optional(),
  churnRate: z.number().optional(),
  customerChurnRate: z.number().optional(),
  revenueChurnRate: z.number().optional(),

  // Acquisition metrics
  cac: z.number().optional(),
  ltv: z.number().optional(),
  ltvCacRatio: z.number().optional(),
  paybackPeriod: z.number().optional(),

  // Engagement metrics
  activeUsers: z.number().optional(),
  dau: z.number().optional(),
  mau: z.number().optional(),
  dauMauRatio: z.number().optional(),

  // Conversion metrics
  trialToPayingRate: z.number().optional(),
  freeToPayingRate: z.number().optional(),

  period: TimePeriodSchema.optional(),
})
export type SaaSMetrics = z.infer<typeof SaaSMetricsSchema>

/**
 * Pricing tier schema
 */
export const PricingTierSchema = z.object({
  name: z.string(),
  price: z.number(),
  billingPeriod: z.enum(['monthly', 'yearly', 'one-time']).optional(),
  features: z.array(z.string()).optional(),
  limits: z.record(z.string(), z.number()).optional(),
  recommended: z.boolean().optional(),
})
export type PricingTier = z.infer<typeof PricingTierSchema>

/**
 * SaaS business entity schema
 */
export const SaaSSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/SaaS'),
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

  // SaaS-specific fields
  pricingModel: SaaSPricingModelSchema.optional(),
  pricingTiers: z.array(PricingTierSchema).optional(),
  metrics: SaaSMetricsSchema.optional(),

  // Product fields
  productUrl: z.string().url().optional(),
  appStoreUrl: z.string().url().optional(),
  playStoreUrl: z.string().url().optional(),
  platforms: z.array(z.enum(['web', 'ios', 'android', 'desktop', 'api'])).optional(),
  integrations: z.array(z.string()).optional(),

  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type SaaSType = z.infer<typeof SaaSSchema>

/**
 * SaaS Noun - Software as a Service business
 *
 * Extends Business with SaaS-specific metrics like MRR, ARR, churn,
 * LTV/CAC ratio, and pricing tiers.
 */
export const SaaS = defineNoun({
  noun: 'SaaS',
  plural: 'SaaSes',
  $type: 'https://schema.org.ai/SaaS',
  schema: SaaSSchema,
  extends: 'Business',
  okrs: [
    // Business OKRs
    'Revenue', 'Costs', 'Profit', 'GrossMargin', 'NetMargin',
    // SaaS-specific OKRs
    'MRR', 'ARR', 'ARPU', 'ChurnRate', 'NRR', 'GRR',
    'LTV', 'CAC', 'LTVCACRatio', 'PaybackPeriod',
    'TrialConversion', 'ActiveUsers', 'DAU', 'MAU',
  ],
})
