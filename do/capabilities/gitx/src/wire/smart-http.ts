/**
 * @fileoverview Git Smart HTTP Protocol Implementation
 *
 * This module implements the Git Smart HTTP protocol for server-side handling of
 * Git fetch and push operations over HTTP. It provides handlers for:
 *
 * - **Ref Discovery** (`GET /info/refs?service=git-upload-pack|git-receive-pack`)
 *   Advertises available refs and server capabilities to clients.
 *
 * - **Fetch Data Transfer** (`POST /git-upload-pack`)
 *   Handles client fetch requests by processing wants/haves and returning packfiles.
 *
 * - **Push Data Transfer** (`POST /git-receive-pack`)
 *   Handles client push requests by processing ref updates and incoming packfiles.
 *
 * @module wire/smart-http
 * @see {@link https://git-scm.com/docs/http-protocol} Git HTTP Protocol Documentation
 * @see {@link https://git-scm.com/docs/protocol-common} Git Protocol Common
 *
 * @example Basic server integration
 * ```typescript
 * import { handleInfoRefs, handleUploadPack, handleReceivePack } from './wire/smart-http'
 *
 * // Handle GET /repo.git/info/refs?service=git-upload-pack
 * app.get('/:repo/info/refs', async (req, res) => {
 *   const request: SmartHTTPRequest = {
 *     method: 'GET',
 *     path: '/info/refs',
 *     query: { service: req.query.service },
 *     headers: req.headers,
 *     repository: req.params.repo
 *   }
 *   const response = await handleInfoRefs(request, repositoryProvider, capabilities)
 *   res.status(response.status).set(response.headers).send(response.body)
 * })
 * ```
 */

import { encodePktLine, pktLineStream, FLUSH_PKT } from './pkt-line'

/**
 * Supported Git Smart HTTP services.
 *
 * @description
 * Git Smart HTTP supports two services:
 * - `git-upload-pack`: Used by git-fetch to download objects
 * - `git-receive-pack`: Used by git-push to upload objects
 */
export type GitService = 'git-upload-pack' | 'git-receive-pack'

/**
 * HTTP methods supported by the Smart HTTP protocol.
 *
 * @description
 * - `GET`: Used for ref discovery (/info/refs)
 * - `POST`: Used for data transfer (upload-pack and receive-pack)
 */
export type HTTPMethod = 'GET' | 'POST'

/**
 * Represents a Git reference (branch, tag, etc.).
 *
 * @description
 * A Git reference is a named pointer to a specific commit or object.
 * Common ref types include:
 * - Branches: `refs/heads/main`, `refs/heads/feature`
 * - Tags: `refs/tags/v1.0.0`
 * - Remote tracking: `refs/remotes/origin/main`
 *
 * @example
 * ```typescript
 * const mainBranch: GitRef = {
 *   sha: 'abc123def456...',
 *   name: 'refs/heads/main'
 * }
 *
 * const annotatedTag: GitRef = {
 *   sha: 'tag-object-sha...',
 *   name: 'refs/tags/v1.0.0',
 *   peeled: 'target-commit-sha...'
 * }
 * ```
 */
export interface GitRef {
  /** SHA-1 hash of the object this ref points to (40 hex characters) */
  sha: string
  /** Full ref name (e.g., 'refs/heads/main', 'refs/tags/v1.0.0') */
  name: string
  /** Optional peeled SHA for annotated tags - the SHA of the target object */
  peeled?: string
}

/**
 * Server capabilities advertised during ref discovery.
 *
 * @description
 * Capabilities determine what features the server supports. Clients select
 * which capabilities to use during the initial handshake. Common capability
 * categories include:
 *
 * - **Negotiation**: `multi_ack`, `multi_ack_detailed` - for efficient fetch negotiation
 * - **Transfer**: `thin-pack`, `ofs-delta` - for efficient packfile transfer
 * - **Communication**: `side-band`, `side-band-64k` - for multiplexed output
 * - **Features**: `shallow`, `filter`, `atomic` - for advanced operations
 *
 * @example
 * ```typescript
 * const capabilities: ServerCapabilities = {
 *   multiAckDetailed: true,
 *   sideBand64k: true,
 *   thinPack: true,
 *   ofsDelta: true,
 *   shallow: true,
 *   reportStatus: true,
 *   deleteRefs: true,
 *   agent: 'my-git-server/1.0'
 * }
 * ```
 *
 * @see {@link https://git-scm.com/docs/protocol-capabilities} Git Protocol Capabilities
 */
export interface ServerCapabilities {
  /** Server supports multi_ack for negotiation optimization */
  multiAck?: boolean
  /** Server supports multi_ack_detailed for finer-grained negotiation */
  multiAckDetailed?: boolean
  /** Server supports thin-pack (deltas against objects not in pack) */
  thinPack?: boolean
  /** Server supports side-band communication (multiplexed output) */
  sideBand?: boolean
  /** Server supports side-band-64k communication (larger packets) */
  sideBand64k?: boolean
  /** Server supports ofs-delta (offset-based delta encoding) */
  ofsDelta?: boolean
  /** Server supports shallow clones (limited history) */
  shallow?: boolean
  /** Server supports deepen-since (shallow by date) */
  deepenSince?: boolean
  /** Server supports deepen-not (exclude refs from shallow) */
  deepenNot?: boolean
  /** Server supports deepen-relative (deepen from current shallow) */
  deepenRelative?: boolean
  /** Server supports no-progress (suppress progress output) */
  noProgress?: boolean
  /** Server supports include-tag (auto-send annotated tags) */
  includeTag?: boolean
  /** Server supports report-status (push status report) */
  reportStatus?: boolean
  /** Server supports report-status-v2 (enhanced push status) */
  reportStatusV2?: boolean
  /** Server supports delete-refs (ref deletion via push) */
  deleteRefs?: boolean
  /** Server supports quiet mode (suppress output) */
  quiet?: boolean
  /** Server supports atomic pushes (all-or-nothing ref updates) */
  atomic?: boolean
  /** Server supports push-options (custom push metadata) */
  pushOptions?: boolean
  /** Server allows fetching tip SHA-1 not in refs */
  allowTipSha1InWant?: boolean
  /** Server allows fetching reachable SHA-1 not in refs */
  allowReachableSha1InWant?: boolean
  /** Server's agent identification string */
  agent?: string
  /** Server supports object-format (sha1/sha256 hash algorithm) */
  objectFormat?: string
  /** Server supports filter capability (partial clone) */
  filter?: boolean
}

/**
 * Incoming Smart HTTP request structure.
 *
 * @description
 * Encapsulates all information from an incoming HTTP request that is
 * relevant for Git Smart HTTP processing. This abstraction allows the
 * protocol handlers to be framework-agnostic.
 *
 * @example
 * ```typescript
 * // Converting from Express request
 * const smartRequest: SmartHTTPRequest = {
 *   method: req.method as HTTPMethod,
 *   path: req.path,
 *   query: req.query as Record<string, string>,
 *   headers: req.headers as Record<string, string>,
 *   body: req.body, // Buffer/Uint8Array
 *   repository: req.params.repo
 * }
 * ```
 */
export interface SmartHTTPRequest {
  /** HTTP method (GET or POST) */
  method: HTTPMethod
  /** Request path (e.g., '/info/refs' or '/git-upload-pack') */
  path: string
  /** Query parameters as key-value pairs */
  query: Record<string, string>
  /** HTTP headers as key-value pairs (lowercase keys recommended) */
  headers: Record<string, string>
  /** Request body as Uint8Array (for POST requests) */
  body?: Uint8Array
  /** Repository identifier/name extracted from the URL */
  repository: string
}

/**
 * Outgoing Smart HTTP response structure.
 *
 * @description
 * Contains all information needed to send an HTTP response back to the
 * Git client. The body is always a Uint8Array to handle both text and
 * binary packfile data.
 *
 * @example
 * ```typescript
 * // Converting to Express response
 * const response = await handleInfoRefs(request, repo, caps)
 * res.status(response.status)
 *    .set(response.headers)
 *    .send(Buffer.from(response.body))
 * ```
 */
export interface SmartHTTPResponse {
  /** HTTP status code (e.g., 200, 400, 403, 404) */
  status: number
  /** HTTP status text (e.g., 'OK', 'Bad Request', 'Not Found') */
  statusText: string
  /** Response headers to send */
  headers: Record<string, string>
  /** Response body as Uint8Array */
  body: Uint8Array
}

/**
 * Error response with specific HTTP status codes.
 *
 * @description
 * Extends the standard Error class with an HTTP status code for
 * proper error handling in HTTP responses.
 */
export interface SmartHTTPError extends Error {
  /** HTTP status code for the error (e.g., 400, 403, 404, 500) */
  statusCode: number
}

/**
 * Repository interface for Smart HTTP operations.
 *
 * @description
 * This interface defines the contract that a repository implementation must
 * fulfill to support Smart HTTP operations. Implementations typically wrap
 * a Git repository or object store.
 *
 * @example
 * ```typescript
 * class MyRepositoryProvider implements RepositoryProvider {
 *   async getRefs(): Promise<GitRef[]> {
 *     return this.store.listRefs()
 *   }
 *
 *   async exists(): Promise<boolean> {
 *     return this.store.repositoryExists()
 *   }
 *
 *   async hasPermission(service: GitService): Promise<boolean> {
 *     if (service === 'git-receive-pack') {
 *       return this.user.canPush()
 *     }
 *     return this.user.canRead()
 *   }
 *
 *   async uploadPack(wants, haves, caps): Promise<Uint8Array> {
 *     return this.packGenerator.generatePack(wants, haves)
 *   }
 *
 *   async receivePack(packData, commands): Promise<ReceivePackResult> {
 *     return this.refUpdater.processUpdates(packData, commands)
 *   }
 * }
 * ```
 */
export interface RepositoryProvider {
  /**
   * Get all refs in the repository.
   * @returns Promise resolving to array of GitRef objects
   */
  getRefs(): Promise<GitRef[]>

  /**
   * Check if the repository exists.
   * @returns Promise resolving to true if repository exists
   */
  exists(): Promise<boolean>

  /**
   * Check if the client has permission for the specified service.
   * @param service - The Git service being requested
   * @returns Promise resolving to true if permission is granted
   */
  hasPermission(service: GitService): Promise<boolean>

  /**
   * Handle upload-pack (fetch) - generates and returns packfile data.
   * @param wants - SHA-1 hashes of objects the client wants
   * @param haves - SHA-1 hashes of objects the client already has
   * @param capabilities - Client-requested capabilities
   * @returns Promise resolving to packfile data as Uint8Array
   */
  uploadPack(wants: string[], haves: string[], capabilities: string[]): Promise<Uint8Array>

  /**
   * Handle receive-pack (push) - processes incoming packfile and ref updates.
   * @param packData - Incoming packfile data
   * @param commands - Ref update commands from the client
   * @returns Promise resolving to the result of the push operation
   */
  receivePack(packData: Uint8Array, commands: RefUpdateCommand[]): Promise<ReceivePackResult>
}

/**
 * Command to update a reference during push.
 *
 * @description
 * Each command describes a single ref update operation:
 * - **Create**: oldSha is ZERO_SHA, newSha is the new commit
 * - **Update**: oldSha is current ref value, newSha is new value
 * - **Delete**: oldSha is current ref value, newSha is ZERO_SHA
 *
 * The oldSha is used for optimistic locking - the server verifies the ref
 * hasn't changed before applying the update.
 *
 * @example
 * ```typescript
 * // Create a new branch
 * const createBranch: RefUpdateCommand = {
 *   oldSha: ZERO_SHA,
 *   newSha: 'abc123...',
 *   refName: 'refs/heads/feature'
 * }
 *
 * // Update existing branch
 * const updateBranch: RefUpdateCommand = {
 *   oldSha: 'abc123...',
 *   newSha: 'def456...',
 *   refName: 'refs/heads/main'
 * }
 *
 * // Delete a branch
 * const deleteBranch: RefUpdateCommand = {
 *   oldSha: 'abc123...',
 *   newSha: ZERO_SHA,
 *   refName: 'refs/heads/old-feature'
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
}

/**
 * Result of receive-pack operation.
 *
 * @description
 * Contains the overall success status and individual results for each
 * ref update that was requested. Used to generate the status report
 * sent back to the client.
 *
 * @example
 * ```typescript
 * const result: ReceivePackResult = {
 *   success: true,
 *   refResults: [
 *     { refName: 'refs/heads/main', success: true },
 *     { refName: 'refs/heads/feature', success: false, error: 'non-fast-forward' }
 *   ]
 * }
 * ```
 */
export interface ReceivePackResult {
  /** Whether the overall operation succeeded (all refs updated successfully) */
  success: boolean
  /** Individual ref update results */
  refResults: Array<{
    /** The ref that was being updated */
    refName: string
    /** Whether this specific ref update succeeded */
    success: boolean
    /** Error message if the update failed */
    error?: string
  }>
}

/**
 * Content-Type for git-upload-pack advertisement response.
 * @see {@link https://git-scm.com/docs/http-protocol#_smart_server_response}
 */
export const CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT =
  'application/x-git-upload-pack-advertisement'

/**
 * Content-Type for git-receive-pack advertisement response.
 * @see {@link https://git-scm.com/docs/http-protocol#_smart_server_response}
 */
export const CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT =
  'application/x-git-receive-pack-advertisement'

/**
 * Content-Type for git-upload-pack request body.
 */
export const CONTENT_TYPE_UPLOAD_PACK_REQUEST =
  'application/x-git-upload-pack-request'

/**
 * Content-Type for git-upload-pack response body.
 */
export const CONTENT_TYPE_UPLOAD_PACK_RESULT =
  'application/x-git-upload-pack-result'

/**
 * Content-Type for git-receive-pack request body.
 */
export const CONTENT_TYPE_RECEIVE_PACK_REQUEST =
  'application/x-git-receive-pack-request'

/**
 * Content-Type for git-receive-pack response body.
 */
export const CONTENT_TYPE_RECEIVE_PACK_RESULT =
  'application/x-git-receive-pack-result'

/**
 * Zero SHA constant used for ref creation/deletion.
 *
 * @description
 * This 40-character string of zeros is used as a placeholder SHA:
 * - In oldSha: indicates a ref is being created (doesn't exist yet)
 * - In newSha: indicates a ref is being deleted
 *
 * @example
 * ```typescript
 * // Check if this is a create operation
 * const isCreate = command.oldSha === ZERO_SHA
 *
 * // Check if this is a delete operation
 * const isDelete = command.newSha === ZERO_SHA
 * ```
 */
export const ZERO_SHA = '0000000000000000000000000000000000000000'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Get HTTP status text from status code.
 *
 * @param statusCode - HTTP status code
 * @returns Human-readable status text
 *
 * @internal
 */
function getStatusText(statusCode: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    415: 'Unsupported Media Type',
    500: 'Internal Server Error',
  }
  return statusTexts[statusCode] || 'Unknown'
}

/**
 * Check if a string is a valid SHA-1 hex string (40 characters).
 *
 * @param sha - String to validate
 * @returns true if the string is a valid SHA-1 hash
 *
 * @internal
 */
function isValidSha(sha: string): boolean {
  return /^[0-9a-f]{40}$/i.test(sha)
}

/**
 * Handle GET /info/refs requests for ref discovery.
 *
 * @description
 * This is the first endpoint called by git clients when initiating a fetch
 * or push operation. It returns:
 * 1. The service being requested
 * 2. A list of all refs with their current SHA values
 * 3. Server capabilities on the first ref line
 *
 * The response format is pkt-line encoded for compatibility with Git's
 * smart HTTP protocol.
 *
 * @param request - The incoming HTTP request
 * @param repository - Repository provider for fetching refs
 * @param capabilities - Optional server capabilities to advertise
 * @returns Promise resolving to HTTP response with ref advertisement
 *
 * @throws {SmartHTTPError} 400 if service parameter is missing or invalid
 * @throws {SmartHTTPError} 403 if permission is denied
 * @throws {SmartHTTPError} 404 if repository does not exist
 *
 * @example
 * ```typescript
 * // Handle ref discovery request
 * const request: SmartHTTPRequest = {
 *   method: 'GET',
 *   path: '/info/refs',
 *   query: { service: 'git-upload-pack' },
 *   headers: {},
 *   repository: 'my-repo'
 * }
 *
 * const capabilities: ServerCapabilities = {
 *   sideBand64k: true,
 *   thinPack: true
 * }
 *
 * const response = await handleInfoRefs(request, repoProvider, capabilities)
 * // response.status === 200
 * // response.headers['Content-Type'] === 'application/x-git-upload-pack-advertisement'
 * ```
 */
export async function handleInfoRefs(
  request: SmartHTTPRequest,
  repository: RepositoryProvider,
  capabilities?: ServerCapabilities
): Promise<SmartHTTPResponse> {
  // Check service parameter
  const service = request.query.service
  if (!service) {
    return createErrorResponse(400, 'Missing service parameter')
  }

  if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
    return createErrorResponse(400, 'Invalid service parameter')
  }

  // Check if repository exists
  const exists = await repository.exists()
  if (!exists) {
    return createErrorResponse(404, 'Repository not found')
  }

  // Check permission
  const hasPermission = await repository.hasPermission(service as GitService)
  if (!hasPermission) {
    return createErrorResponse(403, 'Permission denied')
  }

  // Get refs
  const refs = await repository.getRefs()

  // Format response
  const body = formatRefAdvertisement(service as GitService, refs, capabilities)

  // Get content type
  const contentType = service === 'git-upload-pack'
    ? CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT
    : CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT

  return {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    body,
  }
}

/**
 * Handle POST /git-upload-pack requests for fetch data transfer.
 *
 * @description
 * This endpoint processes fetch requests from git clients. It:
 * 1. Parses the client's wants (objects they need) and haves (objects they have)
 * 2. Negotiates which objects need to be sent
 * 3. Generates and returns a packfile containing the required objects
 *
 * The response includes ACK/NAK lines followed by the packfile data,
 * optionally wrapped in side-band format for progress reporting.
 *
 * @param request - The incoming HTTP request with wants/haves
 * @param repository - Repository provider for creating packfile
 * @returns Promise resolving to HTTP response with packfile data
 *
 * @throws {SmartHTTPError} 400 if request body is missing or malformed
 * @throws {SmartHTTPError} 403 if permission is denied
 * @throws {SmartHTTPError} 415 if content type is invalid
 *
 * @example
 * ```typescript
 * // Handle fetch request
 * const request: SmartHTTPRequest = {
 *   method: 'POST',
 *   path: '/git-upload-pack',
 *   query: {},
 *   headers: { 'Content-Type': 'application/x-git-upload-pack-request' },
 *   body: requestBody, // pkt-line encoded wants/haves
 *   repository: 'my-repo'
 * }
 *
 * const response = await handleUploadPack(request, repoProvider)
 * // response.body contains NAK + packfile data
 * ```
 */
export async function handleUploadPack(
  request: SmartHTTPRequest,
  repository: RepositoryProvider
): Promise<SmartHTTPResponse> {
  // Check content type
  const contentType = request.headers['Content-Type']
  if (!validateContentType(contentType, CONTENT_TYPE_UPLOAD_PACK_REQUEST)) {
    return createErrorResponse(415, 'Invalid content type')
  }

  // Check body
  if (!request.body) {
    return createErrorResponse(400, 'Missing request body')
  }

  // Check permission
  const hasPermission = await repository.hasPermission('git-upload-pack')
  if (!hasPermission) {
    return createErrorResponse(403, 'Permission denied')
  }

  // Parse request
  let parsed: { wants: string[]; haves: string[]; capabilities: string[]; done: boolean }
  try {
    parsed = parseUploadPackRequest(request.body)
  } catch (e) {
    return createErrorResponse(400, 'Malformed request')
  }

  // Validate SHA format
  for (const want of parsed.wants) {
    if (!isValidSha(want)) {
      return createErrorResponse(400, 'Invalid SHA format in want')
    }
  }
  for (const have of parsed.haves) {
    if (!isValidSha(have)) {
      return createErrorResponse(400, 'Invalid SHA format in have')
    }
  }

  // Check for side-band capability
  const useSideBand = parsed.capabilities.includes('side-band-64k') || parsed.capabilities.includes('side-band')

  // Get packfile from repository
  const packData = await repository.uploadPack(parsed.wants, parsed.haves, parsed.capabilities)

  // Format response (with ACK if there are haves, NAK otherwise)
  const hasCommonObjects = parsed.haves.length > 0
  const body = formatUploadPackResponse(packData, useSideBand, hasCommonObjects, parsed.haves)

  return {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': CONTENT_TYPE_UPLOAD_PACK_RESULT,
    },
    body,
  }
}

/**
 * Handle POST /git-receive-pack requests for push data transfer.
 *
 * @description
 * This endpoint processes push requests from git clients. It:
 * 1. Parses ref update commands (create, update, delete)
 * 2. Extracts and validates the incoming packfile
 * 3. Applies ref updates (if packfile is valid)
 * 4. Returns a status report (if report-status capability was requested)
 *
 * The response includes unpack status and individual ref update results.
 *
 * @param request - The incoming HTTP request with commands and packfile
 * @param repository - Repository provider for processing push
 * @returns Promise resolving to HTTP response with status report
 *
 * @throws {SmartHTTPError} 400 if request body is missing or malformed
 * @throws {SmartHTTPError} 403 if permission is denied
 * @throws {SmartHTTPError} 415 if content type is invalid
 *
 * @example
 * ```typescript
 * // Handle push request
 * const request: SmartHTTPRequest = {
 *   method: 'POST',
 *   path: '/git-receive-pack',
 *   query: {},
 *   headers: { 'Content-Type': 'application/x-git-receive-pack-request' },
 *   body: requestBody, // commands + packfile
 *   repository: 'my-repo'
 * }
 *
 * const response = await handleReceivePack(request, repoProvider)
 * // response.body contains "unpack ok" + ref status lines
 * ```
 */
export async function handleReceivePack(
  request: SmartHTTPRequest,
  repository: RepositoryProvider
): Promise<SmartHTTPResponse> {
  // Check content type
  const contentType = request.headers['Content-Type']
  if (!validateContentType(contentType, CONTENT_TYPE_RECEIVE_PACK_REQUEST)) {
    return createErrorResponse(415, 'Invalid content type')
  }

  // Check body
  if (!request.body) {
    return createErrorResponse(400, 'Missing request body')
  }

  // Check permission
  const hasPermission = await repository.hasPermission('git-receive-pack')
  if (!hasPermission) {
    return createErrorResponse(403, 'Permission denied')
  }

  // Parse request
  let parsed: { commands: RefUpdateCommand[]; capabilities: string[]; packfile: Uint8Array }
  try {
    parsed = parseReceivePackRequest(request.body)
  } catch (e) {
    return createErrorResponse(400, 'Malformed request')
  }

  // Validate SHA format in commands
  for (const cmd of parsed.commands) {
    if (!isValidSha(cmd.oldSha) || !isValidSha(cmd.newSha)) {
      return createErrorResponse(400, 'Invalid SHA format in command')
    }
  }

  // Process the push
  const result = await repository.receivePack(parsed.packfile, parsed.commands)

  // Format response
  const body = formatReceivePackResponse(result)

  return {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': CONTENT_TYPE_RECEIVE_PACK_RESULT,
    },
    body,
  }
}

/**
 * Format ref advertisement for info/refs response.
 *
 * @description
 * Creates a pkt-line formatted ref advertisement that includes:
 * 1. Service announcement line (e.g., "# service=git-upload-pack")
 * 2. Flush packet
 * 3. First ref with capabilities (or zero SHA for empty repos)
 * 4. Remaining refs
 * 5. Peeled refs for annotated tags
 * 6. Final flush packet
 *
 * @param service - The git service (git-upload-pack or git-receive-pack)
 * @param refs - Array of refs to advertise
 * @param capabilities - Optional server capabilities to include
 * @returns Formatted ref advertisement as Uint8Array
 *
 * @example
 * ```typescript
 * const refs: GitRef[] = [
 *   { sha: 'abc123...', name: 'refs/heads/main' },
 *   { sha: 'def456...', name: 'refs/heads/feature' }
 * ]
 *
 * const advertisement = formatRefAdvertisement(
 *   'git-upload-pack',
 *   refs,
 *   { sideBand64k: true, thinPack: true }
 * )
 * ```
 */
export function formatRefAdvertisement(
  service: GitService,
  refs: GitRef[],
  capabilities?: ServerCapabilities
): Uint8Array {
  let output = ''

  // Service announcement
  output += encodePktLine(`# service=${service}\n`) as string
  output += FLUSH_PKT

  // Capabilities string
  const capStrings = capabilities ? capabilitiesToStrings(capabilities) : []
  const capLine = capStrings.length > 0 ? capStrings.join(' ') : ''

  if (refs.length === 0) {
    // Empty repo - send capabilities with zero SHA
    if (capLine) {
      output += encodePktLine(`${ZERO_SHA} capabilities^{}\x00${capLine}\n`) as string
    } else {
      output += encodePktLine(`${ZERO_SHA} capabilities^{}\n`) as string
    }
  } else {
    // First ref includes capabilities
    const firstRef = refs[0]
    if (capLine) {
      output += encodePktLine(`${firstRef.sha} ${firstRef.name}\x00${capLine}\n`) as string
    } else {
      output += encodePktLine(`${firstRef.sha} ${firstRef.name}\n`) as string
    }

    // Remaining refs
    for (let i = 1; i < refs.length; i++) {
      const ref = refs[i]
      output += encodePktLine(`${ref.sha} ${ref.name}\n`) as string
    }

    // Add peeled refs for annotated tags
    for (const ref of refs) {
      if (ref.peeled) {
        output += encodePktLine(`${ref.peeled} ${ref.name}^{}\n`) as string
      }
    }
  }

  output += FLUSH_PKT

  return encoder.encode(output)
}

/**
 * Parse upload-pack request body.
 *
 * @description
 * Extracts wants, haves, and capabilities from the pkt-line formatted
 * request body sent by git fetch. The format is:
 * 1. Want lines: "want <sha> [capabilities]" (caps only on first)
 * 2. Shallow/filter commands (optional)
 * 3. Flush packet
 * 4. Have lines: "have <sha>"
 * 5. "done" line (or flush for multi_ack)
 *
 * @param body - Request body as Uint8Array
 * @returns Parsed wants, haves, capabilities, and done flag
 *
 * @throws {Error} If the request is malformed (invalid pkt-line format)
 *
 * @example
 * ```typescript
 * const body = encoder.encode(
 *   '0032want abc123... side-band-64k\n' +
 *   '0000' +
 *   '0032have def456...\n' +
 *   '0009done\n'
 * )
 *
 * const { wants, haves, capabilities, done } = parseUploadPackRequest(body)
 * // wants = ['abc123...']
 * // haves = ['def456...']
 * // capabilities = ['side-band-64k']
 * // done = true
 * ```
 */
export function parseUploadPackRequest(body: Uint8Array): {
  wants: string[]
  haves: string[]
  capabilities: string[]
  done: boolean
} {
  const text = decoder.decode(body)

  // Check if the input starts with a valid pkt-line format
  // Valid pkt-lines start with 4 hex characters (length) or special packets (0000, 0001)
  if (text.length >= 4) {
    const hexPrefix = text.slice(0, 4)
    const length = parseInt(hexPrefix, 16)
    // If the first 4 chars are not valid hex (NaN) and not a special packet, it's malformed
    if (isNaN(length) && hexPrefix !== '0000' && hexPrefix !== '0001') {
      throw new Error('Malformed pkt-line: invalid length prefix')
    }
  }

  const { packets } = pktLineStream(text)

  const wants: string[] = []
  const haves: string[] = []
  let capabilities: string[] = []
  let done = false
  let firstWant = true

  for (const packet of packets) {
    if (packet.type === 'flush' || packet.type === 'delim') {
      continue
    }
    if (!packet.data) continue

    const line = packet.data.trim()

    if (line === 'done') {
      done = true
      continue
    }

    if (line.startsWith('want ')) {
      const rest = line.slice(5)
      // First want line may contain capabilities after SHA
      const parts = rest.split(' ')
      const sha = parts[0]
      wants.push(sha)

      if (firstWant && parts.length > 1) {
        capabilities = parts.slice(1)
        firstWant = false
      }
    } else if (line.startsWith('have ')) {
      const sha = line.slice(5).trim()
      haves.push(sha)
    } else if (line.startsWith('deepen ') || line.startsWith('deepen-since ') || line.startsWith('filter ')) {
      // Handle shallow/filter commands - just skip them for now
      continue
    }
  }

  return { wants, haves, capabilities, done }
}

/**
 * Parse receive-pack request body.
 *
 * @description
 * Extracts ref update commands, capabilities, and packfile data from
 * the request body sent by git push. The format is:
 * 1. Command lines: "<old-sha> <new-sha> <refname>" (caps on first via NUL)
 * 2. Flush packet
 * 3. Push options (optional, if push-options capability)
 * 4. Flush packet (if push options present)
 * 5. PACK data (packfile)
 *
 * @param body - Request body as Uint8Array
 * @returns Parsed commands, capabilities, and packfile
 *
 * @throws {Error} If the request is malformed
 *
 * @example
 * ```typescript
 * const body = encoder.encode(
 *   '0077' + ZERO_SHA + ' abc123... refs/heads/new\0report-status\n' +
 *   '0000' +
 *   'PACK...' // packfile data
 * )
 *
 * const { commands, capabilities, packfile } = parseReceivePackRequest(body)
 * // commands = [{ oldSha: ZERO_SHA, newSha: 'abc123...', refName: 'refs/heads/new' }]
 * // capabilities = ['report-status']
 * ```
 */
export function parseReceivePackRequest(body: Uint8Array): {
  commands: RefUpdateCommand[]
  capabilities: string[]
  packfile: Uint8Array
} {
  const text = decoder.decode(body)

  const commands: RefUpdateCommand[] = []
  let capabilities: string[] = []
  let firstCommand = true

  // Parse pkt-lines manually to track byte offset for packfile extraction
  let offset = 0
  let flushOffset = -1

  while (offset < text.length) {
    // Need at least 4 bytes for length prefix
    if (offset + 4 > text.length) {
      throw new Error('Malformed pkt-line: incomplete length prefix')
    }

    const hexLength = text.slice(offset, offset + 4)

    // Check for flush packet
    if (hexLength === FLUSH_PKT) {
      flushOffset = offset + 4
      break
    }

    // Validate hex length
    const length = parseInt(hexLength, 16)
    if (isNaN(length) || length < 4) {
      throw new Error('Malformed pkt-line: invalid length')
    }

    // Check if we have enough data
    if (offset + length > text.length) {
      throw new Error('Malformed pkt-line: incomplete packet')
    }

    // Extract packet data
    let line = text.slice(offset + 4, offset + length)
    offset += length

    // Remove trailing newline
    if (line.endsWith('\n')) {
      line = line.slice(0, -1)
    }

    // First command may have capabilities after NUL byte
    let cmdLine = line
    if (firstCommand && line.includes('\x00')) {
      const nullIndex = line.indexOf('\x00')
      cmdLine = line.slice(0, nullIndex)
      const capPart = line.slice(nullIndex + 1)
      capabilities = capPart.split(' ').filter(c => c.length > 0)
      firstCommand = false
    }

    // Parse command: oldSha newSha refName
    const parts = cmdLine.split(' ')
    if (parts.length >= 3) {
      commands.push({
        oldSha: parts[0],
        newSha: parts[1],
        refName: parts.slice(2).join(' '),
      })
    }
  }

  // Extract packfile data after flush packet
  let packfile = new Uint8Array(0)
  if (flushOffset !== -1 && flushOffset < body.length) {
    packfile = body.slice(flushOffset)
  }

  return { commands, capabilities, packfile }
}

/**
 * Format upload-pack response.
 *
 * @description
 * Creates the response body for git-upload-pack POST request,
 * including NAK/ACK responses and packfile data with optional sideband.
 * The response format is:
 * 1. NAK or ACK lines (based on negotiation)
 * 2. Packfile data (optionally wrapped in side-band)
 * 3. Flush packet
 *
 * @param packData - The packfile data to send
 * @param useSideBand - Whether to use side-band encoding (channel 1 for data)
 * @param hasCommonObjects - Whether there are common objects (for ACK vs NAK)
 * @param haves - The have SHAs from the client (first one is ACKed if common)
 * @returns Formatted response as Uint8Array
 *
 * @example
 * ```typescript
 * // Simple NAK response with packfile
 * const response = formatUploadPackResponse(packData, false, false, [])
 *
 * // Side-band response with ACK
 * const response = formatUploadPackResponse(
 *   packData,
 *   true,
 *   true,
 *   ['abc123...']
 * )
 * ```
 */
export function formatUploadPackResponse(
  packData: Uint8Array,
  useSideBand?: boolean,
  hasCommonObjects?: boolean,
  haves?: string[]
): Uint8Array {
  let output = ''

  // Send ACK or NAK
  if (hasCommonObjects && haves && haves.length > 0) {
    // ACK the first have
    output += encodePktLine(`ACK ${haves[0]}\n`) as string
  } else {
    output += encodePktLine('NAK\n') as string
  }

  if (useSideBand) {
    // Side-band format: data on channel 1, progress on channel 2, error on channel 3
    // Each sideband packet: length (4 hex) + channel byte + data
    const channel1 = new Uint8Array(1 + packData.length)
    channel1[0] = 1 // Channel 1 for pack data
    channel1.set(packData, 1)

    // Encode as pkt-line
    const pktLine = encodePktLine(channel1)
    if (typeof pktLine === 'string') {
      output += pktLine
    } else {
      // Binary data - need to handle differently
      const headerBytes = encoder.encode(output)
      const result = new Uint8Array(headerBytes.length + pktLine.length + 4)
      result.set(headerBytes, 0)
      result.set(pktLine, headerBytes.length)
      result.set(encoder.encode(FLUSH_PKT), headerBytes.length + pktLine.length)
      return result
    }
  } else {
    // No side-band - include pack data directly
    // Pack data is binary, so encode it as pkt-line
    const pktLine = encodePktLine(packData)
    if (typeof pktLine === 'string') {
      output += pktLine
    } else {
      const headerBytes = encoder.encode(output)
      const result = new Uint8Array(headerBytes.length + pktLine.length + 4)
      result.set(headerBytes, 0)
      result.set(pktLine, headerBytes.length)
      result.set(encoder.encode(FLUSH_PKT), headerBytes.length + pktLine.length)
      return result
    }
  }

  output += FLUSH_PKT

  return encoder.encode(output)
}

/**
 * Format receive-pack response.
 *
 * @description
 * Creates the response body for git-receive-pack POST request,
 * including unpack status and ref update results. The format is:
 * 1. Unpack status line: "unpack ok" or "unpack error"
 * 2. Ref status lines: "ok <refname>" or "ng <refname> <error>"
 * 3. Flush packet
 *
 * @param result - Result of the receive-pack operation
 * @returns Formatted response as Uint8Array
 *
 * @example
 * ```typescript
 * const result: ReceivePackResult = {
 *   success: true,
 *   refResults: [
 *     { refName: 'refs/heads/main', success: true },
 *     { refName: 'refs/heads/feature', success: false, error: 'non-fast-forward' }
 *   ]
 * }
 *
 * const response = formatReceivePackResponse(result)
 * // "unpack ok\nok refs/heads/main\nng refs/heads/feature non-fast-forward\n0000"
 * ```
 */
export function formatReceivePackResponse(result: ReceivePackResult): Uint8Array {
  let output = ''

  // Unpack status
  if (result.success) {
    output += encodePktLine('unpack ok\n') as string
  } else {
    output += encodePktLine('unpack error\n') as string
  }

  // Ref results
  for (const refResult of result.refResults) {
    if (refResult.success) {
      output += encodePktLine(`ok ${refResult.refName}\n`) as string
    } else {
      const error = refResult.error || 'failed'
      output += encodePktLine(`ng ${refResult.refName} ${error}\n`) as string
    }
  }

  output += FLUSH_PKT

  return encoder.encode(output)
}

/**
 * Convert ServerCapabilities to capability string list.
 *
 * @description
 * Converts the ServerCapabilities object into an array of capability
 * strings suitable for inclusion in ref advertisements. Boolean capabilities
 * become simple strings, while capabilities with values become "name=value".
 *
 * @param capabilities - Server capabilities object
 * @returns Array of capability strings
 *
 * @example
 * ```typescript
 * const caps: ServerCapabilities = {
 *   sideBand64k: true,
 *   thinPack: true,
 *   agent: 'my-server/1.0'
 * }
 *
 * const strings = capabilitiesToStrings(caps)
 * // ['side-band-64k', 'thin-pack', 'agent=my-server/1.0']
 * ```
 */
export function capabilitiesToStrings(capabilities: ServerCapabilities): string[] {
  const result: string[] = []

  if (capabilities.multiAck) result.push('multi_ack')
  if (capabilities.multiAckDetailed) result.push('multi_ack_detailed')
  if (capabilities.thinPack) result.push('thin-pack')
  if (capabilities.sideBand) result.push('side-band')
  if (capabilities.sideBand64k) result.push('side-band-64k')
  if (capabilities.ofsDelta) result.push('ofs-delta')
  if (capabilities.shallow) result.push('shallow')
  if (capabilities.deepenSince) result.push('deepen-since')
  if (capabilities.deepenNot) result.push('deepen-not')
  if (capabilities.deepenRelative) result.push('deepen-relative')
  if (capabilities.noProgress) result.push('no-progress')
  if (capabilities.includeTag) result.push('include-tag')
  if (capabilities.reportStatus) result.push('report-status')
  if (capabilities.reportStatusV2) result.push('report-status-v2')
  if (capabilities.deleteRefs) result.push('delete-refs')
  if (capabilities.quiet) result.push('quiet')
  if (capabilities.atomic) result.push('atomic')
  if (capabilities.pushOptions) result.push('push-options')
  if (capabilities.allowTipSha1InWant) result.push('allow-tip-sha1-in-want')
  if (capabilities.allowReachableSha1InWant) result.push('allow-reachable-sha1-in-want')
  if (capabilities.filter) result.push('filter')
  if (capabilities.agent) result.push(`agent=${capabilities.agent}`)
  if (capabilities.objectFormat) result.push(`object-format=${capabilities.objectFormat}`)

  return result
}

/**
 * Parse capability strings into ServerCapabilities object.
 *
 * @description
 * Converts an array of capability strings (as received from a client or
 * server) into a structured ServerCapabilities object for easier access.
 *
 * @param capStrings - Array of capability strings
 * @returns Parsed capabilities object
 *
 * @example
 * ```typescript
 * const strings = ['side-band-64k', 'thin-pack', 'agent=git/2.30.0']
 * const caps = parseCapabilities(strings)
 * // caps.sideBand64k === true
 * // caps.thinPack === true
 * // caps.agent === 'git/2.30.0'
 * ```
 */
export function parseCapabilities(capStrings: string[]): ServerCapabilities {
  const result: ServerCapabilities = {}

  for (const cap of capStrings) {
    if (cap === 'multi_ack') result.multiAck = true
    else if (cap === 'multi_ack_detailed') result.multiAckDetailed = true
    else if (cap === 'thin-pack') result.thinPack = true
    else if (cap === 'side-band') result.sideBand = true
    else if (cap === 'side-band-64k') result.sideBand64k = true
    else if (cap === 'ofs-delta') result.ofsDelta = true
    else if (cap === 'shallow') result.shallow = true
    else if (cap === 'deepen-since') result.deepenSince = true
    else if (cap === 'deepen-not') result.deepenNot = true
    else if (cap === 'deepen-relative') result.deepenRelative = true
    else if (cap === 'no-progress') result.noProgress = true
    else if (cap === 'include-tag') result.includeTag = true
    else if (cap === 'report-status') result.reportStatus = true
    else if (cap === 'report-status-v2') result.reportStatusV2 = true
    else if (cap === 'delete-refs') result.deleteRefs = true
    else if (cap === 'quiet') result.quiet = true
    else if (cap === 'atomic') result.atomic = true
    else if (cap === 'push-options') result.pushOptions = true
    else if (cap === 'allow-tip-sha1-in-want') result.allowTipSha1InWant = true
    else if (cap === 'allow-reachable-sha1-in-want') result.allowReachableSha1InWant = true
    else if (cap === 'filter') result.filter = true
    else if (cap.startsWith('agent=')) result.agent = cap.slice(6)
    else if (cap.startsWith('object-format=')) result.objectFormat = cap.slice(14)
    // Unknown capabilities are ignored
  }

  return result
}

/**
 * Validate Content-Type header for a request.
 *
 * @description
 * Compares the provided Content-Type header against an expected value,
 * handling case-insensitivity and stripping charset or other parameters.
 *
 * @param contentType - The Content-Type header value from the request
 * @param expectedType - The expected Content-Type
 * @returns true if the content type matches, false otherwise
 *
 * @example
 * ```typescript
 * validateContentType(
 *   'application/x-git-upload-pack-request; charset=utf-8',
 *   'application/x-git-upload-pack-request'
 * )
 * // Returns true
 *
 * validateContentType('text/plain', 'application/x-git-upload-pack-request')
 * // Returns false
 * ```
 */
export function validateContentType(
  contentType: string | undefined,
  expectedType: string
): boolean {
  if (!contentType) {
    return false
  }

  // Normalize: lowercase and strip charset or other parameters
  const normalized = contentType.toLowerCase().split(';')[0].trim()
  const expected = expectedType.toLowerCase()

  return normalized === expected
}

/**
 * Create an error response with appropriate status code and message.
 *
 * @description
 * Helper function to create a properly formatted error response with
 * the correct HTTP status code, status text, and plain text body.
 *
 * @param statusCode - HTTP status code (e.g., 400, 403, 404)
 * @param message - Error message to include in the response body
 * @returns SmartHTTPResponse with error information
 *
 * @example
 * ```typescript
 * const response = createErrorResponse(404, 'Repository not found')
 * // response.status === 404
 * // response.statusText === 'Not Found'
 * // response.headers['Content-Type'] === 'text/plain'
 * // response.body contains 'Repository not found'
 * ```
 */
export function createErrorResponse(
  statusCode: number,
  message: string
): SmartHTTPResponse {
  return {
    status: statusCode,
    statusText: getStatusText(statusCode),
    headers: {
      'Content-Type': 'text/plain',
    },
    body: encoder.encode(message),
  }
}
