/**
 * DO Inspect Command - do-tqkb
 *
 * Inspect a Durable Object's state and metadata.
 * Shows storage contents, alarms, and WebSocket connections.
 */

import { spawn, type ChildProcess } from 'child_process'
import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'

export const name = 'do-inspect'
export const description = 'Inspect a Durable Object'

export interface DoInspectOptions {
  /** Durable Object ID to inspect */
  id: string
  /** Namespace/binding name */
  namespace?: string
  /** Path to wrangler config */
  config?: string
  /** Output format */
  format?: 'table' | 'json'
  /** Show storage contents */
  storage?: boolean
  /** Enable verbose output */
  verbose?: boolean
}

export interface DoInspectResult {
  id: string
  namespace?: string
  exists: boolean
  storage?: {
    keys: string[]
    size: number
    entries?: Record<string, unknown>
  }
  alarm?: {
    scheduled: string | null
  }
  websockets?: {
    count: number
  }
  metadata?: Record<string, unknown>
}

/**
 * Find wrangler binary
 */
function findWrangler(): string {
  const localWrangler = resolve(process.cwd(), 'node_modules', '.bin', 'wrangler')
  if (existsSync(localWrangler)) {
    return localWrangler
  }

  const workspaceWrangler = resolve(process.cwd(), '..', '..', 'node_modules', '.bin', 'wrangler')
  if (existsSync(workspaceWrangler)) {
    return workspaceWrangler
  }

  return 'wrangler'
}

/**
 * Run a wrangler command and capture output
 */
async function runWrangler(args: string[]): Promise<string> {
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

/**
 * Format inspect result as table
 */
function formatTable(result: DoInspectResult): string {
  const lines: string[] = []

  lines.push(`  \x1b[1mDurable Object\x1b[0m`)
  lines.push(`  ${'ID:'.padEnd(12)} ${result.id}`)

  if (result.namespace) {
    lines.push(`  ${'Namespace:'.padEnd(12)} ${result.namespace}`)
  }

  lines.push(`  ${'Exists:'.padEnd(12)} ${result.exists ? '\x1b[32myes\x1b[0m' : '\x1b[31mno\x1b[0m'}`)

  if (result.storage) {
    lines.push('')
    lines.push(`  \x1b[1mStorage\x1b[0m`)
    lines.push(`  ${'Keys:'.padEnd(12)} ${result.storage.keys.length}`)
    lines.push(`  ${'Size:'.padEnd(12)} ${formatBytes(result.storage.size)}`)

    if (result.storage.entries && Object.keys(result.storage.entries).length > 0) {
      lines.push('')
      lines.push(`  \x1b[2mEntries:\x1b[0m`)
      for (const [key, value] of Object.entries(result.storage.entries)) {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
        const truncated = valueStr.length > 50 ? valueStr.slice(0, 47) + '...' : valueStr
        lines.push(`    ${key}: ${truncated}`)
      }
    }
  }

  if (result.alarm) {
    lines.push('')
    lines.push(`  \x1b[1mAlarm\x1b[0m`)
    lines.push(
      `  ${'Scheduled:'.padEnd(12)} ${result.alarm.scheduled || '\x1b[2mnone\x1b[0m'}`
    )
  }

  if (result.websockets) {
    lines.push('')
    lines.push(`  \x1b[1mWebSockets\x1b[0m`)
    lines.push(`  ${'Connected:'.padEnd(12)} ${result.websockets.count}`)
  }

  return lines.join('\n')
}

/**
 * Format bytes to human-readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

/**
 * Main do inspect command function
 */
export async function doInspect(options: DoInspectOptions): Promise<DoInspectResult> {
  const { id, namespace, config, format = 'table', storage = true, verbose = false } = options

  if (verbose) {
    console.log('[do inspect] Options:', options)
  }

  // Currently, wrangler doesn't have a direct "inspect DO" command
  // We need to use the DO's storage API or make an HTTP request to the DO

  // Build result with available info
  const result: DoInspectResult = {
    id,
    namespace,
    exists: true, // Assume exists - would need API call to verify
  }

  // Try to get storage info if available via local dev
  // In production, this would require an API endpoint on the DO

  if (storage) {
    result.storage = {
      keys: [],
      size: 0,
      entries: {},
    }

    // Note: Actual storage inspection requires either:
    // 1. A running local dev server with the DO
    // 2. An API endpoint exposed by the DO for introspection
    // 3. Direct API access (which requires authentication)

    // For now, we'll show a placeholder message
    if (verbose) {
      console.log('[do inspect] Storage inspection requires a running DO instance')
    }
  }

  // Output
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log('')
    console.log(formatTable(result))
    console.log('')
    console.log('  \x1b[2mNote: Full inspection requires a running DO instance.\x1b[0m')
    console.log('  \x1b[2mRun "dotdo dev" and make requests to inspect storage.\x1b[0m')
    console.log('')
  }

  return result
}

/**
 * CLI command handler
 */
export function doInspectCommand(id: string, options: Omit<DoInspectOptions, 'id'> = {}): Promise<DoInspectResult> {
  return doInspect({ id, ...options })
}
