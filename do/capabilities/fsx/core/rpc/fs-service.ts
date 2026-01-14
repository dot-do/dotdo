/**
 * RPC Service Mode for Heavy Filesystem Operations
 *
 * This module provides an RPC interface for running fsx as a separate Worker
 * via RPC binding. This keeps DO bundles small while enabling heavy filesystem
 * operations to be handled by a dedicated service.
 *
 * ## Features
 *
 * - **Batch file operations**: Read/write multiple files in a single RPC call
 * - **Streaming support**: Large file transfers with chunked streaming
 * - **Progress reporting**: Callbacks for tracking operation progress
 * - **RPC method definitions**: Type-safe method interfaces for Worker RPC
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────┐     RPC Binding      ┌──────────────────┐
 * │ Durable Object  │ ──────────────────── │  FSx Worker      │
 * │ (lightweight)   │                      │  (heavy ops)     │
 * └─────────────────┘                      └──────────────────┘
 * ```
 *
 * ## Usage
 *
 * Configure in wrangler.toml:
 * ```toml
 * [[services]]
 * binding = "FSX_SERVICE"
 * service = "fsx-worker"
 * ```
 *
 * Use in your DO:
 * ```typescript
 * import { FsServiceClient } from 'fsx/core/rpc/fs-service'
 *
 * class MyDO extends DurableObject {
 *   async handleBatchWrite(files: FileItem[]) {
 *     const client = new FsServiceClient(this.env.FSX_SERVICE)
 *     const results = await client.batchWrite(files)
 *     return results
 *   }
 * }
 * ```
 *
 * @module core/rpc/fs-service
 */

import type { StorageTier, Stats, WriteOptions, ReadOptions } from '../types.js'

// =============================================================================
// RPC Method Types
// =============================================================================

/**
 * Progress event emitted during batch operations
 */
export interface ProgressEvent {
  /** Total number of items in the batch */
  total: number
  /** Number of items completed */
  completed: number
  /** Current item being processed */
  currentItem: string
  /** Bytes processed for current item (for streaming) */
  bytesProcessed?: number
  /** Total bytes for current item (for streaming) */
  totalBytes?: number
  /** Timestamp of the event */
  timestamp: number
}

/**
 * Callback function for progress reporting
 */
export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>

/**
 * File item for batch operations
 */
export interface BatchFileItem {
  /** File path */
  path: string
  /** File content (for writes) */
  content?: string | Uint8Array
  /** Encoding for the content */
  encoding?: 'utf-8' | 'base64' | 'binary'
  /** Target storage tier */
  tier?: StorageTier
  /** File mode/permissions */
  mode?: number
}

/**
 * Result of a single batch operation
 */
export interface BatchOperationResult {
  /** File path */
  path: string
  /** Whether the operation succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Error code if failed */
  code?: string
  /** Bytes written/read */
  bytes?: number
  /** Storage tier used */
  tier?: StorageTier
  /** File checksum (SHA-256) */
  checksum?: string
}

/**
 * Result of a batch operation
 */
export interface BatchResult {
  /** Total items processed */
  total: number
  /** Number of successful operations */
  succeeded: number
  /** Number of failed operations */
  failed: number
  /** Individual results */
  results: BatchOperationResult[]
  /** Total duration in milliseconds */
  durationMs: number
}

/**
 * Streaming chunk for large file transfers
 */
export interface StreamChunk {
  /** Chunk data */
  data: Uint8Array
  /** Chunk index (0-based) */
  index: number
  /** Total number of chunks */
  totalChunks: number
  /** Offset in the file */
  offset: number
  /** Is this the last chunk? */
  isLast: boolean
  /** Checksum for the chunk (optional) */
  checksum?: string
}

/**
 * Options for streaming read operations
 */
export interface StreamReadOptions {
  /** Chunk size in bytes (default: 64KB) */
  chunkSize?: number
  /** Start position in bytes */
  start?: number
  /** End position in bytes (exclusive) */
  end?: number
  /** Progress callback */
  onProgress?: ProgressCallback
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Options for streaming write operations
 */
export interface StreamWriteOptions {
  /** Target storage tier */
  tier?: StorageTier
  /** File mode/permissions */
  mode?: number
  /** Progress callback */
  onProgress?: ProgressCallback
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Append mode (default: false) */
  append?: boolean
}

/**
 * Options for batch read operations
 */
export interface BatchReadOptions {
  /** Encoding for all files (default: binary) */
  encoding?: 'utf-8' | 'base64' | 'binary'
  /** Continue on error (default: true) */
  continueOnError?: boolean
  /** Parallel read limit (default: 10) */
  parallelLimit?: number
  /** Progress callback */
  onProgress?: ProgressCallback
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Options for batch write operations
 */
export interface BatchWriteOptions {
  /** Default storage tier for all files */
  defaultTier?: StorageTier
  /** Default file mode for all files */
  defaultMode?: number
  /** Continue on error (default: true) */
  continueOnError?: boolean
  /** Parallel write limit (default: 5) */
  parallelLimit?: number
  /** Progress callback */
  onProgress?: ProgressCallback
  /** Abort signal for cancellation */
  signal?: AbortSignal
  /** Atomic mode - all or nothing (default: false) */
  atomic?: boolean
}

/**
 * Options for batch delete operations
 */
export interface BatchDeleteOptions {
  /** Delete directories recursively */
  recursive?: boolean
  /** Continue on error (default: true) */
  continueOnError?: boolean
  /** Force delete (ignore ENOENT) */
  force?: boolean
  /** Progress callback */
  onProgress?: ProgressCallback
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * RPC request envelope
 */
export interface RpcRequest<T = unknown> {
  /** Method name */
  method: string
  /** Request parameters */
  params: T
  /** Request ID for correlation */
  id?: string
  /** Timestamp */
  timestamp?: number
}

/**
 * RPC response envelope
 */
export interface RpcResponse<T = unknown> {
  /** Response data (if success) */
  data?: T
  /** Error information (if failed) */
  error?: {
    code: string
    message: string
    details?: unknown
  }
  /** Request ID for correlation */
  id?: string
  /** Duration in milliseconds */
  durationMs?: number
}

// =============================================================================
// RPC Method Definitions
// =============================================================================

/**
 * RPC method definitions for the filesystem service.
 *
 * Each method is defined with its request parameters and response type.
 * These definitions enable type-safe RPC calls between Workers.
 */
export interface FsServiceMethods {
  // ---------------------------------------------------------------------------
  // Batch Operations
  // ---------------------------------------------------------------------------

  /**
   * Read multiple files in a single RPC call
   */
  batchRead: {
    params: { paths: string[]; options?: BatchReadOptions }
    result: BatchResult & { contents: Map<string, string | Uint8Array> }
  }

  /**
   * Write multiple files in a single RPC call
   */
  batchWrite: {
    params: { files: BatchFileItem[]; options?: BatchWriteOptions }
    result: BatchResult
  }

  /**
   * Delete multiple files/directories in a single RPC call
   */
  batchDelete: {
    params: { paths: string[]; options?: BatchDeleteOptions }
    result: BatchResult
  }

  /**
   * Get stats for multiple paths
   */
  batchStat: {
    params: { paths: string[] }
    result: BatchResult & { stats: Map<string, Stats | null> }
  }

  // ---------------------------------------------------------------------------
  // Streaming Operations
  // ---------------------------------------------------------------------------

  /**
   * Start a streaming read session
   */
  streamReadStart: {
    params: { path: string; options?: StreamReadOptions }
    result: { sessionId: string; totalSize: number; totalChunks: number; chunkSize: number }
  }

  /**
   * Get the next chunk in a streaming read session
   */
  streamReadChunk: {
    params: { sessionId: string; chunkIndex: number }
    result: StreamChunk
  }

  /**
   * End a streaming read session
   */
  streamReadEnd: {
    params: { sessionId: string }
    result: { success: boolean; bytesRead: number }
  }

  /**
   * Start a streaming write session
   */
  streamWriteStart: {
    params: { path: string; totalSize: number; options?: StreamWriteOptions }
    result: { sessionId: string; chunkSize: number }
  }

  /**
   * Write a chunk in a streaming write session
   */
  streamWriteChunk: {
    params: { sessionId: string; chunk: StreamChunk }
    result: { success: boolean; bytesWritten: number }
  }

  /**
   * Finalize a streaming write session
   */
  streamWriteEnd: {
    params: { sessionId: string; checksum?: string }
    result: { success: boolean; totalBytesWritten: number; tier: StorageTier; checksum: string }
  }

  /**
   * Abort a streaming session (read or write)
   */
  streamAbort: {
    params: { sessionId: string }
    result: { success: boolean }
  }

  // ---------------------------------------------------------------------------
  // Directory Operations
  // ---------------------------------------------------------------------------

  /**
   * Copy a directory tree
   */
  copyTree: {
    params: { src: string; dest: string; options?: { overwrite?: boolean; preserveMetadata?: boolean } }
    result: BatchResult
  }

  /**
   * Move a directory tree
   */
  moveTree: {
    params: { src: string; dest: string; options?: { overwrite?: boolean } }
    result: BatchResult
  }

  /**
   * Get directory size (recursive)
   */
  dirSize: {
    params: { path: string }
    result: { totalSize: number; fileCount: number; dirCount: number }
  }

  // ---------------------------------------------------------------------------
  // Utility Operations
  // ---------------------------------------------------------------------------

  /**
   * Compute checksum for a file
   */
  checksum: {
    params: { path: string; algorithm?: 'sha256' | 'md5' }
    result: { checksum: string; algorithm: string; size: number }
  }

  /**
   * Verify file integrity
   */
  verify: {
    params: { path: string; expectedChecksum: string; algorithm?: 'sha256' | 'md5' }
    result: { valid: boolean; actualChecksum: string }
  }

  /**
   * Health check
   */
  ping: {
    params: Record<string, never>
    result: { ok: true; timestamp: number; version: string }
  }
}

// =============================================================================
// Client Implementation
// =============================================================================

/**
 * Default chunk size for streaming operations (64KB)
 */
export const DEFAULT_CHUNK_SIZE = 64 * 1024

/**
 * Default parallel operation limit
 */
export const DEFAULT_PARALLEL_LIMIT = 10

/**
 * RPC client for the filesystem service.
 *
 * Provides type-safe methods for calling the FSx Worker service via RPC binding.
 *
 * @example
 * ```typescript
 * const client = new FsServiceClient(env.FSX_SERVICE)
 *
 * // Batch read files
 * const result = await client.batchRead(['/a.txt', '/b.txt', '/c.txt'])
 *
 * // Stream large file with progress
 * const stream = await client.streamRead('/large-file.bin', {
 *   onProgress: (event) => console.log(`${event.completed}/${event.total}`)
 * })
 * ```
 */
export class FsServiceClient {
  private service: Service

  constructor(service: Service) {
    this.service = service
  }

  // ---------------------------------------------------------------------------
  // Batch Operations
  // ---------------------------------------------------------------------------

  /**
   * Read multiple files in a single RPC call.
   *
   * @param paths - Array of file paths to read
   * @param options - Batch read options
   * @returns Batch result with file contents
   *
   * @example
   * ```typescript
   * const result = await client.batchRead(['/config.json', '/data.json'], {
   *   encoding: 'utf-8',
   *   onProgress: (e) => console.log(`${e.completed}/${e.total}`)
   * })
   *
   * for (const [path, content] of result.contents) {
   *   console.log(`${path}: ${content.length} bytes`)
   * }
   * ```
   */
  async batchRead(
    paths: string[],
    options?: BatchReadOptions
  ): Promise<BatchResult & { contents: Map<string, string | Uint8Array> }> {
    return this.call('batchRead', { paths, options })
  }

  /**
   * Write multiple files in a single RPC call.
   *
   * @param files - Array of file items to write
   * @param options - Batch write options
   * @returns Batch result
   *
   * @example
   * ```typescript
   * const result = await client.batchWrite([
   *   { path: '/a.txt', content: 'Hello' },
   *   { path: '/b.json', content: JSON.stringify({ key: 'value' }) },
   *   { path: '/c.bin', content: binaryData, encoding: 'binary' }
   * ], {
   *   defaultTier: 'hot',
   *   onProgress: (e) => console.log(`${e.currentItem}`)
   * })
   * ```
   */
  async batchWrite(files: BatchFileItem[], options?: BatchWriteOptions): Promise<BatchResult> {
    return this.call('batchWrite', { files, options })
  }

  /**
   * Delete multiple files/directories in a single RPC call.
   *
   * @param paths - Array of paths to delete
   * @param options - Batch delete options
   * @returns Batch result
   */
  async batchDelete(paths: string[], options?: BatchDeleteOptions): Promise<BatchResult> {
    return this.call('batchDelete', { paths, options })
  }

  /**
   * Get stats for multiple paths.
   *
   * @param paths - Array of paths to stat
   * @returns Batch result with stats map
   */
  async batchStat(paths: string[]): Promise<BatchResult & { stats: Map<string, Stats | null> }> {
    return this.call('batchStat', { paths })
  }

  // ---------------------------------------------------------------------------
  // Streaming Operations
  // ---------------------------------------------------------------------------

  /**
   * Stream read a large file with chunked transfer.
   *
   * @param path - File path to read
   * @param options - Stream read options
   * @returns AsyncIterable of chunks
   *
   * @example
   * ```typescript
   * const chunks = client.streamRead('/large-file.bin', {
   *   chunkSize: 1024 * 1024, // 1MB chunks
   *   onProgress: (e) => console.log(`${e.bytesProcessed}/${e.totalBytes}`)
   * })
   *
   * for await (const chunk of chunks) {
   *   await processChunk(chunk.data)
   * }
   * ```
   */
  async *streamRead(path: string, options?: StreamReadOptions): AsyncIterable<StreamChunk> {
    const startResult = await this.call('streamReadStart', { path, options })
    const { sessionId, totalChunks } = startResult

    try {
      for (let i = 0; i < totalChunks; i++) {
        if (options?.signal?.aborted) {
          await this.call('streamAbort', { sessionId })
          throw new DOMException('Aborted', 'AbortError')
        }

        const chunk = await this.call('streamReadChunk', { sessionId, chunkIndex: i })

        if (options?.onProgress) {
          await options.onProgress({
            total: totalChunks,
            completed: i + 1,
            currentItem: path,
            bytesProcessed: chunk.offset + chunk.data.length,
            totalBytes: startResult.totalSize,
            timestamp: Date.now(),
          })
        }

        yield chunk
      }

      await this.call('streamReadEnd', { sessionId })
    } catch (error) {
      await this.call('streamAbort', { sessionId }).catch(() => {})
      throw error
    }
  }

  /**
   * Stream write a large file with chunked transfer.
   *
   * @param path - File path to write
   * @param source - Source of data (AsyncIterable, ReadableStream, or Uint8Array)
   * @param totalSize - Total size of the data
   * @param options - Stream write options
   * @returns Write result
   *
   * @example
   * ```typescript
   * const response = await fetch('https://example.com/large-file.bin')
   * const totalSize = Number(response.headers.get('content-length'))
   *
   * await client.streamWrite('/downloads/file.bin', response.body!, totalSize, {
   *   tier: 'warm',
   *   onProgress: (e) => console.log(`${e.bytesProcessed}/${e.totalBytes}`)
   * })
   * ```
   */
  async streamWrite(
    path: string,
    source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | Uint8Array,
    totalSize: number,
    options?: StreamWriteOptions
  ): Promise<{ success: boolean; totalBytesWritten: number; tier: StorageTier; checksum: string }> {
    const startResult = await this.call('streamWriteStart', { path, totalSize, options })
    const { sessionId, chunkSize } = startResult

    let offset = 0
    let chunkIndex = 0
    const totalChunks = Math.ceil(totalSize / chunkSize)

    try {
      // Convert source to AsyncIterable
      const iterable = this.toAsyncIterable(source, chunkSize)

      for await (const data of iterable) {
        if (options?.signal?.aborted) {
          await this.call('streamAbort', { sessionId })
          throw new DOMException('Aborted', 'AbortError')
        }

        const chunk: StreamChunk = {
          data,
          index: chunkIndex,
          totalChunks,
          offset,
          isLast: chunkIndex === totalChunks - 1,
        }

        await this.call('streamWriteChunk', { sessionId, chunk })

        offset += data.length
        chunkIndex++

        if (options?.onProgress) {
          await options.onProgress({
            total: totalChunks,
            completed: chunkIndex,
            currentItem: path,
            bytesProcessed: offset,
            totalBytes: totalSize,
            timestamp: Date.now(),
          })
        }
      }

      return await this.call('streamWriteEnd', { sessionId })
    } catch (error) {
      await this.call('streamAbort', { sessionId }).catch(() => {})
      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // Directory Operations
  // ---------------------------------------------------------------------------

  /**
   * Copy a directory tree recursively.
   *
   * @param src - Source directory path
   * @param dest - Destination directory path
   * @param options - Copy options
   * @returns Batch result
   */
  async copyTree(
    src: string,
    dest: string,
    options?: { overwrite?: boolean; preserveMetadata?: boolean }
  ): Promise<BatchResult> {
    return this.call('copyTree', { src, dest, options })
  }

  /**
   * Move a directory tree.
   *
   * @param src - Source directory path
   * @param dest - Destination directory path
   * @param options - Move options
   * @returns Batch result
   */
  async moveTree(src: string, dest: string, options?: { overwrite?: boolean }): Promise<BatchResult> {
    return this.call('moveTree', { src, dest, options })
  }

  /**
   * Get the total size of a directory tree.
   *
   * @param path - Directory path
   * @returns Size information
   */
  async dirSize(path: string): Promise<{ totalSize: number; fileCount: number; dirCount: number }> {
    return this.call('dirSize', { path })
  }

  // ---------------------------------------------------------------------------
  // Utility Operations
  // ---------------------------------------------------------------------------

  /**
   * Compute the checksum of a file.
   *
   * @param path - File path
   * @param algorithm - Hash algorithm (default: sha256)
   * @returns Checksum result
   */
  async checksum(
    path: string,
    algorithm: 'sha256' | 'md5' = 'sha256'
  ): Promise<{ checksum: string; algorithm: string; size: number }> {
    return this.call('checksum', { path, algorithm })
  }

  /**
   * Verify file integrity.
   *
   * @param path - File path
   * @param expectedChecksum - Expected checksum value
   * @param algorithm - Hash algorithm (default: sha256)
   * @returns Verification result
   */
  async verify(
    path: string,
    expectedChecksum: string,
    algorithm: 'sha256' | 'md5' = 'sha256'
  ): Promise<{ valid: boolean; actualChecksum: string }> {
    return this.call('verify', { path, expectedChecksum, algorithm })
  }

  /**
   * Health check.
   *
   * @returns Ping result
   */
  async ping(): Promise<{ ok: true; timestamp: number; version: string }> {
    return this.call('ping', {})
  }

  // ---------------------------------------------------------------------------
  // Internal Methods
  // ---------------------------------------------------------------------------

  /**
   * Make an RPC call to the service.
   */
  private async call<M extends keyof FsServiceMethods>(
    method: M,
    params: FsServiceMethods[M]['params']
  ): Promise<FsServiceMethods[M]['result']> {
    const request: RpcRequest = {
      method,
      params,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    const response = await this.service.fetch('http://fsx-service/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`RPC call failed: ${response.status} ${text}`)
    }

    const result: RpcResponse<FsServiceMethods[M]['result']> = await response.json()

    if (result.error) {
      const error = new Error(result.error.message) as Error & { code: string }
      error.code = result.error.code
      throw error
    }

    return result.data!
  }

  /**
   * Convert various source types to AsyncIterable with chunking.
   */
  private async *toAsyncIterable(
    source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | Uint8Array,
    chunkSize: number
  ): AsyncIterable<Uint8Array> {
    if (source instanceof Uint8Array) {
      // Chunk the Uint8Array
      for (let i = 0; i < source.length; i += chunkSize) {
        yield source.slice(i, i + chunkSize)
      }
      return
    }

    if (source instanceof ReadableStream) {
      // Convert ReadableStream to AsyncIterable
      const reader = source.getReader()
      let buffer = new Uint8Array(0)

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Append to buffer
          const newBuffer = new Uint8Array(buffer.length + value.length)
          newBuffer.set(buffer)
          newBuffer.set(value, buffer.length)
          buffer = newBuffer

          // Yield full chunks
          while (buffer.length >= chunkSize) {
            yield buffer.slice(0, chunkSize)
            buffer = buffer.slice(chunkSize)
          }
        }

        // Yield remaining data
        if (buffer.length > 0) {
          yield buffer
        }
      } finally {
        reader.releaseLock()
      }
      return
    }

    // Already an AsyncIterable - re-chunk if needed
    let buffer = new Uint8Array(0)

    for await (const value of source) {
      const newBuffer = new Uint8Array(buffer.length + value.length)
      newBuffer.set(buffer)
      newBuffer.set(value, buffer.length)
      buffer = newBuffer

      while (buffer.length >= chunkSize) {
        yield buffer.slice(0, chunkSize)
        buffer = buffer.slice(chunkSize)
      }
    }

    if (buffer.length > 0) {
      yield buffer
    }
  }
}

// =============================================================================
// Service Implementation (for the FSx Worker)
// =============================================================================

/**
 * Session state for streaming operations
 */
interface StreamSession {
  type: 'read' | 'write'
  path: string
  data?: Uint8Array
  chunks?: Uint8Array[]
  totalSize: number
  chunkSize: number
  position: number
  createdAt: number
  options?: StreamReadOptions | StreamWriteOptions
}

/**
 * RPC service handler for the filesystem service.
 *
 * Implement this in a dedicated Worker to handle heavy filesystem operations
 * via RPC binding from Durable Objects.
 *
 * @example
 * ```typescript
 * // fsx-worker/src/index.ts
 * import { FsServiceHandler } from 'fsx/core/rpc/fs-service'
 * import { FsModule } from 'fsx/do'
 *
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const fs = new FsModule({ sql: env.FSX_DB.storage.sql })
 *     const handler = new FsServiceHandler(fs)
 *     return handler.handleRequest(request)
 *   }
 * }
 * ```
 */
export class FsServiceHandler {
  private fs: FsServiceFs
  private sessions: Map<string, StreamSession> = new Map()
  private version: string

  /**
   * Create a new service handler.
   *
   * @param fs - Filesystem implementation (FsModule or FsCapability)
   * @param version - Service version string (default: '1.0.0')
   */
  constructor(fs: FsServiceFs, version: string = '1.0.0') {
    this.fs = fs
    this.version = version
  }

  /**
   * Handle an incoming HTTP request.
   *
   * @param request - The HTTP request
   * @returns HTTP response
   */
  async handleRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const url = new URL(request.url)
    if (url.pathname !== '/rpc') {
      return new Response('Not found', { status: 404 })
    }

    try {
      const rpcRequest: RpcRequest = await request.json()
      const startTime = Date.now()

      const result = await this.dispatch(rpcRequest.method, rpcRequest.params)

      const response: RpcResponse = {
        data: result,
        id: rpcRequest.id,
        durationMs: Date.now() - startTime,
      }

      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      const e = error as Error & { code?: string }
      const response: RpcResponse = {
        error: {
          code: e.code || 'INTERNAL_ERROR',
          message: e.message,
        },
      }

      return new Response(JSON.stringify(response), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  /**
   * Dispatch an RPC method call.
   */
  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'batchRead':
        return this.handleBatchRead(params as FsServiceMethods['batchRead']['params'])
      case 'batchWrite':
        return this.handleBatchWrite(params as FsServiceMethods['batchWrite']['params'])
      case 'batchDelete':
        return this.handleBatchDelete(params as FsServiceMethods['batchDelete']['params'])
      case 'batchStat':
        return this.handleBatchStat(params as FsServiceMethods['batchStat']['params'])
      case 'streamReadStart':
        return this.handleStreamReadStart(params as FsServiceMethods['streamReadStart']['params'])
      case 'streamReadChunk':
        return this.handleStreamReadChunk(params as FsServiceMethods['streamReadChunk']['params'])
      case 'streamReadEnd':
        return this.handleStreamReadEnd(params as FsServiceMethods['streamReadEnd']['params'])
      case 'streamWriteStart':
        return this.handleStreamWriteStart(params as FsServiceMethods['streamWriteStart']['params'])
      case 'streamWriteChunk':
        return this.handleStreamWriteChunk(params as FsServiceMethods['streamWriteChunk']['params'])
      case 'streamWriteEnd':
        return this.handleStreamWriteEnd(params as FsServiceMethods['streamWriteEnd']['params'])
      case 'streamAbort':
        return this.handleStreamAbort(params as FsServiceMethods['streamAbort']['params'])
      case 'copyTree':
        return this.handleCopyTree(params as FsServiceMethods['copyTree']['params'])
      case 'moveTree':
        return this.handleMoveTree(params as FsServiceMethods['moveTree']['params'])
      case 'dirSize':
        return this.handleDirSize(params as FsServiceMethods['dirSize']['params'])
      case 'checksum':
        return this.handleChecksum(params as FsServiceMethods['checksum']['params'])
      case 'verify':
        return this.handleVerify(params as FsServiceMethods['verify']['params'])
      case 'ping':
        return this.handlePing()
      default:
        throw Object.assign(new Error(`Unknown method: ${method}`), { code: 'METHOD_NOT_FOUND' })
    }
  }

  // ---------------------------------------------------------------------------
  // Batch Operation Handlers
  // ---------------------------------------------------------------------------

  private async handleBatchRead({
    paths,
    options,
  }: FsServiceMethods['batchRead']['params']): Promise<FsServiceMethods['batchRead']['result']> {
    const startTime = Date.now()
    const results: BatchOperationResult[] = []
    const contents = new Map<string, string | Uint8Array>()
    let succeeded = 0
    let failed = 0

    const parallelLimit = options?.parallelLimit ?? DEFAULT_PARALLEL_LIMIT
    const continueOnError = options?.continueOnError ?? true

    // Process in batches
    for (let i = 0; i < paths.length; i += parallelLimit) {
      const batch = paths.slice(i, i + parallelLimit)
      const promises = batch.map(async (path) => {
        try {
          const content = await this.fs.read(path, { encoding: options?.encoding })
          contents.set(path, content)
          succeeded++
          return {
            path,
            success: true,
            bytes: typeof content === 'string' ? content.length : content.length,
          }
        } catch (error) {
          failed++
          const e = error as Error & { code?: string }
          if (!continueOnError) throw error
          return {
            path,
            success: false,
            error: e.message,
            code: e.code,
          }
        }
      })

      const batchResults = await Promise.all(promises)
      results.push(...batchResults)
    }

    return {
      total: paths.length,
      succeeded,
      failed,
      results,
      durationMs: Date.now() - startTime,
      contents,
    }
  }

  private async handleBatchWrite({
    files,
    options,
  }: FsServiceMethods['batchWrite']['params']): Promise<FsServiceMethods['batchWrite']['result']> {
    const startTime = Date.now()
    const results: BatchOperationResult[] = []
    let succeeded = 0
    let failed = 0

    const parallelLimit = options?.parallelLimit ?? 5
    const continueOnError = options?.continueOnError ?? true

    for (let i = 0; i < files.length; i += parallelLimit) {
      const batch = files.slice(i, i + parallelLimit)
      const promises = batch.map(async (file) => {
        try {
          const content = file.content ?? ''
          const tier = file.tier ?? options?.defaultTier
          const mode = file.mode ?? options?.defaultMode

          await this.fs.write(file.path, content, { tier, mode })
          succeeded++

          return {
            path: file.path,
            success: true,
            bytes: typeof content === 'string' ? content.length : content.length,
            tier,
          }
        } catch (error) {
          failed++
          const e = error as Error & { code?: string }
          if (!continueOnError) throw error
          return {
            path: file.path,
            success: false,
            error: e.message,
            code: e.code,
          }
        }
      })

      const batchResults = await Promise.all(promises)
      results.push(...batchResults)
    }

    return {
      total: files.length,
      succeeded,
      failed,
      results,
      durationMs: Date.now() - startTime,
    }
  }

  private async handleBatchDelete({
    paths,
    options,
  }: FsServiceMethods['batchDelete']['params']): Promise<FsServiceMethods['batchDelete']['result']> {
    const startTime = Date.now()
    const results: BatchOperationResult[] = []
    let succeeded = 0
    let failed = 0

    const continueOnError = options?.continueOnError ?? true

    for (const path of paths) {
      try {
        await this.fs.rm(path, { recursive: options?.recursive, force: options?.force })
        succeeded++
        results.push({ path, success: true })
      } catch (error) {
        failed++
        const e = error as Error & { code?: string }
        if (!continueOnError) throw error
        results.push({ path, success: false, error: e.message, code: e.code })
      }
    }

    return {
      total: paths.length,
      succeeded,
      failed,
      results,
      durationMs: Date.now() - startTime,
    }
  }

  private async handleBatchStat({
    paths,
  }: FsServiceMethods['batchStat']['params']): Promise<FsServiceMethods['batchStat']['result']> {
    const startTime = Date.now()
    const results: BatchOperationResult[] = []
    const stats = new Map<string, Stats | null>()
    let succeeded = 0
    let failed = 0

    for (const path of paths) {
      try {
        const stat = await this.fs.stat(path)
        stats.set(path, stat)
        succeeded++
        results.push({ path, success: true })
      } catch (error) {
        stats.set(path, null)
        failed++
        const e = error as Error & { code?: string }
        results.push({ path, success: false, error: e.message, code: e.code })
      }
    }

    return {
      total: paths.length,
      succeeded,
      failed,
      results,
      durationMs: Date.now() - startTime,
      stats,
    }
  }

  // ---------------------------------------------------------------------------
  // Streaming Operation Handlers
  // ---------------------------------------------------------------------------

  private async handleStreamReadStart({
    path,
    options,
  }: FsServiceMethods['streamReadStart']['params']): Promise<FsServiceMethods['streamReadStart']['result']> {
    const data = (await this.fs.read(path)) as Uint8Array
    const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE
    const totalSize = data.length
    const totalChunks = Math.ceil(totalSize / chunkSize)

    const sessionId = crypto.randomUUID()
    this.sessions.set(sessionId, {
      type: 'read',
      path,
      data,
      totalSize,
      chunkSize,
      position: 0,
      createdAt: Date.now(),
      options,
    })

    return { sessionId, totalSize, totalChunks, chunkSize }
  }

  private async handleStreamReadChunk({
    sessionId,
    chunkIndex,
  }: FsServiceMethods['streamReadChunk']['params']): Promise<FsServiceMethods['streamReadChunk']['result']> {
    const session = this.sessions.get(sessionId)
    if (!session || session.type !== 'read') {
      throw Object.assign(new Error('Invalid session'), { code: 'INVALID_SESSION' })
    }

    const offset = chunkIndex * session.chunkSize
    const end = Math.min(offset + session.chunkSize, session.totalSize)
    const data = session.data!.slice(offset, end)
    const totalChunks = Math.ceil(session.totalSize / session.chunkSize)

    return {
      data,
      index: chunkIndex,
      totalChunks,
      offset,
      isLast: chunkIndex === totalChunks - 1,
    }
  }

  private async handleStreamReadEnd({
    sessionId,
  }: FsServiceMethods['streamReadEnd']['params']): Promise<FsServiceMethods['streamReadEnd']['result']> {
    const session = this.sessions.get(sessionId)
    if (!session || session.type !== 'read') {
      throw Object.assign(new Error('Invalid session'), { code: 'INVALID_SESSION' })
    }

    const bytesRead = session.totalSize
    this.sessions.delete(sessionId)

    return { success: true, bytesRead }
  }

  private async handleStreamWriteStart({
    path,
    totalSize,
    options,
  }: FsServiceMethods['streamWriteStart']['params']): Promise<FsServiceMethods['streamWriteStart']['result']> {
    const chunkSize = DEFAULT_CHUNK_SIZE
    const sessionId = crypto.randomUUID()

    this.sessions.set(sessionId, {
      type: 'write',
      path,
      chunks: [],
      totalSize,
      chunkSize,
      position: 0,
      createdAt: Date.now(),
      options,
    })

    return { sessionId, chunkSize }
  }

  private async handleStreamWriteChunk({
    sessionId,
    chunk,
  }: FsServiceMethods['streamWriteChunk']['params']): Promise<FsServiceMethods['streamWriteChunk']['result']> {
    const session = this.sessions.get(sessionId)
    if (!session || session.type !== 'write') {
      throw Object.assign(new Error('Invalid session'), { code: 'INVALID_SESSION' })
    }

    // Handle chunk.data which may come in various formats:
    // - Uint8Array (direct call)
    // - number[] (JSON serialization of Uint8Array)
    // - object with numeric keys (JSON object representation)
    const data = this.toUint8Array(chunk.data)

    session.chunks!.push(data)
    session.position += data.length

    return { success: true, bytesWritten: data.length }
  }

  /**
   * Convert various data formats to Uint8Array.
   * Handles JSON serialization quirks where Uint8Array can become:
   * - A plain array of numbers
   * - An object with numeric string keys
   */
  private toUint8Array(data: unknown): Uint8Array {
    if (data instanceof Uint8Array) {
      return data
    }

    if (Array.isArray(data)) {
      // Plain array of numbers
      return new Uint8Array(data as number[])
    }

    if (data && typeof data === 'object') {
      // Object with numeric keys (JSON serialization of typed array)
      const obj = data as Record<string, number | undefined>
      const keys = Object.keys(obj).filter((k) => !isNaN(Number(k)))
      if (keys.length > 0) {
        const maxIndex = Math.max(...keys.map(Number))
        const arr = new Uint8Array(maxIndex + 1)
        for (const key of keys) {
          const value = obj[key]
          if (value !== undefined) {
            arr[Number(key)] = value
          }
        }
        return arr
      }
    }

    // Return empty array as fallback
    return new Uint8Array(0)
  }

  private async handleStreamWriteEnd({
    sessionId,
  }: FsServiceMethods['streamWriteEnd']['params']): Promise<FsServiceMethods['streamWriteEnd']['result']> {
    const session = this.sessions.get(sessionId)
    if (!session || session.type !== 'write') {
      throw Object.assign(new Error('Invalid session'), { code: 'INVALID_SESSION' })
    }

    // Combine chunks
    const totalLength = session.chunks!.reduce((sum, c) => sum + c.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of session.chunks!) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    // Compute checksum
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const checksum = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

    // Write to filesystem
    const opts = session.options as StreamWriteOptions | undefined
    await this.fs.write(session.path, combined, {
      tier: opts?.tier,
      mode: opts?.mode,
    })

    // Get the tier it was actually written to
    const tier = (await this.fs.getTier?.(session.path)) ?? 'hot'

    this.sessions.delete(sessionId)

    return { success: true, totalBytesWritten: combined.length, tier, checksum }
  }

  private async handleStreamAbort({
    sessionId,
  }: FsServiceMethods['streamAbort']['params']): Promise<FsServiceMethods['streamAbort']['result']> {
    this.sessions.delete(sessionId)
    return { success: true }
  }

  // ---------------------------------------------------------------------------
  // Directory Operation Handlers
  // ---------------------------------------------------------------------------

  private async handleCopyTree({
    src,
    dest,
    options,
  }: FsServiceMethods['copyTree']['params']): Promise<FsServiceMethods['copyTree']['result']> {
    const startTime = Date.now()
    const results: BatchOperationResult[] = []
    let succeeded = 0
    let failed = 0

    // Recursively copy directory
    const copyRecursive = async (srcPath: string, destPath: string) => {
      const stat = await this.fs.stat(srcPath)

      if (stat.isDirectory()) {
        await this.fs.mkdir(destPath, { recursive: true })
        const entries = (await this.fs.readdir(srcPath)) as string[]

        for (const entry of entries) {
          await copyRecursive(`${srcPath}/${entry}`, `${destPath}/${entry}`)
        }

        results.push({ path: destPath, success: true })
        succeeded++
      } else {
        try {
          await this.fs.copyFile(srcPath, destPath, { overwrite: options?.overwrite })
          results.push({ path: destPath, success: true })
          succeeded++
        } catch (error) {
          const e = error as Error & { code?: string }
          results.push({ path: destPath, success: false, error: e.message, code: e.code })
          failed++
        }
      }
    }

    await copyRecursive(src, dest)

    return {
      total: results.length,
      succeeded,
      failed,
      results,
      durationMs: Date.now() - startTime,
    }
  }

  private async handleMoveTree({
    src,
    dest,
    options,
  }: FsServiceMethods['moveTree']['params']): Promise<FsServiceMethods['moveTree']['result']> {
    const startTime = Date.now()

    try {
      await this.fs.rename(src, dest, { overwrite: options?.overwrite })
      return {
        total: 1,
        succeeded: 1,
        failed: 0,
        results: [{ path: dest, success: true }],
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      const e = error as Error & { code?: string }
      return {
        total: 1,
        succeeded: 0,
        failed: 1,
        results: [{ path: dest, success: false, error: e.message, code: e.code }],
        durationMs: Date.now() - startTime,
      }
    }
  }

  private async handleDirSize({
    path,
  }: FsServiceMethods['dirSize']['params']): Promise<FsServiceMethods['dirSize']['result']> {
    let totalSize = 0
    let fileCount = 0
    let dirCount = 0

    const processDir = async (dirPath: string) => {
      const entries = (await this.fs.readdir(dirPath)) as string[]

      for (const entry of entries) {
        const entryPath = `${dirPath}/${entry}`
        const stat = await this.fs.stat(entryPath)

        if (stat.isDirectory()) {
          dirCount++
          await processDir(entryPath)
        } else {
          fileCount++
          totalSize += stat.size
        }
      }
    }

    await processDir(path)

    return { totalSize, fileCount, dirCount }
  }

  // ---------------------------------------------------------------------------
  // Utility Operation Handlers
  // ---------------------------------------------------------------------------

  private async handleChecksum({
    path,
    algorithm,
  }: FsServiceMethods['checksum']['params']): Promise<FsServiceMethods['checksum']['result']> {
    const data = (await this.fs.read(path)) as Uint8Array
    const alg = algorithm ?? 'sha256'

    let hashBuffer: ArrayBuffer
    if (alg === 'sha256') {
      hashBuffer = await crypto.subtle.digest('SHA-256', data)
    } else {
      // MD5 is not available in Web Crypto - would need a polyfill
      throw Object.assign(new Error('MD5 not supported'), { code: 'UNSUPPORTED_ALGORITHM' })
    }

    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const checksum = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

    return { checksum, algorithm: alg, size: data.length }
  }

  private async handleVerify({
    path,
    expectedChecksum,
    algorithm,
  }: FsServiceMethods['verify']['params']): Promise<FsServiceMethods['verify']['result']> {
    const result = await this.handleChecksum({ path, algorithm })
    return {
      valid: result.checksum === expectedChecksum.toLowerCase(),
      actualChecksum: result.checksum,
    }
  }

  private handlePing(): FsServiceMethods['ping']['result'] {
    return { ok: true, timestamp: Date.now(), version: this.version }
  }

  /**
   * Clean up expired sessions (call periodically)
   *
   * @param maxAgeMs - Maximum session age in milliseconds (default: 5 minutes)
   */
  cleanupSessions(maxAgeMs: number = 5 * 60 * 1000): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > maxAgeMs) {
        this.sessions.delete(id)
      }
    }
  }
}

// =============================================================================
// Type Aliases
// =============================================================================

/**
 * Filesystem interface required by FsServiceHandler
 */
export interface FsServiceFs {
  read(path: string, options?: ReadOptions): Promise<string | Uint8Array>
  write(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  stat(path: string): Promise<Stats>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | unknown[]>
  copyFile(src: string, dest: string, options?: { overwrite?: boolean }): Promise<void>
  rename(oldPath: string, newPath: string, options?: { overwrite?: boolean }): Promise<void>
  getTier?(path: string): Promise<StorageTier>
}

/**
 * Cloudflare Workers Service binding type
 */
interface Service {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}
