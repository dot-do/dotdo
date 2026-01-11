/**
 * CLI Argument Parsing
 *
 * Simple argument parser for CLI commands.
 */

// ============================================================================
// Types
// ============================================================================

export interface ParsedArgs {
  /** Positional arguments */
  positional: string[]
  /** Flag arguments (--flag or --flag=value) */
  flags: Record<string, string | boolean>
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse command arguments into positional and flag arguments
 */
export function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg.startsWith('--')) {
      const rest = arg.slice(2)

      // Handle --flag=value
      if (rest.includes('=')) {
        const [key, ...valueParts] = rest.split('=')
        flags[key] = valueParts.join('=')
      }
      // Handle --no-flag (boolean negation)
      else if (rest.startsWith('no-')) {
        flags[rest.slice(3)] = false
      }
      // Handle --flag value or --flag (boolean)
      else {
        const nextArg = args[i + 1]
        if (nextArg && !nextArg.startsWith('-')) {
          flags[rest] = nextArg
          i++
        } else {
          flags[rest] = true
        }
      }
    }
    // Handle -f value
    else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1)
      const nextArg = args[i + 1]
      if (nextArg && !nextArg.startsWith('-')) {
        flags[key] = nextArg
        i++
      } else {
        flags[key] = true
      }
    }
    // Positional argument
    else {
      positional.push(arg)
    }

    i++
  }

  return { positional, flags }
}

/**
 * Get a required positional argument or throw
 */
export function requirePositional(
  args: ParsedArgs,
  index: number,
  name: string
): string {
  const value = args.positional[index]
  if (!value) {
    throw new Error(`Missing required argument: ${name}`)
  }
  return value
}

/**
 * Get a required flag value or throw
 */
export function requireFlag(
  args: ParsedArgs,
  name: string,
  description?: string
): string {
  const value = args.flags[name]
  if (value === undefined || typeof value !== 'string') {
    throw new Error(`Missing required flag: --${name}${description ? ` (${description})` : ''}`)
  }
  return value
}

/**
 * Get a flag value as string (or undefined)
 */
export function getStringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name]
  if (typeof value === 'string') {
    return value
  }
  // Handle case where flag exists but has no value
  if (value === true) {
    return undefined
  }
  return undefined
}

/**
 * Get a flag value as boolean
 */
export function getBooleanFlag(args: ParsedArgs, name: string, defaultValue = false): boolean {
  const value = args.flags[name]
  if (value === undefined) {
    return defaultValue
  }
  if (typeof value === 'boolean') {
    return value
  }
  return value.toLowerCase() === 'true'
}

/**
 * Get a flag value as number (or undefined)
 */
export function getNumberFlag(args: ParsedArgs, name: string): number | undefined {
  const value = args.flags[name]
  if (typeof value === 'string') {
    const num = Number(value)
    if (!isNaN(num)) {
      return num
    }
  }
  return undefined
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate phone number format (E.164)
 */
export function isValidPhoneNumber(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone)
}

/**
 * Validate email address format
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Validate positive integer
 */
export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
