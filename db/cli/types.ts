/**
 * CLI Types for @dotdo/db
 *
 * Type definitions for CLI argument parsing and output.
 */

// =============================================================================
// Argument Parsing
// =============================================================================

/**
 * Parsed command-line arguments
 */
export interface ParsedArgs {
  /** Primary command (e.g., 'init', 'query', 'create') */
  command: string | undefined
  /** Positional arguments after the command */
  args: string[]
  /** Named options (--flag value or -f value) */
  options: Record<string, string | boolean>
  /** Raw argument string */
  raw: string[]
}

/**
 * Parse command-line arguments
 *
 * Supports:
 * - Positional args: db query Organization
 * - Long options: --format json, --pretty
 * - Short options: -f json, -p
 * - Boolean flags: --verbose, -v
 * - Combined short flags: -pv
 *
 * @param argv - Array of command-line arguments (typically process.argv.slice(2))
 * @returns Parsed arguments object
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: undefined,
    args: [],
    options: {},
    raw: argv
  }

  let i = 0

  while (i < argv.length) {
    const arg = argv[i]

    // Long option: --flag or --flag=value
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=')
      if (eqIndex !== -1) {
        // --flag=value
        const key = arg.slice(2, eqIndex)
        const value = arg.slice(eqIndex + 1)
        result.options[key] = value
      } else {
        // --flag or --flag value
        const key = arg.slice(2)
        const nextArg = argv[i + 1]

        // Check if next arg is a value or another flag
        if (nextArg && !nextArg.startsWith('-')) {
          result.options[key] = nextArg
          i++
        } else {
          result.options[key] = true
        }
      }
    }
    // Short option: -f or -f value
    else if (arg.startsWith('-') && arg.length > 1) {
      const flags = arg.slice(1)

      // Single flag with potential value
      if (flags.length === 1) {
        const key = flags
        const nextArg = argv[i + 1]

        if (nextArg && !nextArg.startsWith('-')) {
          result.options[key] = nextArg
          i++
        } else {
          result.options[key] = true
        }
      }
      // Combined flags: -pv
      else {
        for (const flag of flags) {
          result.options[flag] = true
        }
      }
    }
    // Positional argument
    else {
      if (!result.command) {
        result.command = arg
      } else {
        result.args.push(arg)
      }
    }

    i++
  }

  // Map common option aliases
  if (result.options.h) {
    result.options.help = true
    delete result.options.h
  }
  if (result.options.v && !result.options.verbose) {
    result.options.version = true
    delete result.options.v
  }
  if (result.options.p) {
    result.options.pretty = true
    delete result.options.p
  }
  if (result.options.f) {
    result.options.format = result.options.f as string
    delete result.options.f
  }
  if (result.options.d) {
    result.options.directory = result.options.d as string
    delete result.options.d
  }
  if (result.options.o) {
    result.options.output = result.options.o as string
    delete result.options.o
  }
  if (result.options.l) {
    result.options.limit = result.options.l as string
    delete result.options.l
  }

  return result
}

// =============================================================================
// Output Formatting
// =============================================================================

/** ANSI color codes for terminal output */
export const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
}

/**
 * Check if stdout supports colors
 */
export function supportsColor(): boolean {
  if (typeof process === 'undefined') return false
  if (process.env.NO_COLOR || process.env.TERM === 'dumb') return false
  if (process.env.FORCE_COLOR) return true
  return process.stdout?.isTTY ?? false
}

/**
 * Apply color if supported
 */
export function colorize(text: string, color: keyof typeof colors): string {
  if (!supportsColor()) return text
  return `${colors[color]}${text}${colors.reset}`
}

/**
 * Print to stdout
 */
export function print(message: string): void {
  console.log(message)
}

/**
 * Print error to stderr
 */
export function printError(message: string): void {
  console.error(colorize(`Error: ${message}`, 'red'))
}

/**
 * Print success message
 */
export function printSuccess(message: string): void {
  console.log(colorize(`✓ ${message}`, 'green'))
}

/**
 * Print warning message
 */
export function printWarning(message: string): void {
  console.log(colorize(`⚠ ${message}`, 'yellow'))
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(colorize(message, 'cyan'))
}

/**
 * Print dimmed/debug message
 */
export function printDim(message: string): void {
  console.log(colorize(message, 'dim'))
}

/**
 * Print JSON output
 */
export function printJson(data: unknown, pretty = true): void {
  if (pretty) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(JSON.stringify(data))
  }
}

/**
 * Format a table for terminal output
 */
export function formatTable(
  rows: Record<string, unknown>[],
  columns?: string[]
): string {
  if (rows.length === 0) return 'No results'

  // Determine columns
  const cols = columns ?? Object.keys(rows[0])

  // Calculate column widths
  const widths = new Map<string, number>()
  for (const col of cols) {
    widths.set(col, col.length)
  }
  for (const row of rows) {
    for (const col of cols) {
      const value = String(row[col] ?? '')
      const current = widths.get(col) ?? 0
      widths.set(col, Math.max(current, value.length))
    }
  }

  // Build header
  const header = cols.map((col) => col.padEnd(widths.get(col)!)).join('  ')
  const separator = cols.map((col) => '-'.repeat(widths.get(col)!)).join('  ')

  // Build rows
  const lines = rows.map((row) =>
    cols.map((col) => String(row[col] ?? '').padEnd(widths.get(col)!)).join('  ')
  )

  return [header, separator, ...lines].join('\n')
}

/**
 * Print a table
 */
export function printTable(
  rows: Record<string, unknown>[],
  columns?: string[]
): void {
  print(formatTable(rows, columns))
}

// =============================================================================
// Progress Indicators
// =============================================================================

/**
 * Simple spinner for long-running operations
 */
export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  private current = 0
  private interval: NodeJS.Timeout | null = null
  private message: string

  constructor(message: string) {
    this.message = message
  }

  start(): void {
    if (!supportsColor()) {
      print(this.message)
      return
    }

    this.interval = setInterval(() => {
      process.stdout.write(`\r${this.frames[this.current]} ${this.message}`)
      this.current = (this.current + 1) % this.frames.length
    }, 80)
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      process.stdout.write('\r' + ' '.repeat(this.message.length + 3) + '\r')
    }
    if (finalMessage) {
      print(finalMessage)
    }
  }

  succeed(message?: string): void {
    this.stop()
    printSuccess(message ?? this.message)
  }

  fail(message?: string): void {
    this.stop()
    printError(message ?? this.message)
  }
}

/**
 * Create and start a spinner
 */
export function spinner(message: string): Spinner {
  const s = new Spinner(message)
  s.start()
  return s
}
