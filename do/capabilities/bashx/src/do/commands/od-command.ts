/**
 * OD Command Implementation
 *
 * Implements the POSIX `od` command for octal/hex dump of files.
 * Supports comprehensive output formats and address radixes.
 *
 * @module bashx/do/commands/od-command
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Address radix format for output
 */
export type AddressRadix = 'd' | 'o' | 'x' | 'n'

/**
 * Output type specification
 */
export interface OutputTypeSpec {
  /** Base type: a (named), c (char), d (signed decimal), o (octal), u (unsigned), x (hex) */
  type: 'a' | 'c' | 'd' | 'o' | 'u' | 'x'
  /** Size in bytes (1, 2, 4, 8) */
  size: number
}

/**
 * Options for od command execution
 */
export interface OdOptions {
  /** Address radix: d (decimal), o (octal), x (hex), n (none) */
  addressRadix?: AddressRadix
  /** Output type specifications */
  types?: OutputTypeSpec[]
  /** Number of bytes to dump */
  count?: number
  /** Bytes to skip at start */
  skip?: number
  /** Output width in bytes per line */
  width?: number
  /** Traditional mode (implies -t o2) */
  traditional?: boolean
}

/**
 * Result from od command execution
 */
export interface OdResult {
  /** Formatted output string */
  output: string
  /** Number of bytes processed */
  bytesProcessed: number
}

// ============================================================================
// Named Characters (for -t a)
// ============================================================================

/**
 * Named characters for type 'a' output
 */
const NAMED_CHARS: Record<number, string> = {
  0: 'nul',
  1: 'soh',
  2: 'stx',
  3: 'etx',
  4: 'eot',
  5: 'enq',
  6: 'ack',
  7: 'bel',
  8: 'bs',
  9: 'ht',
  10: 'nl',
  11: 'vt',
  12: 'ff',
  13: 'cr',
  14: 'so',
  15: 'si',
  16: 'dle',
  17: 'dc1',
  18: 'dc2',
  19: 'dc3',
  20: 'dc4',
  21: 'nak',
  22: 'syn',
  23: 'etb',
  24: 'can',
  25: 'em',
  26: 'sub',
  27: 'esc',
  28: 'fs',
  29: 'gs',
  30: 'rs',
  31: 'us',
  32: 'sp',
  127: 'del',
}

/**
 * Escape sequences for type 'c' output
 */
const ESCAPE_CHARS: Record<number, string> = {
  0: '\\0',
  7: '\\a',
  8: '\\b',
  9: '\\t',
  10: '\\n',
  11: '\\v',
  12: '\\f',
  13: '\\r',
}

// ============================================================================
// Argument Parsing
// ============================================================================

/**
 * Parse a type specification string (e.g., "x2", "d4", "c")
 *
 * @param spec - Type specification string
 * @returns Parsed OutputTypeSpec
 *
 * @example
 * ```typescript
 * parseTypeSpec('x2')  // => { type: 'x', size: 2 }
 * parseTypeSpec('d')   // => { type: 'd', size: 4 } (default size)
 * parseTypeSpec('c')   // => { type: 'c', size: 1 }
 * ```
 */
export function parseTypeSpec(spec: string): OutputTypeSpec {
  if (spec.length === 0) {
    throw new Error(`od: invalid type string ''`)
  }

  const typeChar = spec[0].toLowerCase()
  if (!['a', 'c', 'd', 'o', 'u', 'x'].includes(typeChar)) {
    throw new Error(`od: invalid type string '${spec}'`)
  }

  const type = typeChar as OutputTypeSpec['type']

  // Default sizes
  const defaultSizes: Record<string, number> = {
    'a': 1,  // Named characters - always 1 byte
    'c': 1,  // Characters - always 1 byte
    'd': 4,  // Signed decimal - default 4 bytes (int)
    'o': 2,  // Octal - default 2 bytes (for POSIX compatibility)
    'u': 4,  // Unsigned decimal - default 4 bytes
    'x': 2,  // Hexadecimal - default 2 bytes
  }

  let size = defaultSizes[type]

  // Parse optional size
  if (spec.length > 1) {
    const sizeStr = spec.slice(1)
    // Handle size specifiers: C (char=1), S (short=2), I (int=4), L (long=8)
    // Or numeric: 1, 2, 4, 8
    const sizeMap: Record<string, number> = {
      'C': 1, 'S': 2, 'I': 4, 'L': 8,
      '1': 1, '2': 2, '4': 4, '8': 8,
    }

    const parsedSize = sizeMap[sizeStr.toUpperCase()]
    if (parsedSize === undefined) {
      throw new Error(`od: invalid type string '${spec}'`)
    }

    // For 'a' and 'c', size must be 1
    if ((type === 'a' || type === 'c') && parsedSize !== 1) {
      throw new Error(`od: invalid type string '${spec}'`)
    }

    size = parsedSize
  }

  return { type, size }
}

/**
 * Parse od command arguments
 *
 * @param args - Command line arguments
 * @returns Parsed OdOptions
 *
 * @example
 * ```typescript
 * parseOdArgs(['-A', 'x', '-t', 'x2', '-N', '32'])
 * // => { addressRadix: 'x', types: [{ type: 'x', size: 2 }], count: 32 }
 * ```
 */
export function parseOdArgs(args: string[]): OdOptions {
  const options: OdOptions = {
    types: [],
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-A' || arg === '--address-radix') {
      i++
      const radix = args[i]
      if (!['d', 'o', 'x', 'n'].includes(radix)) {
        throw new Error(`od: invalid address radix '${radix}'`)
      }
      options.addressRadix = radix as AddressRadix
    } else if (arg.startsWith('-A')) {
      const radix = arg.slice(2)
      if (!['d', 'o', 'x', 'n'].includes(radix)) {
        throw new Error(`od: invalid address radix '${radix}'`)
      }
      options.addressRadix = radix as AddressRadix
    } else if (arg === '-t' || arg === '--format') {
      i++
      const typeSpec = args[i]
      options.types!.push(parseTypeSpec(typeSpec))
    } else if (arg.startsWith('-t')) {
      const typeSpec = arg.slice(2)
      options.types!.push(parseTypeSpec(typeSpec))
    } else if (arg === '-N' || arg === '--read-bytes') {
      i++
      options.count = parseInt(args[i], 10)
      if (isNaN(options.count) || options.count < 0) {
        throw new Error(`od: invalid number of bytes: '${args[i]}'`)
      }
    } else if (arg.startsWith('-N')) {
      options.count = parseInt(arg.slice(2), 10)
      if (isNaN(options.count) || options.count < 0) {
        throw new Error(`od: invalid number of bytes: '${arg.slice(2)}'`)
      }
    } else if (arg === '-j' || arg === '--skip-bytes') {
      i++
      options.skip = parseInt(args[i], 10)
      if (isNaN(options.skip) || options.skip < 0) {
        throw new Error(`od: invalid number of bytes: '${args[i]}'`)
      }
    } else if (arg.startsWith('-j')) {
      options.skip = parseInt(arg.slice(2), 10)
      if (isNaN(options.skip) || options.skip < 0) {
        throw new Error(`od: invalid number of bytes: '${arg.slice(2)}'`)
      }
    } else if (arg === '-w' || arg === '--width') {
      i++
      options.width = parseInt(args[i], 10)
      if (isNaN(options.width) || options.width <= 0) {
        throw new Error(`od: invalid line width: '${args[i]}'`)
      }
    } else if (arg.startsWith('-w')) {
      options.width = parseInt(arg.slice(2), 10)
      if (isNaN(options.width) || options.width <= 0) {
        throw new Error(`od: invalid line width: '${arg.slice(2)}'`)
      }
    } else if (arg === '-b') {
      // Traditional: octal bytes
      options.types!.push({ type: 'o', size: 1 })
    } else if (arg === '-c') {
      // Traditional: printable chars or escapes
      options.types!.push({ type: 'c', size: 1 })
    } else if (arg === '-d') {
      // Traditional: unsigned decimal shorts
      options.types!.push({ type: 'u', size: 2 })
    } else if (arg === '-o') {
      // Traditional: octal shorts (default)
      options.types!.push({ type: 'o', size: 2 })
    } else if (arg === '-s') {
      // Traditional: signed decimal shorts
      options.types!.push({ type: 'd', size: 2 })
    } else if (arg === '-x') {
      // Traditional: hexadecimal shorts
      options.types!.push({ type: 'x', size: 2 })
    } else if (!arg.startsWith('-')) {
      // Non-option argument (file or offset in traditional mode)
      // Skip file arguments for now
    }

    i++
  }

  return options
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format an address value according to the radix
 *
 * @param address - Address value
 * @param radix - Address radix format
 * @returns Formatted address string
 */
function formatAddress(address: number, radix: AddressRadix): string {
  switch (radix) {
    case 'd':
      return address.toString(10).padStart(7, '0')
    case 'x':
      return address.toString(16).padStart(7, '0')
    case 'n':
      return ''
    case 'o':
    default:
      return address.toString(8).padStart(7, '0')
  }
}

/**
 * Format a byte as a named character
 *
 * @param byte - Byte value
 * @returns Named character representation
 */
function formatNamedChar(byte: number): string {
  if (NAMED_CHARS[byte]) {
    return NAMED_CHARS[byte].padStart(3, ' ')
  }
  // Printable ASCII
  if (byte >= 33 && byte < 127) {
    return ('  ' + String.fromCharCode(byte))
  }
  // Default to octal for extended characters
  return byte.toString(8).padStart(3, '0')
}

/**
 * Format a byte as a printable character or escape sequence
 *
 * @param byte - Byte value
 * @returns Character representation
 */
function formatChar(byte: number): string {
  if (ESCAPE_CHARS[byte]) {
    return ESCAPE_CHARS[byte].padStart(3, ' ')
  }
  // Printable ASCII
  if (byte >= 32 && byte < 127) {
    return ('  ' + String.fromCharCode(byte))
  }
  // Default to octal
  return byte.toString(8).padStart(3, '0')
}

/**
 * Read a multi-byte integer from data (little-endian)
 *
 * @param data - Source data
 * @param offset - Byte offset
 * @param size - Number of bytes (1, 2, 4, 8)
 * @param signed - Whether to interpret as signed
 * @returns Integer value
 */
function readInt(data: Uint8Array, offset: number, size: number, signed: boolean): bigint | number {
  if (offset + size > data.length) {
    // Pad with zeros if reading past end
    const padded = new Uint8Array(size)
    for (let i = 0; i < size && offset + i < data.length; i++) {
      padded[i] = data[offset + i]
    }
    return readIntFromArray(padded, 0, size, signed)
  }
  return readIntFromArray(data, offset, size, signed)
}

/**
 * Read an integer from array (little-endian)
 */
function readIntFromArray(data: Uint8Array, offset: number, size: number, signed: boolean): bigint | number {
  let value = 0n
  for (let i = 0; i < size; i++) {
    value |= BigInt(data[offset + i]) << BigInt(i * 8)
  }

  if (signed) {
    const signBit = 1n << BigInt(size * 8 - 1)
    if (value >= signBit) {
      value -= 1n << BigInt(size * 8)
    }
  }

  // Convert to number if safe
  if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
    return Number(value)
  }
  return value
}

/**
 * Format an integer value according to type
 *
 * @param value - Integer value
 * @param spec - Output type specification
 * @returns Formatted string
 */
function formatInt(value: bigint | number, spec: OutputTypeSpec): string {
  const numValue = typeof value === 'bigint' ? value : BigInt(value)

  // Determine field width based on size and type
  const fieldWidths: Record<string, Record<number, number>> = {
    'o': { 1: 3, 2: 6, 4: 11, 8: 22 },
    'd': { 1: 4, 2: 6, 4: 11, 8: 20 },
    'u': { 1: 3, 2: 5, 4: 10, 8: 20 },
    'x': { 1: 2, 2: 4, 4: 8, 8: 16 },
  }

  const width = fieldWidths[spec.type]?.[spec.size] ?? spec.size * 2

  switch (spec.type) {
    case 'o':
      return (numValue >= 0n ? numValue : numValue & ((1n << BigInt(spec.size * 8)) - 1n))
        .toString(8)
        .padStart(width, '0')
    case 'd':
      return numValue.toString(10).padStart(width, ' ')
    case 'u':
      return (numValue >= 0n ? numValue : numValue + (1n << BigInt(spec.size * 8)))
        .toString(10)
        .padStart(width, ' ')
    case 'x':
      return (numValue >= 0n ? numValue : numValue & ((1n << BigInt(spec.size * 8)) - 1n))
        .toString(16)
        .padStart(width, '0')
    default:
      return numValue.toString()
  }
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * Execute od command - octal/hex dump
 *
 * @param input - Input data as Uint8Array
 * @param options - OD options (addressRadix, types, count, skip, width)
 * @returns OdResult with formatted output and statistics
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode('ABC')
 * const result = executeOd(data, { types: [{ type: 'x', size: 1 }] })
 * // result.output contains hex dump
 * ```
 */
export function executeOd(input: Uint8Array, options: OdOptions = {}): OdResult {
  // Set defaults
  const addressRadix = options.addressRadix ?? 'o'
  const types = options.types && options.types.length > 0
    ? options.types
    : [{ type: 'o' as const, size: 2 }]  // Default: octal shorts
  const skip = options.skip ?? 0
  const width = options.width ?? 16

  // Determine how many bytes to process
  const startPos = skip
  const endPos = options.count !== undefined
    ? Math.min(startPos + options.count, input.length)
    : input.length

  if (startPos >= input.length) {
    // Empty output
    const endAddr = formatAddress(startPos, addressRadix)
    return {
      output: addressRadix !== 'n' ? endAddr + '\n' : '\n',
      bytesProcessed: 0,
    }
  }

  const lines: string[] = []

  // Process line by line
  for (let lineStart = startPos; lineStart < endPos; lineStart += width) {
    const lineEnd = Math.min(lineStart + width, endPos)
    // lineBytes available for potential future padding calculation
    void (lineEnd - lineStart)

    // Format address
    const addrStr = formatAddress(lineStart, addressRadix)

    // Format data for each type spec
    const typeOutputs: string[] = []

    for (const spec of types) {
      const values: string[] = []

      if (spec.type === 'a') {
        // Named characters
        for (let i = lineStart; i < lineEnd; i++) {
          values.push(formatNamedChar(input[i]))
        }
      } else if (spec.type === 'c') {
        // Printable chars or escapes
        for (let i = lineStart; i < lineEnd; i++) {
          values.push(formatChar(input[i]))
        }
      } else {
        // Multi-byte integers
        for (let i = lineStart; i < lineEnd; i += spec.size) {
          const signed = spec.type === 'd'
          const value = readInt(input, i, spec.size, signed)
          values.push(formatInt(value, spec))
        }
      }

      typeOutputs.push(values.join(' '))
    }

    // Build line output
    if (addressRadix === 'n') {
      lines.push(typeOutputs.join('  '))
    } else {
      // First type on same line as address
      lines.push(`${addrStr} ${typeOutputs[0]}`)
      // Additional types on continuation lines
      for (let t = 1; t < typeOutputs.length; t++) {
        lines.push(' '.repeat(addrStr.length + 1) + typeOutputs[t])
      }
    }
  }

  // Add final address line
  if (addressRadix !== 'n') {
    lines.push(formatAddress(endPos, addressRadix))
  }

  return {
    output: lines.join('\n') + '\n',
    bytesProcessed: endPos - startPos,
  }
}

// ============================================================================
// Command Set Export
// ============================================================================

/**
 * Set of od-related commands handled by this module
 */
export const OD_COMMANDS = new Set(['od'])

/**
 * Check if a command is an od command
 */
export function isOdCommand(cmd: string): boolean {
  return OD_COMMANDS.has(cmd)
}
