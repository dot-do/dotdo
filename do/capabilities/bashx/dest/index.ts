/**
 * bashx.do - AI-enhanced bash with AST-based validation
 *
 * ONE tool. ONE interface. Maximum intelligence.
 *
 * @example
 * ```typescript
 * import { bash } from 'bashx'
 *
 * // Just run commands
 * await bash`ls -la`
 *
 * // Or describe what you want
 * await bash`find all typescript files over 100 lines`
 *
 * // Dangerous commands are blocked
 * await bash`rm -rf /`  // → { blocked: true, requiresConfirm: true }
 *
 * // Unless you confirm
 * await bash('rm -rf /', { confirm: true })  // → executes
 *
 * // With shell-safe interpolation
 * const file = 'my file.txt'
 * await bash`cat ${file}`  // → cat 'my file.txt' (escaped)
 *
 * // With options as tagged template
 * await bash({ cwd: '/tmp' })`ls -la`
 *
 * // Raw mode (no escaping)
 * await bash.raw`echo ${userInput}`  // DANGER: no escaping
 * ```
 */

import { RPC, http, type Transport } from 'rpc.do'
import type { BashResult, BashOptions, BashClient, BashClientExtended } from './types.js'

export * from './types.js'

// Re-export escape utilities
export { shellEscape, shellEscapeArg } from './escape.js'

/**
 * Escape a value for safe shell interpolation.
 * Uses single quotes and escapes any internal single quotes.
 *
 * @param value - Value to escape
 * @returns Shell-safe escaped string
 *
 * @example
 * ```typescript
 * shellEscape('hello world')     // → 'hello world'
 * shellEscape("it's fine")       // → 'it'"'"'s fine'
 * shellEscape('file; rm -rf /') // → 'file; rm -rf /'
 * ```
 */
function escapeForShell(value: unknown): string {
  const str = String(value)

  // Empty string needs explicit quoting
  if (str === '') {
    return "''"
  }

  // Check if the string needs quoting
  // Safe chars: alphanumeric, underscore, hyphen, period, forward slash, colon
  if (/^[a-zA-Z0-9_\-./:=@]+$/.test(str)) {
    return str
  }

  // Use single quotes - they're the safest for shell escaping
  // Single quotes preserve everything literally except single quotes themselves
  // To include a single quote: end quote, add escaped quote, start quote again
  return "'" + str.replace(/'/g, "'\"'\"'") + "'"
}

/**
 * Build command string from tagged template with escaped values
 */
function buildEscapedCommand(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce(
    (acc, str, i) => acc + str + (values[i] !== undefined ? escapeForShell(values[i]) : ''),
    ''
  )
}

/**
 * Build command string from tagged template WITHOUT escaping (raw mode)
 */
function buildRawCommand(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce(
    (acc, str, i) => acc + str + (values[i] !== undefined ? String(values[i]) : ''),
    ''
  )
}

/**
 * Check if a value is a TemplateStringsArray
 */
function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && 'raw' in value
}

/**
 * Create a bash client with custom options
 *
 * @param clientOptions - RPC client configuration
 * @returns Extended bash client with tagged template support
 *
 * @example
 * ```typescript
 * const bash = Bash({ baseUrl: 'https://custom.bashx.do' })
 *
 * // All usage patterns work
 * await bash`ls -la`
 * await bash('ls -la')
 * await bash({ cwd: '/tmp' })`ls`
 * await bash.raw`echo ${unsafe}`
 * await bash.with({ timeout: 5000 })`slow command`
 * ```
 */
/**
 * Options for creating a custom Bash client
 */
export interface BashClientOptions {
  /** Custom base URL for the bashx service */
  baseUrl?: string
  /** Auth token for authenticated requests */
  token?: string
}

export function Bash(clientOptions?: BashClientOptions): BashClientExtended {
  const baseUrl = clientOptions?.baseUrl ?? 'https://bashx.do'
  const transport = http(baseUrl, clientOptions?.token)
  const rpcClient = RPC<{ bash: (input: string, options?: BashOptions) => Promise<BashResult> }>(transport)

  /**
   * Create tagged template handler with specific options
   */
  function createTaggedHandler(options?: BashOptions, escapeValues = true) {
    return function (strings: TemplateStringsArray, ...values: unknown[]): Promise<BashResult> {
      const input = escapeValues ? buildEscapedCommand(strings, values) : buildRawCommand(strings, values)
      return rpcClient.bash(input, options)
    }
  }

  /**
   * The main bash function - handles multiple calling conventions:
   * 1. Tagged template: bash`command`
   * 2. Direct call: bash('command', options)
   * 3. Options factory: bash({ cwd: '/tmp' })`command`
   */
  function bashFn(
    inputOrStringsOrOptions: string | TemplateStringsArray | BashOptions,
    ...values: unknown[]
  ): Promise<BashResult> | ((strings: TemplateStringsArray, ...vals: unknown[]) => Promise<BashResult>) {
    // Case 1: Tagged template - bash`command`
    if (isTemplateStringsArray(inputOrStringsOrOptions)) {
      const input = buildEscapedCommand(inputOrStringsOrOptions, values)
      return rpcClient.bash(input)
    }

    // Case 2: Direct string call - bash('command', options?)
    if (typeof inputOrStringsOrOptions === 'string') {
      const options = values[0] as BashOptions | undefined
      return rpcClient.bash(inputOrStringsOrOptions, options)
    }

    // Case 3: Options object - bash({ cwd: '/tmp' })`command`
    // Returns a tagged template function with those options bound
    const options = inputOrStringsOrOptions as BashOptions
    return createTaggedHandler(options, true)
  }

  // Add .raw for unescaped tagged templates
  bashFn.raw = createTaggedHandler(undefined, false)

  // Add .with() for creating option-bound templates
  bashFn.with = function (options: BashOptions) {
    return createTaggedHandler(options, true)
  }

  // Add .escape utility
  bashFn.escape = escapeForShell

  return bashFn as BashClientExtended
}

/**
 * Default bash client
 *
 * @example
 * ```typescript
 * import { bash } from 'bashx'
 *
 * // Tagged template (values are shell-escaped)
 * const result = await bash`git status`
 *
 * // With interpolation (safely escaped)
 * const file = 'package.json'
 * const result = await bash`cat ${file}`
 *
 * // With special characters (escaped)
 * const name = "file with spaces; rm -rf /"
 * await bash`cat ${name}`  // Safe! Executes: cat 'file with spaces; rm -rf /'
 *
 * // With options
 * const result = await bash('rm -rf build', { confirm: true })
 *
 * // Options as tagged template factory
 * await bash({ cwd: '/tmp' })`ls -la`
 * await bash({ timeout: 5000, confirm: true })`rm -rf old-files/`
 *
 * // Using .with() for reusable configurations
 * const tmpBash = bash.with({ cwd: '/tmp' })
 * await tmpBash`ls -la`
 * await tmpBash`pwd`
 *
 * // Raw mode (NO escaping - use with extreme caution!)
 * const pattern = '*.ts'
 * await bash.raw`find . -name ${pattern}`  // pattern is NOT escaped
 *
 * // Direct escape utility
 * const escaped = bash.escape('dangerous; command')
 * ```
 */
export const bash: BashClientExtended = Bash()

export default bash
