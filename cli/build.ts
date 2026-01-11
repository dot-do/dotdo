#!/usr/bin/env bun
/**
 * Build Script
 *
 * Compiles the CLI into a self-contained binary using Bun.
 * The binary includes all dependencies and works without Bun installed.
 */

import * as fs from 'fs'
import * as path from 'path'

interface BuildOptions {
  target?: 'bun-darwin-arm64' | 'bun-darwin-x64' | 'bun-linux-arm64' | 'bun-linux-x64' | 'bun-windows-x64'
  outfile?: string
  minify?: boolean
  sourcemap?: boolean
}

const defaultTargets: BuildOptions['target'][] = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-arm64',
  'bun-linux-x64',
]

async function build(options: BuildOptions = {}): Promise<void> {
  const cliDir = path.dirname(new URL(import.meta.url).pathname)
  const entryPoint = path.join(cliDir, 'main.ts')
  const outDir = path.join(cliDir, 'dist')

  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  // Determine targets
  const targets = options.target ? [options.target] : defaultTargets

  console.log('Building dotdo CLI...')
  console.log()

  for (const target of targets) {
    const [, platform, arch] = target.split('-')
    const ext = platform === 'windows' ? '.exe' : ''
    const outfile = options.outfile ?? path.join(outDir, `dotdo-${platform}-${arch}${ext}`)

    console.log(`  Target: ${target}`)
    console.log(`  Output: ${outfile}`)

    try {
      const startTime = Date.now()

      const result = await Bun.build({
        entrypoints: [entryPoint],
        outdir: outDir,
        target,
        minify: options.minify ?? true,
        sourcemap: options.sourcemap ? 'external' : 'none',
        external: [
          // These need to be external for native modules
          'better-sqlite3',
        ],
        define: {
          'process.env.NODE_ENV': '"production"',
        },
      })

      if (!result.success) {
        console.error('Build failed:')
        for (const log of result.logs) {
          console.error(log)
        }
        process.exit(1)
      }

      // Compile to binary
      const proc = Bun.spawn(['bun', 'build', entryPoint, '--compile', '--target', target, '--outfile', outfile], {
        cwd: cliDir,
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const exitCode = await proc.exited

      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        console.error(`  Error: ${stderr}`)
        continue
      }

      const duration = Date.now() - startTime
      const stats = fs.statSync(outfile)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

      console.log(`  Size:   ${sizeMB} MB`)
      console.log(`  Time:   ${duration}ms`)
      console.log()
    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`)
      console.log()
    }
  }

  console.log('Build complete!')
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const options: BuildOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--target' && args[i + 1]) {
      options.target = args[++i] as BuildOptions['target']
    } else if (arg === '--outfile' && args[i + 1]) {
      options.outfile = args[++i]
    } else if (arg === '--no-minify') {
      options.minify = false
    } else if (arg === '--sourcemap') {
      options.sourcemap = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
dotdo CLI Build Script

Usage: bun run build.ts [options]

Options:
  --target <target>   Build for specific target
                      (bun-darwin-arm64, bun-darwin-x64, bun-linux-arm64, bun-linux-x64, bun-windows-x64)
  --outfile <path>    Output file path
  --no-minify         Disable minification
  --sourcemap         Include source maps
  -h, --help          Show this help

Examples:
  bun run build.ts                    # Build for all targets
  bun run build.ts --target bun-darwin-arm64  # macOS ARM only
  bun run build.ts --outfile ./dotdo  # Custom output path
`)
      process.exit(0)
    }
  }

  await build(options)
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('Build failed:', error)
    process.exit(1)
  })
}

export { build, type BuildOptions }
