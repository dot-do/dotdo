import type { BenchmarkResult } from './types'

type ReportFormat = 'markdown' | 'json'

export class ReportGenerator {
  generate(
    results: BenchmarkResult[],
    format: ReportFormat,
    baseline?: BenchmarkResult[]
  ): string {
    if (format === 'json') {
      return this.generateJSON(results, baseline)
    } else if (format === 'markdown') {
      return this.generateMarkdown(results, baseline)
    } else {
      throw new Error(`Unknown format: ${format}`)
    }
  }

  private generateJSON(results: BenchmarkResult[], baseline?: BenchmarkResult[]): string {
    const report: {
      timestamp: string
      version: string
      results: BenchmarkResult[]
      comparison?: Record<string, { change: number }>
    } = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      results
    }

    if (baseline) {
      const baselineMap = new Map(baseline.map((r) => [r.name, r]))
      report.comparison = {}

      for (const result of results) {
        const baselineResult = baselineMap.get(result.name)
        if (baselineResult) {
          const change =
            (result.metrics.latency.p50 - baselineResult.metrics.latency.p50) /
            baselineResult.metrics.latency.p50
          report.comparison[result.name] = { change }
        }
      }
    }

    return JSON.stringify(report, null, 2)
  }

  private generateMarkdown(results: BenchmarkResult[], baseline?: BenchmarkResult[]): string {
    const lines: string[] = []
    const date = new Date().toISOString().split('T')[0]

    lines.push(`# Benchmark Report`)
    lines.push(``)
    lines.push(`Generated: ${date}`)
    lines.push(``)

    if (results.length === 0) {
      lines.push(`No benchmark results`)
      return lines.join('\n')
    }

    // Build baseline map if provided
    const baselineMap = baseline ? new Map(baseline.map((r) => [r.name, r])) : null

    // Group results by store
    const byStore = new Map<string, BenchmarkResult[]>()
    for (const result of results) {
      const store = result.context.store
      if (!byStore.has(store)) {
        byStore.set(store, [])
      }
      byStore.get(store)!.push(result)
    }

    // Generate table for each store
    for (const [store, storeResults] of byStore) {
      lines.push(`## ${store}`)
      lines.push(``)

      // Table header
      if (baselineMap) {
        lines.push(`| Name | p50 (ms) | p95 (ms) | Change |`)
        lines.push(`|:-----|--------:|---------:|-------:|`)
      } else {
        lines.push(`| Name | p50 (ms) | p95 (ms) |`)
        lines.push(`|:-----|--------:|---------:|`)
      }

      // Table rows
      for (const result of storeResults) {
        const p50 = result.metrics.latency.p50
        const p95 = result.metrics.latency.p95

        if (baselineMap) {
          const baselineResult = baselineMap.get(result.name)
          if (baselineResult) {
            const change =
              (p50 - baselineResult.metrics.latency.p50) / baselineResult.metrics.latency.p50
            const pct = Math.round(change * 100)
            const changeStr = pct >= 0 ? `+${pct}%` : `${pct}%`
            lines.push(`| ${result.name} | ${p50} | ${p95} | ${changeStr} |`)
          } else {
            lines.push(`| ${result.name} | ${p50} | ${p95} | N/A |`)
          }
        } else {
          lines.push(`| ${result.name} | ${p50} | ${p95} |`)
        }
      }

      lines.push(``)
    }

    // Summary section
    lines.push(`## Summary`)
    lines.push(``)
    lines.push(`Total benchmarks: ${results.length}`)

    // Calculate average
    const avgP50 =
      results.reduce((sum, r) => sum + r.metrics.latency.p50, 0) / results.length
    lines.push(`Average p50: ${avgP50}ms`)

    // Find slowest and fastest
    let slowest = results[0]
    let fastest = results[0]
    for (const result of results) {
      if (result.metrics.latency.p50 > slowest.metrics.latency.p50) {
        slowest = result
      }
      if (result.metrics.latency.p50 < fastest.metrics.latency.p50) {
        fastest = result
      }
    }
    lines.push(`Slowest: ${slowest.name} (${slowest.metrics.latency.p50}ms)`)
    lines.push(`Fastest: ${fastest.name} (${fastest.metrics.latency.p50}ms)`)

    return lines.join('\n')
  }
}
