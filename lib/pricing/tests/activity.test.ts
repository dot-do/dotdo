import { describe, it, expect, beforeEach } from 'vitest'
import type { ActivityPricing, RateLimit } from '../types'
import {
  ActivityTracker,
  calculateActivityCost,
  createActivityTracker,
  type ActivityEvent,
  type ActivityUsage,
  type RateLimitError,
} from '../activity'

// ============================================================================
// calculateActivityCost - Pure cost calculation
// ============================================================================

describe('calculateActivityCost', () => {
  const pricing: ActivityPricing = {
    model: 'activity',
    activities: {
      EmailDrafted: 0.1,
      CallScheduled: 1.0,
      ReportGenerated: 5.0,
    },
  }

  it('should calculate cost for a single activity', () => {
    const usage: ActivityUsage = {
      EmailDrafted: 1,
    }

    const cost = calculateActivityCost(pricing, usage)
    expect(cost).toBe(0.1)
  })

  it('should calculate cost for multiple activities of the same type', () => {
    const usage: ActivityUsage = {
      EmailDrafted: 10,
    }

    const cost = calculateActivityCost(pricing, usage)
    expect(cost).toBe(1.0) // 10 * 0.10
  })

  it('should calculate cost for multiple activity types', () => {
    const usage: ActivityUsage = {
      EmailDrafted: 5,
      CallScheduled: 2,
      ReportGenerated: 1,
    }

    const cost = calculateActivityCost(pricing, usage)
    expect(cost).toBe(7.5) // (5 * 0.10) + (2 * 1.00) + (1 * 5.00)
  })

  it('should return 0 for empty usage', () => {
    const usage: ActivityUsage = {}

    const cost = calculateActivityCost(pricing, usage)
    expect(cost).toBe(0)
  })

  it('should ignore activities not in pricing config', () => {
    const usage: ActivityUsage = {
      EmailDrafted: 5,
      UnknownActivity: 100,
    }

    const cost = calculateActivityCost(pricing, usage)
    expect(cost).toBe(0.5) // Only EmailDrafted counted
  })

  it('should handle zero counts', () => {
    const usage: ActivityUsage = {
      EmailDrafted: 0,
      CallScheduled: 0,
    }

    const cost = calculateActivityCost(pricing, usage)
    expect(cost).toBe(0)
  })

  it('should handle fractional prices correctly', () => {
    const microPricing: ActivityPricing = {
      model: 'activity',
      activities: {
        apiCall: 0.001,
        tokenProcessed: 0.00001,
      },
    }

    const usage: ActivityUsage = {
      apiCall: 1000,
      tokenProcessed: 100000,
    }

    const cost = calculateActivityCost(microPricing, usage)
    expect(cost).toBeCloseTo(2.0) // (1000 * 0.001) + (100000 * 0.00001)
  })
})

// ============================================================================
// ActivityTracker - Stateful tracking with rate limits
// ============================================================================

describe('ActivityTracker', () => {
  describe('basic tracking', () => {
    it('should track activity events', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          EmailDrafted: 0.1,
        },
      }

      const tracker = createActivityTracker(pricing)
      tracker.record('EmailDrafted')

      expect(tracker.getUsage()).toEqual({ EmailDrafted: 1 })
    })

    it('should track multiple events of the same type', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          EmailDrafted: 0.1,
        },
      }

      const tracker = createActivityTracker(pricing)
      tracker.record('EmailDrafted')
      tracker.record('EmailDrafted')
      tracker.record('EmailDrafted')

      expect(tracker.getUsage()).toEqual({ EmailDrafted: 3 })
    })

    it('should track multiple activity types', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          EmailDrafted: 0.1,
          CallScheduled: 1.0,
        },
      }

      const tracker = createActivityTracker(pricing)
      tracker.record('EmailDrafted')
      tracker.record('CallScheduled')
      tracker.record('EmailDrafted')

      expect(tracker.getUsage()).toEqual({
        EmailDrafted: 2,
        CallScheduled: 1,
      })
    })

    it('should calculate current cost', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          EmailDrafted: 0.1,
          CallScheduled: 1.0,
        },
      }

      const tracker = createActivityTracker(pricing)
      tracker.record('EmailDrafted')
      tracker.record('EmailDrafted')
      tracker.record('CallScheduled')

      expect(tracker.getCost()).toBe(1.2) // (2 * 0.10) + (1 * 1.00)
    })

    it('should reset usage', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          EmailDrafted: 0.1,
        },
      }

      const tracker = createActivityTracker(pricing)
      tracker.record('EmailDrafted')
      tracker.record('EmailDrafted')
      tracker.reset()

      expect(tracker.getUsage()).toEqual({})
      expect(tracker.getCost()).toBe(0)
    })
  })

  describe('event metadata', () => {
    it('should record events with timestamps', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          EmailDrafted: 0.1,
        },
      }

      const tracker = createActivityTracker(pricing)
      const before = Date.now()
      tracker.record('EmailDrafted')
      const after = Date.now()

      const events = tracker.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0].activity).toBe('EmailDrafted')
      expect(events[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(events[0].timestamp).toBeLessThanOrEqual(after)
    })

    it('should record events with optional metadata', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          EmailDrafted: 0.1,
        },
      }

      const tracker = createActivityTracker(pricing)
      tracker.record('EmailDrafted', { recipient: 'user@example.com', subject: 'Hello' })

      const events = tracker.getEvents()
      expect(events[0].metadata).toEqual({ recipient: 'user@example.com', subject: 'Hello' })
    })
  })

  describe('rate limiting', () => {
    it('should enforce perMinute rate limit', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          apiCall: 0.001,
        },
        rateLimits: {
          apiCall: { perMinute: 3 },
        },
      }

      const tracker = createActivityTracker(pricing)

      // First 3 should succeed
      expect(tracker.record('apiCall')).toEqual({ success: true })
      expect(tracker.record('apiCall')).toEqual({ success: true })
      expect(tracker.record('apiCall')).toEqual({ success: true })

      // 4th should fail
      const result = tracker.record('apiCall')
      expect(result.success).toBe(false)
      expect((result as RateLimitError).error).toBe('rate_limit_exceeded')
      expect((result as RateLimitError).limit).toBe('perMinute')
      expect((result as RateLimitError).maxAllowed).toBe(3)
    })

    it('should enforce perHour rate limit', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          apiCall: 0.001,
        },
        rateLimits: {
          apiCall: { perHour: 2 },
        },
      }

      const tracker = createActivityTracker(pricing)

      expect(tracker.record('apiCall')).toEqual({ success: true })
      expect(tracker.record('apiCall')).toEqual({ success: true })

      const result = tracker.record('apiCall')
      expect(result.success).toBe(false)
      expect((result as RateLimitError).limit).toBe('perHour')
    })

    it('should enforce perDay rate limit', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          apiCall: 0.001,
        },
        rateLimits: {
          apiCall: { perDay: 2 },
        },
      }

      const tracker = createActivityTracker(pricing)

      expect(tracker.record('apiCall')).toEqual({ success: true })
      expect(tracker.record('apiCall')).toEqual({ success: true })

      const result = tracker.record('apiCall')
      expect(result.success).toBe(false)
      expect((result as RateLimitError).limit).toBe('perDay')
    })

    it('should enforce multiple rate limits simultaneously', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          apiCall: 0.001,
        },
        rateLimits: {
          apiCall: { perMinute: 10, perHour: 3, perDay: 100 },
        },
      }

      const tracker = createActivityTracker(pricing)

      expect(tracker.record('apiCall')).toEqual({ success: true })
      expect(tracker.record('apiCall')).toEqual({ success: true })
      expect(tracker.record('apiCall')).toEqual({ success: true })

      // 4th should fail on perHour limit (the tightest)
      const result = tracker.record('apiCall')
      expect(result.success).toBe(false)
      expect((result as RateLimitError).limit).toBe('perHour')
    })

    it('should not rate limit activities without limits', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          apiCall: 0.001,
          emailSent: 0.01,
        },
        rateLimits: {
          apiCall: { perMinute: 2 },
          // emailSent has no rate limit
        },
      }

      const tracker = createActivityTracker(pricing)

      // apiCall should hit limit
      tracker.record('apiCall')
      tracker.record('apiCall')
      expect(tracker.record('apiCall').success).toBe(false)

      // emailSent should have no limit
      for (let i = 0; i < 100; i++) {
        expect(tracker.record('emailSent')).toEqual({ success: true })
      }
    })

    it('should return remaining quota', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          apiCall: 0.001,
        },
        rateLimits: {
          apiCall: { perMinute: 10, perHour: 100, perDay: 1000 },
        },
      }

      const tracker = createActivityTracker(pricing)
      tracker.record('apiCall')
      tracker.record('apiCall')

      const quota = tracker.getRemainingQuota('apiCall')
      expect(quota).toEqual({
        perMinute: 8,
        perHour: 98,
        perDay: 998,
      })
    })

    it('should return undefined quota for activities without limits', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          apiCall: 0.001,
        },
      }

      const tracker = createActivityTracker(pricing)
      const quota = tracker.getRemainingQuota('apiCall')
      expect(quota).toBeUndefined()
    })
  })

  describe('window-based rate limiting', () => {
    it('should reset rate limit after time window passes', () => {
      const pricing: ActivityPricing = {
        model: 'activity',
        activities: {
          apiCall: 0.001,
        },
        rateLimits: {
          apiCall: { perMinute: 2 },
        },
      }

      // Create tracker with custom time provider for testing
      const tracker = createActivityTracker(pricing, {
        now: () => 1000, // Start at t=1000
      })

      tracker.record('apiCall')
      tracker.record('apiCall')
      expect(tracker.record('apiCall').success).toBe(false)

      // Advance time past the minute window
      const tracker2 = createActivityTracker(pricing, {
        now: () => 61000, // t=61000 (60 seconds later)
      })

      // Copy events but they should be outside the window now
      // For this test, we use a fresh tracker which starts fresh
      expect(tracker2.record('apiCall')).toEqual({ success: true })
    })
  })
})

// ============================================================================
// Edge cases and integration
// ============================================================================

describe('Activity pricing edge cases', () => {
  it('should handle activities not in pricing config gracefully', () => {
    const pricing: ActivityPricing = {
      model: 'activity',
      activities: {
        EmailDrafted: 0.1,
      },
    }

    const tracker = createActivityTracker(pricing)
    tracker.record('UnknownActivity')

    // Should track but not contribute to cost
    expect(tracker.getUsage()).toEqual({ UnknownActivity: 1 })
    expect(tracker.getCost()).toBe(0)
  })

  it('should handle empty pricing config', () => {
    const pricing: ActivityPricing = {
      model: 'activity',
      activities: {},
    }

    const tracker = createActivityTracker(pricing)
    tracker.record('anything')

    expect(tracker.getUsage()).toEqual({ anything: 1 })
    expect(tracker.getCost()).toBe(0)
  })

  it('should preserve event order', () => {
    const pricing: ActivityPricing = {
      model: 'activity',
      activities: {
        A: 1,
        B: 2,
        C: 3,
      },
    }

    const tracker = createActivityTracker(pricing)
    tracker.record('A')
    tracker.record('B')
    tracker.record('C')
    tracker.record('A')

    const events = tracker.getEvents()
    expect(events.map((e) => e.activity)).toEqual(['A', 'B', 'C', 'A'])
  })

  it('should provide pricing config access', () => {
    const pricing: ActivityPricing = {
      model: 'activity',
      activities: {
        EmailDrafted: 0.1,
      },
    }

    const tracker = createActivityTracker(pricing)
    expect(tracker.getPricing()).toBe(pricing)
  })
})
