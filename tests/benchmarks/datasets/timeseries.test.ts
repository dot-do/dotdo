import { describe, test, expect } from 'vitest'
import { TimeSeriesGenerator } from './timeseries'

describe('TimeSeriesGenerator', () => {
  test('produces timestamps in order', () => {
    const gen = new TimeSeriesGenerator()
    const data = gen.generateSync({
      size: 10,
      startTime: new Date('2024-01-01'),
      interval: 1000,
    })

    for (let i = 1; i < data.length; i++) {
      expect(data[i].timestamp.getTime()).toBeGreaterThan(data[i - 1].timestamp.getTime())
    }
  })

  test('respects interval spacing', () => {
    const gen = new TimeSeriesGenerator()
    const data = gen.generateSync({
      size: 5,
      startTime: new Date('2024-01-01'),
      interval: 60000, // 1 minute
    })

    for (let i = 1; i < data.length; i++) {
      const diff = data[i].timestamp.getTime() - data[i - 1].timestamp.getTime()
      expect(diff).toBe(60000)
    }
  })

  test('values are within specified range', () => {
    const gen = new TimeSeriesGenerator()
    const data = gen.generateSync({
      size: 100,
      startTime: new Date(),
      interval: 1000,
      valueRange: { min: 0, max: 100 },
    })

    data.forEach((d) => {
      expect(d.value).toBeGreaterThanOrEqual(0)
      expect(d.value).toBeLessThanOrEqual(100)
    })
  })

  test('is deterministic with same seed', () => {
    const gen = new TimeSeriesGenerator()
    const config = {
      size: 10,
      startTime: new Date('2024-01-01'),
      interval: 1000,
      seed: 42,
    }

    const d1 = gen.generateSync(config)
    const d2 = gen.generateSync(config)

    expect(d1.map((d) => d.value)).toEqual(d2.map((d) => d.value))
  })
})
