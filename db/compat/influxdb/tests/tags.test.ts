/**
 * @dotdo/influxdb - Tag Index tests
 *
 * Tests for InvertedIndex-based tag lookup
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SeriesTagIndex } from '../tags'

describe('SeriesTagIndex', () => {
  let tagIndex: SeriesTagIndex

  beforeEach(() => {
    tagIndex = new SeriesTagIndex()
  })

  describe('Basic Operations', () => {
    it('indexes series with tags', () => {
      tagIndex.add('cpu:host=server01,region=us-west', {
        host: 'server01',
        region: 'us-west',
      })

      const series = tagIndex.findSeries({ host: 'server01' })
      expect(series).toContain('cpu:host=server01,region=us-west')
    })

    it('removes series from index', () => {
      tagIndex.add('cpu:host=server01', { host: 'server01' })
      tagIndex.remove('cpu:host=server01')

      const series = tagIndex.findSeries({ host: 'server01' })
      expect(series).toHaveLength(0)
    })

    it('updates tags for existing series', () => {
      tagIndex.add('cpu:host=server01', { host: 'server01', region: 'us-west' })
      tagIndex.add('cpu:host=server01', { host: 'server01', region: 'us-east' })

      const westSeries = tagIndex.findSeries({ region: 'us-west' })
      const eastSeries = tagIndex.findSeries({ region: 'us-east' })

      expect(westSeries).toHaveLength(0)
      expect(eastSeries).toContain('cpu:host=server01')
    })
  })

  describe('Tag Queries', () => {
    beforeEach(() => {
      // Add multiple series with different tag combinations
      tagIndex.add('cpu:host=server01,region=us-west', {
        host: 'server01',
        region: 'us-west',
      })
      tagIndex.add('cpu:host=server02,region=us-west', {
        host: 'server02',
        region: 'us-west',
      })
      tagIndex.add('cpu:host=server03,region=us-east', {
        host: 'server03',
        region: 'us-east',
      })
      tagIndex.add('memory:host=server01,region=us-west', {
        host: 'server01',
        region: 'us-west',
      })
    })

    it('finds series by single tag', () => {
      const series = tagIndex.findSeries({ host: 'server01' })
      expect(series).toHaveLength(2)
      expect(series).toContain('cpu:host=server01,region=us-west')
      expect(series).toContain('memory:host=server01,region=us-west')
    })

    it('finds series by multiple tags (AND)', () => {
      const series = tagIndex.findSeries({
        host: 'server01',
        region: 'us-west',
      })
      expect(series).toHaveLength(2)
    })

    it('returns empty array for non-matching tags', () => {
      const series = tagIndex.findSeries({ host: 'server99' })
      expect(series).toHaveLength(0)
    })

    it('returns all series for empty query', () => {
      const series = tagIndex.findSeries({})
      expect(series).toHaveLength(4)
    })

    it('finds series with OR query', () => {
      const series = tagIndex.findSeriesOr([
        { region: 'us-west' },
        { region: 'us-east' },
      ])
      expect(series).toHaveLength(4)
    })
  })

  describe('Tag Enumeration', () => {
    beforeEach(() => {
      tagIndex.add('cpu:host=server01,region=us-west', {
        host: 'server01',
        region: 'us-west',
        env: 'prod',
      })
      tagIndex.add('cpu:host=server02,region=us-east', {
        host: 'server02',
        region: 'us-east',
        env: 'prod',
      })
    })

    it('lists all tag keys', () => {
      const keys = tagIndex.getTagKeys()
      expect(keys).toContain('host')
      expect(keys).toContain('region')
      expect(keys).toContain('env')
    })

    it('lists all values for a tag key', () => {
      const values = tagIndex.getTagValues('region')
      expect(values).toContain('us-west')
      expect(values).toContain('us-east')
    })

    it('gets cardinality for tag key', () => {
      const cardinality = tagIndex.getCardinality('region')
      expect(cardinality).toBe(2)
    })

    it('returns empty values for non-existent key', () => {
      const values = tagIndex.getTagValues('unknown')
      expect(values).toHaveLength(0)
    })
  })

  describe('Measurement Filtering', () => {
    beforeEach(() => {
      tagIndex.add('cpu:host=server01', { host: 'server01' })
      tagIndex.add('memory:host=server01', { host: 'server01' })
      tagIndex.add('disk:host=server01', { host: 'server01' })
    })

    it('finds series by measurement', () => {
      const series = tagIndex.findSeriesByMeasurement('cpu')
      expect(series).toHaveLength(1)
      expect(series[0]).toContain('cpu:')
    })

    it('combines measurement and tag filters', () => {
      tagIndex.add('cpu:host=server02', { host: 'server02' })

      const series = tagIndex.findSeries(
        { host: 'server01' },
        'cpu'
      )
      expect(series).toHaveLength(1)
      expect(series[0]).toBe('cpu:host=server01')
    })
  })

  describe('Serialization', () => {
    beforeEach(() => {
      tagIndex.add('cpu:host=server01', { host: 'server01', region: 'us-west' })
      tagIndex.add('cpu:host=server02', { host: 'server02', region: 'us-east' })
    })

    it('serializes and deserializes correctly', () => {
      const bytes = tagIndex.serialize()
      const restored = SeriesTagIndex.deserialize(bytes)

      const series = restored.findSeries({ host: 'server01' })
      expect(series).toContain('cpu:host=server01')
    })

    it('preserves all data through serialization', () => {
      const bytes = tagIndex.serialize()
      const restored = SeriesTagIndex.deserialize(bytes)

      expect(restored.getTagKeys()).toEqual(tagIndex.getTagKeys())
      expect(restored.getTagValues('region').sort()).toEqual(
        tagIndex.getTagValues('region').sort()
      )
    })
  })

  describe('Performance', () => {
    it('handles large number of series', () => {
      // Add 10,000 unique series (host 0-999, region 0-9)
      for (let i = 0; i < 10000; i++) {
        tagIndex.add(`cpu:host=server${i},region=region${i % 10}`, {
          host: `server${i}`,
          region: `region${i % 10}`,
        })
      }

      const startTime = performance.now()
      const series = tagIndex.findSeries({ region: 'region5' })
      const elapsed = performance.now() - startTime

      expect(series).toHaveLength(1000) // 10000 / 10 regions
      expect(elapsed).toBeLessThan(100) // Should be fast
    })
  })
})
