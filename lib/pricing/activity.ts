/**
 * Activity-Based Pricing - Pay per action taken pricing model
 *
 * Tracks activities, calculates charges, and enforces rate limits.
 *
 * @example
 * const pricing: ActivityPricing = {
 *   model: 'activity',
 *   activities: {
 *     EmailDrafted: 0.10,
 *     CallScheduled: 1.00,
 *     ReportGenerated: 5.00,
 *   },
 *   rateLimits: {
 *     EmailDrafted: { perMinute: 100, perHour: 1000 },
 *   },
 * }
 *
 * const tracker = createActivityTracker(pricing)
 * tracker.record('EmailDrafted')
 * console.log(tracker.getCost()) // 0.10
 *
 * @module lib/pricing/activity
 */

import type { ActivityPricing, RateLimit } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Activity usage counts - map of activity name to count
 */
export type ActivityUsage = Record<string, number>

/**
 * Activity event with timestamp and optional metadata
 */
export interface ActivityEvent {
  /** Activity name */
  activity: string
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Optional metadata about the event */
  metadata?: Record<string, unknown>
}

/**
 * Successful record result
 */
export interface RecordSuccess {
  success: true
}

/**
 * Rate limit exceeded error
 */
export interface RateLimitError {
  success: false
  error: 'rate_limit_exceeded'
  limit: 'perMinute' | 'perHour' | 'perDay'
  maxAllowed: number
  activity: string
}

/**
 * Result of recording an activity
 */
export type RecordResult = RecordSuccess | RateLimitError

/**
 * Remaining quota for rate-limited activities
 */
export interface RemainingQuota {
  perMinute?: number
  perHour?: number
  perDay?: number
}

/**
 * Options for creating an activity tracker
 */
export interface ActivityTrackerOptions {
  /** Custom time provider for testing */
  now?: () => number
}

/**
 * Activity tracker interface
 */
export interface ActivityTracker {
  /** Record an activity event */
  record(activity: string, metadata?: Record<string, unknown>): RecordResult
  /** Get current usage counts */
  getUsage(): ActivityUsage
  /** Get all recorded events */
  getEvents(): ActivityEvent[]
  /** Calculate current cost based on usage */
  getCost(): number
  /** Reset all usage and events */
  reset(): void
  /** Get remaining rate limit quota for an activity */
  getRemainingQuota(activity: string): RemainingQuota | undefined
  /** Get the pricing config */
  getPricing(): ActivityPricing
}

// ============================================================================
// Pure cost calculation
// ============================================================================

/**
 * Calculate the total cost based on activity usage
 *
 * @param pricing - The activity pricing configuration
 * @param usage - Map of activity names to counts
 * @returns Total cost in dollars
 *
 * @example
 * const pricing: ActivityPricing = {
 *   model: 'activity',
 *   activities: { EmailDrafted: 0.10, CallScheduled: 1.00 },
 * }
 * const cost = calculateActivityCost(pricing, { EmailDrafted: 5, CallScheduled: 2 })
 * // cost = 2.50 (5 * 0.10 + 2 * 1.00)
 */
export function calculateActivityCost(pricing: ActivityPricing, usage: ActivityUsage): number {
  let total = 0

  for (const [activity, count] of Object.entries(usage)) {
    const price = pricing.activities[activity]
    if (price !== undefined) {
      total += price * count
    }
  }

  return total
}

// ============================================================================
// Activity Tracker Implementation
// ============================================================================

/**
 * Create an activity tracker for tracking events and enforcing rate limits
 *
 * @param pricing - The activity pricing configuration
 * @param options - Optional configuration (e.g., custom time provider)
 * @returns ActivityTracker instance
 *
 * @example
 * const tracker = createActivityTracker(pricing)
 * tracker.record('EmailDrafted')
 * tracker.record('EmailDrafted', { recipient: 'user@example.com' })
 * console.log(tracker.getCost()) // 0.20
 */
export function createActivityTracker(
  pricing: ActivityPricing,
  options: ActivityTrackerOptions = {}
): ActivityTracker {
  const now = options.now ?? (() => Date.now())
  const events: ActivityEvent[] = []
  const usage: ActivityUsage = {}

  /**
   * Check if adding an event would exceed rate limits
   */
  function checkRateLimits(activity: string): RateLimitError | null {
    const limits = pricing.rateLimits?.[activity]
    if (!limits) {
      return null
    }

    const currentTime = now()
    const oneMinuteAgo = currentTime - 60 * 1000
    const oneHourAgo = currentTime - 60 * 60 * 1000
    const oneDayAgo = currentTime - 24 * 60 * 60 * 1000

    // Count events in each window
    let countInMinute = 0
    let countInHour = 0
    let countInDay = 0

    for (const event of events) {
      if (event.activity !== activity) continue

      if (event.timestamp > oneMinuteAgo) {
        countInMinute++
      }
      if (event.timestamp > oneHourAgo) {
        countInHour++
      }
      if (event.timestamp > oneDayAgo) {
        countInDay++
      }
    }

    // Check limits in order of granularity
    if (limits.perMinute !== undefined && countInMinute >= limits.perMinute) {
      return {
        success: false,
        error: 'rate_limit_exceeded',
        limit: 'perMinute',
        maxAllowed: limits.perMinute,
        activity,
      }
    }

    if (limits.perHour !== undefined && countInHour >= limits.perHour) {
      return {
        success: false,
        error: 'rate_limit_exceeded',
        limit: 'perHour',
        maxAllowed: limits.perHour,
        activity,
      }
    }

    if (limits.perDay !== undefined && countInDay >= limits.perDay) {
      return {
        success: false,
        error: 'rate_limit_exceeded',
        limit: 'perDay',
        maxAllowed: limits.perDay,
        activity,
      }
    }

    return null
  }

  /**
   * Calculate remaining quota for an activity
   */
  function calculateRemainingQuota(activity: string): RemainingQuota | undefined {
    const limits = pricing.rateLimits?.[activity]
    if (!limits) {
      return undefined
    }

    const currentTime = now()
    const oneMinuteAgo = currentTime - 60 * 1000
    const oneHourAgo = currentTime - 60 * 60 * 1000
    const oneDayAgo = currentTime - 24 * 60 * 60 * 1000

    let countInMinute = 0
    let countInHour = 0
    let countInDay = 0

    for (const event of events) {
      if (event.activity !== activity) continue

      if (event.timestamp > oneMinuteAgo) {
        countInMinute++
      }
      if (event.timestamp > oneHourAgo) {
        countInHour++
      }
      if (event.timestamp > oneDayAgo) {
        countInDay++
      }
    }

    const quota: RemainingQuota = {}

    if (limits.perMinute !== undefined) {
      quota.perMinute = Math.max(0, limits.perMinute - countInMinute)
    }
    if (limits.perHour !== undefined) {
      quota.perHour = Math.max(0, limits.perHour - countInHour)
    }
    if (limits.perDay !== undefined) {
      quota.perDay = Math.max(0, limits.perDay - countInDay)
    }

    return quota
  }

  return {
    record(activity: string, metadata?: Record<string, unknown>): RecordResult {
      // Check rate limits before recording
      const rateLimitError = checkRateLimits(activity)
      if (rateLimitError) {
        return rateLimitError
      }

      // Record the event
      const event: ActivityEvent = {
        activity,
        timestamp: now(),
      }

      if (metadata) {
        event.metadata = metadata
      }

      events.push(event)

      // Update usage count
      usage[activity] = (usage[activity] ?? 0) + 1

      return { success: true }
    },

    getUsage(): ActivityUsage {
      return { ...usage }
    },

    getEvents(): ActivityEvent[] {
      return [...events]
    },

    getCost(): number {
      return calculateActivityCost(pricing, usage)
    },

    reset(): void {
      events.length = 0
      for (const key of Object.keys(usage)) {
        delete usage[key]
      }
    },

    getRemainingQuota(activity: string): RemainingQuota | undefined {
      return calculateRemainingQuota(activity)
    },

    getPricing(): ActivityPricing {
      return pricing
    },
  }
}
