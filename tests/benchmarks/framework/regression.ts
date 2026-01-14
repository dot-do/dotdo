import type { BenchmarkResult } from './types'
import type { RegressionConfig, RegressionResult } from './regression-types'

export class RegressionDetector {
  private config: RegressionConfig

  constructor(config: RegressionConfig) {
    this.config = config
  }

  detect(baseline: BenchmarkResult[], current: BenchmarkResult[]): RegressionResult {
    const regressions: string[] = []
    const improvements: string[] = []
    const unchanged: string[] = []

    const baselineMap = new Map(baseline.map((r) => [r.name, r]))
    const changeMap = new Map<string, number>()

    for (const result of current) {
      const baselineResult = baselineMap.get(result.name)
      if (!baselineResult) continue

      const baselineP50 = baselineResult.metrics.latency.p50
      const currentP50 = result.metrics.latency.p50
      const change = (currentP50 - baselineP50) / baselineP50

      changeMap.set(result.name, change)

      if (change >= this.config.threshold) {
        regressions.push(result.name)
      } else if (change <= -this.config.threshold) {
        improvements.push(result.name)
      } else {
        unchanged.push(result.name)
      }
    }

    // Find worst regression
    let worstRegression: { name: string; change: number } | undefined
    for (const name of regressions) {
      const change = changeMap.get(name)!
      if (!worstRegression || change > worstRegression.change) {
        worstRegression = { name, change }
      }
    }

    // Find best improvement
    let bestImprovement: { name: string; change: number } | undefined
    for (const name of improvements) {
      const change = changeMap.get(name)!
      if (!bestImprovement || change < bestImprovement.change) {
        bestImprovement = { name, change }
      }
    }

    // Determine if CI should be blocked
    const blockThreshold = this.config.blockThreshold ?? this.config.threshold
    let shouldBlockCI = false

    if (worstRegression && worstRegression.change >= blockThreshold) {
      shouldBlockCI = true
    }

    return {
      regressions,
      improvements,
      unchanged,
      hasRegressions: regressions.length > 0,
      shouldBlockCI,
      worstRegression,
      bestImprovement
    }
  }

  generateSummary(baseline: BenchmarkResult[], current: BenchmarkResult[]): string {
    const result = this.detect(baseline, current)
    const baselineMap = new Map(baseline.map((r) => [r.name, r]))
    const lines: string[] = []

    lines.push(`Regressions: ${result.regressions.length}`)
    lines.push(`Improvements: ${result.improvements.length}`)
    lines.push(`Unchanged: ${result.unchanged.length}`)

    // Show details for regressions
    for (const name of result.regressions) {
      const baselineResult = baselineMap.get(name)!
      const currentResult = current.find((r) => r.name === name)!
      const change =
        (currentResult.metrics.latency.p50 - baselineResult.metrics.latency.p50) /
        baselineResult.metrics.latency.p50
      const pct = Math.round(change * 100)
      lines.push(`  ${name}: +${pct}%`)
    }

    // Show details for improvements
    for (const name of result.improvements) {
      const baselineResult = baselineMap.get(name)!
      const currentResult = current.find((r) => r.name === name)!
      const change =
        (currentResult.metrics.latency.p50 - baselineResult.metrics.latency.p50) /
        baselineResult.metrics.latency.p50
      const pct = Math.round(change * 100)
      lines.push(`  ${name}: ${pct}%`)
    }

    return lines.join('\n')
  }
}
