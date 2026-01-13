/**
 * Pricing Module - Type definitions and utilities for dotdo pricing models
 *
 * @module lib/pricing
 */

// Re-export all types
export type {
  PricingModel,
  OutcomePricing,
  ActivityPricing,
  SeatPricing,
  CreditPricing,
  HybridPricing,
  PricingConfig,
  SeatConfig,
  SeatOverflowBehavior,
  RateLimit,
  CreditTopUp,
  OveragePricing,
  BonusCredits,
} from './types'

// Re-export outcome-based pricing utilities
export {
  createOutcomeTracker,
  calculateOutcomeCost,
  type OutcomeTracker,
  type OutcomeEvent,
  type OutcomeSummary,
  type BillingSignal,
  type OutcomeTrackerOptions,
} from './outcome'

// Re-export credit-based pricing utilities
export {
  createCreditAccount,
  type CreditAccount,
  type CreditPurchase,
  type CreditUsageResult,
  type TopUpEvent,
  type CreditAccountOptions,
} from './credit'

// Re-export activity-based pricing utilities
export {
  createActivityTracker,
  calculateActivityCost,
  type ActivityTracker,
  type ActivityEvent,
  type ActivityUsage,
  type RecordResult,
  type RecordSuccess,
  type RateLimitError,
  type RemainingQuota,
  type ActivityTrackerOptions,
} from './activity'

// Re-export hybrid pricing utilities
export {
  calculateHybridPrice,
  calculateOutcomeFees,
  calculateOverageFees,
  calculateBonusCredits,
  type HybridUsage,
  type HybridBill,
  type MetricThreshold,
  type OverageDetails,
} from './hybrid'

// Re-export seat-based pricing utilities
export {
  createSeatManager,
  type SeatManager,
  type SeatType,
  type AcquireResult,
  type SeatStatus,
  type SeatTypeStatus,
  type SeatCost,
  type SeatManagerConfig,
  type SeatManagerConfigView,
} from './seat'
