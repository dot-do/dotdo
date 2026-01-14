/**
 * Git Protocol v2 Support
 *
 * Implements Git protocol version 2 for more efficient communication.
 * See: https://git-scm.com/docs/protocol-v2
 *
 * Protocol v2 Benefits:
 * - Server-side ref filtering (don't transfer all refs)
 * - More efficient capability negotiation
 * - Command-based structure (ls-refs, fetch)
 * - Better support for large repositories
 */

// =============================================================================
// Constants
// =============================================================================

/** Protocol v2 header */
export const GIT_PROTOCOL_V2_HEADER = 'version=2'

/** Flush packet */
export const FLUSH_PKT = '0000'

/** Delimiter packet (v2 command separator) */
export const DELIM_PKT = '0001'

/** Response end packet */
export const RESPONSE_END_PKT = '0002'

// =============================================================================
// Types
// =============================================================================

/** Protocol v2 commands */
export type ProtocolV2Command = 'ls-refs' | 'fetch' | 'object-info'

/** Server capabilities for protocol v2 */
export interface ProtocolV2Capabilities {
  /** Protocol version */
  version: 2
  /** Supported commands */
  commands: Set<ProtocolV2Command>
  /** Object format (sha1, sha256) */
  objectFormat?: string
  /** Server agent string */
  agent?: string
  /** Raw capability list */
  raw: string[]
}

/** Options for ls-refs command */
export interface LsRefsOptions {
  /** Reference prefixes to filter (e.g., "refs/heads/") */
  refPrefixes?: string[]
  /** Include symref information */
  symrefs?: boolean
  /** Include peeled tag information */
  peel?: boolean
  /** Don't show peeled tags */
  unborn?: boolean
}

/** Reference from ls-refs response */
export interface V2RefInfo {
  /** Object ID (SHA) */
  oid: string
  /** Full reference name */
  name: string
  /** Symref target (if symref) */
  symrefTarget?: string
  /** Peeled object ID (for tags) */
  peeled?: string
}

/** Options for fetch command */
export interface FetchOptions {
  /** Object IDs we want */
  wants: string[]
  /** Object IDs we have (for negotiation) */
  haves?: string[]
  /** Request by ref name instead of OID */
  wantRefs?: string[]
  /** Only send haves for known refs */
  haveTips?: string[]
  /** Shallow depth */
  depth?: number
  /** Shallow since timestamp */
  deepenSince?: Date
  /** Don't deepen beyond these refs */
  deepenNot?: string[]
  /** Filter objects (partial clone) */
  filter?: string
  /** Include tags that point to requested objects */
  includeTag?: boolean
  /** Request thin pack */
  thinPack?: boolean
  /** Request ofs-delta encoding */
  ofsDelta?: boolean
  /** Don't send progress messages */
  noProgress?: boolean
  /** Progress callback for side-band messages */
  onProgress?: (message: string) => void
  /** Error callback for side-band errors */
  onError?: (message: string) => void
}

/** Result of fetch command */
export interface FetchResult {
  /** Packfile data (channel 1) */
  packfile: Uint8Array
  /** Progress messages (channel 2) */
  progressMessages: string[]
  /** Error messages (channel 3) */
  errorMessages: string[]
  /** Shallow boundaries */
  shallows?: string[]
  /** Unshallow boundaries */
  unshallows?: string[]
  /** ACKs received during negotiation */
  acks?: string[]
}

/** Side-band channel types */
export type SideBandChannel = 1 | 2 | 3

/** Side-band demultiplexed data */
export interface SideBandData {
  channel: SideBandChannel
  data: Uint8Array
}

// =============================================================================
// Pkt-line Utilities
// =============================================================================

/**
 * Create a pkt-line formatted string
 */
export function pktLine(content: string): string {
  const len = content.length + 4
  if (len > 65520) {
    throw new Error(`pkt-line too long: ${len} bytes (max 65520)`)
  }
  const hex = len.toString(16).padStart(4, '0')
  return hex + content
}

/**
 * Create a pkt-line from binary data
 */
export function pktLineBinary(content: Uint8Array): Uint8Array {
  const len = content.length + 4
  if (len > 65520) {
    throw new Error(`pkt-line too long: ${len} bytes (max 65520)`)
  }
  const hex = len.toString(16).padStart(4, '0')
  const header = new TextEncoder().encode(hex)
  const result = new Uint8Array(len)
  result.set(header, 0)
  result.set(content, 4)
  return result
}

/**
 * Parse pkt-lines from text input
 */
export function parsePktLines(text: string): string[] {
  const lines: string[] = []
  let offset = 0

  while (offset < text.length) {
    // Skip any leading whitespace/newlines
    while (offset < text.length && (text[offset] === '\n' || text[offset] === '\r')) {
      offset++
    }
    if (offset >= text.length) break

    // Read 4-byte hex length
    const lenHex = text.slice(offset, offset + 4)

    // Special packets
    if (lenHex === FLUSH_PKT) {
      offset += 4
      lines.push('')
      continue
    }
    if (lenHex === DELIM_PKT) {
      offset += 4
      lines.push('\x01') // Delimiter marker
      continue
    }
    if (lenHex === RESPONSE_END_PKT) {
      offset += 4
      lines.push('\x02') // Response end marker
      continue
    }

    const len = parseInt(lenHex, 16)
    if (isNaN(len) || len < 4) {
      break
    }

    // Get content
    const content = text.slice(offset + 4, offset + len)
    lines.push(content.replace(/\n$/, ''))
    offset += len
  }

  return lines
}

/**
 * Parse pkt-lines from binary input
 */
export function parsePktLinesBinary(data: Uint8Array): Array<{ type: 'data' | 'flush' | 'delim' | 'end', payload?: Uint8Array }> {
  const packets: Array<{ type: 'data' | 'flush' | 'delim' | 'end', payload?: Uint8Array }> = []
  let offset = 0

  while (offset < data.length) {
    if (offset + 4 > data.length) break

    const lenHex = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])

    if (lenHex === FLUSH_PKT) {
      packets.push({ type: 'flush' })
      offset += 4
      continue
    }
    if (lenHex === DELIM_PKT) {
      packets.push({ type: 'delim' })
      offset += 4
      continue
    }
    if (lenHex === RESPONSE_END_PKT) {
      packets.push({ type: 'end' })
      offset += 4
      continue
    }

    const len = parseInt(lenHex, 16)
    if (isNaN(len) || len < 4) {
      break
    }

    if (offset + len > data.length) {
      break
    }

    const payload = data.slice(offset + 4, offset + len)
    packets.push({ type: 'data', payload })
    offset += len
  }

  return packets
}

// =============================================================================
// Protocol v2 Capability Parsing
// =============================================================================

/**
 * Parse protocol v2 capability advertisement
 *
 * Format:
 * ```
 * version 2
 * agent=git/2.39.0
 * ls-refs
 * fetch=shallow
 * object-format=sha1
 * ```
 */
export function parseV2Capabilities(text: string): ProtocolV2Capabilities {
  const lines = parsePktLines(text)
  const capabilities: ProtocolV2Capabilities = {
    version: 2,
    commands: new Set(),
    raw: [],
  }

  for (const line of lines) {
    if (!line || line === '\x01' || line === '\x02') continue

    const trimmed = line.trim()
    if (!trimmed) continue

    capabilities.raw.push(trimmed)

    // Version line
    if (trimmed === 'version 2') {
      continue
    }

    // Agent
    if (trimmed.startsWith('agent=')) {
      capabilities.agent = trimmed.slice(6)
      continue
    }

    // Object format
    if (trimmed.startsWith('object-format=')) {
      capabilities.objectFormat = trimmed.slice(14)
      continue
    }

    // Commands (may have =features suffix)
    if (trimmed === 'ls-refs' || trimmed.startsWith('ls-refs=')) {
      capabilities.commands.add('ls-refs')
      continue
    }
    if (trimmed === 'fetch' || trimmed.startsWith('fetch=')) {
      capabilities.commands.add('fetch')
      continue
    }
    if (trimmed === 'object-info' || trimmed.startsWith('object-info=')) {
      capabilities.commands.add('object-info')
      continue
    }
  }

  return capabilities
}

// =============================================================================
// Command Generation
// =============================================================================

/**
 * Generate ls-refs command request
 */
export function generateLsRefsCommand(options: LsRefsOptions = {}): string {
  const lines: string[] = []

  // Command line
  lines.push(pktLine('command=ls-refs\n'))

  // Delimiter before arguments
  lines.push(DELIM_PKT)

  // Options
  if (options.peel) {
    lines.push(pktLine('peel\n'))
  }
  if (options.symrefs) {
    lines.push(pktLine('symrefs\n'))
  }
  if (options.unborn) {
    lines.push(pktLine('unborn\n'))
  }

  // Reference prefixes
  if (options.refPrefixes && options.refPrefixes.length > 0) {
    for (const prefix of options.refPrefixes) {
      lines.push(pktLine(`ref-prefix ${prefix}\n`))
    }
  }

  // Flush to end command
  lines.push(FLUSH_PKT)

  return lines.join('')
}

/**
 * Parse ls-refs response
 */
export function parseLsRefsResponse(text: string): V2RefInfo[] {
  const lines = parsePktLines(text)
  const refs: V2RefInfo[] = []

  for (const line of lines) {
    if (!line || line === '\x01' || line === '\x02') continue

    const trimmed = line.trim()
    if (!trimmed) continue

    // Format: <oid> <refname>[ <attributes>]
    // Example: abc123 refs/heads/main symref-target:HEAD
    const parts = trimmed.split(' ')
    if (parts.length < 2) continue

    const oid = parts[0]
    const name = parts[1]

    // Validate OID (should be 40 hex chars for SHA-1)
    if (!/^[0-9a-f]{40}$/i.test(oid)) continue

    const ref: V2RefInfo = { oid, name }

    // Parse attributes
    for (let i = 2; i < parts.length; i++) {
      const attr = parts[i]
      if (attr.startsWith('symref-target:')) {
        ref.symrefTarget = attr.slice(14)
      } else if (attr.startsWith('peeled:')) {
        ref.peeled = attr.slice(7)
      }
    }

    refs.push(ref)
  }

  return refs
}

/**
 * Generate fetch command request
 */
export function generateFetchCommand(options: FetchOptions): string {
  const lines: string[] = []

  // Command line
  lines.push(pktLine('command=fetch\n'))

  // Delimiter before arguments
  lines.push(DELIM_PKT)

  // Capabilities/options
  if (options.thinPack) {
    lines.push(pktLine('thin-pack\n'))
  }
  if (options.ofsDelta) {
    lines.push(pktLine('ofs-delta\n'))
  }
  if (options.noProgress) {
    lines.push(pktLine('no-progress\n'))
  }
  if (options.includeTag) {
    lines.push(pktLine('include-tag\n'))
  }

  // Filter for partial clone
  if (options.filter) {
    lines.push(pktLine(`filter ${options.filter}\n`))
  }

  // Depth options
  if (options.depth !== undefined) {
    lines.push(pktLine(`deepen ${options.depth}\n`))
  }
  if (options.deepenSince) {
    const timestamp = Math.floor(options.deepenSince.getTime() / 1000)
    lines.push(pktLine(`deepen-since ${timestamp}\n`))
  }
  if (options.deepenNot && options.deepenNot.length > 0) {
    for (const ref of options.deepenNot) {
      lines.push(pktLine(`deepen-not ${ref}\n`))
    }
  }

  // Wants by OID
  for (const want of options.wants) {
    lines.push(pktLine(`want ${want}\n`))
  }

  // Wants by ref name (v2 feature)
  if (options.wantRefs) {
    for (const ref of options.wantRefs) {
      lines.push(pktLine(`want-ref ${ref}\n`))
    }
  }

  // Haves
  if (options.haves && options.haves.length > 0) {
    for (const have of options.haves) {
      lines.push(pktLine(`have ${have}\n`))
    }
  }

  // Have tips (only negotiate using specific refs)
  if (options.haveTips && options.haveTips.length > 0) {
    for (const tip of options.haveTips) {
      lines.push(pktLine(`have-tip ${tip}\n`))
    }
  }

  // Done to indicate we're ready for packfile
  lines.push(pktLine('done\n'))

  // Flush to end command
  lines.push(FLUSH_PKT)

  return lines.join('')
}

// =============================================================================
// Side-band Demultiplexing
// =============================================================================

/**
 * Demultiplex side-band-64k response data
 *
 * Side-band format:
 * - Each pkt-line starts with 4-byte length
 * - First byte after length is channel: 1=data, 2=progress, 3=error
 * - Rest is payload
 */
export function demuxSideBand(data: Uint8Array, options?: {
  onProgress?: (message: string) => void
  onError?: (message: string) => void
}): FetchResult {
  const packfileChunks: Uint8Array[] = []
  const progressMessages: string[] = []
  const errorMessages: string[] = []
  const shallows: string[] = []
  const unshallows: string[] = []
  const acks: string[] = []

  let offset = 0
  const decoder = new TextDecoder()

  while (offset < data.length) {
    if (offset + 4 > data.length) break

    // Read length prefix
    const lenHex = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])

    // Handle special packets
    if (lenHex === FLUSH_PKT) {
      offset += 4
      continue
    }
    if (lenHex === DELIM_PKT) {
      offset += 4
      continue
    }
    if (lenHex === RESPONSE_END_PKT) {
      offset += 4
      continue
    }

    const len = parseInt(lenHex, 16)
    if (isNaN(len) || len < 4) {
      // Try to find next valid packet
      offset++
      continue
    }

    if (offset + len > data.length) {
      // Incomplete packet, try to use remaining data
      break
    }

    // Check if this is a side-band packet (length > 4 and first payload byte is 1-3)
    if (len > 4) {
      const channelByte = data[offset + 4]

      if (channelByte >= 1 && channelByte <= 3) {
        const payload = data.slice(offset + 5, offset + len)

        switch (channelByte) {
          case 1:
            // Packfile data
            packfileChunks.push(payload)
            break
          case 2:
            // Progress messages
            const progress = decoder.decode(payload)
            progressMessages.push(progress)
            if (options?.onProgress) {
              options.onProgress(progress)
            }
            break
          case 3:
            // Error messages
            const error = decoder.decode(payload)
            errorMessages.push(error)
            if (options?.onError) {
              options.onError(error)
            }
            break
        }
      } else {
        // Not a side-band packet, might be control message
        const content = decoder.decode(data.slice(offset + 4, offset + len))

        // Parse control messages
        if (content.startsWith('shallow ')) {
          shallows.push(content.slice(8).trim())
        } else if (content.startsWith('unshallow ')) {
          unshallows.push(content.slice(10).trim())
        } else if (content.startsWith('ACK ')) {
          acks.push(content.slice(4).trim())
        } else if (content.startsWith('NAK')) {
          // NAK is normal, continue
        } else if (content.startsWith('packfile')) {
          // Packfile section marker
        }
      }
    }

    offset += len
  }

  // Concatenate packfile chunks
  const totalLength = packfileChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const packfile = new Uint8Array(totalLength)
  let packOffset = 0
  for (const chunk of packfileChunks) {
    packfile.set(chunk, packOffset)
    packOffset += chunk.length
  }

  return {
    packfile,
    progressMessages,
    errorMessages,
    shallows: shallows.length > 0 ? shallows : undefined,
    unshallows: unshallows.length > 0 ? unshallows : undefined,
    acks: acks.length > 0 ? acks : undefined,
  }
}

/**
 * Parse a fetch response which may include control messages before packfile
 */
export function parseFetchResponse(data: Uint8Array, options?: {
  onProgress?: (message: string) => void
  onError?: (message: string) => void
}): FetchResult {
  // First, check if this uses side-band format
  // Side-band responses have pkt-lines with channel byte

  // Look for acknowledgments and shallow info before packfile
  const decoder = new TextDecoder()
  let offset = 0
  const shallows: string[] = []
  const unshallows: string[] = []
  const acks: string[] = []
  let packfileStart = 0

  // Scan for control messages
  while (offset < data.length) {
    if (offset + 4 > data.length) break

    const lenHex = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])

    if (lenHex === FLUSH_PKT || lenHex === DELIM_PKT || lenHex === RESPONSE_END_PKT) {
      offset += 4
      continue
    }

    const len = parseInt(lenHex, 16)
    if (isNaN(len) || len < 4 || offset + len > data.length) {
      break
    }

    // Check first byte after length
    const firstByte = data[offset + 4]

    // If this is a side-band packet, delegate to demuxSideBand
    if (firstByte >= 1 && firstByte <= 3) {
      packfileStart = offset
      break
    }

    // Otherwise parse as text control message
    const content = decoder.decode(data.slice(offset + 4, offset + len)).trim()

    if (content.startsWith('shallow ')) {
      shallows.push(content.slice(8))
    } else if (content.startsWith('unshallow ')) {
      unshallows.push(content.slice(10))
    } else if (content.startsWith('ACK ')) {
      acks.push(content.slice(4))
    } else if (content === 'NAK') {
      // Normal
    } else if (content === 'packfile') {
      // Next packets are the packfile
      offset += len
      packfileStart = offset
      break
    }

    offset += len
  }

  // Demux remaining data as side-band
  const sideBandData = data.slice(packfileStart)
  const result = demuxSideBand(sideBandData, options)

  // Merge in pre-packfile control messages
  if (shallows.length > 0) {
    result.shallows = [...shallows, ...(result.shallows || [])]
  }
  if (unshallows.length > 0) {
    result.unshallows = [...unshallows, ...(result.unshallows || [])]
  }
  if (acks.length > 0) {
    result.acks = [...acks, ...(result.acks || [])]
  }

  return result
}

// =============================================================================
// Protocol Version Detection
// =============================================================================

/**
 * Check if server supports protocol v2 from capability advertisement
 */
export function supportsProtocolV2(capabilities: ProtocolV2Capabilities | null): boolean {
  if (!capabilities) return false
  return capabilities.version === 2 && capabilities.commands.size > 0
}

/**
 * Build HTTP headers for protocol v2 request
 */
export function buildProtocolV2Headers(): Headers {
  const headers = new Headers()
  headers.set('Git-Protocol', GIT_PROTOCOL_V2_HEADER)
  return headers
}
