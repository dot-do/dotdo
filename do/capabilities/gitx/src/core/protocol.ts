/**
 * @fileoverview Git Wire Protocol Types and Utilities (Platform Agnostic)
 *
 * Re-exports from the core protocol module with backward compatibility layer.
 *
 * @module @dotdo/gitx/protocol
 */

// Re-export everything from the core protocol module
export * from '../../core/protocol'

// ============================================================================
// Legacy Types (for backward compatibility)
// ============================================================================

/**
 * Git capability advertised during protocol negotiation.
 */
export interface Capability {
  name: string
  value?: string
}

/**
 * Reference advertisement from server.
 */
export interface RefAdvertisement {
  sha: string
  name: string
  peeled?: string
}

/**
 * Git protocol version.
 */
export type ProtocolVersion = 1 | 2

/**
 * Request for git-upload-pack (fetch/clone).
 */
export interface UploadPackRequest {
  wants: string[]
  haves: string[]
  depth?: number
  shallows?: string[]
  deepenSince?: Date
  deepenNot?: string[]
  includeTags?: boolean
  done?: boolean
}

/**
 * Response from git-upload-pack.
 */
export interface UploadPackResponse {
  acks: Array<{ sha: string; type: 'continue' | 'common' | 'ready' }>
  nak?: boolean
  shallows?: string[]
  unshallows?: string[]
  packData?: Uint8Array
}

/**
 * Request for git-receive-pack (push).
 */
export interface ReceivePackRequest {
  updates: RefUpdate[]
  packData?: Uint8Array
  reportStatus?: boolean
  sideBand?: boolean
}

/**
 * A single reference update in a push.
 */
export interface RefUpdate {
  refName: string
  oldSha: string
  newSha: string
}

/**
 * Response from git-receive-pack.
 */
export interface ReceivePackResponse {
  status: 'ok' | 'error'
  refStatuses: Array<{
    refName: string
    status: 'ok' | 'ng'
    message?: string
  }>
}

// ============================================================================
// Legacy Constants
// ============================================================================

/**
 * Zero SHA used for ref creation/deletion.
 */
export const ZERO_SHA = '0000000000000000000000000000000000000000'

/**
 * Known Git capabilities.
 */
export const CAPABILITIES = {
  MULTI_ACK: 'multi_ack',
  MULTI_ACK_DETAILED: 'multi_ack_detailed',
  NO_DONE: 'no-done',
  THIN_PACK: 'thin-pack',
  SIDE_BAND: 'side-band',
  SIDE_BAND_64K: 'side-band-64k',
  OFS_DELTA: 'ofs-delta',
  SHALLOW: 'shallow',
  DEEPEN_SINCE: 'deepen-since',
  DEEPEN_NOT: 'deepen-not',
  DEEPEN_RELATIVE: 'deepen-relative',
  NO_PROGRESS: 'no-progress',
  INCLUDE_TAG: 'include-tag',
  REPORT_STATUS: 'report-status',
  DELETE_REFS: 'delete-refs',
  QUIET: 'quiet',
  ATOMIC: 'atomic',
  PUSH_OPTIONS: 'push-options',
  ALLOW_TIP_SHA1_IN_WANT: 'allow-tip-sha1-in-want',
  ALLOW_REACHABLE_SHA1_IN_WANT: 'allow-reachable-sha1-in-want',
  SYMREF: 'symref',
  AGENT: 'agent',
} as const

/**
 * Side-band channel IDs.
 */
export const SIDE_BAND = {
  DATA: 1,
  PROGRESS: 2,
  ERROR: 3,
} as const

// ============================================================================
// Legacy Pkt-line Protocol
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Encode a line in pkt-line format.
 */
export function encodePktLine(data: string | Uint8Array): Uint8Array {
  const content = typeof data === 'string' ? encoder.encode(data) : data
  const length = content.length + 4
  const lengthHex = length.toString(16).padStart(4, '0')
  const result = new Uint8Array(length)
  result.set(encoder.encode(lengthHex), 0)
  result.set(content, 4)
  return result
}

/**
 * Create a flush packet.
 */
export function flushPkt(): Uint8Array {
  return encoder.encode('0000')
}

/**
 * Create a delimiter packet (protocol v2).
 */
export function delimPkt(): Uint8Array {
  return encoder.encode('0001')
}

/**
 * Create a response-end packet (protocol v2).
 */
export function responseEndPkt(): Uint8Array {
  return encoder.encode('0002')
}

/**
 * Parse pkt-line data.
 */
export function parsePktLines(data: Uint8Array): Array<Uint8Array | null> {
  const lines: Array<Uint8Array | null> = []
  let offset = 0

  while (offset < data.length) {
    if (offset + 4 > data.length) {
      throw new Error('Incomplete pkt-line: not enough bytes for length')
    }

    const lengthHex = decoder.decode(data.slice(offset, offset + 4))
    const length = parseInt(lengthHex, 16)

    if (length === 0 || length === 1 || length === 2) {
      lines.push(null)
      offset += 4
    } else if (length < 4) {
      throw new Error(`Invalid pkt-line length: ${length}`)
    } else {
      if (offset + length > data.length) {
        throw new Error(`Incomplete pkt-line: expected ${length} bytes`)
      }
      const content = data.slice(offset + 4, offset + length)
      lines.push(content)
      offset += length
    }
  }

  return lines
}

/**
 * Parse a single pkt-line from data.
 */
export function parsePktLine(data: Uint8Array): { line: Uint8Array | null; remaining: Uint8Array } {
  if (data.length < 4) {
    throw new Error('Incomplete pkt-line: not enough bytes for length')
  }

  const lengthHex = decoder.decode(data.slice(0, 4))
  const length = parseInt(lengthHex, 16)

  if (length === 0 || length === 1 || length === 2) {
    return {
      line: null,
      remaining: data.slice(4),
    }
  }

  if (length < 4) {
    throw new Error(`Invalid pkt-line length: ${length}`)
  }

  if (data.length < length) {
    throw new Error(`Incomplete pkt-line: expected ${length} bytes`)
  }

  return {
    line: data.slice(4, length),
    remaining: data.slice(length),
  }
}

// ============================================================================
// Legacy Capability Parsing
// ============================================================================

/**
 * Parse capabilities from the first ref line.
 */
export function parseCapabilities(line: string): Capability[] {
  const nullIndex = line.indexOf('\0')
  if (nullIndex === -1) {
    return []
  }

  const capString = line.slice(nullIndex + 1).trim()
  if (!capString) {
    return []
  }

  return capString.split(' ').map(cap => {
    const eqIndex = cap.indexOf('=')
    if (eqIndex !== -1) {
      return {
        name: cap.slice(0, eqIndex),
        value: cap.slice(eqIndex + 1),
      }
    }
    return { name: cap }
  })
}

/**
 * Format capabilities for protocol negotiation.
 */
export function formatCapabilities(caps: Capability[]): string {
  return caps.map(cap => {
    if (cap.value !== undefined) {
      return `${cap.name}=${cap.value}`
    }
    return cap.name
  }).join(' ')
}

/**
 * Check if a specific capability is present.
 */
export function hasCapability(caps: Capability[], name: string): boolean {
  return caps.some(cap => cap.name === name)
}

/**
 * Get the value of a capability.
 */
export function getCapabilityValue(caps: Capability[], name: string): string | undefined {
  const cap = caps.find(c => c.name === name)
  return cap?.value
}

// ============================================================================
// Legacy Reference Advertisement Parsing
// ============================================================================

/**
 * Parse reference advertisements from server.
 */
export function parseRefAdvertisements(lines: Array<Uint8Array | null>): {
  refs: RefAdvertisement[]
  capabilities: Capability[]
} {
  const refs: RefAdvertisement[] = []
  let capabilities: Capability[] = []
  let isFirst = true

  for (const lineData of lines) {
    if (lineData === null) {
      continue
    }

    let line = decoder.decode(lineData)

    if (line.endsWith('\n')) {
      line = line.slice(0, -1)
    }

    if (isFirst) {
      capabilities = parseCapabilities(line)
      const nullIndex = line.indexOf('\0')
      if (nullIndex !== -1) {
        line = line.slice(0, nullIndex)
      }
      isFirst = false
    }

    const match = line.match(/^([0-9a-f]{40})\s+(.+)$/)
    if (match) {
      const sha = match[1]
      let name = match[2]

      if (name.endsWith('^{}')) {
        const baseName = name.slice(0, -3)
        const tagRef = refs.find(r => r.name === baseName)
        if (tagRef) {
          tagRef.peeled = sha
        }
      } else {
        refs.push({ sha, name })
      }
    }
  }

  return { refs, capabilities }
}

/**
 * Format reference advertisements for sending.
 */
export function formatRefAdvertisements(
  refs: RefAdvertisement[],
  capabilities: Capability[]
): Uint8Array[] {
  const lines: Uint8Array[] = []

  if (refs.length === 0) {
    const capStr = formatCapabilities(capabilities)
    lines.push(encodePktLine(`${ZERO_SHA} capabilities^{}\0${capStr}\n`))
  } else {
    let isFirst = true
    for (const ref of refs) {
      let line = `${ref.sha} ${ref.name}`
      if (isFirst) {
        const capStr = formatCapabilities(capabilities)
        line += `\0${capStr}`
        isFirst = false
      }
      lines.push(encodePktLine(line + '\n'))

      if (ref.peeled) {
        lines.push(encodePktLine(`${ref.peeled} ${ref.name}^{}\n`))
      }
    }
  }

  lines.push(flushPkt())
  return lines
}
