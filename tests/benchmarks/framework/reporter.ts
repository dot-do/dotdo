import { BenchmarkResult } from './types'

export { BenchmarkResult }

export class Reporter {
  toMarkdown(results: BenchmarkResult[]): string {
    if (results.length === 0) {
      return '# Benchmark Results\n\nNo benchmark results\n'
    }

    const lines: string[] = ['# Benchmark Results\n']

    // Summary
    lines.push('## Summary')
    lines.push(`Total benchmarks: ${results.length}\n`)

    // Group by store
    const byStore = this.groupByStore(results)

    for (const [store, storeResults] of Object.entries(byStore)) {
      lines.push(`## ${this.formatStoreName(store)}`)
      lines.push('')
      lines.push('| Name | p50 | p95 | p99 | min | max | avg | ops/s | cost |')
      lines.push('|:-----|----:|----:|----:|----:|----:|----:|------:|-----:|')

      for (const result of storeResults) {
        const { latency, throughput, cost } = result.metrics
        lines.push(
          `| ${result.name} | ${latency.p50} | ${latency.p95} | ${latency.p99} | ${latency.min} | ${latency.max} | ${latency.avg} | ${Math.round(throughput.opsPerSecond)} | $${cost.estimatedCost.toFixed(4)} |`
        )
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  toJSON(results: BenchmarkResult[]): string {
    return JSON.stringify(results, null, 2)
  }

  toConsole(results: BenchmarkResult[]): string {
    if (results.length === 0) {
      return 'No benchmark results'
    }

    const lines: string[] = []

    for (const result of results) {
      const { latency } = result.metrics
      lines.push(`${result.name}`)
      lines.push(`  p50: ${this.formatMs(latency.p50)}  p95: ${this.formatMs(latency.p95)}  p99: ${this.formatMs(latency.p99)}`)
      lines.push(`  min: ${this.formatMs(latency.min)}  max: ${this.formatMs(latency.max)}  avg: ${this.formatMs(latency.avg)}`)
      lines.push('')
    }

    return lines.join('\n')
  }

  private formatMs(ms: number): string {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`
    }
    return `${ms}ms`
  }

  private formatStoreName(store: string): string {
    return store.charAt(0).toUpperCase() + store.slice(1) + 'Store'
  }

  private groupByStore(results: BenchmarkResult[]): Record<string, BenchmarkResult[]> {
    const grouped: Record<string, BenchmarkResult[]> = {}
    for (const result of results) {
      const store = result.context.store
      if (!grouped[store]) grouped[store] = []
      grouped[store].push(result)
    }
    return grouped
  }
}
