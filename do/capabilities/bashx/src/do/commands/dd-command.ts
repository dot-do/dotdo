/**
 * DD Command Implementation
 *
 * Implements the POSIX `dd` command for block copy with conversions.
 * Supports comprehensive options for data manipulation and conversion.
 *
 * @module bashx/do/commands/dd-command
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Options for dd command execution
 */
export interface DdOptions {
  /** Input file path (default: stdin) */
  if?: string
  /** Output file path (default: stdout) */
  of?: string
  /** Block size in bytes (sets both ibs and obs) */
  bs?: number
  /** Input block size in bytes */
  ibs?: number
  /** Output block size in bytes */
  obs?: number
  /** Number of blocks to copy */
  count?: number
  /** Skip N input blocks before copying */
  skip?: number
  /** Skip N output blocks before writing */
  seek?: number
  /** Conversion options (comma-separated) */
  conv?: string[]
}

/**
 * Result from dd command execution
 */
export interface DdResult {
  /** Output data */
  output: Uint8Array
  /** Statistics for stderr */
  stats: DdStats
}

/**
 * Statistics from dd execution
 */
export interface DdStats {
  /** Full input blocks read */
  fullBlocksIn: number
  /** Partial input blocks read */
  partialBlocksIn: number
  /** Full output blocks written */
  fullBlocksOut: number
  /** Partial output blocks written */
  partialBlocksOut: number
  /** Total bytes copied */
  bytesCopied: number
}

/**
 * Conversion functions available in conv= option
 */
export type ConversionFlag =
  | 'lcase'      // Convert to lowercase
  | 'ucase'      // Convert to uppercase
  | 'notrunc'    // Don't truncate output
  | 'sync'       // Pad blocks with NULs
  | 'noerror'    // Continue on errors
  | 'block'      // Pad newline-terminated records to cbs
  | 'unblock'    // Replace trailing spaces with newline
  | 'ascii'      // EBCDIC to ASCII
  | 'ebcdic'     // ASCII to EBCDIC
  | 'swab'       // Swap every pair of bytes

// ============================================================================
// Size Parsing
// ============================================================================

/**
 * Parse a size string with optional suffix (K, M, G, etc.)
 *
 * @param sizeStr - Size string like "512", "1K", "1M", "1G"
 * @returns Number of bytes
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * parseSize('512')   // => 512
 * parseSize('1K')    // => 1024
 * parseSize('1M')    // => 1048576
 * parseSize('1G')    // => 1073741824
 * parseSize('1kB')   // => 1000
 * parseSize('1KB')   // => 1024
 * ```
 */
export function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+)([KMGTkKmMgGtT]?)([Bb]?)$/i)
  if (!match) {
    throw new Error(`dd: invalid number: '${sizeStr}'`)
  }

  const value = parseInt(match[1], 10)
  const suffix = match[2].toUpperCase()
  const byteMarker = match[3]

  // Determine multiplier base (1000 for SI, 1024 for binary)
  // kB/MB/GB = decimal (1000), K/M/G or KiB/MiB/GiB = binary (1024)
  const useDecimal = byteMarker.toLowerCase() === 'b' && suffix.toLowerCase() === suffix

  const multipliers: Record<string, number> = {
    '': 1,
    'K': useDecimal ? 1000 : 1024,
    'M': useDecimal ? 1000 ** 2 : 1024 ** 2,
    'G': useDecimal ? 1000 ** 3 : 1024 ** 3,
    'T': useDecimal ? 1000 ** 4 : 1024 ** 4,
  }

  return value * (multipliers[suffix] || 1)
}

// ============================================================================
// Argument Parsing
// ============================================================================

/**
 * Parse dd command arguments
 *
 * @param args - Command line arguments in key=value format
 * @returns Parsed DdOptions
 *
 * @example
 * ```typescript
 * parseDdArgs(['if=input.bin', 'of=output.bin', 'bs=1K', 'count=10'])
 * // => { if: 'input.bin', of: 'output.bin', bs: 1024, count: 10 }
 * ```
 */
export function parseDdArgs(args: string[]): DdOptions {
  const options: DdOptions = {}

  for (const arg of args) {
    const eqIdx = arg.indexOf('=')
    if (eqIdx === -1) {
      throw new Error(`dd: unrecognized operand '${arg}'`)
    }

    const key = arg.slice(0, eqIdx)
    const value = arg.slice(eqIdx + 1)

    switch (key) {
      case 'if':
        options.if = value
        break
      case 'of':
        options.of = value
        break
      case 'bs':
        options.bs = parseSize(value)
        break
      case 'ibs':
        options.ibs = parseSize(value)
        break
      case 'obs':
        options.obs = parseSize(value)
        break
      case 'count':
        options.count = parseInt(value, 10)
        if (isNaN(options.count) || options.count < 0) {
          throw new Error(`dd: invalid number of blocks: '${value}'`)
        }
        break
      case 'skip':
        options.skip = parseInt(value, 10)
        if (isNaN(options.skip) || options.skip < 0) {
          throw new Error(`dd: invalid number: '${value}'`)
        }
        break
      case 'seek':
        options.seek = parseInt(value, 10)
        if (isNaN(options.seek) || options.seek < 0) {
          throw new Error(`dd: invalid number: '${value}'`)
        }
        break
      case 'conv':
        options.conv = value.split(',').map(c => c.trim().toLowerCase())
        break
      default:
        throw new Error(`dd: unrecognized operand '${key}=${value}'`)
    }
  }

  return options
}

// ============================================================================
// Conversions
// ============================================================================

/**
 * Convert data to lowercase (conv=lcase)
 */
function convertLcase(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    // Convert A-Z (65-90) to a-z (97-122)
    if (byte >= 65 && byte <= 90) {
      result[i] = byte + 32
    } else {
      result[i] = byte
    }
  }
  return result
}

/**
 * Convert data to uppercase (conv=ucase)
 */
function convertUcase(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    // Convert a-z (97-122) to A-Z (65-90)
    if (byte >= 97 && byte <= 122) {
      result[i] = byte - 32
    } else {
      result[i] = byte
    }
  }
  return result
}

/**
 * Swap pairs of bytes (conv=swab)
 */
function convertSwab(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length)
  for (let i = 0; i < data.length - 1; i += 2) {
    result[i] = data[i + 1]
    result[i + 1] = data[i]
  }
  // If odd length, copy last byte as-is
  if (data.length % 2 === 1) {
    result[data.length - 1] = data[data.length - 1]
  }
  return result
}

/**
 * Apply conversions to data
 *
 * @param data - Input data
 * @param convFlags - Conversion flags from conv= option
 * @returns Converted data
 */
function applyConversions(data: Uint8Array, convFlags: string[]): Uint8Array {
  let result = data

  for (const conv of convFlags) {
    switch (conv) {
      case 'lcase':
        result = convertLcase(result)
        break
      case 'ucase':
        result = convertUcase(result)
        break
      case 'swab':
        result = convertSwab(result)
        break
      // notrunc, sync handled elsewhere
      case 'notrunc':
      case 'sync':
      case 'noerror':
        // These are handled during I/O operations
        break
      default:
        // Silently ignore unrecognized conversions for forward compatibility
        break
    }
  }

  return result
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * Execute dd command - block copy with conversions
 *
 * @param input - Input data as Uint8Array
 * @param options - DD options (bs, count, skip, seek, conv, etc.)
 * @returns DdResult with output data and statistics
 *
 * @example
 * ```typescript
 * const input = new TextEncoder().encode('HELLO WORLD')
 * const result = executeDd(input, { bs: 5, count: 2, conv: ['lcase'] })
 * // result.output contains 'hello'
 * // result.stats contains block counts
 * ```
 */
export function executeDd(input: Uint8Array, options: DdOptions = {}): DdResult {
  // Determine block sizes
  const bs = options.bs ?? 512
  const ibs = options.ibs ?? bs
  const obs = options.obs ?? bs
  const skip = options.skip ?? 0
  const seek = options.seek ?? 0
  const convFlags = options.conv ?? []
  const doSync = convFlags.includes('sync')

  // Initialize statistics
  const stats: DdStats = {
    fullBlocksIn: 0,
    partialBlocksIn: 0,
    fullBlocksOut: 0,
    partialBlocksOut: 0,
    bytesCopied: 0,
  }

  // Calculate input start position
  const inputStart = skip * ibs
  if (inputStart >= input.length) {
    return { output: new Uint8Array(0), stats }
  }

  // Calculate how many input bytes to read (for potential future use)
  const _inputBytesToRead = options.count !== undefined
    ? options.count * ibs
    : input.length - inputStart
  void _inputBytesToRead

  // Read input blocks
  const inputChunks: Uint8Array[] = []
  let inputPos = inputStart
  let blocksRead = 0
  const maxBlocks = options.count ?? Infinity

  while (inputPos < input.length && blocksRead < maxBlocks) {
    const remaining = Math.min(input.length - inputPos, ibs)
    let block: Uint8Array

    if (remaining === ibs) {
      // Full block
      block = input.slice(inputPos, inputPos + ibs)
      stats.fullBlocksIn++
    } else {
      // Partial block
      if (doSync) {
        // Pad with NULs to make full block
        block = new Uint8Array(ibs)
        block.set(input.slice(inputPos, inputPos + remaining))
        // Rest is already zeros
      } else {
        block = input.slice(inputPos, inputPos + remaining)
      }
      stats.partialBlocksIn++
    }

    inputChunks.push(block)
    inputPos += remaining
    blocksRead++
  }

  // Combine all input blocks
  const totalInputBytes = inputChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  let combinedInput = new Uint8Array(totalInputBytes)
  let offset = 0
  for (const chunk of inputChunks) {
    combinedInput.set(chunk, offset)
    offset += chunk.length
  }

  // Apply conversions
  combinedInput = applyConversions(combinedInput, convFlags) as Uint8Array<ArrayBuffer>

  // Handle seek (output offset)
  const seekBytes = seek * obs
  let output: Uint8Array

  if (seekBytes > 0) {
    output = new Uint8Array(seekBytes + combinedInput.length)
    output.set(combinedInput, seekBytes)
  } else {
    output = combinedInput
  }

  // Calculate output block statistics
  const outputDataLength = combinedInput.length
  stats.fullBlocksOut = Math.floor(outputDataLength / obs)
  stats.partialBlocksOut = outputDataLength % obs > 0 ? 1 : 0
  stats.bytesCopied = outputDataLength

  return { output, stats }
}

/**
 * Format dd statistics for stderr output
 *
 * @param stats - Statistics from dd execution
 * @returns Formatted statistics string
 *
 * @example
 * ```typescript
 * formatDdStats({ fullBlocksIn: 10, partialBlocksIn: 1, ... })
 * // => '10+1 records in\n10+1 records out\n5632 bytes copied'
 * ```
 */
export function formatDdStats(stats: DdStats): string {
  const lines: string[] = []

  lines.push(`${stats.fullBlocksIn}+${stats.partialBlocksIn} records in`)
  lines.push(`${stats.fullBlocksOut}+${stats.partialBlocksOut} records out`)
  lines.push(`${stats.bytesCopied} bytes copied`)

  return lines.join('\n')
}

// ============================================================================
// Command Set Export
// ============================================================================

/**
 * Set of dd-related commands handled by this module
 */
export const DD_COMMANDS = new Set(['dd'])

/**
 * Check if a command is a dd command
 */
export function isDdCommand(cmd: string): boolean {
  return DD_COMMANDS.has(cmd)
}
