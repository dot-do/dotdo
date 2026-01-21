/**
 * Event Retention Policy Tests (do-luhm.6, do-avhr1.1)
 *
 * Tests for the event retention policy implementation that addresses the
 * 10GB Durable Object storage limit risk.
 *
 * Implemented features (do-avhr1.1):
 * - setRetentionPolicy() - Configure maxEvents and/or maxAgeDays
 * - getRetentionPolicy() - Retrieve current policy
 * - cleanup() - Remove events exceeding retention policy
 * - count() - Get event count (total or by type)
 * - getStorageUsage() - Monitor storage usage
 *
 * Future enhancements (skipped tests):
 * - Auto-cleanup when threshold exceeded
 * - Storage warning callbacks
 * - Hard limit enforcement
 * - R2 archiving before deletion
 * - DO integration (events accessor on DO class)
 * - Incremental cleanup for large event stores
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createEventsStore, type EventsStore, type Event } from '@dotdo/db'
import { DO } from '../DO'

// Mock DurableObjectState for DO tests
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'retention-test-do' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
}

describe('Event Retention Policy (do-luhm.6)', () => {
  let store: EventsStore

  beforeEach(() => {
    store = createEventsStore()
  })

  describe('count() method', () => {
    it('should have a count() method to get total event count', async () => {
      // Create some events
      await store.emit({ type: 'test.event', payload: { i: 1 } })
      await store.emit({ type: 'test.event', payload: { i: 2 } })
      await store.emit({ type: 'test.event', payload: { i: 3 } })

      // FAILS: count() method does not exist on EventsStore
      const count = await (store as any).count()
      expect(count).toBe(3)
    })

    it('should count events by type', async () => {
      await store.emit({ type: 'user.created', payload: {} })
      await store.emit({ type: 'user.created', payload: {} })
      await store.emit({ type: 'order.placed', payload: {} })

      // FAILS: count() method does not exist
      const userCount = await (store as any).count({ type: 'user.created' })
      expect(userCount).toBe(2)
    })
  })

  describe('setRetentionPolicy()', () => {
    it('should allow setting a retention policy with maxEvents', async () => {
      // FAILS: setRetentionPolicy() method does not exist
      await (store as any).setRetentionPolicy({
        maxEvents: 100
      })

      const policy = await (store as any).getRetentionPolicy()
      expect(policy.maxEvents).toBe(100)
    })

    it('should allow setting a retention policy with maxAgeDays', async () => {
      // FAILS: setRetentionPolicy() method does not exist
      await (store as any).setRetentionPolicy({
        maxAgeDays: 7
      })

      const policy = await (store as any).getRetentionPolicy()
      expect(policy.maxAgeDays).toBe(7)
    })

    it('should allow combined maxEvents and maxAgeDays policy', async () => {
      // FAILS: setRetentionPolicy() method does not exist
      await (store as any).setRetentionPolicy({
        maxEvents: 1000,
        maxAgeDays: 30
      })

      const policy = await (store as any).getRetentionPolicy()
      expect(policy.maxEvents).toBe(1000)
      expect(policy.maxAgeDays).toBe(30)
    })

    it('should validate retention policy parameters', async () => {
      // FAILS: setRetentionPolicy() method does not exist
      await expect(
        (store as any).setRetentionPolicy({ maxEvents: -1 })
      ).rejects.toThrow('maxEvents must be positive')

      await expect(
        (store as any).setRetentionPolicy({ maxAgeDays: 0 })
      ).rejects.toThrow('maxAgeDays must be positive')
    })
  })

  // cleanup() and retention policy methods now implemented in @dotdo/db
  describe('cleanup()', () => {
    it('should enforce retention policy on old events by count', async () => {
      // Create many events
      for (let i = 0; i < 200; i++) {
        await store.emit({ type: 'test.event', payload: { i } })
      }

      // Set retention policy: keep last 100
      // FAILS: setRetentionPolicy() method does not exist
      await (store as any).setRetentionPolicy({ maxEvents: 100 })

      // Trigger cleanup
      // FAILS: cleanup() method does not exist
      const result = await (store as any).cleanup()

      // Should only have 100 events now
      // FAILS: count() method does not exist
      const count = await (store as any).count()
      expect(count).toBeLessThanOrEqual(100)

      // Cleanup should report how many events were deleted
      expect(result.deleted).toBe(100)
    })

    it('should enforce retention policy by age', async () => {
      // Emit events with mocked timestamps
      const now = Date.now()
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000
      const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000

      // We need to mock or inject timestamps for testing
      // FAILS: No way to inject custom timestamps for testing
      await (store as any).emit({
        type: 'old.event',
        payload: {},
        $timestamp: twoWeeksAgo // 2 weeks old
      })
      await (store as any).emit({
        type: 'recent.event',
        payload: {},
        $timestamp: now // current
      })

      // Set retention policy: keep last 7 days
      // FAILS: setRetentionPolicy() method does not exist
      await (store as any).setRetentionPolicy({ maxAgeDays: 7 })

      // Trigger cleanup
      // FAILS: cleanup() method does not exist
      await (store as any).cleanup()

      // Old event should be deleted
      const events = await store.query({})
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('recent.event')
    })

    it('should preserve the most recent events when cleaning up', async () => {
      const baseTime = Date.now()
      // Create events in order with explicit timestamps to ensure deterministic ordering
      for (let i = 0; i < 50; i++) {
        await (store as any).emit({
          type: 'test.event',
          payload: { order: i },
          $timestamp: baseTime + i * 1000 // 1 second apart
        })
      }

      // Set retention and cleanup
      await (store as any).setRetentionPolicy({ maxEvents: 10 })
      await (store as any).cleanup()

      // Should keep the 10 most recent (highest order numbers)
      const events = await store.query({ limit: 10 })
      expect(events.length).toBe(10)

      // Verify we kept the newest ones (order 40-49)
      const orders = events.map((e: unknown) => (e as { payload: { order: number } }).payload.order).sort((a: number, b: number) => a - b)
      expect(orders[0]).toBeGreaterThanOrEqual(40)
    })

    // Future enhancement: auto-cleanup when threshold exceeded
    // This would require integrating cleanup into the emit() path
    it.skip('should run cleanup automatically when threshold exceeded', async () => {
      // Not yet implemented: autoCleanup and cleanupThreshold options
      await (store as any).setRetentionPolicy({
        maxEvents: 100,
        autoCleanup: true,
        cleanupThreshold: 0.8 // Cleanup when 80% full
      })

      // Add events up to threshold
      for (let i = 0; i < 80; i++) {
        await store.emit({ type: 'test.event', payload: { i } })
      }

      // Count should still be 80 (not yet at threshold)
      let count = await (store as any).count()
      expect(count).toBe(80)

      // Add more events to trigger auto-cleanup
      for (let i = 0; i < 30; i++) {
        await store.emit({ type: 'test.event', payload: { i: i + 80 } })
      }

      // Auto-cleanup should have run, keeping only 100
      count = await (store as any).count()
      expect(count).toBeLessThanOrEqual(100)
    })
  })

  // Storage monitoring - basic getStorageUsage() implemented
  describe('Storage monitoring', () => {
    it('should report storage usage', async () => {
      // Add some events
      for (let i = 0; i < 100; i++) {
        await store.emit({
          type: 'test.event',
          payload: { data: 'x'.repeat(1000) } // ~1KB each
        })
      }

      // getStorageUsage() is now implemented
      const usage = await (store as any).getStorageUsage()

      expect(usage.eventCount).toBe(100)
      expect(usage.bytesUsed).toBeGreaterThan(100000) // At least 100KB
      expect(usage.bytesUsed).toBeLessThan(1000000) // Less than 1MB
    })

    // Future enhancement: storage warning callbacks
    it.skip('should warn when approaching storage limit', async () => {
      const warnings: string[] = []

      // FAILS: onStorageWarning() method does not exist
      ;(store as any).onStorageWarning((warning: string) => {
        warnings.push(warning)
      })

      // FAILS: setStorageLimit() method does not exist
      await (store as any).setStorageLimit({
        maxBytes: 1000000, // 1MB limit for testing
        warningThreshold: 0.8 // Warn at 80%
      })

      // Add events until we should get a warning
      for (let i = 0; i < 1000; i++) {
        await store.emit({
          type: 'test.event',
          payload: { data: 'x'.repeat(1000) } // ~1KB each
        })
      }

      // Should have received storage warning
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]).toContain('80%')
    })

    // Future enhancement: hard limit enforcement
    it.skip('should prevent writes when storage limit reached', async () => {
      // Not yet implemented: setStorageLimit() with hardLimit
      await (store as any).setStorageLimit({
        maxBytes: 10000, // 10KB limit for testing
        hardLimit: true
      })

      // Fill up storage
      for (let i = 0; i < 100; i++) {
        try {
          await store.emit({
            type: 'test.event',
            payload: { data: 'x'.repeat(1000) }
          })
        } catch (e) {
          // Expected to fail when limit reached
        }
      }

      // FAILS: No storage limit enforcement
      await expect(
        store.emit({ type: 'test.event', payload: { data: 'overflow' } })
      ).rejects.toThrow('Storage limit exceeded')
    })
  })

  // Skip until event archiving methods are implemented
  describe.skip('Event archiving', () => {
    it('should archive old events before deletion', async () => {
      const archivedEvents: Event[] = []

      // FAILS: setArchiveHandler() method does not exist
      await (store as any).setArchiveHandler(async (events: Event[]) => {
        archivedEvents.push(...events)
        return { archived: events.length, location: 'r2://bucket/events/archive-001.json' }
      })

      // Create events
      for (let i = 0; i < 100; i++) {
        await store.emit({ type: 'test.event', payload: { i } })
      }

      // Set retention and cleanup
      // FAILS: setRetentionPolicy() and cleanup() do not exist
      await (store as any).setRetentionPolicy({
        maxEvents: 10,
        archiveBeforeDelete: true
      })
      await (store as any).cleanup()

      // 90 events should have been archived before deletion
      expect(archivedEvents.length).toBe(90)

      // Only 10 should remain in active store
      const remaining = await store.query({})
      expect(remaining.length).toBe(10)
    })

    it('should support R2 archiving', async () => {
      // FAILS: configureR2Archive() method does not exist
      await (store as any).configureR2Archive({
        bucket: 'events-archive',
        prefix: 'tenant-123/events/',
        format: 'jsonl'
      })

      // Create and cleanup events
      for (let i = 0; i < 100; i++) {
        await store.emit({ type: 'test.event', payload: { i } })
      }

      // FAILS: archiveToR2() method does not exist
      const result = await (store as any).archiveToR2({
        olderThan: Date.now() - 1000,
        deleteAfterArchive: true
      })

      expect(result.archived).toBe(100)
      expect(result.r2Key).toMatch(/^tenant-123\/events\//)
    })

    it('should allow querying archived events', async () => {
      // FAILS: queryArchive() method does not exist
      const archivedEvents = await (store as any).queryArchive({
        type: 'user.created',
        since: Date.now() - 30 * 24 * 60 * 60 * 1000, // Last 30 days
        limit: 100
      })

      // Should be able to query archived events transparently
      expect(Array.isArray(archivedEvents)).toBe(true)
    })
  })

  // Skip until DO integration retention methods are implemented
  describe.skip('DO integration', () => {
    let doInstance: DO
    let mockState: DurableObjectState

    beforeEach(() => {
      mockState = createMockState()
      doInstance = new DO(mockState, {})
    })

    it('should expose retention policy via DO events accessor', async () => {
      // FAILS: setRetentionPolicy() not available on DO.events
      await (doInstance as any).events.setRetentionPolicy({
        maxEvents: 1000,
        maxAgeDays: 30
      })

      const policy = await (doInstance as any).events.getRetentionPolicy()
      expect(policy.maxEvents).toBe(1000)
    })

    it('should expose cleanup via DO events accessor', async () => {
      // Create events
      for (let i = 0; i < 100; i++) {
        await (doInstance as any).events.emit({ type: 'test', payload: { i } })
      }

      // FAILS: cleanup() not available on DO.events
      await (doInstance as any).events.setRetentionPolicy({ maxEvents: 10 })
      const result = await (doInstance as any).events.cleanup()

      expect(result.deleted).toBe(90)
    })

    it('should expose storage usage via DO events accessor', async () => {
      // FAILS: getStorageUsage() not available on DO.events
      const usage = await (doInstance as any).events.getStorageUsage()

      expect(typeof usage.eventCount).toBe('number')
      expect(typeof usage.bytesUsed).toBe('number')
    })

    it('should schedule periodic cleanup via alarm', async () => {
      // FAILS: scheduleCleanup() not available
      await (doInstance as any).events.scheduleCleanup({
        interval: 'daily',
        retentionPolicy: { maxEvents: 10000, maxAgeDays: 90 }
      })

      // Cleanup should be scheduled as an alarm
      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })
  })

  // Skip until performance/incremental cleanup methods are implemented
  describe.skip('Performance considerations', () => {
    it('should cleanup efficiently without blocking', async () => {
      // Create many events
      for (let i = 0; i < 1000; i++) {
        await store.emit({ type: 'test.event', payload: { i } })
      }

      // FAILS: cleanup() does not exist
      await (store as any).setRetentionPolicy({ maxEvents: 100 })

      const start = Date.now()
      await (store as any).cleanup({ batchSize: 100 })
      const duration = Date.now() - start

      // Cleanup should be fast (< 1 second for 900 events)
      expect(duration).toBeLessThan(1000)
    })

    it('should support incremental cleanup', async () => {
      // Create many events
      for (let i = 0; i < 500; i++) {
        await store.emit({ type: 'test.event', payload: { i } })
      }

      // FAILS: incrementalCleanup() does not exist
      await (store as any).setRetentionPolicy({ maxEvents: 100 })

      // Cleanup in batches
      let totalDeleted = 0
      let result
      do {
        result = await (store as any).incrementalCleanup({ maxDelete: 50 })
        totalDeleted += result.deleted
      } while (result.hasMore)

      expect(totalDeleted).toBe(400) // 500 - 100 retained
    })
  })
})

describe('10GB Storage Limit Awareness', () => {
  it('should document the 10GB DO storage limit', () => {
    /**
     * Durable Objects have a 10GB storage limit per DO.
     * With events averaging ~500 bytes each, this allows for ~20 million events.
     * However, without cleanup:
     * - High-volume DOs can hit this in days/weeks
     * - Once hit, all writes fail with "storage limit exceeded"
     * - Recovery requires manual intervention
     *
     * This test documents the need for proactive retention policies.
     */
    const avgEventSize = 500 // bytes
    const storageLimit = 10 * 1024 * 1024 * 1024 // 10GB
    const maxEvents = Math.floor(storageLimit / avgEventSize)

    expect(maxEvents).toBeLessThan(25_000_000) // ~20M events max

    // At 100 events/second, limit reached in:
    const eventsPerSecond = 100
    const secondsToLimit = maxEvents / eventsPerSecond
    const daysToLimit = secondsToLimit / 60 / 60 / 24

    expect(daysToLimit).toBeLessThan(3) // Under 3 days at high volume!
  })
})
