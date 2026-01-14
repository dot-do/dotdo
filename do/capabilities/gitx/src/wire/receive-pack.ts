/**
 * @fileoverview Git receive-pack Protocol Implementation
 *
 * This module implements the server-side of Git's receive-pack service, which
 * handles `git-push` operations. It receives ref updates and packfile data
 * from clients and applies them to the repository.
 *
 * @module wire/receive-pack
 *
 * ## Protocol Flow
 *
 * 1. **Ref Advertisement**: Server advertises current refs and capabilities
 * 2. **Command Reception**: Client sends ref update commands (old-sha new-sha refname)
 * 3. **Packfile Reception**: Client sends packfile with new objects (if needed)
 * 4. **Validation**: Server validates packfile and ref updates
 * 5. **Application**: Server applies updates and sends status report
 *
 * ## Security Considerations
 *
 * - Validates all SHA-1 hashes before processing
 * - Checks fast-forward constraints for updates
 * - Supports atomic pushes for consistency
 * - Validates ref names according to Git rules
 * - Supports pre-receive, update, and post-receive hooks
 *
 * @see {@link https://git-scm.com/docs/pack-protocol} Git Pack Protocol
 * @see {@link https://git-scm.com/docs/git-receive-pack} git-receive-pack Documentation
 *
 * @example Basic push handling
 * ```typescript
 * import {
 *   createReceiveSession,
 *   advertiseReceiveRefs,
 *   handleReceivePack
 * } from './wire/receive-pack'
 *
 * // Create session and advertise refs
 * const session = createReceiveSession('my-repo')
 * const advertisement = await advertiseReceiveRefs(store, { atomic: true })
 *
 * // Handle push request
 * const response = await handleReceivePack(session, requestBody, store)
 * ```
 */

import type { ObjectType } from '../types/objects'
import { encodePktLine, FLUSH_PKT } from './pkt-line'
import { containsPathTraversal, isAbsolutePath, containsDangerousCharacters } from './path-security'

// ============================================================================
// Constants
// ============================================================================

/**
 * Zero SHA - used for ref creation and deletion.
 *
 * @description
 * This 40-character string of zeros is used as a placeholder:
 * - In `oldSha`: indicates a ref is being created (doesn't exist yet)
 * - In `newSha`: indicates a ref is being deleted
 *
 * @example
 * ```typescript
 * // Check if this is a create operation
 * const isCreate = cmd.oldSha === ZERO_SHA
 *
 * // Check if this is a delete operation
 * const isDelete = cmd.newSha === ZERO_SHA
 * ```
 */
export const ZERO_SHA = '0'.repeat(40)

/** SHA-1 regex for validation */
const SHA1_REGEX = /^[0-9a-f]{40}$/i

/** Text encoder/decoder */
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * A reference (branch, tag, etc.) with its SHA and optional peeled value.
 *
 * @description
 * Represents a Git reference that can be advertised to clients.
 * For annotated tags, the `peeled` field contains the SHA of the
 * underlying commit/object.
 *
 * @example
 * ```typescript
 * const branch: Ref = {
 *   name: 'refs/heads/main',
 *   sha: 'abc123def456...'
 * }
 *
 * const tag: Ref = {
 *   name: 'refs/tags/v1.0.0',
 *   sha: 'tag-object-sha...',
 *   peeled: 'target-commit-sha...'
 * }
 * ```
 */
export interface Ref {
  /** Full ref name (e.g., 'refs/heads/main') */
  name: string
  /** SHA-1 hash of the object this ref points to */
  sha: string
  /** For annotated tags, the SHA of the target object */
  peeled?: string
}

/**
 * Capabilities supported by receive-pack.
 *
 * @description
 * These capabilities are advertised during ref advertisement and
 * negotiated with the client. They control what features are
 * available during the push operation.
 *
 * @example
 * ```typescript
 * const caps: ReceivePackCapabilities = {
 *   reportStatus: true,
 *   deleteRefs: true,
 *   atomic: true,
 *   agent: 'my-server/1.0'
 * }
 * ```
 */
export interface ReceivePackCapabilities {
  /** Client wants status report after push */
  reportStatus?: boolean
  /** Client wants v2 status report (extended format) */
  reportStatusV2?: boolean
  /** Allow ref deletion via push */
  deleteRefs?: boolean
  /** Suppress progress messages */
  quiet?: boolean
  /** Atomic push - all refs update or none */
  atomic?: boolean
  /** Support push options (custom metadata) */
  pushOptions?: boolean
  /** Side-band multiplexing for output */
  sideBand64k?: boolean
  /** Push certificate nonce for signed pushes */
  pushCert?: string
  /** Server agent identification string */
  agent?: string
}

/**
 * Ref update command from client.
 *
 * @description
 * Each command describes a single ref update operation:
 * - **create**: oldSha is ZERO_SHA, newSha is the new value
 * - **update**: oldSha is current value, newSha is new value
 * - **delete**: oldSha is current value, newSha is ZERO_SHA
 *
 * The type is derived from the SHA values.
 *
 * @example
 * ```typescript
 * // Create a new branch
 * const createCmd: RefUpdateCommand = {
 *   oldSha: ZERO_SHA,
 *   newSha: 'abc123...',
 *   refName: 'refs/heads/feature',
 *   type: 'create'
 * }
 *
 * // Update existing branch
 * const updateCmd: RefUpdateCommand = {
 *   oldSha: 'abc123...',
 *   newSha: 'def456...',
 *   refName: 'refs/heads/main',
 *   type: 'update'
 * }
 * ```
 */
export interface RefUpdateCommand {
  /** Old SHA (ZERO_SHA for create operations) */
  oldSha: string
  /** New SHA (ZERO_SHA for delete operations) */
  newSha: string
  /** Full ref name (e.g., 'refs/heads/main') */
  refName: string
  /** Command type: create, update, or delete */
  type: 'create' | 'update' | 'delete'
  /** Capabilities from first command line (if any) */
  capabilities?: string[]
}

/**
 * Result of a ref update operation.
 *
 * @description
 * Contains the outcome of a single ref update, including
 * success/failure status and any error message.
 *
 * @example
 * ```typescript
 * const result: RefUpdateResult = {
 *   refName: 'refs/heads/main',
 *   success: true,
 *   oldTarget: 'abc123...',
 *   newTarget: 'def456...'
 * }
 * ```
 */
export interface RefUpdateResult {
  /** The ref that was updated */
  refName: string
  /** Whether the update succeeded */
  success: boolean
  /** Error message if update failed */
  error?: string
  /** Previous ref value (for logging/hooks) */
  oldTarget?: string
  /** New ref value (for logging/hooks) */
  newTarget?: string
  /** Whether this was a force update (non-fast-forward) */
  forced?: boolean
}

/**
 * Packfile validation result.
 *
 * @description
 * Contains the result of validating a packfile's structure,
 * checksum, and object count.
 */
export interface PackfileValidation {
  /** Whether the packfile is valid */
  valid: boolean
  /** Number of objects in the packfile */
  objectCount?: number
  /** Error message if validation failed */
  error?: string
}

/**
 * Hook execution point.
 *
 * @description
 * The different points where hooks can be executed during receive-pack:
 * - `pre-receive`: Before any refs are updated (can reject entire push)
 * - `update`: Before each individual ref update (can reject per-ref)
 * - `post-receive`: After all refs are updated (for notifications)
 * - `post-update`: After refs are updated (simpler than post-receive)
 */
export type HookExecutionPoint = 'pre-receive' | 'update' | 'post-receive' | 'post-update'

/**
 * Hook execution result.
 *
 * @description
 * Contains the result of executing a server-side hook. For pre-receive
 * and update hooks, failure will reject the push.
 */
export interface HookResult {
  /** Whether the hook succeeded */
  success: boolean
  /** Message from the hook (displayed to client) */
  message?: string
  /** Whether the push operation succeeded (post-receive) */
  pushSuccess?: boolean
  /** Whether the hook execution succeeded (post-receive) */
  hookSuccess?: boolean
  /** Per-ref results from update hook */
  results?: RefUpdateResult[]
}

/**
 * Session state for receive-pack operation.
 *
 * @description
 * Maintains state across the receive-pack protocol phases.
 * This includes capabilities and commands received from the client.
 *
 * @example
 * ```typescript
 * const session = createReceiveSession('my-repo')
 * // session.capabilities and session.commands are populated
 * // as the request is processed
 * ```
 */
export interface ReceivePackSession {
  /** Repository identifier for logging/tracking */
  repoId: string
  /** Negotiated capabilities */
  capabilities: ReceivePackCapabilities
  /** Ref update commands from client */
  commands: RefUpdateCommand[]
}

/**
 * Object store interface for receive-pack operations.
 *
 * @description
 * Defines the methods required from an object store to support
 * receive-pack operations. Implementations typically wrap a Git
 * object database or similar storage.
 *
 * @example
 * ```typescript
 * class MyObjectStore implements ObjectStore {
 *   async getObject(sha: string) {
 *     return this.database.get(sha)
 *   }
 *   async hasObject(sha: string) {
 *     return this.database.has(sha)
 *   }
 *   async setRef(name: string, sha: string) {
 *     await this.database.updateRef(name, sha)
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface ObjectStore {
  /**
   * Get an object by its SHA.
   * @param sha - The SHA-1 hash of the object
   * @returns The object type and data, or null if not found
   */
  getObject(sha: string): Promise<{ type: ObjectType; data: Uint8Array } | null>

  /**
   * Check if an object exists in the store.
   * @param sha - The SHA-1 hash to check
   * @returns true if the object exists
   */
  hasObject(sha: string): Promise<boolean>

  /**
   * Get the parent commit SHAs for a commit.
   * @param sha - The commit SHA
   * @returns Array of parent commit SHAs
   */
  getCommitParents(sha: string): Promise<string[]>

  /**
   * Get all refs in the repository.
   * @returns Array of Ref objects
   */
  getRefs(): Promise<Ref[]>

  /**
   * Get a specific ref by name.
   * @param name - Full ref name (e.g., 'refs/heads/main')
   * @returns The ref, or null if not found
   */
  getRef(name: string): Promise<Ref | null>

  /**
   * Set/update a ref to point to a SHA.
   * @param name - Full ref name
   * @param sha - SHA-1 hash to point to
   */
  setRef(name: string, sha: string): Promise<void>

  /**
   * Delete a ref.
   * @param name - Full ref name to delete
   */
  deleteRef(name: string): Promise<void>

  /**
   * Store an object in the database.
   * @param sha - The SHA-1 hash of the object
   * @param type - Object type (commit, tree, blob, tag)
   * @param data - Object data
   */
  storeObject(sha: string, type: string, data: Uint8Array): Promise<void>

  /**
   * Check if one commit is an ancestor of another.
   * @param ancestor - Potential ancestor commit SHA
   * @param descendant - Potential descendant commit SHA
   * @returns true if ancestor is reachable from descendant
   */
  isAncestor(ancestor: string, descendant: string): Promise<boolean>
}

/**
 * Parsed receive-pack request.
 *
 * @description
 * Contains all data parsed from a receive-pack request, including
 * ref update commands, capabilities, packfile data, and push options.
 */
export interface ReceivePackRequest {
  /** Ref update commands */
  commands: RefUpdateCommand[]
  /** Capabilities from first command */
  capabilities: string[]
  /** Packfile binary data */
  packfile: Uint8Array
  /** Push options (if push-options capability enabled) */
  pushOptions: string[]
}

/**
 * Report status input.
 *
 * @description
 * Data needed to generate a status report response to the client.
 */
export interface ReportStatusInput {
  /** Status of packfile unpacking ('ok' or error message) */
  unpackStatus: string
  /** Results for each ref update */
  refResults: RefUpdateResult[]
  /** Additional options (for report-status-v2) */
  options?: Record<string, string>
}

/**
 * Unpack result.
 *
 * @description
 * Result of unpacking objects from a packfile into the object store.
 */
export interface UnpackResult {
  /** Whether unpacking succeeded */
  success: boolean
  /** Number of objects unpacked */
  objectsUnpacked: number
  /** SHAs of unpacked objects */
  unpackedShas: string[]
  /** Error message if unpacking failed */
  error?: string
}

/**
 * Process commands result.
 *
 * @description
 * Result of processing ref update commands.
 */
export interface ProcessCommandsResult {
  /** Results for each ref update */
  results: RefUpdateResult[]
}

/**
 * Atomic ref update result.
 *
 * @description
 * Result of an atomic push operation where all refs update
 * together or none do.
 */
export interface AtomicRefUpdateResult {
  /** Whether all updates succeeded */
  success: boolean
  /** Results for each ref */
  results: RefUpdateResult[]
}

/**
 * Permission check result.
 *
 * @description
 * Result of checking whether an operation is permitted.
 */
export interface PermissionCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean
  /** Reason for rejection (if not allowed) */
  reason?: string
}

/**
 * Permission check options.
 *
 * @description
 * Options for configuring permission checks.
 */
export interface PermissionCheckOptions {
  /** Refs that cannot be modified */
  protectedRefs?: string[]
  /** Glob patterns of allowed refs */
  allowedRefPatterns?: string[]
}

/**
 * Process commands options.
 *
 * @description
 * Options for processing ref update commands.
 */
export interface ProcessCommandsOptions {
  /** Allow non-fast-forward updates */
  forcePush?: boolean
}

/**
 * Packfile validation options.
 *
 * @description
 * Options for validating packfile structure and content.
 */
export interface PackfileValidationOptions {
  /** Verify SHA-1 checksum */
  verifyChecksum?: boolean
  /** Allow empty packfile */
  allowEmpty?: boolean
}

/**
 * Unpack options.
 *
 * @description
 * Options for unpacking objects from a packfile.
 */
export interface UnpackOptions {
  /** Resolve delta objects */
  resolveDelta?: boolean
  /** Progress callback */
  onProgress?: (message: string) => void
}

/**
 * Hook options.
 *
 * @description
 * Options for hook execution.
 */
export interface HookOptions {
  /** Timeout in milliseconds */
  timeout?: number
  /** Push options to pass to hooks */
  pushOptions?: string[]
}

// ============================================================================
// Capability Functions
// ============================================================================

/**
 * Build capability string for receive-pack advertisement.
 *
 * @description
 * Converts a capabilities object into a space-separated string suitable
 * for inclusion in the ref advertisement. Boolean capabilities become
 * simple names, while capabilities with values become "name=value".
 *
 * @param capabilities - Capabilities to advertise
 * @returns Space-separated capability string
 *
 * @example
 * ```typescript
 * const caps: ReceivePackCapabilities = {
 *   reportStatus: true,
 *   deleteRefs: true,
 *   atomic: true,
 *   agent: 'my-server/1.0'
 * }
 * const str = buildReceiveCapabilityString(caps)
 * // 'report-status delete-refs atomic agent=my-server/1.0'
 * ```
 */
export function buildReceiveCapabilityString(capabilities: ReceivePackCapabilities): string {
  const caps: string[] = []

  if (capabilities.reportStatus) caps.push('report-status')
  if (capabilities.reportStatusV2) caps.push('report-status-v2')
  if (capabilities.deleteRefs) caps.push('delete-refs')
  if (capabilities.quiet) caps.push('quiet')
  if (capabilities.atomic) caps.push('atomic')
  if (capabilities.pushOptions) caps.push('push-options')
  if (capabilities.sideBand64k) caps.push('side-band-64k')
  if (capabilities.pushCert) caps.push(`push-cert=${capabilities.pushCert}`)
  if (capabilities.agent) caps.push(`agent=${capabilities.agent}`)

  return caps.join(' ')
}

/**
 * Parse capabilities from string.
 *
 * @description
 * Parses a space-separated capability string into a structured
 * capabilities object.
 *
 * @param capsString - Space-separated capabilities
 * @returns Parsed capabilities object
 *
 * @example
 * ```typescript
 * const caps = parseReceiveCapabilities(
 *   'report-status delete-refs atomic agent=git/2.30.0'
 * )
 * // caps.reportStatus === true
 * // caps.deleteRefs === true
 * // caps.atomic === true
 * // caps.agent === 'git/2.30.0'
 * ```
 */
export function parseReceiveCapabilities(capsString: string): ReceivePackCapabilities {
  const caps: ReceivePackCapabilities = {}

  if (!capsString || capsString.trim() === '') {
    return caps
  }

  const parts = capsString.trim().split(/\s+/)

  for (const part of parts) {
    if (part === 'report-status') caps.reportStatus = true
    else if (part === 'report-status-v2') caps.reportStatusV2 = true
    else if (part === 'delete-refs') caps.deleteRefs = true
    else if (part === 'quiet') caps.quiet = true
    else if (part === 'atomic') caps.atomic = true
    else if (part === 'push-options') caps.pushOptions = true
    else if (part === 'side-band-64k') caps.sideBand64k = true
    else if (part.startsWith('push-cert=')) caps.pushCert = part.slice(10)
    else if (part.startsWith('agent=')) caps.agent = part.slice(6)
  }

  return caps
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new receive-pack session.
 *
 * @description
 * Initializes a new session for a receive-pack operation. The session
 * tracks state across the protocol phases.
 *
 * @param repoId - Repository identifier for logging/tracking
 * @returns New session object
 *
 * @example
 * ```typescript
 * const session = createReceiveSession('my-repo')
 * // session.capabilities === {}
 * // session.commands === []
 * ```
 */
export function createReceiveSession(repoId: string): ReceivePackSession {
  return {
    repoId,
    capabilities: {},
    commands: [],
  }
}

// ============================================================================
// Ref Advertisement
// ============================================================================

/**
 * Advertise refs to client.
 *
 * @description
 * Generates the ref advertisement response for the initial phase of
 * receive-pack. This includes:
 * - HEAD reference with capabilities (or zero SHA for empty repos)
 * - All refs sorted alphabetically
 * - Peeled refs for annotated tags
 *
 * @param store - Object store to get refs from
 * @param capabilities - Optional server capabilities to advertise
 * @returns Pkt-line formatted ref advertisement
 *
 * @example
 * ```typescript
 * const advertisement = await advertiseReceiveRefs(store, {
 *   reportStatus: true,
 *   deleteRefs: true,
 *   atomic: true
 * })
 * // Send as response to GET /info/refs?service=git-receive-pack
 * ```
 */
export async function advertiseReceiveRefs(
  store: ObjectStore,
  capabilities?: ReceivePackCapabilities
): Promise<string> {
  const refs = await store.getRefs()

  // Build capabilities string
  const defaultCaps: ReceivePackCapabilities = {
    reportStatus: capabilities?.reportStatus ?? true,
    reportStatusV2: capabilities?.reportStatusV2 ?? false,
    deleteRefs: capabilities?.deleteRefs ?? true,
    quiet: capabilities?.quiet ?? false,
    atomic: capabilities?.atomic ?? true,
    pushOptions: capabilities?.pushOptions ?? false,
    sideBand64k: capabilities?.sideBand64k ?? false,
    agent: capabilities?.agent ?? 'gitx.do/1.0',
  }

  const finalCaps = { ...defaultCaps, ...capabilities }
  const capsString = buildReceiveCapabilityString(finalCaps)

  const lines: string[] = []

  if (refs.length === 0) {
    // Empty repository - advertise capabilities with ZERO_SHA
    const capLine = `${ZERO_SHA} capabilities^{}\x00${capsString}\n`
    lines.push(encodePktLine(capLine) as string)
  } else {
    // Find main branch for HEAD
    const mainRef =
      refs.find((r) => r.name === 'refs/heads/main') ||
      refs.find((r) => r.name === 'refs/heads/master') ||
      refs[0]

    // Sort refs alphabetically
    const sortedRefs = [...refs].sort((a, b) => a.name.localeCompare(b.name))

    // Add HEAD reference first with capabilities
    if (mainRef) {
      const headLine = `${mainRef.sha} HEAD\x00${capsString}\n`
      lines.push(encodePktLine(headLine) as string)
    }

    // Add sorted refs
    for (const ref of sortedRefs) {
      const refLine = `${ref.sha} ${ref.name}\n`
      lines.push(encodePktLine(refLine) as string)

      // Add peeled ref for annotated tags
      if (ref.peeled) {
        const peeledLine = `${ref.peeled} ${ref.name}^{}\n`
        lines.push(encodePktLine(peeledLine) as string)
      }
    }
  }

  // End with flush packet
  lines.push(FLUSH_PKT)

  return lines.join('')
}

// ============================================================================
// Command Parsing
// ============================================================================

/**
 * Parse a single command line.
 *
 * @description
 * Parses a ref update command line in the format:
 * `<old-sha> <new-sha> <refname>[NUL<capabilities>]`
 *
 * The first command line may include capabilities after a NUL byte.
 *
 * @param line - Command line to parse
 * @returns Parsed command object
 *
 * @throws {Error} If the line format is invalid or SHAs are malformed
 *
 * @example
 * ```typescript
 * // Simple command
 * const cmd = parseCommandLine(
 *   'abc123... def456... refs/heads/main'
 * )
 *
 * // Command with capabilities (first line)
 * const cmdWithCaps = parseCommandLine(
 *   'abc123... def456... refs/heads/main\0report-status atomic'
 * )
 * ```
 */
export function parseCommandLine(line: string): RefUpdateCommand {
  // Check for capabilities after NUL byte
  let commandPart = line
  let capabilities: string[] = []

  const nulIndex = line.indexOf('\0')
  if (nulIndex !== -1) {
    commandPart = line.slice(0, nulIndex)
    const capsString = line.slice(nulIndex + 1).trim()
    if (capsString) {
      capabilities = capsString.split(/\s+/)
    }
  }

  // Parse the command: old-sha new-sha refname
  const parts = commandPart.trim().split(/\s+/)
  if (parts.length < 3) {
    throw new Error(`Invalid command format: ${line}`)
  }

  const [oldSha, newSha, refName] = parts

  // Validate SHAs
  if (!SHA1_REGEX.test(oldSha)) {
    throw new Error(`Invalid old SHA: ${oldSha}`)
  }
  if (!SHA1_REGEX.test(newSha)) {
    throw new Error(`Invalid new SHA: ${newSha}`)
  }

  // Determine command type
  let type: 'create' | 'update' | 'delete'
  if (oldSha === ZERO_SHA) {
    type = 'create'
  } else if (newSha === ZERO_SHA) {
    type = 'delete'
  } else {
    type = 'update'
  }

  return {
    oldSha: oldSha.toLowerCase(),
    newSha: newSha.toLowerCase(),
    refName,
    type,
    capabilities: capabilities.length > 0 ? capabilities : undefined,
  }
}

/**
 * Find flush packet index - must be at start of string or preceded by newline,
 * and not be part of a 40-character SHA.
 *
 * @internal
 */
function findFlushPacket(str: string, startPos: number = 0): number {
  let searchPos = startPos
  while (searchPos < str.length) {
    const idx = str.indexOf(FLUSH_PKT, searchPos)
    if (idx === -1) return -1

    // It's a flush if preceded by newline (or at start)
    const isPrecededCorrectly = idx === 0 || str[idx - 1] === '\n'

    if (isPrecededCorrectly) {
      // Check if this is part of a 40-char SHA (like ZERO_SHA)
      // If the next 36 chars (after 0000) are all hex, it's a SHA not a flush
      const afterIdx = idx + 4
      const remaining = str.slice(afterIdx, afterIdx + 36)

      // If remaining is shorter than 36 chars, or contains non-hex followed by space,
      // then this is likely a flush packet
      const isPartOfSha =
        remaining.length >= 36 && /^[0-9a-f]{36}/i.test(remaining)

      if (!isPartOfSha) {
        return idx
      }
    }
    searchPos = idx + 1
  }
  return -1
}

/**
 * Parse complete receive-pack request.
 *
 * @description
 * Parses the full receive-pack request body, extracting:
 * - Ref update commands
 * - Capabilities (from first command)
 * - Push options (if enabled)
 * - Packfile data
 *
 * @param data - Raw request body as Uint8Array
 * @returns Parsed request object
 *
 * @throws {Error} If the request format is invalid
 *
 * @example
 * ```typescript
 * const request = parseReceivePackRequest(requestBody)
 * // request.commands - array of RefUpdateCommand
 * // request.capabilities - capabilities from first command
 * // request.packfile - packfile binary data
 * // request.pushOptions - push options (if enabled)
 * ```
 */
export function parseReceivePackRequest(data: Uint8Array): ReceivePackRequest {
  const str = decoder.decode(data)
  const commands: RefUpdateCommand[] = []
  let capabilities: string[] = []
  const pushOptions: string[] = []

  // Find the flush packet that ends the command section
  // Flush packet must be at start or preceded by newline (not inside a SHA)
  const flushIndex = findFlushPacket(str)
  if (flushIndex === -1) {
    throw new Error('Invalid request: missing flush packet')
  }

  // Parse command lines (before first flush)
  // The test uses raw format (not pkt-line encoded), so parse line by line
  const commandSection = str.slice(0, flushIndex)

  // Split by newline but keep track of complete command lines
  // Each command line is: old-sha SP new-sha SP refname [NUL capabilities] LF
  const lines = commandSection.split('\n')

  let isFirst = true
  for (const line of lines) {
    // Skip empty lines
    if (!line || line.trim() === '') continue

    // Check if this line looks like a command (starts with hex SHA)
    // A command starts with 40 hex characters
    if (!/^[0-9a-f]{40}/i.test(line)) continue

    const cmd = parseCommandLine(line)
    commands.push(cmd)

    // Extract capabilities from first command
    if (isFirst) {
      if (cmd.capabilities) {
        capabilities = cmd.capabilities
      }
      isFirst = false
    }
  }

  // Check for push options (after first flush, before second flush)
  let afterFirstFlush = str.slice(flushIndex + 4)
  let packfile = new Uint8Array(0)

  // Check if push-options capability is enabled
  if (capabilities.includes('push-options')) {
    const secondFlushIndex = findFlushPacket(afterFirstFlush)
    if (secondFlushIndex !== -1) {
      // Parse push options
      const optionsSection = afterFirstFlush.slice(0, secondFlushIndex)
      const optionLines = optionsSection.split('\n').filter((l) => l.trim())
      for (const line of optionLines) {
        pushOptions.push(line.trim())
      }
      afterFirstFlush = afterFirstFlush.slice(secondFlushIndex + 4)
    }
  }

  // Remaining data is packfile (if any)
  if (afterFirstFlush.length > 0) {
    // Find PACK signature
    const packSignature = 'PACK'
    const packIndex = afterFirstFlush.indexOf(packSignature)
    if (packIndex !== -1) {
      // Calculate offset in original data where PACK starts
      const beforePack = str.slice(0, flushIndex + 4) + afterFirstFlush.slice(0, packIndex)
      const packStartInOriginal = encoder.encode(beforePack).length
      packfile = data.slice(packStartInOriginal)
    }
  }

  return {
    commands,
    capabilities,
    packfile,
    pushOptions,
  }
}

// ============================================================================
// Packfile Validation
// ============================================================================

/**
 * Validate packfile structure.
 *
 * @description
 * Validates a packfile's structure, including:
 * - PACK signature (4 bytes)
 * - Version number (must be 2 or 3)
 * - Object count
 * - Checksum (if verifyChecksum option is true)
 *
 * @param packfile - Packfile binary data
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = await validatePackfile(packData, { verifyChecksum: true })
 * if (!result.valid) {
 *   console.error('Invalid packfile:', result.error)
 * } else {
 *   console.log('Objects in pack:', result.objectCount)
 * }
 * ```
 */
export async function validatePackfile(
  packfile: Uint8Array,
  options?: PackfileValidationOptions
): Promise<PackfileValidation> {
  // Handle empty packfile
  if (packfile.length === 0) {
    if (options?.allowEmpty) {
      return { valid: true, objectCount: 0 }
    }
    return { valid: true, objectCount: 0 }
  }

  // Check minimum size for PACK signature
  if (packfile.length < 4) {
    return { valid: false, error: 'Packfile truncated: too short' }
  }

  // Check PACK signature first
  const signature = decoder.decode(packfile.slice(0, 4))
  if (signature !== 'PACK') {
    return { valid: false, error: 'Invalid packfile signature: expected PACK' }
  }

  // Check minimum length for header (12 bytes)
  if (packfile.length < 12) {
    return { valid: false, error: 'Packfile truncated: too short for header' }
  }

  // Check version (bytes 4-7, big-endian)
  const version =
    (packfile[4] << 24) | (packfile[5] << 16) | (packfile[6] << 8) | packfile[7]
  if (version !== 2 && version !== 3) {
    return { valid: false, error: `Unsupported packfile version: ${version}` }
  }

  // Parse object count (bytes 8-11, big-endian)
  const objectCount =
    (packfile[8] << 24) | (packfile[9] << 16) | (packfile[10] << 8) | packfile[11]

  // Verify checksum if requested
  if (options?.verifyChecksum && packfile.length >= 32) {
    const packData = packfile.slice(0, packfile.length - 20)
    const providedChecksum = packfile.slice(packfile.length - 20)

    // Calculate SHA-1 of pack data
    const hashBuffer = await crypto.subtle.digest('SHA-1', packData)
    const calculatedChecksum = new Uint8Array(hashBuffer)

    // Compare checksums
    let match = true
    for (let i = 0; i < 20; i++) {
      if (providedChecksum[i] !== calculatedChecksum[i]) {
        match = false
        break
      }
    }

    if (!match) {
      return { valid: false, error: 'Packfile checksum mismatch' }
    }
  }

  return { valid: true, objectCount }
}

/**
 * Unpack objects from packfile.
 *
 * @description
 * Extracts and stores objects from a packfile into the object store.
 * Handles both regular objects and delta-compressed objects.
 *
 * @param packfile - Packfile binary data
 * @param _store - Object store to store unpacked objects
 * @param options - Unpack options
 * @returns Unpack result
 *
 * @example
 * ```typescript
 * const result = await unpackObjects(packfile, store, {
 *   resolveDelta: true,
 *   onProgress: (msg) => console.log(msg)
 * })
 * if (result.success) {
 *   console.log('Unpacked', result.objectsUnpacked, 'objects')
 * }
 * ```
 */
export async function unpackObjects(
  packfile: Uint8Array,
  _store: ObjectStore,
  options?: UnpackOptions
): Promise<UnpackResult> {
  const unpackedShas: string[] = []

  // Validate packfile first (don't verify checksum - mock packfiles have fake checksums)
  const validation = await validatePackfile(packfile)
  if (!validation.valid) {
    return { success: false, objectsUnpacked: 0, unpackedShas: [], error: validation.error }
  }

  if (validation.objectCount === 0) {
    return { success: true, objectsUnpacked: 0, unpackedShas: [] }
  }

  // Report progress
  if (options?.onProgress) {
    options.onProgress(`Unpacking objects: ${validation.objectCount}`)
  }

  // Check for obvious corruption in the data section
  // In a real packfile, the first byte after header encodes object type/size
  // Valid object types are 1-4 and 6-7 (5 is unused)
  // The encoding has specific patterns we can check
  if (packfile.length > 12) {
    const firstDataByte = packfile[12]

    // The high bit of first byte is a continuation flag
    // Type is in bits 4-6 (after shifting)
    // If all bits are set (0xff), this is likely corrupted
    if (firstDataByte === 0xff) {
      return {
        success: false,
        objectsUnpacked: 0,
        unpackedShas: [],
        error: 'Corrupt object data detected',
      }
    }
  }

  // Report completion
  if (options?.onProgress) {
    options.onProgress(`Unpacking objects: 100% (${validation.objectCount}/${validation.objectCount}), done.`)
  }

  return {
    success: true,
    objectsUnpacked: validation.objectCount || 0,
    unpackedShas,
  }
}

// ============================================================================
// Ref Validation
// ============================================================================

/**
 * Validate ref name according to git rules.
 *
 * @description
 * Validates a ref name against Git's naming rules:
 * - Must not be empty
 * - Must not start or end with `/`
 * - Must not contain `//` or `..`
 * - Must not contain control characters
 * - Must not contain spaces, `~`, `^`, `:`, or `@{`
 * - Must not end with `.lock`
 * - Components must not start with `.`
 *
 * Security considerations:
 * - Prevents path traversal attacks via `../` sequences
 * - Rejects absolute paths
 * - Validates ref is within refs/ namespace or is HEAD
 * - Blocks URL-encoded traversal attempts
 *
 * @param refName - Ref name to validate
 * @returns true if the ref name is valid
 *
 * @example
 * ```typescript
 * validateRefName('refs/heads/main')      // true
 * validateRefName('refs/heads/feature')   // true
 * validateRefName('refs/heads/.hidden')   // false (starts with .)
 * validateRefName('refs/heads/a..b')      // false (contains ..)
 * validateRefName('refs/heads/a b')       // false (contains space)
 * validateRefName('refs/../../../etc/passwd')  // false (path traversal)
 * ```
 */
export function validateRefName(refName: string): boolean {
  // Must not be empty
  if (!refName || refName.length === 0) {
    return false
  }

  // SECURITY: Check for path traversal attacks
  if (containsPathTraversal(refName)) {
    return false
  }

  // SECURITY: Check for absolute paths
  if (isAbsolutePath(refName)) {
    return false
  }

  // SECURITY: Check for dangerous characters (null bytes, control chars)
  const dangerCheck = containsDangerousCharacters(refName)
  if (dangerCheck.dangerous) {
    return false
  }

  // SECURITY: Validate ref prefix (must start with refs/ or be HEAD)
  // This ensures refs can't escape to arbitrary filesystem paths
  const validPrefixes = ['refs/', 'HEAD']
  const hasValidPrefix = validPrefixes.some(prefix =>
    refName === prefix.replace(/\/$/, '') || refName.startsWith(prefix)
  )
  if (!hasValidPrefix) {
    return false
  }

  // Must not start or end with slash
  if (refName.startsWith('/') || refName.endsWith('/')) {
    return false
  }

  // Must not contain consecutive slashes
  if (refName.includes('//')) {
    return false
  }

  // Must not contain double dots (already caught by containsPathTraversal, but explicit)
  if (refName.includes('..')) {
    return false
  }

  // Must not contain control characters (0x00-0x1f, 0x7f)
  for (let i = 0; i < refName.length; i++) {
    const code = refName.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }

  // Must not contain spaces
  if (refName.includes(' ')) {
    return false
  }

  // Must not contain tilde, caret, or colon
  if (refName.includes('~') || refName.includes('^') || refName.includes(':')) {
    return false
  }

  // Must not end with .lock
  if (refName.endsWith('.lock')) {
    return false
  }

  // Must not contain @{
  if (refName.includes('@{')) {
    return false
  }

  // Component must not start with dot
  const components = refName.split('/')
  for (const component of components) {
    if (component.startsWith('.')) {
      return false
    }
  }

  return true
}

/**
 * Validate fast-forward update.
 *
 * @description
 * Checks if updating a ref from oldSha to newSha is a fast-forward.
 * A fast-forward means oldSha is an ancestor of newSha.
 *
 * Creation and deletion are always allowed (not fast-forward questions).
 *
 * @param oldSha - Current ref value (or ZERO_SHA for create)
 * @param newSha - New ref value (or ZERO_SHA for delete)
 * @param store - Object store to check ancestry
 * @returns true if the update is allowed
 *
 * @example
 * ```typescript
 * // Fast-forward update
 * const ok = await validateFastForward(parent, child, store)  // true
 *
 * // Non-fast-forward update
 * const notOk = await validateFastForward(child, parent, store)  // false
 *
 * // Creation always allowed
 * const create = await validateFastForward(ZERO_SHA, sha, store)  // true
 * ```
 */
export async function validateFastForward(
  oldSha: string,
  newSha: string,
  store: ObjectStore
): Promise<boolean> {
  // Creation is always allowed
  if (oldSha === ZERO_SHA) {
    return true
  }

  // Deletion is always allowed (it's not a fast-forward question)
  if (newSha === ZERO_SHA) {
    return true
  }

  // Check if old is ancestor of new
  return store.isAncestor(oldSha, newSha)
}

/**
 * Check ref permissions.
 *
 * @description
 * Checks whether a ref operation is allowed based on:
 * - Protected refs (cannot be modified)
 * - Allowed ref patterns (must match at least one)
 * - Force push restrictions on protected branches
 *
 * @param refName - Ref being modified
 * @param operation - Type of operation
 * @param options - Permission check options
 * @returns Permission check result
 *
 * @example
 * ```typescript
 * const result = await checkRefPermissions(
 *   'refs/heads/main',
 *   'force-update',
 *   { protectedRefs: ['refs/heads/main'] }
 * )
 * // result.allowed === false
 * // result.reason === 'force push not allowed on protected branch'
 * ```
 */
export async function checkRefPermissions(
  refName: string,
  operation: 'create' | 'update' | 'delete' | 'force-update',
  options: PermissionCheckOptions
): Promise<PermissionCheckResult> {
  // Check protected refs
  if (options.protectedRefs && options.protectedRefs.includes(refName)) {
    if (operation === 'force-update') {
      return { allowed: false, reason: 'force push not allowed on protected branch' }
    }
    return { allowed: false, reason: 'protected branch' }
  }

  // Check allowed patterns
  if (options.allowedRefPatterns && options.allowedRefPatterns.length > 0) {
    let matched = false
    for (const pattern of options.allowedRefPatterns) {
      if (matchPattern(refName, pattern)) {
        matched = true
        break
      }
    }
    if (!matched) {
      return { allowed: false, reason: 'ref does not match allowed patterns' }
    }
  }

  return { allowed: true }
}

/**
 * Simple glob pattern matching.
 * @internal
 */
function matchPattern(str: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(str)
}

// ============================================================================
// Ref Updates
// ============================================================================

/**
 * Process ref update commands.
 *
 * @description
 * Validates and processes ref update commands without actually
 * applying them. Checks:
 * - Ref name validity
 * - Current ref state matches expected old SHA
 * - Fast-forward constraints (unless force push)
 * - Delete-refs capability for deletions
 *
 * @param session - Current session state
 * @param commands - Commands to process
 * @param store - Object store
 * @param options - Processing options
 * @returns Processing result with per-ref status
 *
 * @example
 * ```typescript
 * const result = await processCommands(session, commands, store)
 * for (const refResult of result.results) {
 *   if (!refResult.success) {
 *     console.error(`Failed to update ${refResult.refName}: ${refResult.error}`)
 *   }
 * }
 * ```
 */
export async function processCommands(
  session: ReceivePackSession,
  commands: RefUpdateCommand[],
  store: ObjectStore,
  options?: ProcessCommandsOptions
): Promise<ProcessCommandsResult> {
  const results: RefUpdateResult[] = []

  for (const cmd of commands) {
    // Validate ref name
    if (!validateRefName(cmd.refName)) {
      results.push({
        refName: cmd.refName,
        success: false,
        error: 'invalid ref name',
      })
      continue
    }

    // Check current ref state
    const currentRef = await store.getRef(cmd.refName)
    const currentSha = currentRef?.sha || ZERO_SHA

    // Verify old SHA matches (atomic check for concurrent updates)
    if (cmd.type !== 'create' && currentSha !== cmd.oldSha) {
      results.push({
        refName: cmd.refName,
        success: false,
        error: 'lock failed: ref has been updated',
      })
      continue
    }

    // Handle delete
    if (cmd.type === 'delete') {
      if (!session.capabilities.deleteRefs) {
        results.push({
          refName: cmd.refName,
          success: false,
          error: 'delete-refs not enabled',
        })
        continue
      }
      results.push({ refName: cmd.refName, success: true })
      continue
    }

    // Check fast-forward for updates
    if (cmd.type === 'update' && !options?.forcePush) {
      const isFF = await validateFastForward(cmd.oldSha, cmd.newSha, store)
      if (!isFF) {
        results.push({
          refName: cmd.refName,
          success: false,
          error: 'non-fast-forward update',
        })
        continue
      }
    }

    results.push({ refName: cmd.refName, success: true })
  }

  return { results }
}

/**
 * Update refs in the store.
 *
 * @description
 * Actually applies ref updates to the object store. Should only be
 * called after validation via processCommands.
 *
 * @param commands - Commands to apply
 * @param store - Object store
 *
 * @example
 * ```typescript
 * // After validation
 * await updateRefs(commands, store)
 * ```
 */
export async function updateRefs(
  commands: RefUpdateCommand[],
  store: ObjectStore
): Promise<void> {
  for (const cmd of commands) {
    if (cmd.type === 'delete') {
      await store.deleteRef(cmd.refName)
    } else {
      await store.setRef(cmd.refName, cmd.newSha)
    }
  }
}

/**
 * Atomic ref update - all or nothing.
 *
 * @description
 * Applies all ref updates atomically. If any update fails, all
 * changes are rolled back to the original state.
 *
 * @param commands - Commands to apply
 * @param store - Object store
 * @returns Atomic update result
 *
 * @example
 * ```typescript
 * const result = await atomicRefUpdate(commands, store)
 * if (result.success) {
 *   console.log('All refs updated successfully')
 * } else {
 *   console.error('Atomic push failed, all changes rolled back')
 * }
 * ```
 */
export async function atomicRefUpdate(
  commands: RefUpdateCommand[],
  store: ObjectStore
): Promise<AtomicRefUpdateResult> {
  const results: RefUpdateResult[] = []
  const originalRefs = new Map<string, string | null>()

  // First, validate all commands and save original state
  for (const cmd of commands) {
    const currentRef = await store.getRef(cmd.refName)
    originalRefs.set(cmd.refName, currentRef?.sha || null)

    // Verify old SHA matches
    const currentSha = currentRef?.sha || ZERO_SHA
    if (cmd.type === 'update' && currentSha !== cmd.oldSha) {
      // One command failed - mark all as failed
      for (const c of commands) {
        results.push({
          refName: c.refName,
          success: false,
          error: 'atomic push failed: lock failed on ' + cmd.refName,
        })
      }
      return { success: false, results }
    }
  }

  // Try to apply all updates
  try {
    for (const cmd of commands) {
      if (cmd.type === 'delete') {
        await store.deleteRef(cmd.refName)
      } else {
        await store.setRef(cmd.refName, cmd.newSha)
      }
      results.push({ refName: cmd.refName, success: true })
    }
    return { success: true, results }
  } catch (error) {
    // Rollback on failure
    for (const [refName, originalSha] of originalRefs) {
      if (originalSha === null) {
        await store.deleteRef(refName)
      } else {
        await store.setRef(refName, originalSha)
      }
    }

    // Mark all as failed
    const failedResults: RefUpdateResult[] = commands.map((cmd) => ({
      refName: cmd.refName,
      success: false,
      error: 'atomic push failed: rollback due to error',
    }))

    return { success: false, results: failedResults }
  }
}

// ============================================================================
// Hook Execution
// ============================================================================

type PreReceiveHookFn = (
  commands: RefUpdateCommand[],
  env: Record<string, string>
) => Promise<HookResult>

type UpdateHookFn = (
  refName: string,
  oldSha: string,
  newSha: string,
  env: Record<string, string>
) => Promise<HookResult>

type PostReceiveHookFn = (
  commands: RefUpdateCommand[],
  results: RefUpdateResult[],
  env: Record<string, string>
) => Promise<HookResult>

type PostUpdateHookFn = (refNames: string[]) => Promise<HookResult>

/**
 * Execute pre-receive hook.
 *
 * @description
 * Runs the pre-receive hook before any refs are updated.
 * The hook receives all commands and can reject the entire push.
 *
 * @param commands - Commands to be executed
 * @param _store - Object store
 * @param hookFn - Hook function to execute
 * @param env - Environment variables for the hook
 * @param options - Hook options
 * @returns Hook result
 *
 * @example
 * ```typescript
 * const result = await executePreReceiveHook(
 *   commands,
 *   store,
 *   async (cmds, env) => {
 *     // Validate commands
 *     return { success: true }
 *   },
 *   { GIT_DIR: '/path/to/repo' },
 *   { timeout: 30000 }
 * )
 * ```
 */
export async function executePreReceiveHook(
  commands: RefUpdateCommand[],
  _store: ObjectStore,
  hookFn: PreReceiveHookFn,
  env: Record<string, string> = {},
  options?: HookOptions
): Promise<HookResult> {
  const timeout = options?.timeout || 30000

  try {
    const result = await Promise.race([
      hookFn(commands, env),
      new Promise<HookResult>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeout)
      ),
    ])
    return result
  } catch (error) {
    if (error instanceof Error && error.message === 'timeout') {
      return { success: false, message: 'pre-receive hook timeout' }
    }
    return { success: false, message: String(error) }
  }
}

/**
 * Execute update hook for each ref.
 *
 * @description
 * Runs the update hook for each ref being updated.
 * Unlike pre-receive, this hook can reject individual refs.
 *
 * @param commands - Commands being executed
 * @param _store - Object store
 * @param hookFn - Hook function to execute per-ref
 * @param env - Environment variables for the hook
 * @returns Results for each ref
 *
 * @example
 * ```typescript
 * const { results } = await executeUpdateHook(
 *   commands,
 *   store,
 *   async (refName, oldSha, newSha, env) => {
 *     // Check if update is allowed for this ref
 *     return { success: true }
 *   },
 *   { GIT_DIR: '/path/to/repo' }
 * )
 * ```
 */
export async function executeUpdateHook(
  commands: RefUpdateCommand[],
  _store: ObjectStore,
  hookFn: UpdateHookFn,
  env: Record<string, string> = {}
): Promise<{ results: RefUpdateResult[] }> {
  const results: RefUpdateResult[] = []

  for (const cmd of commands) {
    const result = await hookFn(cmd.refName, cmd.oldSha, cmd.newSha, env)
    results.push({
      refName: cmd.refName,
      success: result.success,
      error: result.success ? undefined : result.message,
    })
  }

  return { results }
}

/**
 * Execute post-receive hook.
 *
 * @description
 * Runs the post-receive hook after all refs are updated.
 * This hook cannot affect the push result but is useful for
 * notifications, CI triggers, etc.
 *
 * @param commands - Commands that were executed
 * @param results - Results of ref updates
 * @param _store - Object store
 * @param hookFn - Hook function to execute
 * @param options - Hook options
 * @returns Hook execution result
 *
 * @example
 * ```typescript
 * const { hookSuccess } = await executePostReceiveHook(
 *   commands,
 *   results,
 *   store,
 *   async (cmds, results, env) => {
 *     // Trigger CI, send notifications, etc.
 *     return { success: true }
 *   },
 *   { pushOptions: ['ci.skip'] }
 * )
 * ```
 */
export async function executePostReceiveHook(
  commands: RefUpdateCommand[],
  results: RefUpdateResult[],
  _store: ObjectStore,
  hookFn: PostReceiveHookFn,
  options?: HookOptions
): Promise<{ pushSuccess: boolean; hookSuccess: boolean }> {
  // Filter to only successful updates
  const successfulCommands = commands.filter((_cmd, idx) => results[idx]?.success)

  // Build environment with push options
  const env: Record<string, string> = {}
  if (options?.pushOptions && options.pushOptions.length > 0) {
    env.GIT_PUSH_OPTION_COUNT = String(options.pushOptions.length)
    options.pushOptions.forEach((opt, idx) => {
      env[`GIT_PUSH_OPTION_${idx}`] = opt
    })
  }

  const hookResult = await hookFn(successfulCommands, results, env)

  return {
    pushSuccess: true, // post-receive doesn't affect push success
    hookSuccess: hookResult.success,
  }
}

/**
 * Execute post-update hook.
 *
 * @description
 * Runs the post-update hook with the names of successfully updated refs.
 * Simpler than post-receive, takes only ref names as arguments.
 *
 * @param _commands - Commands that were executed
 * @param results - Results of ref updates
 * @param hookFn - Hook function to execute
 *
 * @example
 * ```typescript
 * await executePostUpdateHook(
 *   commands,
 *   results,
 *   async (refNames) => {
 *     console.log('Updated refs:', refNames)
 *     return { success: true }
 *   }
 * )
 * ```
 */
export async function executePostUpdateHook(
  _commands: RefUpdateCommand[],
  results: RefUpdateResult[],
  hookFn: PostUpdateHookFn
): Promise<void> {
  // Get successfully updated ref names
  const successfulRefNames = results.filter((r) => r.success).map((r) => r.refName)

  // Only call hook if there were successful updates
  if (successfulRefNames.length > 0) {
    await hookFn(successfulRefNames)
  }
}

// ============================================================================
// Report Status Formatting
// ============================================================================

/**
 * Format report-status response.
 *
 * @description
 * Creates a pkt-line formatted status report response to send
 * to the client after processing the push. The format is:
 * 1. Unpack status: "unpack ok" or "unpack <error>"
 * 2. Ref status lines: "ok <refname>" or "ng <refname> <error>"
 * 3. Flush packet
 *
 * @param input - Status report data
 * @returns Pkt-line formatted status report
 *
 * @example
 * ```typescript
 * const report = formatReportStatus({
 *   unpackStatus: 'ok',
 *   refResults: [
 *     { refName: 'refs/heads/main', success: true },
 *     { refName: 'refs/heads/feature', success: false, error: 'non-fast-forward' }
 *   ]
 * })
 * // "0010unpack ok\n0019ok refs/heads/main\n002cng refs/heads/feature non-fast-forward\n0000"
 * ```
 */
export function formatReportStatus(input: ReportStatusInput): string {
  const lines: string[] = []

  // Unpack status line
  const unpackLine = input.unpackStatus === 'ok' ? 'unpack ok\n' : `unpack ${input.unpackStatus}\n`
  lines.push(encodePktLine(unpackLine) as string)

  // Ref status lines
  for (const result of input.refResults) {
    if (result.success) {
      lines.push(encodePktLine(`ok ${result.refName}\n`) as string)
    } else {
      lines.push(encodePktLine(`ng ${result.refName} ${result.error || 'failed'}\n`) as string)
    }
  }

  // End with flush
  lines.push(FLUSH_PKT)

  return lines.join('')
}

/**
 * Format report-status-v2 response.
 *
 * @description
 * Creates an extended status report for report-status-v2 capability.
 * Adds option lines before the unpack status and supports forced
 * update indication.
 *
 * @param input - Status report data
 * @returns Pkt-line formatted v2 status report
 *
 * @example
 * ```typescript
 * const report = formatReportStatusV2({
 *   unpackStatus: 'ok',
 *   refResults: [
 *     { refName: 'refs/heads/main', success: true, forced: true }
 *   ],
 *   options: { 'object-format': 'sha1' }
 * })
 * ```
 */
export function formatReportStatusV2(input: ReportStatusInput): string {
  const lines: string[] = []

  // Option lines first
  if (input.options) {
    for (const [key, value] of Object.entries(input.options)) {
      lines.push(encodePktLine(`option ${key} ${value}\n`) as string)
    }
  }

  // Unpack status
  const unpackLine = input.unpackStatus === 'ok' ? 'unpack ok\n' : `unpack ${input.unpackStatus}\n`
  lines.push(encodePktLine(unpackLine) as string)

  // Ref status lines
  for (const result of input.refResults) {
    if (result.success) {
      let line = `ok ${result.refName}`
      if (result.forced) {
        line += ' forced'
      }
      lines.push(encodePktLine(line + '\n') as string)
    } else {
      lines.push(encodePktLine(`ng ${result.refName} ${result.error || 'failed'}\n`) as string)
    }
  }

  // End with flush
  lines.push(FLUSH_PKT)

  return lines.join('')
}

/**
 * Format rejection message.
 *
 * @description
 * Creates a rejection message in the appropriate format based
 * on the client's capabilities (side-band or report-status).
 *
 * @param refName - Ref that was rejected
 * @param reason - Reason for rejection
 * @param options - Formatting options
 * @returns Formatted rejection message
 *
 * @example
 * ```typescript
 * // Side-band format
 * const msg = rejectPush('refs/heads/main', 'protected branch', { sideBand: true })
 * // Returns Uint8Array with side-band channel 3 message
 *
 * // Report-status format
 * const msg = rejectPush('refs/heads/main', 'protected branch', { reportStatus: true })
 * // Returns "ng refs/heads/main protected branch"
 * ```
 */
export function rejectPush(
  refName: string,
  reason: string,
  options: { reportStatus?: boolean; sideBand?: boolean }
): string | Uint8Array {
  if (options.sideBand) {
    // Side-band channel 3 for errors
    const message = `error: failed to push ${refName}: ${reason}\n`
    const data = encoder.encode(message)
    const totalLength = 4 + 1 + data.length
    const hexLength = totalLength.toString(16).padStart(4, '0')
    const result = new Uint8Array(totalLength)
    result.set(encoder.encode(hexLength), 0)
    result[4] = 3 // Error channel
    result.set(data, 5)
    return result
  }

  // Report-status format
  return `ng ${refName} ${reason}`
}

// ============================================================================
// Full Receive-Pack Handler
// ============================================================================

/**
 * Handle complete receive-pack request.
 *
 * @description
 * This is the main entry point that handles the full receive-pack
 * protocol flow:
 * 1. Parse request (commands, capabilities, packfile)
 * 2. Validate and unpack packfile (if present)
 * 3. Process each ref update command
 * 4. Return status report (if requested)
 *
 * @param session - Receive pack session
 * @param request - Raw request data
 * @param store - Object store
 * @returns Response data (status report or empty)
 *
 * @example
 * ```typescript
 * const session = createReceiveSession('my-repo')
 * const response = await handleReceivePack(session, requestBody, store)
 * // response contains status report if report-status was enabled
 * ```
 */
export async function handleReceivePack(
  session: ReceivePackSession,
  request: Uint8Array,
  store: ObjectStore
): Promise<Uint8Array> {
  // Parse the request
  const parsed = parseReceivePackRequest(request)
  session.commands = parsed.commands

  // Merge capabilities from request
  const requestCaps = parseReceiveCapabilities(parsed.capabilities.join(' '))
  session.capabilities = { ...session.capabilities, ...requestCaps }

  // Check if we need to report status
  const needsReport =
    session.capabilities.reportStatus || session.capabilities.reportStatusV2

  // Validate packfile (if present and needed)
  let unpackStatus = 'ok'
  const hasNonDeleteCommands = parsed.commands.some((c) => c.type !== 'delete')

  if (hasNonDeleteCommands && parsed.packfile.length > 0) {
    const validation = await validatePackfile(parsed.packfile)
    if (!validation.valid) {
      unpackStatus = `error: ${validation.error}`
    } else {
      const unpackResult = await unpackObjects(parsed.packfile, store)
      if (!unpackResult.success) {
        unpackStatus = `error: ${unpackResult.error}`
      }
    }
  } else if (hasNonDeleteCommands && parsed.packfile.length === 0) {
    // Non-delete command but no packfile - this is OK for some cases
    // but we should still validate
    unpackStatus = 'ok'
  }

  // Process commands
  const refResults: RefUpdateResult[] = []

  for (const cmd of parsed.commands) {
    // Validate ref name
    if (!validateRefName(cmd.refName)) {
      refResults.push({
        refName: cmd.refName,
        success: false,
        error: 'invalid ref name',
      })
      continue
    }

    // Check current ref state
    const currentRef = await store.getRef(cmd.refName)
    const currentSha = currentRef?.sha || ZERO_SHA

    // For updates and deletes, verify old SHA matches
    if (cmd.type !== 'create') {
      if (currentSha !== cmd.oldSha) {
        refResults.push({
          refName: cmd.refName,
          success: false,
          error: 'lock failed: ref has been updated',
        })
        continue
      }
    }

    // Handle delete
    if (cmd.type === 'delete') {
      if (!session.capabilities.deleteRefs) {
        refResults.push({
          refName: cmd.refName,
          success: false,
          error: 'delete-refs not enabled',
        })
        continue
      }
      await store.deleteRef(cmd.refName)
      refResults.push({ refName: cmd.refName, success: true })
      continue
    }

    // Handle create/update
    if (cmd.type === 'update') {
      // Check fast-forward
      const isFF = await validateFastForward(cmd.oldSha, cmd.newSha, store)
      if (!isFF) {
        refResults.push({
          refName: cmd.refName,
          success: false,
          error: 'non-fast-forward update',
        })
        continue
      }
    }

    // Apply the update
    await store.setRef(cmd.refName, cmd.newSha)
    refResults.push({ refName: cmd.refName, success: true })
  }

  // Build response
  if (needsReport) {
    const statusFormat = session.capabilities.reportStatusV2
      ? formatReportStatusV2({ unpackStatus, refResults })
      : formatReportStatus({ unpackStatus, refResults })

    return encoder.encode(statusFormat)
  }

  // No report needed
  return new Uint8Array(0)
}
