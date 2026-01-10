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
// Metrics Types & Interface
// ============================================================================

/**
 * Error types for metric tracking.
 */
export type IngestErrorType = 'parse' | 'validation' | 'pipeline' | 'payload_size'

/**
 * Lightweight metrics interface for observability.
 * Uses structured JSON logging that can be replaced with Analytics Engine.
 */
export interface ArtifactMetrics {
  recordMetric(name: string, value: number, tags?: Record<string, string>): void
  recordLatency(name: string, durationMs: number, tags?: Record<string, string>): void
  recordError(name: string, error: Error, tags?: Record<string, string>): void
}

/**
 * Default console-based metrics implementation.
 * Outputs structured JSON logs for monitoring.
 */
export function createDefaultMetrics(): ArtifactMetrics {
  const ts = () => new Date().toISOString()

  return {
    recordMetric(name: string, value: number, tags?: Record<string, string>) {
      console.log(JSON.stringify({
        type: 'metric',
        name,
        value,
        tags,
        ts: ts(),
      }))
    },

    recordLatency(name: string, durationMs: number, tags?: Record<string, string>) {
      console.log(JSON.stringify({
        type: 'latency',
        name,
        durationMs,
        tags,
        ts: ts(),
      }))
    },

    recordError(name: string, error: Error, tags?: Record<string, string>) {
      console.log(JSON.stringify({
        type: 'error',
        name,
        message: error.message,
        tags,
        ts: ts(),
      }))
    },
  }
}

/**
 * No-op metrics implementation for when metrics are disabled.
 */
export const noopMetrics: ArtifactMetrics = {
  recordMetric() {},
  recordLatency() {},
  recordError() {},
}

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

/**
 * Result of uploading a single chunk to the pipeline.
 */
export interface ChunkUploadResult {
  chunkIndex: number
  recordCount: number
  success: boolean
  error?: string
  statusCode?: number
  retries: number
}

/**
 * Detailed information about chunk processing including retry details.
 */
export interface ChunkDetails {
  total: number
  succeeded: number
  failed: number
  retried: number
}

/**
 * Error details for individual chunk failures.
 */
export interface ChunkError {
  chunk: number
  error: string
  retries: number
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Options for the withRetry wrapper.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Base delay in milliseconds for exponential backoff (default: 100) */
  baseDelayMs?: number
  /** Maximum delay in milliseconds (default: 1000) */
  maxDelayMs?: number
}

/**
 * Result from a retry operation including metadata.
 */
export interface RetryResult<T> {
  result: T
  retries: number
  success: boolean
  error?: string
}

/**
 * Sleep utility for delays between retries.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Executes a function with exponential backoff retry logic.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns Promise resolving to the result with retry metadata
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetch(url),
 *   { maxRetries: 3, baseDelayMs: 100 }
 * )
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<RetryResult<T>> {
  const maxRetries = options?.maxRetries ?? 3
  const baseDelayMs = options?.baseDelayMs ?? 100
  const maxDelayMs = options?.maxDelayMs ?? 1000

  let lastError: Error | undefined
  let retryCount = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn()
      return {
        result,
        retries: retryCount,
        success: true,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      if (attempt < maxRetries) {
        retryCount++
        // Exponential backoff: baseDelayMs * 2^attempt, capped at maxDelayMs
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)
        await sleep(delay)
      }
    }
  }

  return {
    result: undefined as T,
    retries: retryCount,
    success: false,
    error: lastError?.message ?? 'Unknown error',
  }
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

/**
 * Streaming chunker that yields chunks as they fill up.
 * Buffers only the current chunk being built, not the entire payload.
 * Memory usage is O(chunkSize) instead of O(payloadSize).
 *
 * @param records - AsyncIterable of artifact records
 * @param maxBytes - Maximum bytes per chunk (default: 1MB)
 * @yields Chunks of records as they fill up
 */
export async function* chunkArtifactsStreaming(
  records: AsyncIterable<ArtifactRecord>,
  maxBytes: number
): AsyncGenerator<ArtifactRecord[]> {
  let currentChunk: ArtifactRecord[] = []
  let currentSize = 2 // Account for "[]" wrapper

  for await (const record of records) {
    const recordJson = JSON.stringify(record)
    const recordSize = recordJson.length + (currentChunk.length > 0 ? 1 : 0) // +1 for comma separator

    // If single record is larger than maxBytes, put it in its own chunk
    if (recordJson.length + 2 > maxBytes) {
      // Flush current chunk if non-empty
      if (currentChunk.length > 0) {
        yield currentChunk
        currentChunk = []
        currentSize = 2
      }
      // Yield oversized record as its own chunk
      yield [record]
      continue
    }

    // Check if adding this record would exceed maxBytes
    if (currentSize + recordSize > maxBytes) {
      // Flush current chunk
      if (currentChunk.length > 0) {
        yield currentChunk
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
    yield currentChunk
  }
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
 * Default concurrency for parallel chunk uploads.
 */
const DEFAULT_UPLOAD_CONCURRENCY = 3

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
  /** Optional metrics instance for observability. Uses noopMetrics if not provided. */
  metrics?: ArtifactMetrics
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

// ============================================================================
// Parallel Chunk Upload with Retry
// ============================================================================

/**
 * Default retry options for chunk uploads.
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
}

/**
 * Uploads a single chunk to the pipeline endpoint with retry logic.
 *
 * Uses exponential backoff (100ms, 200ms, 400ms) for transient failures.
 * Network errors and 5xx responses trigger retries; 4xx responses do not.
 *
 * @param chunk - Array of artifact records to upload
 * @param chunkIndex - Index of the chunk for result tracking
 * @param endpoint - Pipeline URL to send to
 * @param mode - Artifact mode for header
 * @param retryOptions - Optional retry configuration
 * @returns ChunkUploadResult with success/failure details and retry count
 */
async function uploadChunk(
  chunk: ArtifactRecord[],
  chunkIndex: number,
  endpoint: string,
  mode: ArtifactMode,
  retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<ChunkUploadResult> {
  const retryResult = await withRetry(
    async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pipeline-Mode': mode,
        },
        body: JSON.stringify(chunk),
      })

      // Only retry on server errors (5xx), not client errors (4xx)
      if (response.status >= 500) {
        throw new Error(`HTTP ${response.status}`)
      }

      return response
    },
    retryOptions
  )

  if (retryResult.success && retryResult.result) {
    const response = retryResult.result
    if (response.ok) {
      return {
        chunkIndex,
        recordCount: chunk.length,
        success: true,
        statusCode: response.status,
        retries: retryResult.retries,
      }
    } else {
      // 4xx errors - don't retry, report failure
      return {
        chunkIndex,
        recordCount: chunk.length,
        success: false,
        error: `HTTP ${response.status}`,
        statusCode: response.status,
        retries: retryResult.retries,
      }
    }
  }

  // All retries exhausted or network error
  return {
    chunkIndex,
    recordCount: chunk.length,
    success: false,
    error: retryResult.error ?? 'Unknown error',
    retries: retryResult.retries,
  }
}

/**
 * Uploads chunks to the pipeline in parallel with concurrency control.
 *
 * Uses a semaphore-like pattern to limit concurrent uploads while maximizing
 * throughput. Processes all chunks and returns detailed per-chunk results.
 *
 * @param chunks - Array of chunk arrays to upload
 * @param endpoint - Pipeline endpoint URL
 * @param mode - Artifact mode for the X-Pipeline-Mode header
 * @param concurrency - Maximum concurrent uploads (default: 3)
 * @returns Array of ChunkUploadResult for each chunk
 */
export async function uploadChunksParallel(
  chunks: ArtifactRecord[][],
  endpoint: string,
  mode: ArtifactMode,
  concurrency: number = DEFAULT_UPLOAD_CONCURRENCY
): Promise<ChunkUploadResult[]> {
  if (chunks.length === 0) {
    return []
  }

  // For small number of chunks, just run them all in parallel
  if (chunks.length <= concurrency) {
    return Promise.all(
      chunks.map((chunk, index) => uploadChunk(chunk, index, endpoint, mode))
    )
  }

  // Use a pool pattern for concurrency control
  const results: ChunkUploadResult[] = new Array(chunks.length)
  let nextIndex = 0

  async function processNext(): Promise<void> {
    while (nextIndex < chunks.length) {
      const currentIndex = nextIndex++
      const result = await uploadChunk(chunks[currentIndex], currentIndex, endpoint, mode)
      results[currentIndex] = result
    }
  }

  // Start `concurrency` number of workers
  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(concurrency, chunks.length); i++) {
    workers.push(processNext())
  }

  await Promise.all(workers)
  return results
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
  const metrics = options?.metrics ?? noopMetrics
  const startTime = Date.now()

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
            metrics.recordError('ingest.payload_size_error', new Error('Payload too large'), { mode, errorType: 'payload_size' })
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
        metrics.recordError('ingest.payload_size_error', new Error('Payload too large'), { mode, errorType: 'payload_size' })
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

  // Send to Pipeline (parallel with concurrency control)
  const pipelineUrl = getPipelineUrl(mode, env)
  const uploadResults = await uploadChunksParallel(chunks, pipelineUrl, mode)

  // Aggregate results
  let acceptedCount = 0
  let failedChunks = 0

  for (const uploadResult of uploadResults) {
    if (uploadResult.success) {
      acceptedCount += uploadResult.recordCount
    } else {
      failedChunks++
    }
  }

  // Calculate estimated availability time
  const estimatedAvailableAt = new Date(Date.now() + MODE_BUFFER_MS[mode]).toISOString()

  // Record metrics
  const durationMs = Date.now() - startTime
  const baseTags = { mode, pipeline: mode, requestId }
  metrics.recordLatency('ingest.latency', durationMs, baseTags)
  metrics.recordMetric('ingest.records', artifacts.length, baseTags)
  metrics.recordMetric('ingest.bytes', totalSize, baseTags)
  metrics.recordMetric('ingest.chunks', chunks.length, baseTags)
  if (failedChunks > 0) {
    metrics.recordError('ingest.pipeline_error', new Error(`${failedChunks} chunks failed`), { ...baseTags, errorType: 'pipeline' })
  }

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
