/**
 * Simple color support for CLI output
 *
 * Uses ANSI escape codes. Colors are disabled if:
 * - NO_COLOR env var is set
 * - FORCE_COLOR env var is '0'
 * - stdout is not a TTY (in Node.js context)
 */

/**
 * ANSI escape codes for colors
 */
const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
} as const

/**
 * Check if colors should be enabled
 */
function shouldUseColors(): boolean {
  // Check for environment variables
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.NO_COLOR !== undefined) return false
    if (process.env.FORCE_COLOR === '0') return false
    if (process.env.FORCE_COLOR === '1') return true
  }
  return true
}

const colorsEnabled = shouldUseColors()

/**
 * Wrap text with ANSI color code
 */
function colorize(text: string, code: keyof typeof CODES): string {
  if (!colorsEnabled) return text
  return `${CODES[code]}${text}${CODES.reset}`
}

/**
 * Color helpers
 */
export const colors = {
  /** Red text - for errors */
  red: (text: string) => colorize(text, 'red'),

  /** Green text - for success */
  green: (text: string) => colorize(text, 'green'),

  /** Yellow text - for warnings */
  yellow: (text: string) => colorize(text, 'yellow'),

  /** Blue text - for directories */
  blue: (text: string) => colorize(text, 'blue'),

  /** Cyan text - for symlinks */
  cyan: (text: string) => colorize(text, 'cyan'),

  /** Bold text */
  bold: (text: string) => colorize(text, 'bold'),

  /** Dim text */
  dim: (text: string) => colorize(text, 'dim'),

  /** Check if colors are enabled */
  enabled: colorsEnabled,
}
