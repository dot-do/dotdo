/**
 * @dotdo/vitals - VitalsCollector Tests
 *
 * Tests for the VitalsCollector class.
 * Following TDD: RED phase - these tests define expected behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  VitalsCollector,
  DEFAULT_THRESHOLDS,
  type AnalyticsClient,
  type VitalsConfig,
  type WebVital,
  type WebVitalName,
} from '../index'

describe('@dotdo/vitals - VitalsCollector', () => {
  // Mock analytics client
  let mockClient: AnalyticsClient & { events: Array<{ event: string; properties: Record<string, unknown> }> }

  beforeEach(() => {
    mockClient = {
      events: [],
      track(event: string, properties?: Record<string, unknown>) {
        this.events.push({ event, properties: properties ?? {} })
      },
    }
  })

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('Constructor', () => {
    it('should create collector with analytics client', () => {
      const collector = new VitalsCollector(mockClient)
      expect(collector).toBeDefined()
    })

    it('should accept VitalsConfig', () => {
      const config: VitalsConfig = {
        sampleRate: 0.5,
        debug: true,
        routePattern: '/users/:id',
      }
      const collector = new VitalsCollector(mockClient, config)
      expect(collector.getConfig()).toEqual(config)
    })

    it('should use default thresholds when none provided', () => {
      const collector = new VitalsCollector(mockClient)
      expect(collector.getThresholds()).toEqual(DEFAULT_THRESHOLDS)
    })

    it('should merge custom thresholds with defaults', () => {
      const config: VitalsConfig = {
        thresholds: {
          LCP: [2000, 3500], // Custom LCP thresholds
        },
      }
      const collector = new VitalsCollector(mockClient, config)
      const thresholds = collector.getThresholds()

      // Custom LCP threshold
      expect(thresholds.LCP).toEqual([2000, 3500])
      // Default CLS threshold (not overridden)
      expect(thresholds.CLS).toEqual(DEFAULT_THRESHOLDS.CLS)
    })
  })

  // ===========================================================================
  // Reporting Tests
  // ===========================================================================

  describe('Reporting', () => {
    it('should report vital via analytics client track()', () => {
      const collector = new VitalsCollector(mockClient)

      const vital: WebVital = {
        name: 'LCP',
        value: 2100,
        rating: 'good',
        delta: 2100,
        id: 'v1-1234567890',
      }

      collector.reportVital(vital)

      expect(mockClient.events).toHaveLength(1)
      expect(mockClient.events[0]?.event).toBe('Web Vital')
    })

    it('should include all vital fields in properties', () => {
      const collector = new VitalsCollector(mockClient)

      const vital: WebVital = {
        name: 'CLS',
        value: 0.05,
        rating: 'good',
        delta: 0.05,
        id: 'v1-abc123',
        navigationType: 'navigate',
      }

      collector.reportVital(vital)

      const properties = mockClient.events[0]?.properties
      expect(properties?.metric).toBe('CLS')
      expect(properties?.value).toBe(0.05)
      expect(properties?.rating).toBe('good')
      expect(properties?.delta).toBe(0.05)
      expect(properties?.id).toBe('v1-abc123')
      expect(properties?.navigationType).toBe('navigate')
    })

    it('should include route pattern in properties', () => {
      const collector = new VitalsCollector(mockClient, {
        routePattern: '/products/:id',
      })

      const vital: WebVital = {
        name: 'FCP',
        value: 1500,
        rating: 'good',
        delta: 1500,
        id: 'v1-xyz789',
      }

      collector.reportVital(vital)

      expect(mockClient.events[0]?.properties?.routePattern).toBe('/products/:id')
    })

    it('should track multiple vitals', () => {
      const collector = new VitalsCollector(mockClient)

      const vitals: WebVital[] = [
        { name: 'LCP', value: 2000, rating: 'good', delta: 2000, id: 'v1' },
        { name: 'FID', value: 50, rating: 'good', delta: 50, id: 'v2' },
        { name: 'CLS', value: 0.1, rating: 'good', delta: 0.1, id: 'v3' },
      ]

      vitals.forEach((v) => collector.reportVital(v))

      expect(mockClient.events).toHaveLength(3)
      expect(mockClient.events[0]?.properties?.metric).toBe('LCP')
      expect(mockClient.events[1]?.properties?.metric).toBe('FID')
      expect(mockClient.events[2]?.properties?.metric).toBe('CLS')
    })
  })

  // ===========================================================================
  // Rating Calculation Tests
  // ===========================================================================

  describe('Rating Calculation', () => {
    describe('Static getRating()', () => {
      it('should return "good" for values at or below good threshold', () => {
        // CLS: good threshold is 0.1
        expect(VitalsCollector.getRating('CLS', 0.1)).toBe('good')
        expect(VitalsCollector.getRating('CLS', 0.05)).toBe('good')
        expect(VitalsCollector.getRating('CLS', 0)).toBe('good')

        // LCP: good threshold is 2500ms
        expect(VitalsCollector.getRating('LCP', 2500)).toBe('good')
        expect(VitalsCollector.getRating('LCP', 2000)).toBe('good')

        // FID: good threshold is 100ms
        expect(VitalsCollector.getRating('FID', 100)).toBe('good')
        expect(VitalsCollector.getRating('FID', 50)).toBe('good')
      })

      it('should return "needs-improvement" for values between thresholds', () => {
        // CLS: between 0.1 and 0.25
        expect(VitalsCollector.getRating('CLS', 0.15)).toBe('needs-improvement')
        expect(VitalsCollector.getRating('CLS', 0.25)).toBe('needs-improvement')

        // LCP: between 2500 and 4000
        expect(VitalsCollector.getRating('LCP', 3000)).toBe('needs-improvement')
        expect(VitalsCollector.getRating('LCP', 4000)).toBe('needs-improvement')

        // FID: between 100 and 300
        expect(VitalsCollector.getRating('FID', 150)).toBe('needs-improvement')
        expect(VitalsCollector.getRating('FID', 300)).toBe('needs-improvement')
      })

      it('should return "poor" for values above poor threshold', () => {
        // CLS: above 0.25
        expect(VitalsCollector.getRating('CLS', 0.26)).toBe('poor')
        expect(VitalsCollector.getRating('CLS', 0.5)).toBe('poor')

        // LCP: above 4000
        expect(VitalsCollector.getRating('LCP', 4001)).toBe('poor')
        expect(VitalsCollector.getRating('LCP', 6000)).toBe('poor')

        // FID: above 300
        expect(VitalsCollector.getRating('FID', 301)).toBe('poor')
        expect(VitalsCollector.getRating('FID', 500)).toBe('poor')
      })

      it('should handle all metric types', () => {
        const metrics: WebVitalName[] = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB']

        metrics.forEach((metric) => {
          const goodThreshold = DEFAULT_THRESHOLDS[metric][0]
          const poorThreshold = DEFAULT_THRESHOLDS[metric][1]

          // At good threshold
          expect(VitalsCollector.getRating(metric, goodThreshold)).toBe('good')
          // Between thresholds
          expect(VitalsCollector.getRating(metric, (goodThreshold + poorThreshold) / 2)).toBe('needs-improvement')
          // Above poor threshold
          expect(VitalsCollector.getRating(metric, poorThreshold + 1)).toBe('poor')
        })
      })

      it('should handle exact boundary values correctly', () => {
        // Exactly at good threshold = good
        expect(VitalsCollector.getRating('LCP', 2500)).toBe('good')
        // Exactly at poor threshold = needs-improvement (not poor)
        expect(VitalsCollector.getRating('LCP', 4000)).toBe('needs-improvement')
        // Just above poor threshold = poor
        expect(VitalsCollector.getRating('LCP', 4000.01)).toBe('poor')
      })
    })

    describe('Instance getRating()', () => {
      it('should use default thresholds when none provided', () => {
        const collector = new VitalsCollector(mockClient)

        expect(collector.getRating('LCP', 2000)).toBe('good')
        expect(collector.getRating('LCP', 3000)).toBe('needs-improvement')
        expect(collector.getRating('LCP', 5000)).toBe('poor')
      })

      it('should use custom thresholds when provided', () => {
        const collector = new VitalsCollector(mockClient, {
          thresholds: {
            LCP: [1500, 3000], // Stricter than default
          },
        })

        // 2000 is poor with custom threshold (>1500) but would be good with default
        expect(collector.getRating('LCP', 2000)).toBe('needs-improvement')
        expect(collector.getRating('LCP', 1500)).toBe('good')
        expect(collector.getRating('LCP', 3001)).toBe('poor')
      })
    })
  })

  // ===========================================================================
  // Sampling Tests
  // ===========================================================================

  describe('Sampling', () => {
    it('should report all vitals when sampleRate is 1 (100%)', () => {
      const collector = new VitalsCollector(mockClient, { sampleRate: 1 })

      for (let i = 0; i < 10; i++) {
        collector.reportVital({
          name: 'LCP',
          value: 2000,
          rating: 'good',
          delta: 2000,
          id: `v${i}`,
        })
      }

      expect(mockClient.events).toHaveLength(10)
    })

    it('should report no vitals when sampleRate is 0', () => {
      // Use a random function that always returns > 0
      const collector = new VitalsCollector(mockClient, { sampleRate: 0 }, () => 0.5)

      for (let i = 0; i < 10; i++) {
        collector.reportVital({
          name: 'LCP',
          value: 2000,
          rating: 'good',
          delta: 2000,
          id: `v${i}`,
        })
      }

      expect(mockClient.events).toHaveLength(0)
    })

    it('should use reproducible sampling with custom random function', () => {
      // Sequence of random values: 0.3, 0.7, 0.2, 0.8, 0.1
      const randomValues = [0.3, 0.7, 0.2, 0.8, 0.1]
      let index = 0
      const randomFn = () => randomValues[index++] ?? 0.5

      const collector = new VitalsCollector(mockClient, { sampleRate: 0.5 }, randomFn)

      // With 50% sample rate:
      // 0.3 <= 0.5 - REPORT
      // 0.7 > 0.5 - SKIP
      // 0.2 <= 0.5 - REPORT
      // 0.8 > 0.5 - SKIP
      // 0.1 <= 0.5 - REPORT
      for (let i = 0; i < 5; i++) {
        collector.reportVital({
          name: 'LCP',
          value: 2000,
          rating: 'good',
          delta: 2000,
          id: `v${i}`,
        })
      }

      expect(mockClient.events).toHaveLength(3)
      expect(mockClient.events[0]?.properties?.id).toBe('v0')
      expect(mockClient.events[1]?.properties?.id).toBe('v2')
      expect(mockClient.events[2]?.properties?.id).toBe('v4')
    })

    it('should default to 100% sample rate when not specified', () => {
      const collector = new VitalsCollector(mockClient)

      collector.reportVital({
        name: 'LCP',
        value: 2000,
        rating: 'good',
        delta: 2000,
        id: 'v1',
      })

      expect(mockClient.events).toHaveLength(1)
    })

    it('should handle sampleRate of 0.5 (50%)', () => {
      // Use deterministic random for testing
      let callCount = 0
      const randomFn = () => (callCount++ % 2 === 0 ? 0.3 : 0.7) // Alternates below/above 0.5

      const collector = new VitalsCollector(mockClient, { sampleRate: 0.5 }, randomFn)

      for (let i = 0; i < 10; i++) {
        collector.reportVital({
          name: 'LCP',
          value: 2000,
          rating: 'good',
          delta: 2000,
          id: `v${i}`,
        })
      }

      // Should report ~50% (every other one with our deterministic random)
      expect(mockClient.events).toHaveLength(5)
    })
  })

  // ===========================================================================
  // Debug Mode Tests
  // ===========================================================================

  describe('Debug Mode', () => {
    it('should log to console when debug is true', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const collector = new VitalsCollector(mockClient, { debug: true })

      collector.reportVital({
        name: 'LCP',
        value: 2000,
        rating: 'good',
        delta: 2000,
        id: 'v1',
      })

      expect(consoleSpy).toHaveBeenCalledWith('[Vitals] LCP: 2000 (good)')

      consoleSpy.mockRestore()
    })

    it('should not log when debug is false', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const collector = new VitalsCollector(mockClient, { debug: false })

      collector.reportVital({
        name: 'LCP',
        value: 2000,
        rating: 'good',
        delta: 2000,
        id: 'v1',
      })

      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should not log when debug is not specified', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const collector = new VitalsCollector(mockClient)

      collector.reportVital({
        name: 'LCP',
        value: 2000,
        rating: 'good',
        delta: 2000,
        id: 'v1',
      })

      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  // ===========================================================================
  // Threshold Tests
  // ===========================================================================

  describe('Thresholds', () => {
    it('should have correct default thresholds for Core Web Vitals', () => {
      expect(DEFAULT_THRESHOLDS.CLS).toEqual([0.1, 0.25])
      expect(DEFAULT_THRESHOLDS.FCP).toEqual([1800, 3000])
      expect(DEFAULT_THRESHOLDS.FID).toEqual([100, 300])
      expect(DEFAULT_THRESHOLDS.INP).toEqual([200, 500])
      expect(DEFAULT_THRESHOLDS.LCP).toEqual([2500, 4000])
      expect(DEFAULT_THRESHOLDS.TTFB).toEqual([800, 1800])
    })
  })
})
