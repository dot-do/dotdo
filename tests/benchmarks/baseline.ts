/**
 * Baseline Management
 *
 * Utilities for storing, loading, and managing baseline metrics.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import type {
  BaselineMetrics,
  BenchmarkMetrics,
  ThresholdConfig,
  ComparisonResult,
  ComparisonReport,
} from './types'
import { DEFAULT_THRESHOLD_CONFIG } from './types'

/** Default path for baseline file */
export const DEFAULT_BASELINE_PATH = join(
  process.cwd(),
  'tests/benchmarks/benchmarks.json'
)

/**
 * Load baseline metrics from file
 */
export async function loadBaseline(
  path: string = DEFAULT_BASELINE_PATH
): Promise<BaselineMetrics | null> {
  try {
    if (!existsSync(path)) {
      return null
    }
    const content = await readFile(path, 'utf-8')
    return JSON.parse(content) as BaselineMetrics
  } catch (error) {
    console.warn(`Failed to load baseline from ${path}:`, error)
    return null
  }
}

/**
 * Save baseline metrics to file
 */
export async function saveBaseline(
  metrics: Record<string, BenchmarkMetrics>,
  version: string,
  path: string = DEFAULT_BASELINE_PATH
): Promise<void> {
  const baseline: BaselineMetrics = {
    version,
    capturedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    benchmarks: metrics,
  }

  // Ensure directory exists
  const dir = dirname(path)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  await writeFile(path, JSON.stringify(baseline, null, 2), 'utf-8')
}

/**
 * Compare current metrics against baseline
 */
export function compareMetrics(
  current: BenchmarkMetrics,
  baseline: BenchmarkMetrics | undefined,
  config: ThresholdConfig = DEFAULT_THRESHOLD_CONFIG
): ComparisonResult {
  const benchmarkConfig = config.thresholds?.[current.name]
  const threshold =
    benchmarkConfig?.regressionThreshold ?? config.defaultRegressionThreshold
  const isCritical = benchmarkConfig?.critical ?? true

  if (!baseline) {
    return {
      name: current.name,
      current,
      baseline: undefined,
      percentChange: 0,
      isRegression: false,
      isCritical,
      summary: `${current.name}: No baseline available (mean: ${current.mean.toFixed(3)}ms)`,
    }
  }

  // Calculate percentage change (positive = slower = regression)
  const percentChange = ((current.mean - baseline.mean) / baseline.mean) * 100
  const isRegression = percentChange > threshold

  // Build summary
  let status: string
  if (isRegression) {
    status = `REGRESSION (+${percentChange.toFixed(1)}%)`
  } else if (percentChange < -threshold) {
    status = `IMPROVEMENT (${percentChange.toFixed(1)}%)`
  } else {
    status = `OK (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%)`
  }

  const summary = [
    `${current.name}: ${status}`,
    `  Current: ${current.mean.toFixed(3)}ms (p95: ${current.p95.toFixed(3)}ms)`,
    `  Baseline: ${baseline.mean.toFixed(3)}ms (p95: ${baseline.p95.toFixed(3)}ms)`,
  ].join('\n')

  return {
    name: current.name,
    current,
    baseline,
    percentChange,
    isRegression,
    isCritical,
    summary,
  }
}

/**
 * Generate a full comparison report
 */
export function generateReport(
  currentMetrics: Record<string, BenchmarkMetrics>,
  baseline: BaselineMetrics | null,
  currentVersion: string,
  config: ThresholdConfig = DEFAULT_THRESHOLD_CONFIG
): ComparisonReport {
  const results: ComparisonResult[] = []
  let regressionCount = 0
  let improvementCount = 0
  let hasCriticalRegressions = false

  for (const [name, current] of Object.entries(currentMetrics)) {
    const baselineMetric = baseline?.benchmarks[name]
    const result = compareMetrics(current, baselineMetric, config)
    results.push(result)

    if (result.isRegression) {
      regressionCount++
      if (result.isCritical) {
        hasCriticalRegressions = true
      }
    } else if (
      result.baseline &&
      result.percentChange <
        -(config.thresholds?.[name]?.regressionThreshold ??
          config.defaultRegressionThreshold)
    ) {
      improvementCount++
    }
  }

  return {
    timestamp: new Date().toISOString(),
    currentVersion,
    baselineVersion: baseline?.version,
    results,
    hasCriticalRegressions,
    regressionCount,
    improvementCount,
  }
}

/**
 * Format comparison report for console output
 */
export function formatReport(report: ComparisonReport): string {
  const lines: string[] = [
    '='.repeat(60),
    'Performance Benchmark Report',
    '='.repeat(60),
    '',
    `Current Version: ${report.currentVersion}`,
    `Baseline Version: ${report.baselineVersion ?? 'N/A'}`,
    `Timestamp: ${report.timestamp}`,
    '',
    '-'.repeat(60),
    'Results:',
    '-'.repeat(60),
    '',
  ]

  for (const result of report.results) {
    lines.push(result.summary)
    lines.push('')
  }

  lines.push('-'.repeat(60))
  lines.push('Summary:')
  lines.push('-'.repeat(60))
  lines.push(`Total benchmarks: ${report.results.length}`)
  lines.push(`Regressions: ${report.regressionCount}`)
  lines.push(`Improvements: ${report.improvementCount}`)
  lines.push(
    `Critical regressions: ${report.hasCriticalRegressions ? 'YES' : 'No'}`
  )
  lines.push('='.repeat(60))

  return lines.join('\n')
}

/**
 * Get current git commit hash (or 'unknown' if not in git repo)
 */
export async function getGitVersion(): Promise<string> {
  try {
    const { execSync } = await import('child_process')
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}
