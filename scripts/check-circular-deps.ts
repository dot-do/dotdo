#!/usr/bin/env npx tsx
/**
 * Circular Dependency Detection Script
 *
 * Uses madge to detect circular dependencies in the TypeScript codebase.
 * Designed to be run in CI to prevent the introduction of new circular dependencies.
 *
 * Usage:
 *   npx tsx scripts/check-circular-deps.ts           # Check all source directories
 *   npx tsx scripts/check-circular-deps.ts --strict  # Fail on any circular dependency
 *   npx tsx scripts/check-circular-deps.ts --json    # Output results as JSON
 *   npx tsx scripts/check-circular-deps.ts --image   # Generate dependency graph image
 *
 * Exit codes:
 *   0 - No circular dependencies found (or in warn mode and within threshold)
 *   1 - Circular dependencies found (in strict mode)
 */

import madge from 'madge'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Source directories to analyze for circular dependencies */
const SOURCE_DIRS = [
  'api',
  'do',
  'db',
  'lib',
  'objects',
  'types',
  'workflows',
  'streaming',
  'workers',
  'core',
  'packages',
]

/** Known circular dependencies that are allowed (temporarily) */
const ALLOWED_CYCLES: string[][] = [
  // Note: These are known issues that should be fixed.
  // Adding them here allows CI to pass while we work on fixes.
  // Remove entries as they are resolved.
]

/** madge configuration options */
const MADGE_CONFIG = {
  fileExtensions: ['ts', 'tsx'],
  excludeRegExp: [
    /node_modules/,
    /\.test\.(ts|tsx)$/,
    /\.spec\.(ts|tsx)$/,
    /tests\//,
    /dist\//,
    /__tests__\//,
    /\.d\.ts$/,
  ],
  detectiveOptions: {
    ts: {
      skipTypeImports: true,
    },
  },
}

// ============================================================================
// TYPES
// ============================================================================

interface CircularDependency {
  cycle: string[]
  isAllowed: boolean
}

interface AnalysisResult {
  directory: string
  circularDependencies: CircularDependency[]
  totalFiles: number
  hasNewViolations: boolean
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatCycle(cycle: string[]): string {
  return cycle.join(' -> ') + ' -> ' + cycle[0]
}

function isCycleAllowed(cycle: string[]): boolean {
  return ALLOWED_CYCLES.some((allowed) => {
    if (allowed.length !== cycle.length) return false
    // Check if cycles match (considering rotation)
    const cycleStr = cycle.join('|')
    for (let i = 0; i < allowed.length; i++) {
      const rotated = [...allowed.slice(i), ...allowed.slice(0, i)].join('|')
      if (cycleStr === rotated) return true
    }
    return false
  })
}

function resetColor(): string {
  return '\x1b[0m'
}

function red(text: string): string {
  return `\x1b[31m${text}${resetColor()}`
}

function green(text: string): string {
  return `\x1b[32m${text}${resetColor()}`
}

function yellow(text: string): string {
  return `\x1b[33m${text}${resetColor()}`
}

function cyan(text: string): string {
  return `\x1b[36m${text}${resetColor()}`
}

function bold(text: string): string {
  return `\x1b[1m${text}${resetColor()}`
}

// ============================================================================
// ANALYSIS FUNCTIONS
// ============================================================================

async function analyzeDirectory(dir: string): Promise<AnalysisResult | null> {
  const fullPath = resolve(ROOT, dir)

  if (!existsSync(fullPath)) {
    return null
  }

  try {
    const result = await madge(fullPath, MADGE_CONFIG)
    const circular = result.circular()
    const obj = result.obj()
    const totalFiles = Object.keys(obj).length

    const circularDependencies: CircularDependency[] = circular.map((cycle) => ({
      cycle,
      isAllowed: isCycleAllowed(cycle),
    }))

    const hasNewViolations = circularDependencies.some((dep) => !dep.isAllowed)

    return {
      directory: dir,
      circularDependencies,
      totalFiles,
      hasNewViolations,
    }
  } catch (error) {
    console.error(`Error analyzing ${dir}:`, error)
    return null
  }
}

async function generateImage(outputPath: string): Promise<void> {
  console.log(`\nGenerating dependency graph to: ${outputPath}`)

  const result = await madge(ROOT, {
    ...MADGE_CONFIG,
    includeNpm: false,
  })

  await result.image(outputPath)
  console.log(`Graph saved to: ${outputPath}`)
}

// ============================================================================
// OUTPUT FORMATTERS
// ============================================================================

function printResults(results: AnalysisResult[], strict: boolean): void {
  console.log(bold('\nCircular Dependency Analysis\n'))
  console.log(`  Root: ${ROOT}`)
  console.log(`  Mode: ${strict ? red('Strict (fail on any)') : yellow('Warning')}`)
  console.log(`  Directories: ${SOURCE_DIRS.join(', ')}\n`)

  let totalCycles = 0
  let newViolations = 0

  for (const result of results) {
    if (!result) continue

    const { directory, circularDependencies, totalFiles } = result

    if (circularDependencies.length === 0) {
      console.log(`  ${green('OK')} ${cyan(directory)} (${totalFiles} files)`)
      continue
    }

    totalCycles += circularDependencies.length
    const newInDir = circularDependencies.filter((d) => !d.isAllowed).length
    newViolations += newInDir

    const status = newInDir > 0 ? red('FAIL') : yellow('WARN')
    console.log(`  ${status} ${cyan(directory)} (${circularDependencies.length} cycles, ${totalFiles} files)`)

    for (const dep of circularDependencies) {
      const marker = dep.isAllowed ? yellow('[allowed]') : red('[NEW]')
      console.log(`       ${marker} ${formatCycle(dep.cycle)}`)
    }
  }

  // Summary
  console.log(bold('\n--- Summary ---'))
  console.log(`  Total circular dependencies: ${totalCycles}`)
  console.log(`  New violations: ${newViolations}`)
  console.log(`  Allowed (temporary): ${totalCycles - newViolations}`)

  if (newViolations > 0 && strict) {
    console.log(red('\nCI will fail due to new circular dependencies.'))
    console.log('Fix the cycles or temporarily add them to ALLOWED_CYCLES in this script.\n')
  } else if (totalCycles > 0) {
    console.log(yellow('\nCircular dependencies detected. Consider refactoring to remove them.'))
  } else {
    console.log(green('\nNo circular dependencies found!'))
  }
}

function printJson(results: AnalysisResult[]): void {
  const output = {
    timestamp: new Date().toISOString(),
    root: ROOT,
    results: results.filter(Boolean),
    summary: {
      totalCycles: results.reduce((acc, r) => acc + (r?.circularDependencies.length || 0), 0),
      newViolations: results.reduce(
        (acc, r) => acc + (r?.circularDependencies.filter((d) => !d.isAllowed).length || 0),
        0
      ),
    },
  }
  console.log(JSON.stringify(output, null, 2))
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Circular Dependency Detection Script

Usage:
  npx tsx scripts/check-circular-deps.ts           Check all source directories
  npx tsx scripts/check-circular-deps.ts --strict  Fail on any circular dependency
  npx tsx scripts/check-circular-deps.ts --json    Output results as JSON
  npx tsx scripts/check-circular-deps.ts --image   Generate dependency graph image

Options:
  --strict   Exit with code 1 if any circular dependencies are found
  --json     Output results in JSON format (useful for CI integration)
  --image    Generate a visual dependency graph (requires graphviz)
  --help     Show this help message

Exit codes:
  0 - No circular dependencies found
  1 - Circular dependencies found (in strict mode)

Configuration:
  Edit this script to modify ALLOWED_CYCLES for temporarily allowed cycles
  or SOURCE_DIRS to change which directories are analyzed.
`)
    process.exit(0)
  }

  const strict = args.includes('--strict')
  const jsonOutput = args.includes('--json')
  const generateGraph = args.includes('--image')

  if (generateGraph) {
    const outputPath = resolve(ROOT, 'docs', 'dependency-graph.svg')
    await generateImage(outputPath)
    return
  }

  if (!jsonOutput) {
    console.log('Analyzing circular dependencies...\n')
  }

  const results: AnalysisResult[] = []

  for (const dir of SOURCE_DIRS) {
    const result = await analyzeDirectory(dir)
    if (result) {
      results.push(result)
    }
  }

  if (jsonOutput) {
    printJson(results)
  } else {
    printResults(results, strict)
  }

  // Exit code
  const hasNewViolations = results.some((r) => r?.hasNewViolations)
  if (strict && hasNewViolations) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
