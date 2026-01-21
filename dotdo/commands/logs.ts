/**
 * Logs Command - do-tqkb
 *
 * Tail logs from deployed workers using wrangler tail.
 * Supports real-time log streaming with filtering.
 */

import { spawn } from 'child_process'
import { findWrangler } from './utils'

export const name = 'logs'
export const description = 'Tail logs from deployed worker'

export interface LogsOptions {
  /** Follow logs in real-time */
  follow?: boolean
  /** Filter by log level */
  level?: 'debug' | 'info' | 'warn' | 'error'
  /** Worker name (defaults to wrangler.toml name) */
  name?: string
  /** Environment to target */
  env?: string
  /** Path to wrangler config */
  config?: string
  /** Output as JSON for scripting */
  json?: boolean
  /** Enable verbose output */
  verbose?: boolean
}

export interface LogEntry {
  timestamp: string
  level: string
  message: string
  outcome?: string
  scriptName?: string
  exceptions?: Array<{ name: string; message: string }>
  logs?: Array<{ message: string[]; level: string; timestamp: number }>
}

/**
 * Format a log entry for display
 */
function formatLogEntry(entry: LogEntry): string {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString()
  const level = entry.level.toUpperCase().padEnd(5)

  // Color-code by level
  let levelColor: string
  switch (entry.level) {
    case 'error':
      levelColor = '\x1b[31m' // Red
      break
    case 'warn':
      levelColor = '\x1b[33m' // Yellow
      break
    case 'info':
      levelColor = '\x1b[36m' // Cyan
      break
    case 'debug':
      levelColor = '\x1b[90m' // Gray
      break
    default:
      levelColor = '\x1b[0m' // Default
  }

  let output = `\x1b[2m${timestamp}\x1b[0m ${levelColor}${level}\x1b[0m ${entry.message}`

  // Add exceptions if present
  if (entry.exceptions && entry.exceptions.length > 0) {
    for (const exc of entry.exceptions) {
      output += `\n  \x1b[31mException: ${exc.name}: ${exc.message}\x1b[0m`
    }
  }

  // Add console.log entries if present
  if (entry.logs && entry.logs.length > 0) {
    for (const log of entry.logs) {
      const logLevel = log.level || 'log'
      output += `\n  [${logLevel}] ${log.message.join(' ')}`
    }
  }

  return output
}

/**
 * Parse JSON log output from wrangler tail
 */
function parseLogLine(line: string): LogEntry | null {
  try {
    const data = JSON.parse(line)

    // wrangler tail outputs different formats
    if (data.outcome !== undefined) {
      // Request log format
      return {
        timestamp: new Date().toISOString(),
        level: data.outcome === 'ok' ? 'info' : 'error',
        message: `${data.event?.request?.method || 'REQUEST'} ${data.event?.request?.url || ''} - ${data.outcome}`,
        outcome: data.outcome,
        scriptName: data.scriptName,
        exceptions: data.exceptions,
        logs: data.logs,
      }
    } else if (data.message) {
      // Simple log format
      return {
        timestamp: data.timestamp || new Date().toISOString(),
        level: data.level || 'info',
        message: data.message,
      }
    }

    return null
  } catch {
    // Not JSON, treat as plain text
    return {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: line,
    }
  }
}

/**
 * Main logs command function
 */
export async function logs(options: LogsOptions = {}): Promise<void> {
  const {
    follow = true,
    level = 'info',
    name: workerName,
    env,
    config,
    json = false,
    verbose = false,
  } = options

  const wranglerPath = findWrangler()
  const args = ['tail']

  // Add worker name if specified
  if (workerName) {
    args.push(workerName)
  }

  // Add environment if specified
  if (env) {
    args.push('--env', env)
  }

  // Add config file if specified
  if (config) {
    args.push('--config', config)
  }

  // Request JSON format for parsing
  args.push('--format', 'json')

  // Log level filter
  const levelOrder = ['debug', 'info', 'warn', 'error']
  const minLevel = levelOrder.indexOf(level)

  if (verbose) {
    console.log(`[logs] Starting wrangler tail with args:`, args)
  }

  // Display header (only in non-JSON mode)
  if (!json) {
    console.log('')
    console.log('  \x1b[36mTailing logs...\x1b[0m')
    console.log('  \x1b[2mPress Ctrl+C to stop\x1b[0m')
    console.log('')
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(wranglerPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FORCE_COLOR: json ? '0' : '1',
      },
    })

    // Handle stdout
    if (proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean)

        for (const line of lines) {
          const entry = parseLogLine(line)

          if (!entry) continue

          // Filter by level
          const entryLevel = levelOrder.indexOf(entry.level)
          if (entryLevel < minLevel) continue

          if (json) {
            console.log(JSON.stringify(entry))
          } else {
            console.log(formatLogEntry(entry))
          }
        }
      })
    }

    // Handle stderr
    if (proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        const output = data.toString().trim()

        // Filter out wrangler info messages unless verbose
        if (!verbose && (output.includes('Authenticating') || output.includes('Successfully'))) {
          return
        }

        // In JSON mode, output errors as JSON
        if (json && output) {
          console.log(JSON.stringify({ type: 'error', message: output }))
        } else if (output) {
          console.error('\x1b[2m' + output + '\x1b[0m')
        }
      })
    }

    // Handle process errors
    proc.on('error', (error) => {
      if (json) {
        console.log(JSON.stringify({ type: 'error', message: error.message }))
      } else if (error.message.includes('ENOENT')) {
        console.error('Error: wrangler not found. Install with: npm install -D wrangler')
      } else {
        console.error('Error:', error.message)
      }
      reject(error)
    })

    // Handle process exit
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        if (json) {
          console.log(JSON.stringify({ type: 'exit', code }))
        } else {
          console.error(`\nLogs stream ended with code ${code}`)
        }
      }
      resolve()
    })

    // Handle graceful shutdown
    const shutdown = () => {
      if (!json) {
        console.log('\n\n  \x1b[2mStopping log stream...\x1b[0m\n')
      }
      proc.kill()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}

/**
 * CLI command handler
 */
export function logsCommand(options: LogsOptions = {}): Promise<void> {
  return logs(options)
}
