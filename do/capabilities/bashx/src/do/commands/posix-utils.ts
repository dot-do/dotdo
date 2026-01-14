/**
 * POSIX Utilities Commands
 *
 * Native implementations for POSIX utility commands:
 * - cut: Remove sections from lines
 * - sort: Sort lines
 * - tr: Translate characters
 * - uniq: Report/filter repeated lines
 * - wc: Word, line, byte counts
 * - basename/dirname: Path operations
 * - echo: Print arguments
 * - printf: Formatted output
 * - date: Display/format date
 * - dd: Convert and copy
 * - od: Octal dump
 *
 * @module bashx/do/commands/posix-utils
 */

// ============================================================================
// TEXT PROCESSING COMMANDS
// ============================================================================

/**
 * Options for cut command
 */
export interface CutOptions {
  /** Byte positions to extract */
  bytes?: string
  /** Character positions to extract */
  chars?: string
  /** Field positions to extract */
  fields?: string
  /** Field delimiter (default: TAB) */
  delimiter?: string
  /** Output delimiter */
  outputDelimiter?: string
  /** Complement the selection */
  complement?: boolean
  /** Only print lines with delimiter */
  onlyDelimited?: boolean
}

/**
 * Parse a range specification like "1-3", "2,4,6", "-5", "3-"
 *
 * @param spec - Range specification string
 * @param maxValue - Maximum value for open-ended ranges
 * @returns Set of 1-based positions to include
 */
function parseRangeSpec(spec: string, maxValue: number): Set<number> {
  const positions = new Set<number>()
  const parts = spec.split(',')

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-')
      const start = startStr ? parseInt(startStr, 10) : 1
      const end = endStr ? parseInt(endStr, 10) : maxValue

      for (let i = start; i <= end && i <= maxValue; i++) {
        if (i >= 1) positions.add(i)
      }
    } else {
      const pos = parseInt(trimmed, 10)
      if (pos >= 1 && pos <= maxValue) {
        positions.add(pos)
      }
    }
  }

  return positions
}

/**
 * Execute cut command - remove sections from each line of input
 *
 * @param input - Input text to process
 * @param options - Cut options (bytes, chars, fields, delimiter)
 * @returns Processed output string
 *
 * @example
 * ```typescript
 * // Cut first field with comma delimiter
 * executeCut('a,b,c\n1,2,3', { fields: '1', delimiter: ',' })
 * // => 'a\n1\n'
 *
 * // Cut bytes 1-3
 * executeCut('hello\nworld', { bytes: '1-3' })
 * // => 'hel\nwor\n'
 * ```
 */
export function executeCut(input: string, options: CutOptions): string {
  const lines = input.split('\n')
  const results: string[] = []
  const delimiter = options.delimiter || '\t'
  const outputDelim = options.outputDelimiter || delimiter

  for (const line of lines) {
    // Skip empty lines at the end
    if (line === '' && lines.indexOf(line) === lines.length - 1 && input.endsWith('\n')) {
      continue
    }

    if (options.bytes) {
      // Cut by byte positions
      const positions = parseRangeSpec(options.bytes, line.length)
      let result = ''
      for (let i = 1; i <= line.length; i++) {
        const include = positions.has(i)
        if (options.complement ? !include : include) {
          result += line[i - 1]
        }
      }
      results.push(result)
    } else if (options.chars) {
      // Cut by character positions (same as bytes for ASCII)
      const chars = [...line]
      const positions = parseRangeSpec(options.chars, chars.length)
      let result = ''
      for (let i = 1; i <= chars.length; i++) {
        const include = positions.has(i)
        if (options.complement ? !include : include) {
          result += chars[i - 1]
        }
      }
      results.push(result)
    } else if (options.fields) {
      // Cut by field positions
      if (!line.includes(delimiter)) {
        // Line doesn't contain delimiter
        if (options.onlyDelimited) {
          continue // Skip this line
        }
        results.push(line)
        continue
      }

      const fields = line.split(delimiter)
      const positions = parseRangeSpec(options.fields, fields.length)
      const selectedFields: string[] = []

      for (let i = 1; i <= fields.length; i++) {
        const include = positions.has(i)
        if (options.complement ? !include : include) {
          selectedFields.push(fields[i - 1])
        }
      }
      results.push(selectedFields.join(outputDelim))
    } else {
      // No option specified - output line as-is
      results.push(line)
    }
  }

  return results.join('\n') + (results.length > 0 ? '\n' : '')
}

/**
 * Options for sort command
 */
export interface SortOptions {
  /** Numeric sort */
  numeric?: boolean
  /** Reverse sort order */
  reverse?: boolean
  /** Key specification (e.g., "2" for second field) */
  key?: string
  /** Field separator */
  separator?: string
  /** Unique - remove duplicates */
  unique?: boolean
  /** Ignore leading blanks */
  ignoreLeadingBlanks?: boolean
  /** Case-insensitive sort */
  ignoreCase?: boolean
  /** Human numeric sort (e.g., 2K, 1G) */
  humanNumeric?: boolean
  /** Check if sorted (don't sort) */
  check?: boolean
  /** Version number sort (GNU extension -V) - sorts 1.2 < 1.10 */
  versionSort?: boolean
}

/**
 * Parse human-readable size suffixes (K, M, G, T)
 */
function parseHumanSize(str: string): number {
  const match = str.match(/^(\d+(?:\.\d+)?)\s*([KMGT])?/i)
  if (!match) return parseFloat(str) || 0

  const value = parseFloat(match[1])
  const suffix = (match[2] || '').toUpperCase()

  const multipliers: Record<string, number> = {
    K: 1024,
    M: 1024 * 1024,
    G: 1024 * 1024 * 1024,
    T: 1024 * 1024 * 1024 * 1024,
  }

  return value * (multipliers[suffix] || 1)
}

/**
 * Compare version strings (GNU sort -V behavior)
 * Handles versions like "1.2", "1.10", "2.0-alpha", "v1.0.0"
 *
 * @param a - First version string
 * @param b - Second version string
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  // Split into segments of digits and non-digits
  const splitVersion = (s: string): (string | number)[] => {
    const parts: (string | number)[] = []
    let current = ''
    let isDigit = false

    for (const char of s) {
      const charIsDigit = /\d/.test(char)
      if (current === '') {
        current = char
        isDigit = charIsDigit
      } else if (charIsDigit === isDigit) {
        current += char
      } else {
        parts.push(isDigit ? parseInt(current, 10) : current)
        current = char
        isDigit = charIsDigit
      }
    }
    if (current) {
      parts.push(isDigit ? parseInt(current, 10) : current)
    }
    return parts
  }

  const partsA = splitVersion(a)
  const partsB = splitVersion(b)

  const maxLen = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i]
    const partB = partsB[i]

    // Missing parts are treated as less than existing parts
    if (partA === undefined) return -1
    if (partB === undefined) return 1

    // Compare numbers numerically, strings lexicographically
    if (typeof partA === 'number' && typeof partB === 'number') {
      if (partA !== partB) return partA - partB
    } else if (typeof partA === 'string' && typeof partB === 'string') {
      const cmp = partA.localeCompare(partB)
      if (cmp !== 0) return cmp
    } else {
      // Mixed: numbers sort before strings
      if (typeof partA === 'number') return -1
      return 1
    }
  }

  return 0
}

/**
 * Execute sort command - sort lines of text
 *
 * @param lines - Array of lines to sort
 * @param options - Sort options
 * @returns Sorted array of lines
 *
 * @example
 * ```typescript
 * executeSort(['c', 'a', 'b'], {})
 * // => ['a', 'b', 'c']
 *
 * executeSort(['10', '2', '1'], { numeric: true })
 * // => ['1', '2', '10']
 * ```
 */
export function executeSort(lines: string[], options: SortOptions = {}): string[] {
  let result = [...lines]
  const separator = options.separator || /\s+/

  // Extract key for comparison
  const getKey = (line: string): string => {
    if (!options.key) return line

    const keyMatch = options.key.match(/^(\d+)(?:,(\d+))?/)
    if (!keyMatch) return line

    const startField = parseInt(keyMatch[1], 10) - 1
    const endField = keyMatch[2] ? parseInt(keyMatch[2], 10) - 1 : startField

    const fields = line.split(separator)
    return fields.slice(startField, endField + 1).join(' ')
  }

  // Comparison function
  const compare = (a: string, b: string): number => {
    let keyA = getKey(a)
    let keyB = getKey(b)

    if (options.ignoreLeadingBlanks) {
      keyA = keyA.trimStart()
      keyB = keyB.trimStart()
    }

    if (options.ignoreCase) {
      keyA = keyA.toLowerCase()
      keyB = keyB.toLowerCase()
    }

    let comparison: number
    if (options.versionSort) {
      // GNU extension: version number sort (-V)
      comparison = compareVersions(keyA, keyB)
    } else if (options.humanNumeric) {
      comparison = parseHumanSize(keyA) - parseHumanSize(keyB)
    } else if (options.numeric) {
      const numA = parseFloat(keyA) || 0
      const numB = parseFloat(keyB) || 0
      comparison = numA - numB
    } else {
      comparison = keyA.localeCompare(keyB)
    }

    return options.reverse ? -comparison : comparison
  }

  // Check mode
  if (options.check) {
    for (let i = 1; i < result.length; i++) {
      if (compare(result[i - 1], result[i]) > 0) {
        throw new Error(`sort: disorder: ${result[i]}`)
      }
    }
    return result
  }

  // Sort
  result.sort(compare)

  // Remove duplicates if unique
  if (options.unique) {
    result = result.filter((line, i) => i === 0 || compare(result[i - 1], line) !== 0)
  }

  return result
}

/**
 * Options for tr command
 */
export interface TrOptions {
  /** Delete characters in set1 */
  delete?: boolean
  /** Squeeze repeated characters */
  squeeze?: boolean
  /** Complement set1 */
  complement?: boolean
}

/**
 * Expand character class and range specifications
 * Handles [:alpha:], [:digit:], [:upper:], [:lower:], a-z ranges
 */
function expandCharSet(spec: string): string {
  let result = ''
  let i = 0

  while (i < spec.length) {
    // Check for POSIX character classes
    if (spec.slice(i).startsWith('[:alpha:]')) {
      result += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
      i += 9
    } else if (spec.slice(i).startsWith('[:digit:]')) {
      result += '0123456789'
      i += 9
    } else if (spec.slice(i).startsWith('[:upper:]')) {
      result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      i += 9
    } else if (spec.slice(i).startsWith('[:lower:]')) {
      result += 'abcdefghijklmnopqrstuvwxyz'
      i += 9
    } else if (spec.slice(i).startsWith('[:alnum:]')) {
      result += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      i += 9
    } else if (spec.slice(i).startsWith('[:space:]')) {
      result += ' \t\n\r\f\v'
      i += 9
    } else if (spec.slice(i).startsWith('[:blank:]')) {
      result += ' \t'
      i += 9
    } else if (spec.slice(i).startsWith('[:punct:]')) {
      result += '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
      i += 9
    } else if (spec.slice(i).startsWith('[:xdigit:]')) {
      result += '0123456789abcdefABCDEF'
      i += 10
    } else if (spec[i] === '\\' && i + 1 < spec.length) {
      // Handle escape sequences
      const next = spec[i + 1]
      switch (next) {
        case 'n': result += '\n'; break
        case 't': result += '\t'; break
        case 'r': result += '\r'; break
        case '\\': result += '\\'; break
        default: result += next
      }
      i += 2
    } else if (i + 2 < spec.length && spec[i + 1] === '-') {
      // Character range (e.g., a-z)
      const start = spec.charCodeAt(i)
      const end = spec.charCodeAt(i + 2)
      for (let c = start; c <= end; c++) {
        result += String.fromCharCode(c)
      }
      i += 3
    } else {
      result += spec[i]
      i++
    }
  }

  return result
}

/**
 * Execute tr command - translate or delete characters
 *
 * @param input - Input string to process
 * @param set1 - First character set
 * @param set2 - Second character set (for translation)
 * @param options - tr options
 * @returns Transformed string
 *
 * @example
 * ```typescript
 * // Translate lowercase to uppercase
 * executeTr('hello', '[:lower:]', '[:upper:]')
 * // => 'HELLO'
 *
 * // Delete digits
 * executeTr('abc123', '[:digit:]', undefined, { delete: true })
 * // => 'abc'
 *
 * // Squeeze repeated spaces
 * executeTr('a    b', ' ', ' ', { squeeze: true })
 * // => 'a b'
 * ```
 */
export function executeTr(
  input: string,
  set1: string,
  set2?: string,
  options: TrOptions = {}
): string {
  const expandedSet1 = expandCharSet(set1)
  const expandedSet2 = set2 ? expandCharSet(set2) : ''

  let charset = expandedSet1
  if (options.complement) {
    // Create complement of set1 (all chars NOT in set1)
    const set1Chars = new Set(expandedSet1.split(''))
    charset = ''
    for (let i = 0; i < 128; i++) {
      const char = String.fromCharCode(i)
      if (!set1Chars.has(char)) {
        charset += char
      }
    }
  }

  let result = ''
  let lastChar = ''

  for (const char of input) {
    const pos = charset.indexOf(char)

    if (options.delete) {
      // Delete mode: skip characters in set1
      if (pos === -1) {
        if (options.squeeze && char === lastChar && expandedSet2.includes(char)) {
          continue
        }
        result += char
        lastChar = char
      }
    } else if (pos !== -1 && expandedSet2) {
      // Translation mode: replace character
      const replacement = expandedSet2[Math.min(pos, expandedSet2.length - 1)]
      if (options.squeeze && replacement === lastChar) {
        continue
      }
      result += replacement
      lastChar = replacement
    } else {
      // No translation for this character
      if (options.squeeze && char === lastChar && charset.includes(char)) {
        continue
      }
      result += char
      lastChar = char
    }
  }

  return result
}

/**
 * Options for uniq command
 */
export interface UniqOptions {
  /** Prefix lines with count */
  count?: boolean
  /** Only print duplicate lines */
  repeated?: boolean
  /** Only print unique lines */
  unique?: boolean
  /** Ignore case when comparing */
  ignoreCase?: boolean
  /** Skip N fields before comparing */
  skipFields?: number
  /** Skip N characters before comparing */
  skipChars?: number
  /** Compare only first N characters (GNU extension -w N) */
  compareChars?: number
}

/**
 * Execute uniq command - report or filter repeated lines
 *
 * @param lines - Array of lines to process
 * @param options - Uniq options
 * @returns Array of filtered/modified lines
 *
 * @example
 * ```typescript
 * executeUniq(['a', 'a', 'b', 'b', 'c'], {})
 * // => ['a', 'b', 'c']
 *
 * executeUniq(['a', 'a', 'b'], { count: true })
 * // => ['2 a', '1 b']
 *
 * executeUniq(['a', 'a', 'b'], { repeated: true })
 * // => ['a']
 * ```
 */
export function executeUniq(lines: string[], options: UniqOptions = {}): string[] {
  if (lines.length === 0) return []

  const getCompareKey = (line: string): string => {
    let key = line

    // Skip fields
    if (options.skipFields) {
      const fields = key.split(/\s+/)
      key = fields.slice(options.skipFields).join(' ')
    }

    // Skip characters
    if (options.skipChars) {
      key = key.slice(options.skipChars)
    }

    // Compare only first N characters (GNU extension -w N)
    if (options.compareChars !== undefined && options.compareChars > 0) {
      key = key.slice(0, options.compareChars)
    }

    // Case insensitive
    if (options.ignoreCase) {
      key = key.toLowerCase()
    }

    return key
  }

  const groups: Array<{ line: string; count: number }> = []
  let currentGroup: { line: string; count: number } | null = null

  for (const line of lines) {
    const key = getCompareKey(line)

    if (currentGroup && getCompareKey(currentGroup.line) === key) {
      currentGroup.count++
    } else {
      if (currentGroup) {
        groups.push(currentGroup)
      }
      currentGroup = { line, count: 1 }
    }
  }

  if (currentGroup) {
    groups.push(currentGroup)
  }

  // Filter based on options
  let result = groups

  if (options.repeated) {
    result = result.filter(g => g.count > 1)
  }

  if (options.unique) {
    result = result.filter(g => g.count === 1)
  }

  // Format output
  return result.map(g => {
    if (options.count) {
      return `${String(g.count).padStart(7)} ${g.line}`
    }
    return g.line
  })
}

/**
 * Result from wc command
 */
export interface WcResult {
  lines: number
  words: number
  bytes: number
  chars: number
}

/**
 * Options for wc command
 */
export interface WcOptions {
  /** Count lines */
  lines?: boolean
  /** Count words */
  words?: boolean
  /** Count bytes */
  bytes?: boolean
  /** Count characters */
  chars?: boolean
}

/**
 * Execute wc command - word, line, and byte counts
 *
 * @param input - Input string to count
 * @param options - Which counts to include
 * @returns Count results
 *
 * @example
 * ```typescript
 * executeWc('hello world\nfoo bar\n')
 * // => { lines: 2, words: 4, bytes: 20, chars: 20 }
 * ```
 */
export function executeWc(input: string, _options: WcOptions = {}): WcResult {
  // Count lines (number of newlines)
  const lines = (input.match(/\n/g) || []).length

  // Count words (sequences of non-whitespace)
  const words = input.split(/\s+/).filter(w => w.length > 0).length

  // Count bytes (UTF-8 encoded length)
  const bytes = new TextEncoder().encode(input).length

  // Count characters
  const chars = [...input].length

  return { lines, words, bytes, chars }
}

// ============================================================================
// SHELL UTILITIES
// ============================================================================

/**
 * Execute basename command - strip directory and suffix from pathname
 *
 * @param path - The pathname to process
 * @param suffix - Optional suffix to remove
 * @returns Base name of the path
 *
 * @example
 * ```typescript
 * executeBasename('/usr/bin/bash')
 * // => 'bash'
 *
 * executeBasename('/path/to/file.txt', '.txt')
 * // => 'file'
 * ```
 */
export function executeBasename(path: string, suffix?: string): string {
  // Remove trailing slashes
  let result = path.replace(/\/+$/, '')

  // Get last component
  const lastSlash = result.lastIndexOf('/')
  if (lastSlash !== -1) {
    result = result.slice(lastSlash + 1)
  }

  // Remove suffix if specified and matches
  if (suffix && result.endsWith(suffix) && result !== suffix) {
    result = result.slice(0, -suffix.length)
  }

  return result || '/'
}

/**
 * Execute dirname command - strip last component from pathname
 *
 * @param path - The pathname to process
 * @returns Directory portion of the path
 *
 * @example
 * ```typescript
 * executeDirname('/usr/bin/bash')
 * // => '/usr/bin'
 *
 * executeDirname('file.txt')
 * // => '.'
 * ```
 */
export function executeDirname(path: string): string {
  // Remove trailing slashes (except for root)
  const result = path.replace(/\/+$/, '') || '/'

  // Find last slash
  const lastSlash = result.lastIndexOf('/')

  if (lastSlash === -1) {
    // No slash - current directory
    return '.'
  }

  if (lastSlash === 0) {
    // Slash at start - root
    return '/'
  }

  // Return everything before the last slash, then remove trailing slashes from that
  const dirname = result.slice(0, lastSlash)
  // Keep leading slashes, remove only internal trailing slashes
  return dirname.replace(/\/+$/, '') || '/'
}

/**
 * Options for echo command
 */
export interface EchoOptions {
  /** Don't output trailing newline */
  noNewline?: boolean
  /** Interpret escape sequences */
  interpretEscapes?: boolean
}

/**
 * Execute echo command - display a line of text
 *
 * @param args - Arguments to print
 * @param options - Echo options
 * @returns Output string
 *
 * @example
 * ```typescript
 * executeEcho(['hello', 'world'])
 * // => 'hello world\n'
 *
 * executeEcho(['hello\\nworld'], { interpretEscapes: true })
 * // => 'hello\nworld\n'
 * ```
 */
export function executeEcho(args: string[], options: EchoOptions = {}): string {
  let output = args.join(' ')

  if (options.interpretEscapes) {
    output = output
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\a/g, '\x07')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\v/g, '\v')
      .replace(/\\\\/g, '\\')
      .replace(/\\0([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\x([0-9a-fA-F]{1,2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      // Handle \c - stop output
      .replace(/\\c.*$/, '')
  }

  if (!options.noNewline && !output.endsWith('\n')) {
    output += '\n'
  }

  return output
}

/**
 * Execute printf command - formatted output
 *
 * @param format - Format string
 * @param args - Arguments to format
 * @returns Formatted output string
 *
 * @example
 * ```typescript
 * executePrintf('Name: %s, Age: %d\n', ['Alice', '30'])
 * // => 'Name: Alice, Age: 30\n'
 *
 * executePrintf('%x\n', ['255'])
 * // => 'ff\n'
 * ```
 */
export function executePrintf(format: string, args: string[]): string {
  let result = ''
  let argIndex = 0

  // Process escape sequences first
  const processEscapes = (str: string): string => {
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\a/g, '\x07')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\v/g, '\v')
      .replace(/\\\\/g, '\\')
      .replace(/\\0([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\x([0-9a-fA-F]{1,2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  }

  // Process format string character by character
  let i = 0
  while (i < format.length) {
    if (format[i] === '%' && i + 1 < format.length) {
      // Check for %%
      if (format[i + 1] === '%') {
        result += '%'
        i += 2
        continue
      }

      // Parse format specifier
      let j = i + 1
      let width = ''
      let precision = ''
      let leftAlign = false

      // Flags
      while (j < format.length && '- +#0'.includes(format[j])) {
        if (format[j] === '-') leftAlign = true
        j++
      }

      // Width
      while (j < format.length && /\d/.test(format[j])) {
        width += format[j]
        j++
      }

      // Precision
      if (j < format.length && format[j] === '.') {
        j++
        while (j < format.length && /\d/.test(format[j])) {
          precision += format[j]
          j++
        }
      }

      // Conversion specifier
      const spec = format[j]
      const arg = args[argIndex] || ''
      argIndex++

      let formatted = ''
      const widthNum = parseInt(width, 10) || 0
      const precisionNum = precision ? parseInt(precision, 10) : undefined

      switch (spec) {
        case 's':
          formatted = arg
          if (precisionNum !== undefined) {
            formatted = formatted.slice(0, precisionNum)
          }
          break

        case 'd':
        case 'i':
          formatted = String(parseInt(arg, 10) || 0)
          break

        case 'u':
          formatted = String(Math.abs(parseInt(arg, 10) || 0))
          break

        case 'x':
          formatted = (parseInt(arg, 10) || 0).toString(16)
          break

        case 'X':
          formatted = (parseInt(arg, 10) || 0).toString(16).toUpperCase()
          break

        case 'o':
          formatted = (parseInt(arg, 10) || 0).toString(8)
          break

        case 'f':
        case 'F':
          const floatVal = parseFloat(arg) || 0
          formatted = precisionNum !== undefined
            ? floatVal.toFixed(precisionNum)
            : floatVal.toFixed(6)
          break

        case 'e':
          formatted = (parseFloat(arg) || 0).toExponential(precisionNum ?? 6)
          break

        case 'E':
          formatted = (parseFloat(arg) || 0).toExponential(precisionNum ?? 6).toUpperCase()
          break

        case 'c':
          formatted = arg.charAt(0)
          break

        case 'b':
          // Interpret backslash escapes in arg
          formatted = processEscapes(arg)
          break

        default:
          formatted = '%' + spec
          argIndex-- // Didn't consume an argument
      }

      // Apply width padding
      if (widthNum > formatted.length) {
        const padding = ' '.repeat(widthNum - formatted.length)
        formatted = leftAlign ? formatted + padding : padding + formatted
      }

      result += formatted
      i = j + 1
    } else {
      result += format[i]
      i++
    }
  }

  return processEscapes(result)
}

// ============================================================================
// MISC COMMANDS
// ============================================================================

/**
 * Options for date command
 */
export interface DateOptions {
  /** Use UTC time */
  utc?: boolean
  /** Specific date to use (instead of now) */
  date?: string | Date
}

/**
 * Format specifiers for date command
 */
const DATE_FORMATS: Record<string, (d: Date, utc: boolean) => string> = {
  '%Y': (d, utc) => String(utc ? d.getUTCFullYear() : d.getFullYear()),
  '%y': (d, utc) => String(utc ? d.getUTCFullYear() : d.getFullYear()).slice(-2),
  '%m': (d, utc) => String(utc ? d.getUTCMonth() + 1 : d.getMonth() + 1).padStart(2, '0'),
  '%d': (d, utc) => String(utc ? d.getUTCDate() : d.getDate()).padStart(2, '0'),
  '%H': (d, utc) => String(utc ? d.getUTCHours() : d.getHours()).padStart(2, '0'),
  '%M': (d, utc) => String(utc ? d.getUTCMinutes() : d.getMinutes()).padStart(2, '0'),
  '%S': (d, utc) => String(utc ? d.getUTCSeconds() : d.getSeconds()).padStart(2, '0'),
  '%N': (d) => String(d.getMilliseconds()).padStart(3, '0') + '000000',
  '%s': (d) => String(Math.floor(d.getTime() / 1000)),
  '%j': (d, utc) => {
    const start = new Date(utc ? d.getUTCFullYear() : d.getFullYear(), 0, 0)
    const diff = d.getTime() - start.getTime()
    const oneDay = 1000 * 60 * 60 * 24
    return String(Math.floor(diff / oneDay)).padStart(3, '0')
  },
  '%u': (d, utc) => String((utc ? d.getUTCDay() : d.getDay()) || 7), // 1-7, Monday = 1
  '%w': (d, utc) => String(utc ? d.getUTCDay() : d.getDay()), // 0-6, Sunday = 0
  '%a': (d, utc) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][utc ? d.getUTCDay() : d.getDay()],
  '%A': (d, utc) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][utc ? d.getUTCDay() : d.getDay()],
  '%b': (d, utc) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][utc ? d.getUTCMonth() : d.getMonth()],
  '%B': (d, utc) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][utc ? d.getUTCMonth() : d.getMonth()],
  '%I': (d, utc) => {
    const h = utc ? d.getUTCHours() : d.getHours()
    return String(h % 12 || 12).padStart(2, '0')
  },
  '%p': (d, utc) => (utc ? d.getUTCHours() : d.getHours()) < 12 ? 'AM' : 'PM',
  '%P': (d, utc) => (utc ? d.getUTCHours() : d.getHours()) < 12 ? 'am' : 'pm',
  '%Z': (_d, utc) => utc ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone,
  '%z': (d, utc) => {
    if (utc) return '+0000'
    const offset = d.getTimezoneOffset()
    const sign = offset <= 0 ? '+' : '-'
    const absOffset = Math.abs(offset)
    return `${sign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}${String(absOffset % 60).padStart(2, '0')}`
  },
  '%n': () => '\n',
  '%t': () => '\t',
  '%%': () => '%',
}

/**
 * Execute date command - display or format date and time
 *
 * @param format - Optional format string starting with +
 * @param options - Date options
 * @returns Formatted date string
 *
 * @example
 * ```typescript
 * executeDate('+%Y-%m-%d')
 * // => '2024-01-15'
 *
 * executeDate('+%H:%M:%S', { utc: true })
 * // => '12:34:56'
 * ```
 */
export function executeDate(format?: string, options: DateOptions = {}): string {
  let date: Date

  if (options.date) {
    date = typeof options.date === 'string' ? new Date(options.date) : options.date
  } else {
    date = new Date()
  }

  if (isNaN(date.getTime())) {
    throw new Error('date: invalid date')
  }

  if (!format) {
    // Default format similar to Unix date
    return date.toString()
  }

  // Remove leading + if present
  const formatStr = format.startsWith('+') ? format.slice(1) : format

  // Replace format specifiers
  let result = formatStr

  // Sort specifiers by length (longest first) to handle %% before %
  const specifiers = Object.keys(DATE_FORMATS).sort((a, b) => b.length - a.length)

  for (const spec of specifiers) {
    const formatter = DATE_FORMATS[spec]
    result = result.split(spec).join(formatter(date, options.utc ?? false))
  }

  return result
}

/**
 * Options for dd command
 */
export interface DdOptions {
  /** Block size in bytes */
  bs?: number
  /** Number of blocks to copy */
  count?: number
  /** Skip blocks from input */
  skip?: number
  /** Skip blocks in output */
  seek?: number
  /** Input block size (alternative to bs) */
  ibs?: number
  /** Output block size (alternative to bs) */
  obs?: number
}

/**
 * Execute dd command - convert and copy a file
 *
 * @param input - Input data as Uint8Array
 * @param options - dd options
 * @returns Output data as Uint8Array
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode('hello world')
 * executeDd(data, { bs: 5, count: 1 })
 * // => Uint8Array containing 'hello'
 * ```
 */
export function executeDd(input: Uint8Array, options: DdOptions = {}): Uint8Array {
  const bs = options.bs ?? 512
  const ibs = options.ibs ?? bs
  const obs = options.obs ?? bs
  const skip = options.skip ?? 0
  const seek = options.seek ?? 0

  // Calculate start position in input
  const inputStart = skip * ibs
  if (inputStart >= input.length) {
    return new Uint8Array(0)
  }

  // Calculate how much to read
  let bytesToRead: number
  if (options.count !== undefined) {
    bytesToRead = options.count * ibs
  } else {
    bytesToRead = input.length - inputStart
  }

  // Read from input
  const endPos = Math.min(inputStart + bytesToRead, input.length)
  const inputSlice = input.slice(inputStart, endPos)

  // Handle seek in output (pad with zeros)
  const seekBytes = seek * obs
  if (seekBytes > 0) {
    const output = new Uint8Array(seekBytes + inputSlice.length)
    output.set(inputSlice, seekBytes)
    return output
  }

  return inputSlice
}

/**
 * Options for od command
 */
export interface OdOptions {
  /** Output format: o (octal), x (hex), c (char), d (decimal) */
  format?: string
  /** Address format: o (octal), x (hex), d (decimal), n (none) */
  addressFormat?: string
  /** Number of bytes per line */
  width?: number
  /** Skip bytes at start */
  skip?: number
  /** Limit bytes to read */
  count?: number
}

/**
 * Execute od command - dump files in various formats
 *
 * @param input - Input data as Uint8Array
 * @param options - od options
 * @returns Formatted dump string
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode('ABC')
 * executeOd(data, { format: 'x' })
 * // => '0000000 41 42 43\n0000003\n'
 * ```
 */
export function executeOd(input: Uint8Array, options: OdOptions = {}): string {
  const format = options.format ?? 'o'
  const addressFormat = options.addressFormat ?? 'o'
  const width = options.width ?? 16
  const skip = options.skip ?? 0
  const count = options.count ?? input.length - skip

  const lines: string[] = []
  const endPos = Math.min(skip + count, input.length)

  const formatAddress = (addr: number): string => {
    switch (addressFormat) {
      case 'x': return addr.toString(16).padStart(7, '0')
      case 'd': return addr.toString(10).padStart(7, '0')
      case 'n': return ''
      case 'o':
      default:
        return addr.toString(8).padStart(7, '0')
    }
  }

  const formatByte = (byte: number): string => {
    switch (format) {
      case 'x':
        return byte.toString(16).padStart(2, '0')
      case 'X':
        return byte.toString(16).toUpperCase().padStart(2, '0')
      case 'd':
        return byte.toString(10).padStart(3, ' ')
      case 'u':
        return byte.toString(10).padStart(3, ' ')
      case 'c':
        // Character representation
        if (byte >= 32 && byte < 127) {
          return '  ' + String.fromCharCode(byte)
        }
        // Special characters
        const specials: Record<number, string> = {
          0: ' \\0',
          7: ' \\a',
          8: ' \\b',
          9: ' \\t',
          10: ' \\n',
          11: ' \\v',
          12: ' \\f',
          13: ' \\r',
        }
        return specials[byte] ?? byte.toString(8).padStart(3, '0')
      case 'o':
      default:
        return byte.toString(8).padStart(3, '0')
    }
  }

  for (let i = skip; i < endPos; i += width) {
    const lineBytes = input.slice(i, Math.min(i + width, endPos))
    const addrStr = formatAddress(i)
    const bytesStr = Array.from(lineBytes).map(formatByte).join(' ')

    if (addressFormat === 'n') {
      lines.push(bytesStr)
    } else {
      lines.push(`${addrStr} ${bytesStr}`)
    }
  }

  // Add final address line
  if (addressFormat !== 'n') {
    lines.push(formatAddress(endPos))
  }

  return lines.join('\n') + '\n'
}

// ============================================================================
// COMMAND SET FOR TIERED EXECUTOR
// ============================================================================

/**
 * Set of POSIX utility commands handled by this module
 */
export const POSIX_UTILS_COMMANDS = new Set([
  'cut', 'sort', 'tr', 'uniq', 'wc',
  'basename', 'dirname', 'echo', 'printf',
  'date', 'dd', 'od',
])

/**
 * Check if a command is a POSIX utility command
 */
export function isPosixUtilsCommand(cmd: string): boolean {
  return POSIX_UTILS_COMMANDS.has(cmd)
}
