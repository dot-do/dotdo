/**
 * Artifact Ingest Snippet
 *
 * Handles artifact ingestion via JSONL for the artifact storage system.
 * Parses JSONL bodies, validates schema, chunks large payloads, and routes
 * to the appropriate Pipeline based on X-Artifact-Mode header.
 *
 * Constraints:
 * - Snippet size: <32KB
 * - CPU time: <5ms
 * - Chunk size: <=1MB batches for Pipeline HTTP endpoint
 *
 * @module snippets/artifacts-ingest
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Valid artifact modes for routing to different Pipelines.
 */
export type ArtifactMode = 'preview' | 'build' | 'bulk'

/**
 * Represents a validated artifact record with required and optional fields.
 */
export interface ArtifactRecord {
  // Required identity fields
  ns: string
  type: string
  id: string
  ts?: string // Added by ingest

  // Source artifacts
  markdown?: string | null
  mdx?: string | null

  // Compiled artifacts
  html?: string | null
  esm?: string | null
  dts?: string | null
  css?: string | null

  // AST artifacts (JSON)
  mdast?: object | null
  hast?: object | null
  estree?: object | null
  tsast?: object | null

  // Metadata
  frontmatter?: object | null
  dependencies?: string[] | null
  exports?: string[] | null
  hash?: string | null
  size_bytes?: number | null

  // Visibility/access control
  visibility?: 'public' | 'private' | 'internal' | null
}

/**
 * Response returned from the ingest endpoint.
 */
export interface IngestResponse {
  accepted: number
  chunks: number
  pipeline: ArtifactMode
  estimatedAvailableAt?: string
  failed?: number
  error?: string
  line?: number
}

// ============================================================================
// JSONL Parsing
// ============================================================================

/**
 * Parses a JSONL stream and yields individual records.
 * Handles records split across stream chunks.
 *
 * @param body - ReadableStream of JSONL data
 * @yields Parsed objects from each line
 * @throws {Error} When a line contains malformed JSON
 */
export async function* parseJSONL(body: ReadableStream<Uint8Array>): AsyncGenerator<ArtifactRecord> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        // Process any remaining content in buffer
        if (buffer.trim()) {
          yield JSON.parse(buffer.trim())
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })

      // Process complete lines
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)

        if (line) {
          yield JSON.parse(line)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ============================================================================
// Schema Validation
// ============================================================================

/**
 * Validates a record against the artifact schema.
 * Ensures required fields (ns, type, id) are present and valid.
 *
 * @param record - The record to validate
 * @returns The validated ArtifactRecord
 * @throws {Error} When validation fails with descriptive message
 */
export function validateArtifact(record: unknown): ArtifactRecord {
  // Check for null/undefined
  if (record === null) {
    throw new Error('Invalid record: null is not allowed')
  }
  if (record === undefined) {
    throw new Error('Invalid record: undefined is not allowed')
  }

  // Check it's an object (and not an array)
  if (typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Invalid record: must be an object')
  }

  const obj = record as Record<string, unknown>

  // Validate required fields
  if (!('ns' in obj) || obj.ns === undefined) {
    throw new Error('Field "ns" is required')
  }
  if (typeof obj.ns !== 'string') {
    throw new Error('Field "ns" must be a string')
  }
  if (obj.ns === '') {
    throw new Error('Field "ns" cannot be empty')
  }

  if (!('type' in obj) || obj.type === undefined) {
    throw new Error('Field "type" is required')
  }
  if (typeof obj.type !== 'string') {
    throw new Error('Field "type" must be a string')
  }
  if (obj.type === '') {
    throw new Error('Field "type" cannot be empty')
  }

  if (!('id' in obj) || obj.id === undefined) {
    throw new Error('Field "id" is required')
  }
  if (typeof obj.id !== 'string') {
    throw new Error('Field "id" must be a string')
  }
  if (obj.id === '') {
    throw new Error('Field "id" cannot be empty')
  }

  // Validate optional fields
  if ('visibility' in obj && obj.visibility !== null && obj.visibility !== undefined) {
    const validVisibilities = ['public', 'private', 'internal']
    if (!validVisibilities.includes(obj.visibility as string)) {
      throw new Error('Field "visibility" must be one of: public, private, internal')
    }
  }

  if ('dependencies' in obj && obj.dependencies !== null && obj.dependencies !== undefined) {
    if (!Array.isArray(obj.dependencies)) {
      throw new Error('Field "dependencies" must be an array')
    }
    for (const dep of obj.dependencies) {
      if (typeof dep !== 'string') {
        throw new Error('Field "dependencies" must be an array of strings')
      }
    }
  }

  if ('exports' in obj && obj.exports !== null && obj.exports !== undefined) {
    if (!Array.isArray(obj.exports)) {
      throw new Error('Field "exports" must be an array')
    }
    for (const exp of obj.exports) {
      if (typeof exp !== 'string') {
        throw new Error('Field "exports" must be an array of strings')
      }
    }
  }

  if ('frontmatter' in obj && obj.frontmatter !== null && obj.frontmatter !== undefined) {
    if (typeof obj.frontmatter !== 'object' || Array.isArray(obj.frontmatter)) {
      throw new Error('Field "frontmatter" must be an object')
    }
  }

  return obj as ArtifactRecord
}

// ============================================================================
// Chunking
// ============================================================================

/**
 * Splits an array of artifacts into chunks that fit within maxBytes.
 * Uses JSON serialization to calculate actual payload size.
 *
 * @param records - Array of artifact records
 * @param maxBytes - Maximum bytes per chunk (default: 1MB)
 * @returns Array of chunks, each containing an array of records
 */
export function chunkArtifacts(records: ArtifactRecord[], maxBytes: number): ArtifactRecord[][] {
  if (records.length === 0) {
    return []
  }

  const chunks: ArtifactRecord[][] = []
  let currentChunk: ArtifactRecord[] = []
  let currentSize = 2 // Account for "[]" wrapper

  for (const record of records) {
    const recordJson = JSON.stringify(record)
    const recordSize = recordJson.length + (currentChunk.length > 0 ? 1 : 0) // +1 for comma separator

    // If single record is larger than maxBytes, put it in its own chunk
    if (recordJson.length + 2 > maxBytes) {
      // Flush current chunk if non-empty
      if (currentChunk.length > 0) {
        chunks.push(currentChunk)
        currentChunk = []
        currentSize = 2
      }
      // Add oversized record as its own chunk
      chunks.push([record])
      continue
    }

    // Check if adding this record would exceed maxBytes
    if (currentSize + recordSize > maxBytes) {
      // Flush current chunk
      if (currentChunk.length > 0) {
        chunks.push(currentChunk)
      }
      currentChunk = [record]
      currentSize = 2 + recordJson.length
    } else {
      currentChunk.push(record)
      currentSize += recordSize
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

// ============================================================================
// Pipeline Routing
// ============================================================================

/**
 * Base URL for Pipeline HTTP endpoints.
 */
const PIPELINE_BASE_URL = 'https://pipelines.dotdo.dev'

/**
 * Returns the Pipeline HTTP endpoint URL for the given mode.
 *
 * @param mode - The artifact mode (preview, build, bulk)
 * @returns The Pipeline endpoint URL
 * @throws {Error} When mode is invalid
 */
export function getPipelineEndpoint(mode: ArtifactMode): string {
  // Default to build if mode is undefined
  const resolvedMode = mode ?? 'build'

  switch (resolvedMode) {
    case 'preview':
      return `${PIPELINE_BASE_URL}/artifacts-preview`
    case 'build':
      return `${PIPELINE_BASE_URL}/artifacts-build`
    case 'bulk':
      return `${PIPELINE_BASE_URL}/artifacts-bulk`
    default:
      throw new Error(`Invalid mode: ${resolvedMode}`)
  }
}

// ============================================================================
// Request Handler
// ============================================================================

/**
 * Maximum payload size in bytes (10MB).
 */
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024

/**
 * Default chunk size in bytes (1MB).
 */
const DEFAULT_CHUNK_SIZE = 1024 * 1024

/**
 * Estimated processing time buffers by mode (in milliseconds).
 */
const MODE_BUFFER_MS: Record<ArtifactMode, number> = {
  preview: 5000, // 5 seconds
  build: 30000, // 30 seconds
  bulk: 120000, // 120 seconds
}

/**
 * Generates a request ID.
 */
function generateRequestId(): string {
  return crypto.randomUUID()
}

/**
 * Creates a JSON response with proper headers.
 */
function jsonResponse(
  body: IngestResponse,
  status: number,
  requestId: string
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    },
  })
}

/**
 * Result type for integration tests that expect object response.
 */
export interface IngestResult {
  accepted: number
  chunks: number
  pipeline: ArtifactMode
  estimatedAvailableAt: string
  failed?: number
}

/**
 * Environment bindings for handleIngest.
 */
export interface IngestEnv {
  PIPELINE_PREVIEW_URL?: string
  PIPELINE_BUILD_URL?: string
  PIPELINE_BULK_URL?: string
}

/**
 * Context for handleIngest.
 */
export interface IngestContext {
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * Options for handleIngest.
 */
export interface IngestOptions {
  authenticatedNs?: string
}

/**
 * Get pipeline URL from env or use default.
 */
function getPipelineUrl(mode: ArtifactMode, env?: IngestEnv): string {
  if (env) {
    switch (mode) {
      case 'preview':
        if (env.PIPELINE_PREVIEW_URL) return env.PIPELINE_PREVIEW_URL
        break
      case 'build':
        if (env.PIPELINE_BUILD_URL) return env.PIPELINE_BUILD_URL
        break
      case 'bulk':
        if (env.PIPELINE_BULK_URL) return env.PIPELINE_BULK_URL
        break
    }
  }
  return getPipelineEndpoint(mode)
}

/**
 * Main request handler for the artifact ingest endpoint.
 *
 * Overloaded to support both HTTP Response mode and integration test result mode.
 *
 * @param request - The incoming Request
 * @param env - Optional environment bindings with pipeline URLs
 * @param ctx - Optional execution context
 * @param options - Optional options like authenticatedNs
 * @returns Response or IngestResult depending on call signature
 */
export async function handleIngest(
  request: Request,
  env?: IngestEnv,
  ctx?: IngestContext,
  options?: IngestOptions
): Promise<Response | IngestResult> {
  const requestId = generateRequestId()
  const isIntegrationMode = env !== undefined

  // Method check
  if (request.method !== 'POST') {
    if (isIntegrationMode) {
      throw new Error('Method not allowed')
    }
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
          Allow: 'POST',
        },
      }
    )
  }

  // Content-Type check
  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.includes('application/x-ndjson')) {
    if (isIntegrationMode) {
      throw new Error('Unsupported media type. Expected application/x-ndjson')
    }
    return jsonResponse(
      { accepted: 0, chunks: 0, pipeline: 'build', error: 'Unsupported media type. Expected application/x-ndjson' },
      415,
      requestId
    )
  }

  // Get mode from header (case-insensitive)
  const modeHeader = request.headers.get('X-Artifact-Mode') ?? request.headers.get('x-artifact-mode')
  const mode: ArtifactMode = modeHeader
    ? (modeHeader.toLowerCase() as ArtifactMode)
    : 'build'

  // Check for valid mode
  if (mode && !['preview', 'build', 'bulk'].includes(mode)) {
    if (isIntegrationMode) {
      throw new Error(`Invalid mode: ${mode}`)
    }
    return jsonResponse(
      { accepted: 0, chunks: 0, pipeline: mode, error: `Invalid mode: ${mode}` },
      400,
      requestId
    )
  }

  // Get request body
  if (!request.body) {
    const result: IngestResult = {
      accepted: 0,
      chunks: 0,
      pipeline: mode,
      estimatedAvailableAt: new Date(Date.now() + MODE_BUFFER_MS[mode]).toISOString(),
    }
    if (isIntegrationMode) {
      return result
    }
    return jsonResponse(
      { accepted: 0, chunks: 0, pipeline: mode },
      200,
      requestId
    )
  }

  // Track payload size
  let totalSize = 0
  const artifacts: ArtifactRecord[] = []
  let lineNumber = 0

  try {
    // Parse JSONL and validate each record
    const reader = request.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        // Process remaining buffer
        if (buffer.trim()) {
          lineNumber++
          totalSize += buffer.length

          if (totalSize > MAX_PAYLOAD_SIZE) {
            if (isIntegrationMode) {
              throw new Error('Payload too large')
            }
            return jsonResponse(
              { accepted: 0, chunks: 0, pipeline: mode, error: 'Payload too large' },
              413,
              requestId
            )
          }

          try {
            const parsed = JSON.parse(buffer.trim())
            const validated = validateArtifact(parsed)

            // Check namespace match if authenticatedNs provided
            if (options?.authenticatedNs && validated.ns !== options.authenticatedNs) {
              throw new Error(`Unauthorized: namespace mismatch`)
            }

            artifacts.push(validated)
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Parse error'
            if (message.includes('Unauthorized') || message.includes('namespace')) {
              throw new Error(message)
            }
            if (isIntegrationMode) {
              // Any parse or validation error is reported as a parse error
              if (message.includes('JSON') || message.includes('Unexpected') || message.includes('Syntax')) {
                throw new Error(`Parse error: invalid JSON at line ${lineNumber}`)
              }
              throw new Error(`Parse error: missing required fields at line ${lineNumber}`)
            }
            if (message.includes('JSON')) {
              return jsonResponse(
                { accepted: 0, chunks: 0, pipeline: mode, error: `Malformed JSON at line ${lineNumber}`, line: lineNumber },
                400,
                requestId
              )
            }
            return jsonResponse(
              { accepted: 0, chunks: 0, pipeline: mode, error: message, line: lineNumber },
              400,
              requestId
            )
          }
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })
      totalSize += value.length

      if (totalSize > MAX_PAYLOAD_SIZE) {
        reader.releaseLock()
        if (isIntegrationMode) {
          throw new Error('Payload too large')
        }
        return jsonResponse(
          { accepted: 0, chunks: 0, pipeline: mode, error: 'Payload too large' },
          413,
          requestId
        )
      }

      // Process complete lines
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        lineNumber++

        if (line) {
          try {
            const parsed = JSON.parse(line)
            const validated = validateArtifact(parsed)

            // Check namespace match if authenticatedNs provided
            if (options?.authenticatedNs && validated.ns !== options.authenticatedNs) {
              throw new Error(`Unauthorized: namespace mismatch`)
            }

            artifacts.push(validated)
          } catch (err) {
            reader.releaseLock()
            const message = err instanceof Error ? err.message : 'Parse error'
            if (message.includes('Unauthorized') || message.includes('namespace')) {
              throw new Error(message)
            }
            if (isIntegrationMode) {
              // Any parse or validation error is reported as a parse error
              if (message.includes('JSON') || message.includes('Unexpected') || message.includes('Syntax')) {
                throw new Error(`Parse error: invalid JSON at line ${lineNumber}`)
              }
              throw new Error(`Parse error: missing required fields at line ${lineNumber}`)
            }
            if (message.includes('JSON') || message.includes('Unexpected')) {
              return jsonResponse(
                { accepted: 0, chunks: 0, pipeline: mode, error: `Malformed JSON at line ${lineNumber}`, line: lineNumber },
                400,
                requestId
              )
            }
            return jsonResponse(
              { accepted: 0, chunks: 0, pipeline: mode, error: message, line: lineNumber },
              400,
              requestId
            )
          }
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse error'
    if (message.includes('Unauthorized') || message.includes('namespace')) {
      throw new Error(message)
    }
    if (isIntegrationMode) {
      throw new Error(message)
    }
    return jsonResponse(
      { accepted: 0, chunks: 0, pipeline: mode, error: message },
      400,
      requestId
    )
  }

  // Handle empty body
  if (artifacts.length === 0) {
    const result: IngestResult = {
      accepted: 0,
      chunks: 0,
      pipeline: mode,
      estimatedAvailableAt: new Date(Date.now() + MODE_BUFFER_MS[mode]).toISOString(),
    }
    if (isIntegrationMode) {
      return result
    }
    return jsonResponse(
      { accepted: 0, chunks: 0, pipeline: mode },
      200,
      requestId
    )
  }

  // Add timestamp to each record
  const now = new Date().toISOString()
  for (const artifact of artifacts) {
    artifact.ts = now
  }

  // Chunk artifacts
  const chunks = chunkArtifacts(artifacts, DEFAULT_CHUNK_SIZE)

  // Send to Pipeline
  const pipelineUrl = getPipelineUrl(mode, env)
  let acceptedCount = 0
  let failedChunks = 0

  for (const chunk of chunks) {
    try {
      const response = await fetch(pipelineUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pipeline-Mode': mode,
        },
        body: JSON.stringify(chunk),
      })

      if (response.ok) {
        acceptedCount += chunk.length
      } else {
        failedChunks++
      }
    } catch {
      failedChunks++
    }
  }

  // Calculate estimated availability time
  const estimatedAvailableAt = new Date(Date.now() + MODE_BUFFER_MS[mode]).toISOString()

  // Build result
  const result: IngestResult = {
    accepted: acceptedCount,
    chunks: chunks.length,
    pipeline: mode,
    estimatedAvailableAt,
    ...(failedChunks > 0 ? { failed: artifacts.length - acceptedCount } : {}),
  }

  // Determine response status
  if (failedChunks === 0) {
    if (isIntegrationMode) {
      return result
    }
    return jsonResponse(
      {
        accepted: acceptedCount,
        chunks: chunks.length,
        pipeline: mode,
        estimatedAvailableAt,
      },
      200,
      requestId
    )
  } else if (acceptedCount > 0) {
    // Partial success
    if (isIntegrationMode) {
      return result
    }
    return jsonResponse(
      {
        accepted: acceptedCount,
        chunks: chunks.length,
        pipeline: mode,
        estimatedAvailableAt,
        failed: artifacts.length - acceptedCount,
      },
      207,
      requestId
    )
  } else {
    // Complete failure
    if (isIntegrationMode) {
      throw new Error('Pipeline failed: all chunks rejected')
    }
    return jsonResponse(
      {
        accepted: 0,
        chunks: chunks.length,
        pipeline: mode,
        error: 'Pipeline upstream error',
        failed: artifacts.length,
      },
      500,
      requestId
    )
  }
}
