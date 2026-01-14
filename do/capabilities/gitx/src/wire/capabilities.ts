/**
 * @fileoverview Git wire protocol capability negotiation
 *
 * This module implements the capability negotiation mechanism used in Git's wire protocol.
 * Capabilities are exchanged during the initial handshake between git client and server
 * to determine what features are supported by both sides, enabling backward compatibility
 * and feature detection.
 *
 * ## Protocol Versions
 *
 * **Protocol v1:**
 * - Capabilities are sent as a space-separated list after the first ref line
 * - Format: `<oid> <refname>\0<cap1> <cap2> cap3=value...`
 * - The NUL byte (`\0`) separates ref information from capabilities
 * - Only the first ref line contains capabilities
 *
 * **Protocol v2:**
 * - Capabilities are advertised line by line in the initial handshake
 * - Starts with `version 2` line
 * - Each capability on its own line, with optional values after `=`
 * - More structured and extensible than v1
 *
 * ## Common Capabilities
 *
 * **Fetch operations:**
 * - `multi_ack`, `multi_ack_detailed`: Improved negotiation
 * - `thin-pack`: Send thin packs requiring client to resolve deltas
 * - `side-band`, `side-band-64k`: Multiplexed data channels
 * - `ofs-delta`: Use offset-based delta encoding
 * - `shallow`: Support shallow clone operations
 *
 * **Push operations:**
 * - `report-status`, `report-status-v2`: Push result reporting
 * - `atomic`: All-or-nothing ref updates
 * - `delete-refs`: Allow ref deletion
 * - `push-options`: Support push options
 *
 * ## Usage Example
 *
 * ```typescript
 * import {
 *   parseCapabilityString,
 *   findCommonCapabilities,
 *   buildCapabilityString,
 *   DEFAULT_FETCH_CAPABILITIES_V1
 * } from './capabilities';
 *
 * // Parse capabilities from server advertisement
 * const serverCaps = parseCapabilityString('abc123... refs/heads/main\0multi_ack side-band-64k');
 *
 * // Find common capabilities
 * const clientCaps = DEFAULT_FETCH_CAPABILITIES_V1.map(name => ({ name }));
 * const common = findCommonCapabilities(clientCaps, serverCaps);
 *
 * // Build capability string for request
 * const capString = buildCapabilityString([
 *   { name: 'multi_ack' },
 *   { name: 'agent', value: 'gitdo/1.0' }
 * ]);
 * ```
 *
 * @module wire/capabilities
 * @see {@link https://git-scm.com/docs/protocol-capabilities} - Protocol capabilities reference
 * @see {@link https://git-scm.com/docs/protocol-v2} - Protocol v2 specification
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Git wire protocol version.
 *
 * @description
 * Represents the Git wire protocol version used for communication.
 * Version 1 is the traditional protocol, while version 2 offers improved
 * capability negotiation and command structure.
 *
 * @example
 * ```typescript
 * const version: ProtocolVersion = 2;
 *
 * if (version === 2) {
 *   // Use v2 command-based protocol
 * } else {
 *   // Use v1 ref advertisement protocol
 * }
 * ```
 */
export type ProtocolVersion = 1 | 2

/**
 * Standard protocol v1 capabilities.
 *
 * @description
 * Union type of all standard capability names supported in Git protocol v1.
 * These capabilities control various aspects of fetch and push operations.
 *
 * **Negotiation capabilities:**
 * - `multi_ack`: Multiple acknowledgment during negotiation
 * - `multi_ack_detailed`: Extended ack with common/ready/continue states
 *
 * **Pack transfer capabilities:**
 * - `thin-pack`: Allow thin packs requiring delta base reconstruction
 * - `side-band`, `side-band-64k`: Multiplexed data/progress/error channels
 * - `ofs-delta`: Use offset-based delta references (more efficient)
 * - `include-tag`: Include tags that point to requested objects
 *
 * **Shallow clone capabilities:**
 * - `shallow`: Basic shallow clone support
 * - `deepen-since`: Shallow by date
 * - `deepen-not`: Shallow excluding specific refs
 * - `deepen-relative`: Deepen relative to current shallow boundary
 *
 * **Push capabilities:**
 * - `report-status`, `report-status-v2`: Detailed push result reporting
 * - `delete-refs`: Allow ref deletion via push
 * - `atomic`: Atomic ref updates (all-or-nothing)
 * - `push-options`: Support for push options
 * - `push-cert`: Push certificate for signed pushes
 * - `quiet`: Suppress progress output
 *
 * **Other capabilities:**
 * - `no-progress`: Client doesn't want progress messages
 * - `allow-tip-sha1-in-want`: Allow fetching by SHA-1 at ref tips
 * - `allow-reachable-sha1-in-want`: Allow fetching any reachable SHA-1
 * - `filter`: Partial clone filtering support
 * - `agent`: Client/server identification
 * - `symref`: Symbolic ref information (e.g., HEAD -> refs/heads/main)
 * - `object-format`: Hash algorithm (sha1 or sha256)
 *
 * @example
 * ```typescript
 * const caps: CapabilityV1[] = ['multi_ack_detailed', 'side-band-64k', 'thin-pack'];
 *
 * const entries: CapabilityEntry[] = caps.map(name => ({ name }));
 * ```
 */
export type CapabilityV1 =
  | 'multi_ack'
  | 'multi_ack_detailed'
  | 'thin-pack'
  | 'side-band'
  | 'side-band-64k'
  | 'ofs-delta'
  | 'shallow'
  | 'deepen-since'
  | 'deepen-not'
  | 'deepen-relative'
  | 'no-progress'
  | 'include-tag'
  | 'report-status'
  | 'report-status-v2'
  | 'delete-refs'
  | 'quiet'
  | 'atomic'
  | 'push-options'
  | 'allow-tip-sha1-in-want'
  | 'allow-reachable-sha1-in-want'
  | 'push-cert'
  | 'filter'
  | 'agent'
  | 'symref'
  | 'object-format'

/**
 * Protocol v2 capabilities/commands.
 *
 * @description
 * Union type of capabilities and commands available in Git protocol v2.
 * Protocol v2 uses a command-based model where capabilities are more
 * like available services.
 *
 * **Commands:**
 * - `ls-refs`: List refs (replaces ref advertisement)
 * - `fetch`: Fetch objects (replaces upload-pack negotiation)
 * - `object-info`: Query object information without fetching
 * - `bundle-uri`: Bundle URI advertisement
 *
 * **Other capabilities:**
 * - `agent`: Client/server identification
 * - `server-option`: Support for server-specific options
 * - `object-format`: Hash algorithm (sha1 or sha256)
 * - `session-id`: Session tracking for debugging
 * - `wait-for-done`: Wait for client "done" before sending pack
 *
 * @example
 * ```typescript
 * const v2Caps: CapabilityV2[] = ['ls-refs', 'fetch', 'agent'];
 * ```
 */
export type CapabilityV2 =
  | 'agent'
  | 'ls-refs'
  | 'fetch'
  | 'server-option'
  | 'object-format'
  | 'session-id'
  | 'wait-for-done'
  | 'object-info'
  | 'bundle-uri'

/**
 * Capability with optional value.
 *
 * @description
 * Represents a single capability entry that may have an associated value.
 * Some capabilities are boolean (presence indicates support), while others
 * carry values (e.g., `agent=git/2.30.0`, `symref=HEAD:refs/heads/main`).
 *
 * @example
 * ```typescript
 * // Boolean capability (no value)
 * const multiAck: CapabilityEntry = { name: 'multi_ack' };
 *
 * // Capability with value
 * const agent: CapabilityEntry = { name: 'agent', value: 'gitdo/1.0' };
 *
 * // Symref capability (multiple values possible)
 * const symref: CapabilityEntry = { name: 'symref', value: 'HEAD:refs/heads/main' };
 * ```
 */
export interface CapabilityEntry {
  /**
   * The capability name (e.g., 'multi_ack', 'agent', 'symref').
   * Must not contain spaces, NUL bytes, or newlines.
   */
  name: string

  /**
   * Optional value for the capability.
   * Format depends on the capability (e.g., 'git/2.30.0' for agent).
   * @default undefined
   */
  value?: string
}

/**
 * Parsed capability set.
 *
 * @description
 * A collection of capabilities parsed from a protocol exchange,
 * along with the protocol version. Provides efficient lookup
 * via a Map structure.
 *
 * @example
 * ```typescript
 * const capSet: CapabilitySet = {
 *   version: 1,
 *   capabilities: new Map([
 *     ['multi_ack', undefined],
 *     ['side-band-64k', undefined],
 *     ['agent', 'git/2.30.0'],
 *     ['symref', 'HEAD:refs/heads/main']
 *   ])
 * };
 *
 * // Check if capability exists
 * if (capSet.capabilities.has('multi_ack')) {
 *   console.log('Server supports multi_ack');
 * }
 *
 * // Get capability value
 * const agent = capSet.capabilities.get('agent');
 * ```
 */
export interface CapabilitySet {
  /**
   * Protocol version being used (1 or 2).
   */
  version: ProtocolVersion

  /**
   * Map of capability name to optional value.
   * The key is the capability name, value is the capability value or undefined.
   */
  capabilities: Map<string, string | undefined>
}

/**
 * Ref advertisement with capabilities (protocol v1).
 *
 * @description
 * Represents a single ref line from the server's ref advertisement.
 * The first ref line includes capabilities after a NUL byte separator.
 *
 * @example
 * ```typescript
 * // First ref (with capabilities)
 * const firstRef: RefAdvertisement = {
 *   oid: 'abc123def456...',
 *   name: 'refs/heads/main',
 *   capabilities: {
 *     version: 1,
 *     capabilities: new Map([['multi_ack', undefined]])
 *   }
 * };
 *
 * // Subsequent ref (no capabilities)
 * const otherRef: RefAdvertisement = {
 *   oid: 'def789abc012...',
 *   name: 'refs/heads/feature'
 * };
 * ```
 */
export interface RefAdvertisement {
  /**
   * The SHA-1 hash of the ref's target object.
   * 40 hexadecimal characters for SHA-1.
   */
  oid: string

  /**
   * The full ref name (e.g., 'refs/heads/main', 'refs/tags/v1.0').
   */
  name: string

  /**
   * Capabilities advertised by the server.
   * Only present on the first ref line in protocol v1.
   * @default undefined
   */
  capabilities?: CapabilitySet
}

/**
 * Protocol v2 server capabilities response.
 *
 * @description
 * Parsed server capability advertisement for protocol v2.
 * Unlike v1, protocol v2 separates commands (services) from
 * general capabilities and provides structured sub-capability values.
 *
 * @example
 * ```typescript
 * const serverCaps: ServerCapabilitiesV2 = {
 *   version: 2,
 *   commands: ['ls-refs', 'fetch', 'server-option'],
 *   agent: 'git/2.40.0',
 *   objectFormat: 'sha1',
 *   capabilities: new Map([
 *     ['fetch', 'shallow filter'],
 *     ['ls-refs', 'symrefs peel']
 *   ])
 * };
 *
 * if (serverCaps.commands.includes('fetch')) {
 *   console.log('Server supports fetch command');
 * }
 * ```
 */
export interface ServerCapabilitiesV2 {
  /**
   * Protocol version, always 2 for this interface.
   */
  version: 2

  /**
   * List of supported commands/services.
   * Common commands: 'ls-refs', 'fetch', 'server-option'.
   */
  commands: string[]

  /**
   * Agent identification string (e.g., 'git/2.40.0').
   * @default undefined
   */
  agent?: string

  /**
   * Object hash format used by the repository.
   * @default undefined (implies 'sha1')
   */
  objectFormat?: 'sha1' | 'sha256'

  /**
   * Map of capability names to values.
   * Commands may have sub-capabilities as values (e.g., 'fetch' -> 'shallow filter').
   */
  capabilities: Map<string, string | undefined>
}

/**
 * Want line with capabilities for fetch request.
 *
 * @description
 * Represents a client's fetch request specifying which objects are wanted
 * and what capabilities the client supports. Capabilities are only sent
 * with the first want line.
 *
 * @example
 * ```typescript
 * const request: WantRequest = {
 *   wants: [
 *     'abc123def456789012345678901234567890abcd',
 *     'def456789012345678901234567890abcdef12'
 *   ],
 *   capabilities: [
 *     { name: 'multi_ack_detailed' },
 *     { name: 'side-band-64k' },
 *     { name: 'agent', value: 'gitdo/1.0' }
 *   ]
 * };
 *
 * const lines = buildFetchRequest(request);
 * // First line: "want abc123... multi_ack_detailed side-band-64k agent=gitdo/1.0\n"
 * // Second line: "want def456...\n"
 * ```
 */
export interface WantRequest {
  /**
   * SHA-1 hashes of objects the client wants to receive.
   * These are typically commit objects at ref tips.
   */
  wants: string[]

  /**
   * Capabilities to advertise to the server.
   * Sent only with the first want line.
   */
  capabilities: CapabilityEntry[]
}

/**
 * Have line for negotiation.
 *
 * @description
 * Represents objects the client already has, used during negotiation
 * to determine the minimal set of objects to send.
 *
 * @example
 * ```typescript
 * const haves: HaveRequest = {
 *   haves: [
 *     'abc123def456789012345678901234567890abcd',
 *     'def456789012345678901234567890abcdef12'
 *   ],
 *   done: true
 * };
 * ```
 */
export interface HaveRequest {
  /**
   * SHA-1 hashes of objects the client already has.
   * Used to find common ancestors and minimize data transfer.
   */
  haves: string[]

  /**
   * Whether this is the final batch of have lines.
   * When true, indicates the client is ready to receive the packfile.
   * @default undefined
   */
  done?: boolean
}

/**
 * Version negotiation result.
 *
 * @description
 * Result of protocol version negotiation between client and server.
 * The agreed version determines the communication format.
 *
 * @example
 * ```typescript
 * const result = negotiateVersion('version 2', 2);
 * // result.version === 2
 * // result.serverSupportsV2 === true
 *
 * const resultV1 = negotiateVersion('abc123... refs/heads/main\0multi_ack', 2);
 * // resultV1.version === 1
 * // resultV1.serverSupportsV2 === false
 * ```
 */
export interface VersionNegotiationResult {
  /**
   * The protocol version that will be used.
   * This is the lower of the client's preference and server's support.
   */
  version: ProtocolVersion

  /**
   * Whether the server advertised protocol v2 support.
   */
  serverSupportsV2: boolean

  /**
   * Capability names supported by both client and server.
   */
  commonCapabilities: string[]
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default client capabilities for fetch operations (protocol v1).
 *
 * @description
 * A sensible set of capabilities for fetch operations that provides
 * good performance while maintaining compatibility. These are commonly
 * supported by modern Git servers.
 *
 * - `multi_ack_detailed`: Efficient negotiation with detailed feedback
 * - `side-band-64k`: Large multiplexed data channels for progress/data
 * - `thin-pack`: Receive thin packs (smaller transfer size)
 * - `ofs-delta`: Efficient delta encoding
 * - `agent`: Identify the client
 *
 * @example
 * ```typescript
 * const clientCaps = DEFAULT_FETCH_CAPABILITIES_V1.map(name => ({ name }));
 * // Add agent value
 * clientCaps.find(c => c.name === 'agent')!.value = 'gitdo/1.0';
 *
 * const selected = selectFetchCapabilities(serverCaps, clientCaps);
 * ```
 */
export const DEFAULT_FETCH_CAPABILITIES_V1: CapabilityV1[] = [
  'multi_ack_detailed',
  'side-band-64k',
  'thin-pack',
  'ofs-delta',
  'agent',
]

/**
 * Default client capabilities for push operations (protocol v1).
 *
 * @description
 * A sensible set of capabilities for push operations that provides
 * detailed feedback and compatibility with modern Git servers.
 *
 * - `report-status`: Receive detailed push result status
 * - `side-band-64k`: Multiplexed channels for status/errors
 * - `agent`: Identify the client
 * - `quiet`: Suppress unnecessary progress output
 *
 * @example
 * ```typescript
 * const pushCaps = DEFAULT_PUSH_CAPABILITIES_V1.map(name => ({ name }));
 * pushCaps.find(c => c.name === 'agent')!.value = 'gitdo/1.0';
 * ```
 */
export const DEFAULT_PUSH_CAPABILITIES_V1: CapabilityV1[] = [
  'report-status',
  'side-band-64k',
  'agent',
  'quiet',
]

/**
 * Minimum required capabilities for basic fetch.
 *
 * @description
 * Capabilities that must be present for fetch to work correctly.
 * Currently empty as Git is designed to work with minimal capabilities,
 * but this can be populated if specific capabilities become required.
 *
 * @example
 * ```typescript
 * const missing = validateRequiredCapabilities(serverCaps, REQUIRED_FETCH_CAPABILITIES);
 * if (missing.length > 0) {
 *   throw new Error(`Server missing required capabilities: ${missing.join(', ')}`);
 * }
 * ```
 */
export const REQUIRED_FETCH_CAPABILITIES: CapabilityV1[] = []

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a capability string from ref advertisement (protocol v1).
 *
 * @description
 * Extracts capabilities from a protocol v1 ref advertisement line.
 * The capabilities appear after a NUL byte (`\0`) separator following
 * the ref information. This is only present on the first ref line.
 *
 * Line format: `<oid> <refname>\0<cap1> <cap2> cap3=value...`
 *
 * @param line - The ref advertisement line containing capabilities
 * @returns Parsed capability set with version 1
 *
 * @throws {Error} If the line doesn't contain a NUL byte separator
 *
 * @example
 * ```typescript
 * // Parse from first ref line
 * const line = 'abc123def456789012345678901234567890abcd refs/heads/main\0multi_ack side-band-64k agent=git/2.30.0';
 * const caps = parseCapabilityString(line);
 *
 * console.log(caps.version); // 1
 * console.log(caps.capabilities.has('multi_ack')); // true
 * console.log(caps.capabilities.get('agent')); // 'git/2.30.0'
 * ```
 */
export function parseCapabilityString(line: string): CapabilitySet {
  // Find the NUL byte that separates ref info from capabilities
  const nulIndex = line.indexOf('\0')
  if (nulIndex === -1) {
    throw new Error('Invalid capability string: missing NUL byte separator')
  }

  // Extract the capability portion after the NUL byte
  const capString = line.slice(nulIndex + 1)

  // Parse the capabilities
  const entries = parseCapabilities(capString)

  // Build the capability map
  const capabilities = new Map<string, string | undefined>()
  for (const entry of entries) {
    capabilities.set(entry.name, entry.value)
  }

  return {
    version: 1,
    capabilities,
  }
}

/**
 * Parse individual capability entries from a space-separated string.
 *
 * @description
 * Parses a whitespace-separated capability string into individual entries.
 * Handles both simple capabilities (`multi_ack`) and capabilities with
 * values (`agent=git/2.30.0`).
 *
 * @param capString - Space-separated capability string
 * @returns Array of capability entries
 *
 * @example
 * ```typescript
 * // Simple capabilities
 * const caps1 = parseCapabilities('multi_ack thin-pack ofs-delta');
 * // [{ name: 'multi_ack' }, { name: 'thin-pack' }, { name: 'ofs-delta' }]
 *
 * // Capabilities with values
 * const caps2 = parseCapabilities('agent=git/2.30.0 symref=HEAD:refs/heads/main');
 * // [{ name: 'agent', value: 'git/2.30.0' }, { name: 'symref', value: 'HEAD:refs/heads/main' }]
 *
 * // Empty string
 * const caps3 = parseCapabilities('');
 * // []
 * ```
 */
export function parseCapabilities(capString: string): CapabilityEntry[] {
  // Trim and split by whitespace
  const trimmed = capString.trim()
  if (trimmed === '') {
    return []
  }

  // Split by whitespace (handles multiple spaces)
  const parts = trimmed.split(/\s+/)

  return parts.map((part) => {
    const eqIndex = part.indexOf('=')
    if (eqIndex === -1) {
      return { name: part }
    } else {
      return {
        name: part.slice(0, eqIndex),
        value: part.slice(eqIndex + 1),
      }
    }
  })
}

/**
 * Parse a ref advertisement line (protocol v1).
 *
 * @description
 * Parses a single line from the server's ref advertisement. The first
 * line has a special format including capabilities after a NUL byte,
 * while subsequent lines contain only the OID and ref name.
 *
 * First line format: `<oid> <refname>\0<capabilities>`
 * Subsequent lines: `<oid> <refname>`
 *
 * @param line - The pkt-line data (without length prefix)
 * @param isFirst - Whether this is the first line (contains capabilities)
 * @returns Parsed ref advertisement
 *
 * @throws {Error} If the first line is missing the NUL byte
 * @throws {Error} If the line is missing the space between OID and refname
 * @throws {Error} If the OID is not 40 characters (SHA-1)
 *
 * @example
 * ```typescript
 * // Parse first line (with capabilities)
 * const firstLine = 'abc123def456789012345678901234567890abcd refs/heads/main\0multi_ack side-band-64k\n';
 * const firstRef = parseRefAdvertisement(firstLine, true);
 * // {
 * //   oid: 'abc123def456789012345678901234567890abcd',
 * //   name: 'refs/heads/main',
 * //   capabilities: { version: 1, capabilities: Map {...} }
 * // }
 *
 * // Parse subsequent line (no capabilities)
 * const otherLine = 'def456789012345678901234567890abcdef12 refs/heads/feature\n';
 * const otherRef = parseRefAdvertisement(otherLine, false);
 * // {
 * //   oid: 'def456789012345678901234567890abcdef12',
 * //   name: 'refs/heads/feature'
 * // }
 * ```
 */
export function parseRefAdvertisement(line: string, isFirst: boolean): RefAdvertisement {
  // Remove trailing newline if present
  const cleanLine = line.replace(/\n$/, '')

  let oid: string
  let name: string
  let capabilities: CapabilitySet | undefined

  if (isFirst) {
    // First line has capabilities after NUL byte
    const nulIndex = cleanLine.indexOf('\0')
    if (nulIndex === -1) {
      throw new Error('First ref advertisement line must contain NUL byte')
    }

    const refPart = cleanLine.slice(0, nulIndex)
    const spaceIndex = refPart.indexOf(' ')
    if (spaceIndex === -1) {
      throw new Error('Invalid ref advertisement format: missing space between OID and refname')
    }

    oid = refPart.slice(0, spaceIndex)
    name = refPart.slice(spaceIndex + 1)

    // Validate OID length (should be 40 hex chars for SHA-1)
    if (oid.length !== 40) {
      throw new Error('Invalid OID length in ref advertisement')
    }

    capabilities = parseCapabilityString(cleanLine)
  } else {
    // Subsequent lines: just "<oid> <refname>"
    const spaceIndex = cleanLine.indexOf(' ')
    if (spaceIndex === -1) {
      throw new Error('Invalid ref advertisement format: missing space between OID and refname')
    }

    oid = cleanLine.slice(0, spaceIndex)
    name = cleanLine.slice(spaceIndex + 1)

    // Validate OID length
    if (oid.length !== 40) {
      throw new Error('Invalid OID length in ref advertisement')
    }
  }

  return {
    oid,
    name,
    capabilities,
  }
}

/**
 * Parse protocol v2 capability advertisement.
 *
 * @description
 * Parses the server's capability advertisement in protocol v2 format.
 * Protocol v2 uses a line-by-line format starting with "version 2",
 * followed by capability lines. Commands and capabilities are distinguished
 * by whether they have values.
 *
 * Response format:
 * ```
 * version 2
 * agent=git/2.30.0
 * ls-refs
 * fetch=shallow filter
 * server-option
 * object-format=sha1
 * ```
 *
 * @param lines - Array of pkt-line data (without length prefixes)
 * @returns Parsed server capabilities
 *
 * @throws {Error} If lines is empty or doesn't start with "version 2"
 *
 * @example
 * ```typescript
 * const lines = [
 *   'version 2',
 *   'agent=git/2.40.0',
 *   'ls-refs',
 *   'fetch=shallow filter',
 *   'server-option',
 *   'object-format=sha1'
 * ];
 *
 * const serverCaps = parseServerCapabilitiesV2(lines);
 * // {
 * //   version: 2,
 * //   commands: ['ls-refs', 'fetch', 'server-option'],
 * //   agent: 'git/2.40.0',
 * //   objectFormat: 'sha1',
 * //   capabilities: Map { 'ls-refs' => undefined, 'fetch' => 'shallow filter', ... }
 * // }
 *
 * if (serverCaps.commands.includes('fetch')) {
 *   console.log('Server supports fetch with:', serverCaps.capabilities.get('fetch'));
 * }
 * ```
 */
export function parseServerCapabilitiesV2(lines: string[]): ServerCapabilitiesV2 {
  if (lines.length === 0 || lines[0] !== 'version 2') {
    throw new Error('Invalid protocol v2 response: must start with "version 2"')
  }

  const commands: string[] = []
  const capabilities = new Map<string, string | undefined>()
  let agent: string | undefined
  let objectFormat: 'sha1' | 'sha256' | undefined

  // Process each line after "version 2"
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const eqIndex = line.indexOf('=')

    if (eqIndex === -1) {
      // This is a command without a value
      commands.push(line)
      capabilities.set(line, undefined)
    } else {
      const name = line.slice(0, eqIndex)
      const value = line.slice(eqIndex + 1)

      if (name === 'agent') {
        agent = value
      } else if (name === 'object-format') {
        objectFormat = value as 'sha1' | 'sha256'
      } else if (name === 'fetch' || name === 'ls-refs' || name === 'server-option') {
        // Commands with sub-capabilities
        commands.push(name)
        capabilities.set(name, value)
      } else {
        capabilities.set(name, value)
      }
    }
  }

  return {
    version: 2,
    commands,
    agent,
    objectFormat,
    capabilities,
  }
}

// ============================================================================
// Building Functions
// ============================================================================

/**
 * Build a capability string for want/have request (protocol v1).
 *
 * @description
 * Constructs a space-separated capability string from an array of
 * capability entries. Capabilities with values are formatted as
 * `name=value`, while those without are just the name.
 *
 * @param capabilities - Capabilities to include
 * @returns Space-separated capability string
 *
 * @example
 * ```typescript
 * const caps: CapabilityEntry[] = [
 *   { name: 'multi_ack_detailed' },
 *   { name: 'side-band-64k' },
 *   { name: 'agent', value: 'gitdo/1.0' }
 * ];
 *
 * const str = buildCapabilityString(caps);
 * // 'multi_ack_detailed side-band-64k agent=gitdo/1.0'
 * ```
 */
export function buildCapabilityString(capabilities: CapabilityEntry[]): string {
  return capabilities
    .map((cap) => {
      if (cap.value !== undefined) {
        return `${cap.name}=${cap.value}`
      }
      return cap.name
    })
    .join(' ')
}

/**
 * Build a want line with capabilities (first want only).
 *
 * @description
 * Constructs a want line for a fetch request. The first want line
 * includes capabilities, while subsequent want lines contain only
 * the object ID.
 *
 * Format: `want <oid> <capabilities>\n` (first line)
 * Format: `want <oid>\n` (subsequent lines)
 *
 * @param oid - The object ID to want (40-character SHA-1 hex string)
 * @param capabilities - Capabilities to include (optional, first want only)
 * @returns Formatted want line with trailing newline
 *
 * @example
 * ```typescript
 * // First want line with capabilities
 * const firstWant = buildWantLine(
 *   'abc123def456789012345678901234567890abcd',
 *   [{ name: 'multi_ack' }, { name: 'agent', value: 'gitdo/1.0' }]
 * );
 * // 'want abc123def456789012345678901234567890abcd multi_ack agent=gitdo/1.0\n'
 *
 * // Subsequent want line (no capabilities)
 * const nextWant = buildWantLine('def456789012345678901234567890abcdef12');
 * // 'want def456789012345678901234567890abcdef12\n'
 * ```
 */
export function buildWantLine(oid: string, capabilities?: CapabilityEntry[]): string {
  if (capabilities && capabilities.length > 0) {
    const capString = buildCapabilityString(capabilities)
    return `want ${oid} ${capString}\n`
  }
  return `want ${oid}\n`
}

/**
 * Build a have line for negotiation.
 *
 * @description
 * Constructs a have line used during fetch negotiation. Have lines
 * inform the server what objects the client already has, allowing
 * the server to determine the minimal set of objects to send.
 *
 * Format: `have <oid>\n`
 *
 * @param oid - The object ID we have (40-character SHA-1 hex string)
 * @returns Formatted have line with trailing newline
 *
 * @example
 * ```typescript
 * const haveLine = buildHaveLine('abc123def456789012345678901234567890abcd');
 * // 'have abc123def456789012345678901234567890abcd\n'
 *
 * // OID is normalized to lowercase
 * const normalized = buildHaveLine('ABC123DEF456789012345678901234567890ABCD');
 * // 'have abc123def456789012345678901234567890abcd\n'
 * ```
 */
export function buildHaveLine(oid: string): string {
  return `have ${oid.toLowerCase()}\n`
}

/**
 * Build a complete want/have request.
 *
 * @description
 * Constructs all want lines for a fetch request. The first want line
 * includes the client's capabilities, while subsequent want lines
 * contain only the object IDs.
 *
 * @param request - The want request containing object IDs and capabilities
 * @returns Array of formatted want lines (ready for pkt-line encoding)
 *
 * @example
 * ```typescript
 * const request: WantRequest = {
 *   wants: [
 *     'abc123def456789012345678901234567890abcd',
 *     'def456789012345678901234567890abcdef12',
 *     '123456789012345678901234567890abcdef00'
 *   ],
 *   capabilities: [
 *     { name: 'multi_ack_detailed' },
 *     { name: 'side-band-64k' }
 *   ]
 * };
 *
 * const lines = buildFetchRequest(request);
 * // [
 * //   'want abc123... multi_ack_detailed side-band-64k\n',
 * //   'want def456...\n',
 * //   'want 123456...\n'
 * // ]
 * ```
 */
export function buildFetchRequest(request: WantRequest): string[] {
  const lines: string[] = []

  for (let i = 0; i < request.wants.length; i++) {
    const oid = request.wants[i]
    if (i === 0) {
      // First want line includes capabilities
      lines.push(buildWantLine(oid, request.capabilities))
    } else {
      // Subsequent want lines don't include capabilities
      lines.push(buildWantLine(oid))
    }
  }

  return lines
}

/**
 * Build protocol v2 command request.
 *
 * @description
 * Constructs a protocol v2 command request. Protocol v2 uses a structured
 * format with command specification, capabilities, and optional arguments.
 *
 * Request format:
 * ```
 * command=<cmd>
 * capability1
 * capability2=value
 * 0001 (delimiter - added by caller)
 * <command-specific args>
 * 0000 (flush - added by caller)
 * ```
 *
 * @param command - The v2 command (e.g., 'fetch', 'ls-refs')
 * @param capabilities - Client capabilities to advertise
 * @param args - Command-specific arguments (optional)
 * @returns Array of lines (ready for pkt-line encoding)
 *
 * @example
 * ```typescript
 * // ls-refs request
 * const lsRefsLines = buildV2CommandRequest(
 *   'ls-refs',
 *   [{ name: 'agent', value: 'gitdo/1.0' }],
 *   ['peel', 'symrefs', 'ref-prefix refs/heads/']
 * );
 * // [
 * //   'command=ls-refs',
 * //   'agent=gitdo/1.0',
 * //   'peel',
 * //   'symrefs',
 * //   'ref-prefix refs/heads/'
 * // ]
 *
 * // fetch request
 * const fetchLines = buildV2CommandRequest(
 *   'fetch',
 *   [{ name: 'agent', value: 'gitdo/1.0' }, { name: 'thin-pack' }],
 *   ['want abc123...', 'have def456...', 'done']
 * );
 * ```
 */
export function buildV2CommandRequest(
  command: string,
  capabilities: CapabilityEntry[],
  args?: string[]
): string[] {
  const lines: string[] = []

  // Add command line
  lines.push(`command=${command}`)

  // Add capabilities
  for (const cap of capabilities) {
    if (cap.value !== undefined) {
      lines.push(`${cap.name}=${cap.value}`)
    } else {
      lines.push(cap.name)
    }
  }

  // Add arguments if present
  if (args && args.length > 0) {
    for (const arg of args) {
      lines.push(arg)
    }
  }

  return lines
}

// ============================================================================
// Negotiation Functions
// ============================================================================

/**
 * Negotiate protocol version with server.
 *
 * @description
 * Determines the protocol version to use based on the server's advertisement
 * and the client's preference. The negotiated version is the highest version
 * supported by both parties.
 *
 * @param serverAdvertisement - First line from server's response
 * @param preferredVersion - Client's preferred protocol version (default: 2)
 * @returns Negotiation result with agreed version
 *
 * @example
 * ```typescript
 * // Server supports v2, client prefers v2
 * const v2Result = negotiateVersion('version 2', 2);
 * // { version: 2, serverSupportsV2: true, commonCapabilities: [] }
 *
 * // Server is v1 only, client prefers v2
 * const v1Result = negotiateVersion('abc123... refs/heads/main\0multi_ack', 2);
 * // { version: 1, serverSupportsV2: false, commonCapabilities: [] }
 *
 * // Client explicitly wants v1
 * const explicitV1 = negotiateVersion('version 2', 1);
 * // { version: 1, serverSupportsV2: true, commonCapabilities: [] }
 * ```
 */
export function negotiateVersion(
  serverAdvertisement: string,
  preferredVersion: ProtocolVersion = 2
): VersionNegotiationResult {
  const serverSupportsV2 = serverAdvertisement.startsWith('version 2')

  let version: ProtocolVersion
  if (serverSupportsV2 && preferredVersion === 2) {
    version = 2
  } else {
    version = 1
  }

  return {
    version,
    serverSupportsV2,
    commonCapabilities: [],
  }
}

/**
 * Find common capabilities between client and server.
 *
 * @description
 * Determines which capabilities are supported by both the client and server.
 * This is used to select the optimal set of capabilities for the session.
 *
 * @param clientCaps - Client's supported capabilities
 * @param serverCaps - Server's advertised capabilities
 * @returns Array of capability names supported by both parties
 *
 * @example
 * ```typescript
 * const clientCaps: CapabilityEntry[] = [
 *   { name: 'multi_ack_detailed' },
 *   { name: 'side-band-64k' },
 *   { name: 'thin-pack' },
 *   { name: 'ofs-delta' }
 * ];
 *
 * const serverCaps: CapabilitySet = {
 *   version: 1,
 *   capabilities: new Map([
 *     ['multi_ack', undefined],
 *     ['multi_ack_detailed', undefined],
 *     ['side-band-64k', undefined],
 *     ['shallow', undefined]
 *   ])
 * };
 *
 * const common = findCommonCapabilities(clientCaps, serverCaps);
 * // ['multi_ack_detailed', 'side-band-64k']
 * ```
 */
export function findCommonCapabilities(
  clientCaps: CapabilityEntry[],
  serverCaps: CapabilitySet
): string[] {
  const common: string[] = []

  for (const clientCap of clientCaps) {
    if (serverCaps.capabilities.has(clientCap.name)) {
      common.push(clientCap.name)
    }
  }

  return common
}

/**
 * Check if a specific capability is supported.
 *
 * @description
 * Checks whether a capability is present in the capability set.
 * This is a convenience wrapper around Map.has().
 *
 * @param capSet - The capability set to check
 * @param name - The capability name to look for
 * @returns True if the capability is present
 *
 * @example
 * ```typescript
 * const caps: CapabilitySet = {
 *   version: 1,
 *   capabilities: new Map([
 *     ['multi_ack', undefined],
 *     ['side-band-64k', undefined],
 *     ['agent', 'git/2.30.0']
 *   ])
 * };
 *
 * hasCapability(caps, 'multi_ack');      // true
 * hasCapability(caps, 'side-band-64k');  // true
 * hasCapability(caps, 'thin-pack');      // false
 * ```
 */
export function hasCapability(capSet: CapabilitySet, name: string): boolean {
  return capSet.capabilities.has(name)
}

/**
 * Get the value of a capability (if it has one).
 *
 * @description
 * Retrieves the value associated with a capability. Returns undefined
 * if the capability is not present or has no value.
 *
 * @param capSet - The capability set to query
 * @param name - The capability name
 * @returns The capability value, or undefined if not present/no value
 *
 * @example
 * ```typescript
 * const caps: CapabilitySet = {
 *   version: 1,
 *   capabilities: new Map([
 *     ['multi_ack', undefined],
 *     ['agent', 'git/2.30.0'],
 *     ['symref', 'HEAD:refs/heads/main']
 *   ])
 * };
 *
 * getCapabilityValue(caps, 'agent');     // 'git/2.30.0'
 * getCapabilityValue(caps, 'symref');    // 'HEAD:refs/heads/main'
 * getCapabilityValue(caps, 'multi_ack'); // undefined (present but no value)
 * getCapabilityValue(caps, 'thin-pack'); // undefined (not present)
 * ```
 */
export function getCapabilityValue(capSet: CapabilitySet, name: string): string | undefined {
  return capSet.capabilities.get(name)
}

/**
 * Create a capability set from entries.
 *
 * @description
 * Constructs a CapabilitySet from an array of capability entries.
 * This is useful for creating capability sets programmatically.
 *
 * @param version - Protocol version (1 or 2)
 * @param entries - Array of capability entries
 * @returns A new CapabilitySet
 *
 * @example
 * ```typescript
 * const entries: CapabilityEntry[] = [
 *   { name: 'multi_ack_detailed' },
 *   { name: 'side-band-64k' },
 *   { name: 'agent', value: 'gitdo/1.0' }
 * ];
 *
 * const capSet = createCapabilitySet(1, entries);
 * // {
 * //   version: 1,
 * //   capabilities: Map {
 * //     'multi_ack_detailed' => undefined,
 * //     'side-band-64k' => undefined,
 * //     'agent' => 'gitdo/1.0'
 * //   }
 * // }
 * ```
 */
export function createCapabilitySet(
  version: ProtocolVersion,
  entries: CapabilityEntry[]
): CapabilitySet {
  const capabilities = new Map<string, string | undefined>()

  for (const entry of entries) {
    capabilities.set(entry.name, entry.value)
  }

  return {
    version,
    capabilities,
  }
}

/**
 * Select optimal capabilities for a fetch operation.
 *
 * @description
 * Filters client-preferred capabilities to only those supported by the server.
 * The client's values are preserved (not the server's), maintaining client
 * identification and preferences.
 *
 * @param serverCaps - Server's advertised capabilities
 * @param clientPrefs - Client's preferred capabilities (in priority order)
 * @returns Array of capabilities to use (subset of client preferences)
 *
 * @example
 * ```typescript
 * const serverCaps: CapabilitySet = {
 *   version: 1,
 *   capabilities: new Map([
 *     ['multi_ack', undefined],
 *     ['side-band-64k', undefined],
 *     ['thin-pack', undefined]
 *   ])
 * };
 *
 * const clientPrefs: CapabilityEntry[] = [
 *   { name: 'multi_ack_detailed' },  // Not supported by server
 *   { name: 'multi_ack' },           // Supported
 *   { name: 'side-band-64k' },       // Supported
 *   { name: 'ofs-delta' },           // Not supported
 *   { name: 'agent', value: 'gitdo/1.0' }  // Not in server caps
 * ];
 *
 * const selected = selectFetchCapabilities(serverCaps, clientPrefs);
 * // [
 * //   { name: 'multi_ack' },
 * //   { name: 'side-band-64k' }
 * // ]
 * ```
 */
export function selectFetchCapabilities(
  serverCaps: CapabilitySet,
  clientPrefs: CapabilityEntry[]
): CapabilityEntry[] {
  const selected: CapabilityEntry[] = []

  for (const pref of clientPrefs) {
    if (serverCaps.capabilities.has(pref.name)) {
      // Use the client's value, not the server's
      selected.push(pref)
    }
  }

  return selected
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate that a capability name is well-formed.
 *
 * @description
 * Checks that a capability name follows the Git protocol requirements.
 * Capability names must be non-empty and cannot contain spaces, NUL bytes,
 * or newline characters.
 *
 * @param name - The capability name to validate
 * @returns True if the name is valid
 *
 * @example
 * ```typescript
 * isValidCapabilityName('multi_ack');        // true
 * isValidCapabilityName('side-band-64k');    // true
 * isValidCapabilityName('agent');            // true
 * isValidCapabilityName('');                 // false (empty)
 * isValidCapabilityName('multi ack');        // false (contains space)
 * isValidCapabilityName('cap\0name');        // false (contains NUL)
 * isValidCapabilityName('cap\nname');        // false (contains newline)
 * ```
 */
export function isValidCapabilityName(name: string): boolean {
  if (name === '') {
    return false
  }

  // Check for invalid characters (spaces, NUL, newlines)
  if (/[\s\0\n]/.test(name)) {
    return false
  }

  return true
}

/**
 * Validate that required capabilities are present.
 *
 * @description
 * Checks a capability set for the presence of all required capabilities.
 * Returns an array of missing capability names. An empty array indicates
 * all requirements are satisfied.
 *
 * @param capSet - The capability set to validate
 * @param required - Array of required capability names
 * @returns Array of missing capability names (empty if all present)
 *
 * @example
 * ```typescript
 * const caps: CapabilitySet = {
 *   version: 1,
 *   capabilities: new Map([
 *     ['multi_ack', undefined],
 *     ['side-band-64k', undefined]
 *   ])
 * };
 *
 * // All present
 * const missing1 = validateRequiredCapabilities(caps, ['multi_ack']);
 * // []
 *
 * // Some missing
 * const missing2 = validateRequiredCapabilities(caps, ['multi_ack', 'thin-pack', 'ofs-delta']);
 * // ['thin-pack', 'ofs-delta']
 *
 * if (missing2.length > 0) {
 *   throw new Error(`Server missing capabilities: ${missing2.join(', ')}`);
 * }
 * ```
 */
export function validateRequiredCapabilities(
  capSet: CapabilitySet,
  required: string[]
): string[] {
  const missing: string[] = []

  for (const reqCap of required) {
    if (!capSet.capabilities.has(reqCap)) {
      missing.push(reqCap)
    }
  }

  return missing
}
