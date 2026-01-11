/**
 * dotdo introspect - Generate .do/types.d.ts from schemas
 *
 * Usage:
 *   dotdo introspect              Generate types
 *   dotdo introspect --watch      Watch mode
 *   dotdo introspect --check      Validate only (no write)
 *   dotdo introspect --out <path> Custom output path
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, watch } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { loadAndMergeSchemas } from '../../../db/schema/mdx'
import { emitFromMdxSchema, mergeEmittedTypes, type EmittedTypes } from './emitter'

export interface IntrospectOptions {
  /** Project root directory */
  root?: string
  /** Output file path */
  out?: string
  /** Watch mode */
  watch?: boolean
  /** Check only (no write) */
  check?: boolean
  /** Verbose output */
  verbose?: boolean
}

const DEFAULT_OUTPUT = '.do/types.d.ts'

/**
 * Parse CLI arguments into options
 */
function parseArgs(args: string[]): IntrospectOptions {
  const options: IntrospectOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--watch' || arg === '-w') {
      options.watch = true
    } else if (arg === '--check' || arg === '-c') {
      options.check = true
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true
    } else if (arg === '--out' || arg === '-o') {
      options.out = args[++i]
    } else if (arg === '--root' || arg === '-r') {
      options.root = args[++i]
    } else if (!arg.startsWith('-')) {
      // Positional arg = root directory
      options.root = arg
    }
  }

  return options
}

/**
 * Generate types from project schemas
 */
async function generateTypes(options: IntrospectOptions): Promise<EmittedTypes | null> {
  const root = resolve(options.root || process.cwd())
  const outPath = options.out || join(root, DEFAULT_OUTPUT)

  if (options.verbose) {
    console.log(`📁 Scanning: ${root}`)
  }

  // Load and merge all schema files
  const merged = await loadAndMergeSchemas(root)

  if (Object.keys(merged.entities).length === 0) {
    console.log('⚠️  No schemas found. Create a DB.mdx file to get started.')
    return null
  }

  // Emit types
  const emitted = emitFromMdxSchema(
    {
      entities: merged.entities,
      source: merged.sources.join(', '),
    },
    { includeComments: true },
  )

  if (options.verbose) {
    console.log(`📦 Found ${emitted.entities.length} entities:`)
    for (const e of emitted.entities) {
      console.log(`   - ${e}`)
    }
  }

  if (options.check) {
    // Check mode - compare with existing
    if (existsSync(outPath)) {
      const existing = readFileSync(outPath, 'utf-8')
      if (existing === emitted.content) {
        console.log('✅ Types are up to date')
        return emitted
      } else {
        console.log('❌ Types are out of date. Run `dotdo introspect` to update.')
        process.exitCode = 1
        return emitted
      }
    } else {
      console.log(`❌ Types file not found: ${outPath}`)
      process.exitCode = 1
      return emitted
    }
  }

  // Write types file
  const outDir = dirname(outPath)
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }

  writeFileSync(outPath, emitted.content, 'utf-8')
  console.log(`✅ Generated ${outPath}`)
  console.log(`   ${emitted.entities.length} entities, ${emitted.events.length} events`)

  return emitted
}

/**
 * Watch mode - regenerate on file changes
 */
async function watchMode(options: IntrospectOptions): Promise<void> {
  const root = resolve(options.root || process.cwd())

  console.log(`👀 Watching for changes in ${root}...`)

  // Initial generation
  await generateTypes(options)

  // Watch for changes
  const watcher = watch(root, { recursive: true }, async (eventType, filename) => {
    if (!filename) return

    // Only watch MDX files
    if (filename.endsWith('.mdx') || filename.endsWith('.do.mdx')) {
      console.log(`\n📝 Changed: ${filename}`)
      await generateTypes({ ...options, verbose: false })
    }
  })

  // Keep process running
  process.on('SIGINT', () => {
    watcher.close()
    console.log('\n👋 Stopped watching')
    process.exit(0)
  })
}

/**
 * Main command handler
 */
export async function run(args: string[]): Promise<void> {
  const options = parseArgs(args)

  // Show help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: dotdo introspect [options] [root]

Generate TypeScript types from DB.mdx schema files.

Options:
  -o, --out <path>   Output path (default: .do/types.d.ts)
  -w, --watch        Watch mode - regenerate on changes
  -c, --check        Check if types are up to date (CI mode)
  -v, --verbose      Verbose output
  -r, --root <path>  Project root directory
  -h, --help         Show this help

Examples:
  dotdo introspect                    Generate types
  dotdo introspect --watch            Watch mode
  dotdo introspect --check            CI validation
  dotdo introspect --out types.d.ts   Custom output
`)
    return
  }

  if (options.watch) {
    await watchMode(options)
  } else {
    await generateTypes(options)
  }
}

export { emitFromMdxSchema, emitFromDOSchema, mergeEmittedTypes } from './emitter'
