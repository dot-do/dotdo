#!/usr/bin/env node
/**
 * Performance Regression Checker
 *
 * Compares benchmark results against baseline and exits with appropriate codes:
 * - Exit 0: No regressions detected
 * - Exit 1: Critical regressions detected (fails CI)
 * - Exit 2: Non-critical regressions detected (warnings only)
 *
 * Usage:
 *   npx tsx tests/benchmarks/check-regression.ts [--strict] [--json]
 *
 * Options:
 *   --strict    Fail on any regression (not just critical ones)
 *   --json      Output results as JSON
 *   --summary   Output only summary (no per-benchmark details)
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { BenchmarkMetrics, ThresholdConfig, ComparisonResult } from './types'
import { DEFAULT_THRESHOLD_CONFIG } from './types'
import { loadBaseline, getGitVersion } from './baseline'

const RESULTS_PATH = join(process.cwd(), 'tests/benchmarks/results.json')
const CONFIG_PATH = join(process.cwd(), 'tests/benchmarks/config.json')

interface RegressionCheckResult {
  timestamp: string
  currentVersion: string
  baselineVersion: string | null
  benchmarks: {
    name: string
    current: number
    baseline: number | null
    percentChange: number
    threshold: number
    status: 'ok' | 'warning' | 'regression' | 'improvement' | 'new'
    critical: boolean
    description?: string
  }[]
  summary: {
    total: number
    passed: number
    warnings: number
    regressions: number
    criticalRegressions: number
    improvements: number
    newBenchmarks: number
  }
  exitCode: 0 | 1 | 2
}

async function loadConfig(): Promise<ThresholdConfig & { warningThreshold?: number; failureThreshold?: number }> {
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = await readFile(CONFIG_PATH, 'utf-8')
      return { ...DEFAULT_THRESHOLD_CONFIG, ...JSON.parse(content) }
    }
  } catch (error) {
    console.warn('Failed to load config, using defaults')
  }
  return DEFAULT_THRESHOLD_CONFIG
}

async function checkRegressions(strict: boolean): Promise<RegressionCheckResult> {
  const currentVersion = await getGitVersion()
  const baseline = await loadBaseline()
  const config = await loadConfig()

  // Load current results
  let currentMetrics: Record<string, BenchmarkMetrics> = {}
  if (existsSync(RESULTS_PATH)) {
    const content = await readFile(RESULTS_PATH, 'utf-8')
    currentMetrics = JSON.parse(content)
  } else {
    throw new Error(`Results file not found: ${RESULTS_PATH}. Run benchmarks first.`)
  }

  const warningThreshold = config.warningThreshold ?? 10
  const failureThreshold = config.failureThreshold ?? 20

  const benchmarks: RegressionCheckResult['benchmarks'] = []
  let passed = 0
  let warnings = 0
  let regressions = 0
  let criticalRegressions = 0
  let improvements = 0
  let newBenchmarks = 0

  for (const [name, current] of Object.entries(currentMetrics)) {
    const benchConfig = config.thresholds?.[name] as { regressionThreshold?: number; critical?: boolean; description?: string } | undefined
    const threshold = benchConfig?.regressionThreshold ?? config.defaultRegressionThreshold
    const isCritical = benchConfig?.critical ?? true

    const baselineMetric = baseline?.benchmarks[name]
    const baselineMean = baselineMetric?.mean ?? null

    let percentChange = 0
    let status: RegressionCheckResult['benchmarks'][0]['status'] = 'ok'

    if (baselineMean === null) {
      status = 'new'
      newBenchmarks++
    } else {
      percentChange = ((current.mean - baselineMean) / baselineMean) * 100

      if (percentChange > failureThreshold) {
        status = 'regression'
        regressions++
        if (isCritical) {
          criticalRegressions++
        }
      } else if (percentChange > warningThreshold) {
        status = 'warning'
        warnings++
      } else if (percentChange < -warningThreshold) {
        status = 'improvement'
        improvements++
      } else {
        status = 'ok'
        passed++
      }
    }

    benchmarks.push({
      name,
      current: current.mean,
      baseline: baselineMean,
      percentChange,
      threshold,
      status,
      critical: isCritical,
      description: benchConfig?.description,
    })
  }

  // Determine exit code
  let exitCode: 0 | 1 | 2 = 0
  if (criticalRegressions > 0) {
    exitCode = 1
  } else if (strict && regressions > 0) {
    exitCode = 1
  } else if (regressions > 0 || warnings > 0) {
    exitCode = 2
  }

  return {
    timestamp: new Date().toISOString(),
    currentVersion,
    baselineVersion: baseline?.version ?? null,
    benchmarks,
    summary: {
      total: benchmarks.length,
      passed,
      warnings,
      regressions,
      criticalRegressions,
      improvements,
      newBenchmarks,
    },
    exitCode,
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'ok':
      return '\x1b[32mPASS\x1b[0m'
    case 'warning':
      return '\x1b[33mWARN\x1b[0m'
    case 'regression':
      return '\x1b[31mFAIL\x1b[0m'
    case 'improvement':
      return '\x1b[36mIMPR\x1b[0m'
    case 'new':
      return '\x1b[34mNEW\x1b[0m'
    default:
      return status
  }
}

function formatReport(result: RegressionCheckResult, summary: boolean): string {
  const lines: string[] = []

  lines.push('='.repeat(70))
  lines.push('Performance Regression Check')
  lines.push('='.repeat(70))
  lines.push('')
  lines.push(`Current Version: ${result.currentVersion}`)
  lines.push(`Baseline Version: ${result.baselineVersion ?? 'N/A (no baseline)'}`)
  lines.push(`Timestamp: ${result.timestamp}`)
  lines.push('')

  if (!summary) {
    lines.push('-'.repeat(70))
    lines.push('Benchmark Results:')
    lines.push('-'.repeat(70))
    lines.push('')

    // Sort by status priority: regression > warning > new > ok > improvement
    const statusPriority: Record<string, number> = {
      regression: 0,
      warning: 1,
      new: 2,
      ok: 3,
      improvement: 4,
    }

    const sorted = [...result.benchmarks].sort(
      (a, b) => (statusPriority[a.status] ?? 5) - (statusPriority[b.status] ?? 5)
    )

    for (const bench of sorted) {
      const status = formatStatus(bench.status)
      const criticalTag = bench.critical ? ' [CRITICAL]' : ''
      const changeStr =
        bench.baseline !== null
          ? `${bench.percentChange > 0 ? '+' : ''}${bench.percentChange.toFixed(1)}%`
          : 'N/A'

      lines.push(`${status} ${bench.name}${criticalTag}`)
      if (bench.baseline !== null) {
        lines.push(`     Current: ${bench.current.toFixed(3)}ms, Baseline: ${bench.baseline.toFixed(3)}ms (${changeStr})`)
      } else {
        lines.push(`     Current: ${bench.current.toFixed(3)}ms (new benchmark, no baseline)`)
      }
      if (bench.description) {
        lines.push(`     ${bench.description}`)
      }
      lines.push('')
    }
  }

  lines.push('-'.repeat(70))
  lines.push('Summary:')
  lines.push('-'.repeat(70))
  lines.push(`Total benchmarks: ${result.summary.total}`)
  lines.push(`  Passed: ${result.summary.passed}`)
  lines.push(`  Warnings: ${result.summary.warnings}`)
  lines.push(`  Regressions: ${result.summary.regressions} (${result.summary.criticalRegressions} critical)`)
  lines.push(`  Improvements: ${result.summary.improvements}`)
  lines.push(`  New: ${result.summary.newBenchmarks}`)
  lines.push('')

  if (result.exitCode === 0) {
    lines.push('\x1b[32mRESULT: PASS - No critical regressions detected\x1b[0m')
  } else if (result.exitCode === 1) {
    lines.push('\x1b[31mRESULT: FAIL - Critical performance regressions detected!\x1b[0m')
  } else {
    lines.push('\x1b[33mRESULT: WARN - Non-critical regressions or warnings detected\x1b[0m')
  }

  lines.push('='.repeat(70))

  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const strict = args.includes('--strict')
  const json = args.includes('--json')
  const summary = args.includes('--summary')

  try {
    const result = await checkRegressions(strict)

    if (json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(formatReport(result, summary))
    }

    process.exit(result.exitCode)
  } catch (error) {
    console.error('Error checking regressions:', error)
    process.exit(1)
  }
}

main()
