/**
 * Shard Router Persistence Tests
 *
 * Wave 5: Performance & Scalability - Task 3 (do-gr56, do-uwkx)
 *
 * Tests for ShardRouterStorage interface and hot tenant persistence.
 *
 * @module streaming/tests/shard-router-persistence.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TraceAwareShardRouter,
  type ShardRouterStorage,
  type ShardConfig,
} from '../shard-router'

/**
 * In-memory mock implementation of ShardRouterStorage for testing.
 */
class MockShardRouterStorage implements ShardRouterStorage {
  private counts: Map<string, number> = new Map()
  public getEventCountsCalled = 0
  public setEventCountCalls: Array<{ ns: string; count: number }> = []

  async getEventCounts(): Promise<Map<string, number>> {
    this.getEventCountsCalled++
    return new Map(this.counts)
  }

  async setEventCount(ns: string, count: number): Promise<void> {
    this.setEventCountCalls.push({ ns, count })
    this.counts.set(ns, count)
  }

  // Test helper to pre-populate counts
  setInitialCount(ns: string, count: number): void {
    this.counts.set(ns, count)
  }

  reset(): void {
    this.counts.clear()
    this.getEventCountsCalled = 0
    this.setEventCountCalls = []
  }
}

describe('ShardRouterStorage interface', () => {
  it('defines getEventCounts method', () => {
    const storage: ShardRouterStorage = {
      getEventCounts: async () => new Map(),
      setEventCount: async () => {},
    }
    expect(storage.getEventCounts).toBeDefined()
  })

  it('defines setEventCount method', () => {
    const storage: ShardRouterStorage = {
      getEventCounts: async () => new Map(),
      setEventCount: async () => {},
    }
    expect(storage.setEventCount).toBeDefined()
  })
})

describe('TraceAwareShardRouter with storage', () => {
  let storage: MockShardRouterStorage
  let router: TraceAwareShardRouter

  beforeEach(() => {
    storage = new MockShardRouterStorage()
  })

  describe('constructor', () => {
    it('accepts optional storage parameter', () => {
      router = new TraceAwareShardRouter({}, storage)
      expect(router).toBeDefined()
    })

    it('works without storage (backwards compatible)', () => {
      router = new TraceAwareShardRouter({ shardCount: 8 })
      expect(router).toBeDefined()
    })
  })

  describe('initialize', () => {
    it('loads persisted event counts from storage', async () => {
      storage.setInitialCount('tenant-a', 50000)
      storage.setInitialCount('tenant-b', 150000)

      router = new TraceAwareShardRouter({ highVolumeThreshold: 100000 }, storage)
      await router.initialize()

      expect(storage.getEventCountsCalled).toBe(1)
      expect(router.getEventCount('tenant-a')).toBe(50000)
      expect(router.getEventCount('tenant-b')).toBe(150000)
    })

    it('marks tenants as high-volume based on persisted counts', async () => {
      storage.setInitialCount('enterprise', 150000)

      router = new TraceAwareShardRouter({ highVolumeThreshold: 100000 }, storage)
      await router.initialize()

      expect(router.isHighVolume('enterprise')).toBe(true)
      expect(router.getShardId('enterprise', 'trace1')).toMatch(/^enterprise-shard-\d+$/)
    })

    it('is idempotent - only loads once', async () => {
      storage.setInitialCount('tenant', 1000)

      router = new TraceAwareShardRouter({}, storage)

      // Call initialize multiple times
      await router.initialize()
      await router.initialize()
      await router.initialize()

      // Should only call storage once
      expect(storage.getEventCountsCalled).toBe(1)
    })

    it('handles concurrent initialize calls', async () => {
      storage.setInitialCount('tenant', 1000)

      router = new TraceAwareShardRouter({}, storage)

      // Call initialize concurrently
      await Promise.all([
        router.initialize(),
        router.initialize(),
        router.initialize(),
      ])

      // Should only call storage once
      expect(storage.getEventCountsCalled).toBe(1)
    })

    it('handles storage failure gracefully', async () => {
      const failingStorage: ShardRouterStorage = {
        getEventCounts: async () => {
          throw new Error('Storage unavailable')
        },
        setEventCount: async () => {},
      }

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      router = new TraceAwareShardRouter({}, failingStorage)
      await router.initialize()

      // Should not throw, just log warning
      expect(consoleWarnSpy).toHaveBeenCalled()

      // Router should still work (start fresh)
      expect(router.getEventCount('any')).toBe(0)

      consoleWarnSpy.mockRestore()
    })

    it('does nothing without storage', async () => {
      router = new TraceAwareShardRouter({})
      await router.initialize()

      // Should work fine
      expect(router.getEventCount('any')).toBe(0)
    })
  })

  describe('recordEvent with persistence', () => {
    it('persists when crossing threshold', async () => {
      router = new TraceAwareShardRouter({ highVolumeThreshold: 100 }, storage)
      await router.initialize()

      // Record events up to threshold - 1
      for (let i = 0; i < 99; i++) {
        router.recordEvent('growing-tenant')
      }

      // No persistence yet
      expect(storage.setEventCountCalls).toHaveLength(0)

      // Record the threshold-crossing event
      router.recordEvent('growing-tenant')

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should have persisted
      expect(storage.setEventCountCalls).toHaveLength(1)
      expect(storage.setEventCountCalls[0]).toEqual({
        ns: 'growing-tenant',
        count: 100,
      })
    })

    it('only persists once when crossing threshold', async () => {
      router = new TraceAwareShardRouter({ highVolumeThreshold: 100 }, storage)
      await router.initialize()

      // Record 150 events
      for (let i = 0; i < 150; i++) {
        router.recordEvent('tenant')
      }

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should only persist once (when crossing threshold)
      expect(storage.setEventCountCalls).toHaveLength(1)
      expect(storage.setEventCountCalls[0].count).toBe(100)
    })

    it('handles persistence failure gracefully', async () => {
      const failingStorage: ShardRouterStorage = {
        getEventCounts: async () => new Map(),
        setEventCount: async () => {
          throw new Error('Persistence failed')
        },
      }

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      router = new TraceAwareShardRouter({ highVolumeThreshold: 10 }, failingStorage)
      await router.initialize()

      // Record events to cross threshold
      for (let i = 0; i < 15; i++) {
        router.recordEvent('tenant')
      }

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should not throw, just log warning
      expect(consoleWarnSpy).toHaveBeenCalled()

      // Router should still work
      expect(router.isHighVolume('tenant')).toBe(true)

      consoleWarnSpy.mockRestore()
    })

    it('does not persist without storage', () => {
      router = new TraceAwareShardRouter({ highVolumeThreshold: 10 })

      // Record events to cross threshold
      for (let i = 0; i < 15; i++) {
        router.recordEvent('tenant')
      }

      // Should work fine without storage
      expect(router.isHighVolume('tenant')).toBe(true)
    })
  })

  describe('persistEventCounts', () => {
    it('persists all event counts', async () => {
      router = new TraceAwareShardRouter({}, storage)
      await router.initialize()

      router.recordEvent('tenant-a')
      router.recordEvent('tenant-a')
      router.recordEvent('tenant-b')

      storage.setEventCountCalls = [] // Reset

      await router.persistEventCounts()

      expect(storage.setEventCountCalls).toHaveLength(2)
      expect(storage.setEventCountCalls).toContainEqual({ ns: 'tenant-a', count: 2 })
      expect(storage.setEventCountCalls).toContainEqual({ ns: 'tenant-b', count: 1 })
    })

    it('persists specific namespaces', async () => {
      router = new TraceAwareShardRouter({}, storage)
      await router.initialize()

      router.recordEvent('tenant-a')
      router.recordEvent('tenant-b')
      router.recordEvent('tenant-c')

      storage.setEventCountCalls = [] // Reset

      await router.persistEventCounts(['tenant-a', 'tenant-c'])

      expect(storage.setEventCountCalls).toHaveLength(2)
      expect(storage.setEventCountCalls).toContainEqual({ ns: 'tenant-a', count: 1 })
      expect(storage.setEventCountCalls).toContainEqual({ ns: 'tenant-c', count: 1 })
    })

    it('does nothing without storage', async () => {
      router = new TraceAwareShardRouter({})
      router.recordEvent('tenant')

      // Should not throw
      await router.persistEventCounts()
    })

    it('skips namespaces with zero count', async () => {
      router = new TraceAwareShardRouter({}, storage)
      await router.initialize()

      router.recordEvent('tenant')

      storage.setEventCountCalls = [] // Reset

      // Try to persist including a namespace that doesn't exist
      await router.persistEventCounts(['tenant', 'nonexistent'])

      // Should only persist the one with count
      expect(storage.setEventCountCalls).toHaveLength(1)
      expect(storage.setEventCountCalls[0].ns).toBe('tenant')
    })
  })

  describe('getTrackedNamespaces', () => {
    it('returns all namespaces with events', async () => {
      router = new TraceAwareShardRouter({}, storage)
      await router.initialize()

      router.recordEvent('tenant-a')
      router.recordEvent('tenant-b')
      router.recordEvent('tenant-c')

      const namespaces = router.getTrackedNamespaces()

      expect(namespaces).toHaveLength(3)
      expect(namespaces).toContain('tenant-a')
      expect(namespaces).toContain('tenant-b')
      expect(namespaces).toContain('tenant-c')
    })

    it('returns empty array when no events recorded', async () => {
      router = new TraceAwareShardRouter({}, storage)
      await router.initialize()

      const namespaces = router.getTrackedNamespaces()
      expect(namespaces).toHaveLength(0)
    })
  })

  describe('clearEventCounts', () => {
    it('clears specific namespace', async () => {
      router = new TraceAwareShardRouter({}, storage)
      await router.initialize()

      router.recordEvent('tenant-a')
      router.recordEvent('tenant-b')

      router.clearEventCounts('tenant-a')

      expect(router.getEventCount('tenant-a')).toBe(0)
      expect(router.getEventCount('tenant-b')).toBe(1)
    })

    it('clears all namespaces', async () => {
      router = new TraceAwareShardRouter({}, storage)
      await router.initialize()

      router.recordEvent('tenant-a')
      router.recordEvent('tenant-b')

      router.clearEventCounts()

      expect(router.getEventCount('tenant-a')).toBe(0)
      expect(router.getEventCount('tenant-b')).toBe(0)
      expect(router.getTrackedNamespaces()).toHaveLength(0)
    })
  })
})

describe('Integration: Hot tenant detection with persistence', () => {
  it('survives simulated restart', async () => {
    const storage = new MockShardRouterStorage()

    // First "session" - accumulate events
    const router1 = new TraceAwareShardRouter({ highVolumeThreshold: 100 }, storage)
    await router1.initialize()

    for (let i = 0; i < 150; i++) {
      router1.recordEvent('enterprise-tenant')
    }

    // Wait for persistence
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Verify persisted
    expect(storage.setEventCountCalls.some((c) => c.ns === 'enterprise-tenant')).toBe(true)

    // Simulate restart - create new router with same storage
    const router2 = new TraceAwareShardRouter({ highVolumeThreshold: 100 }, storage)
    await router2.initialize()

    // Should still be high-volume after "restart"
    expect(router2.isHighVolume('enterprise-tenant')).toBe(true)
    expect(router2.getShardId('enterprise-tenant', 'trace1')).toMatch(/^enterprise-tenant-shard-\d+$/)
  })
})
