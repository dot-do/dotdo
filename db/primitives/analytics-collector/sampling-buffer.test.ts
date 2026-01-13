/**
 * Analytics Collector - Sampling and Buffer Management Tests
 *
 * Additional tests covering:
 * - Event sampling strategies
 * - Buffer overflow handling
 * - Memory pressure scenarios
 * - Concurrent flush operations
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  AnalyticsCollector,
  createAnalyticsCollector,
  type Destination,
  type TrackEvent,
  type EventMiddleware,
} from './index'
import {
  DestinationRouter,
  createDestinationRouter,
  type AnalyticsEvent,
  type EventFilter,
} from './destination-router'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockDestination(): Destination & {
  events: unknown[]
  callCount: number
  lastBatchSize: number
} {
  const events: unknown[] = []
  return {
    name: 'mock',
    events,
    callCount: 0,
    lastBatchSize: 0,
    send: async (batch) => {
      events.push(...batch)
      return { success: true, count: batch.length }
    },
  }
}

function createSlowDestination(delayMs: number): Destination & { events: unknown[] } {
  const events: unknown[] = []
  return {
    name: 'slow',
    events,
    send: async (batch) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      events.push(...batch)
      return { success: true, count: batch.length }
    },
  }
}

// ============================================================================
// SAMPLING MIDDLEWARE TESTS
// ============================================================================

describe('Sampling Middleware', () => {
  let analytics: AnalyticsCollector
  let mockDest: ReturnType<typeof createMockDestination>

  afterEach(async () => {
    await analytics?.close()
  })

  describe('percentage-based sampling', () => {
    it('should sample events at 50% rate approximately', async () => {
      mockDest = createMockDestination()

      // Deterministic sampling middleware using hash of messageId
      const sampleAt50Percent: EventMiddleware = (event) => {
        const evt = event as { messageId?: string }
        if (!evt.messageId) return event
        // Use a simple hash for deterministic sampling
        const hash = evt.messageId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
        return hash % 2 === 0 ? event : null
      }

      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 1000,
        middleware: [sampleAt50Percent],
      })

      // Track 100 events with predictable messageIds
      for (let i = 0; i < 100; i++) {
        await analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          messageId: `msg_${i}`,
        })
      }

      await analytics.flush()

      // Should be approximately 50%, allow some variance
      expect(mockDest.events.length).toBeGreaterThan(30)
      expect(mockDest.events.length).toBeLessThan(70)
    })

    it('should sample events at 10% rate approximately', async () => {
      mockDest = createMockDestination()

      // 10% sampling
      const sampleAt10Percent: EventMiddleware = (event) => {
        const evt = event as { messageId?: string }
        if (!evt.messageId) return event
        const hash = evt.messageId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
        return hash % 10 === 0 ? event : null
      }

      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 1000,
        middleware: [sampleAt10Percent],
      })

      for (let i = 0; i < 1000; i++) {
        await analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          messageId: `msg_${i}`,
        })
      }

      await analytics.flush()

      // Should be approximately 10%, allow variance
      expect(mockDest.events.length).toBeGreaterThan(50)
      expect(mockDest.events.length).toBeLessThan(150)
    })

    it('should sample at 100% (all events)', async () => {
      mockDest = createMockDestination()

      const sampleAll: EventMiddleware = (event) => event

      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 1000,
        middleware: [sampleAll],
      })

      for (let i = 0; i < 50; i++) {
        await analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          messageId: `msg_${i}`,
        })
      }

      await analytics.flush()
      expect(mockDest.events.length).toBe(50)
    })

    it('should sample at 0% (no events)', async () => {
      mockDest = createMockDestination()

      const sampleNone: EventMiddleware = () => null

      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 1000,
        middleware: [sampleNone],
      })

      for (let i = 0; i < 50; i++) {
        await analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          messageId: `msg_${i}`,
        })
      }

      await analytics.flush()
      expect(mockDest.events.length).toBe(0)
    })
  })

  describe('event-type based sampling', () => {
    it('should sample different event types at different rates', async () => {
      mockDest = createMockDestination()

      // Sample page views at 10%, track events at 100%
      const typeSampling: EventMiddleware = (event) => {
        const evt = event as { type: string; messageId?: string }
        if (evt.type === 'page') {
          const hash = (evt.messageId || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
          return hash % 10 === 0 ? event : null
        }
        return event // Keep all track events
      }

      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 1000,
        middleware: [typeSampling],
      })

      // Track 50 events
      for (let i = 0; i < 50; i++) {
        await analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          messageId: `track_${i}`,
        })
      }

      // Page 100 views
      for (let i = 0; i < 100; i++) {
        await analytics.page({
          userId: 'user_123',
          name: 'Home',
          messageId: `page_${i}`,
        })
      }

      await analytics.flush()

      const trackEvents = mockDest.events.filter((e) => (e as { type: string }).type === 'track')
      const pageEvents = mockDest.events.filter((e) => (e as { type: string }).type === 'page')

      expect(trackEvents.length).toBe(50) // All track events
      expect(pageEvents.length).toBeGreaterThan(5) // ~10% of page events
      expect(pageEvents.length).toBeLessThan(20)
    })
  })

  describe('user-based sampling', () => {
    it('should consistently sample by userId', async () => {
      mockDest = createMockDestination()

      // Sample users deterministically based on userId hash
      const userSampling: EventMiddleware = (event) => {
        const evt = event as { userId?: string }
        if (!evt.userId) return event
        const hash = evt.userId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
        return hash % 2 === 0 ? event : null
      }

      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 1000,
        middleware: [userSampling],
      })

      // Track events for multiple users
      const users = ['user_aaa', 'user_bbb', 'user_ccc', 'user_ddd', 'user_eee']
      for (const userId of users) {
        for (let i = 0; i < 10; i++) {
          await analytics.track({
            event: 'Test Event',
            userId,
          })
        }
      }

      await analytics.flush()

      // Each sampled user should have all their events or none
      for (const userId of users) {
        const userEvents = mockDest.events.filter(
          (e) => (e as { userId?: string }).userId === userId
        )
        // Should be either 0 or 10 events per user
        expect(userEvents.length === 0 || userEvents.length === 10).toBe(true)
      }
    })
  })

  describe('property-based sampling', () => {
    it('should sample based on event property values', async () => {
      mockDest = createMockDestination()

      // Only sample events with plan='premium'
      const planSampling: EventMiddleware = (event) => {
        const evt = event as { properties?: Record<string, unknown> }
        if (evt.properties?.plan === 'premium') {
          return event
        }
        // Drop 90% of free plan events
        const hash = Math.random()
        return hash < 0.1 ? event : null
      }

      // Use deterministic middleware for testing
      let callCount = 0
      const deterministicPlanSampling: EventMiddleware = (event) => {
        const evt = event as { properties?: Record<string, unknown> }
        if (evt.properties?.plan === 'premium') {
          return event
        }
        callCount++
        return callCount % 10 === 0 ? event : null
      }

      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 1000,
        middleware: [deterministicPlanSampling],
      })

      // 20 premium events
      for (let i = 0; i < 20; i++) {
        await analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          properties: { plan: 'premium' },
        })
      }

      // 100 free events
      for (let i = 0; i < 100; i++) {
        await analytics.track({
          event: 'Test Event',
          userId: 'user_123',
          properties: { plan: 'free' },
        })
      }

      await analytics.flush()

      const premiumEvents = mockDest.events.filter(
        (e) => (e as { properties?: Record<string, unknown> }).properties?.plan === 'premium'
      )
      const freeEvents = mockDest.events.filter(
        (e) => (e as { properties?: Record<string, unknown> }).properties?.plan === 'free'
      )

      expect(premiumEvents.length).toBe(20) // All premium events
      expect(freeEvents.length).toBe(10) // 10% of free events
    })
  })
})

// ============================================================================
// BUFFER MANAGEMENT TESTS
// ============================================================================

describe('Buffer Management', () => {
  let analytics: AnalyticsCollector
  let mockDest: ReturnType<typeof createMockDestination>

  afterEach(async () => {
    await analytics?.close()
  })

  describe('queue overflow behavior', () => {
    it('should drop oldest events when queue is full', async () => {
      mockDest = createMockDestination()
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
        flushInterval: 60000,
        maxQueueSize: 5,
      })

      // Queue 10 events (max is 5)
      for (let i = 0; i < 10; i++) {
        await analytics.track({
          event: `Event ${i}`,
          userId: 'user_123',
        })
      }

      await analytics.flush()

      // Should only have last 5 events
      expect(mockDest.events.length).toBe(5)
      expect((mockDest.events[0] as TrackEvent).event).toBe('Event 5')
      expect((mockDest.events[4] as TrackEvent).event).toBe('Event 9')
    })

    it('should handle rapid event bursts', async () => {
      mockDest = createMockDestination()
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
        flushInterval: 60000,
        maxQueueSize: 50,
      })

      // Rapid fire events
      const promises = []
      for (let i = 0; i < 100; i++) {
        promises.push(
          analytics.track({
            event: `Rapid Event ${i}`,
            userId: 'user_123',
          })
        )
      }
      await Promise.all(promises)

      await analytics.flush()

      // Should have at most maxQueueSize events
      expect(mockDest.events.length).toBeLessThanOrEqual(50)
      expect(mockDest.events.length).toBeGreaterThan(0)
    })

    it('should report correct queue size', async () => {
      mockDest = createMockDestination()
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
        maxQueueSize: 10,
      })

      expect(analytics.queueSize).toBe(0)

      await analytics.track({ event: 'E1', userId: 'u1' })
      await analytics.track({ event: 'E2', userId: 'u2' })
      await analytics.track({ event: 'E3', userId: 'u3' })

      expect(analytics.queueSize).toBe(3)

      await analytics.flush()
      expect(analytics.queueSize).toBe(0)
    })

    it('should handle queueSize correctly when dropping events', async () => {
      mockDest = createMockDestination()
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
        maxQueueSize: 3,
      })

      // Add 5 events to queue with max 3
      await analytics.track({ event: 'E1', userId: 'u1' })
      await analytics.track({ event: 'E2', userId: 'u2' })
      await analytics.track({ event: 'E3', userId: 'u3' })
      await analytics.track({ event: 'E4', userId: 'u4' })
      await analytics.track({ event: 'E5', userId: 'u5' })

      // Queue should be capped at 3
      expect(analytics.queueSize).toBe(3)
    })
  })

  describe('concurrent flush handling', () => {
    it('should handle concurrent flush calls safely', async () => {
      mockDest = createMockDestination()
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
      })

      // Add some events
      for (let i = 0; i < 10; i++) {
        await analytics.track({
          event: `Event ${i}`,
          userId: 'user_123',
        })
      }

      // Multiple concurrent flushes
      const results = await Promise.all([
        analytics.flush(),
        analytics.flush(),
        analytics.flush(),
      ])

      // All should succeed
      results.forEach((r) => expect(r.success).toBe(true))

      // Events should only be sent once
      expect(mockDest.events.length).toBe(10)
    })

    it('should not duplicate events with rapid flush/track interleaving', async () => {
      mockDest = createMockDestination()
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
      })

      // Interleave tracks and flushes
      const ops = []
      for (let i = 0; i < 20; i++) {
        ops.push(
          analytics.track({
            event: `Event ${i}`,
            userId: 'user_123',
            messageId: `msg_${i}`,
          })
        )
        if (i % 5 === 0) {
          ops.push(analytics.flush())
        }
      }
      await Promise.all(ops)
      await analytics.flush()

      // Check for duplicates by messageId
      const messageIds = mockDest.events.map((e) => (e as { messageId: string }).messageId)
      const uniqueIds = new Set(messageIds)
      expect(uniqueIds.size).toBe(messageIds.length)
    })
  })

  describe('flush timing', () => {
    it('should batch events within flush interval', async () => {
      vi.useFakeTimers()

      mockDest = createMockDestination()
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
        flushInterval: 1000,
      })

      // Add events
      await analytics.track({ event: 'E1', userId: 'u1' })
      await analytics.track({ event: 'E2', userId: 'u2' })

      expect(mockDest.events.length).toBe(0) // Not flushed yet

      // Advance time past flush interval
      vi.advanceTimersByTime(1100)
      await Promise.resolve() // Allow flush to complete

      expect(mockDest.events.length).toBe(2)

      vi.useRealTimers()
      await analytics.close()
    })

    it('should trigger immediate flush at flushAt threshold', async () => {
      mockDest = createMockDestination()
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 5,
        flushInterval: 60000, // Long interval
      })

      // Add 5 events to trigger flush
      for (let i = 0; i < 5; i++) {
        await analytics.track({
          event: `Event ${i}`,
          userId: 'user_123',
        })
      }

      // Give time for auto-flush to complete
      await new Promise((r) => setTimeout(r, 50))

      expect(mockDest.events.length).toBe(5)
    })
  })

  describe('slow destination handling', () => {
    it('should continue queuing while flush is in progress', async () => {
      const slowDest = createSlowDestination(100)
      analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [slowDest],
        flushAt: 100,
      })

      // Add initial events
      await analytics.track({ event: 'E1', userId: 'u1' })
      await analytics.track({ event: 'E2', userId: 'u2' })

      // Start flush (slow)
      const flushPromise = analytics.flush()

      // Add more events while flush is in progress
      await analytics.track({ event: 'E3', userId: 'u3' })
      await analytics.track({ event: 'E4', userId: 'u4' })

      await flushPromise

      // First batch should have been flushed
      expect(slowDest.events.length).toBe(2)

      // Flush remaining events
      await analytics.flush()
      expect(slowDest.events.length).toBe(4)
    })
  })
})

// ============================================================================
// DESTINATION ROUTER SAMPLING TESTS
// ============================================================================

describe('DestinationRouter Sampling', () => {
  describe('per-destination sampling', () => {
    it('should apply different sample rates per destination', async () => {
      const router = createDestinationRouter()

      const fullDest: AnalyticsEvent[] = []
      const sampledDest: AnalyticsEvent[] = []

      // Full destination - receives all events
      router.addDestination({
        name: 'full',
        send: async (events) => {
          fullDest.push(...events)
        },
      })

      // Sampled destination - 50% sample rate
      let sampleCount = 0
      router.addDestination({
        name: 'sampled',
        filter: () => {
          sampleCount++
          return sampleCount % 2 === 0
        },
        send: async (events) => {
          sampledDest.push(...events)
        },
      })

      const events: AnalyticsEvent[] = Array(100)
        .fill(null)
        .map((_, i) => ({
          type: 'track' as const,
          messageId: `msg_${i}`,
          timestamp: new Date().toISOString(),
          userId: 'user_123',
          event: `Event ${i}`,
        }))

      await router.route(events)

      expect(fullDest.length).toBe(100)
      expect(sampledDest.length).toBe(50)
    })

    it('should sample high-volume events for analytics destination', async () => {
      const router = createDestinationRouter()

      const analyticsEvents: AnalyticsEvent[] = []

      // Sample page views, keep all track events
      let pageViewCount = 0
      router.addDestination({
        name: 'analytics',
        filter: (event) => {
          if (event.type === 'track') return true
          if (event.type === 'page') {
            pageViewCount++
            return pageViewCount % 10 === 0 // 10% of page views
          }
          return true
        },
        send: async (events) => {
          analyticsEvents.push(...events)
        },
      })

      const events: AnalyticsEvent[] = []

      // 50 track events
      for (let i = 0; i < 50; i++) {
        events.push({
          type: 'track',
          messageId: `track_${i}`,
          timestamp: new Date().toISOString(),
          userId: 'user_123',
          event: 'Button Clicked',
        })
      }

      // 100 page views
      for (let i = 0; i < 100; i++) {
        events.push({
          type: 'page',
          messageId: `page_${i}`,
          timestamp: new Date().toISOString(),
          userId: 'user_123',
          name: 'Home',
        })
      }

      await router.route(events)

      const trackCount = analyticsEvents.filter((e) => e.type === 'track').length
      const pageCount = analyticsEvents.filter((e) => e.type === 'page').length

      expect(trackCount).toBe(50) // All track events
      expect(pageCount).toBe(10) // 10% of page views
    })
  })

  describe('weighted sampling', () => {
    it('should sample based on event importance/priority', async () => {
      const router = createDestinationRouter()

      const events: AnalyticsEvent[] = []

      // High priority events always included, low priority sampled
      let lowPriorityCount = 0
      router.addDestination({
        name: 'weighted',
        filter: (event) => {
          const priority = event.properties?.priority as string
          if (priority === 'high') return true
          if (priority === 'medium') {
            return Math.random() < 0.5 // 50%
          }
          lowPriorityCount++
          return lowPriorityCount % 10 === 0 // 10% of low priority
        },
        send: async (batch) => {
          events.push(...batch)
        },
      })

      const testEvents: AnalyticsEvent[] = []

      // 20 high priority
      for (let i = 0; i < 20; i++) {
        testEvents.push({
          type: 'track',
          messageId: `high_${i}`,
          timestamp: new Date().toISOString(),
          userId: 'user_123',
          event: 'High Priority',
          properties: { priority: 'high' },
        })
      }

      // 100 low priority
      for (let i = 0; i < 100; i++) {
        testEvents.push({
          type: 'track',
          messageId: `low_${i}`,
          timestamp: new Date().toISOString(),
          userId: 'user_123',
          event: 'Low Priority',
          properties: { priority: 'low' },
        })
      }

      await router.route(testEvents)

      const highPriority = events.filter(
        (e) => (e.properties?.priority as string) === 'high'
      )
      const lowPriority = events.filter(
        (e) => (e.properties?.priority as string) === 'low'
      )

      expect(highPriority.length).toBe(20) // All high priority
      expect(lowPriority.length).toBe(10) // 10% of low priority
    })
  })
})

// ============================================================================
// EDGE CASES AND ERROR SCENARIOS
// ============================================================================

describe('Edge Cases', () => {
  describe('empty and invalid inputs', () => {
    it('should handle empty event batch gracefully', async () => {
      const router = createDestinationRouter()
      const events: AnalyticsEvent[] = []

      router.addDestination({
        name: 'test',
        send: async (batch) => {
          events.push(...batch)
        },
      })

      const result = await router.route([])

      expect(result.success).toBe(true)
      expect(result.totalEvents).toBe(0)
      expect(events.length).toBe(0)
    })

    it('should handle null properties in events', async () => {
      const mockDest = createMockDestination()
      const analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 1,
      })

      await analytics.track({
        event: 'Test Event',
        userId: 'user_123',
        properties: {
          nullValue: null,
          defined: 'value',
        },
      })

      await analytics.flush()

      expect(mockDest.events.length).toBe(1)
      expect((mockDest.events[0] as { properties: Record<string, unknown> }).properties).toMatchObject({
        nullValue: null,
        defined: 'value',
      })

      await analytics.close()
    })

    it('should handle very large property values', async () => {
      const mockDest = createMockDestination()
      const analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 1,
      })

      // Large but under limit
      const largeString = 'X'.repeat(400 * 1024) // 400KB

      await analytics.track({
        event: 'Large Event',
        userId: 'user_123',
        properties: {
          largeData: largeString,
        },
      })

      await analytics.flush()

      expect(mockDest.events.length).toBe(1)

      await analytics.close()
    })
  })

  describe('destination failures during sampling', () => {
    it('should handle destination failure for sampled events', async () => {
      const router = createDestinationRouter({
        defaultRetry: { maxAttempts: 0 },
      })

      let sampleCount = 0
      const receivedEvents: AnalyticsEvent[] = []

      router.addDestination({
        name: 'failing-sampler',
        filter: () => {
          sampleCount++
          return sampleCount % 2 === 0
        },
        send: async (events) => {
          receivedEvents.push(...events)
          if (events.length > 25) {
            throw new Error('Batch too large')
          }
        },
      })

      const events: AnalyticsEvent[] = Array(100)
        .fill(null)
        .map((_, i) => ({
          type: 'track' as const,
          messageId: `msg_${i}`,
          timestamp: new Date().toISOString(),
          userId: 'user_123',
          event: `Event ${i}`,
        }))

      const result = await router.route(events)

      // Filter reduced events to 50, which exceeds 25, so should fail
      expect(result.success).toBe(false)
      expect(result.destinations[0].filtered).toBe(50)
    })
  })

  describe('middleware chain errors', () => {
    it('should handle middleware errors gracefully', async () => {
      const mockDest = createMockDestination()
      const errors: Error[] = []

      const analytics = createAnalyticsCollector({
        writeKey: 'test-key',
        destinations: [mockDest],
        flushAt: 100,
        middleware: [
          (event) => {
            const evt = event as { event?: string }
            if (evt.event === 'Error Event') {
              throw new Error('Middleware error')
            }
            return event
          },
        ],
        onError: (err) => errors.push(err),
      })

      // This should throw due to middleware
      await expect(
        analytics.track({
          event: 'Error Event',
          userId: 'user_123',
        })
      ).rejects.toThrow()

      // Normal event should work
      await analytics.track({
        event: 'Normal Event',
        userId: 'user_123',
      })

      await analytics.flush()
      expect(mockDest.events.length).toBe(1)

      await analytics.close()
    })
  })
})
