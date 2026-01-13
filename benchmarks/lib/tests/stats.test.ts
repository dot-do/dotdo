import { describe, it, expect } from 'vitest'
import { calculateStats, type LatencyStats } from '../stats'

describe('calculateStats', () => {
  it('should calculate correct p50 for odd number of samples', () => {
    const samples = [10, 20, 30, 40, 50]
    const stats = calculateStats(samples)
    expect(stats.p50).toBe(30)
  })

  it('should calculate correct p50 for even number of samples', () => {
    const samples = [10, 20, 30, 40]
    const stats = calculateStats(samples)
    // p50 for even samples: interpolate between middle two
    expect(stats.p50).toBe(25)
  })

  it('should calculate correct p95', () => {
    // 100 samples from 1 to 100
    const samples = Array.from({ length: 100 }, (_, i) => i + 1)
    const stats = calculateStats(samples)
    // p95 of 1-100 should be around 95
    expect(stats.p95).toBeGreaterThanOrEqual(95)
    expect(stats.p95).toBeLessThanOrEqual(96)
  })

  it('should calculate correct p99', () => {
    // 100 samples from 1 to 100
    const samples = Array.from({ length: 100 }, (_, i) => i + 1)
    const stats = calculateStats(samples)
    // p99 of 1-100 should be around 99
    expect(stats.p99).toBeGreaterThanOrEqual(99)
    expect(stats.p99).toBeLessThanOrEqual(100)
  })

  it('should calculate correct min and max', () => {
    const samples = [100, 50, 200, 25, 75]
    const stats = calculateStats(samples)
    expect(stats.min).toBe(25)
    expect(stats.max).toBe(200)
  })

  it('should calculate correct mean', () => {
    const samples = [10, 20, 30, 40, 50]
    const stats = calculateStats(samples)
    expect(stats.mean).toBe(30)
  })

  it('should calculate correct stddev', () => {
    // Standard deviation of [2, 4, 4, 4, 5, 5, 7, 9] is 2
    const samples = [2, 4, 4, 4, 5, 5, 7, 9]
    const stats = calculateStats(samples)
    expect(stats.stddev).toBeCloseTo(2, 1)
  })

  it('should handle single sample', () => {
    const samples = [42]
    const stats = calculateStats(samples)
    expect(stats.p50).toBe(42)
    expect(stats.p95).toBe(42)
    expect(stats.p99).toBe(42)
    expect(stats.min).toBe(42)
    expect(stats.max).toBe(42)
    expect(stats.mean).toBe(42)
    expect(stats.stddev).toBe(0)
  })

  it('should throw on empty samples', () => {
    expect(() => calculateStats([])).toThrow()
  })

  it('should handle unsorted input', () => {
    const samples = [50, 10, 40, 20, 30]
    const stats = calculateStats(samples)
    expect(stats.p50).toBe(30)
    expect(stats.min).toBe(10)
    expect(stats.max).toBe(50)
  })

  it('should return all required fields', () => {
    const samples = [10, 20, 30]
    const stats = calculateStats(samples)
    expect(stats).toHaveProperty('p50')
    expect(stats).toHaveProperty('p95')
    expect(stats).toHaveProperty('p99')
    expect(stats).toHaveProperty('min')
    expect(stats).toHaveProperty('max')
    expect(stats).toHaveProperty('mean')
    expect(stats).toHaveProperty('stddev')
  })

  it('should handle large sample sizes efficiently', () => {
    const samples = Array.from({ length: 10000 }, () => Math.random() * 1000)
    const start = performance.now()
    const stats = calculateStats(samples)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100) // Should complete in under 100ms
    expect(stats.min).toBeGreaterThanOrEqual(0)
    expect(stats.max).toBeLessThanOrEqual(1000)
  })

  it('should handle samples with same values', () => {
    const samples = [42, 42, 42, 42, 42]
    const stats = calculateStats(samples)
    expect(stats.p50).toBe(42)
    expect(stats.p95).toBe(42)
    expect(stats.p99).toBe(42)
    expect(stats.min).toBe(42)
    expect(stats.max).toBe(42)
    expect(stats.mean).toBe(42)
    expect(stats.stddev).toBe(0)
  })
})
