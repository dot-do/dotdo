/**
 * Benchmark Test Setup
 *
 * Sets up the test environment for benchmark tests and handles
 * result collection and storage.
 */

import { writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { afterAll } from 'vitest'
import type { BenchmarkMetrics } from './types'

const RESULTS_PATH = join(process.cwd(), 'tests/benchmarks/results.json')

// Initialize global results storage
;(globalThis as any).__benchmarkResults =
  (globalThis as any).__benchmarkResults || {}

/**
 * Save benchmark results after all tests complete
 * Merges with existing results to accumulate across test files
 */
afterAll(async () => {
  const currentResults = (globalThis as any).__benchmarkResults as Record<
    string,
    BenchmarkMetrics
  >

  if (Object.keys(currentResults).length > 0) {
    // Load existing results if any
    let existingResults: Record<string, BenchmarkMetrics> = {}
    try {
      if (existsSync(RESULTS_PATH)) {
        const content = await readFile(RESULTS_PATH, 'utf-8')
        existingResults = JSON.parse(content)
      }
    } catch {
      // Ignore read errors, start fresh
    }

    // Merge current results into existing
    const mergedResults = { ...existingResults, ...currentResults }

    await writeFile(RESULTS_PATH, JSON.stringify(mergedResults, null, 2), 'utf-8')
    console.log(`\nBenchmark results saved to: ${RESULTS_PATH}`)
  }
})
