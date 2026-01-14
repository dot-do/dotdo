/**
 * Git pkt-line Format
 *
 * Implementation of the Git protocol pkt-line format for framing data.
 * See: https://git-scm.com/docs/protocol-common#_pkt_line_format
 *
 * pkt-line format:
 * - 4 hex digits for length (including the 4 bytes themselves)
 * - Payload data
 * - Special packets: 0000 (flush), 0001 (delimiter, v2), 0002 (response end, v2)
 */

// =============================================================================
// Constants
// =============================================================================

/** Maximum pkt-line length (65520 bytes per Git spec) */
export const PKT_LINE_MAX_LENGTH = 65520

/** Flush packet constant */
export const FLUSH_PKT = '0000'

/** Delimiter packet constant (protocol v2) */
export const DELIM_PKT = '0001'

/** Response end packet constant (protocol v2) */
export const RESPONSE_END_PKT = '0002'

// =============================================================================
// Types
// =============================================================================

/** Result of parsing a single pkt-line */
export interface PktLineResult {
  /** Total length including the 4-byte header */
  length: number
  /** Payload content (null for flush/delimiter packets) */
  payload: string | Uint8Array | null
  /** Packet type */
  type: 'data' | 'flush' | 'delimiter' | 'response-end'
  /** Remaining data after this packet */
  remainder: string
}

/** Binary pkt-line parse result */
export interface BinaryPktLineResult {
  /** Total length including header */
  length: number
  /** Payload bytes (null for special packets) */
  payload: Uint8Array | null
  /** Packet type */
  type: 'data' | 'flush' | 'delimiter' | 'response-end'
  /** Bytes consumed */
  bytesConsumed: number
}

/** Side-band channel */
export type SideBandChannel = 1 | 2 | 3

/** Demultiplexed side-band result */
export interface SideBandResult {
  /** Pack data (channel 1) */
  packData: Uint8Array
  /** Progress messages (channel 2) */
  progress: string[]
  /** Error messages (channel 3) */
  errors: string[]
}

// =============================================================================
// Parsing Functions
// =============================================================================

/**
 * Parse a single pkt-line from input
 *
 * @param input - String or Buffer input
 * @returns Parsed pkt-line result
 */
export function parsePktLine(input: string | Buffer): PktLineResult {
  const text = typeof input === 'string' ? input : input.toString('utf-8')

  if (text.length < 4) {
    throw new Error('Invalid pkt-line: input too short for header')
  }

  const lenHex = text.slice(0, 4)

  // Special packets
  if (lenHex === FLUSH_PKT) {
    return {
      length: 0,
      payload: null,
      type: 'flush',
      remainder: text.slice(4),
    }
  }

  if (lenHex === DELIM_PKT) {
    return {
      length: 0,
      payload: null,
      type: 'delimiter',
      remainder: text.slice(4),
    }
  }

  if (lenHex === RESPONSE_END_PKT) {
    return {
      length: 0,
      payload: null,
      type: 'response-end',
      remainder: text.slice(4),
    }
  }

  const len = parseInt(lenHex, 16)
  if (isNaN(len)) {
    throw new Error(`Invalid pkt-line: non-hex length prefix '${lenHex}'`)
  }

  if (len < 4) {
    throw new Error(`Invalid pkt-line: length ${len} must be >= 4`)
  }

  if (len > PKT_LINE_MAX_LENGTH) {
    throw new Error(`Payload exceeds maximum: ${len} bytes (max ${PKT_LINE_MAX_LENGTH})`)
  }

  if (text.length < len) {
    throw new Error(`Incomplete pkt-line: expected ${len} bytes, got ${text.length}`)
  }

  const payload = text.slice(4, len)
  const remainder = text.slice(len)

  return {
    length: len,
    payload,
    type: 'data',
    remainder,
  }
}

/**
 * Parse a single pkt-line from binary input
 */
export function parsePktLineBinary(data: Uint8Array, offset = 0): BinaryPktLineResult {
  if (offset + 4 > data.length) {
    throw new Error('Invalid pkt-line: input too short for header')
  }

  const lenHex = String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3]
  )

  // Special packets
  if (lenHex === FLUSH_PKT) {
    return {
      length: 0,
      payload: null,
      type: 'flush',
      bytesConsumed: 4,
    }
  }

  if (lenHex === DELIM_PKT) {
    return {
      length: 0,
      payload: null,
      type: 'delimiter',
      bytesConsumed: 4,
    }
  }

  if (lenHex === RESPONSE_END_PKT) {
    return {
      length: 0,
      payload: null,
      type: 'response-end',
      bytesConsumed: 4,
    }
  }

  const len = parseInt(lenHex, 16)
  if (isNaN(len)) {
    throw new Error(`Invalid pkt-line: non-hex length prefix '${lenHex}'`)
  }

  if (len < 4) {
    throw new Error(`Invalid pkt-line: length ${len} must be >= 4`)
  }

  if (len > PKT_LINE_MAX_LENGTH) {
    throw new Error(`Payload exceeds maximum: ${len} bytes (max ${PKT_LINE_MAX_LENGTH})`)
  }

  if (offset + len > data.length) {
    throw new Error(`Incomplete pkt-line: expected ${len} bytes`)
  }

  const payload = data.slice(offset + 4, offset + len)

  return {
    length: len,
    payload,
    type: 'data',
    bytesConsumed: len,
  }
}

/**
 * Parse multiple consecutive pkt-lines
 *
 * @param input - String input containing multiple pkt-lines
 * @returns Array of parsed pkt-line results
 */
export function parsePktLines(input: string): PktLineResult[] {
  const results: PktLineResult[] = []
  let remaining = input

  while (remaining.length >= 4) {
    try {
      const result = parsePktLine(remaining)
      results.push(result)
      remaining = result.remainder
    } catch {
      break
    }
  }

  return results
}

/**
 * Parse multiple consecutive binary pkt-lines
 */
export function parsePktLinesBinary(data: Uint8Array): BinaryPktLineResult[] {
  const results: BinaryPktLineResult[] = []
  let offset = 0

  while (offset + 4 <= data.length) {
    try {
      const result = parsePktLineBinary(data, offset)
      results.push(result)
      offset += result.bytesConsumed
    } catch {
      break
    }
  }

  return results
}

// =============================================================================
// Generation Functions
// =============================================================================

/**
 * Generate a pkt-line with correct length prefix
 *
 * @param payload - String or binary payload
 * @returns Formatted pkt-line string
 */
export function generatePktLine(payload: string | Uint8Array): string {
  if (typeof payload === 'string') {
    const len = payload.length + 4
    if (len > PKT_LINE_MAX_LENGTH) {
      throw new Error(`Payload exceeds maximum: ${payload.length} bytes (max ${PKT_LINE_MAX_LENGTH - 4})`)
    }
    const hex = len.toString(16).padStart(4, '0')
    return hex + payload
  } else {
    // Binary payload - convert to hex representation
    const len = payload.length + 4
    if (len > PKT_LINE_MAX_LENGTH) {
      throw new Error(`Payload too long: ${len - 4} bytes`)
    }
    const hex = len.toString(16).padStart(4, '0')
    const text = new TextDecoder().decode(payload)
    return hex + text
  }
}

/**
 * Generate a pkt-line as binary
 */
export function generatePktLineBinary(payload: Uint8Array): Uint8Array {
  const len = payload.length + 4
  if (len > PKT_LINE_MAX_LENGTH) {
    throw new Error(`Payload too long: ${payload.length} bytes`)
  }
  const hex = len.toString(16).padStart(4, '0')
  const header = new TextEncoder().encode(hex)
  const result = new Uint8Array(len)
  result.set(header, 0)
  result.set(payload, 4)
  return result
}

/**
 * Generate a flush packet
 *
 * @returns Flush packet string "0000"
 */
export function generateFlushPkt(): string {
  return FLUSH_PKT
}

/**
 * Generate a delimiter packet
 *
 * @returns Delimiter packet string "0001"
 */
export function generateDelimPkt(): string {
  return DELIM_PKT
}

/**
 * Generate a response end packet
 *
 * @returns Response end packet string "0002"
 */
export function generateResponseEndPkt(): string {
  return RESPONSE_END_PKT
}

// =============================================================================
// Side-band Functions
// =============================================================================

/**
 * Demultiplex side-band or side-band-64k stream
 *
 * Side-band format:
 * - Each pkt-line contains a channel byte followed by data
 * - Channel 1: pack data
 * - Channel 2: progress messages
 * - Channel 3: error messages
 *
 * @param data - Binary side-band data
 * @param options - Optional callbacks for progress/errors
 * @returns Demultiplexed result
 */
export function demuxSideBand(
  data: Uint8Array,
  options?: {
    onProgress?: (message: string) => void
    onError?: (message: string) => void
  }
): SideBandResult {
  const packChunks: Uint8Array[] = []
  const progress: string[] = []
  const errors: string[] = []
  const decoder = new TextDecoder()

  let offset = 0

  while (offset + 4 <= data.length) {
    const lenHex = String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    )

    // Handle special packets
    if (lenHex === FLUSH_PKT || lenHex === DELIM_PKT || lenHex === RESPONSE_END_PKT) {
      offset += 4
      continue
    }

    const len = parseInt(lenHex, 16)
    if (isNaN(len) || len < 5 || offset + len > data.length) {
      // Invalid or incomplete packet, try to recover
      offset++
      continue
    }

    // Channel byte is first byte of payload
    const channel = data[offset + 4] as SideBandChannel
    const payload = data.slice(offset + 5, offset + len)

    switch (channel) {
      case 1:
        // Pack data
        packChunks.push(payload)
        break
      case 2:
        // Progress
        const progressMsg = decoder.decode(payload)
        progress.push(progressMsg)
        options?.onProgress?.(progressMsg)
        break
      case 3:
        // Error
        const errorMsg = decoder.decode(payload)
        errors.push(errorMsg)
        options?.onError?.(errorMsg)
        break
      default:
        // Unknown channel - might be part of a different format
        // Try to recover by treating as data
        break
    }

    offset += len
  }

  // Concatenate pack chunks
  const totalLength = packChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const packData = new Uint8Array(totalLength)
  let packOffset = 0
  for (const chunk of packChunks) {
    packData.set(chunk, packOffset)
    packOffset += chunk.length
  }

  return { packData, progress, errors }
}

/**
 * Create a side-band packet for sending data
 *
 * @param channel - Channel number (1=data, 2=progress, 3=error)
 * @param data - Data to send
 * @returns Formatted pkt-line with channel byte
 */
export function createSideBandPacket(channel: SideBandChannel, data: Uint8Array): Uint8Array {
  const len = data.length + 5 // 4 for length + 1 for channel
  if (len > PKT_LINE_MAX_LENGTH) {
    throw new Error(`Side-band packet too long: ${data.length} bytes`)
  }
  const hex = len.toString(16).padStart(4, '0')
  const header = new TextEncoder().encode(hex)
  const result = new Uint8Array(len)
  result.set(header, 0)
  result[4] = channel
  result.set(data, 5)
  return result
}

/**
 * Check if data appears to be side-band formatted
 */
export function isSideBandFormat(data: Uint8Array): boolean {
  if (data.length < 5) return false

  // Check first packet
  const lenHex = String.fromCharCode(data[0], data[1], data[2], data[3])
  const len = parseInt(lenHex, 16)

  if (isNaN(len) || len < 5 || len > PKT_LINE_MAX_LENGTH) return false

  // Check channel byte
  const channel = data[4]
  return channel >= 1 && channel <= 3
}
