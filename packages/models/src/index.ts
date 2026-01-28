/**
 * @dotdo/models v4 - Business model definitions
 * SaaS, IaaS, PaaS, DaaS patterns with pricing configurations
 */

import type {
  BusinessModelType,
  PricingModel,
  PricingConfig,
  EventMapping,
  BillingRules,
  PlanTier,
} from '@dotdo/types'

// ============================================================================
// Business Model Definitions
// ============================================================================

export interface BusinessModel {
  id: string
  type: BusinessModelType
  name: string
  description?: string
  pricing: PricingConfig
  eventMappings: EventMapping[]
  billingRules: BillingRules
}

// ============================================================================
// Model Type Extensions
// ============================================================================

export interface SaaSModel extends BusinessModel {
  type: 'saas'
  tiers: PlanTier[]
  trialDays?: number
  seats?: {
    included: number
    pricePerSeat: number
  }
}

export interface IaaSModel extends BusinessModel {
  type: 'iaas'
  resources: ResourceMetric[]
  commitments?: CommitmentOption[]
  spotPricing?: boolean
}

export interface PaaSModel extends BusinessModel {
  type: 'paas'
  environments: number
  includedBuilds: number
  burstPolicy: BurstConfig
}

export interface DaaSModel extends BusinessModel {
  type: 'daas'
  queryPricing: QueryPricingConfig
  dataTiers: DataTierConfig
  retentionDays: number
}

// ============================================================================
// Supporting Types
// ============================================================================

export interface ResourceMetric {
  name: string
  unit: string
  pricePerUnit: number
  freeIncluded?: number
}

export interface CommitmentOption {
  months: 12 | 36
  discountPercent: number
}

export interface BurstConfig {
  maxBurst: number
  burstPriceMultiplier: number
  cooldownMinutes: number
}

export interface QueryPricingConfig {
  pricePerQuery: number
  pricePerGB: number
  freeQueriesIncluded?: number
}

export interface DataTierConfig {
  hot: { maxGB: number; pricePerGB: number }
  warm: { maxGB: number; pricePerGB: number }
  cold: { pricePerGB: number }
}

// ============================================================================
// Model Builders
// ============================================================================

export function createSaaSModel(config: Omit<SaaSModel, 'type'>): SaaSModel {
  return {
    ...config,
    type: 'saas',
    billingRules: config.billingRules ?? { cycle: 'monthly', currency: 'USD' },
  }
}

export function createIaaSModel(config: Omit<IaaSModel, 'type'>): IaaSModel {
  return {
    ...config,
    type: 'iaas',
    billingRules: config.billingRules ?? { cycle: 'usage', currency: 'USD' },
  }
}

export function createPaaSModel(config: Omit<PaaSModel, 'type'>): PaaSModel {
  return {
    ...config,
    type: 'paas',
    billingRules: config.billingRules ?? { cycle: 'monthly', currency: 'USD' },
  }
}

export function createDaaSModel(config: Omit<DaaSModel, 'type'>): DaaSModel {
  return {
    ...config,
    type: 'daas',
    billingRules: config.billingRules ?? { cycle: 'usage', currency: 'USD' },
  }
}

// ============================================================================
// Pricing Builders (from lib-pricing patterns)
// ============================================================================

export interface OutcomePricing {
  model: 'outcome'
  outcomes: Record<string, number> // outcome name → price
  minimumMonthly?: number
}

export interface ActivityPricing {
  model: 'activity'
  activities: Record<string, number> // activity type → price
  rateLimits?: Record<string, { perMinute?: number; perHour?: number; perDay?: number }>
}

export interface SeatPricing {
  model: 'seat'
  pricePerSeat: number
  includedSeats?: number
  maxSeats?: number
  overflowBehavior?: 'queue' | 'reject' | 'burst'
  burstMultiplier?: number
}

export interface CreditPricing {
  model: 'credit'
  pricePerCredit: number
  creditsPerPurchase: number
  expirationDays?: number
  autoTopUp?: { threshold: number; amount: number }
  rollover?: boolean
}

export interface HybridPricing {
  model: 'hybrid'
  base: number // base subscription price
  outcomes?: Record<string, number>
  overage?: {
    included: number
    perUnit: number
    unit: string
  }
  bonusCredits?: {
    metric: string
    threshold: number
    credits: number
  }
}

export type Pricing =
  | OutcomePricing
  | ActivityPricing
  | SeatPricing
  | CreditPricing
  | HybridPricing

// ============================================================================
// Event Mapping Helpers
// ============================================================================

export function mapEventToMetric(
  eventType: string,
  metric: string,
  options: {
    valueExtractor?: string
    aggregation?: 'sum' | 'count' | 'max' | 'avg'
  } = {}
): EventMapping {
  return {
    eventType,
    metric,
    valueExtractor: options.valueExtractor ?? '$.data.value',
    aggregation: options.aggregation ?? 'sum',
  }
}

// Common mappings for .do services
export const commonEventMappings = {
  queries: mapEventToMetric('rpc.call', 'queries', { aggregation: 'count' }),
  duration: mapEventToMetric('rpc.call', 'duration_ms', { valueExtractor: '$.data.duration' }),
  storage: mapEventToMetric('storage.written', 'storage_bytes', { valueExtractor: '$.data.bytes' }),
  bandwidth: mapEventToMetric('data.transferred', 'bandwidth_bytes', { valueExtractor: '$.data.bytes' }),
}

// ============================================================================
// Example Models
// ============================================================================

/**
 * Example: postgres.do pricing model
 */
export const postgresDoModel: SaaSModel = createSaaSModel({
  id: 'postgres-do',
  name: 'postgres.do',
  description: 'Managed PostgreSQL on Cloudflare',
  pricing: {
    model: 'hybrid',
    tiers: [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        interval: 'month',
        features: ['shared-database'],
        limits: { queries: 10000, storage_gb: 1 },
      },
      {
        id: 'pro',
        name: 'Pro',
        price: 2900, // $29/mo
        interval: 'month',
        features: ['dedicated-database', 'backups', 'replicas'],
        limits: { queries: 1000000, storage_gb: 10 },
        overageRates: { queries: 0.0001, storage_gb: 0.1 },
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 29900, // $299/mo
        interval: 'month',
        features: ['dedicated-database', 'backups', 'replicas', 'sla', 'support'],
        limits: { queries: -1, storage_gb: 100 }, // -1 = unlimited
        overageRates: { storage_gb: 0.08 },
      },
    ],
  },
  eventMappings: [commonEventMappings.queries, commonEventMappings.storage],
  billingRules: { cycle: 'monthly', currency: 'USD', invoiceDay: 1 },
  tiers: [], // populated from pricing.tiers
})

/**
 * Example: agents.do pricing model (IaaS-style)
 */
export const agentsDoModel: IaaSModel = createIaaSModel({
  id: 'agents-do',
  name: 'agents.do',
  description: 'AI Agent Execution Platform',
  pricing: {
    model: 'activity',
    activities: {
      'agent.invoked': 0.01, // $0.01 per invocation
      'tokens.input': 0.00001, // per token
      'tokens.output': 0.00003, // per token
    },
  },
  eventMappings: [
    mapEventToMetric('agent.invoked', 'invocations', { aggregation: 'count' }),
    mapEventToMetric('agent.completed', 'tokens_in', { valueExtractor: '$.data.inputTokens' }),
    mapEventToMetric('agent.completed', 'tokens_out', { valueExtractor: '$.data.outputTokens' }),
  ],
  billingRules: { cycle: 'usage', currency: 'USD' },
  resources: [
    { name: 'invocations', unit: 'call', pricePerUnit: 0.01 },
    { name: 'tokens_in', unit: 'token', pricePerUnit: 0.00001 },
    { name: 'tokens_out', unit: 'token', pricePerUnit: 0.00003 },
  ],
})

// ============================================================================
// Re-exports
// ============================================================================

export type {
  BusinessModelType,
  PricingModel,
  PricingConfig,
  EventMapping,
  BillingRules,
  PlanTier,
} from '@dotdo/types'
