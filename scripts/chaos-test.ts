#!/usr/bin/env npx tsx
/**
 * Chaos Test Runner Script
 *
 * Convenience script for running chaos tests with common configurations.
 * Usage:
 *   npx tsx scripts/chaos-test.ts [scenario] [options]
 *
 * Examples:
 *   npx tsx scripts/chaos-test.ts                    # Run all chaos tests
 *   npx tsx scripts/chaos-test.ts partition          # Run partition tests only
 *   npx tsx scripts/chaos-test.ts pipeline           # Run pipeline failure tests
 *   npx tsx scripts/chaos-test.ts idempotency        # Run idempotency tests
 *   npx tsx scripts/chaos-test.ts --verbose          # Run with verbose output
 *   npx tsx scripts/chaos-test.ts --watch            # Run in watch mode
 *
 * @module scripts/chaos-test
 */

import { spawn, SpawnOptions } from 'child_process'

const CHAOS_TEST_DIR = 'tests/unified-storage/chaos'

const SCENARIOS: Record<string, string> = {
  partition: 'partition-recovery.test.ts',
  pipeline: 'pipeline-failure.test.ts',
  idempotency: 'idempotency-recovery.test.ts',
  framework: 'chaos-framework.test.ts',
}

function parseArgs(args: string[]): { scenario?: string; options: string[] } {
  const options: string[] = []
  let scenario: string | undefined

  for (const arg of args) {
    if (arg.startsWith('--')) {
      options.push(arg)
    } else if (SCENARIOS[arg]) {
      scenario = arg
    } else {
      console.warn(`Unknown argument: ${arg}`)
    }
  }

  return { scenario, options }
}

function buildVitestArgs(scenario?: string, options: string[] = []): string[] {
  const args = ['vitest']

  // Default to run mode unless --watch is specified
  if (!options.includes('--watch')) {
    args.push('run')
  }

  // Add test path
  if (scenario && SCENARIOS[scenario]) {
    args.push(`${CHAOS_TEST_DIR}/${SCENARIOS[scenario]}`)
  } else {
    args.push(`${CHAOS_TEST_DIR}/`)
  }

  // Process options
  for (const opt of options) {
    switch (opt) {
      case '--verbose':
        args.push('--reporter=verbose')
        break
      case '--watch':
        // Remove 'run' if added
        const runIndex = args.indexOf('run')
        if (runIndex > -1) args.splice(runIndex, 1)
        break
      default:
        args.push(opt)
    }
  }

  return args
}

function run(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const opts: SpawnOptions = {
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
    }

    const proc = spawn('npx', args, opts)

    proc.on('close', (code) => {
      resolve(code ?? 0)
    })

    proc.on('error', (err) => {
      console.error('Failed to start chaos tests:', err)
      resolve(1)
    })
  })
}

async function main() {
  const cliArgs = process.argv.slice(2)

  // Handle help
  if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
    console.log(`
Chaos Test Runner

Usage:
  npx tsx scripts/chaos-test.ts [scenario] [options]

Scenarios:
  partition    - Network partition recovery tests
  pipeline     - Pipeline failure resilience tests
  idempotency  - Idempotent recovery tests
  framework    - Chaos framework unit tests
  (none)       - Run all chaos tests

Options:
  --verbose    - Verbose test output
  --watch      - Watch mode for development
  --help, -h   - Show this help message

Examples:
  npx tsx scripts/chaos-test.ts
  npx tsx scripts/chaos-test.ts partition --verbose
  npx tsx scripts/chaos-test.ts pipeline --watch
`)
    process.exit(0)
  }

  // List scenarios
  if (cliArgs.includes('--list')) {
    console.log('\nAvailable scenarios:')
    for (const [name, file] of Object.entries(SCENARIOS)) {
      console.log(`  ${name.padEnd(15)} -> ${file}`)
    }
    console.log()
    process.exit(0)
  }

  const { scenario, options } = parseArgs(cliArgs)
  const vitestArgs = buildVitestArgs(scenario, options)

  console.log('\n[Chaos Test Runner]')
  console.log(`  Command: npx ${vitestArgs.join(' ')}`)
  if (scenario) {
    console.log(`  Scenario: ${scenario}`)
  } else {
    console.log('  Scenario: all chaos tests')
  }
  console.log()

  const exitCode = await run(vitestArgs)
  process.exit(exitCode)
}

main().catch((err) => {
  console.error('Chaos test runner failed:', err)
  process.exit(1)
})
