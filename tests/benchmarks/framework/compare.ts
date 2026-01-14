import type { BenchmarkResult } from './types'

export interface ComparisonResult {
  significant: boolean
  regressions: string[]
  improvements: string[]
  unchanged: string[]
}

export interface ComparatorConfig {
  threshold?: number
}

export interface TableOptions {
  includeP95?: boolean
  includeP99?: boolean
}

export class Comparator {
  private threshold: number

  constructor(config: ComparatorConfig = {}) {
    this.threshold = config.threshold ?? 0.2
  }

  generateTable(
    local: BenchmarkResult[],
    remote: BenchmarkResult[],
    options: TableOptions = {}
  ): string {
    const lines: string[] = []
    const remoteMap = new Map(remote.map((r) => [r.name, r]))

    // Build header
    const headerCells = ['| Operation |', '| Local p50 |', '| Remote p50 |', '| Diff |']
    const alignCells = ['|:----------|', '----------:|', '-----------:|', '-----:|']

    if (options.includeP95) {
      headerCells.push('| p95 Local |', '| p95 Remote |')
      alignCells.push('-----------:|', '------------:|')
    }
    if (options.includeP99) {
      headerCells.push('| p99 Local |', '| p99 Remote |')
      alignCells.push('-----------:|', '------------:|')
    }

    lines.push(headerCells.join(' '))
    lines.push(alignCells.join(' '))

    for (const localResult of local) {
      const remoteResult = remoteMap.get(localResult.name)
      const localP50 = localResult.metrics.latency.p50

      const rowCells: string[] = [`| ${localResult.name}`]

      if (remoteResult) {
        const remoteP50 = remoteResult.metrics.latency.p50
        const diff = ((remoteP50 - localP50) / localP50) * 100
        const diffStr = diff >= 0 ? `+${diff.toFixed(0)}%` : `${diff.toFixed(0)}%`
        rowCells.push(`| ${localP50}ms`, `| ${remoteP50}ms`, `| ${diffStr}`)

        if (options.includeP95) {
          rowCells.push(
            `| ${localResult.metrics.latency.p95}ms`,
            `| ${remoteResult.metrics.latency.p95}ms`
          )
        }
        if (options.includeP99) {
          rowCells.push(
            `| ${localResult.metrics.latency.p99}ms`,
            `| ${remoteResult.metrics.latency.p99}ms`
          )
        }
      } else {
        rowCells.push(`| ${localP50}ms`, '| N/A', '| N/A')

        if (options.includeP95) {
          rowCells.push(`| ${localResult.metrics.latency.p95}ms`, '| N/A')
        }
        if (options.includeP99) {
          rowCells.push(`| ${localResult.metrics.latency.p99}ms`, '| N/A')
        }
      }

      rowCells.push('|')
      lines.push(rowCells.join(' '))
    }

    return lines.join('\n')
  }

  compare(local: BenchmarkResult[], remote: BenchmarkResult[]): ComparisonResult {
    const regressions: string[] = []
    const improvements: string[] = []
    const unchanged: string[] = []

    const remoteMap = new Map(remote.map((r) => [r.name, r]))

    for (const localResult of local) {
      const remoteResult = remoteMap.get(localResult.name)
      if (!remoteResult) continue

      const localP50 = localResult.metrics.latency.p50
      const remoteP50 = remoteResult.metrics.latency.p50
      const diff = (remoteP50 - localP50) / localP50

      if (diff > this.threshold) {
        regressions.push(localResult.name)
      } else if (diff < -this.threshold) {
        improvements.push(localResult.name)
      } else {
        unchanged.push(localResult.name)
      }
    }

    return {
      significant: regressions.length > 0 || improvements.length > 0,
      regressions,
      improvements,
      unchanged
    }
  }

  summarize(local: BenchmarkResult[], remote: BenchmarkResult[]): string {
    const result = this.compare(local, remote)
    const total = local.length
    const remoteMap = new Map(remote.map((r) => [r.name, r]))

    const lines = [
      `Total: ${total}`,
      `Regressions: ${result.regressions.length}`,
      `Improvements: ${result.improvements.length}`,
      `Unchanged: ${result.unchanged.length}`
    ]

    // Add percentage breakdown if there's more than one item
    if (total > 0) {
      const regressionPct = Math.round((result.regressions.length / total) * 100)
      const improvementPct = Math.round((result.improvements.length / total) * 100)
      const unchangedPct = Math.round((result.unchanged.length / total) * 100)

      // Include percentage if any category has items
      if (result.regressions.length > 0 && regressionPct > 0) {
        lines.push(`${regressionPct}% regressed`)
      }
      if (result.improvements.length > 0 && improvementPct > 0) {
        lines.push(`${improvementPct}% improved`)
      }
    }

    if (result.regressions.length > 0) {
      // Find worst regression
      let worstName = ''
      let worstDiff = 0

      for (const name of result.regressions) {
        const localResult = local.find((r) => r.name === name)!
        const remoteResult = remoteMap.get(name)!
        const diff =
          (remoteResult.metrics.latency.p50 - localResult.metrics.latency.p50) /
          localResult.metrics.latency.p50
        if (diff > worstDiff) {
          worstDiff = diff
          worstName = name
        }
      }

      lines.push(`Worst regression: ${worstName} (+${(worstDiff * 100).toFixed(0)}%)`)
    }

    if (result.improvements.length > 0) {
      let bestName = ''
      let bestDiff = 0

      for (const name of result.improvements) {
        const localResult = local.find((r) => r.name === name)!
        const remoteResult = remoteMap.get(name)!
        const diff =
          (localResult.metrics.latency.p50 - remoteResult.metrics.latency.p50) /
          localResult.metrics.latency.p50
        if (diff > bestDiff) {
          bestDiff = diff
          bestName = name
        }
      }

      lines.push(`Best improvement: ${bestName} (-${(bestDiff * 100).toFixed(0)}%)`)
    }

    return lines.join('\n')
  }
}
