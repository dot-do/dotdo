/**
 * Pricing Model Types - Type definitions for dotdo pricing models
 *
 * Supports multiple pricing strategies for Business-as-Code:
 * - Outcome-based: Pay per successful outcome (signal-based)
 * - Activity-based: Pay per API call, message, or action
 * - Seat-based: Concurrency limits for agents and humans
 * - Credit-based: Prepaid credits with top-up options
 * - Hybrid: Combines multiple models (base + outcomes + overage)
 *
 * @module lib/pricing/types
 */

// ============================================================================
// Pricing Model Union Type
// ============================================================================

/**
 * Supported pricing model types
 *
 * @example
 * const model: PricingModel = 'outcome'
 * const model: PricingModel = 'hybrid'
 */
export type PricingModel = 'outcome' | 'activity' | 'seat' | 'credit' | 'hybrid'

// ============================================================================
// Outcome-Based Pricing
// ============================================================================

/**
 * Outcome-based pricing - Pay per successful outcome (signal-based)
 *
 * Price outcomes by business value, not compute time.
 * Each outcome key maps to a price in dollars.
 *
 * @example
 * const pricing: OutcomePricing = {
 *   model: 'outcome',
 *   outcomes: {
 *     TicketResolved: 0.99,
 *     LeadQualified: 5.00,
 *     OrderPlaced: 2.50,
 *   },
 *   minimumCharge: 50,
 * }
 */
export interface OutcomePricing {
  /** Pricing model discriminator */
  model: 'outcome'
  /** Map of outcome names to prices (in dollars) */
  outcomes: Record<string, number>
  /** Optional descriptions for each outcome */
  descriptions?: Record<string, string>
  /** Minimum monthly charge (in dollars) */
  minimumCharge?: number
}

// ============================================================================
// Activity-Based Pricing
// ============================================================================

/**
 * Rate limit configuration for an activity
 */
export interface RateLimit {
  /** Maximum calls per minute */
  perMinute?: number
  /** Maximum calls per hour */
  perHour?: number
  /** Maximum calls per day */
  perDay?: number
}

/**
 * Activity-based pricing - Pay per API call, message, or action
 *
 * Price activities by usage, similar to cloud provider billing.
 *
 * @example
 * const pricing: ActivityPricing = {
 *   model: 'activity',
 *   activities: {
 *     apiCall: 0.001,
 *     messageProcessed: 0.01,
 *   },
 *   rateLimits: {
 *     apiCall: { perMinute: 1000, perDay: 100000 },
 *   },
 * }
 */
export interface ActivityPricing {
  /** Pricing model discriminator */
  model: 'activity'
  /** Map of activity names to prices (in dollars) */
  activities: Record<string, number>
  /** Optional rate limits per activity */
  rateLimits?: Record<string, RateLimit>
}

// ============================================================================
// Seat-Based Pricing
// ============================================================================

/**
 * Seat configuration for agents or humans
 */
export interface SeatConfig {
  /** Number of concurrent seats */
  count: number
  /** Price per seat period (in dollars) */
  price: number
}

/**
 * Behavior when seat limit is exceeded
 */
export type SeatOverflowBehavior = 'queue' | 'reject' | 'burst-pricing'

/**
 * Seat-based pricing - Concurrency limits for agents and humans
 *
 * Control the number of concurrent agents and humans.
 * Supports overflow handling strategies.
 *
 * @example
 * const pricing: SeatPricing = {
 *   model: 'seat',
 *   agents: { count: 5, price: 500 },
 *   humans: { count: 2, price: 2000 },
 *   overflow: 'burst-pricing',
 *   burstMultiplier: 1.5,
 * }
 */
export interface SeatPricing {
  /** Pricing model discriminator */
  model: 'seat'
  /** Agent seat configuration */
  agents: SeatConfig
  /** Human seat configuration */
  humans: SeatConfig
  /** Behavior when concurrency limit exceeded */
  overflow?: SeatOverflowBehavior
  /** Multiplier for burst pricing (e.g., 1.5 = 50% more) */
  burstMultiplier?: number
}

// ============================================================================
// Credit-Based Pricing
// ============================================================================

/**
 * Auto top-up configuration for credits
 */
export interface CreditTopUp {
  /** Whether auto top-up is enabled */
  enabled: boolean
  /** Credit balance threshold that triggers top-up */
  threshold: number
  /** Number of credits to add on top-up */
  amount: number
}

/**
 * Credit-based pricing - Prepaid credits with top-up options
 *
 * Buy credits in bundles with optional auto top-up.
 *
 * @example
 * const pricing: CreditPricing = {
 *   model: 'credit',
 *   price: 100,
 *   amount: 1000,
 *   expiration: 365,
 *   topUp: {
 *     enabled: true,
 *     threshold: 100,
 *     amount: 500,
 *   },
 * }
 */
export interface CreditPricing {
  /** Pricing model discriminator */
  model: 'credit'
  /** Price per credit bundle (in dollars) */
  price: number
  /** Number of credits in bundle */
  amount: number
  /** Days until credits expire (null = no expiry) */
  expiration?: number | null
  /** Auto top-up configuration */
  topUp?: CreditTopUp
  /** Whether unused credits roll over to next period */
  rollover?: boolean
}

// ============================================================================
// Hybrid Pricing
// ============================================================================

/**
 * Overage pricing configuration for hybrid plans
 */
export interface OveragePricing {
  /** Number of units included in base price */
  included: number
  /** Price per unit over the included amount */
  perUnit: number
  /** Unit type (e.g., 'message', 'apiCall', 'minute') */
  unit: string
}

/**
 * Bonus credits configuration for hybrid plans
 */
export interface BonusCredits {
  /** Number of bonus credits */
  credits: number
  /** Description of the bonus */
  description?: string
}

/**
 * Hybrid pricing - Combines multiple pricing models
 *
 * Base subscription + outcome fees + overage + bonuses.
 *
 * @example
 * const pricing: HybridPricing = {
 *   model: 'hybrid',
 *   base: 199,
 *   outcomes: {
 *     TicketResolved: 0.25,
 *   },
 *   overage: {
 *     included: 5000,
 *     perUnit: 0.005,
 *     unit: 'apiCall',
 *   },
 *   bonus: {
 *     credits: 1000,
 *     description: 'Premium tier bonus',
 *   },
 * }
 */
export interface HybridPricing {
  /** Pricing model discriminator */
  model: 'hybrid'
  /** Base monthly subscription (in dollars) */
  base: number
  /** Optional outcome-based fees */
  outcomes?: Record<string, number>
  /** Optional overage pricing */
  overage?: OveragePricing
  /** Optional bonus credits */
  bonus?: BonusCredits
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * Union of all pricing configurations
 *
 * Use the `model` discriminator to narrow the type.
 *
 * @example
 * function calculatePrice(config: PricingConfig) {
 *   switch (config.model) {
 *     case 'outcome':
 *       return Object.values(config.outcomes).reduce((a, b) => a + b, 0)
 *     case 'seat':
 *       return config.agents.price + config.humans.price
 *     // ...
 *   }
 * }
 */
export type PricingConfig =
  | OutcomePricing
  | ActivityPricing
  | SeatPricing
  | CreditPricing
  | HybridPricing
