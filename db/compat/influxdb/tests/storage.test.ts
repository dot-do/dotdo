/**
 * @dotdo/influxdb - Storage tests
 *
 * Tests for columnar storage with Gorilla compression
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TimeSeriesStorage, type StoredPoint } from '../storage'

describe('TimeSeriesStorage', () => {
  let storage: TimeSeriesStorage

  beforeEach(() => {
    storage = new TimeSeriesStorage()
  })

  describe('Basic Operations', () => {
    it('stores and retrieves points', () => {
      const point: StoredPoint = {
        measurement: 'cpu',
        tags: { host: 'server01' },
        fields: { value: 0.64 },
        timestamp: 1609459200000,
      }

      storage.write('cpu:host=server01', point)
      const points = storage.read('cpu:host=server01')

      expect(points).toHaveLength(1)
      expect(points[0]).toEqual(point)
    })

    it('stores multiple points for same series', () => {
      const baseTime = 1609459200000

      for (let i = 0; i < 100; i++) {
        storage.write('cpu:host=server01', {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 + Math.sin(i / 10) * 20 },
          timestamp: baseTime + i * 1000,
        })
      }

      const points = storage.read('cpu:host=server01')
      expect(points).toHaveLength(100)
    })

    it('returns empty array for non-existent series', () => {
      const points = storage.read('non-existent')
      expect(points).toEqual([])
    })
  })

  describe('Compression', () => {
    it('compresses float values with Gorilla encoding', () => {
      const baseTime = 1609459200000
      const seriesKey = 'cpu:host=server01'

      // Write many similar values (good for Gorilla compression)
      for (let i = 0; i < 1000; i++) {
        storage.write(seriesKey, {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50.5 + Math.random() * 0.1 },
          timestamp: baseTime + i * 1000,
        })
      }

      const stats = storage.getCompressionStats(seriesKey)
      expect(stats).toBeDefined()
      expect(stats!.compressionRatio).toBeGreaterThan(1) // Should compress
    })

    it('compresses timestamps with Delta encoding', () => {
      const baseTime = 1609459200000
      const seriesKey = 'cpu:host=server01'

      // Write with regular intervals (ideal for delta compression)
      for (let i = 0; i < 1000; i++) {
        storage.write(seriesKey, {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 },
          timestamp: baseTime + i * 1000, // Regular 1-second intervals
        })
      }

      const stats = storage.getCompressionStats(seriesKey)
      expect(stats).toBeDefined()
      expect(stats!.timestampCompressionRatio).toBeGreaterThan(1)
    })

    it('flushes to compressed format', () => {
      const baseTime = 1609459200000
      const seriesKey = 'cpu:host=server01'

      for (let i = 0; i < 100; i++) {
        storage.write(seriesKey, {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: 50 + i * 0.1 },
          timestamp: baseTime + i * 1000,
        })
      }

      storage.flush(seriesKey)
      const points = storage.read(seriesKey)

      expect(points).toHaveLength(100)
      // Verify data integrity after compression
      expect(points[0].fields.value).toBeCloseTo(50, 1)
      expect(points[99].fields.value).toBeCloseTo(59.9, 1)
    })
  })

  describe('Time Range Queries', () => {
    beforeEach(() => {
      const baseTime = 1609459200000
      for (let i = 0; i < 100; i++) {
        storage.write('cpu:host=server01', {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: i },
          timestamp: baseTime + i * 1000,
        })
      }
    })

    it('reads points within time range', () => {
      const baseTime = 1609459200000
      const points = storage.readRange(
        'cpu:host=server01',
        baseTime + 10000,
        baseTime + 20000
      )

      expect(points).toHaveLength(11) // Inclusive range
      expect(points[0].timestamp).toBe(baseTime + 10000)
      expect(points[10].timestamp).toBe(baseTime + 20000)
    })

    it('handles open-ended start range', () => {
      const baseTime = 1609459200000
      const points = storage.readRange(
        'cpu:host=server01',
        undefined,
        baseTime + 10000
      )

      expect(points).toHaveLength(11) // 0-10
    })

    it('handles open-ended end range', () => {
      const baseTime = 1609459200000
      const points = storage.readRange(
        'cpu:host=server01',
        baseTime + 90000,
        undefined
      )

      expect(points).toHaveLength(10) // 90-99
    })
  })

  describe('Multi-Field Support', () => {
    it('handles points with multiple fields', () => {
      const point: StoredPoint = {
        measurement: 'system',
        tags: { host: 'server01' },
        fields: {
          cpu: 45.5,
          memory: 1024,
          disk: 500,
        },
        timestamp: 1609459200000,
      }

      storage.write('system:host=server01', point)
      const points = storage.read('system:host=server01')

      expect(points[0].fields).toEqual({
        cpu: 45.5,
        memory: 1024,
        disk: 500,
      })
    })

    it('compresses each field column independently', () => {
      const seriesKey = 'system:host=server01'
      const baseTime = 1609459200000

      for (let i = 0; i < 100; i++) {
        storage.write(seriesKey, {
          measurement: 'system',
          tags: { host: 'server01' },
          fields: {
            cpu: 50 + Math.random() * 10,
            memory: 8192 + i, // Linear increase
            disk: 500, // Constant (great for RLE)
          },
          timestamp: baseTime + i * 1000,
        })
      }

      const stats = storage.getCompressionStats(seriesKey)
      expect(stats!.fieldStats['cpu']).toBeDefined()
      expect(stats!.fieldStats['memory']).toBeDefined()
      expect(stats!.fieldStats['disk']).toBeDefined()
    })
  })

  describe('Memory Management', () => {
    it('tracks memory usage', () => {
      const seriesKey = 'cpu:host=server01'
      const baseTime = 1609459200000

      const initialMemory = storage.getMemoryUsage()

      for (let i = 0; i < 1000; i++) {
        storage.write(seriesKey, {
          measurement: 'cpu',
          tags: { host: 'server01' },
          fields: { value: Math.random() * 100 },
          timestamp: baseTime + i * 1000,
        })
      }

      const finalMemory = storage.getMemoryUsage()
      expect(finalMemory).toBeGreaterThan(initialMemory)
    })

    it('lists all series keys', () => {
      storage.write('cpu:host=server01', {
        measurement: 'cpu',
        tags: { host: 'server01' },
        fields: { value: 50 },
        timestamp: Date.now(),
      })

      storage.write('cpu:host=server02', {
        measurement: 'cpu',
        tags: { host: 'server02' },
        fields: { value: 60 },
        timestamp: Date.now(),
      })

      const keys = storage.listSeries()
      expect(keys).toContain('cpu:host=server01')
      expect(keys).toContain('cpu:host=server02')
    })

    it('drops series data', () => {
      const seriesKey = 'cpu:host=server01'
      storage.write(seriesKey, {
        measurement: 'cpu',
        tags: { host: 'server01' },
        fields: { value: 50 },
        timestamp: Date.now(),
      })

      storage.drop(seriesKey)
      const points = storage.read(seriesKey)
      expect(points).toHaveLength(0)
    })
  })
})
