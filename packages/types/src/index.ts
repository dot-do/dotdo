/**
 * @dotdo/types v4 - Core type definitions
 * Zero dependencies, foundation for all packages
 */

// ============================================================================
// Core IDs
// ============================================================================

export type OrgId = string & { readonly __brand: 'OrgId' }
export type UserId = string & { readonly __brand: 'UserId' }
export type EventId = string & { readonly __brand: 'EventId' }
export type SubscriptionId = string & { readonly __brand: 'SubscriptionId' }
export type InvoiceId = string & { readonly __brand: 'InvoiceId' }

// ============================================================================
// Events (Core to everything)
// ============================================================================

export interface BaseEvent {
  id: EventId
  type: string
  timestamp: Date
  orgId?: OrgId
  metadata?: Record<string, unknown>
}

export interface Event<T = unknown> extends BaseEvent {
  data: T
}

// Standard event types
export type RpcEvent = Event<{
  method: string
  duration: number
  success: boolean
  error?: string
}>

export type CdcEvent = Event<{
  operation: 'insert' | 'update' | 'delete'
  collection: string
  docId: string
  before?: unknown
  after?: unknown
}>

export type LifecycleEvent = Event<{
  action: 'created' | 'activated' | 'hibernated' | 'deleted'
  doId: string
  doClass: string
}>

export type UsageEvent = Event<{
  metric: string
  value: number
  unit?: string
}>

// ============================================================================
// Analytics
// ============================================================================

export interface Period {
  start: Date
  end: Date
}

export interface AnalyticsQuery {
  metrics: string[]
  period: Period
  groupBy?: 'minute' | 'hour' | 'day' | 'week' | 'month'
  filters?: Record<string, unknown>
}

export interface AnalyticsResult {
  data: Record<string, unknown>[]
  period: Period
  computedAt: Date
}

export interface MaterializedView {
  name: string
  query: AnalyticsQuery
  refreshInterval: number // ms
  lastRefreshed?: Date
}

// ============================================================================
// Business Models
// ============================================================================

export type BusinessModelType = 'saas' | 'iaas' | 'paas' | 'daas'

export type PricingModel = 'outcome' | 'activity' | 'seat' | 'credit' | 'hybrid'

export interface EventMapping {
  eventType: string
  metric: string
  valueExtractor: string // JSONPath
  aggregation: 'sum' | 'count' | 'max' | 'avg'
}

export interface BillingRules {
  cycle: 'monthly' | 'annual' | 'usage'
  currency: string
  invoiceDay?: number // day of month for monthly
}

// ============================================================================
// Subscriptions & Billing
// ============================================================================

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'paused'
  | 'incomplete'

export interface Subscription {
  id: SubscriptionId
  orgId: OrgId
  modelId: string
  planId: string
  status: SubscriptionStatus
  currentPeriodStart: Date
  currentPeriodEnd: Date
  trialEnd?: Date
  canceledAt?: Date
  stripeSubscriptionId?: string
}

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

export interface LineItem {
  description: string
  metric?: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface Invoice {
  id: InvoiceId
  orgId: OrgId
  subscriptionId: SubscriptionId
  period: Period
  lineItems: LineItem[]
  subtotal: number
  tax: number
  total: number
  status: InvoiceStatus
  paidAt?: Date
  stripeInvoiceId?: string
}

// ============================================================================
// Entitlements
// ============================================================================

export interface Entitlement {
  feature: string
  enabled: boolean
  limit?: number
  used?: number
}

export interface EntitlementCheck {
  allowed: boolean
  reason?: string
  usage?: number
  limit?: number
}

// ============================================================================
// Plan & Pricing
// ============================================================================

export interface PlanTier {
  id: string
  name: string
  price: number // cents
  interval: 'month' | 'year'
  features: string[]
  limits: Record<string, number>
  overageRates?: Record<string, number>
}

export interface PricingConfig {
  model: PricingModel
  tiers?: PlanTier[]
  // Model-specific config
  outcomes?: Record<string, number> // outcome pricing
  activities?: Record<string, number> // activity pricing
  seats?: { price: number; included: number } // seat pricing
  credits?: { price: number; amount: number } // credit pricing
}

// ============================================================================
// Utility Types
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}
