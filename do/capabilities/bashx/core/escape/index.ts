/**
 * Shell Escaping Utilities
 *
 * Provides safe escaping of values for shell interpolation.
 * Uses POSIX-compliant single-quote escaping.
 *
 * @packageDocumentation
 */

/**
 * Characters that are safe in shell without quoting.
 * Includes: alphanumeric, underscore, hyphen, period, forward slash, colon, equals, at
 */
const SAFE_CHARS_REGEX = /^[a-zA-Z0-9_\-./:=@]+$/

/**
 * Escape a single argument for safe shell use.
 * Uses single-quote escaping which preserves all characters literally.
 *
 * @param value - Value to escape (will be converted to string)
 * @returns Shell-safe escaped string
 *
 * @example
 * ```typescript
 * shellEscapeArg('hello world')     // => 'hello world'
 * shellEscapeArg("it's fine")       // => 'it'"'"'s fine'
 * shellEscapeArg('file; rm -rf /') // => 'file; rm -rf /'
 * shellEscapeArg('')               // => ''
 * shellEscapeArg('simple')         // => simple (no quotes needed)
 * ```
 */
export function shellEscapeArg(value: unknown): string {
  const str = String(value)

  // Empty string needs explicit quoting
  if (str === '') {
    return "''"
  }

  // If only safe characters, no quoting needed
  if (SAFE_CHARS_REGEX.test(str)) {
    return str
  }

  // Use single quotes - they're the safest for shell escaping
  // Single quotes preserve everything literally except single quotes themselves
  // To include a single quote: end quote, add escaped quote, start quote again
  // 'it'"'"'s fine' => the middle '"'"' ends quote, adds literal ', starts quote again
  return "'" + str.replace(/'/g, "'\"'\"'") + "'"
}

/**
 * Escape multiple arguments and join with spaces.
 *
 * @param args - Arguments to escape
 * @returns Space-joined escaped arguments
 *
 * @example
 * ```typescript
 * shellEscape('ls', '-la', '/path with spaces')
 * // => "ls -la '/path with spaces'"
 *
 * shellEscape('git', 'commit', '-m', "it's done")
 * // => "git commit -m 'it'\"'\"'s done'"
 * ```
 */
export function shellEscape(...args: unknown[]): string {
  return args.map(shellEscapeArg).join(' ')
}

/**
 * Create a tagged template function that escapes interpolated values.
 *
 * @param options - Options for the template
 * @returns Tagged template function
 *
 * @example
 * ```typescript
 * const cmd = createShellTemplate()
 *
 * const file = 'my file.txt'
 * cmd`cat ${file}` // => 'cat \'my file.txt\''
 *
 * const dangerous = '; rm -rf /'
 * cmd`echo ${dangerous}` // => 'echo \'; rm -rf /\''
 * ```
 */
export function createShellTemplate(options?: { escape?: boolean }) {
  const shouldEscape = options?.escape !== false

  return function (strings: TemplateStringsArray, ...values: unknown[]): string {
    return strings.reduce((acc, str, i) => {
      const value = values[i]
      if (value === undefined) {
        return acc + str
      }
      return acc + str + (shouldEscape ? shellEscapeArg(value) : String(value))
    }, '')
  }
}

/**
 * Raw template that does NOT escape values.
 * Use with extreme caution - only for trusted input.
 *
 * @example
 * ```typescript
 * const pattern = '*.ts'
 * rawTemplate`find . -name ${pattern}`
 * // => 'find . -name *.ts' (glob NOT quoted)
 * ```
 */
export const rawTemplate = createShellTemplate({ escape: false })

/**
 * Safe template that escapes all interpolated values.
 *
 * @example
 * ```typescript
 * const file = 'user input; rm -rf /'
 * safeTemplate`cat ${file}`
 * // => "cat 'user input; rm -rf /'" (injection prevented)
 * ```
 */
export const safeTemplate = createShellTemplate({ escape: true })

export default shellEscape
