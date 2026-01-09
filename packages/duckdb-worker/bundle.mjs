#!/usr/bin/env node
/**
 * Bundle script for @dotdo/duckdb-worker
 *
 * Creates Workers-optimized distribution:
 * - dist/duckdb-workers.mjs - JS bindings (ESM)
 * - dist/duckdb-worker.wasm - Pre-compiled WASM
 * - dist/duckdb-worker.d.ts - TypeScript declarations
 *
 * Usage:
 *   node bundle.mjs [--size]
 */

import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, 'dist')
const WASM_DIR = join(__dirname, 'wasm')
const BUILD_DIST = join(__dirname, 'build', 'dist')

// Target size in bytes (10MB)
const TARGET_SIZE = 10 * 1024 * 1024

function log(msg) {
  console.log(`[bundle] ${msg}`)
}

function error(msg) {
  console.error(`[bundle] ERROR: ${msg}`)
  process.exit(1)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function main() {
  const args = process.argv.slice(2)
  const sizeOptimized = args.includes('--size')

  log('Building @dotdo/duckdb-worker for Cloudflare Workers')
  log(`Mode: ${sizeOptimized ? 'size-optimized' : 'release'}`)

  // Ensure dist directory exists
  mkdirSync(DIST_DIR, { recursive: true })

  // Step 1: Build TypeScript with tsup
  log('Building TypeScript bindings...')
  try {
    execSync('npx tsup', { cwd: __dirname, stdio: 'inherit' })
  } catch (e) {
    error('Failed to build TypeScript')
  }

  // Step 2: Copy WASM file from wasm/ or build/dist/
  log('Copying WASM module...')

  let wasmSource = null
  const possibleSources = [
    join(WASM_DIR, 'duckdb-worker.wasm'),
    join(BUILD_DIST, 'duckdb-worker.wasm'),
  ]

  for (const src of possibleSources) {
    if (existsSync(src)) {
      wasmSource = src
      break
    }
  }

  if (!wasmSource) {
    error(`No WASM file found. Run 'npm run build:wasm' first.`)
  }

  const wasmDest = join(DIST_DIR, 'duckdb-worker.wasm')
  copyFileSync(wasmSource, wasmDest)

  // Step 3: Check WASM size
  const wasmStats = statSync(wasmDest)
  const wasmSize = wasmStats.size

  log(`WASM size: ${formatBytes(wasmSize)}`)

  if (wasmSize > TARGET_SIZE) {
    log(`WARNING: WASM size (${formatBytes(wasmSize)}) exceeds ${formatBytes(TARGET_SIZE)} target`)
    log('Consider running with --size flag or disabling more extensions')
  } else {
    log(`WASM size is within ${formatBytes(TARGET_SIZE)} target`)
  }

  // Step 4: Create the workers-specific entry point
  log('Creating Workers entry point...')

  const workersEntry = `/**
 * @dotdo/duckdb-worker - Workers Entry Point
 *
 * Pre-configured for Cloudflare Workers runtime with:
 * - Memory-only filesystem (no Emscripten FS)
 * - Single-threaded execution
 * - Pre-compiled WASM module support
 *
 * @example
 * \`\`\`typescript
 * import { createDuckDB } from '@dotdo/duckdb-worker/workers'
 * import DUCKDB_WASM from '@dotdo/duckdb-worker/wasm'
 *
 * export default {
 *   async fetch(request, env) {
 *     const db = await createDuckDB({}, { wasmModule: DUCKDB_WASM })
 *     const result = await db.query('SELECT 1 + 1 as answer')
 *     await db.close()
 *     return Response.json(result.rows)
 *   }
 * }
 * \`\`\`
 */
export * from './index.js'
`

  writeFileSync(join(DIST_DIR, 'duckdb-workers.mjs'), workersEntry)

  // Step 5: Copy type declarations
  log('Copying type declarations...')

  const typesSrc = join(WASM_DIR, 'duckdb-worker.d.ts')
  if (existsSync(typesSrc)) {
    copyFileSync(typesSrc, join(DIST_DIR, 'duckdb-worker.d.ts'))
  }

  // Step 6: Generate bundle report
  log('')
  log('='.repeat(50))
  log('Bundle Complete!')
  log('='.repeat(50))
  log('')
  log('Output files:')

  const outputs = [
    'index.js',
    'index.cjs',
    'index.d.ts',
    'duckdb-workers.mjs',
    'duckdb-worker.wasm',
    'duckdb-worker.d.ts',
  ]

  let totalSize = 0
  for (const file of outputs) {
    const filePath = join(DIST_DIR, file)
    if (existsSync(filePath)) {
      const size = statSync(filePath).size
      totalSize += size
      log(`  ${file.padEnd(25)} ${formatBytes(size).padStart(12)}`)
    }
  }

  log('')
  log(`Total bundle size: ${formatBytes(totalSize)}`)
  log('')

  // Check if WASM meets target
  if (wasmSize <= TARGET_SIZE) {
    log('WASM bundle size: PASS')
  } else {
    log('WASM bundle size: FAIL (exceeds 10MB target)')
    log(`  Current: ${formatBytes(wasmSize)}`)
    log(`  Target:  ${formatBytes(TARGET_SIZE)}`)
    log('')
    log('To reduce size, try:')
    log('  1. Run: npm run build:wasm:size')
    log('  2. Disable Parquet extension in build-workers.sh')
  }
}

main().catch(e => {
  error(e.message)
})
