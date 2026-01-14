/**
 * @fileoverview Git pkt-line Protocol Implementation
 *
 * This module implements the pkt-line format used in Git's wire protocol for
 * client-server communication. The pkt-line format provides a simple framing
 * mechanism for variable-length data.
 *
 * @module wire/pkt-line
 *
 * ## Format Overview
 *
 * Each packet consists of a 4-byte hex length prefix followed by the data:
 * - Length includes the 4-byte prefix itself
 * - Maximum packet size is 65520 bytes (65516 data + 4 prefix)
 *
 * ## Special Packets
 *
 * - **flush-pkt** (`0000`): Indicates end of a message section
 * - **delim-pkt** (`0001`): Delimiter used in protocol v2
 *
 * @see {@link https://git-scm.com/docs/protocol-common#_pkt_line_format} Git pkt-line Format
 *
 * @example Basic encoding and decoding
 * ```typescript
 * import { encodePktLine, decodePktLine, FLUSH_PKT } from './wire/pkt-line'
 *
 * // Encode a message
 * const encoded = encodePktLine('hello\n')
 * // Result: '000ahello\n'
 *
 * // Decode a message
 * const decoded = decodePktLine('000ahello\n')
 * // Result: { data: 'hello\n', bytesRead: 10 }
 *
 * // Use flush packet to end a section
 * const message = encodePktLine('line1\n') + encodePktLine('line2\n') + FLUSH_PKT
 * ```
 *
 * @example Streaming multiple packets
 * ```typescript
 * import { pktLineStream } from './wire/pkt-line'
 *
 * const stream = '0009line1\n0009line2\n0000'
 * const { packets, remaining } = pktLineStream(stream)
 *
 * for (const packet of packets) {
 *   if (packet.type === 'flush') {
 *     console.log('End of section')
 *   } else {
 *     console.log('Data:', packet.data)
 *   }
 * }
 * ```
 */

/**
 * Flush packet - indicates end of a message section.
 *
 * @description
 * The flush packet is a special 4-byte sequence `0000` that signals
 * the end of a logical section in the protocol. It's used to:
 * - End ref advertisements
 * - Separate negotiation phases
 * - Signal end of packfile transmission
 *
 * @example
 * ```typescript
 * // Build a complete ref advertisement
 * let response = encodePktLine('# service=git-upload-pack\n')
 * response += FLUSH_PKT  // End service announcement
 * response += encodePktLine('abc123 refs/heads/main\n')
 * response += FLUSH_PKT  // End ref list
 * ```
 */
export const FLUSH_PKT = '0000'

/**
 * Delimiter packet - used in protocol v2.
 *
 * @description
 * The delimiter packet `0001` is used in Git protocol v2 to separate
 * sections within a single message, such as between command parameters
 * and command arguments.
 *
 * @example
 * ```typescript
 * // Protocol v2 command format
 * let request = encodePktLine('command=fetch')
 * request += encodePktLine('agent=git/2.30.0')
 * request += DELIM_PKT  // Separate metadata from arguments
 * request += encodePktLine('want abc123...')
 * request += FLUSH_PKT  // End of request
 * ```
 */
export const DELIM_PKT = '0001'

/**
 * Maximum pkt-line data size in bytes.
 *
 * @description
 * The maximum data that can be included in a single pkt-line is 65516 bytes.
 * This is calculated as: 65520 (max packet) - 4 (length prefix) = 65516.
 *
 * Attempting to encode data larger than this will result in an error
 * or require splitting into multiple packets.
 */
export const MAX_PKT_LINE_DATA = 65516

/**
 * Input type for pkt-line encoding/decoding functions.
 *
 * @description
 * Pkt-line functions accept both string and binary data:
 * - `string`: Used for text-based protocol messages
 * - `Uint8Array`: Used for binary data like packfiles
 */
type PktLineInput = string | Uint8Array

/**
 * Result of decoding a single pkt-line.
 *
 * @description
 * Contains the decoded data and metadata about the packet:
 * - For data packets: `data` contains the payload, `bytesRead` is the packet size
 * - For flush packets: `data` is null, `type` is 'flush', `bytesRead` is 4
 * - For delimiter packets: `data` is null, `type` is 'delim', `bytesRead` is 4
 * - For incomplete data: `data` is null, `type` is 'incomplete', `bytesRead` is 0
 */
interface DecodedPktLine {
  /** The decoded data payload, or null for special/incomplete packets */
  data: string | null
  /** Packet type for special packets: 'flush', 'delim', or 'incomplete' */
  type?: 'flush' | 'delim' | 'incomplete'
  /** Number of bytes consumed from the input */
  bytesRead: number
}

/**
 * A single packet in a pkt-line stream.
 *
 * @description
 * Represents one packet parsed from a stream:
 * - `data`: Packets with payload have `type: 'data'` and non-null `data`
 * - `flush`: Special packet with `type: 'flush'` and null `data`
 * - `delim`: Special packet with `type: 'delim'` and null `data`
 */
interface StreamPacket {
  /** The packet data, or null for special packets */
  data: string | null
  /** The packet type */
  type: 'data' | 'flush' | 'delim'
}

/**
 * Result of parsing a pkt-line stream.
 *
 * @description
 * Contains all successfully parsed packets and any remaining unparsed data.
 * The `remaining` field is useful for streaming scenarios where data arrives
 * in chunks and a packet might be split across chunks.
 */
interface PktLineStreamResult {
  /** Array of parsed packets */
  packets: StreamPacket[]
  /** Any remaining unparsed data (incomplete packet) */
  remaining: string
}

/**
 * Encode data into pkt-line format.
 *
 * @description
 * Encodes the given data with a 4-character hex length prefix. The length
 * includes the 4-byte prefix itself, so a 6-byte payload results in a
 * 10-byte packet with prefix "000a".
 *
 * For binary data containing non-printable characters, returns a Uint8Array.
 * For text data, returns a string for easier concatenation.
 *
 * @param data - The data to encode (string or Uint8Array)
 * @returns Encoded pkt-line as string (for text) or Uint8Array (for binary)
 *
 * @throws {Error} If data exceeds MAX_PKT_LINE_DATA bytes
 *
 * @example Encoding text data
 * ```typescript
 * const line = encodePktLine('hello\n')
 * // Result: '000ahello\n'
 * // Length: 4 (prefix) + 6 (data) = 10 = 0x000a
 * ```
 *
 * @example Encoding binary data
 * ```typescript
 * const binaryData = new Uint8Array([0x01, 0x02, 0x03])
 * const encoded = encodePktLine(binaryData)
 * // Result: Uint8Array with hex prefix + data
 * ```
 *
 * @example Building a multi-line message
 * ```typescript
 * let message = ''
 * message += encodePktLine('want abc123...\n') as string
 * message += encodePktLine('have def456...\n') as string
 * message += FLUSH_PKT
 * ```
 */
export function encodePktLine(data: PktLineInput): string | Uint8Array {
  if (typeof data === 'string') {
    // String encoding - simple case
    const length = 4 + data.length
    const hexLength = length.toString(16).padStart(4, '0')
    return hexLength + data
  }

  // Uint8Array encoding
  const length = 4 + data.length
  const hexLength = length.toString(16).padStart(4, '0')

  // Check if data contains only printable ASCII
  const isPrintable = data.every(byte => byte >= 0x20 && byte <= 0x7e || byte === 0x0a || byte === 0x0d)

  if (isPrintable) {
    // Return as string for printable content
    return hexLength + new TextDecoder().decode(data)
  }

  // Return as Uint8Array for binary content
  const result = new Uint8Array(4 + data.length)
  const encoder = new TextEncoder()
  result.set(encoder.encode(hexLength), 0)
  result.set(data, 4)
  return result
}

/**
 * Decode a pkt-line format message.
 *
 * @description
 * Parses a single pkt-line from the input and returns the decoded data
 * along with metadata about the packet. Handles special packets (flush,
 * delim) and incomplete data gracefully.
 *
 * The function validates packet size to prevent denial-of-service attacks
 * from maliciously large length values.
 *
 * @param input - The input to decode (string or Uint8Array)
 * @returns Object with decoded data, packet type (if special), and bytes consumed
 *
 * @throws {Error} If packet size exceeds MAX_PKT_LINE_DATA + 4
 *
 * @example Decoding a data packet
 * ```typescript
 * const result = decodePktLine('000ahello\n')
 * // result.data === 'hello\n'
 * // result.bytesRead === 10
 * // result.type === undefined (data packet)
 * ```
 *
 * @example Decoding a flush packet
 * ```typescript
 * const result = decodePktLine('0000remaining...')
 * // result.data === null
 * // result.type === 'flush'
 * // result.bytesRead === 4
 * ```
 *
 * @example Handling incomplete data
 * ```typescript
 * const result = decodePktLine('00')  // Not enough for length prefix
 * // result.data === null
 * // result.type === 'incomplete'
 * // result.bytesRead === 0
 * ```
 */
export function decodePktLine(input: PktLineInput): DecodedPktLine {
  // Convert to string for easier parsing
  let str: string
  if (typeof input === 'string') {
    str = input
  } else {
    str = new TextDecoder().decode(input)
  }

  // Need at least 4 bytes for length prefix
  if (str.length < 4) {
    return { data: null, type: 'incomplete', bytesRead: 0 }
  }

  const hexLength = str.slice(0, 4)

  // Check for special packets
  if (hexLength === '0000') {
    return { data: null, type: 'flush', bytesRead: 4 }
  }

  if (hexLength === '0001') {
    return { data: null, type: 'delim', bytesRead: 4 }
  }

  // Parse the length
  const length = parseInt(hexLength, 16)

  if (isNaN(length) || length < 4) {
    return { data: null, type: 'incomplete', bytesRead: 0 }
  }

  // Validate packet size to prevent DoS attacks
  if (length > MAX_PKT_LINE_DATA + 4) {
    throw new Error(`Packet too large: ${length} bytes exceeds maximum ${MAX_PKT_LINE_DATA + 4}`)
  }

  // Check if we have enough data
  if (str.length < length) {
    return { data: null, type: 'incomplete', bytesRead: 0 }
  }

  // Extract data (length includes the 4-byte prefix)
  const data = str.slice(4, length)

  return { data, bytesRead: length }
}

/**
 * Create a flush-pkt (0000).
 *
 * @description
 * Returns the flush packet constant. Primarily useful for explicit intent
 * in code, as you can also use FLUSH_PKT directly.
 *
 * The flush packet signals the end of a logical section in the protocol.
 *
 * @returns The flush packet string '0000'
 *
 * @example
 * ```typescript
 * // These are equivalent:
 * const flush1 = encodeFlushPkt()
 * const flush2 = FLUSH_PKT
 *
 * // Using in a message
 * const message = encodePktLine('data\n') + encodeFlushPkt()
 * ```
 */
export function encodeFlushPkt(): string {
  return FLUSH_PKT
}

/**
 * Create a delim-pkt (0001).
 *
 * @description
 * Returns the delimiter packet constant. The delimiter packet is used
 * in Git protocol v2 to separate sections within a command.
 *
 * @returns The delimiter packet string '0001'
 *
 * @example
 * ```typescript
 * // Protocol v2 ls-refs command
 * let request = encodePktLine('command=ls-refs')
 * request += encodeDelimPkt()  // Separator
 * request += encodePktLine('ref-prefix refs/heads/')
 * request += encodeFlushPkt()  // End
 * ```
 */
export function encodeDelimPkt(): string {
  return DELIM_PKT
}

/**
 * Parse a stream of pkt-lines.
 *
 * @description
 * Parses multiple pkt-lines from an input stream, returning all complete
 * packets and any remaining unparsed data. This is useful for:
 * - Processing multi-packet messages
 * - Handling streaming data that arrives in chunks
 * - Parsing complete protocol exchanges
 *
 * The function continues parsing until it encounters incomplete data
 * or reaches the end of input.
 *
 * @param input - The input stream to parse (string or Uint8Array)
 * @returns Object with parsed packets and any remaining unparsed data
 *
 * @example Parsing a complete message
 * ```typescript
 * const stream = '0009line1\n0009line2\n0000'
 * const { packets, remaining } = pktLineStream(stream)
 *
 * // packets = [
 * //   { data: 'line1\n', type: 'data' },
 * //   { data: 'line2\n', type: 'data' },
 * //   { data: null, type: 'flush' }
 * // ]
 * // remaining = ''
 * ```
 *
 * @example Handling chunked data
 * ```typescript
 * // First chunk arrives
 * let buffer = '0009line1\n00'  // Incomplete second packet
 * let result = pktLineStream(buffer)
 * // result.packets = [{ data: 'line1\n', type: 'data' }]
 * // result.remaining = '00'
 *
 * // Second chunk arrives
 * buffer = result.remaining + '09line2\n0000'
 * result = pktLineStream(buffer)
 * // result.packets = [
 * //   { data: 'line2\n', type: 'data' },
 * //   { data: null, type: 'flush' }
 * // ]
 * ```
 *
 * @example Processing ref advertisement
 * ```typescript
 * const refAdvert = '001e# service=git-upload-pack\n0000' +
 *                   '003fabc123... refs/heads/main\x00side-band-64k\n0000'
 *
 * const { packets } = pktLineStream(refAdvert)
 * for (const pkt of packets) {
 *   if (pkt.type === 'flush') {
 *     console.log('--- Section end ---')
 *   } else if (pkt.data) {
 *     console.log('Line:', pkt.data.trim())
 *   }
 * }
 * ```
 */
export function pktLineStream(input: PktLineInput): PktLineStreamResult {
  const packets: StreamPacket[] = []

  // Convert to string for parsing
  let str: string
  if (typeof input === 'string') {
    str = input
  } else {
    str = new TextDecoder().decode(input)
  }

  let offset = 0

  while (offset < str.length) {
    const remaining = str.slice(offset)
    const result = decodePktLine(remaining)

    if (result.type === 'incomplete') {
      // Return remaining unparsed data
      return { packets, remaining: remaining }
    }

    if (result.type === 'flush') {
      packets.push({ data: null, type: 'flush' })
    } else if (result.type === 'delim') {
      packets.push({ data: null, type: 'delim' })
    } else {
      packets.push({ data: result.data, type: 'data' })
    }

    offset += result.bytesRead
  }

  return { packets, remaining: '' }
}
