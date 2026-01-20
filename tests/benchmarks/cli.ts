#!/usr/bin/env node
/**
 * Benchmark CLI
 *
 * Command-line interface for running benchmarks and managing baselines.
 *
 * Usage:
 *   npx tsx tests/benchmarks/cli.ts run          # Run benchmarks
 *   npx tsx tests/benchmarks/cli.ts compare      # Compare with baseline
 *   npx tsx tests/benchmarks/cli.ts update       # Update baseline
 *   npx tsx tests/benchmarks/cli.ts report       # Generate report
 */

import { spawn } from 'child_process'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { BenchmarkMetrics, ComparisonReport, ThresholdConfig } from './types'
import { DEFAULT_THRESHOLD_CONFIG } from './types'
import {
  loadBaseline,
  saveBaseline,
  generateReport,
  formatReport,
  getGitVersion,
  DEFAULT_BASELINE_PATH,
} from './baseline'

const RESULTS_PATH = join(process.cwd(), 'tests/benchmarks/results.json')
const CONFIG_PATH = join(process.cwd(), 'tests/benchmarks/config.json')

/**
 * Load threshold configuration
 */
async function loadConfig(): Promise<ThresholdConfig> {
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

/**
 * Run benchmark tests and collect results
 */
async function runBenchmarks(): Promise<Record<string, BenchmarkMetrics>> {
  console.log('Running benchmark tests...\n')

  return new Promise((resolve, reject) => {
    // Run vitest with benchmark files
    const proc = spawn(
      'npx',
      [
        'vitest',
        'run',
        '--reporter=verbose',
        'tests/benchmarks/*.bench.ts',
      ],
      {
        stdio: 'inherit',
        cwd: process.cwd(),
        shell: true,
      }
    )

    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`Benchmark tests failed with code ${code}`))
        return
      }

      // Load results from global state (set by tests)
      try {
        if (existsSync(RESULTS_PATH)) {
          const content = await readFile(RESULTS_PATH, 'utf-8')
          resolve(JSON.parse(content))
        } else {
          // If no results file, return empty (tests write to globalThis)
          resolve({})
        }
      } catch (error) {
        reject(error)
      }
    })
  })
}

/**
 * Run comparison and generate report
 */
async function runComparison(): Promise<ComparisonReport> {
  const baseline = await loadBaseline()
  const currentVersion = await getGitVersion()
  const config = await loadConfig()

  // Load current results
  let currentMetrics: Record<string, BenchmarkMetrics> = {}
  if (existsSync(RESULTS_PATH)) {
    const content = await readFile(RESULTS_PATH, 'utf-8')
    currentMetrics = JSON.parse(content)
  }

  return generateReport(currentMetrics, baseline, currentVersion, config)
}

/**
 * Main CLI handler
 */
async function main() {
  const command = process.argv[2] || 'help'
  const args = process.argv.slice(3)

  switch (command) {
    case 'run': {
      console.log('='.repeat(60))
      console.log('Running Performance Benchmarks')
      console.log('='.repeat(60))
      console.log()

      try {
        await runBenchmarks()
        console.log('\nBenchmark tests completed successfully.')

        // Auto-compare if baseline exists
        const baseline = await loadBaseline()
        if (baseline) {
          console.log('\nComparing with baseline...')
          const report = await runComparison()
          console.log('\n' + formatReport(report))
        }
      } catch (error) {
        console.error('Benchmark run failed:', error)
        process.exit(1)
      }
      break
    }

    case 'compare': {
      console.log('Comparing current results with baseline...\n')

      const report = await runComparison()
      console.log(formatReport(report))

      // Check for CI failure
      if (args.includes('--ci')) {
        if (report.hasCriticalRegressions) {
          console.error('\nCI FAILURE: Critical performance regressions detected!')
          process.exit(1)
        }
        console.log('\nCI PASS: No critical regressions detected.')
      }
      break
    }

    case 'update': {
      console.log('Updating baseline with current results...\n')

      if (!existsSync(RESULTS_PATH)) {
        console.error('No results found. Run benchmarks first.')
        process.exit(1)
      }

      const content = await readFile(RESULTS_PATH, 'utf-8')
      const metrics = JSON.parse(content) as Record<string, BenchmarkMetrics>
      const version = args[0] || (await getGitVersion())

      await saveBaseline(metrics, version)
      console.log(`Baseline updated with version: ${version}`)
      console.log(`Saved to: ${DEFAULT_BASELINE_PATH}`)
      break
    }

    case 'report': {
      const report = await runComparison()
      const outputPath = args[0] || join(process.cwd(), 'benchmark-report.txt')

      await writeFile(outputPath, formatReport(report), 'utf-8')
      console.log(`Report saved to: ${outputPath}`)

      // Also output JSON version
      const jsonPath = outputPath.replace(/\.txt$/, '.json')
      await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8')
      console.log(`JSON report saved to: ${jsonPath}`)
      break
    }

    case 'threshold': {
      const name = args[0]
      const value = parseFloat(args[1])

      if (!name || isNaN(value)) {
        console.log('Usage: threshold <benchmark-name> <percentage>')
        process.exit(1)
      }

      const config = await loadConfig()
      config.thresholds = config.thresholds || {}
      config.thresholds[name] = {
        ...config.thresholds[name],
        regressionThreshold: value,
      }

      await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
      console.log(`Set threshold for "${name}" to ${value}%`)
      break
    }

    case 'help':
    default: {
      console.log(`
Benchmark CLI - Performance Regression Detection

Commands:
  run         Run all benchmark tests
  compare     Compare current results with baseline
              --ci    Exit with code 1 on critical regressions
  update      Update baseline with current results
              [version]  Optional version string (default: git commit)
  report      Generate a comparison report
              [path]     Output path (default: ./benchmark-report.txt)
  threshold   Set threshold for a specific benchmark
              <name> <percentage>

Examples:
  npx tsx tests/benchmarks/cli.ts run
  npx tsx tests/benchmarks/cli.ts compare --ci
  npx tsx tests/benchmarks/cli.ts update v1.0.0
  npx tsx tests/benchmarks/cli.ts threshold rpc-call-latency 15
`)
    }
  }
}

main().catch((error) => {
  console.error('CLI error:', error)
  process.exit(1)
})
