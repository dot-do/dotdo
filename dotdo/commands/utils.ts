/**
 * Shared CLI Utilities
 *
 * Common functions used across multiple CLI commands.
 */

import { spawn, type ChildProcess } from 'child_process'
import { resolve } from 'path'
import { existsSync } from 'fs'

/**
 * Find wrangler binary in node_modules or global install.
 *
 * Search order:
 * 1. Local node_modules/.bin/wrangler
 * 2. Workspace root node_modules/.bin/wrangler
 * 3. Global wrangler (fallback)
 */
export function findWrangler(): string {
  // Try local node_modules first
  const localWrangler = resolve(process.cwd(), 'node_modules', '.bin', 'wrangler')
  if (existsSync(localWrangler)) {
    return localWrangler
  }

  // Try workspace root
  const workspaceWrangler = resolve(process.cwd(), '..', '..', 'node_modules', '.bin', 'wrangler')
  if (existsSync(workspaceWrangler)) {
    return workspaceWrangler
  }

  // Fall back to global wrangler
  return 'wrangler'
}

/**
 * Result type for runWrangler function
 */
export interface WranglerResult {
  output: string
  exitCode: number
}

/**
 * Run a wrangler command and capture output.
 *
 * @param args - Arguments to pass to wrangler
 * @returns Promise resolving to output and exit code
 */
export async function runWrangler(args: string[]): Promise<WranglerResult> {
  const wranglerPath = findWrangler()

  return new Promise((resolve) => {
    let output = ''
    let error = ''

    const proc = spawn(wranglerPath, args, {
      cwd: process.cwd(),
      env: process.env,
    })

    if (proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString()
      })
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        error += data.toString()
      })
    }

    proc.on('close', (code) => {
      resolve({
        output: output || error,
        exitCode: code || 0,
      })
    })

    proc.on('error', (err) => {
      resolve({
        output: err.message,
        exitCode: 1,
      })
    })
  })
}

/**
 * Run a wrangler command and reject on non-zero exit.
 *
 * @param args - Arguments to pass to wrangler
 * @returns Promise resolving to output string
 * @throws Error if wrangler exits with non-zero code
 */
export async function runWranglerOrThrow(args: string[]): Promise<string> {
  const wranglerPath = findWrangler()

  return new Promise((resolve, reject) => {
    let output = ''
    let error = ''

    const proc = spawn(wranglerPath, args, {
      cwd: process.cwd(),
      env: process.env,
    })

    if (proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString()
      })
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        error += data.toString()
      })
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output)
      } else {
        reject(new Error(error || `wrangler exited with code ${code}`))
      }
    })

    proc.on('error', reject)
  })
}
