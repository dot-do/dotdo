import * as fs from 'node:fs'
import * as path from 'node:path'
import type { LatencyStats } from './stats'

/**
 * Benchmark result to be recorded
 */
export interface BenchmarkResult {
  /** Benchmark name */
  name: string
  /** Target DO endpoint */
  target: string
  /** Number of iterations recorded (excluding warmup) */
  iterations: number
  /** Calculated latency statistics */
  stats: LatencyStats
  /** Raw latency samples in milliseconds */
  samples: number[]
  /** ISO timestamp when benchmark completed */
  timestamp: string
  /** Colo hint used for the benchmark */
  colo?: string
  /** Colos that actually served each request */
  colosServed?: string[]
  /** Benchmark configuration */
  config?: {
    warmup?: number
    coldStart?: boolean
    datasetSize?: number
    shardCount?: number
    [key: string]: unknown
  }
  /** Any errors encountered during benchmark */
  errors?: Array<{
    iteration: number
    message: string
    stack?: string
  }>
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Get the results directory path
 */
function getResultsDir(): string {
  return path.join(__dirname, '../results')
}

/**
 * Get the current day's results file path
 */
function getResultsFilePath(): string {
  const date = new Date().toISOString().split('T')[0]
  return path.join(getResultsDir(), `${date}-benchmarks.jsonl`)
}

/**
 * Record benchmark results to a JSONL file
 *
 * Results are appended to a daily file: benchmarks/results/YYYY-MM-DD-benchmarks.jsonl
 *
 * @param result - Single BenchmarkResult or array of results to record
 *
 * @example
 * ```ts
 * const result = await benchmark(config)
 * record(result)
 *
 * // Or record multiple results at once
 * const results = await Promise.all([
 *   benchmark(config1),
 *   benchmark(config2),
 * ])
 * record(results)
 * ```
 */
export function record(result: BenchmarkResult | BenchmarkResult[]): void {
  const results = Array.isArray(result) ? result : [result]

  // Skip if no results
  if (results.length === 0) return

  const resultsDir = getResultsDir()
  const filePath = getResultsFilePath()

  // Ensure results directory exists
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true })
  }

  // Convert results to JSONL format
  const lines = results.map((r) => JSON.stringify(r)).join('\n') + '\n'

  // Append to file
  fs.appendFileSync(filePath, lines, 'utf-8')
}

/**
 * Read all results from the current day's file
 *
 * @returns Array of BenchmarkResult from today's file, or empty array if none exist
 */
export function readTodayResults(): BenchmarkResult[] {
  const filePath = getResultsFilePath()

  if (!fs.existsSync(filePath)) {
    return []
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  return content
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as BenchmarkResult)
}

/**
 * Read results from a specific date
 *
 * @param date - Date in YYYY-MM-DD format
 * @returns Array of BenchmarkResult from that date, or empty array if none exist
 */
export function readResultsByDate(date: string): BenchmarkResult[] {
  const filePath = path.join(getResultsDir(), `${date}-benchmarks.jsonl`)

  if (!fs.existsSync(filePath)) {
    return []
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  return content
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as BenchmarkResult)
}

/**
 * List all available result files
 *
 * @returns Array of date strings (YYYY-MM-DD) for which results exist
 */
export function listResultDates(): string[] {
  const resultsDir = getResultsDir()

  if (!fs.existsSync(resultsDir)) {
    return []
  }

  return fs
    .readdirSync(resultsDir)
    .filter((f) => f.endsWith('-benchmarks.jsonl'))
    .map((f) => f.replace('-benchmarks.jsonl', ''))
    .sort()
}
