#!/usr/bin/env npx tsx
/**
 * TypeDoc API Extraction Script
 *
 * Extracts TypeScript API documentation and generates JSON/markdown output for docs.
 *
 * Usage:
 *   npx tsx scripts/extract-api.ts              # Full extraction
 *   npx tsx scripts/extract-api.ts --json-only  # JSON output only
 *   npx tsx scripts/extract-api.ts --html       # Include HTML output
 *   npx tsx scripts/extract-api.ts --watch      # Watch mode
 *   npx tsx scripts/extract-api.ts --stats      # Show extraction stats
 *
 * Output:
 *   - docs/reference/generated/api.json    - Full API JSON
 *   - docs/reference/generated/**\/*.md    - Markdown pages (via typedoc-plugin-markdown)
 *   - docs/reference/generated/index.html  - HTML (if --html flag)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, relative, join, basename, extname } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawn } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(__dirname, '..')
const DOCS_DIR = resolve(ROOT_DIR, 'docs')
const OUTPUT_DIR = resolve(DOCS_DIR, 'reference/generated')

// ANSI color codes
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
}

interface ExtractionStats {
  modules: number
  classes: number
  interfaces: number
  typeAliases: number
  functions: number
  variables: number
  enums: number
  total: number
  outputFiles: number
  duration: number
}

interface APISymbol {
  id: number
  name: string
  kind: number
  kindString?: string
  flags?: Record<string, boolean>
  comment?: {
    summary?: Array<{ kind: string; text: string }>
    blockTags?: Array<{ tag: string; content: Array<{ kind: string; text: string }> }>
  }
  children?: APISymbol[]
  groups?: Array<{ title: string; children: number[] }>
}

/**
 * Check if TypeDoc is installed
 */
function checkDependencies(): boolean {
  try {
    execSync('npx typedoc --version', { cwd: ROOT_DIR, stdio: 'pipe' })
    return true
  } catch {
    console.error(`${colors.red}Error: TypeDoc is not installed.${colors.reset}`)
    console.log(`\nInstall with: ${colors.cyan}pnpm add -D typedoc typedoc-plugin-markdown${colors.reset}`)
    return false
  }
}

/**
 * Ensure output directory exists
 */
function ensureOutputDir(): void {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true })
    console.log(`${colors.dim}Created output directory: ${relative(ROOT_DIR, OUTPUT_DIR)}${colors.reset}`)
  }
}

/**
 * Run TypeDoc extraction
 */
function runTypeDoc(options: { jsonOnly?: boolean; html?: boolean; watch?: boolean }): void {
  const args = ['typedoc']

  if (options.jsonOnly) {
    // Skip markdown/HTML output, only generate JSON
    args.push('--json', resolve(OUTPUT_DIR, 'api.json'))
    args.push('--out', '/dev/null') // Suppress HTML output
  } else if (options.html) {
    // Generate HTML output (default TypeDoc behavior)
    args.push('--out', OUTPUT_DIR)
    args.push('--json', resolve(OUTPUT_DIR, 'api.json'))
  } else {
    // Default: markdown output via plugin
    args.push('--out', OUTPUT_DIR)
    args.push('--json', resolve(OUTPUT_DIR, 'api.json'))
  }

  if (options.watch) {
    args.push('--watch')
  }

  console.log(`${colors.cyan}Running TypeDoc...${colors.reset}`)
  console.log(`${colors.dim}$ npx ${args.join(' ')}${colors.reset}\n`)

  try {
    if (options.watch) {
      // Use spawn for watch mode
      const proc = spawn('npx', args, {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        shell: true,
      })

      proc.on('error', (err) => {
        console.error(`${colors.red}TypeDoc error: ${err.message}${colors.reset}`)
        process.exit(1)
      })
    } else {
      execSync(`npx ${args.join(' ')}`, {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      })
    }
  } catch (err) {
    const error = err as Error
    console.error(`${colors.red}TypeDoc extraction failed: ${error.message}${colors.reset}`)
    process.exit(1)
  }
}

/**
 * Count output files
 */
function countOutputFiles(dir: string): number {
  let count = 0

  function walk(currentDir: string): void {
    if (!existsSync(currentDir)) return

    const entries = readdirSync(currentDir)
    for (const entry of entries) {
      const fullPath = join(currentDir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (stat.isFile()) {
        count++
      }
    }
  }

  walk(dir)
  return count
}

/**
 * Analyze extracted API JSON
 */
function analyzeApiJson(jsonPath: string): ExtractionStats | null {
  if (!existsSync(jsonPath)) {
    return null
  }

  try {
    const content = readFileSync(jsonPath, 'utf-8')
    const api: APISymbol = JSON.parse(content)

    const stats: ExtractionStats = {
      modules: 0,
      classes: 0,
      interfaces: 0,
      typeAliases: 0,
      functions: 0,
      variables: 0,
      enums: 0,
      total: 0,
      outputFiles: 0,
      duration: 0,
    }

    // TypeDoc kind values (from typedoc)
    const KIND_MODULE = 2
    const KIND_NAMESPACE = 4
    const KIND_ENUM = 8
    const KIND_VARIABLE = 32
    const KIND_FUNCTION = 64
    const KIND_CLASS = 128
    const KIND_INTERFACE = 256
    const KIND_TYPE_ALIAS = 2097152

    function countSymbols(symbol: APISymbol): void {
      if (!symbol) return

      switch (symbol.kind) {
        case KIND_MODULE:
        case KIND_NAMESPACE:
          stats.modules++
          break
        case KIND_CLASS:
          stats.classes++
          break
        case KIND_INTERFACE:
          stats.interfaces++
          break
        case KIND_TYPE_ALIAS:
          stats.typeAliases++
          break
        case KIND_FUNCTION:
          stats.functions++
          break
        case KIND_VARIABLE:
          stats.variables++
          break
        case KIND_ENUM:
          stats.enums++
          break
      }

      if (symbol.children) {
        for (const child of symbol.children) {
          countSymbols(child)
        }
      }
    }

    countSymbols(api)

    stats.total = stats.modules + stats.classes + stats.interfaces + stats.typeAliases + stats.functions + stats.variables + stats.enums
    stats.outputFiles = countOutputFiles(OUTPUT_DIR)

    return stats
  } catch (err) {
    console.error(`${colors.red}Error analyzing API JSON: ${(err as Error).message}${colors.reset}`)
    return null
  }
}

/**
 * Print extraction stats
 */
function printStats(stats: ExtractionStats): void {
  console.log(`\n${colors.bold}Extraction Statistics${colors.reset}`)
  console.log(`${colors.dim}${'='.repeat(40)}${colors.reset}`)
  console.log(`  ${colors.cyan}Modules${colors.reset}:      ${stats.modules}`)
  console.log(`  ${colors.cyan}Classes${colors.reset}:      ${stats.classes}`)
  console.log(`  ${colors.cyan}Interfaces${colors.reset}:   ${stats.interfaces}`)
  console.log(`  ${colors.cyan}Type Aliases${colors.reset}: ${stats.typeAliases}`)
  console.log(`  ${colors.cyan}Functions${colors.reset}:    ${stats.functions}`)
  console.log(`  ${colors.cyan}Variables${colors.reset}:    ${stats.variables}`)
  console.log(`  ${colors.cyan}Enums${colors.reset}:        ${stats.enums}`)
  console.log(`${colors.dim}${'─'.repeat(40)}${colors.reset}`)
  console.log(`  ${colors.bold}Total Symbols${colors.reset}: ${stats.total}`)
  console.log(`  ${colors.bold}Output Files${colors.reset}:  ${stats.outputFiles}`)
  if (stats.duration > 0) {
    console.log(`  ${colors.bold}Duration${colors.reset}:      ${(stats.duration / 1000).toFixed(2)}s`)
  }
  console.log('')
}

/**
 * Generate an index file for the API reference
 */
function generateIndexFile(stats: ExtractionStats): void {
  const indexPath = resolve(OUTPUT_DIR, 'index.mdx')
  const content = `---
title: API Reference
description: Auto-generated API reference documentation for dotdo
---

# API Reference

This API reference is auto-generated from TypeScript source using TypeDoc.

## Overview

| Category | Count |
|----------|-------|
| Modules | ${stats.modules} |
| Classes | ${stats.classes} |
| Interfaces | ${stats.interfaces} |
| Type Aliases | ${stats.typeAliases} |
| Functions | ${stats.functions} |
| Variables | ${stats.variables} |
| Enums | ${stats.enums} |
| **Total** | **${stats.total}** |

## Entry Points

The following modules are documented:

- **[types](/docs/reference/generated/types)** - Core type definitions
- **[objects](/docs/reference/generated/objects)** - Durable Object classes
- **[workflows](/docs/reference/generated/workflows)** - Workflow DSL and runtime
- **[agents](/docs/reference/generated/agents)** - Agent SDK

## Generation

Last generated: ${new Date().toISOString()}

To regenerate this documentation:

\`\`\`bash
npm run docs:api
\`\`\`
`

  writeFileSync(indexPath, content)
  console.log(`${colors.green}Generated index file: ${relative(ROOT_DIR, indexPath)}${colors.reset}`)
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)

  // Parse arguments
  const jsonOnly = args.includes('--json-only')
  const html = args.includes('--html')
  const watch = args.includes('--watch')
  const showStats = args.includes('--stats')

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
TypeDoc API Extraction Script

Usage:
  npx tsx scripts/extract-api.ts              # Full extraction
  npx tsx scripts/extract-api.ts --json-only  # JSON output only
  npx tsx scripts/extract-api.ts --html       # Include HTML output
  npx tsx scripts/extract-api.ts --watch      # Watch mode
  npx tsx scripts/extract-api.ts --stats      # Show extraction stats

Output:
  - docs/reference/generated/api.json    - Full API JSON
  - docs/reference/generated/**/*.md     - Markdown pages
  - docs/reference/generated/index.html  - HTML (if --html flag)
    `)
    process.exit(0)
  }

  console.log(`\n${colors.bold}TypeDoc API Extraction${colors.reset}`)
  console.log(`${colors.dim}${'='.repeat(50)}${colors.reset}\n`)

  // Check dependencies
  if (!checkDependencies()) {
    process.exit(1)
  }

  // Ensure output directory
  ensureOutputDir()

  // Run extraction
  const startTime = Date.now()
  runTypeDoc({ jsonOnly, html, watch })
  const endTime = Date.now()

  // Don't continue if in watch mode
  if (watch) {
    return
  }

  // Analyze results
  const jsonPath = resolve(OUTPUT_DIR, 'api.json')
  const stats = analyzeApiJson(jsonPath)

  if (stats) {
    stats.duration = endTime - startTime
    printStats(stats)

    // Generate index file if not json-only
    if (!jsonOnly) {
      generateIndexFile(stats)
    }
  }

  console.log(`${colors.green}API extraction complete!${colors.reset}`)
  console.log(`${colors.dim}Output: ${relative(ROOT_DIR, OUTPUT_DIR)}${colors.reset}\n`)
}

main().catch((err) => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`)
  process.exit(1)
})
