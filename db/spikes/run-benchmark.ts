#!/usr/bin/env npx tsx
/**
 * Cold Start Benchmark Runner
 *
 * Executes the full benchmark suite and outputs results.
 *
 * Usage: npx tsx db/spikes/run-benchmark.ts
 *
 * @module db/spikes/run-benchmark
 */

import { runColdStartBenchmark, formatReportAsMarkdown } from './cold-start-benchmark'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  console.log('========================================')
  console.log('Cold Start Latency Benchmark Suite')
  console.log('Target: < 500ms for 100KB DO state')
  console.log('========================================\n')

  try {
    const report = await runColdStartBenchmark({
      iterations: 50, // Reasonable iteration count for reliable stats
    })

    // Output markdown report
    const markdown = formatReportAsMarkdown(report)

    // Save to file
    const outputPath = path.join(__dirname, 'cold-start-spike-results.md')
    fs.writeFileSync(outputPath, markdown)
    console.log(`\nResults saved to: ${outputPath}`)

    // Return exit code based on target
    if (report.summary.meetsTarget) {
      console.log('\n[SUCCESS] Target met: P95 < 500ms for 100KB state')
      process.exit(0)
    } else {
      console.log('\n[WARNING] Target not met: P95 >= 500ms for 100KB state')
      console.log('See recommendations in the report for optimization strategies.')
      process.exit(0) // Not a failure, just informational
    }
  } catch (error) {
    console.error('Benchmark failed:', error)
    process.exit(1)
  }
}

main()
