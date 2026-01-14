import { describe, test, expect } from 'vitest'
import { ReportGenerator } from './report-generator'
import type { BenchmarkResult } from './types'

describe('ReportGenerator', () => {
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

  describe('Markdown Generation', () => {
    test('produces valid markdown', () => {
      const results = [mockResult('test', 5)]
      const generator = new ReportGenerator()

      const markdown = generator.generate(results, 'markdown')

      expect(markdown).toContain('# Benchmark Report')
      expect(markdown).toContain('|')
      expect(markdown).toMatch(/\| test \|/)
    })

    test('includes date header', () => {
      const results = [mockResult('test', 5)]
      const generator = new ReportGenerator()

      const markdown = generator.generate(results, 'markdown')

      expect(markdown).toMatch(/\d{4}-\d{2}-\d{2}/)
    })

    test('includes baseline comparison when provided', () => {
      const current = [mockResult('test', 10)]
      const baseline = [mockResult('test', 5)]
      const generator = new ReportGenerator()

      const markdown = generator.generate(current, 'markdown', baseline)

      expect(markdown).toContain('Change')
      expect(markdown).toContain('+100%')
    })

    test('shows negative percentage for improvements', () => {
      const current = [mockResult('test', 5)]
      const baseline = [mockResult('test', 10)]
      const generator = new ReportGenerator()

      const markdown = generator.generate(current, 'markdown', baseline)

      expect(markdown).toContain('-50%')
    })

    test('handles missing baseline gracefully', () => {
      const current = [mockResult('test', 5)]
      const generator = new ReportGenerator()

      const markdown = generator.generate(current, 'markdown')

      // Should still produce valid report without comparison
      expect(markdown).toContain('# Benchmark Report')
      expect(markdown).not.toContain('Change')
    })

    test('groups results by store', () => {
      const results = [
        { ...mockResult('doc-test', 5), context: { ...mockResult('doc-test', 5).context, store: 'document' } },
        { ...mockResult('vec-test', 5), context: { ...mockResult('vec-test', 5).context, store: 'vector' } }
      ]
      const generator = new ReportGenerator()

      const markdown = generator.generate(results, 'markdown')

      expect(markdown).toContain('document')
      expect(markdown).toContain('vector')
    })
  })

  describe('JSON Generation', () => {
    test('produces valid JSON', () => {
      const results = [mockResult('test', 5)]
      const generator = new ReportGenerator()

      const json = generator.generate(results, 'json')

      expect(() => JSON.parse(json)).not.toThrow()
    })

    test('includes all result fields', () => {
      const results = [mockResult('test', 5)]
      const generator = new ReportGenerator()

      const json = generator.generate(results, 'json')
      const parsed = JSON.parse(json)

      expect(parsed.results).toHaveLength(1)
      expect(parsed.results[0].name).toBe('test')
      expect(parsed.results[0].metrics.latency.p50).toBe(5)
    })

    test('includes metadata', () => {
      const results = [mockResult('test', 5)]
      const generator = new ReportGenerator()

      const json = generator.generate(results, 'json')
      const parsed = JSON.parse(json)

      expect(parsed.timestamp).toBeDefined()
      expect(parsed.version).toBeDefined()
    })

    test('includes baseline comparison in JSON when provided', () => {
      const current = [mockResult('test', 10)]
      const baseline = [mockResult('test', 5)]
      const generator = new ReportGenerator()

      const json = generator.generate(current, 'json', baseline)
      const parsed = JSON.parse(json)

      expect(parsed.comparison).toBeDefined()
      expect(parsed.comparison.test.change).toBe(1.0) // +100%
    })
  })

  describe('Summary Statistics', () => {
    test('includes summary section', () => {
      const results = [
        mockResult('test1', 5),
        mockResult('test2', 10),
        mockResult('test3', 15)
      ]
      const generator = new ReportGenerator()

      const markdown = generator.generate(results, 'markdown')

      expect(markdown).toContain('Summary')
      expect(markdown).toContain('Total benchmarks: 3')
    })

    test('calculates average latency', () => {
      const results = [
        mockResult('test1', 5),
        mockResult('test2', 10),
        mockResult('test3', 15)
      ]
      const generator = new ReportGenerator()

      const markdown = generator.generate(results, 'markdown')

      // Average of 5, 10, 15 = 10
      expect(markdown).toContain('Average p50: 10')
    })

    test('identifies slowest benchmark', () => {
      const results = [
        mockResult('fast', 2),
        mockResult('slow', 20),
        mockResult('medium', 10)
      ]
      const generator = new ReportGenerator()

      const markdown = generator.generate(results, 'markdown')

      expect(markdown).toContain('Slowest: slow')
    })

    test('identifies fastest benchmark', () => {
      const results = [
        mockResult('fast', 2),
        mockResult('slow', 20),
        mockResult('medium', 10)
      ]
      const generator = new ReportGenerator()

      const markdown = generator.generate(results, 'markdown')

      expect(markdown).toContain('Fastest: fast')
    })
  })

  describe('Regression Highlights', () => {
    test('highlights regressions when baseline provided', () => {
      const current = [
        mockResult('regressed', 10),
        mockResult('same', 5)
      ]
      const baseline = [
        mockResult('regressed', 5), // +100%
        mockResult('same', 5) // 0%
      ]
      const generator = new ReportGenerator()

      const markdown = generator.generate(current, 'markdown', baseline)

      // Should flag the regression
      expect(markdown).toContain('regressed')
    })

    test('highlights improvements when baseline provided', () => {
      const current = [
        mockResult('improved', 5),
        mockResult('same', 10)
      ]
      const baseline = [
        mockResult('improved', 10), // -50%
        mockResult('same', 10) // 0%
      ]
      const generator = new ReportGenerator()

      const markdown = generator.generate(current, 'markdown', baseline)

      expect(markdown).toContain('improved')
    })
  })

  describe('Edge Cases', () => {
    test('handles empty results', () => {
      const generator = new ReportGenerator()

      const markdown = generator.generate([], 'markdown')

      expect(markdown).toContain('No benchmark results')
    })

    test('handles single result', () => {
      const results = [mockResult('single', 5)]
      const generator = new ReportGenerator()

      const markdown = generator.generate(results, 'markdown')

      expect(markdown).toContain('single')
      expect(markdown).toContain('Total benchmarks: 1')
    })

    test('handles unknown format gracefully', () => {
      const results = [mockResult('test', 5)]
      const generator = new ReportGenerator()

      // Should default to markdown or throw meaningful error
      expect(() => {
        generator.generate(results, 'unknown' as 'markdown' | 'json')
      }).toThrow()
    })
  })
})
