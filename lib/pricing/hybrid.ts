/**
 * Hybrid Pricing Calculator - Combines multiple pricing models
 *
 * Supports:
 * - Base subscription pricing
 * - Outcome-based fees (pay per successful outcome)
 * - Overage pricing (after included threshold)
 * - Bonus credits (based on metric thresholds)
 *
 * @module lib/pricing/hybrid
 */

import type { HybridPricing, OveragePricing, BonusCredits } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Usage data for hybrid pricing calculation
 */
export interface HybridUsage {
  /** Outcome counts by outcome type */
  outcomes?: Record<string, number>
  /** Usage counts by unit type */
  usage?: Record<string, number>
  /** Metric values for bonus thresholds */
  metrics?: Record<string, number>
}

/**
 * Metric threshold configuration for bonus credits
 */
export interface MetricThreshold {
  /** Name of the metric to evaluate */
  metric: string
  /** Minimum value required to earn bonus */
  threshold: number
}

/**
 * Detailed breakdown of overage charges
 */
export interface OverageDetails {
  /** The unit type (e.g., 'apiCall') */
  unit: string
  /** Units included in base price */
  included: number
  /** Actual units used */
  used: number
  /** Units over the included amount */
  overage: number
}

/**
 * Itemized bill from hybrid pricing calculation
 */
export interface HybridBill {
  /** Base subscription amount */
  base: number
  /** Total fees from outcomes */
  outcomesFee: number
  /** Total fees from overage */
  overageFee: number
  /** Bonus credits earned */
  bonusCredits: number
  /** Total amount due (base + outcomesFee + overageFee) */
  total: number
  /** Breakdown of fees by outcome type */
  outcomeBreakdown?: Record<string, number>
  /** Details about overage usage */
  overageDetails?: OverageDetails
}

// ============================================================================
// Main Calculator
// ============================================================================

/**
 * Calculate total price for hybrid pricing model
 *
 * Combines base subscription with outcome fees, overage charges,
 * and bonus credits based on actual usage.
 *
 * @param config - Hybrid pricing configuration
 * @param usage - Actual usage data for the period
 * @param threshold - Optional metric threshold for bonus credits
 * @returns Itemized bill with breakdown
 *
 * @example
 * const config: HybridPricing = {
 *   model: 'hybrid',
 *   base: 500,
 *   outcomes: { TicketResolved: 0.50 },
 *   overage: { included: 10000, perUnit: 0.75, unit: 'apiCall' },
 * }
 *
 * const bill = calculateHybridPrice(config, {
 *   outcomes: { TicketResolved: 100 },
 *   usage: { apiCall: 15000 },
 * })
 * // bill.total = 500 + 50 + 3750 = 4300
 */
export function calculateHybridPrice(
  config: HybridPricing,
  usage: HybridUsage,
  threshold?: MetricThreshold
): HybridBill {
  const base = config.base

  // Calculate outcome fees
  const outcomesFee = config.outcomes
    ? calculateOutcomeFees(config.outcomes, usage.outcomes)
    : 0

  // Calculate outcome breakdown
  const outcomeBreakdown = config.outcomes
    ? calculateOutcomeBreakdown(config.outcomes, usage.outcomes)
    : undefined

  // Calculate overage fees
  const overageFee = config.overage
    ? calculateOverageFees(config.overage, usage.usage)
    : 0

  // Calculate overage details
  const overageDetails = config.overage
    ? calculateOverageDetails(config.overage, usage.usage)
    : undefined

  // Calculate bonus credits
  const bonusCredits = calculateBonusCredits(config.bonus, usage.metrics || {}, threshold)

  // Total is base + outcome fees + overage fees
  // Bonus credits are separate (they don't reduce the total)
  const total = base + outcomesFee + overageFee

  return {
    base,
    outcomesFee,
    overageFee,
    bonusCredits,
    total,
    outcomeBreakdown,
    overageDetails,
  }
}

// ============================================================================
// Outcome Fee Calculator
// ============================================================================

/**
 * Calculate total outcome fees
 *
 * @param outcomePrices - Map of outcome types to prices
 * @param outcomeCounts - Map of outcome types to counts
 * @returns Total fee amount
 *
 * @example
 * const fee = calculateOutcomeFees(
 *   { TicketResolved: 0.50, LeadQualified: 2.00 },
 *   { TicketResolved: 100, LeadQualified: 50 }
 * )
 * // fee = 150
 */
export function calculateOutcomeFees(
  outcomePrices: Record<string, number>,
  outcomeCounts: Record<string, number> | undefined
): number {
  if (!outcomeCounts) {
    return 0
  }

  let total = 0

  for (const [outcomeType, price] of Object.entries(outcomePrices)) {
    const count = outcomeCounts[outcomeType] ?? 0
    total += count * price
  }

  return total
}

/**
 * Calculate breakdown of fees by outcome type
 */
function calculateOutcomeBreakdown(
  outcomePrices: Record<string, number>,
  outcomeCounts: Record<string, number> | undefined
): Record<string, number> | undefined {
  if (!outcomeCounts) {
    return undefined
  }

  const breakdown: Record<string, number> = {}
  let hasAny = false

  for (const [outcomeType, price] of Object.entries(outcomePrices)) {
    const count = outcomeCounts[outcomeType] ?? 0
    if (count > 0) {
      breakdown[outcomeType] = count * price
      hasAny = true
    }
  }

  return hasAny ? breakdown : undefined
}

// ============================================================================
// Overage Fee Calculator
// ============================================================================

/**
 * Calculate overage fees for usage above included threshold
 *
 * @param overage - Overage pricing configuration
 * @param usageCounts - Map of unit types to usage counts
 * @returns Overage fee amount
 *
 * @example
 * const fee = calculateOverageFees(
 *   { included: 10000, perUnit: 0.75, unit: 'apiCall' },
 *   { apiCall: 15000 }
 * )
 * // fee = 3750 (5000 overage * 0.75)
 */
export function calculateOverageFees(
  overage: OveragePricing,
  usageCounts: Record<string, number> | undefined
): number {
  if (!usageCounts) {
    return 0
  }

  const used = usageCounts[overage.unit] ?? 0

  // No overage if usage is at or below included amount
  if (used <= overage.included) {
    return 0
  }

  // Handle negative usage gracefully
  if (used < 0) {
    return 0
  }

  const overageUnits = used - overage.included
  return overageUnits * overage.perUnit
}

/**
 * Calculate detailed overage information
 */
function calculateOverageDetails(
  overage: OveragePricing,
  usageCounts: Record<string, number> | undefined
): OverageDetails | undefined {
  if (!usageCounts) {
    return undefined
  }

  const used = usageCounts[overage.unit]

  if (used === undefined) {
    return undefined
  }

  const actualUsed = Math.max(0, used)
  const overageAmount = Math.max(0, actualUsed - overage.included)

  return {
    unit: overage.unit,
    included: overage.included,
    used: actualUsed,
    overage: overageAmount,
  }
}

// ============================================================================
// Bonus Credits Calculator
// ============================================================================

/**
 * Calculate bonus credits based on optional metric threshold
 *
 * @param bonus - Bonus credits configuration
 * @param metrics - Current metric values
 * @param threshold - Optional threshold to evaluate
 * @returns Number of bonus credits earned
 *
 * @example
 * // Without threshold - always returns credits
 * const credits = calculateBonusCredits({ credits: 100 }, {})
 * // credits = 100
 *
 * @example
 * // With threshold - must meet metric value
 * const credits = calculateBonusCredits(
 *   { credits: 100 },
 *   { CSAT: 0.98 },
 *   { metric: 'CSAT', threshold: 0.95 }
 * )
 * // credits = 100 (0.98 >= 0.95)
 */
export function calculateBonusCredits(
  bonus: BonusCredits | undefined,
  metrics: Record<string, number>,
  threshold?: MetricThreshold
): number {
  if (!bonus) {
    return 0
  }

  // If no threshold defined, always return bonus credits
  if (!threshold) {
    return bonus.credits
  }

  // Check if metric value meets or exceeds threshold
  const metricValue = metrics[threshold.metric]

  if (metricValue === undefined) {
    return 0
  }

  if (metricValue >= threshold.threshold) {
    return bonus.credits
  }

  return 0
}
