/**
 * CLI Output Utilities - do-gr641
 *
 * Provides consistent output formatting for CLI commands.
 * Supports both human-readable and JSON output modes for scripting.
 */

/**
 * Output options shared by all commands
 */
export interface OutputOptions {
  /** Output as JSON for scripting */
  json?: boolean
  /** Enable verbose output */
  verbose?: boolean
}

/**
 * Result wrapper for consistent JSON output format
 */
export interface CommandResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

/**
 * Output helper that handles both JSON and human-readable formats
 */
export class Output {
  private json: boolean
  private verbose: boolean
  private buffer: string[] = []

  constructor(options: OutputOptions = {}) {
    this.json = options.json ?? false
    this.verbose = options.verbose ?? false
  }

  /**
   * Check if JSON mode is enabled
   */
  isJson(): boolean {
    return this.json
  }

  /**
   * Check if verbose mode is enabled
   */
  isVerbose(): boolean {
    return this.verbose
  }

  /**
   * Print a message (only in non-JSON mode)
   */
  log(message: string): void {
    if (!this.json) {
      console.log(message)
    }
  }

  /**
   * Print an info message with formatting (only in non-JSON mode)
   */
  info(message: string): void {
    if (!this.json) {
      console.log(`  \x1b[36m${message}\x1b[0m`)
    }
  }

  /**
   * Print a success message (only in non-JSON mode)
   */
  success(message: string): void {
    if (!this.json) {
      console.log(`  \x1b[32m${message}\x1b[0m`)
    }
  }

  /**
   * Print a warning message (only in non-JSON mode)
   */
  warn(message: string): void {
    if (!this.json) {
      console.log(`  \x1b[33m${message}\x1b[0m`)
    }
  }

  /**
   * Print an error message (only in non-JSON mode)
   */
  error(message: string): void {
    if (!this.json) {
      console.error(`  \x1b[31m${message}\x1b[0m`)
    }
  }

  /**
   * Print a debug message (only in verbose non-JSON mode)
   */
  debug(message: string, data?: unknown): void {
    if (this.verbose && !this.json) {
      if (data !== undefined) {
        console.log(`[debug] ${message}`, data)
      } else {
        console.log(`[debug] ${message}`)
      }
    }
  }

  /**
   * Print a blank line (only in non-JSON mode)
   */
  blank(): void {
    if (!this.json) {
      console.log('')
    }
  }

  /**
   * Print dimmed/muted text (only in non-JSON mode)
   */
  dim(message: string): void {
    if (!this.json) {
      console.log(`  \x1b[2m${message}\x1b[0m`)
    }
  }

  /**
   * Print bold text (only in non-JSON mode)
   */
  bold(message: string): void {
    if (!this.json) {
      console.log(`  \x1b[1m${message}\x1b[0m`)
    }
  }

  /**
   * Output final result as JSON (if JSON mode) or success message
   */
  result<T>(result: CommandResult<T>): void {
    if (this.json) {
      console.log(JSON.stringify(result))
    } else if (result.success && result.message) {
      this.success(result.message)
    } else if (!result.success && result.error) {
      this.error(result.error)
    }
  }

  /**
   * Output data - JSON in json mode, formatted in normal mode
   */
  data<T>(data: T, formatter?: (data: T) => string): void {
    if (this.json) {
      console.log(JSON.stringify(data))
    } else if (formatter) {
      console.log(formatter(data))
    } else {
      console.log(JSON.stringify(data, null, 2))
    }
  }

  /**
   * Output error and exit with code
   */
  fatal(error: string, exitCode: number = 1): never {
    if (this.json) {
      console.log(JSON.stringify({ success: false, error }))
    } else {
      this.error(error)
    }
    process.exit(exitCode)
  }

  /**
   * Format a table for human-readable output
   */
  table(headers: string[], rows: string[][]): void {
    if (this.json) {
      return // Tables are not output in JSON mode
    }

    // Calculate column widths
    const widths = headers.map((h, i) => {
      const maxRowWidth = Math.max(...rows.map(r => (r[i] || '').length))
      return Math.max(h.length, maxRowWidth)
    })

    // Print header
    const headerLine = headers.map((h, i) => h.padEnd(widths[i] || 0)).join('  ')
    console.log(`  ${headerLine}`)
    console.log(`  ${widths.map(w => '-'.repeat(w)).join('  ')}`)

    // Print rows
    for (const row of rows) {
      const rowLine = row.map((cell, i) => (cell || '').padEnd(widths[i] || 0)).join('  ')
      console.log(`  ${rowLine}`)
    }
  }
}

/**
 * Create an output helper instance
 */
export function createOutput(options: OutputOptions = {}): Output {
  return new Output(options)
}
