import { describe, test, expect } from 'vitest'
import { MetricCollector } from './metrics'

describe('MetricCollector', () => {
  test('computes p50 correctly', () => {
    const collector = new MetricCollector([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(collector.p50).toBe(5.5)
  })

  test('computes p50 for odd count', () => {
    const collector = new MetricCollector([1, 2, 3, 4, 5])
    expect(collector.p50).toBe(3)
  })

  test('computes p95 correctly', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1)
    const collector = new MetricCollector(samples)
    expect(collector.p95).toBe(95)
  })

  test('computes p99 correctly', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1)
    const collector = new MetricCollector(samples)
    expect(collector.p99).toBe(99)
  })

  test('computes min correctly', () => {
    const collector = new MetricCollector([5, 3, 8, 1, 9])
    expect(collector.min).toBe(1)
  })

  test('computes max correctly', () => {
    const collector = new MetricCollector([5, 3, 8, 1, 9])
    expect(collector.max).toBe(9)
  })

  test('computes avg correctly', () => {
    const collector = new MetricCollector([2, 4, 6, 8, 10])
    expect(collector.avg).toBe(6)
  })

  test('computes stdDev correctly', () => {
    const collector = new MetricCollector([2, 4, 4, 4, 5, 5, 7, 9])
    expect(collector.stdDev).toBeCloseTo(2, 0)
  })

  test('handles empty samples', () => {
    const collector = new MetricCollector([])
    expect(collector.p50).toBe(0)
    expect(collector.avg).toBe(0)
    expect(collector.min).toBe(0)
    expect(collector.max).toBe(0)
  })

  test('handles single sample', () => {
    const collector = new MetricCollector([42])
    expect(collector.p50).toBe(42)
    expect(collector.p95).toBe(42)
    expect(collector.p99).toBe(42)
    expect(collector.min).toBe(42)
    expect(collector.max).toBe(42)
    expect(collector.avg).toBe(42)
  })

  test('returns metrics object', () => {
    const collector = new MetricCollector([1, 2, 3, 4, 5])
    const metrics = collector.toMetrics()
    expect(metrics).toEqual({
      p50: 3,
      p95: expect.any(Number),
      p99: expect.any(Number),
      min: 1,
      max: 5,
      avg: 3,
      stdDev: expect.any(Number),
      ci95: expect.objectContaining({
        lower: expect.any(Number),
        upper: expect.any(Number)
      })
    })
  })

  test('computes 95% confidence interval', () => {
    // For samples [1,2,3,4,5]: avg=3, stdDev~1.41
    // margin = 1.96 * (1.41 / sqrt(5)) ~ 1.24
    const collector = new MetricCollector([1, 2, 3, 4, 5])
    const ci = collector.confidenceInterval95
    expect(ci.lower).toBeLessThan(3)
    expect(ci.upper).toBeGreaterThan(3)
    expect(ci.upper - ci.lower).toBeGreaterThan(0) // non-zero interval
  })

  test('confidence interval collapses for single sample', () => {
    const collector = new MetricCollector([42])
    const ci = collector.confidenceInterval95
    expect(ci.lower).toBe(42)
    expect(ci.upper).toBe(42)
  })
})
