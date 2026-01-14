import { describe, test, expect } from 'vitest'
import { Reporter, BenchmarkResult } from './reporter'

describe('Reporter', () => {
  const sampleResult: BenchmarkResult = {
    name: 'DocumentStore.create',
    samples: [1, 2, 3, 4, 5],
    metrics: {
      latency: { p50: 3, p95: 5, p99: 5, min: 1, max: 5, avg: 3, stdDev: 1.41 },
      throughput: { opsPerSecond: 1000, bytesPerSecond: 0 },
      cost: { rowWrites: 100, rowReads: 0, storageBytes: 0, storageGb: 0, estimatedCost: 0.0001, breakdown: { writeCost: 0.0001, readCost: 0, storageCost: 0 } },
      resources: { peakMemoryMb: 10, storageBytesUsed: 1024 }
    },
    context: {
      store: 'document',
      operation: 'create',
      datasetSize: 100,
      iterations: 5,
      environment: 'local'
    }
  }

  test('generates markdown table', () => {
    const reporter = new Reporter()
    const md = reporter.toMarkdown([sampleResult])

    expect(md).toContain('| Name |')
    expect(md).toContain('| p50 |')
    expect(md).toContain('| DocumentStore.create |')
    expect(md).toContain('| 3 |')
  })

  test('generates markdown with alignment', () => {
    const reporter = new Reporter()
    const md = reporter.toMarkdown([sampleResult])

    // Check header separator has alignment
    expect(md).toMatch(/\|[\s:-]+\|/)
  })

  test('generates JSON output', () => {
    const reporter = new Reporter()
    const json = reporter.toJSON([sampleResult])

    const parsed = JSON.parse(json)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('DocumentStore.create')
    expect(parsed[0].metrics.latency.p50).toBe(3)
  })

  test('generates console output', () => {
    const reporter = new Reporter()
    const output = reporter.toConsole([sampleResult])

    expect(output).toContain('DocumentStore.create')
    expect(output).toContain('p50')
    expect(output).toContain('3')
  })

  test('generates summary section', () => {
    const reporter = new Reporter()
    const md = reporter.toMarkdown([sampleResult, sampleResult])

    expect(md).toContain('## Summary')
    expect(md).toContain('Total benchmarks: 2')
  })

  test('formats numbers with units', () => {
    const reporter = new Reporter()
    const output = reporter.toConsole([{
      ...sampleResult,
      metrics: {
        ...sampleResult.metrics,
        latency: { ...sampleResult.metrics.latency, p50: 1500 }
      }
    }])

    // Should format as 1.5s or 1500ms
    expect(output).toMatch(/1\.5s|1500ms/)
  })

  test('groups results by store', () => {
    const reporter = new Reporter()
    const results = [
      { ...sampleResult, context: { ...sampleResult.context, store: 'document' } },
      { ...sampleResult, context: { ...sampleResult.context, store: 'vector' } },
      { ...sampleResult, context: { ...sampleResult.context, store: 'document' } },
    ]

    const md = reporter.toMarkdown(results)
    expect(md).toContain('## DocumentStore')
    expect(md).toContain('## VectorStore')
  })

  test('handles empty results', () => {
    const reporter = new Reporter()
    const md = reporter.toMarkdown([])
    expect(md).toContain('No benchmark results')
  })
})
