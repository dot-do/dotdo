#!/usr/bin/env npx tsx
/**
 * Build Snippets with Minification
 *
 * Bundles and minifies snippets to meet the 32KB Cloudflare Snippets limit.
 *
 * Usage:
 *   npx tsx scripts/build-snippets.ts           # Build all snippets
 *   npx tsx scripts/build-snippets.ts --check   # Check sizes only, no output
 *   npx tsx scripts/build-snippets.ts --verbose # Show detailed build info
 *
 * Output:
 *   dist/snippets/*.min.js   - Minified snippets ready for deployment
 */

import { build, BuildOptions, BuildResult } from 'esbuild'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Maximum allowed size for a Cloudflare Snippet in bytes */
const MAX_SNIPPET_SIZE = 32 * 1024 // 32KB

/** Snippets directory */
const SNIPPETS_DIR = resolve(ROOT, 'snippets')

/** Output directory for minified snippets */
const OUTPUT_DIR = resolve(ROOT, 'dist/snippets-min')

/** Snippets to build - only top-level .ts files (not in subdirectories) */
const SNIPPET_FILES = [
  'artifacts-ingest.ts',
  'artifacts-serve.ts',
  'artifacts-config.ts',
  'artifacts-types.ts',
  'cache.ts',
  'cache-probe.ts',
  'events.ts',
  'proxy.ts',
  'search.ts',
]

// ============================================================================
// SIZE FORMATTING
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  const kb = bytes / 1024
  return `${kb.toFixed(2)}KB`
}

function getPercentage(current: number, max: number): string {
  const pct = (current / max) * 100
  return `${pct.toFixed(1)}%`
}

function getSizeIndicator(bytes: number): string {
  const ratio = bytes / MAX_SNIPPET_SIZE
  if (ratio <= 0.5) return '\x1b[32m' // green
  if (ratio <= 0.75) return '\x1b[33m' // yellow
  if (ratio <= 1.0) return '\x1b[33m' // yellow
  return '\x1b[31m' // red (over limit)
}

function resetColor(): string {
  return '\x1b[0m'
}

// ============================================================================
// BUILD FUNCTIONS
// ============================================================================

interface BuildResultInfo {
  name: string
  originalSize: number
  minifiedSize: number
  passed: boolean
  outputPath?: string
  error?: string
}

async function buildSnippet(
  filename: string,
  options: { verbose?: boolean; checkOnly?: boolean }
): Promise<BuildResultInfo> {
  const inputPath = resolve(SNIPPETS_DIR, filename)
  const outputName = filename.replace('.ts', '.min.js')
  const outputPath = resolve(OUTPUT_DIR, outputName)

  // Get original size
  const originalSize = statSync(inputPath).size

  const result: BuildResultInfo = {
    name: filename,
    originalSize,
    minifiedSize: 0,
    passed: false,
  }

  try {
    // Build with esbuild
    const buildOptions: BuildOptions = {
      entryPoints: [inputPath],
      bundle: true,
      minify: true,
      format: 'esm',
      target: 'es2022',
      platform: 'browser', // Cloudflare Workers are browser-like
      write: false, // Don't write, we want to check size first
      treeShaking: true,
      // Keep names for debugging but minify identifiers
      keepNames: false,
      // Drop console.log in production (optional, comment out if needed)
      // drop: ['console'],
      // External imports that shouldn't be bundled
      external: [
        // These are relative imports within the project
        // They should be bundled, but we can mark external if needed
      ],
      // Loader for TypeScript
      loader: {
        '.ts': 'ts',
      },
      // Log level
      logLevel: options.verbose ? 'info' : 'silent',
    }

    const buildResult = await build(buildOptions)

    if (buildResult.outputFiles && buildResult.outputFiles.length > 0) {
      const output = buildResult.outputFiles[0]!
      result.minifiedSize = output.contents.length
      result.passed = result.minifiedSize <= MAX_SNIPPET_SIZE

      // Write output if not check-only
      if (!options.checkOnly && result.passed) {
        if (!existsSync(OUTPUT_DIR)) {
          mkdirSync(OUTPUT_DIR, { recursive: true })
        }
        writeFileSync(outputPath, output.contents)
        result.outputPath = outputPath
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
    result.passed = false
  }

  return result
}

async function buildAllSnippets(options: { verbose?: boolean; checkOnly?: boolean }): Promise<void> {
  console.log('Building snippets with minification...\n')
  console.log(`  Input:  ${SNIPPETS_DIR}`)
  console.log(`  Output: ${OUTPUT_DIR}`)
  console.log(`  Limit:  ${formatBytes(MAX_SNIPPET_SIZE)}\n`)

  const results: BuildResultInfo[] = []

  // Find max name length for alignment
  const maxNameLen = Math.max(...SNIPPET_FILES.map((f) => f.length))

  for (const filename of SNIPPET_FILES) {
    const inputPath = resolve(SNIPPETS_DIR, filename)

    // Check if file exists
    if (!existsSync(inputPath)) {
      console.log(`  ${filename.padEnd(maxNameLen)}  [MISSING]`)
      continue
    }

    const result = await buildSnippet(filename, options)
    results.push(result)

    // Format output line
    const name = result.name.padEnd(maxNameLen)
    const original = formatBytes(result.originalSize).padStart(10)
    const minified = formatBytes(result.minifiedSize).padStart(10)
    const savings = (((result.originalSize - result.minifiedSize) / result.originalSize) * 100).toFixed(0)
    const color = getSizeIndicator(result.minifiedSize)
    const status = result.passed ? 'OK' : 'OVER'
    const pct = getPercentage(result.minifiedSize, MAX_SNIPPET_SIZE)

    console.log(
      `  ${name}  ${original} -> ${color}${minified}${resetColor()}  (-${savings}%)  ${pct}  [${status}]`
    )

    if (result.error && options.verbose) {
      console.log(`    Error: ${result.error}`)
    }
  }

  // Summary
  console.log('\n--- Summary ---')
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const total = results.length

  console.log(`  Total:  ${total}`)
  console.log(`  Passed: ${passed}`)
  if (failed > 0) {
    console.log(`  Failed: ${failed}`)
    console.log('\nSnippets over 32KB limit:')
    for (const r of results.filter((r) => !r.passed)) {
      const over = r.minifiedSize - MAX_SNIPPET_SIZE
      console.log(`  - ${r.name}: ${formatBytes(r.minifiedSize)} (${formatBytes(over)} over)`)
    }
    console.log('\nThese snippets need to be split into smaller modules.')
  }

  if (!options.checkOnly && passed > 0) {
    console.log(`\nMinified snippets written to: ${OUTPUT_DIR}/`)
  }
}

// ============================================================================
// MAIN
// ============================================================================

const args = process.argv.slice(2)
const verbose = args.includes('--verbose') || args.includes('-v')
const checkOnly = args.includes('--check') || args.includes('-c')

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Build Snippets with Minification

Usage:
  npx tsx scripts/build-snippets.ts           Build all snippets
  npx tsx scripts/build-snippets.ts --check   Check sizes only
  npx tsx scripts/build-snippets.ts --verbose Show detailed info

The 32KB limit is enforced by Cloudflare Snippets.
Snippets exceeding this limit will be marked as OVER.
`)
  process.exit(0)
}

await buildAllSnippets({ verbose, checkOnly })
