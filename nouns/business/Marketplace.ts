import { z } from 'zod'
import { defineNoun } from '../types'
import { BusinessPlanSchema, CurrencySchema, TimePeriodSchema, FinancialMetricsSchema } from './Business'

/**
 * Marketplace type
 */
export const MarketplaceTypeSchema = z.enum([
  'b2b',
  'b2c',
  'c2c',
  'b2b2c',
  'product',
  'service',
  'talent',
  'rental',
  'booking',
  'hybrid',
])
export type MarketplaceType = z.infer<typeof MarketplaceTypeSchema>

/**
 * Marketplace revenue model
 */
export const MarketplaceRevenueModelSchema = z.enum([
  'commission',
  'subscription',
  'listing-fee',
  'lead-gen',
  'featured-listings',
  'advertising',
  'freemium',
  'hybrid',
])
export type MarketplaceRevenueModel = z.infer<typeof MarketplaceRevenueModelSchema>

/**
 * Marketplace-specific metrics schema
 */
export const MarketplaceMetricsSchema = z.object({
  // Transaction metrics
  gmv: z.number().optional(),
  takeRate: z.number().optional(),
  averageOrderValue: z.number().optional(),
  transactionVolume: z.number().optional(),
  transactionCount: z.number().optional(),

  // Supply metrics
  totalSellers: z.number().optional(),
  activeSellers: z.number().optional(),
  newSellers: z.number().optional(),
  sellerChurnRate: z.number().optional(),
  averageListingsPerSeller: z.number().optional(),
  totalListings: z.number().optional(),
  activeListings: z.number().optional(),

  // Demand metrics
  totalBuyers: z.number().optional(),
  activeBuyers: z.number().optional(),
  newBuyers: z.number().optional(),
  buyerChurnRate: z.number().optional(),
  repeatPurchaseRate: z.number().optional(),
  buyerToSellerRatio: z.number().optional(),

  // Liquidity metrics
  searchToTransactionRate: z.number().optional(),
  listingToSaleRate: z.number().optional(),
  timeToFirstTransaction: z.number().optional(),
  averageTimeToSale: z.number().optional(),

  // Quality metrics
  buyerSatisfaction: z.number().optional(),
  sellerSatisfaction: z.number().optional(),
  disputeRate: z.number().optional(),
  refundRate: z.number().optional(),

  period: TimePeriodSchema.optional(),
})
export type MarketplaceMetrics = z.infer<typeof MarketplaceMetricsSchema>

/**
 * Commission tier schema
 */
export const CommissionTierSchema = z.object({
  name: z.string(),
  rate: z.number(),
  minGmv: z.number().optional(),
  maxGmv: z.number().optional(),
  categories: z.array(z.string()).optional(),
})
export type CommissionTier = z.infer<typeof CommissionTierSchema>

/**
 * Marketplace business entity schema
 */
export const MarketplaceSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Marketplace'),
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

  // Marketplace-specific fields
  marketplaceType: MarketplaceTypeSchema.optional(),
  revenueModel: MarketplaceRevenueModelSchema.optional(),
  commissionRate: z.number().optional(),
  commissionTiers: z.array(CommissionTierSchema).optional(),
  metrics: MarketplaceMetricsSchema.optional(),

  // Platform fields
  productUrl: z.string().url().optional(),
  appStoreUrl: z.string().url().optional(),
  playStoreUrl: z.string().url().optional(),
  platforms: z.array(z.enum(['web', 'ios', 'android', 'desktop', 'api'])).optional(),

  // Trust & Safety
  verificationRequired: z.boolean().optional(),
  paymentEscrow: z.boolean().optional(),
  disputeResolution: z.boolean().optional(),
  insuranceProvided: z.boolean().optional(),

  // Categories
  categories: z.array(z.string()).optional(),
  geographies: z.array(z.string()).optional(),

  metadata: z.record(z.unknown()).optional(),
})

export type MarketplaceSchemaType = z.infer<typeof MarketplaceSchema>

/**
 * Marketplace Noun - two-sided marketplace business
 *
 * Extends Business with marketplace-specific metrics like GMV, take rate,
 * liquidity, and supply/demand balance.
 */
export const Marketplace = defineNoun({
  noun: 'Marketplace',
  plural: 'Marketplaces',
  $type: 'https://schema.org.ai/Marketplace',
  schema: MarketplaceSchema,
  extends: 'Business',
  okrs: [
    // Business OKRs
    'Revenue', 'Costs', 'Profit', 'GrossMargin', 'NetMargin',
    // Marketplace-specific OKRs
    'GMV', 'TakeRate', 'AOV', 'TransactionVolume',
    'TotalSellers', 'ActiveSellers', 'SellerChurnRate',
    'TotalBuyers', 'ActiveBuyers', 'BuyerChurnRate',
    'BuyerToSellerRatio', 'RepeatPurchaseRate',
    'Liquidity', 'SearchToTransaction', 'ListingToSale',
    'BuyerSatisfaction', 'SellerSatisfaction', 'DisputeRate',
  ],
})
