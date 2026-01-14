import { z } from 'zod'
import { defineNoun } from '../types'

/**
 * Business Plan tiers
 */
export const BusinessPlanSchema = z.enum(['free', 'starter', 'pro', 'enterprise'])
export type BusinessPlan = z.infer<typeof BusinessPlanSchema>

/**
 * Time period for metrics and financial calculations
 */
export const TimePeriodSchema = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
export type TimePeriod = z.infer<typeof TimePeriodSchema>

/**
 * Currency types supported by the system
 */
export const CurrencySchema = z.string().default('USD')
export type Currency = z.infer<typeof CurrencySchema>

/**
 * Financial metrics schema
 */
export const FinancialMetricsSchema = z.object({
  revenue: z.number().optional(),
  cogs: z.number().optional(),
  grossProfit: z.number().optional(),
  grossMargin: z.number().optional(),
  operatingExpenses: z.number().optional(),
  operatingIncome: z.number().optional(),
  operatingMargin: z.number().optional(),
  netIncome: z.number().optional(),
  netMargin: z.number().optional(),
  ebitda: z.number().optional(),
  ebitdaMargin: z.number().optional(),
  operatingCashFlow: z.number().optional(),
  freeCashFlow: z.number().optional(),
  currency: CurrencySchema.optional(),
  period: TimePeriodSchema.optional(),
})
export type FinancialMetrics = z.infer<typeof FinancialMetricsSchema>

/**
 * Business entity schema
 */
export const BusinessSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Business'),
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
  metadata: z.record(z.unknown()).optional(),
})

export type BusinessType = z.infer<typeof BusinessSchema>

/**
 * Business Noun - core business entity
 *
 * Represents a business with its fundamental attributes,
 * financial metrics, and organizational structure.
 */
export const Business = defineNoun({
  noun: 'Business',
  plural: 'Businesses',
  $type: 'https://schema.org.ai/Business',
  schema: BusinessSchema,
  okrs: ['Revenue', 'Costs', 'Profit', 'GrossMargin', 'NetMargin'],
})
