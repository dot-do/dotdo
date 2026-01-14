/**
 * Outcome-Based Pricing - Pay per result delivered
 *
 * Enables outcome-based pricing where customers pay for successful results
 * rather than activities or time spent.
 *
 * @example
 * const pricing: OutcomePricing = {
 *   model: 'outcome',
 *   outcomes: {
 *     TicketResolved: 0.99,
 *     LeadQualified: 5.00,
 *     ContentDelivered: 25.00,
 *   },
 * }
 *
 * const tracker = createOutcomeTracker(pricing)
 * tracker.recordOutcome('TicketResolved')
 * const summary = tracker.getSummary()
 *
 * @module lib/pricing/outcome
 */

import type { OutcomePricing } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a recorded outcome event
 */
export interface OutcomeEvent {
  /** The outcome type that occurred */
  outcome: string
  /** Price charged for this outcome (in dollars) */
  price: number
  /** When the outcome occurred */
  timestamp: Date
  /** Optional metadata about the outcome */
  metadata?: Record<string, unknown>
}

/**
 * Summary of all recorded outcomes
 */
export interface OutcomeSummary {
  /** Total cost of all outcomes (in dollars) */
  totalCost: number
  /** Total number of outcomes recorded */
  totalOutcomes: number
  /** Count of each outcome type */
  counts: Record<string, number>
  /** Cost breakdown by outcome type */
  costByOutcome: Record<string, number>
  /** Final chargeable amount (considering minimum charge) */
  chargeableAmount: number
  /** Whether minimum charge was applied */
  minimumApplied: boolean
}

/**
 * Billing signal emitted when an outcome is recorded
 */
export interface BillingSignal {
  /** Signal type */
  type: 'outcome'
  /** The outcome that triggered this signal */
  outcome: string
  /** Amount charged (in dollars) */
  amount: number
  /** When the outcome occurred */
  timestamp: Date
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for creating an outcome tracker
 */
export interface OutcomeTrackerOptions {
  /** Callback invoked when a billing signal is emitted */
  onBillingSignal?: (signal: BillingSignal) => void
}

/**
 * Interface for tracking outcome-based pricing
 */
export interface OutcomeTracker {
  /** Record an outcome event */
  recordOutcome(outcome: string, metadata?: Record<string, unknown>): OutcomeEvent
  /** Get summary of all recorded outcomes */
  getSummary(): OutcomeSummary
  /** Get all recorded events */
  getEvents(): OutcomeEvent[]
  /** Reset all recorded outcomes */
  reset(): void
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Creates an outcome tracker for the given pricing configuration
 *
 * @param pricing - Outcome pricing configuration
 * @param options - Optional tracker options
 * @returns An OutcomeTracker instance
 *
 * @example
 * const tracker = createOutcomeTracker({
 *   model: 'outcome',
 *   outcomes: { TicketResolved: 0.99 },
 * })
 *
 * tracker.recordOutcome('TicketResolved')
 * const summary = tracker.getSummary()
 */
export function createOutcomeTracker(
  pricing: OutcomePricing,
  options: OutcomeTrackerOptions = {}
): OutcomeTracker {
  const events: OutcomeEvent[] = []
  const { onBillingSignal } = options

  return {
    recordOutcome(outcome: string, metadata?: Record<string, unknown>): OutcomeEvent {
      const price = pricing.outcomes[outcome]

      if (price === undefined) {
        throw new Error(`Unknown outcome type: ${outcome}`)
      }

      const event: OutcomeEvent = {
        outcome,
        price,
        timestamp: new Date(),
        metadata,
      }

      events.push(event)

      // Emit billing signal if callback provided
      if (onBillingSignal) {
        const signal: BillingSignal = {
          type: 'outcome',
          outcome,
          amount: price,
          timestamp: event.timestamp,
          metadata,
        }
        onBillingSignal(signal)
      }

      return event
    },

    getSummary(): OutcomeSummary {
      const counts: Record<string, number> = {}
      const costByOutcome: Record<string, number> = {}
      let totalCost = 0

      for (const event of events) {
        counts[event.outcome] = (counts[event.outcome] || 0) + 1
        costByOutcome[event.outcome] = (costByOutcome[event.outcome] || 0) + event.price
        totalCost += event.price
      }

      const minimumCharge = pricing.minimumCharge ?? 0
      const minimumApplied = totalCost < minimumCharge && minimumCharge > 0
      const chargeableAmount = minimumApplied ? minimumCharge : totalCost

      return {
        totalCost,
        totalOutcomes: events.length,
        counts,
        costByOutcome,
        chargeableAmount,
        minimumApplied,
      }
    },

    getEvents(): OutcomeEvent[] {
      return [...events]
    },

    reset(): void {
      events.length = 0
    },
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate the cost for a given set of outcome counts
 *
 * Useful for estimating costs or calculating historical costs.
 *
 * @param pricing - Outcome pricing configuration
 * @param outcomeCounts - Map of outcome names to counts
 * @returns Total cost in dollars
 *
 * @example
 * const cost = calculateOutcomeCost(pricing, {
 *   TicketResolved: 10,
 *   LeadQualified: 5,
 * })
 */
export function calculateOutcomeCost(
  pricing: OutcomePricing,
  outcomeCounts: Record<string, number>
): number {
  let total = 0

  for (const [outcome, count] of Object.entries(outcomeCounts)) {
    const price = pricing.outcomes[outcome]
    if (price !== undefined) {
      total += price * count
    }
  }

  return total
}
