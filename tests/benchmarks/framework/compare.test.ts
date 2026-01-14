import { describe, test, expect } from 'vitest'
import { Comparator } from './compare'
import type { BenchmarkResult } from './types'

describe('Comparator', () => {
  const createResult = (
    name: string,
    p50: number,
    env: 'local' | 'remote'
  ): BenchmarkResult => ({
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
      environment: env
    }
  })

  describe('Table Generation', () => {
    test('generates local vs remote comparison table', () => {
      const local = [
        createResult('DocumentStore.create', 2, 'local'),
        createResult('DocumentStore.read', 1, 'local')
      ]
      const remote = [
        createResult('DocumentStore.create', 5, 'remote'),
        createResult('DocumentStore.read', 3, 'remote')
      ]

      const comparator = new Comparator()
      const table = comparator.generateTable(local, remote)

      expect(table).toContain('| Operation |')
      expect(table).toContain('| Local p50 |')
      expect(table).toContain('| Remote p50 |')
      expect(table).toContain('DocumentStore.create')
      expect(table).toContain('2')
      expect(table).toContain('5')
    })

    test('includes diff column', () => {
      const local = [createResult('test', 2, 'local')]
      const remote = [createResult('test', 4, 'remote')]

      const comparator = new Comparator()
      const table = comparator.generateTable(local, remote)

      expect(table).toContain('| Diff |')
      expect(table).toContain('+100%') // Remote is 2x slower
    })

    test('shows negative diff for improvements', () => {
      const local = [createResult('test', 10, 'local')]
      const remote = [createResult('test', 5, 'remote')]

      const comparator = new Comparator()
      const table = comparator.generateTable(local, remote)

      expect(table).toContain('-50%') // Remote is 50% faster
    })

    test('handles missing remote result', () => {
      const local = [
        createResult('exists', 5, 'local'),
        createResult('missing', 10, 'local')
      ]
      const remote = [createResult('exists', 6, 'remote')]

      const comparator = new Comparator()
      const table = comparator.generateTable(local, remote)

      expect(table).toContain('exists')
      expect(table).toContain('missing')
      expect(table).toContain('N/A') // Missing remote
    })

    test('includes all metrics columns', () => {
      const local = [createResult('test', 5, 'local')]
      const remote = [createResult('test', 6, 'remote')]

      const comparator = new Comparator()
      const table = comparator.generateTable(local, remote, { includeP95: true, includeP99: true })

      expect(table).toContain('| p95 Local |')
      expect(table).toContain('| p95 Remote |')
      expect(table).toContain('| p99 Local |')
      expect(table).toContain('| p99 Remote |')
    })
  })

  describe('Significance Detection', () => {
    test('detects significant regression (>20%)', () => {
      const local = [createResult('test', 10, 'local')]
      const remote = [createResult('test', 15, 'remote')] // 50% slower

      const comparator = new Comparator()
      const result = comparator.compare(local, remote)

      expect(result.significant).toBe(true)
      expect(result.regressions).toContain('test')
    })

    test('detects significant improvement (>20%)', () => {
      const local = [createResult('test', 10, 'local')]
      const remote = [createResult('test', 5, 'remote')] // 50% faster

      const comparator = new Comparator()
      const result = comparator.compare(local, remote)

      expect(result.significant).toBe(true)
      expect(result.improvements).toContain('test')
    })

    test('ignores minor differences (<20%)', () => {
      const local = [createResult('test', 10, 'local')]
      const remote = [createResult('test', 11, 'remote')] // 10% slower

      const comparator = new Comparator()
      const result = comparator.compare(local, remote)

      expect(result.significant).toBe(false)
      expect(result.regressions).toHaveLength(0)
      expect(result.improvements).toHaveLength(0)
    })

    test('allows custom threshold', () => {
      const local = [createResult('test', 10, 'local')]
      const remote = [createResult('test', 11, 'remote')] // 10% slower

      const comparator = new Comparator({ threshold: 0.05 }) // 5% threshold
      const result = comparator.compare(local, remote)

      expect(result.significant).toBe(true)
      expect(result.regressions).toContain('test')
    })

    test('classifies unchanged correctly', () => {
      const local = [
        createResult('stable', 10, 'local'),
        createResult('improved', 10, 'local'),
        createResult('regressed', 10, 'local')
      ]
      const remote = [
        createResult('stable', 10.5, 'remote'), // 5% - unchanged
        createResult('improved', 7, 'remote'), // 30% faster
        createResult('regressed', 15, 'remote') // 50% slower
      ]

      const comparator = new Comparator()
      const result = comparator.compare(local, remote)

      expect(result.unchanged).toContain('stable')
      expect(result.improvements).toContain('improved')
      expect(result.regressions).toContain('regressed')
    })
  })

  describe('Summary', () => {
    test('generates comparison summary', () => {
      const local = [
        createResult('fast', 2, 'local'),
        createResult('slow', 10, 'local'),
        createResult('same', 5, 'local')
      ]
      const remote = [
        createResult('fast', 2, 'remote'),
        createResult('slow', 20, 'remote'), // Regression
        createResult('same', 5, 'remote')
      ]

      const comparator = new Comparator()
      const summary = comparator.summarize(local, remote)

      expect(summary).toContain('Total: 3')
      expect(summary).toContain('Regressions: 1')
      expect(summary).toContain('Improvements: 0')
    })

    test('includes percentage breakdown', () => {
      const local = [
        createResult('a', 10, 'local'),
        createResult('b', 10, 'local'),
        createResult('c', 10, 'local'),
        createResult('d', 10, 'local')
      ]
      const remote = [
        createResult('a', 15, 'remote'), // Regression 50%
        createResult('b', 5, 'remote'), // Improvement 50%
        createResult('c', 10, 'remote'), // Unchanged
        createResult('d', 10.5, 'remote') // Unchanged (5%)
      ]

      const comparator = new Comparator()
      const summary = comparator.summarize(local, remote)

      expect(summary).toContain('25%') // 1/4 regressions
    })

    test('highlights worst regression', () => {
      const local = [
        createResult('minor', 10, 'local'),
        createResult('major', 10, 'local')
      ]
      const remote = [
        createResult('minor', 12, 'remote'), // 20%
        createResult('major', 25, 'remote') // 150%
      ]

      const comparator = new Comparator()
      const summary = comparator.summarize(local, remote)

      expect(summary).toContain('major')
      expect(summary).toContain('150%') // Worst regression
    })

    test('highlights best improvement', () => {
      const local = [
        createResult('minor', 10, 'local'),
        createResult('major', 10, 'local')
      ]
      const remote = [
        createResult('minor', 8, 'remote'), // 20% faster
        createResult('major', 3, 'remote') // 70% faster
      ]

      const comparator = new Comparator()
      const summary = comparator.summarize(local, remote)

      expect(summary).toContain('major')
      expect(summary).toContain('70%') // Best improvement
    })
  })

  describe('Edge Cases', () => {
    test('handles empty results', () => {
      const comparator = new Comparator()
      const result = comparator.compare([], [])

      expect(result.significant).toBe(false)
      expect(result.regressions).toHaveLength(0)
      expect(result.improvements).toHaveLength(0)
      expect(result.unchanged).toHaveLength(0)
    })

    test('handles single result', () => {
      const local = [createResult('test', 10, 'local')]
      const remote = [createResult('test', 12, 'remote')]

      const comparator = new Comparator()
      const result = comparator.compare(local, remote)

      expect(result.unchanged).toContain('test') // 20% is borderline
    })

    test('handles mismatched result names', () => {
      const local = [createResult('local-only', 10, 'local')]
      const remote = [createResult('remote-only', 10, 'remote')]

      const comparator = new Comparator()
      const result = comparator.compare(local, remote)

      // Should still work, just nothing to compare
      expect(result.unchanged).toHaveLength(0)
    })

    test('handles zero latency gracefully', () => {
      const local = [createResult('zero', 0.001, 'local')]
      const remote = [createResult('zero', 0.002, 'remote')]

      const comparator = new Comparator()

      // Should not throw
      expect(() => comparator.compare(local, remote)).not.toThrow()
    })
  })
})
