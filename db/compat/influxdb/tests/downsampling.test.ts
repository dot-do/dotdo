/**
 * @dotdo/influxdb - Downsampling tests
 *
 * Tests for WindowManager-based continuous queries and downsampling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ContinuousQuery, DownsampleManager, type DownsampleConfig } from '../downsampling'
import type { StoredPoint } from '../storage'

describe('ContinuousQuery', () => {
  let cq: ContinuousQuery

  afterEach(() => {
    if (cq) {
      cq.dispose()
    }
  })

  describe('Window Aggregation', () => {
    it('computes mean over tumbling windows', () => {
      const results: StoredPoint[] = []

      cq = new ContinuousQuery({
        name: 'mean_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'cpu',
        windowSize: '1m',
        aggregation: 'mean',
        onResult: (point) => results.push(point),
      })

      const baseTime = 1609459200000

      // Add 10 points in first minute window
      for (let i = 0; i < 10; i++) {
        cq.process({
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 + i },
          timestamp: baseTime + i * 1000,
        })
      }

      // Trigger window by advancing time
      cq.advanceTime(baseTime + 60000 + 1)

      expect(results).toHaveLength(1)
      expect(results[0].fields.value).toBeCloseTo(54.5, 2) // mean(50-59)
    })

    it('computes sum over tumbling windows', () => {
      const results: StoredPoint[] = []

      cq = new ContinuousQuery({
        name: 'sum_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'requests',
        windowSize: '1m',
        aggregation: 'sum',
        onResult: (point) => results.push(point),
      })

      const baseTime = 1609459200000

      // Add points with count=1 each
      for (let i = 0; i < 100; i++) {
        cq.process({
          measurement: 'requests',
          tags: { endpoint: '/api' },
          fields: { count: 1 },
          timestamp: baseTime + i * 500, // 2 per second
        })
      }

      cq.advanceTime(baseTime + 60000 + 1)

      expect(results).toHaveLength(1)
      expect(results[0].fields.count).toBe(100)
    })

    it('computes count over tumbling windows', () => {
      const results: StoredPoint[] = []

      cq = new ContinuousQuery({
        name: 'count_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'events',
        windowSize: '1m',
        aggregation: 'count',
        onResult: (point) => results.push(point),
      })

      const baseTime = 1609459200000

      for (let i = 0; i < 50; i++) {
        cq.process({
          measurement: 'events',
          tags: { type: 'click' },
          fields: { value: 1 },
          timestamp: baseTime + i * 1000,
        })
      }

      cq.advanceTime(baseTime + 60000 + 1)

      expect(results).toHaveLength(1)
      expect(results[0].fields.value).toBe(50)
    })

    it('computes min/max over tumbling windows', () => {
      const minResults: StoredPoint[] = []
      const maxResults: StoredPoint[] = []

      const minCQ = new ContinuousQuery({
        name: 'min_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'cpu',
        windowSize: '1m',
        aggregation: 'min',
        onResult: (point) => minResults.push(point),
      })

      const maxCQ = new ContinuousQuery({
        name: 'max_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'cpu',
        windowSize: '1m',
        aggregation: 'max',
        onResult: (point) => maxResults.push(point),
      })

      const baseTime = 1609459200000

      const values = [10, 50, 30, 90, 20, 80]
      values.forEach((v, i) => {
        const point: StoredPoint = {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: v },
          timestamp: baseTime + i * 1000,
        }
        minCQ.process(point)
        maxCQ.process(point)
      })

      minCQ.advanceTime(baseTime + 60000 + 1)
      maxCQ.advanceTime(baseTime + 60000 + 1)

      expect(minResults[0].fields.value).toBe(10)
      expect(maxResults[0].fields.value).toBe(90)

      minCQ.dispose()
      maxCQ.dispose()
    })
  })

  describe('Multiple Windows', () => {
    it('handles consecutive windows', () => {
      const results: StoredPoint[] = []

      cq = new ContinuousQuery({
        name: 'mean_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'cpu',
        windowSize: '1m',
        aggregation: 'mean',
        onResult: (point) => results.push(point),
      })

      const baseTime = 1609459200000

      // Window 1: values 10-19 (mean = 14.5)
      for (let i = 0; i < 10; i++) {
        cq.process({
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 10 + i },
          timestamp: baseTime + i * 1000,
        })
      }

      // Window 2: values 20-29 (mean = 24.5)
      for (let i = 0; i < 10; i++) {
        cq.process({
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 20 + i },
          timestamp: baseTime + 60000 + i * 1000,
        })
      }

      cq.advanceTime(baseTime + 120000 + 1)

      expect(results).toHaveLength(2)
      expect(results[0].fields.value).toBeCloseTo(14.5, 2)
      expect(results[1].fields.value).toBeCloseTo(24.5, 2)
    })
  })

  describe('Tag Preservation', () => {
    it('preserves tags in aggregated output', () => {
      const results: StoredPoint[] = []

      cq = new ContinuousQuery({
        name: 'mean_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'cpu',
        windowSize: '1m',
        aggregation: 'mean',
        groupBy: ['host', 'region'],
        onResult: (point) => results.push(point),
      })

      const baseTime = 1609459200000

      for (let i = 0; i < 10; i++) {
        cq.process({
          measurement: 'cpu',
          tags: { host: 'server01', region: 'us-west' },
          fields: { value: 50 + i },
          timestamp: baseTime + i * 1000,
        })
      }

      cq.advanceTime(baseTime + 60000 + 1)

      expect(results[0].tags).toEqual({ host: 'server01', region: 'us-west' })
    })

    it('groups by specified tags', () => {
      const results: StoredPoint[] = []

      cq = new ContinuousQuery({
        name: 'mean_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'cpu',
        windowSize: '1m',
        aggregation: 'mean',
        groupBy: ['host'],
        onResult: (point) => results.push(point),
      })

      const baseTime = 1609459200000

      // Add data for two hosts
      for (let i = 0; i < 10; i++) {
        cq.process({
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 + i },
          timestamp: baseTime + i * 1000,
        })
        cq.process({
          measurement: 'cpu',
          tags: { host: 'server02' },
          fields: { value: 70 + i },
          timestamp: baseTime + i * 1000,
        })
      }

      cq.advanceTime(baseTime + 60000 + 1)

      expect(results).toHaveLength(2)
      const server01Result = results.find((r) => r.tags.host === 'server01')
      const server02Result = results.find((r) => r.tags.host === 'server02')

      expect(server01Result!.fields.value).toBeCloseTo(54.5, 2)
      expect(server02Result!.fields.value).toBeCloseTo(74.5, 2)
    })
  })

  describe('Multi-Field Support', () => {
    it('aggregates multiple fields independently', () => {
      const results: StoredPoint[] = []

      cq = new ContinuousQuery({
        name: 'mean_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'system',
        windowSize: '1m',
        aggregation: 'mean',
        onResult: (point) => results.push(point),
      })

      const baseTime = 1609459200000

      for (let i = 0; i < 10; i++) {
        cq.process({
          measurement: 'system',
          tags: { host: 'server01' },
          fields: {
            cpu: 50 + i,
            memory: 1000 + i * 10,
          },
          timestamp: baseTime + i * 1000,
        })
      }

      cq.advanceTime(baseTime + 60000 + 1)

      expect(results).toHaveLength(1)
      expect(results[0].fields.cpu).toBeCloseTo(54.5, 2)
      expect(results[0].fields.memory).toBeCloseTo(1045, 0)
    })
  })
})

describe('DownsampleManager', () => {
  let manager: DownsampleManager

  beforeEach(() => {
    manager = new DownsampleManager()
  })

  afterEach(() => {
    manager.dispose()
  })

  describe('Configuration', () => {
    it('creates downsampling rules', () => {
      manager.createRule({
        name: 'rollup_1h',
        sourceBucket: 'raw',
        destinationBucket: 'hourly',
        measurement: 'cpu',
        windowSize: '1h',
        aggregation: 'mean',
      })

      const rules = manager.listRules()
      expect(rules).toHaveLength(1)
      expect(rules[0].name).toBe('rollup_1h')
    })

    it('removes downsampling rules', () => {
      manager.createRule({
        name: 'rollup_1h',
        sourceBucket: 'raw',
        destinationBucket: 'hourly',
        measurement: 'cpu',
        windowSize: '1h',
        aggregation: 'mean',
      })

      manager.removeRule('rollup_1h')

      const rules = manager.listRules()
      expect(rules).toHaveLength(0)
    })
  })

  describe('Data Routing', () => {
    it('routes points to matching rules', () => {
      const results: StoredPoint[] = []

      manager.createRule({
        name: 'rollup_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'cpu',
        windowSize: '1m',
        aggregation: 'mean',
        onResult: (point) => results.push(point),
      })

      const baseTime = 1609459200000

      for (let i = 0; i < 10; i++) {
        manager.process('raw', {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 + i },
          timestamp: baseTime + i * 1000,
        })
      }

      manager.advanceTime(baseTime + 60000 + 1)

      expect(results).toHaveLength(1)
    })

    it('ignores points from non-matching buckets', () => {
      const results: StoredPoint[] = []

      manager.createRule({
        name: 'rollup_1m',
        sourceBucket: 'raw',
        destinationBucket: 'downsampled',
        measurement: 'cpu',
        windowSize: '1m',
        aggregation: 'mean',
        onResult: (point) => results.push(point),
      })

      const baseTime = 1609459200000

      for (let i = 0; i < 10; i++) {
        manager.process('other-bucket', {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 + i },
          timestamp: baseTime + i * 1000,
        })
      }

      manager.advanceTime(baseTime + 60000 + 1)

      expect(results).toHaveLength(0)
    })

    it('routes to multiple rules', () => {
      const results1m: StoredPoint[] = []
      const results5m: StoredPoint[] = []

      manager.createRule({
        name: 'rollup_1m',
        sourceBucket: 'raw',
        destinationBucket: 'minute',
        measurement: 'cpu',
        windowSize: '1m',
        aggregation: 'mean',
        onResult: (point) => results1m.push(point),
      })

      manager.createRule({
        name: 'rollup_5m',
        sourceBucket: 'raw',
        destinationBucket: 'fivemin',
        measurement: 'cpu',
        windowSize: '5m',
        aggregation: 'mean',
        onResult: (point) => results5m.push(point),
      })

      const baseTime = 1609459200000

      // Add data for 6 minutes
      for (let i = 0; i < 360; i++) {
        manager.process('raw', {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 },
          timestamp: baseTime + i * 1000,
        })
      }

      manager.advanceTime(baseTime + 360000 + 1)

      expect(results1m.length).toBeGreaterThanOrEqual(6)
      expect(results5m.length).toBeGreaterThanOrEqual(1)
    })
  })
})
