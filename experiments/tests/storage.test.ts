/**
 * Tests for DO storage backend and results store
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createDOBackend, createResultsStore, type TrackingEvent } from '../storage'
import type { ExperimentStorage } from '../types'

// Mock storage for testing - same pattern as other test files
function createMockStorage(): ExperimentStorage {
  const store = new Map<string, unknown>()

  const storage = {
    get: async <T>(keyOrKeys: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (typeof keyOrKeys === 'string') {
        return store.get(keyOrKeys) as T | undefined
      }
      const result = new Map<string, T>()
      for (const key of keyOrKeys) {
        const value = store.get(key)
        if (value !== undefined) {
          result.set(key, value as T)
        }
      }
      return result
    },

    put: async <T>(keyOrEntries: string | Map<string, T>, value?: T): Promise<void> => {
      if (typeof keyOrEntries === 'string') {
        store.set(keyOrEntries, value)
      } else {
        for (const [k, v] of keyOrEntries) {
          store.set(k, v)
        }
      }
    },

    delete: async (keyOrKeys: string | string[]): Promise<boolean | number> => {
      if (typeof keyOrKeys === 'string') {
        return store.delete(keyOrKeys)
      }
      let count = 0
      for (const key of keyOrKeys) {
        if (store.delete(key)) count++
      }
      return count
    },

    list: async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      const prefix = options?.prefix ?? ''
      for (const [key, value] of store) {
        if (key.startsWith(prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    },
  }

  return storage as unknown as ExperimentStorage
}

describe('createDOBackend', () => {
  let storage: ExperimentStorage
  let backend: ReturnType<typeof createDOBackend>

  beforeEach(() => {
    storage = createMockStorage()
    backend = createDOBackend(storage)
  })

  describe('tracking events', () => {
    it('should track a variant.start event', async () => {
      const event: TrackingEvent = {
        type: 'variant.start',
        timestamp: new Date(),
        data: {
          experimentId: 'signup-test',
          variantId: 'treatment',
          userId: 'user-123',
        },
      }

      backend.track(event)
      await backend.flush()

      const events = await backend.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0].experimentId).toBe('signup-test')
      expect(events[0].variantId).toBe('treatment')
      expect(events[0].userId).toBe('user-123')
      expect(events[0].type).toBe('exposure')
    })

    it('should track a variant.complete event', async () => {
      const event: TrackingEvent = {
        type: 'variant.complete',
        timestamp: new Date(),
        data: {
          experimentId: 'checkout-test',
          variantId: 'control',
          userId: 'user-456',
        },
      }

      backend.track(event)
      await backend.flush()

      const events = await backend.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('exposure')
    })

    it('should track a metric.computed event', async () => {
      const event: TrackingEvent = {
        type: 'metric.computed',
        timestamp: new Date(),
        data: {
          experimentId: 'revenue-test',
          variantId: 'treatment',
          userId: 'user-789',
          metricName: 'revenue',
          metricValue: 99.99,
        },
      }

      backend.track(event)
      await backend.flush()

      const events = await backend.getEvents()
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('metric')
      expect(events[0].metricName).toBe('revenue')
      expect(events[0].value).toBe(99.99)
    })

    it('should track multiple events', async () => {
      const events: TrackingEvent[] = [
        {
          type: 'variant.start',
          timestamp: new Date(),
          data: { experimentId: 'test', variantId: 'a', userId: 'user-1' },
        },
        {
          type: 'variant.start',
          timestamp: new Date(),
          data: { experimentId: 'test', variantId: 'b', userId: 'user-2' },
        },
        {
          type: 'variant.start',
          timestamp: new Date(),
          data: { experimentId: 'test', variantId: 'a', userId: 'user-3' },
        },
      ]

      for (const event of events) {
        backend.track(event)
      }
      await backend.flush()

      const stored = await backend.getEvents()
      expect(stored).toHaveLength(3)
    })

    it('should preserve event properties', async () => {
      const event: TrackingEvent = {
        type: 'variant.start',
        timestamp: new Date(),
        data: {
          experimentId: 'test',
          variantId: 'treatment',
          userId: 'user-123',
          customProp: 'custom-value',
          nested: { foo: 'bar' },
        },
      }

      backend.track(event)
      await backend.flush()

      const events = await backend.getEvents()
      expect(events[0].properties).toBeDefined()
      expect(events[0].properties!['customProp']).toBe('custom-value')
      expect(events[0].properties!['nested']).toEqual({ foo: 'bar' })
    })
  })

  describe('filtering events', () => {
    beforeEach(async () => {
      const events: TrackingEvent[] = [
        {
          type: 'variant.start',
          timestamp: new Date(),
          data: { experimentId: 'exp-a', variantId: 'control', userId: 'user-1' },
        },
        {
          type: 'variant.start',
          timestamp: new Date(),
          data: { experimentId: 'exp-a', variantId: 'treatment', userId: 'user-2' },
        },
        {
          type: 'variant.start',
          timestamp: new Date(),
          data: { experimentId: 'exp-b', variantId: 'control', userId: 'user-3' },
        },
      ]

      for (const event of events) {
        backend.track(event)
      }
      await backend.flush()
    })

    it('should filter events by experimentId', async () => {
      const eventsA = await backend.getEvents('exp-a')
      expect(eventsA).toHaveLength(2)
      expect(eventsA.every((e) => e.experimentId === 'exp-a')).toBe(true)

      const eventsB = await backend.getEvents('exp-b')
      expect(eventsB).toHaveLength(1)
      expect(eventsB[0].experimentId).toBe('exp-b')
    })

    it('should return empty array for non-existent experiment', async () => {
      const events = await backend.getEvents('non-existent')
      expect(events).toHaveLength(0)
    })

    it('should return all events when no experimentId provided', async () => {
      const events = await backend.getEvents()
      expect(events).toHaveLength(3)
    })
  })

  describe('event ordering', () => {
    it('should return events sorted by timestamp (newest first)', async () => {
      const now = Date.now()

      backend.track({
        type: 'variant.start',
        timestamp: new Date(now - 1000), // 1 second ago
        data: { experimentId: 'test', variantId: 'a', userId: 'user-1' },
      })
      backend.track({
        type: 'variant.start',
        timestamp: new Date(now), // now
        data: { experimentId: 'test', variantId: 'b', userId: 'user-2' },
      })
      backend.track({
        type: 'variant.start',
        timestamp: new Date(now - 2000), // 2 seconds ago
        data: { experimentId: 'test', variantId: 'c', userId: 'user-3' },
      })

      await backend.flush()

      const events = await backend.getEvents()

      // Events should be sorted newest first
      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i + 1].timestamp)
      }
    })
  })

  describe('clearing events', () => {
    it('should clear all events', async () => {
      backend.track({
        type: 'variant.start',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'a', userId: 'user-1' },
      })
      backend.track({
        type: 'variant.start',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'b', userId: 'user-2' },
      })
      await backend.flush()

      await backend.clear()

      const events = await backend.getEvents()
      expect(events).toHaveLength(0)
    })
  })

  describe('batching behavior', () => {
    it('should batch events until flush', async () => {
      backend.track({
        type: 'variant.start',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'a', userId: 'user-1' },
      })

      // Before flush, storage should not have events
      const beforeFlush = await backend.getEvents()
      expect(beforeFlush).toHaveLength(0)

      // After flush, events should be persisted
      await backend.flush()
      const afterFlush = await backend.getEvents()
      expect(afterFlush).toHaveLength(1)
    })

    it('should handle multiple flushes', async () => {
      backend.track({
        type: 'variant.start',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'a', userId: 'user-1' },
      })
      await backend.flush()

      backend.track({
        type: 'variant.start',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'b', userId: 'user-2' },
      })
      await backend.flush()

      const events = await backend.getEvents()
      expect(events).toHaveLength(2)
    })

    it('should do nothing on flush when no pending events', async () => {
      await backend.flush()
      const events = await backend.getEvents()
      expect(events).toHaveLength(0)
    })
  })

  describe('custom options', () => {
    it('should use custom prefix', async () => {
      const customBackend = createDOBackend(storage, { prefix: 'custom:events:' })

      customBackend.track({
        type: 'variant.start',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'a', userId: 'user-1' },
      })
      await customBackend.flush()

      // Default backend should not see these events
      const defaultEvents = await backend.getEvents()
      expect(defaultEvents).toHaveLength(0)

      // Custom backend should see them
      const customEvents = await customBackend.getEvents()
      expect(customEvents).toHaveLength(1)
    })
  })

  describe('event type mapping', () => {
    it('should map variant.start to exposure', async () => {
      backend.track({
        type: 'variant.start',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'a', userId: 'user-1' },
      })
      await backend.flush()

      const events = await backend.getEvents()
      expect(events[0].type).toBe('exposure')
    })

    it('should map variant.complete to exposure', async () => {
      backend.track({
        type: 'variant.complete',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'a', userId: 'user-1' },
      })
      await backend.flush()

      const events = await backend.getEvents()
      expect(events[0].type).toBe('exposure')
    })

    it('should map metric.computed to metric', async () => {
      backend.track({
        type: 'metric.computed',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'a', userId: 'user-1', metricName: 'clicks', metricValue: 5 },
      })
      await backend.flush()

      const events = await backend.getEvents()
      expect(events[0].type).toBe('metric')
    })

    it('should default to exposure for unknown types', async () => {
      backend.track({
        type: 'unknown.event',
        timestamp: new Date(),
        data: { experimentId: 'test', variantId: 'a', userId: 'user-1' },
      })
      await backend.flush()

      const events = await backend.getEvents()
      expect(events[0].type).toBe('exposure')
    })
  })
})

describe('createResultsStore', () => {
  let storage: ExperimentStorage
  let store: ReturnType<typeof createResultsStore>

  beforeEach(() => {
    storage = createMockStorage()
    store = createResultsStore(storage)
  })

  describe('recording exposures', () => {
    it('should record an exposure', async () => {
      await store.recordExposure('test-exp', 'control')

      const stats = await store.getStats('test-exp')
      expect(stats['control']).toBeDefined()
      expect(stats['control'].exposures).toBe(1)
      expect(stats['control'].conversions).toBe(0)
    })

    it('should increment exposure count', async () => {
      await store.recordExposure('test-exp', 'control')
      await store.recordExposure('test-exp', 'control')
      await store.recordExposure('test-exp', 'control')

      const stats = await store.getStats('test-exp')
      expect(stats['control'].exposures).toBe(3)
    })

    it('should track exposures per variant', async () => {
      await store.recordExposure('test-exp', 'control')
      await store.recordExposure('test-exp', 'control')
      await store.recordExposure('test-exp', 'treatment')

      const stats = await store.getStats('test-exp')
      expect(stats['control'].exposures).toBe(2)
      expect(stats['treatment'].exposures).toBe(1)
    })
  })

  describe('recording conversions', () => {
    it('should record a conversion', async () => {
      await store.recordConversion('test-exp', 'treatment')

      const stats = await store.getStats('test-exp')
      expect(stats['treatment'].conversions).toBe(1)
    })

    it('should increment conversion count', async () => {
      await store.recordConversion('test-exp', 'treatment')
      await store.recordConversion('test-exp', 'treatment')

      const stats = await store.getStats('test-exp')
      expect(stats['treatment'].conversions).toBe(2)
    })

    it('should calculate conversion rate', async () => {
      // 10 exposures, 2 conversions = 20% conversion rate
      for (let i = 0; i < 10; i++) {
        await store.recordExposure('test-exp', 'treatment')
      }
      await store.recordConversion('test-exp', 'treatment')
      await store.recordConversion('test-exp', 'treatment')

      const stats = await store.getStats('test-exp')
      expect(stats['treatment'].conversionRate).toBeCloseTo(0.2)
    })

    it('should handle zero exposures for conversion rate', async () => {
      await store.recordConversion('test-exp', 'treatment')

      const stats = await store.getStats('test-exp')
      expect(stats['treatment'].conversionRate).toBe(0)
    })
  })

  describe('recording metrics', () => {
    it('should record a metric value', async () => {
      await store.recordMetric('test-exp', 'treatment', 100)

      const stats = await store.getStats('test-exp')
      expect(stats['treatment'].metricSum).toBe(100)
      expect(stats['treatment'].metricCount).toBe(1)
      expect(stats['treatment'].metricMean).toBe(100)
    })

    it('should calculate metric mean', async () => {
      await store.recordMetric('test-exp', 'treatment', 100)
      await store.recordMetric('test-exp', 'treatment', 200)
      await store.recordMetric('test-exp', 'treatment', 300)

      const stats = await store.getStats('test-exp')
      expect(stats['treatment'].metricMean).toBeCloseTo(200) // (100+200+300)/3
    })

    it('should calculate metric standard deviation', async () => {
      // Values: 10, 20, 30 -> mean = 20, variance = 100, stdDev = 10
      await store.recordMetric('test-exp', 'treatment', 10)
      await store.recordMetric('test-exp', 'treatment', 20)
      await store.recordMetric('test-exp', 'treatment', 30)

      const stats = await store.getStats('test-exp')
      expect(stats['treatment'].metricStdDev).toBeCloseTo(10)
    })

    it('should handle single metric value for stdDev', async () => {
      await store.recordMetric('test-exp', 'treatment', 100)

      const stats = await store.getStats('test-exp')
      expect(stats['treatment'].metricStdDev).toBe(0) // Need at least 2 values for variance
    })

    it('should track metrics per variant', async () => {
      await store.recordMetric('test-exp', 'control', 50)
      await store.recordMetric('test-exp', 'treatment', 100)

      const stats = await store.getStats('test-exp')
      expect(stats['control'].metricMean).toBe(50)
      expect(stats['treatment'].metricMean).toBe(100)
    })
  })

  describe('combined stats', () => {
    it('should track exposures, conversions, and metrics together', async () => {
      // Simulate a full experiment
      await store.recordExposure('test-exp', 'control')
      await store.recordExposure('test-exp', 'control')
      await store.recordExposure('test-exp', 'treatment')
      await store.recordExposure('test-exp', 'treatment')
      await store.recordExposure('test-exp', 'treatment')

      await store.recordConversion('test-exp', 'control')
      await store.recordConversion('test-exp', 'treatment')
      await store.recordConversion('test-exp', 'treatment')

      await store.recordMetric('test-exp', 'control', 50)
      await store.recordMetric('test-exp', 'treatment', 100)
      await store.recordMetric('test-exp', 'treatment', 150)

      const stats = await store.getStats('test-exp')

      // Control
      expect(stats['control'].exposures).toBe(2)
      expect(stats['control'].conversions).toBe(1)
      expect(stats['control'].conversionRate).toBeCloseTo(0.5)
      expect(stats['control'].metricMean).toBe(50)

      // Treatment
      expect(stats['treatment'].exposures).toBe(3)
      expect(stats['treatment'].conversions).toBe(2)
      expect(stats['treatment'].conversionRate).toBeCloseTo(0.667, 2)
      expect(stats['treatment'].metricMean).toBe(125)
    })
  })

  describe('clearing results', () => {
    it('should clear results for an experiment', async () => {
      await store.recordExposure('test-exp', 'control')
      await store.recordExposure('test-exp', 'treatment')
      await store.recordConversion('test-exp', 'treatment')

      await store.clear('test-exp')

      const stats = await store.getStats('test-exp')
      expect(Object.keys(stats)).toHaveLength(0)
    })

    it('should only clear results for the specified experiment', async () => {
      await store.recordExposure('exp-a', 'control')
      await store.recordExposure('exp-b', 'control')

      await store.clear('exp-a')

      const statsA = await store.getStats('exp-a')
      const statsB = await store.getStats('exp-b')

      expect(Object.keys(statsA)).toHaveLength(0)
      expect(Object.keys(statsB)).toHaveLength(1)
    })
  })

  describe('custom prefix', () => {
    it('should use custom prefix for storage', async () => {
      const customStore = createResultsStore(storage, { prefix: 'custom:' })

      await customStore.recordExposure('test-exp', 'treatment')

      // Default store should not see these results
      const defaultStats = await store.getStats('test-exp')
      expect(Object.keys(defaultStats)).toHaveLength(0)

      // Custom store should see them
      const customStats = await customStore.getStats('test-exp')
      expect(customStats['treatment']).toBeDefined()
    })
  })

  describe('empty stats', () => {
    it('should return empty object for non-existent experiment', async () => {
      const stats = await store.getStats('non-existent')
      expect(stats).toEqual({})
    })
  })

  describe('computed stats accuracy', () => {
    it('should compute accurate stats with many data points', async () => {
      const experimentId = 'accuracy-test'
      const variantId = 'treatment'

      // Record 100 exposures
      for (let i = 0; i < 100; i++) {
        await store.recordExposure(experimentId, variantId)
      }

      // Record 25 conversions (25% conversion rate)
      for (let i = 0; i < 25; i++) {
        await store.recordConversion(experimentId, variantId)
      }

      // Record metrics with known mean and variance
      // Values 1-100, mean = 50.5
      for (let i = 1; i <= 100; i++) {
        await store.recordMetric(experimentId, variantId, i)
      }

      const stats = await store.getStats(experimentId)

      expect(stats[variantId].exposures).toBe(100)
      expect(stats[variantId].conversions).toBe(25)
      expect(stats[variantId].conversionRate).toBeCloseTo(0.25)
      expect(stats[variantId].metricMean).toBeCloseTo(50.5)
      // Standard deviation of 1-100 is ~29.01
      expect(stats[variantId].metricStdDev).toBeGreaterThan(28)
      expect(stats[variantId].metricStdDev).toBeLessThan(30)
    })
  })
})
