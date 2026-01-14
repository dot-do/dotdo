import { describe, test, expect } from 'vitest'
import { RegressionDetector } from './regression'
import type { RegressionResult } from './regression-types'
import type { BenchmarkResult } from './types'

describe('RegressionDetector', () => {
  const mockResult = (name: string, p50: number): BenchmarkResult => ({
    name,
    samples: [p50],
    metrics: {
      latency: {
        p50,
        p95: p50 * 1.5,
        p99: p50 * 2,
        min: p50 * 0.5,
        max: p50 * 2.5,
        avg: p50,
        stdDev: 1
      },
      throughput: { opsPerSecond: 1000 / p50, bytesPerSecond: 0 },
      cost: {
        rowWrites: 1,
        rowReads: 0,
        storageBytes: 0,
        storageGb: 0,
        estimatedCost: 0.000001,
        breakdown: { writeCost: 0.000001, readCost: 0, storageCost: 0 }
      },
      resources: { peakMemoryMb: 10, storageBytesUsed: 1024 }
    },
    context: {
      name,
      store: 'document',
      operation: 'create',
      datasetSize: 100,
      iterations: 10,
      environment: 'local'
    }
  })

  describe('Finding Regressions', () => {
    test('detects regression when threshold exceeded', () => {
      const baseline = [mockResult('test', 5)]
      const current = [mockResult('test', 10)] // +100%

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      expect(result.regressions).toContain('test')
      expect(result.hasRegressions).toBe(true)
    })

    test('ignores regression below threshold', () => {
      const baseline = [mockResult('test', 5)]
      const current = [mockResult('test', 5.5)] // +10%

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      expect(result.regressions).not.toContain('test')
      expect(result.hasRegressions).toBe(false)
    })

    test('supports custom threshold', () => {
      const baseline = [mockResult('test', 5)]
      const current = [mockResult('test', 5.5)] // +10%

      const detector = new RegressionDetector({ threshold: 0.05 })
      const result = detector.detect(baseline, current)

      expect(result.regressions).toContain('test')
    })

    test('detects multiple regressions', () => {
      const baseline = [
        mockResult('test1', 5),
        mockResult('test2', 10),
        mockResult('test3', 15)
      ]
      const current = [
        mockResult('test1', 10), // +100% - regression
        mockResult('test2', 10), // 0% - unchanged
        mockResult('test3', 25) // +67% - regression
      ]

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      expect(result.regressions).toHaveLength(2)
      expect(result.regressions).toContain('test1')
      expect(result.regressions).toContain('test3')
    })

    test('handles exact threshold boundary as regression', () => {
      const baseline = [mockResult('test', 10)]
      const current = [mockResult('test', 12)] // exactly +20%

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      // Exact threshold should count as regression (>=)
      expect(result.regressions).toContain('test')
    })
  })

  describe('Finding Improvements', () => {
    test('detects improvement when threshold exceeded', () => {
      const baseline = [mockResult('test', 10)]
      const current = [mockResult('test', 5)] // -50%

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      expect(result.improvements).toContain('test')
    })

    test('ignores improvement below threshold', () => {
      const baseline = [mockResult('test', 5)]
      const current = [mockResult('test', 4.5)] // -10%

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      expect(result.improvements).not.toContain('test')
    })

    test('classifies unchanged correctly', () => {
      const baseline = [mockResult('test', 10)]
      const current = [mockResult('test', 10.5)] // +5%

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      expect(result.unchanged).toContain('test')
    })
  })

  describe('Summary Generation', () => {
    test('generates human-readable summary', () => {
      const baseline = [
        mockResult('fast', 5),
        mockResult('slow', 5),
        mockResult('same', 5)
      ]
      const current = [
        mockResult('fast', 2.5), // Improved
        mockResult('slow', 10), // Regressed
        mockResult('same', 5) // Same
      ]

      const detector = new RegressionDetector({ threshold: 0.2 })
      const summary = detector.generateSummary(baseline, current)

      expect(summary).toContain('Regressions: 1')
      expect(summary).toContain('Improvements: 1')
      expect(summary).toContain('slow')
      expect(summary).toContain('fast')
    })

    test('includes percentage changes in summary', () => {
      const baseline = [mockResult('test', 5)]
      const current = [mockResult('test', 10)]

      const detector = new RegressionDetector({ threshold: 0.2 })
      const summary = detector.generateSummary(baseline, current)

      expect(summary).toContain('+100%')
    })

    test('shows negative percentages for improvements', () => {
      const baseline = [mockResult('test', 10)]
      const current = [mockResult('test', 5)]

      const detector = new RegressionDetector({ threshold: 0.2 })
      const summary = detector.generateSummary(baseline, current)

      expect(summary).toContain('-50%')
    })

    test('handles empty results gracefully', () => {
      const detector = new RegressionDetector({ threshold: 0.2 })
      const summary = detector.generateSummary([], [])

      expect(summary).toContain('Regressions: 0')
      expect(summary).toContain('Improvements: 0')
    })
  })

  describe('CI Integration', () => {
    test('shouldBlockCI returns true for regressions above threshold', () => {
      const baseline = [mockResult('test', 5)]
      const current = [mockResult('test', 10)]

      const detector = new RegressionDetector({
        threshold: 0.2,
        blockThreshold: 0.2
      })
      const result = detector.detect(baseline, current)

      expect(result.shouldBlockCI).toBe(true)
    })

    test('shouldBlockCI returns false when no regressions', () => {
      const baseline = [mockResult('test', 5)]
      const current = [mockResult('test', 5)]

      const detector = new RegressionDetector({
        threshold: 0.2,
        blockThreshold: 0.2
      })
      const result = detector.detect(baseline, current)

      expect(result.shouldBlockCI).toBe(false)
    })

    test('uses separate blockThreshold when specified', () => {
      const baseline = [mockResult('test', 5)]
      const current = [mockResult('test', 7)] // +40%

      // Regression threshold 20%, but CI block at 50%
      const detector = new RegressionDetector({
        threshold: 0.2,
        blockThreshold: 0.5
      })
      const result = detector.detect(baseline, current)

      expect(result.hasRegressions).toBe(true) // 40% > 20%
      expect(result.shouldBlockCI).toBe(false) // 40% < 50%
    })

    test('tracks worst regression', () => {
      const baseline = [
        mockResult('minor', 10),
        mockResult('major', 10)
      ]
      const current = [
        mockResult('minor', 15), // +50%
        mockResult('major', 25) // +150%
      ]

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      expect(result.worstRegression).toBeDefined()
      expect(result.worstRegression?.name).toBe('major')
      expect(result.worstRegression?.change).toBe(1.5) // +150%
    })

    test('tracks best improvement', () => {
      const baseline = [
        mockResult('minor', 10),
        mockResult('major', 10)
      ]
      const current = [
        mockResult('minor', 8), // -20%
        mockResult('major', 3) // -70%
      ]

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      expect(result.bestImprovement).toBeDefined()
      expect(result.bestImprovement?.name).toBe('major')
      expect(result.bestImprovement?.change).toBe(-0.7) // -70%
    })
  })

  describe('Edge Cases', () => {
    test('handles mismatched benchmark names', () => {
      const baseline = [mockResult('old', 5)]
      const current = [mockResult('new', 10)]

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      // No matching names, nothing to compare
      expect(result.regressions).toHaveLength(0)
      expect(result.improvements).toHaveLength(0)
      expect(result.unchanged).toHaveLength(0)
    })

    test('handles zero baseline latency', () => {
      const baseline = [mockResult('test', 0.001)]
      const current = [mockResult('test', 0.002)]

      const detector = new RegressionDetector({ threshold: 0.2 })

      // Should not throw
      expect(() => detector.detect(baseline, current)).not.toThrow()
    })

    test('handles identical results', () => {
      const baseline = [mockResult('test', 5)]
      const current = [mockResult('test', 5)]

      const detector = new RegressionDetector({ threshold: 0.2 })
      const result = detector.detect(baseline, current)

      expect(result.unchanged).toContain('test')
      expect(result.hasRegressions).toBe(false)
    })
  })
})
