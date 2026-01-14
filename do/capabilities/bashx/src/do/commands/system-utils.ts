/**
 * System Utilities Commands
 *
 * Native implementations for system utility commands:
 * - sleep: Delay execution for a specified duration
 * - yes: Output a string repeatedly
 * - seq: Generate number sequences
 * - pwd: Print working directory
 * - whoami: Print current username
 * - hostname: Print system hostname
 * - printenv: Print environment variables
 *
 * @module bashx/do/commands/system-utils
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Execution context for system utility commands
 */
export interface SystemUtilsContext {
  /** Current working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string | undefined>
  /** Standard input */
  stdin?: string
  /** Username for whoami */
  user?: string
  /** Hostname for hostname command */
  hostname?: string
}

/**
 * Result from command execution
 */
export interface CommandResult {
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Exit code (0 = success) */
  exitCode: number
}

/**
 * Options for sleep command
 */
export interface SleepOptions {
  /** Maximum duration in milliseconds (for safety limits) */
  maxDuration?: number
}

/**
 * Options for yes command
 */
export interface YesOptions {
  /** Maximum number of lines to output (safety limit) */
  maxLines?: number
}

/**
 * Options for seq command
 */
export interface SeqOptions {
  /** Output separator (default: newline) */
  separator?: string
  /** Equal-width padding with leading zeros */
  equalWidth?: boolean
  /** Printf-style format string */
  format?: string
}

/**
 * Options for pwd command
 */
export interface PwdOptions {
  /** -L: Use logical path (with symlinks) */
  logical?: boolean
  /** -P: Use physical path (resolve symlinks) */
  physical?: boolean
}

/**
 * Options for printenv command
 */
export interface PrintenvOptions {
  /** Use null byte as separator instead of newline */
  null?: boolean
}

// ============================================================================
// SET OF COMMANDS
// ============================================================================

/**
 * Set of system utility commands handled by this module
 */
export const SYSTEM_UTILS_COMMANDS = new Set([
  'sleep',
  'yes',
  'seq',
  'pwd',
  'whoami',
  'hostname',
  'printenv',
])

/**
 * Check if a command is a system utility command
 */
export function isSystemUtilsCommand(cmd: string): boolean {
  return SYSTEM_UTILS_COMMANDS.has(cmd)
}

// ============================================================================
// TIMING UTILITIES
// ============================================================================

/**
 * Time unit multipliers in milliseconds
 */
const TIME_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
}

/**
 * Parse a duration string into milliseconds
 *
 * @param duration - Duration string with optional unit suffix (s, m, h, d)
 * @returns Duration in milliseconds
 * @throws Error if duration format is invalid
 *
 * @example
 * ```typescript
 * parseDuration('5')     // 5000 (seconds)
 * parseDuration('1.5s')  // 1500
 * parseDuration('2m')    // 120000
 * parseDuration('1h')    // 3600000
 * parseDuration('1d')    // 86400000
 * ```
 */
export function parseDuration(duration: string): number {
  // Handle 'infinity' case
  if (duration.toLowerCase() === 'infinity') {
    return Infinity
  }

  const match = duration.match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/i)
  if (!match) {
    throw new Error(`Invalid duration: ${duration}`)
  }

  const value = parseFloat(match[1])
  const unit = match[2]?.toLowerCase() || 's'

  return value * (TIME_UNIT_MS[unit] ?? 1000)
}

/**
 * Create a delay promise
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// SLEEP COMMAND
// ============================================================================

/**
 * Execute sleep command - delay for a specified duration
 *
 * Supports multiple duration arguments which are summed together.
 * Durations can have suffixes: s (seconds, default), m (minutes),
 * h (hours), d (days).
 *
 * @param args - Duration arguments
 * @param options - Sleep options
 * @returns Promise resolving to command result
 *
 * @example
 * ```typescript
 * await executeSleep(['1'])        // Sleep 1 second
 * await executeSleep(['0.5'])      // Sleep 500ms
 * await executeSleep(['1m'])       // Sleep 1 minute
 * await executeSleep(['1', '2'])   // Sleep 3 seconds total
 * ```
 */
export async function executeSleep(
  args: string[],
  options: SleepOptions = {}
): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'sleep: missing operand',
      exitCode: 1,
    }
  }

  const maxDuration = options.maxDuration ?? 600000 // 10 minutes default max

  try {
    let totalMs = 0

    for (const duration of args) {
      const ms = parseDuration(duration)

      if (ms < 0) {
        return {
          stdout: '',
          stderr: `sleep: invalid time interval '${duration}'`,
          exitCode: 1,
        }
      }

      if (!isFinite(ms)) {
        // Infinity - would sleep forever, but we'll cap it
        return {
          stdout: '',
          stderr: 'sleep: cannot sleep indefinitely in this environment',
          exitCode: 1,
        }
      }

      totalMs += ms
    }

    // Apply safety limit
    const actualDuration = Math.min(totalMs, maxDuration)
    await delay(actualDuration)

    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      stdout: '',
      stderr: `sleep: ${message}`,
      exitCode: 1,
    }
  }
}

// ============================================================================
// YES COMMAND
// ============================================================================

/**
 * Execute yes command - output string repeatedly
 *
 * Outputs "y" (or the specified string) repeatedly, one per line.
 * Limited to maxLines for safety in non-streaming environments.
 *
 * @param args - Optional string to repeat (default: "y")
 * @param options - Yes options
 * @returns Command result
 *
 * @example
 * ```typescript
 * executeYes([])           // "y\ny\ny\n..." (1000 times)
 * executeYes(['hello'])    // "hello\nhello\nhello\n..." (1000 times)
 * executeYes(['a', 'b'])   // "a b\na b\na b\n..." (arguments joined)
 * ```
 */
export function executeYes(
  args: string[],
  options: YesOptions = {}
): CommandResult {
  const maxLines = options.maxLines ?? 1000
  const output = args.length > 0 ? args.join(' ') : 'y'

  const lines: string[] = []
  for (let i = 0; i < maxLines; i++) {
    lines.push(output)
  }

  return {
    stdout: lines.join('\n') + '\n',
    stderr: '',
    exitCode: 0,
  }
}

// ============================================================================
// SEQ COMMAND
// ============================================================================

/**
 * Execute seq command - generate number sequence
 *
 * Generates a sequence of numbers from first to last with given increment.
 *
 * @param args - Number arguments: [last], [first, last], or [first, incr, last]
 * @param options - Seq options
 * @returns Command result
 *
 * @example
 * ```typescript
 * executeSeq(['5'])           // "1\n2\n3\n4\n5\n"
 * executeSeq(['2', '5'])      // "2\n3\n4\n5\n"
 * executeSeq(['1', '2', '10']) // "1\n3\n5\n7\n9\n"
 * executeSeq(['5', '-1', '1']) // "5\n4\n3\n2\n1\n"
 * ```
 */
export function executeSeq(
  args: string[],
  options: SeqOptions = {}
): CommandResult {
  if (args.length === 0) {
    return {
      stdout: '',
      stderr: 'seq: missing operand',
      exitCode: 1,
    }
  }

  // Parse numeric arguments
  const numArgs: number[] = []
  for (const arg of args) {
    const num = parseFloat(arg)
    if (isNaN(num)) {
      return {
        stdout: '',
        stderr: `seq: invalid floating point argument: '${arg}'`,
        exitCode: 1,
      }
    }
    numArgs.push(num)
  }

  // Determine first, increment, last
  let first = 1
  let increment = 1
  let last: number

  if (numArgs.length === 1) {
    last = numArgs[0]
  } else if (numArgs.length === 2) {
    first = numArgs[0]
    last = numArgs[1]
  } else if (numArgs.length >= 3) {
    first = numArgs[0]
    increment = numArgs[1]
    last = numArgs[2]
  } else {
    return {
      stdout: '',
      stderr: 'seq: missing operand',
      exitCode: 1,
    }
  }

  // Handle impossible ranges
  if (increment === 0) {
    return {
      stdout: '',
      stderr: 'seq: invalid Zero increment value',
      exitCode: 1,
    }
  }

  // Handle backwards sequences
  if ((increment > 0 && first > last) || (increment < 0 && first < last)) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
    }
  }

  const results: string[] = []
  const separator = options.separator ?? '\n'

  // Calculate width for equal-width option
  const firstStr = String(first)
  const lastStr = String(last)
  const maxWidth = Math.max(firstStr.length, lastStr.length)

  // Determine decimal places
  const firstDecimals = (firstStr.split('.')[1] || '').length
  const incrementDecimals = (String(increment).split('.')[1] || '').length
  const lastDecimals = (lastStr.split('.')[1] || '').length
  const decimalPlaces = Math.max(firstDecimals, incrementDecimals, lastDecimals)

  // Safety limit
  const maxIterations = 100000
  let iterations = 0

  if (increment > 0) {
    for (let i = first; i <= last && iterations < maxIterations; i += increment) {
      let numStr: string

      if (options.format) {
        // Simple format support
        numStr = formatNumber(i, options.format)
      } else if (decimalPlaces > 0) {
        numStr = i.toFixed(decimalPlaces)
      } else {
        numStr = String(Math.round(i))
      }

      if (options.equalWidth && !options.format) {
        numStr = numStr.padStart(maxWidth, '0')
      }

      results.push(numStr)
      iterations++
    }
  } else {
    for (let i = first; i >= last && iterations < maxIterations; i += increment) {
      let numStr: string

      if (options.format) {
        numStr = formatNumber(i, options.format)
      } else if (decimalPlaces > 0) {
        numStr = i.toFixed(decimalPlaces)
      } else {
        numStr = String(Math.round(i))
      }

      if (options.equalWidth && !options.format) {
        numStr = numStr.padStart(maxWidth, '0')
      }

      results.push(numStr)
      iterations++
    }
  }

  return {
    stdout: results.join(separator) + (results.length > 0 ? '\n' : ''),
    stderr: '',
    exitCode: 0,
  }
}

/**
 * Format a number using a printf-style format string
 */
function formatNumber(value: number, format: string): string {
  // Support %g, %f, %e formats
  const match = format.match(/%(\d+)?(?:\.(\d+))?([gfeE])/)
  if (!match) {
    return String(value)
  }

  const width = match[1] ? parseInt(match[1], 10) : 0
  const precision = match[2] ? parseInt(match[2], 10) : undefined
  const type = match[3]

  let result: string
  switch (type) {
    case 'f':
      result = precision !== undefined ? value.toFixed(precision) : value.toFixed(6)
      break
    case 'e':
      result = precision !== undefined ? value.toExponential(precision) : value.toExponential()
      break
    case 'E':
      result = (precision !== undefined ? value.toExponential(precision) : value.toExponential()).toUpperCase()
      break
    case 'g':
    default:
      result = precision !== undefined ? value.toPrecision(precision) : String(value)
      break
  }

  if (width > result.length) {
    result = result.padStart(width, ' ')
  }

  return result
}

// ============================================================================
// PWD COMMAND
// ============================================================================

/**
 * Execute pwd command - print working directory
 *
 * Returns the current working directory. With -L flag (default), returns
 * the logical path (may include symlinks). With -P flag, returns the
 * physical path (symlinks resolved).
 *
 * @param args - Command arguments (-L or -P)
 * @param context - Execution context with cwd
 * @returns Command result
 *
 * @example
 * ```typescript
 * executePwd([], { cwd: '/home/user' })
 * // => { stdout: '/home/user\n', ... }
 *
 * executePwd(['-P'], { cwd: '/home/user' })
 * // => { stdout: '/home/user\n', ... } (symlinks resolved if any)
 * ```
 */
export function executePwd(
  args: string[],
  context: SystemUtilsContext = {}
): CommandResult {
  // Parse flags
  let usePhysical = false
  for (const arg of args) {
    if (arg === '-P') {
      usePhysical = true
    } else if (arg === '-L') {
      usePhysical = false
    } else if (arg.startsWith('-') && arg !== '-') {
      return {
        stdout: '',
        stderr: `pwd: invalid option -- '${arg.slice(1)}'`,
        exitCode: 1,
      }
    }
  }

  // Get current working directory
  let cwd = context.cwd || '/'

  // In Workers environment, we don't have real symlink resolution,
  // but we support the -P flag for compatibility
  if (usePhysical) {
    // Normalize path by removing . and .. components
    cwd = normalizePath(cwd)
  }

  return {
    stdout: cwd + '\n',
    stderr: '',
    exitCode: 0,
  }
}

/**
 * Normalize a path by resolving . and .. components
 */
function normalizePath(path: string): string {
  const isAbsolute = path.startsWith('/')
  const parts = path.split('/').filter(p => p && p !== '.')
  const result: string[] = []

  for (const part of parts) {
    if (part === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop()
      } else if (!isAbsolute) {
        result.push('..')
      }
    } else {
      result.push(part)
    }
  }

  const normalized = result.join('/')
  return isAbsolute ? '/' + normalized : normalized || '.'
}

// ============================================================================
// WHOAMI COMMAND
// ============================================================================

/**
 * Execute whoami command - print current username
 *
 * Returns the username from context or environment variables.
 * Checks in order: context.user, env.USER, env.LOGNAME, then defaults.
 *
 * @param _args - Command arguments (unused, for interface consistency)
 * @param context - Execution context with user or env
 * @returns Command result
 *
 * @example
 * ```typescript
 * executeWhoami([], { user: 'alice' })
 * // => { stdout: 'alice\n', ... }
 *
 * executeWhoami([], { env: { USER: 'bob' } })
 * // => { stdout: 'bob\n', ... }
 * ```
 */
export function executeWhoami(
  _args: string[],
  context: SystemUtilsContext = {}
): CommandResult {
  // Check context.user first
  if (context.user) {
    return {
      stdout: context.user + '\n',
      stderr: '',
      exitCode: 0,
    }
  }

  // Check environment variables
  const env = context.env || {}
  const user = env.USER || env.LOGNAME || env.USERNAME

  if (user) {
    return {
      stdout: user + '\n',
      stderr: '',
      exitCode: 0,
    }
  }

  // Default for Workers environment
  return {
    stdout: 'worker\n',
    stderr: '',
    exitCode: 0,
  }
}

// ============================================================================
// HOSTNAME COMMAND
// ============================================================================

/**
 * Execute hostname command - print system hostname
 *
 * Returns the hostname from context or environment variables.
 * In Workers environment, defaults to 'worker.local'.
 *
 * @param args - Command arguments (supports -s for short hostname)
 * @param context - Execution context with hostname
 * @returns Command result
 *
 * @example
 * ```typescript
 * executeHostname([], { hostname: 'server.example.com.ai' })
 * // => { stdout: 'server.example.com.ai\n', ... }
 *
 * executeHostname(['-s'], { hostname: 'server.example.com.ai' })
 * // => { stdout: 'server\n', ... }
 * ```
 */
export function executeHostname(
  args: string[],
  context: SystemUtilsContext = {}
): CommandResult {
  // Parse flags
  let shortName = false
  for (const arg of args) {
    if (arg === '-s' || arg === '--short') {
      shortName = true
    } else if (arg === '-f' || arg === '--fqdn' || arg === '--long') {
      shortName = false
    } else if (arg.startsWith('-') && arg !== '-') {
      return {
        stdout: '',
        stderr: `hostname: invalid option -- '${arg.slice(1)}'`,
        exitCode: 1,
      }
    }
  }

  // Get hostname from context or environment
  let hostname = context.hostname
  if (!hostname) {
    const env = context.env || {}
    hostname = env.HOSTNAME || env.HOST || 'worker.local'
  }

  // Return short name if requested
  if (shortName && hostname.includes('.')) {
    hostname = hostname.split('.')[0]
  }

  return {
    stdout: hostname + '\n',
    stderr: '',
    exitCode: 0,
  }
}

// ============================================================================
// PRINTENV COMMAND
// ============================================================================

/**
 * Execute printenv command - print environment variables
 *
 * With no arguments, prints all environment variables.
 * With variable names as arguments, prints only those variables.
 *
 * @param args - Variable names to print (empty for all)
 * @param context - Execution context with env
 * @param options - Printenv options
 * @returns Command result
 *
 * @example
 * ```typescript
 * executePrintenv([], { env: { FOO: 'bar', BAZ: 'qux' } })
 * // => { stdout: 'FOO=bar\nBAZ=qux\n', ... }
 *
 * executePrintenv(['FOO'], { env: { FOO: 'bar', BAZ: 'qux' } })
 * // => { stdout: 'bar\n', ... }
 *
 * executePrintenv(['MISSING'], { env: { FOO: 'bar' } })
 * // => { exitCode: 1, ... }
 * ```
 */
export function executePrintenv(
  args: string[],
  context: SystemUtilsContext = {},
  options: PrintenvOptions = {}
): CommandResult {
  const env = context.env || {}
  const separator = options.null ? '\0' : '\n'

  // Parse flags and collect variable names
  const varNames: string[] = []
  for (const arg of args) {
    if (arg === '-0' || arg === '--null') {
      options.null = true
    } else if (arg.startsWith('-') && arg !== '-') {
      // Unknown flag - ignore (printenv is lenient)
      varNames.push(arg)
    } else {
      varNames.push(arg)
    }
  }

  if (varNames.length === 0) {
    // Print all environment variables
    const lines: string[] = []
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        lines.push(`${key}=${value}`)
      }
    }

    // Sort for consistent output
    lines.sort()

    return {
      stdout: lines.join(separator) + (lines.length > 0 ? separator : ''),
      stderr: '',
      exitCode: 0,
    }
  }

  // Print specific variables
  const outputs: string[] = []
  let allFound = true

  for (const name of varNames) {
    const value = env[name]
    if (value !== undefined) {
      outputs.push(value)
    } else {
      allFound = false
    }
  }

  return {
    stdout: outputs.join(separator) + (outputs.length > 0 ? separator : ''),
    stderr: '',
    exitCode: allFound ? 0 : 1,
  }
}

// ============================================================================
// UNIFIED EXECUTOR
// ============================================================================

/**
 * Execute a system utility command
 *
 * Routes to the appropriate command implementation based on command name.
 *
 * @param command - Command name
 * @param args - Command arguments
 * @param context - Execution context
 * @returns Command result or null if command not supported
 *
 * @example
 * ```typescript
 * const result = await executeSystemUtils('pwd', [], { cwd: '/home/user' })
 * // => { stdout: '/home/user\n', stderr: '', exitCode: 0 }
 * ```
 */
export async function executeSystemUtils(
  command: string,
  args: string[],
  context: SystemUtilsContext = {}
): Promise<CommandResult | null> {
  if (!SYSTEM_UTILS_COMMANDS.has(command)) {
    return null
  }

  switch (command) {
    case 'sleep':
      return executeSleep(args)

    case 'yes':
      return executeYes(args)

    case 'seq': {
      // Parse seq-specific options
      const seqOptions: SeqOptions = {}
      const numArgs: string[] = []

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '-s' && args[i + 1] !== undefined) {
          seqOptions.separator = args[++i]
            .replace(/\\t/g, '\t')
            .replace(/\\n/g, '\n')
        } else if (arg === '-w') {
          seqOptions.equalWidth = true
        } else if (arg === '-f' && args[i + 1] !== undefined) {
          seqOptions.format = args[++i]
        } else if (!arg.startsWith('-')) {
          numArgs.push(arg)
        }
      }

      return executeSeq(numArgs, seqOptions)
    }

    case 'pwd': {
      const pwdArgs: string[] = args.filter(a => a === '-L' || a === '-P')
      return executePwd(pwdArgs, context)
    }

    case 'whoami':
      return executeWhoami(args, context)

    case 'hostname':
      return executeHostname(args, context)

    case 'printenv': {
      const printenvOptions: PrintenvOptions = {
        null: args.includes('-0') || args.includes('--null'),
      }
      const varArgs = args.filter(a => a !== '-0' && a !== '--null')
      return executePrintenv(varArgs, context, printenvOptions)
    }

    default:
      return null
  }
}
