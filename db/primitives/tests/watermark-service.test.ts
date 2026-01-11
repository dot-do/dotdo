/**
 * WatermarkService tests
 *
 * RED phase: These tests define the expected behavior of WatermarkService.
 * All tests should FAIL until implementation is complete.
 *
 * WatermarkService provides event-time progress tracking:
 * - Single source watermark advancement
 * - Multi-source aggregation (min across sources)
 * - Idle source handling
 * - Bounded out-of-orderness
 * - Watermark callbacks
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  WatermarkService,
  createWatermarkService,
  type Duration,
  type Unsubscribe,
} from '../watermark-service'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate timestamp for testing (ms since epoch)
 */
function ts(offsetMs: number = 0): number {
  return 1000000000000 + offsetMs
}

// ============================================================================
// SINGLE SOURCE WATERMARK ADVANCEMENT
// ============================================================================

describe('WatermarkService', () => {
  describe('single source watermark advancement', () => {
    it('should start with watermark at negative infinity', () => {
      const service = createWatermarkService()
      expect(service.current()).toBe(Number.NEGATIVE_INFINITY)
    })

    it('should advance watermark on event', () => {
      const service = createWatermarkService()
      service.advance(ts(1000))
      expect(service.current()).toBe(ts(1000))
    })

    it('should advance watermark to later event', () => {
      const service = createWatermarkService()
      service.advance(ts(1000))
      service.advance(ts(2000))
      expect(service.current()).toBe(ts(2000))
    })

    it('should not advance watermark on earlier event', () => {
      const service = createWatermarkService()
      service.advance(ts(2000))
      service.advance(ts(1000)) // Earlier event
      expect(service.current()).toBe(ts(2000)) // Should stay at 2000
    })

    it('should handle same timestamp multiple times', () => {
      const service = createWatermarkService()
      service.advance(ts(1000))
      service.advance(ts(1000))
      service.advance(ts(1000))
      expect(service.current()).toBe(ts(1000))
    })
  })

  // ============================================================================
  // OUT-OF-ORDER EVENTS
  // ============================================================================

  describe('out-of-order events', () => {
    it('should not regress watermark on out-of-order event', () => {
      const service = createWatermarkService()
      service.advance(ts(5000))
      service.advance(ts(3000)) // Out of order
      service.advance(ts(4000)) // Still out of order
      expect(service.current()).toBe(ts(5000))
    })

    it('should process events in any order but maintain monotonic watermark', () => {
      const service = createWatermarkService()
      const events = [ts(3000), ts(1000), ts(5000), ts(2000), ts(4000)]
      for (const e of events) {
        service.advance(e)
      }
      expect(service.current()).toBe(ts(5000))
    })

    it('should correctly identify max timestamp from mixed events', () => {
      const service = createWatermarkService()
      service.advance(ts(100))
      service.advance(ts(500))
      service.advance(ts(300))
      service.advance(ts(700))
      service.advance(ts(200))
      expect(service.current()).toBe(ts(700))
    })
  })

  // ============================================================================
  // MULTI-SOURCE WATERMARK AGGREGATION
  // ============================================================================

  describe('multi-source watermark aggregation', () => {
    it('should register sources', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.register('source-2')
      expect(service.getSources()).toContain('source-1')
      expect(service.getSources()).toContain('source-2')
    })

    it('should aggregate watermarks as minimum across sources', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.register('source-2')
      service.updateSource('source-1', ts(5000))
      service.updateSource('source-2', ts(3000))
      expect(service.aggregated()).toBe(ts(3000)) // Min of 5000 and 3000
    })

    it('should update aggregated as sources advance', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.register('source-2')
      service.updateSource('source-1', ts(3000))
      service.updateSource('source-2', ts(5000))
      expect(service.aggregated()).toBe(ts(3000))

      service.updateSource('source-1', ts(6000))
      expect(service.aggregated()).toBe(ts(5000)) // Now source-2 is min
    })

    it('should handle three sources correctly', () => {
      const service = createWatermarkService()
      service.register('a')
      service.register('b')
      service.register('c')
      service.updateSource('a', ts(100))
      service.updateSource('b', ts(200))
      service.updateSource('c', ts(150))
      expect(service.aggregated()).toBe(ts(100))
    })

    it('should return negative infinity when no sources have watermarks', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.register('source-2')
      expect(service.aggregated()).toBe(Number.NEGATIVE_INFINITY)
    })

    it('should allow unregistering sources', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.register('source-2')
      service.updateSource('source-1', ts(3000))
      service.updateSource('source-2', ts(5000))
      service.unregister('source-1')
      expect(service.aggregated()).toBe(ts(5000))
      expect(service.getSources()).not.toContain('source-1')
    })
  })

  // ============================================================================
  // IDLE SOURCE HANDLING
  // ============================================================================

  describe('idle source handling', () => {
    it('should mark source as idle', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.markIdle('source-1')
      expect(service.isIdle('source-1')).toBe(true)
    })

    it('should exclude idle sources from aggregation', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.register('source-2')
      service.updateSource('source-1', ts(1000))
      service.updateSource('source-2', ts(5000))
      expect(service.aggregated()).toBe(ts(1000))

      service.markIdle('source-1')
      expect(service.aggregated()).toBe(ts(5000)) // source-1 excluded
    })

    it('should mark source as active', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.markIdle('source-1')
      expect(service.isIdle('source-1')).toBe(true)
      service.markActive('source-1')
      expect(service.isIdle('source-1')).toBe(false)
    })

    it('should include source again when marked active', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.register('source-2')
      service.updateSource('source-1', ts(1000))
      service.updateSource('source-2', ts(5000))
      service.markIdle('source-1')
      expect(service.aggregated()).toBe(ts(5000))

      service.markActive('source-1')
      expect(service.aggregated()).toBe(ts(1000))
    })

    it('should handle all sources being idle', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.register('source-2')
      service.updateSource('source-1', ts(1000))
      service.updateSource('source-2', ts(2000))
      service.markIdle('source-1')
      service.markIdle('source-2')
      // When all sources are idle, watermark should be max of all source watermarks
      expect(service.aggregated()).toBe(ts(2000))
    })

    it('should return false for isIdle on unregistered source', () => {
      const service = createWatermarkService()
      expect(service.isIdle('nonexistent')).toBe(false)
    })

    it('should handle marking unregistered source as idle gracefully', () => {
      const service = createWatermarkService()
      // Should not throw
      expect(() => service.markIdle('nonexistent')).not.toThrow()
    })
  })

  // ============================================================================
  // BOUNDED OUT-OF-ORDERNESS
  // ============================================================================

  describe('bounded out-of-orderness', () => {
    it('should configure max lateness', () => {
      const service = createWatermarkService()
      const result = service.withBoundedOutOfOrderness(5000)
      expect(result).toBe(service) // Should return this for chaining
    })

    it('should offset watermark by max lateness', () => {
      const service = createWatermarkService()
      service.withBoundedOutOfOrderness(5000)
      service.advance(ts(10000))
      // Watermark should be event time minus max lateness
      expect(service.current()).toBe(ts(10000) - 5000)
    })

    it('should handle zero lateness', () => {
      const service = createWatermarkService()
      service.withBoundedOutOfOrderness(0)
      service.advance(ts(10000))
      expect(service.current()).toBe(ts(10000))
    })

    it('should apply lateness to aggregated watermark', () => {
      const service = createWatermarkService()
      service.withBoundedOutOfOrderness(3000)
      service.register('source-1')
      service.register('source-2')
      service.updateSource('source-1', ts(10000))
      service.updateSource('source-2', ts(8000))
      // Min is 8000, minus 3000 lateness = 5000
      expect(service.aggregated()).toBe(ts(8000) - 3000)
    })

    it('should allow changing max lateness', () => {
      const service = createWatermarkService()
      service.withBoundedOutOfOrderness(5000)
      service.advance(ts(10000))
      expect(service.current()).toBe(ts(10000) - 5000)

      service.withBoundedOutOfOrderness(2000)
      service.advance(ts(12000))
      expect(service.current()).toBe(ts(12000) - 2000)
    })

    it('should never produce negative watermark from lateness', () => {
      const service = createWatermarkService()
      service.withBoundedOutOfOrderness(100000)
      service.advance(ts(1000))
      // With 100s lateness and 1s event time, should be clamped
      const wm = service.current()
      expect(wm).toBeLessThanOrEqual(ts(1000) - 100000)
    })

    it('should support chaining with other methods', () => {
      const service = createWatermarkService()
      const callback = vi.fn()
      service.withBoundedOutOfOrderness(5000).onAdvance(callback)
      service.advance(ts(10000))
      expect(callback).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // WATERMARK CALLBACKS
  // ============================================================================

  describe('watermark callbacks', () => {
    it('should call callback on watermark advance', () => {
      const service = createWatermarkService()
      const callback = vi.fn()
      service.onAdvance(callback)
      service.advance(ts(1000))
      expect(callback).toHaveBeenCalledWith(ts(1000))
    })

    it('should not call callback when watermark does not advance', () => {
      const service = createWatermarkService()
      const callback = vi.fn()
      service.advance(ts(2000))
      service.onAdvance(callback)
      service.advance(ts(1000)) // Earlier, no advance
      expect(callback).not.toHaveBeenCalled()
    })

    it('should support multiple callbacks', () => {
      const service = createWatermarkService()
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      service.onAdvance(callback1)
      service.onAdvance(callback2)
      service.advance(ts(1000))
      expect(callback1).toHaveBeenCalledWith(ts(1000))
      expect(callback2).toHaveBeenCalledWith(ts(1000))
    })

    it('should return unsubscribe function', () => {
      const service = createWatermarkService()
      const callback = vi.fn()
      const unsubscribe = service.onAdvance(callback)
      expect(typeof unsubscribe).toBe('function')
    })

    it('should stop calling callback after unsubscribe', () => {
      const service = createWatermarkService()
      const callback = vi.fn()
      const unsubscribe = service.onAdvance(callback)
      service.advance(ts(1000))
      expect(callback).toHaveBeenCalledTimes(1)

      unsubscribe()
      service.advance(ts(2000))
      expect(callback).toHaveBeenCalledTimes(1) // Still 1, not 2
    })

    it('should call callback with correct watermark when bounded', () => {
      const service = createWatermarkService()
      const callback = vi.fn()
      service.withBoundedOutOfOrderness(5000)
      service.onAdvance(callback)
      service.advance(ts(10000))
      expect(callback).toHaveBeenCalledWith(ts(10000) - 5000)
    })

    it('should call callbacks for each advancement', () => {
      const service = createWatermarkService()
      const callback = vi.fn()
      service.onAdvance(callback)
      service.advance(ts(1000))
      service.advance(ts(2000))
      service.advance(ts(3000))
      expect(callback).toHaveBeenCalledTimes(3)
    })

    it('should handle callback that throws without affecting others', () => {
      const service = createWatermarkService()
      const badCallback = vi.fn(() => {
        throw new Error('Bad callback')
      })
      const goodCallback = vi.fn()
      service.onAdvance(badCallback)
      service.onAdvance(goodCallback)
      // Should not throw, should still call goodCallback
      expect(() => service.advance(ts(1000))).not.toThrow()
      expect(goodCallback).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle timestamp 0', () => {
      const service = createWatermarkService()
      service.advance(0)
      expect(service.current()).toBe(0)
    })

    it('should handle negative timestamps', () => {
      const service = createWatermarkService()
      service.advance(-1000)
      expect(service.current()).toBe(-1000)
    })

    it('should handle very large timestamps', () => {
      const service = createWatermarkService()
      const largeTs = Number.MAX_SAFE_INTEGER - 1000
      service.advance(largeTs)
      expect(service.current()).toBe(largeTs)
    })

    it('should handle no sources registered', () => {
      const service = createWatermarkService()
      expect(service.aggregated()).toBe(Number.NEGATIVE_INFINITY)
    })

    it('should handle registering same source twice', () => {
      const service = createWatermarkService()
      service.register('source-1')
      service.register('source-1') // Duplicate
      expect(service.getSources().filter((s) => s === 'source-1')).toHaveLength(1)
    })

    it('should handle empty source ID', () => {
      const service = createWatermarkService()
      service.register('')
      service.updateSource('', ts(1000))
      expect(service.getSourceWatermark('')).toBe(ts(1000))
    })

    it('should handle special characters in source ID', () => {
      const service = createWatermarkService()
      const specialId = 'source/with:special@chars'
      service.register(specialId)
      service.updateSource(specialId, ts(1000))
      expect(service.getSourceWatermark(specialId)).toBe(ts(1000))
    })

    it('should return undefined for non-existent source watermark', () => {
      const service = createWatermarkService()
      expect(service.getSourceWatermark('nonexistent')).toBeUndefined()
    })

    it('should handle updating unregistered source', () => {
      const service = createWatermarkService()
      // Should auto-register or throw
      expect(() => service.updateSource('new-source', ts(1000))).not.toThrow()
    })

    it('should handle boundary timestamp values', () => {
      const service = createWatermarkService()
      service.advance(Number.NEGATIVE_INFINITY + 1)
      expect(service.current()).toBeGreaterThan(Number.NEGATIVE_INFINITY)
    })
  })

  // ============================================================================
  // HIGH-FREQUENCY UPDATES / PERFORMANCE
  // ============================================================================

  describe('high-frequency updates', () => {
    it('should handle 100K events efficiently', () => {
      const service = createWatermarkService()
      const start = performance.now()
      for (let i = 0; i < 100_000; i++) {
        service.advance(ts(i))
      }
      const duration = performance.now() - start
      expect(service.current()).toBe(ts(99_999))
      // Should complete in under 1 second
      expect(duration).toBeLessThan(1000)
    })

    it('should handle many sources efficiently', () => {
      const service = createWatermarkService()
      const numSources = 100
      for (let i = 0; i < numSources; i++) {
        service.register(`source-${i}`)
      }
      const start = performance.now()
      for (let round = 0; round < 1000; round++) {
        for (let i = 0; i < numSources; i++) {
          service.updateSource(`source-${i}`, ts(round * 1000 + i))
        }
      }
      const duration = performance.now() - start
      // Should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)
    })

    it('should handle many subscribers efficiently', () => {
      const service = createWatermarkService()
      const callbacks: vi.Mock[] = []
      for (let i = 0; i < 100; i++) {
        const cb = vi.fn()
        callbacks.push(cb)
        service.onAdvance(cb)
      }
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        service.advance(ts(i))
      }
      const duration = performance.now() - start
      // Should complete in under 1 second
      expect(duration).toBeLessThan(1000)
      // Each callback should have been called 1000 times
      expect(callbacks[0]).toHaveBeenCalledTimes(1000)
    })

    it('should handle rapid subscribe/unsubscribe', () => {
      const service = createWatermarkService()
      for (let i = 0; i < 1000; i++) {
        const cb = vi.fn()
        const unsub = service.onAdvance(cb)
        service.advance(ts(i))
        unsub()
      }
      expect(service.current()).toBe(ts(999))
    })

    it('should maintain consistent watermark under concurrent-like load', () => {
      const service = createWatermarkService()
      const events = Array.from({ length: 10000 }, (_, i) => ts(Math.random() * 100000))
      for (const e of events) {
        service.advance(e)
      }
      expect(service.current()).toBe(Math.max(...events))
    })
  })

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('factory function', () => {
    it('should create a WatermarkService instance', () => {
      const service = createWatermarkService()
      expect(service).toBeInstanceOf(WatermarkService)
    })

    it('should create independent instances', () => {
      const service1 = createWatermarkService()
      const service2 = createWatermarkService()
      service1.advance(ts(1000))
      expect(service1.current()).toBe(ts(1000))
      expect(service2.current()).toBe(Number.NEGATIVE_INFINITY)
    })
  })
})
