/**
 * Build Command - do-tqkb
 *
 * Build the project for deployment using wrangler.
 * Supports minification, sourcemaps, and output directory configuration.
 */

import { spawn, type ChildProcess } from 'child_process'
import { resolve as pathResolve, join } from 'path'
import { existsSync, mkdirSync } from 'fs'

export const name = 'build'
export const description = 'Build project for deployment'

export interface BuildOptions {
  /** Minify output */
  minify?: boolean
  /** Generate sourcemaps */
  sourcemap?: boolean
  /** Output directory */
  outdir?: string
  /** Path to wrangler config */
  config?: string
  /** Environment to build for */
  env?: string
  /** Enable verbose output */
  verbose?: boolean
}

export interface BuildResult {
  success: boolean
  exitCode: number
  outputPath?: string | undefined
  duration?: number | undefined
}

/**
 * Find wrangler binary
 */
function findWrangler(): string {
  const localWrangler = pathResolve(process.cwd(), 'node_modules', '.bin', 'wrangler')
  if (existsSync(localWrangler)) {
    return localWrangler
  }

  const workspaceWrangler = pathResolve(process.cwd(), '..', '..', 'node_modules', '.bin', 'wrangler')
  if (existsSync(workspaceWrangler)) {
    return workspaceWrangler
  }

  return 'wrangler'
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Main build command function
 */
export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  const {
    minify = false,
    sourcemap = false,
    outdir,
    config,
    env,
    verbose = false,
  } = options

  const startTime = Date.now()

  if (verbose) {
    console.log('[build] Options:', options)
  }

  // Display header
  console.log('')
  console.log('  \x1b[36mBuilding...\x1b[0m')
  console.log('')

  const wranglerPath = findWrangler()
  const args = ['deploy', '--dry-run']

  // Add config file if specified
  if (config) {
    args.push('--config', config)
  }

  // Add environment if specified
  if (env) {
    args.push('--env', env)
  }

  // Add minify flag
  if (minify) {
    args.push('--minify')
  }

  // Add output directory if specified
  if (outdir) {
    // Ensure output directory exists
    const fullOutdir = pathResolve(process.cwd(), outdir)
    if (!existsSync(fullOutdir)) {
      mkdirSync(fullOutdir, { recursive: true })
    }
    args.push('--outdir', fullOutdir)
  }

  if (verbose) {
    console.log(`  \x1b[2mRunning: ${wranglerPath} ${args.join(' ')}\x1b[0m`)
    console.log('')
  }

  return new Promise((resolve) => {
    let output = ''
    let hasError = false

    const proc = spawn(wranglerPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FORCE_COLOR: '1',
      },
    })

    // Handle stdout
    if (proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString()
        output += text

        if (verbose) {
          // Show all output in verbose mode
          process.stdout.write(text)
        } else {
          // Only show important messages
          const lines = text.split('\n')
          for (const line of lines) {
            if (
              line.includes('Building') ||
              line.includes('Bundled') ||
              line.includes('Error') ||
              line.includes('Warning')
            ) {
              console.log(`  ${line}`)
            }
          }
        }
      })
    }

    // Handle stderr
    if (proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString()

        // Filter out wrangler info messages unless verbose
        if (!verbose) {
          const importantPatterns = [/error/i, /warning/i, /failed/i]
          if (importantPatterns.some((p) => p.test(text))) {
            console.error(text)
            hasError = true
          }
        } else {
          process.stderr.write(text)
        }
      })
    }

    // Handle process errors
    proc.on('error', (error) => {
      if (error.message.includes('ENOENT')) {
        console.error('  \x1b[31mError: wrangler not found.\x1b[0m')
        console.error('  \x1b[31mInstall with: npm install -D wrangler\x1b[0m')
      } else {
        console.error(`  \x1b[31mError: ${error.message}\x1b[0m`)
      }

      resolve({
        success: false,
        exitCode: 1,
      })
    })

    // Handle process exit
    proc.on('close', (code) => {
      const duration = Date.now() - startTime
      const success = code === 0

      console.log('')

      if (success) {
        console.log(`  \x1b[32mBuild completed in ${formatDuration(duration)}\x1b[0m`)

        if (outdir) {
          console.log(`  \x1b[2mOutput: ${pathResolve(process.cwd(), outdir)}\x1b[0m`)
        }
      } else {
        console.log(`  \x1b[31mBuild failed with exit code ${code}\x1b[0m`)
      }

      console.log('')

      resolve({
        success,
        exitCode: code || 0,
        outputPath: outdir ? pathResolve(process.cwd(), outdir) : undefined,
        duration,
      })
    })
  })
}

/**
 * CLI command handler
 */
export function buildCommand(options: BuildOptions = {}): Promise<BuildResult> {
  return build(options)
}
