/**
 * `do eval` CLI Command
 *
 * Run AI evals to evaluate model/agent performance.
 *
 * Commands:
 *   do eval list              - List available evals
 *   do eval run [name]        - Run specific eval or all evals
 *   do eval watch             - Watch for changes and re-run evals
 *
 * Options:
 *   --format <json|pretty>    - Output format (default: pretty)
 *   --endpoint <url>          - Send results to events pipeline
 *   --threshold <number>      - Fail if accuracy below threshold
 */

import { Command } from 'commander'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, basename } from 'path'

// ============================================================================
// Types
// ============================================================================

export interface EvalInfo {
  name: string
  path: string
  description?: string
}

export interface EvalResult {
  name: string
  total: number
  passed: number
  failed: number
  accuracy: number
  results: Array<{
    input: string
    expected: string
    actual: string
    score: number
    reasoning?: string
  }>
  duration?: number
}

export interface EvalEvent {
  actor: string
  object: string
  type: string
  verb: string
  ns: string
  timestamp: string
  recorded: string
  disposition: string
  context: {
    accuracy: number
    passed: number
    failed: number
    total: number
  }
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Lists all available evals in the evals/evals directory.
 */
export async function listEvals(): Promise<EvalInfo[]> {
  const evalsDir = join(process.cwd(), 'evals/evals')

  if (!existsSync(evalsDir)) {
    return []
  }

  const files = readdirSync(evalsDir)
  const evals: EvalInfo[] = []

  for (const file of files) {
    if (file.endsWith('.eval.ts')) {
      const name = basename(file, '.eval.ts')
      const fullPath = join(evalsDir, file)

      // Try to extract description from file
      let description: string | undefined
      try {
        const content = readFileSync(fullPath, 'utf-8')
        const match = content.match(/description['":\s]+['"]([^'"]+)['"]/i)
        if (match) {
          description = match[1]
        }
      } catch {
        // Ignore read errors
      }

      evals.push({
        name,
        path: fullPath,
        description,
      })
    }
  }

  return evals
}

/**
 * Runs a specific eval by name.
 */
export async function runEval(evalName: string): Promise<EvalResult> {
  const evals = await listEvals()
  const evalInfo = evals.find((e) => e.name === evalName)

  if (!evalInfo) {
    throw new Error(`Eval not found: ${evalName}`)
  }

  // Import the eval module dynamically
  const evalModule = await import(evalInfo.path)

  // Look for runEval or default export
  const evalConfig = evalModule.evalConfig || evalModule.default

  if (!evalConfig) {
    throw new Error(`Eval module does not export evalConfig: ${evalName}`)
  }

  // Get dataset
  const dataset = typeof evalConfig.data === 'function' ? evalConfig.data() : evalConfig.data

  // Run the task on each input
  const start = Date.now()
  const results: EvalResult['results'] = []

  for (const entry of dataset) {
    const output = await evalConfig.task(entry.input)

    // Score the result
    const score = evalConfig.scorers?.[0]?.score(output, entry.expected) ?? (output.type === entry.expected ? 1 : 0)

    results.push({
      input: entry.input,
      expected: entry.expected,
      actual: output.type ?? String(output),
      score,
      reasoning: output.reasoning,
    })
  }

  const duration = Date.now() - start
  const passed = results.filter((r) => r.score === 1).length
  const failed = results.length - passed

  return {
    name: evalName,
    total: results.length,
    passed,
    failed,
    accuracy: results.length > 0 ? passed / results.length : 0,
    results,
    duration,
  }
}

/**
 * Runs all available evals.
 */
export async function runAllEvals(): Promise<EvalResult[]> {
  const evals = await listEvals()
  const results: EvalResult[] = []

  for (const evalInfo of evals) {
    try {
      const result = await runEval(evalInfo.name)
      results.push(result)
    } catch (error) {
      // Log error but continue with other evals
      console.error(`Error running eval ${evalInfo.name}:`, error)
    }
  }

  return results
}

/**
 * Formats eval results for output.
 */
export function formatResults(result: EvalResult, format: 'json' | 'pretty' = 'pretty'): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2)
  }

  // Pretty format
  const lines: string[] = [
    '',
    '='.repeat(60),
    `Eval: ${result.name}`,
    '='.repeat(60),
    '',
    `Accuracy: ${(result.accuracy * 100).toFixed(1)}% (${result.passed}/${result.total})`,
    `Duration: ${result.duration ?? 0}ms`,
    '',
  ]

  if (result.failed > 0) {
    lines.push('Failures:')
    const failures = result.results.filter((r) => r.score === 0)
    for (const failure of failures.slice(0, 5)) {
      lines.push(`  - Expected: ${failure.expected}, Got: ${failure.actual}`)
      lines.push(`    Input: ${failure.input.substring(0, 60)}${failure.input.length > 60 ? '...' : ''}`)
    }
    if (failures.length > 5) {
      lines.push(`  ... and ${failures.length - 5} more failures`)
    }
    lines.push('')
  }

  lines.push('='.repeat(60))

  return lines.join('\n')
}

/**
 * Sends eval results to an events endpoint.
 */
export async function sendToEndpoint(result: EvalResult, endpoint: string): Promise<void> {
  const now = new Date().toISOString()

  const event: EvalEvent = {
    actor: 'do-eval-cli',
    object: result.name,
    type: 'Eval',
    verb: 'evaluated',
    ns: 'https://evals.dotdo.ai',
    timestamp: now,
    recorded: now,
    disposition: result.accuracy >= 0.8 ? 'passed' : 'failed',
    context: {
      accuracy: result.accuracy,
      passed: result.passed,
      failed: result.failed,
      total: result.total,
    },
  }

  await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  })
}

// ============================================================================
// CLI Commands
// ============================================================================

/**
 * Create the eval command with subcommands.
 */
export const evalCommand = new Command('eval').description('Run AI evals to evaluate model/agent performance')

// List subcommand
evalCommand
  .command('list')
  .description('List all available evals')
  .action(async () => {
    const evals = await listEvals()

    if (evals.length === 0) {
      console.log('No evals found in evals/evals/')
      return
    }

    console.log('\nAvailable evals:\n')
    for (const evalInfo of evals) {
      console.log(`  ${evalInfo.name}`)
      if (evalInfo.description) {
        console.log(`    ${evalInfo.description}`)
      }
    }
    console.log()
  })

// Run subcommand
evalCommand
  .command('run')
  .description('Run eval(s)')
  .argument('[name]', 'Name of eval to run (runs all if not specified)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-e, --endpoint <url>', 'Send results to events endpoint')
  .option('-t, --threshold <number>', 'Fail if accuracy below threshold', parseFloat)
  .action(async (name: string | undefined, options) => {
    const { format, endpoint, threshold } = options

    try {
      let results: EvalResult[]

      if (name) {
        // Run specific eval
        const result = await runEval(name)
        results = [result]
      } else {
        // Run all evals
        results = await runAllEvals()
      }

      // Output results
      for (const result of results) {
        console.log(formatResults(result, format))

        // Send to endpoint if specified
        if (endpoint) {
          await sendToEndpoint(result, endpoint)
          console.log(`Results sent to ${endpoint}`)
        }

        // Check threshold
        if (threshold !== undefined && result.accuracy < threshold) {
          console.error(`\nEval ${result.name} failed threshold: ${result.accuracy * 100}% < ${threshold * 100}%`)
          process.exit(1)
        }
      }

      // Summary for multiple evals
      if (results.length > 1) {
        console.log('\nSummary:')
        const avgAccuracy = results.reduce((sum, r) => sum + r.accuracy, 0) / results.length
        console.log(`  Total evals: ${results.length}`)
        console.log(`  Average accuracy: ${(avgAccuracy * 100).toFixed(1)}%`)
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Watch subcommand
evalCommand
  .command('watch')
  .description('Watch for changes and re-run evals')
  .argument('[name]', 'Name of eval to watch (watches all if not specified)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (name: string | undefined, options) => {
    const { format } = options
    const { watch } = await import('fs')

    console.log('Watching for changes in evals/...')
    console.log('Press Ctrl+C to stop\n')

    const evalsDir = join(process.cwd(), 'evals')

    // Initial run
    try {
      if (name) {
        const result = await runEval(name)
        console.log(formatResults(result, format))
      } else {
        const results = await runAllEvals()
        for (const result of results) {
          console.log(formatResults(result, format))
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
    }

    // Watch for changes
    watch(evalsDir, { recursive: true }, async (eventType, filename) => {
      if (filename?.endsWith('.ts') || filename?.endsWith('.jsonl')) {
        console.log(`\n[${new Date().toLocaleTimeString()}] File changed: ${filename}`)

        try {
          if (name) {
            const result = await runEval(name)
            console.log(formatResults(result, format))
          } else {
            const results = await runAllEvals()
            for (const result of results) {
              console.log(formatResults(result, format))
            }
          }
        } catch (error) {
          console.error('Error:', error instanceof Error ? error.message : error)
        }
      }
    })
  })

export default evalCommand
