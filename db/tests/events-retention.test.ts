import { describe, it, expect, beforeEach } from 'vitest'
import { createEventsStore, createEventsStoreWithAdapter, type EventsStore, type RetentionPolicy } from '../events'
import { MemoryStorageAdapter } from '../adapters/memory'

/**
 * Retention Policy Tests for @dotdo/db
 *
 * Tests cover:
 * - Setting and getting retention policies
 * - Policy validation (positive values required)
 * - Age-based event cleanup (maxAgeDays)
 * - Count-based event cleanup (maxEvents)
 * - Combined policy cleanup
 * - Cleanup with no policy (no-op)
 * - Storage usage tracking
 *
 * Uses real implementations, no mocks per CLAUDE.md guidelines
 */

describe('Events Retention Policy', () => {
  describe('In-Memory Store', () => {
    let store: EventsStore

    beforeEach(() => {
      store = createEventsStore()
    })

    describe('setRetentionPolicy / getRetentionPolicy', () => {
      it('should set and retrieve a retention policy', async () => {
        const policy: RetentionPolicy = { maxEvents: 1000, maxAgeDays: 30 }

        await store.setRetentionPolicy(policy)
        const retrieved = await store.getRetentionPolicy()

        expect(retrieved).toEqual(policy)
      })

      it('should return undefined when no policy is set', async () => {
        const policy = await store.getRetentionPolicy()
        expect(policy).toBeUndefined()
      })

      it('should allow setting only maxEvents', async () => {
        await store.setRetentionPolicy({ maxEvents: 500 })
        const policy = await store.getRetentionPolicy()

        expect(policy?.maxEvents).toBe(500)
        expect(policy?.maxAgeDays).toBeUndefined()
      })

      it('should allow setting only maxAgeDays', async () => {
        await store.setRetentionPolicy({ maxAgeDays: 7 })
        const policy = await store.getRetentionPolicy()

        expect(policy?.maxAgeDays).toBe(7)
        expect(policy?.maxEvents).toBeUndefined()
      })

      it('should override previous policy when setting a new one', async () => {
        await store.setRetentionPolicy({ maxEvents: 100 })
        await store.setRetentionPolicy({ maxAgeDays: 30 })

        const policy = await store.getRetentionPolicy()
        expect(policy).toEqual({ maxAgeDays: 30 })
      })
    })

    describe('Policy Validation', () => {
      it('should reject maxEvents <= 0', async () => {
        await expect(store.setRetentionPolicy({ maxEvents: 0 }))
          .rejects.toThrow('maxEvents must be positive')

        await expect(store.setRetentionPolicy({ maxEvents: -1 }))
          .rejects.toThrow('maxEvents must be positive')
      })

      it('should reject maxAgeDays <= 0', async () => {
        await expect(store.setRetentionPolicy({ maxAgeDays: 0 }))
          .rejects.toThrow('maxAgeDays must be positive')

        await expect(store.setRetentionPolicy({ maxAgeDays: -5 }))
          .rejects.toThrow('maxAgeDays must be positive')
      })

      it('should accept positive fractional maxAgeDays', async () => {
        // 0.5 days = 12 hours - valid for short retention
        await store.setRetentionPolicy({ maxAgeDays: 0.5 })
        const policy = await store.getRetentionPolicy()

        expect(policy?.maxAgeDays).toBe(0.5)
      })

      it('should allow empty policy object', async () => {
        // Empty policy is valid but does nothing
        await store.setRetentionPolicy({})
        const policy = await store.getRetentionPolicy()

        expect(policy).toEqual({})
      })
    })

    describe('cleanup - No Policy', () => {
      it('should delete nothing when no policy is set', async () => {
        // Emit some events
        await store.emit({ type: 'test', payload: { n: 1 } })
        await store.emit({ type: 'test', payload: { n: 2 } })
        await store.emit({ type: 'test', payload: { n: 3 } })

        const result = await store.cleanup()

        expect(result.deleted).toBe(0)
        expect(await store.count()).toBe(3)
      })
    })

    describe('cleanup - Age-Based Retention (maxAgeDays)', () => {
      it('should purge events older than retention period', async () => {
        // Set a 1-day retention policy
        await store.setRetentionPolicy({ maxAgeDays: 1 })

        // Emit events with backdated timestamps
        const now = Date.now()
        const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000)
        const oneDayAgo = now - (1 * 24 * 60 * 60 * 1000)
        const oneHourAgo = now - (1 * 60 * 60 * 1000)

        // Use internal timestamp injection (emit accepts $timestamp)
        await store.emit({ type: 'old', payload: { age: '2days' }, $timestamp: twoDaysAgo } as any)
        await store.emit({ type: 'old', payload: { age: '1day' }, $timestamp: oneDayAgo } as any)
        await store.emit({ type: 'recent', payload: { age: '1hour' }, $timestamp: oneHourAgo } as any)
        await store.emit({ type: 'recent', payload: { age: 'now' } })

        expect(await store.count()).toBe(4)

        const result = await store.cleanup()

        // Events older than 1 day should be deleted (2 days ago and 1 day ago exact)
        expect(result.deleted).toBe(2)
        expect(await store.count()).toBe(2)

        // Verify remaining events are the recent ones
        const remaining = await store.query({})
        expect(remaining.every(e => e.type === 'recent')).toBe(true)
      })

      it('should handle cleanup with no events to delete', async () => {
        await store.setRetentionPolicy({ maxAgeDays: 30 })

        // All events are fresh
        await store.emit({ type: 'test', payload: {} })
        await store.emit({ type: 'test', payload: {} })

        const result = await store.cleanup()

        expect(result.deleted).toBe(0)
        expect(await store.count()).toBe(2)
      })

      it('should delete all events if all are older than retention period', async () => {
        await store.setRetentionPolicy({ maxAgeDays: 1 })

        const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000)

        await store.emit({ type: 'old', payload: { n: 1 }, $timestamp: twoDaysAgo } as any)
        await store.emit({ type: 'old', payload: { n: 2 }, $timestamp: twoDaysAgo } as any)
        await store.emit({ type: 'old', payload: { n: 3 }, $timestamp: twoDaysAgo } as any)

        const result = await store.cleanup()

        expect(result.deleted).toBe(3)
        expect(await store.count()).toBe(0)
      })
    })

    describe('cleanup - Count-Based Retention (maxEvents)', () => {
      it('should delete oldest events when count exceeds limit', async () => {
        await store.setRetentionPolicy({ maxEvents: 3 })

        // Emit 5 events with sequential timestamps
        const baseTime = Date.now()
        await store.emit({ type: 'event', payload: { n: 1 }, $timestamp: baseTime } as any)
        await store.emit({ type: 'event', payload: { n: 2 }, $timestamp: baseTime + 1000 } as any)
        await store.emit({ type: 'event', payload: { n: 3 }, $timestamp: baseTime + 2000 } as any)
        await store.emit({ type: 'event', payload: { n: 4 }, $timestamp: baseTime + 3000 } as any)
        await store.emit({ type: 'event', payload: { n: 5 }, $timestamp: baseTime + 4000 } as any)

        expect(await store.count()).toBe(5)

        const result = await store.cleanup()

        // Should delete 2 oldest events, keeping 3 newest
        expect(result.deleted).toBe(2)
        expect(await store.count()).toBe(3)

        // Verify the remaining events are the newest (n: 3, 4, 5)
        const remaining = await store.query({})
        const payloads = remaining.map(e => (e.payload as any).n).sort()
        expect(payloads).toEqual([3, 4, 5])
      })

      it('should not delete anything when count is within limit', async () => {
        await store.setRetentionPolicy({ maxEvents: 10 })

        await store.emit({ type: 'event', payload: { n: 1 } })
        await store.emit({ type: 'event', payload: { n: 2 } })
        await store.emit({ type: 'event', payload: { n: 3 } })

        const result = await store.cleanup()

        expect(result.deleted).toBe(0)
        expect(await store.count()).toBe(3)
      })

      it('should handle exact count match', async () => {
        await store.setRetentionPolicy({ maxEvents: 3 })

        await store.emit({ type: 'event', payload: { n: 1 } })
        await store.emit({ type: 'event', payload: { n: 2 } })
        await store.emit({ type: 'event', payload: { n: 3 } })

        const result = await store.cleanup()

        expect(result.deleted).toBe(0)
        expect(await store.count()).toBe(3)
      })

      it('should handle maxEvents = 1', async () => {
        await store.setRetentionPolicy({ maxEvents: 1 })

        const baseTime = Date.now()
        await store.emit({ type: 'event', payload: { n: 1 }, $timestamp: baseTime } as any)
        await store.emit({ type: 'event', payload: { n: 2 }, $timestamp: baseTime + 1000 } as any)
        await store.emit({ type: 'event', payload: { n: 3 }, $timestamp: baseTime + 2000 } as any)

        const result = await store.cleanup()

        expect(result.deleted).toBe(2)
        expect(await store.count()).toBe(1)

        // Should keep only the newest event
        const remaining = await store.query({})
        expect((remaining[0].payload as any).n).toBe(3)
      })
    })

    describe('cleanup - Combined Policy (maxEvents + maxAgeDays)', () => {
      it('should apply age-based cleanup before count-based cleanup', async () => {
        await store.setRetentionPolicy({ maxEvents: 5, maxAgeDays: 1 })

        const now = Date.now()
        const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000)

        // 3 old events (will be deleted by age policy)
        await store.emit({ type: 'old', payload: { n: 1 }, $timestamp: twoDaysAgo } as any)
        await store.emit({ type: 'old', payload: { n: 2 }, $timestamp: twoDaysAgo } as any)
        await store.emit({ type: 'old', payload: { n: 3 }, $timestamp: twoDaysAgo } as any)

        // 4 recent events (within maxEvents after age cleanup)
        await store.emit({ type: 'recent', payload: { n: 4 } })
        await store.emit({ type: 'recent', payload: { n: 5 } })
        await store.emit({ type: 'recent', payload: { n: 6 } })
        await store.emit({ type: 'recent', payload: { n: 7 } })

        expect(await store.count()).toBe(7)

        const result = await store.cleanup()

        // 3 deleted by age, 0 deleted by count (4 remaining < 5 maxEvents)
        expect(result.deleted).toBe(3)
        expect(await store.count()).toBe(4)
      })

      it('should apply both policies when needed', async () => {
        await store.setRetentionPolicy({ maxEvents: 2, maxAgeDays: 1 })

        const now = Date.now()
        const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000)
        const baseTime = now - (1 * 60 * 60 * 1000) // 1 hour ago

        // 2 old events (deleted by age)
        await store.emit({ type: 'old', payload: { n: 1 }, $timestamp: twoDaysAgo } as any)
        await store.emit({ type: 'old', payload: { n: 2 }, $timestamp: twoDaysAgo } as any)

        // 4 recent events (2 will be deleted by count after age cleanup)
        await store.emit({ type: 'recent', payload: { n: 3 }, $timestamp: baseTime } as any)
        await store.emit({ type: 'recent', payload: { n: 4 }, $timestamp: baseTime + 1000 } as any)
        await store.emit({ type: 'recent', payload: { n: 5 }, $timestamp: baseTime + 2000 } as any)
        await store.emit({ type: 'recent', payload: { n: 6 }, $timestamp: baseTime + 3000 } as any)

        expect(await store.count()).toBe(6)

        const result = await store.cleanup()

        // 2 deleted by age + 2 deleted by count = 4 total
        expect(result.deleted).toBe(4)
        expect(await store.count()).toBe(2)

        // Should keep the 2 newest recent events
        const remaining = await store.query({})
        const payloads = remaining.map(e => (e.payload as any).n).sort()
        expect(payloads).toEqual([5, 6])
      })
    })

    describe('count with filter', () => {
      it('should count events by type', async () => {
        await store.emit({ type: 'user.created', payload: {} })
        await store.emit({ type: 'user.created', payload: {} })
        await store.emit({ type: 'order.placed', payload: {} })

        expect(await store.count()).toBe(3)
        expect(await store.count({ type: 'user.created' })).toBe(2)
        expect(await store.count({ type: 'order.placed' })).toBe(1)
        expect(await store.count({ type: 'nonexistent' })).toBe(0)
      })
    })

    describe('getStorageUsage', () => {
      it('should return event count and estimated bytes', async () => {
        const initialUsage = await store.getStorageUsage()
        expect(initialUsage.eventCount).toBe(0)
        expect(initialUsage.bytesUsed).toBe(0)

        await store.emit({ type: 'test', payload: { data: 'hello world' } })
        await store.emit({ type: 'test', payload: { data: 'more data here' } })

        const usage = await store.getStorageUsage()
        expect(usage.eventCount).toBe(2)
        expect(usage.bytesUsed).toBeGreaterThan(0)
      })

      it('should update after cleanup', async () => {
        await store.setRetentionPolicy({ maxEvents: 1 })

        const baseTime = Date.now()
        await store.emit({ type: 'test', payload: { n: 1 }, $timestamp: baseTime } as any)
        await store.emit({ type: 'test', payload: { n: 2 }, $timestamp: baseTime + 1000 } as any)
        await store.emit({ type: 'test', payload: { n: 3 }, $timestamp: baseTime + 2000 } as any)

        const beforeUsage = await store.getStorageUsage()
        expect(beforeUsage.eventCount).toBe(3)

        await store.cleanup()

        const afterUsage = await store.getStorageUsage()
        expect(afterUsage.eventCount).toBe(1)
        expect(afterUsage.bytesUsed).toBeLessThan(beforeUsage.bytesUsed)
      })
    })
  })

  describe('Storage Adapter Store', () => {
    let store: EventsStore
    let adapter: MemoryStorageAdapter

    beforeEach(() => {
      adapter = new MemoryStorageAdapter()
      store = createEventsStoreWithAdapter(adapter)
    })

    describe('setRetentionPolicy / getRetentionPolicy', () => {
      it('should set and retrieve a retention policy', async () => {
        const policy: RetentionPolicy = { maxEvents: 500, maxAgeDays: 14 }

        await store.setRetentionPolicy(policy)
        const retrieved = await store.getRetentionPolicy()

        expect(retrieved).toEqual(policy)
      })

      it('should return undefined when no policy is set', async () => {
        const policy = await store.getRetentionPolicy()
        expect(policy).toBeUndefined()
      })
    })

    describe('Policy Validation', () => {
      it('should reject invalid policy values', async () => {
        await expect(store.setRetentionPolicy({ maxEvents: 0 }))
          .rejects.toThrow('maxEvents must be positive')

        await expect(store.setRetentionPolicy({ maxAgeDays: -1 }))
          .rejects.toThrow('maxAgeDays must be positive')
      })
    })

    describe('cleanup - Age-Based Retention', () => {
      it('should purge events older than retention period', async () => {
        await store.setRetentionPolicy({ maxAgeDays: 1 })

        const now = Date.now()
        const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000)

        await store.emit({ type: 'old', payload: { age: 'old' }, $timestamp: twoDaysAgo } as any)
        await store.emit({ type: 'recent', payload: { age: 'new' } })

        const result = await store.cleanup()

        expect(result.deleted).toBe(1)
        expect(await store.count()).toBe(1)

        const remaining = await store.query({})
        expect(remaining[0].type).toBe('recent')
      })
    })

    describe('cleanup - Count-Based Retention', () => {
      it('should delete oldest events when count exceeds limit', async () => {
        await store.setRetentionPolicy({ maxEvents: 2 })

        const baseTime = Date.now()
        await store.emit({ type: 'event', payload: { n: 1 }, $timestamp: baseTime } as any)
        await store.emit({ type: 'event', payload: { n: 2 }, $timestamp: baseTime + 1000 } as any)
        await store.emit({ type: 'event', payload: { n: 3 }, $timestamp: baseTime + 2000 } as any)

        const result = await store.cleanup()

        expect(result.deleted).toBe(1)
        expect(await store.count()).toBe(2)

        // Should keep the newest events
        const remaining = await store.query({})
        const payloads = remaining.map(e => (e.payload as any).n).sort()
        expect(payloads).toEqual([2, 3])
      })
    })

    describe('cleanup - No Policy', () => {
      it('should delete nothing when no policy is set', async () => {
        await store.emit({ type: 'test', payload: {} })
        await store.emit({ type: 'test', payload: {} })

        const result = await store.cleanup()

        expect(result.deleted).toBe(0)
        expect(await store.count()).toBe(2)
      })
    })

    describe('getStorageUsage', () => {
      it('should return accurate storage usage through adapter', async () => {
        const initial = await store.getStorageUsage()
        expect(initial.eventCount).toBe(0)

        await store.emit({ type: 'test', payload: { key: 'value' } })

        const usage = await store.getStorageUsage()
        expect(usage.eventCount).toBe(1)
        expect(usage.bytesUsed).toBeGreaterThan(0)
      })
    })
  })

  describe('Edge Cases', () => {
    let store: EventsStore

    beforeEach(() => {
      store = createEventsStore()
    })

    it('should handle cleanup on empty store with policy set', async () => {
      await store.setRetentionPolicy({ maxEvents: 10, maxAgeDays: 7 })

      const result = await store.cleanup()

      expect(result.deleted).toBe(0)
      expect(await store.count()).toBe(0)
    })

    it('should handle multiple consecutive cleanups', async () => {
      await store.setRetentionPolicy({ maxEvents: 2 })

      const baseTime = Date.now()
      await store.emit({ type: 'event', payload: { n: 1 }, $timestamp: baseTime } as any)
      await store.emit({ type: 'event', payload: { n: 2 }, $timestamp: baseTime + 1000 } as any)
      await store.emit({ type: 'event', payload: { n: 3 }, $timestamp: baseTime + 2000 } as any)
      await store.emit({ type: 'event', payload: { n: 4 }, $timestamp: baseTime + 3000 } as any)

      // First cleanup
      const result1 = await store.cleanup()
      expect(result1.deleted).toBe(2)
      expect(await store.count()).toBe(2)

      // Second cleanup should do nothing
      const result2 = await store.cleanup()
      expect(result2.deleted).toBe(0)
      expect(await store.count()).toBe(2)

      // Add more events
      await store.emit({ type: 'event', payload: { n: 5 }, $timestamp: baseTime + 4000 } as any)

      // Third cleanup should delete 1
      const result3 = await store.cleanup()
      expect(result3.deleted).toBe(1)
      expect(await store.count()).toBe(2)
    })

    it('should handle policy change between cleanups', async () => {
      await store.setRetentionPolicy({ maxEvents: 5 })

      const baseTime = Date.now()
      for (let i = 1; i <= 5; i++) {
        await store.emit({ type: 'event', payload: { n: i }, $timestamp: baseTime + i * 1000 } as any)
      }

      // First cleanup - no deletions needed
      const result1 = await store.cleanup()
      expect(result1.deleted).toBe(0)

      // Change policy to stricter limit
      await store.setRetentionPolicy({ maxEvents: 2 })

      // Second cleanup should delete 3 events
      const result2 = await store.cleanup()
      expect(result2.deleted).toBe(3)
      expect(await store.count()).toBe(2)
    })

    it('should handle events with same timestamp correctly', async () => {
      await store.setRetentionPolicy({ maxEvents: 2 })

      const sameTime = Date.now()
      await store.emit({ type: 'event', payload: { n: 1 }, $timestamp: sameTime } as any)
      await store.emit({ type: 'event', payload: { n: 2 }, $timestamp: sameTime } as any)
      await store.emit({ type: 'event', payload: { n: 3 }, $timestamp: sameTime } as any)

      const result = await store.cleanup()

      // Should delete 1 event (keeping 2)
      expect(result.deleted).toBe(1)
      expect(await store.count()).toBe(2)
    })

    it('should handle very large retention periods', async () => {
      // 365 days retention
      await store.setRetentionPolicy({ maxAgeDays: 365 })

      // Event from 6 months ago should be kept
      const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000)
      await store.emit({ type: 'event', payload: {}, $timestamp: sixMonthsAgo } as any)

      const result = await store.cleanup()

      expect(result.deleted).toBe(0)
      expect(await store.count()).toBe(1)
    })

    it('should handle very short retention periods', async () => {
      // 1 hour retention (0.0417 days)
      await store.setRetentionPolicy({ maxAgeDays: 1/24 })

      // Event from 2 hours ago should be deleted
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000)
      await store.emit({ type: 'old', payload: {}, $timestamp: twoHoursAgo } as any)

      // Event from 30 minutes ago should be kept
      const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000)
      await store.emit({ type: 'recent', payload: {}, $timestamp: thirtyMinutesAgo } as any)

      const result = await store.cleanup()

      expect(result.deleted).toBe(1)
      expect(await store.count()).toBe(1)
    })
  })
})
