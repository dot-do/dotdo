/**
 * fsx/do - Durable Object filesystem integration
 *
 * This module provides filesystem capabilities for Cloudflare Durable Objects:
 *
 * - FsModule: Standalone filesystem module with lazy initialization
 * - withFs: Mixin function to add $.fs capability to DO classes
 * - FileSystemDO: Complete Durable Object with HTTP API
 *
 * ## Architecture
 *
 * FileSystemDO is a thin HTTP/RPC wrapper around FsModule. All filesystem
 * logic is implemented in FsModule to avoid code duplication. This separation
 * provides:
 *
 * - FsModule: Core filesystem operations, transactions, tiered storage
 * - FileSystemDO: HTTP API layer using Hono, streaming endpoints
 *
 * @example
 * ```typescript
 * // Using FsModule directly
 * import { FsModule } from 'fsx/do'
 *
 * const fs = new FsModule({ sql: ctx.storage.sql })
 * await fs.initialize()
 * await fs.write('/config.json', JSON.stringify(config))
 * ```
 *
 * @example
 * ```typescript
 * // Using withFs mixin with dotdo
 * import { withFs } from 'fsx/do'
 * import { DO } from 'dotdo'
 *
 * class MySite extends withFs(DO) {
 *   async loadContent() {
 *     return this.$.fs.read('/content/index.mdx', { encoding: 'utf-8' })
 *   }
 * }
 * ```
 *
 * @module fsx/do
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import { FsModule } from './module.js'
import type { Dirent, BufferEncoding } from '../core/index.js'
import { SubscriptionManager, BatchEmitter, createWatchEvent, type WatchEvent } from '../core/watch/index.js'

// ===========================================================================
// Stream Read Utilities
// ===========================================================================

/**
 * Result of parsing an HTTP Range header
 */
interface ParsedRange {
  start: number
  end: number
}

/**
 * Parse HTTP Range header (RFC 7233)
 *
 * Supports formats:
 * - bytes=0-499 (first 500 bytes)
 * - bytes=500-999 (second 500 bytes)
 * - bytes=-500 (last 500 bytes)
 * - bytes=500- (from byte 500 to end)
 *
 * @param rangeHeader - The Range header value
 * @param fileSize - Total file size in bytes
 * @returns Parsed range or null if invalid/unsatisfiable
 */
function parseRangeHeader(rangeHeader: string, fileSize: number): ParsedRange | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null

  const startStr = match[1] ?? ''
  const endStr = match[2] ?? ''
  let start: number
  let end: number

  if (startStr === '' && endStr !== '') {
    // "bytes=-N" means last N bytes
    const n = parseInt(endStr, 10)
    start = Math.max(0, fileSize - n)
    end = fileSize - 1
  } else if (startStr !== '' && endStr === '') {
    // "bytes=N-" means from N to end
    start = parseInt(startStr, 10)
    end = fileSize - 1
  } else {
    // "bytes=start-end"
    start = parseInt(startStr, 10)
    end = parseInt(endStr, 10)
  }

  // Validate range
  if (start < 0 || end < start || start >= fileSize) {
    return null
  }

  // Clamp end to file size
  end = Math.min(end, fileSize - 1)

  return { start, end }
}

/**
 * Common MIME types by file extension
 */
const MIME_TYPES: Record<string, string> = {
  json: 'application/json',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  mjs: 'application/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  md: 'text/markdown',
  mdx: 'text/mdx',
  wasm: 'application/wasm',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

/**
 * Infer Content-Type from file path extension
 *
 * @param path - File path
 * @returns MIME type string
 */
function inferContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  return MIME_TYPES[ext ?? ''] ?? 'application/octet-stream'
}

/**
 * Generate ETag from file size and modification time
 *
 * @param size - File size in bytes
 * @param mtime - Modification timestamp (ms since epoch)
 * @returns ETag string
 */
function generateETag(size: number, mtime: number): string {
  return `"${size}-${mtime}"`
}

// Re-export FsModule and related types for fsx/do entry point
export { FsModule, type FsModuleConfig } from './module.js'
export { withFs, hasFs, getFs, type WithFsContext, type WithFsOptions, type WithFsDO } from './mixin.js'

// Re-export security module for path validation
export {
  PathValidator,
  pathValidator,
  SecurityConstants,
  type ValidationResult,
  type ValidationSuccess,
  type ValidationFailure,
} from './security.js'

// Re-export CloudflareContainerExecutor and related types for fsx/do entry point
export {
  CloudflareContainerExecutor,
  createContainerExecutor,
  createIsolatedExecutor,
  type ContainerBinding,
  type ContainerInstance,
  type ContainerExecutorConfig,
  type ContainerExecResult,
  type ExecOptions,
  type StreamingExecEvent,
  type StreamingExecSession,
  type ContainerState,
  type HasContainerExecutor,
  type WithExecContext,
} from './container-executor.js'

interface Env {
  FSX: DurableObjectNamespace
  R2?: R2Bucket
  ARCHIVE?: R2Bucket
}

/**
 * Stats-like object for HTTP API responses (plain object, not class instances)
 */
interface StatsResponse {
  dev: number
  ino: number
  mode: number
  nlink: number
  uid: number
  gid: number
  rdev: number
  size: number
  blksize: number
  blocks: number
  atime: number
  mtime: number
  ctime: number
  birthtime: number
}

/**
 * Dirent-like response for HTTP API (serializable)
 */
interface DirentResponse {
  name: string
  parentPath: string
  path: string
  type: 'file' | 'directory' | 'symlink'
}

// ===========================================================================
// WebSocket Watch Types and Constants
// ===========================================================================

/**
 * WebSocket connection states following the WebSocket specification
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
 */
export const enum WebSocketState {
  /** Connection not yet established */
  CONNECTING = 0,
  /** Connection established and ready for communication */
  OPEN = 1,
  /** Connection is going through closing handshake */
  CLOSING = 2,
  /** Connection is closed or couldn't be opened */
  CLOSED = 3,
}

/**
 * Default configuration values for WebSocket heartbeat and timeouts
 */
export const WebSocketDefaults = {
  /** Heartbeat interval in milliseconds (30 seconds) */
  HEARTBEAT_INTERVAL_MS: 30_000,
  /** Connection timeout for stale connections in milliseconds (90 seconds - 3 missed heartbeats) */
  CONNECTION_TIMEOUT_MS: 90_000,
  /** Grace period for reconnection attempts in milliseconds (5 seconds) */
  RECONNECT_GRACE_PERIOD_MS: 5_000,
  /** Maximum number of missed pongs before considering connection stale */
  MAX_MISSED_PONGS: 3,
} as const

/**
 * Metadata attached to WebSocket connections for file watching
 *
 * This interface tracks all connection-related information including
 * heartbeat state, activity timestamps, and watch configuration.
 *
 * @example
 * ```typescript
 * const metadata: WatchConnectionMetadata = {
 *   path: '/home/user',
 *   recursive: true,
 *   connectedAt: Date.now(),
 *   lastActivity: Date.now(),
 *   lastPingSent: null,
 *   missedPongs: 0,
 *   state: WebSocketState.OPEN,
 *   clientId: 'client-abc123',
 * }
 * ```
 */
interface WatchConnectionMetadata {
  /** Path being watched */
  path: string
  /** Whether to watch subdirectories recursively */
  recursive: boolean
  /** Connection timestamp (when WebSocket was established) */
  connectedAt: number
  /** Last activity timestamp (last message sent or received) */
  lastActivity: number
  /** Timestamp of last ping sent to client, null if no pending ping */
  lastPingSent: number | null
  /** Count of consecutive missed pong responses */
  missedPongs: number
  /** Current connection state */
  state: WebSocketState
  /** Optional client identifier for reconnection support */
  clientId?: string
}

/**
 * Watch event sent to WebSocket clients when file system changes occur
 *
 * Events follow a consistent structure with type, path, and timestamp.
 * Rename events include the previous path via `oldPath`.
 *
 * @example
 * ```typescript
 * // File modification event
 * const modifyEvent: WatchEvent = {
 *   type: 'modify',
 *   path: '/home/user/document.txt',
 *   timestamp: Date.now(),
 * }
 *
 * // File rename event
 * const renameEvent: WatchEvent = {
 *   type: 'rename',
 *   path: '/home/user/new-name.txt',
 *   oldPath: '/home/user/old-name.txt',
 *   timestamp: Date.now(),
 * }
 * ```
 */
interface WatchEvent {
  /** Event type indicating the kind of file system change */
  type: 'create' | 'modify' | 'delete' | 'rename'
  /** Affected path (new path for renames) */
  path: string
  /** Previous path (only present for rename events) */
  oldPath?: string
  /** Event timestamp in milliseconds since epoch */
  timestamp: number
}

/**
 * Server-to-client heartbeat ping message
 *
 * Sent periodically by the server to verify connection liveness.
 * Client should respond with a pong message containing the same timestamp.
 */
interface HeartbeatPingMessage {
  /** Message type identifier */
  type: 'ping'
  /** Timestamp when ping was sent */
  timestamp: number
}

/**
 * Client-to-server heartbeat pong response
 *
 * Sent by client in response to a ping message.
 * Should include the original timestamp from the ping.
 */
interface HeartbeatPongMessage {
  /** Message type identifier */
  type: 'pong'
  /** Original timestamp from the ping message */
  timestamp: number
}

/**
 * Client-to-server subscription update message
 *
 * Allows client to change the watched path without reconnecting.
 */
interface SubscribeMessage {
  /** Message type identifier */
  type: 'subscribe'
  /** New path to watch */
  path: string
  /** Whether to watch recursively */
  recursive?: boolean
}

/**
 * Server-to-client subscription confirmation
 */
interface SubscribedMessage {
  /** Message type identifier */
  type: 'subscribed'
  /** Path that is now being watched */
  path: string
}

/**
 * Client-to-server unsubscribe message
 */
interface UnsubscribeMessage {
  /** Message type identifier */
  type: 'unsubscribe'
}

/**
 * Server-to-client unsubscribe confirmation
 */
interface UnsubscribedMessage {
  /** Message type identifier */
  type: 'unsubscribed'
}

/**
 * Server-to-client error message
 */
interface ErrorMessage {
  /** Message type identifier */
  type: 'error'
  /** Error description */
  message: string
  /** Optional error code */
  code?: string
}

/**
 * Server-to-client welcome message sent on connection establishment
 *
 * Contains connection metadata and server configuration.
 */
interface WelcomeMessage {
  /** Message type identifier */
  type: 'welcome'
  /** Assigned connection ID */
  connectionId: string
  /** Server heartbeat interval in milliseconds */
  heartbeatInterval: number
  /** Server connection timeout in milliseconds */
  connectionTimeout: number
  /** Timestamp of connection establishment */
  connectedAt: number
}

/**
 * Union type for all WebSocket messages
 */
type WebSocketMessage =
  | HeartbeatPingMessage
  | HeartbeatPongMessage
  | SubscribeMessage
  | SubscribedMessage
  | UnsubscribeMessage
  | UnsubscribedMessage
  | ErrorMessage
  | WelcomeMessage
  | WatchEvent

/**
 * FileSystemDO - Durable Object for filesystem operations
 *
 * This class provides an HTTP/RPC API layer on top of FsModule.
 * All filesystem logic is delegated to FsModule to avoid code duplication.
 *
 * ## Endpoints
 *
 * - POST /rpc - JSON-RPC endpoint for filesystem operations
 * - POST /stream/read - Streaming file read with HTTP caching and range support
 * - POST /stream/write - Streaming file write
 * - GET /watch - WebSocket endpoint for file change notifications
 *
 * ## WebSocket Features
 *
 * The /watch endpoint supports:
 * - **Heartbeat/ping-pong**: Server sends periodic pings to verify connection liveness
 * - **Connection state tracking**: Tracks connecting, open, closing, closed states
 * - **Stale connection cleanup**: Automatically closes connections that miss heartbeats
 * - **Reconnection support**: Clients can reconnect with same clientId to resume
 * - **Activity tracking**: Monitors last message time for each connection
 *
 * ## WebSocket Protocol
 *
 * Messages are JSON objects with a `type` field:
 * - `ping/pong`: Heartbeat messages (server->client ping, client->server pong)
 * - `subscribe`: Change watched path without reconnecting
 * - `unsubscribe`: Stop watching
 * - `welcome`: Sent on connection with server configuration
 * - `error`: Error notifications
 * - Watch events: `create`, `modify`, `delete`, `rename`
 *
 * @example
 * ```typescript
 * // RPC call example
 * const response = await fetch(doStub, {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     method: 'readFile',
 *     params: { path: '/config.json', encoding: 'utf-8' }
 *   })
 * })
 * const { data } = await response.json()
 * ```
 *
 * @example
 * ```typescript
 * // WebSocket watch example with heartbeat handling
 * const ws = new WebSocket('wss://fsx.do/watch?path=/home/user&recursive=true')
 *
 * ws.onmessage = (event) => {
 *   const msg = JSON.parse(event.data)
 *   switch (msg.type) {
 *     case 'welcome':
 *       console.log(`Connected: ${msg.connectionId}`)
 *       break
 *     case 'ping':
 *       // Respond to heartbeat
 *       ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }))
 *       break
 *     case 'create':
 *     case 'modify':
 *     case 'delete':
 *     case 'rename':
 *       console.log(`${msg.type}: ${msg.path}`)
 *       break
 *   }
 * }
 * ```
 */
/**
 * Configuration constants for WebSocket watch optimization
 */
const WatchConfig = {
  /** Maximum number of watch connections per DO instance */
  MAX_CONNECTIONS: 1000,
  /** Maximum subscriptions per connection (0 = unlimited) */
  MAX_SUBSCRIPTIONS_PER_CONNECTION: 100,
  /** Batch window in milliseconds for event coalescing */
  BATCH_WINDOW_MS: 10,
  /** Maximum events in a single batch before forced flush */
  MAX_BATCH_SIZE: 50,
} as const

export class FileSystemDO extends DurableObject<Env> {
  private app: Hono
  private fsModule: FsModule
  /**
   * Subscription manager for WebSocket file watching
   * Uses glob pattern matching to efficiently manage subscribers.
   */
  private subscriptionManager: SubscriptionManager
  /**
   * Batch emitter for event coalescing
   * Reduces WebSocket message overhead by batching rapid events.
   */
  private batchEmitter: BatchEmitter
  /**
   * Active WebSocket connections for file watching
   *
   * Maps WebSocket instances to their connection metadata including
   * heartbeat state, activity timestamps, and watch configuration.
   */
  private watchConnections: Map<WebSocket, WatchConnectionMetadata> = new Map()

  /**
   * Counter for generating unique connection IDs
   * @internal
   */
  private connectionIdCounter = 0

  /**
   * Flag indicating whether heartbeat alarm is scheduled
   * @internal
   */
  private heartbeatAlarmScheduled = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Create SubscriptionManager for watch subscriptions with connection limits
    this.subscriptionManager = new SubscriptionManager({
      maxSubscriptionsPerConnection: WatchConfig.MAX_SUBSCRIPTIONS_PER_CONNECTION,
    })

    // Create BatchEmitter for event coalescing
    this.batchEmitter = new BatchEmitter({
      batchWindowMs: WatchConfig.BATCH_WINDOW_MS,
      maxBatchSize: WatchConfig.MAX_BATCH_SIZE,
      compressEvents: true,
      prioritizeEvents: true,
      enableMetrics: true,
    })

    // Wire batch emitter to broadcast events
    this.batchEmitter.onBatch((events) => {
      for (const event of events) {
        this.broadcastWatchEventImmediate(event)
      }
    })

    // Create FsModule with storage configuration
    this.fsModule = new FsModule({
      sql: ctx.storage.sql,
      r2: env.R2,
      archive: env.ARCHIVE,
    })

    this.app = this.createApp()
  }

  /**
   * Generate a unique connection ID for WebSocket tracking
   *
   * @returns Unique connection identifier string
   * @internal
   */
  private generateConnectionId(): string {
    return `conn-${Date.now()}-${++this.connectionIdCounter}`
  }

  /**
   * Schedule the next heartbeat alarm if not already scheduled
   *
   * Uses Durable Object alarms to periodically check connection health
   * and send ping messages to clients.
   *
   * @internal
   */
  private async scheduleHeartbeatAlarm(): Promise<void> {
    if (this.heartbeatAlarmScheduled || this.watchConnections.size === 0) {
      return
    }

    const currentAlarm = await this.ctx.storage.getAlarm()
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(Date.now() + WebSocketDefaults.HEARTBEAT_INTERVAL_MS)
      this.heartbeatAlarmScheduled = true
    }
  }

  /**
   * Handle Durable Object alarm for heartbeat processing
   *
   * This method is called by the Durable Objects runtime when an alarm fires.
   * It sends ping messages to all active connections and cleans up stale ones.
   */
  async alarm(): Promise<void> {
    this.heartbeatAlarmScheduled = false
    const now = Date.now()

    // Process each connection
    for (const [ws, metadata] of this.watchConnections) {
      // Check for stale connections (missed too many pongs)
      if (metadata.missedPongs >= WebSocketDefaults.MAX_MISSED_PONGS) {
        // Connection is stale - close it
        this.closeStaleConnection(ws, metadata, 'Too many missed heartbeats')
        continue
      }

      // Check for connection timeout based on last activity
      const timeSinceActivity = now - metadata.lastActivity
      if (timeSinceActivity > WebSocketDefaults.CONNECTION_TIMEOUT_MS) {
        this.closeStaleConnection(ws, metadata, 'Connection timeout - no activity')
        continue
      }

      // Send ping to active connections
      if (metadata.state === WebSocketState.OPEN) {
        try {
          const pingMessage: HeartbeatPingMessage = {
            type: 'ping',
            timestamp: now,
          }
          ws.send(JSON.stringify(pingMessage))
          metadata.lastPingSent = now
          metadata.missedPongs++
        } catch {
          // Failed to send - connection may be broken
          this.watchConnections.delete(ws)
        }
      }
    }

    // Schedule next heartbeat if we still have connections
    if (this.watchConnections.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + WebSocketDefaults.HEARTBEAT_INTERVAL_MS)
      this.heartbeatAlarmScheduled = true
    }
  }

  /**
   * Close a stale WebSocket connection with proper cleanup
   *
   * @param ws - WebSocket to close
   * @param metadata - Connection metadata
   * @param reason - Reason for closing
   * @internal
   */
  private closeStaleConnection(ws: WebSocket, metadata: WatchConnectionMetadata, reason: string): void {
    metadata.state = WebSocketState.CLOSING
    try {
      // Send error message before closing
      ws.send(
        JSON.stringify({
          type: 'error',
          message: reason,
          code: 'CONNECTION_STALE',
        } as ErrorMessage)
      )
      // Close with policy violation code (1008) for stale connections
      ws.close(1008, reason)
    } catch {
      // Connection already broken - just clean up
    }
    this.watchConnections.delete(ws)
  }

  /**
   * Get watch system metrics
   *
   * Returns metrics about connections, subscriptions, and event batching.
   * Useful for monitoring and debugging watch system performance.
   *
   * @returns Object containing watch metrics
   */
  getWatchMetrics(): {
    connections: number
    subscriptions: number
    batchMetrics: {
      eventsReceived: number
      eventsEmitted: number
      batchesEmitted: number
      compressionRatio: number
      eventsPerSecond: number
    }
  } {
    const batchMetrics = this.batchEmitter.getMetrics()
    return {
      connections: this.watchConnections.size,
      subscriptions: this.subscriptionManager.getConnectionCount(),
      batchMetrics: {
        eventsReceived: batchMetrics.eventsReceived,
        eventsEmitted: batchMetrics.eventsEmitted,
        batchesEmitted: batchMetrics.batchesEmitted,
        compressionRatio: batchMetrics.compressionRatio,
        eventsPerSecond: batchMetrics.eventsPerSecond,
      },
    }
  }

  private createApp(): Hono {
    const app = new Hono()

    // RPC endpoint - delegates to FsModule
    app.post('/rpc', async (c) => {
      const { method, params } = await c.req.json<{ method: string; params: Record<string, unknown> }>()

      try {
        const result = await this.handleMethod(method, params)
        return c.json(result)
      } catch (error: unknown) {
        const fsError = error as { code?: string; message?: string; path?: string }
        return c.json(
          { code: fsError.code || 'UNKNOWN', message: fsError.message, path: fsError.path },
          fsError.code === 'ENOENT' ? 404 : 400
        )
      }
    })

    // Streaming read with HTTP caching and range support
    app.post('/stream/read', async (c) => {
      return this.handleStreamRead(c)
    })

    // Streaming write - optimized for large files
    app.post('/stream/write', async (c) => {
      const path = c.req.header('X-FSx-Path')
      const optionsHeader = c.req.header('X-FSx-Options')

      if (!path) {
        return c.json({ code: 'EINVAL', message: 'path required' }, 400)
      }

      try {
        const options = optionsHeader ? JSON.parse(optionsHeader) : {}
        // Check if file exists before write to determine event type
        const existed = await this.fsModule.exists(path)
        const data = await c.req.arrayBuffer()
        await this.fsModule.write(path, new Uint8Array(data), options)
        // Emit watch event
        const eventType = existed ? 'modify' : 'create'
        this.broadcastWatchEvent(createWatchEvent(eventType, path, {
          size: data.byteLength,
        }))
        return c.json({ success: true })
      } catch (error: unknown) {
        const fsError = error as { code?: string; message?: string; path?: string }
        return c.json(
          { code: fsError.code || 'UNKNOWN', message: fsError.message, path: fsError.path },
          fsError.code === 'ENOENT' ? 404 : 400
        )
      }
    })

    // WebSocket endpoint for file watching
    // Note: This route returns early with a special response that tells
    // fetch() to handle WebSocket upgrade. The actual WebSocket handling
    // is done in the fetch() method override below.
    app.get('/watch', async (_c) => {
      // This endpoint requires WebSocket upgrade - return marker response
      // The actual WebSocket upgrade is handled in the fetch() method
      return new Response(null, {
        status: 101,
        headers: { 'X-FSx-WebSocket': 'watch' },
      })
    })

    return app
  }

  /**
   * Handle streaming read requests with full HTTP semantics
   *
   * Features:
   * - Content-Type inference from file extension
   * - ETag and Last-Modified caching headers
   * - Conditional request support (If-None-Match, If-Match)
   * - HTTP Range header support for partial content (206)
   * - Accept-Ranges header for range request discovery
   */
  private async handleStreamRead(c: {
    req: {
      json: <T>() => Promise<T>
      header: (name: string) => string | undefined
    }
    json: (body: unknown, status?: number) => Response
  }): Promise<Response> {
    // 1. Parse request body
    let body: { path?: string }
    try {
      body = await c.req.json<{ path?: string }>()
    } catch {
      return c.json({ code: 'EINVAL', message: 'invalid JSON body' }, 400)
    }

    const path = body.path
    if (!path) {
      return c.json({ code: 'EINVAL', message: 'path is required' }, 400)
    }

    // 2. Get file stats for headers and validation
    let stats: StatsResponse
    try {
      const rawStats = await this.fsModule.stat(path)
      stats = this.statsToResponse(rawStats)
    } catch (error: unknown) {
      const fsError = error as { code?: string; message?: string; path?: string }
      return c.json(
        { code: fsError.code || 'UNKNOWN', message: fsError.message, path: fsError.path },
        fsError.code === 'ENOENT' ? 404 : 400
      )
    }

    // 3. Generate caching headers
    const fileSize = stats.size
    const contentType = inferContentType(path)
    const etag = generateETag(fileSize, stats.mtime)
    const lastModified = new Date(stats.mtime).toUTCString()

    // 4. Handle conditional requests
    const ifMatch = c.req.header('If-Match')
    if (ifMatch && ifMatch !== etag && ifMatch !== '*') {
      return new Response(null, {
        status: 412, // Precondition Failed
        headers: { ETag: etag, 'Last-Modified': lastModified },
      })
    }

    const ifNoneMatch = c.req.header('If-None-Match')
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
      return new Response(null, {
        status: 304, // Not Modified
        headers: { ETag: etag, 'Last-Modified': lastModified },
      })
    }

    // 5. Base response headers
    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Last-Modified': lastModified,
    }

    // 6. Handle Range header for partial content
    const rangeHeader = c.req.header('Range')
    if (rangeHeader) {
      const range = parseRangeHeader(rangeHeader, fileSize)

      if (!range) {
        // Invalid or unsatisfiable range
        return new Response(null, {
          status: 416, // Range Not Satisfiable
          headers: {
            ...responseHeaders,
            'Content-Range': `bytes */${fileSize}`,
          },
        })
      }

      // Read partial content
      try {
        const data = await this.fsModule.read(path, { start: range.start, end: range.end })
        const content = typeof data === 'string' ? new TextEncoder().encode(data) : data

        return new Response(content, {
          status: 206, // Partial Content
          headers: {
            ...responseHeaders,
            'Content-Length': String(content.length),
            'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`,
          },
        })
      } catch (error: unknown) {
        const fsError = error as { code?: string; message?: string; path?: string }
        return c.json(
          { code: fsError.code || 'UNKNOWN', message: fsError.message, path: fsError.path },
          fsError.code === 'ENOENT' ? 404 : 400
        )
      }
    }

    // 7. Full content response
    try {
      const data = await this.fsModule.read(path)
      const content = typeof data === 'string' ? new TextEncoder().encode(data) : data

      return new Response(content, {
        status: 200,
        headers: {
          ...responseHeaders,
          'Content-Length': String(content.length),
        },
      })
    } catch (error: unknown) {
      const fsError = error as { code?: string; message?: string; path?: string }
      return c.json(
        { code: fsError.code || 'UNKNOWN', message: fsError.message, path: fsError.path },
        fsError.code === 'ENOENT' ? 404 : 400
      )
    }
  }

  /**
   * Handle RPC method calls by delegating to FsModule
   */
  private async handleMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'readFile':
        return this.handleReadFile(params.path as string, params.encoding as BufferEncoding | undefined)

      case 'writeFile': {
        let data = params.data as string | Uint8Array
        // Handle base64 encoding - decode before writing
        if (params.encoding === 'base64' && typeof data === 'string') {
          const binary = atob(data)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
          }
          data = bytes
        }
        const path = params.path as string
        // Check if file exists before write to determine event type
        const existed = await this.fsModule.exists(path)
        await this.fsModule.write(path, data, params)
        // Emit watch event
        const eventType = existed ? 'modify' : 'create'
        this.broadcastWatchEvent(createWatchEvent(eventType, path, {
          size: typeof data === 'string' ? data.length : data.byteLength,
        }))
        return { success: true }
      }

      case 'unlink': {
        const path = params.path as string
        await this.fsModule.unlink(path)
        // Emit delete event
        this.broadcastWatchEvent(createWatchEvent('delete', path))
        return { success: true }
      }

      case 'rename': {
        const oldPath = params.oldPath as string
        const newPath = params.newPath as string
        await this.fsModule.rename(oldPath, newPath, params)
        // Emit rename event
        this.broadcastWatchEvent(createWatchEvent('rename', oldPath, newPath))
        return { success: true }
      }

      case 'copyFile': {
        const dest = params.dest as string
        await this.fsModule.copyFile(params.src as string, dest, params)
        // Emit create event for the destination
        this.broadcastWatchEvent(createWatchEvent('create', dest))
        return { success: true }
      }

      case 'mkdir': {
        const path = params.path as string
        await this.fsModule.mkdir(path, params as { recursive?: boolean; mode?: number })
        // Emit create event for directory
        this.broadcastWatchEvent(createWatchEvent('create', path, { isDirectory: true }))
        return { success: true }
      }

      case 'rmdir': {
        const path = params.path as string
        await this.fsModule.rmdir(path, params as { recursive?: boolean })
        // Emit delete event for directory
        this.broadcastWatchEvent(createWatchEvent('delete', path, { isDirectory: true }))
        return { success: true }
      }

      case 'rm': {
        const path = params.path as string
        await this.fsModule.rm(path, params as { recursive?: boolean; force?: boolean })
        // Emit delete event
        this.broadcastWatchEvent(createWatchEvent('delete', path))
        return { success: true }
      }

      case 'readdir':
        return this.handleReaddir(params.path as string, params as { withFileTypes?: boolean; recursive?: boolean })

      case 'stat':
        return this.handleStat(params.path as string, false)

      case 'lstat':
        return this.handleStat(params.path as string, true)

      case 'access':
        await this.fsModule.access(params.path as string, params.mode as number)
        return { success: true }

      case 'chmod':
        await this.fsModule.chmod(params.path as string, params.mode as number)
        return { success: true }

      case 'chown':
        await this.fsModule.chown(params.path as string, params.uid as number, params.gid as number)
        return { success: true }

      case 'symlink':
        await this.fsModule.symlink(params.target as string, params.path as string)
        return { success: true }

      case 'link':
        await this.fsModule.link(params.existingPath as string, params.newPath as string)
        return { success: true }

      case 'readlink':
        return { target: await this.fsModule.readlink(params.path as string) }

      case 'realpath':
        return { path: await this.fsModule.realpath(params.path as string) }

      case 'truncate':
        await this.fsModule.truncate(params.path as string, params.length as number)
        return { success: true }

      case 'utimes':
        await this.fsModule.utimes(params.path as string, params.atime as number | Date, params.mtime as number | Date)
        return { success: true }

      case 'exists':
        return { exists: await this.fsModule.exists(params.path as string) }

      case 'getTier':
        return { tier: await this.fsModule.getTier(params.path as string) }

      case 'promote':
        await this.fsModule.promote(params.path as string, params.tier as 'hot' | 'warm')
        return { success: true }

      case 'demote':
        await this.fsModule.demote(params.path as string, params.tier as 'warm' | 'cold')
        return { success: true }

      // Blob management methods
      case 'getBlobInfo':
        // Support both path-based and blobId-based lookup
        if (params.path) {
          const info = await this.fsModule.getBlobInfoByPath(params.path as string)
          if (!info) {
            throw Object.assign(new Error('File not found or has no blob'), { code: 'ENOENT', path: params.path })
          }
          return info
        } else if (params.blobId) {
          const info = await this.fsModule.getBlobInfo(params.blobId as string)
          if (!info) {
            throw Object.assign(new Error('Blob not found'), { code: 'ENOENT' })
          }
          return info
        }
        throw Object.assign(new Error('path or blobId required'), { code: 'EINVAL' })

      case 'getBlobById': {
        const blobResult = await this.fsModule.getBlobById(params.blobId as string)
        if (!blobResult) {
          throw Object.assign(new Error('Blob not found'), { code: 'ENOENT' })
        }
        // Convert data to base64 for JSON transport
        const bytes = blobResult.data
        let binary = ''
        for (const byte of bytes) {
          binary += String.fromCharCode(byte)
        }
        return {
          ...blobResult,
          data: btoa(binary),
        }
      }

      case 'verifyBlobIntegrity': {
        // Support path-based lookup
        if (params.path) {
          const info = await this.fsModule.getBlobInfoByPath(params.path as string)
          if (!info) {
            throw Object.assign(new Error('File not found or has no blob'), { code: 'ENOENT', path: params.path })
          }
          return await this.fsModule.verifyBlobIntegrity(info.blobId)
        }
        return await this.fsModule.verifyBlobIntegrity(params.blobId as string)
      }

      case 'verifyChecksum': {
        // Support path-based lookup
        if (params.path) {
          const info = await this.fsModule.getBlobInfoByPath(params.path as string)
          if (!info) {
            throw Object.assign(new Error('File not found or has no blob'), { code: 'ENOENT', path: params.path })
          }
          const expectedChecksum = params.expectedChecksum as string
          return {
            valid: info.checksum === expectedChecksum,
            actualChecksum: info.checksum,
          }
        }
        return { valid: await this.fsModule.verifyChecksum(params.checksum as string, params.content as string | Uint8Array) }
      }

      case 'listOrphanedBlobs': {
        const orphans = await this.fsModule.listOrphanedBlobs()
        return { orphans, count: orphans.length }
      }

      case 'cleanupOrphanedBlobs': {
        // Get tier stats before cleanup to calculate freed bytes
        const statsBefore = await this.fsModule.getTierStats()
        const totalSizeBefore = statsBefore.hot.totalSize + statsBefore.warm.totalSize + statsBefore.cold.totalSize

        const cleaned = await this.fsModule.cleanupOrphanedBlobs()

        const statsAfter = await this.fsModule.getTierStats()
        const totalSizeAfter = statsAfter.hot.totalSize + statsAfter.warm.totalSize + statsAfter.cold.totalSize

        return { cleaned, freedBytes: totalSizeBefore - totalSizeAfter }
      }

      case 'getTierStats': {
        const stats = await this.fsModule.getTierStats()
        return {
          hot: { count: stats.hot.count, size: stats.hot.totalSize },
          warm: { count: stats.warm.count, size: stats.warm.totalSize },
          cold: { count: stats.cold.count, size: stats.cold.totalSize },
        }
      }

      case 'getDedupStats': {
        const stats = await this.fsModule.getDedupStats()
        // The tests expect different property names
        const tierStats = await this.fsModule.getTierStats()
        const totalPhysicalSize = tierStats.hot.totalSize + tierStats.warm.totalSize + tierStats.cold.totalSize
        const totalLogicalSize = totalPhysicalSize + stats.savedBytes
        return {
          ...stats,
          totalPhysicalSize,
          totalLogicalSize,
        }
      }

      case 'getBlobRefCount':
        return { refCount: await this.fsModule.getBlobRefCount(params.blobId as string) }

      default:
        throw new Error(`Unknown method: ${method}`)
    }
  }

  /**
   * Handle readFile with encoding support
   */
  private async handleReadFile(path: string, encoding?: BufferEncoding): Promise<{ data: string; encoding: string }> {
    const result = await this.fsModule.read(path, { encoding })

    if (typeof result === 'string') {
      return { data: result, encoding: encoding || 'utf-8' }
    }

    // Convert Uint8Array to base64 for JSON transport
    const bytes = result
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return { data: btoa(binary), encoding: 'base64' }
  }

  /**
   * Handle readdir with serializable response
   */
  private async handleReaddir(
    path: string,
    options: { withFileTypes?: boolean; recursive?: boolean }
  ): Promise<string[] | DirentResponse[]> {
    const result = await this.fsModule.readdir(path, options)

    if (options.withFileTypes) {
      // Convert Dirent objects to plain objects for JSON serialization
      return (result as Dirent[]).map(
        (entry): DirentResponse => ({
          name: entry.name,
          parentPath: entry.parentPath,
          path: entry.parentPath + '/' + entry.name,
          type: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'symlink',
        })
      )
    }

    return result as string[]
  }

  /**
   * Handle stat/lstat with serializable response
   */
  private async handleStat(path: string, noFollow: boolean): Promise<StatsResponse> {
    const stats = noFollow ? await this.fsModule.lstat(path) : await this.fsModule.stat(path)
    return this.statsToResponse(stats)
  }

  /**
   * Convert Stats object to serializable response
   */
  private statsToResponse(stats: {
    dev: number
    ino: number
    mode: number
    nlink: number
    uid: number
    gid: number
    rdev: number
    size: number
    blksize: number
    blocks: number
    atime: Date | number
    mtime: Date | number
    ctime: Date | number
    birthtime: Date | number
    atimeMs?: number
    mtimeMs?: number
    ctimeMs?: number
    birthtimeMs?: number
  }): StatsResponse {
    return {
      dev: stats.dev,
      ino: stats.ino,
      mode: stats.mode,
      nlink: stats.nlink,
      uid: stats.uid,
      gid: stats.gid,
      rdev: stats.rdev,
      size: stats.size,
      blksize: stats.blksize,
      blocks: stats.blocks,
      atime: stats.atimeMs ?? (stats.atime instanceof Date ? stats.atime.getTime() : stats.atime),
      mtime: stats.mtimeMs ?? (stats.mtime instanceof Date ? stats.mtime.getTime() : stats.mtime),
      ctime: stats.ctimeMs ?? (stats.ctime instanceof Date ? stats.ctime.getTime() : stats.ctime),
      birthtime: stats.birthtimeMs ?? (stats.birthtime instanceof Date ? stats.birthtime.getTime() : stats.birthtime),
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle WebSocket upgrade for /watch endpoint
    if (url.pathname === '/watch') {
      // Check if this is a WebSocket upgrade request
      const upgradeHeader = request.headers.get('Upgrade')

      if (upgradeHeader?.toLowerCase() !== 'websocket') {
        // Not a WebSocket upgrade request - return 426 Upgrade Required
        return new Response(
          JSON.stringify({
            code: 'UPGRADE_REQUIRED',
            message: 'WebSocket upgrade required for /watch endpoint',
          }),
          {
            status: 426,
            headers: {
              'Content-Type': 'application/json',
              Upgrade: 'websocket',
              Connection: 'Upgrade',
            },
          }
        )
      }

      // Parse watch parameters from query string
      const watchPath = url.searchParams.get('path')
      const recursive = url.searchParams.get('recursive') === 'true'

      // Validate path parameter
      if (!watchPath) {
        return new Response(
          JSON.stringify({
            code: 'EINVAL',
            message: 'path query parameter is required',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Validate path format
      if (!watchPath.startsWith('/')) {
        return new Response(
          JSON.stringify({
            code: 'EINVAL',
            message: 'path must be absolute (start with /)',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Check connection limit
      if (this.watchConnections.size >= WatchConfig.MAX_CONNECTIONS) {
        return new Response(
          JSON.stringify({
            code: 'ECONNREFUSED',
            message: `Connection limit reached (max ${WatchConfig.MAX_CONNECTIONS} connections)`,
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Accept the WebSocket connection using Durable Object API
      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]

      // Accept the server-side WebSocket
      this.ctx.acceptWebSocket(server)

      // Generate connection ID and timestamp
      const now = Date.now()
      const connectionId = this.generateConnectionId()

      // Store connection metadata for later event broadcasting
      const metadata: WatchConnectionMetadata = {
        path: watchPath,
        recursive,
        connectedAt: now,
        lastActivity: now,
        lastPingSent: null,
        missedPongs: 0,
        state: WebSocketState.OPEN,
        clientId: connectionId,
      }
      this.watchConnections.set(server, metadata)

      // Send welcome message with server configuration
      const welcomeMessage: WelcomeMessage = {
        type: 'welcome',
        connectionId,
        heartbeatInterval: WebSocketDefaults.HEARTBEAT_INTERVAL_MS,
        connectionTimeout: WebSocketDefaults.CONNECTION_TIMEOUT_MS,
        connectedAt: now,
      }
      server.send(JSON.stringify(welcomeMessage))

      // Schedule heartbeat alarm if not already scheduled
      void this.scheduleHeartbeatAlarm()

      // Return the client WebSocket as the upgrade response
      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    }

    // For all other requests, delegate to Hono app
    return this.app.fetch(request)
  }

  // ===========================================================================
  // WebSocket Lifecycle Handlers (Durable Object WebSocket API)
  // ===========================================================================

  /**
   * Handle incoming WebSocket messages
   *
   * Supports the following message types:
   * - `subscribe`: Change the watched path without reconnecting
   * - `unsubscribe`: Stop watching and disconnect
   * - `ping`: Client-initiated ping (server responds with pong)
   * - `pong`: Client response to server ping (resets heartbeat tracking)
   *
   * All messages update the connection's lastActivity timestamp for
   * timeout tracking purposes.
   *
   * @param ws - The WebSocket connection that sent the message
   * @param message - Raw message data (string or ArrayBuffer)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const metadata = this.watchConnections.get(ws)

    // Update last activity timestamp on any message
    if (metadata) {
      metadata.lastActivity = Date.now()
    }

    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const parsed = JSON.parse(data)

      switch (parsed.type) {
        case 'subscribe': {
          // Add subscription via SubscriptionManager
          if (parsed.path) {
            // Convert recursive flag to glob pattern if needed
            let pattern = parsed.path as string
            if (parsed.recursive && !pattern.includes('*')) {
              // Auto-append /** for recursive watching
              pattern = pattern.endsWith('/') ? `${pattern}**` : `${pattern}/**`
            }
            this.subscriptionManager.subscribe(ws, pattern)
            // Update metadata for backwards compatibility
            if (metadata) {
              metadata.path = pattern
              metadata.recursive = parsed.recursive ?? metadata.recursive
            }
          }
          ws.send(JSON.stringify({ type: 'subscribed', path: parsed.path }))
          break
        }

        case 'unsubscribe': {
          // Remove subscription via SubscriptionManager
          if (parsed.path) {
            let pattern = parsed.path as string
            // Try both with and without glob suffix
            this.subscriptionManager.unsubscribe(ws, pattern)
            if (!pattern.includes('*')) {
              this.subscriptionManager.unsubscribe(ws, `${pattern}/**`)
            }
          } else {
            // Remove all subscriptions for this connection
            this.subscriptionManager.removeConnection(ws)
          }
          // Only close connection if explicitly requested (no path = close)
          if (!parsed.path) {
            if (metadata) {
              metadata.state = WebSocketState.CLOSING
            }
            this.watchConnections.delete(ws)
          }
          ws.send(JSON.stringify({ type: 'unsubscribed', path: parsed.path }))
          break
        }

        case 'ping': {
          // Client-initiated ping - respond with pong
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
          break
        }

        case 'pong': {
          // Client response to server ping - reset heartbeat tracking
          if (metadata) {
            metadata.missedPongs = 0
            metadata.lastPingSent = null
          }
          // No response needed for pong
          break
        }

        default:
          // Unknown message type
          ws.send(
            JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${parsed.type}`,
            })
          )
      }
    } catch {
      // JSON parse error or other issue
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Invalid message format - expected JSON',
        })
      )
    }
  }

  /**
   * Handle WebSocket connection close
   *
   * Updates connection state and removes from active connections.
   * Called by the Durable Objects runtime when client closes connection.
   *
   * @param ws - The WebSocket connection that closed
   * @param code - WebSocket close code (e.g., 1000 for normal closure)
   * @param reason - Close reason string
   * @param wasClean - Whether the close was clean (TCP connection closed properly)
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const metadata = this.watchConnections.get(ws)
    if (metadata) {
      metadata.state = WebSocketState.CLOSED
    }
    // Remove from active connections
    this.watchConnections.delete(ws)
    // Remove all subscriptions for this connection
    this.subscriptionManager.removeConnection(ws)
  }

  /**
   * Handle WebSocket errors
   *
   * Logs the error and removes the connection from active set.
   * Called by the Durable Objects runtime when a WebSocket error occurs.
   *
   * @param ws - The WebSocket connection that errored
   * @param error - The error that occurred
   */
  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    const metadata = this.watchConnections.get(ws)
    if (metadata) {
      metadata.state = WebSocketState.CLOSED
    }
    // Remove from active connections on error
    this.watchConnections.delete(ws)
    // Remove all subscriptions for this connection
    this.subscriptionManager.removeConnection(ws)
  }

  // ===========================================================================
  // Watch Event Broadcasting
  // ===========================================================================

  /**
   * Broadcast a file change event to all watching connections
   *
   * This method is called internally when filesystem operations modify files.
   * It sends events only to connections that are watching the affected path.
   *
   * @param event - The watch event to broadcast
   */
  /**
   * Queue a watch event for batched broadcast
   *
   * Events are collected and coalesced by the BatchEmitter before being
   * sent to subscribers. This reduces WebSocket message overhead for
   * rapid file operations.
   *
   * @param event - The watch event to queue
   */
  broadcastWatchEvent(event: WatchEvent): void {
    // Queue through BatchEmitter for event coalescing
    this.batchEmitter.queue(event.type, event.path, event.oldPath, {
      size: event.size,
      mtime: event.mtime,
      isDirectory: event.isDirectory,
    })
  }

  /**
   * Immediately broadcast a watch event to all matching subscribers
   *
   * This is called by the BatchEmitter after coalescing events.
   * Uses SubscriptionManager for efficient glob pattern matching.
   *
   * @param event - The watch event to broadcast
   * @internal
   */
  private broadcastWatchEventImmediate(event: WatchEvent): void {
    // Use SubscriptionManager for efficient glob pattern matching
    const subscribers = this.subscriptionManager.getSubscribersForPath(event.path)

    for (const ws of subscribers) {
      try {
        ws.send(JSON.stringify(event))
      } catch {
        // Connection may be closed - will be cleaned up on next close event
      }
    }
  }

  /**
   * Check if an affected path matches a watch subscription
   *
   * @param affectedPath - The path that was modified
   * @param watchPath - The path being watched
   * @param recursive - Whether the watch is recursive
   * @returns true if the affected path matches the watch
   */
  private pathMatchesWatch(affectedPath: string, watchPath: string, recursive: boolean): boolean {
    // Normalize paths
    const normalizedAffected = affectedPath.replace(/\/+$/, '') || '/'
    const normalizedWatch = watchPath.replace(/\/+$/, '') || '/'

    // Exact match
    if (normalizedAffected === normalizedWatch) {
      return true
    }

    // Check if affected path is under the watch path
    if (recursive) {
      // Recursive: match any path under the watch path
      return normalizedAffected.startsWith(normalizedWatch + '/')
    } else {
      // Non-recursive: only match direct children
      const parentPath = normalizedAffected.substring(0, normalizedAffected.lastIndexOf('/')) || '/'
      return parentPath === normalizedWatch
    }
  }
}
