/**
 * Cap'n Web RPC Integration for ShellApi
 *
 * Registers ShellApiImpl with dotdo's Cap'n Web transport system.
 * This enables ShellApi to be called via Cap'n Web RPC with pass-by-reference
 * semantics for ShellStream objects.
 *
 * @packageDocumentation
 */

import { ShellApiImpl } from './shell-api-impl.js'
import { ShellStreamImpl } from './shell-stream-impl.js'
import type {
  ShellApi,
  ShellStream,
  ShellResult,
  ShellExecOptions,
  ShellSpawnOptions,
} from '../../core/rpc/types.js'

// ============================================================================
// RpcTarget Types (compatible with dotdo/rpc pattern)
// ============================================================================

/**
 * Method handler type for RPC methods.
 * Matches dotdo/rpc RpcMethodHandler signature.
 */
export type RpcMethodHandler = (...args: unknown[]) => Promise<unknown> | unknown

/**
 * RPC request format compatible with dotdo/rpc.
 */
export interface RpcRequest {
  /** Request identifier */
  id: string
  /** Method name to invoke */
  method: string
  /** Parameters to pass to the method */
  params: unknown[]
}

/**
 * RPC response format compatible with dotdo/rpc.
 */
export interface RpcResponse {
  /** Request identifier (matching the request) */
  id: string
  /** Result of the method invocation (on success) */
  result?: unknown
  /** Error message (on failure) */
  error?: string
}

/**
 * RPC batch response format.
 */
export interface RpcBatchResponse {
  /** Array of individual responses */
  results: RpcResponse[]
}

// ============================================================================
// RpcTarget Base Class
// ============================================================================

/**
 * Base class for RPC targets.
 *
 * Compatible with dotdo/rpc RpcTarget pattern. Provides method registration,
 * allowlist enforcement, and secure method invocation.
 *
 * @example
 * ```typescript
 * class MyApi extends RpcTarget {
 *   constructor() {
 *     super()
 *     this.allowedMethods.add('myMethod')
 *   }
 *
 *   async myMethod(arg: string): Promise<string> {
 *     return `Hello, ${arg}!`
 *   }
 * }
 * ```
 */
export class RpcTarget {
  protected allowedMethods = new Set<string>()
  private methodHandlers = new Map<string, RpcMethodHandler>()

  /**
   * Check if a method is allowed for RPC invocation.
   * @param name - Method name to check
   * @returns true if method is in the allowlist
   */
  hasMethod(name: string): boolean {
    return this.allowedMethods.has(name)
  }

  /**
   * Invoke a method by name with parameters.
   * @param method - Method name to invoke
   * @param params - Array of parameters to pass
   * @returns Promise resolving to the method result
   * @throws Error if method is not allowed or not found
   */
  async invoke(method: string, params: unknown[]): Promise<unknown> {
    if (!this.allowedMethods.has(method)) {
      throw new Error(`Method not allowed: ${method}`)
    }

    // First check if there's a registered handler
    const fn = this.methodHandlers.get(method)
    if (fn) {
      return await fn.apply(this, params)
    }

    // Then check if the method exists directly on the instance
    const instanceMethod = (this as unknown as Record<string, unknown>)[method]
    if (typeof instanceMethod === 'function') {
      return await instanceMethod.apply(this, params)
    }

    throw new Error(`Method not found: ${method}`)
  }

  /**
   * Register a method handler.
   * @param name - Method name to register
   * @param handler - Handler function
   */
  protected registerMethod(name: string, handler: RpcMethodHandler): void {
    this.allowedMethods.add(name)
    this.methodHandlers.set(name, handler)
  }
}

// ============================================================================
// ShellApiRpcTarget - RpcTarget-compatible wrapper for ShellApiImpl
// ============================================================================

/**
 * RpcTarget wrapper for ShellApiImpl.
 *
 * Extends RpcTarget to expose ShellApi methods via Cap'n Web RPC.
 * ShellStream objects returned by spawn() are passed by reference,
 * allowing clients to interact with the stream remotely.
 *
 * @example
 * ```typescript
 * import { ShellApiRpcTarget } from '@dotdo/bashx/rpc'
 * import { newWorkersRpcResponse } from '@dotdo/do/rpc'
 *
 * // In a Cloudflare Worker or similar
 * export default {
 *   async fetch(request: Request) {
 *     if (request.url.endsWith('/api')) {
 *       const api = new ShellApiRpcTarget()
 *       return newWorkersRpcResponse(api, request)
 *     }
 *     return new Response('Not found', { status: 404 })
 *   }
 * }
 * ```
 */
export class ShellApiRpcTarget extends RpcTarget implements ShellApi {
  private readonly api: ShellApiImpl
  private readonly streams = new Map<string, ShellStreamImpl>()
  private streamIdCounter = 0

  constructor(options?: { api?: ShellApiImpl }) {
    super()

    // Use provided API or create a new one
    this.api = options?.api ?? new ShellApiImpl()

    // Register allowed methods
    this.allowedMethods.add('exec')
    this.allowedMethods.add('spawn')
  }

  /**
   * Execute a command and wait for completion.
   * @param command - Shell command to execute
   * @param options - Execution options
   * @returns Promise resolving to ShellResult
   */
  async exec(command: string, options?: ShellExecOptions): Promise<ShellResult> {
    return this.api.exec(command, options)
  }

  /**
   * Spawn a process with streaming I/O.
   *
   * Returns a ShellStream that is passed by reference in Cap'n Web RPC.
   * The client receives a stub that proxies all method calls back to this server.
   *
   * @param command - Shell command to spawn
   * @param options - Spawn options
   * @returns ShellStream handle for process interaction
   */
  spawn(command: string, options?: ShellSpawnOptions): ShellStream {
    const stream = this.api.spawn(command, options) as ShellStreamImpl

    // Track the stream for potential cleanup
    const streamId = `stream-${++this.streamIdCounter}`
    this.streams.set(streamId, stream)

    // Clean up tracking when stream exits
    stream.onExit(() => {
      this.streams.delete(streamId)
    })

    return stream
  }

  /**
   * Clean up all tracked streams.
   * Called when the RPC connection closes.
   */
  [Symbol.dispose](): void {
    for (const stream of this.streams.values()) {
      stream[Symbol.dispose]()
    }
    this.streams.clear()
  }
}

// ============================================================================
// ShellStreamRpcTarget - RpcTarget wrapper for ShellStreamImpl
// ============================================================================

/**
 * RpcTarget wrapper for ShellStreamImpl.
 *
 * This class wraps a ShellStreamImpl to expose it as an RpcTarget,
 * enabling pass-by-reference semantics in Cap'n Web RPC.
 *
 * Note: In most cases, ShellStreamImpl can be used directly as it
 * already has the correct interface. This wrapper is provided for
 * explicit RpcTarget compatibility if needed.
 */
export class ShellStreamRpcTarget extends RpcTarget implements ShellStream {
  private readonly stream: ShellStreamImpl

  constructor(stream: ShellStreamImpl) {
    super()
    this.stream = stream

    // Register allowed methods
    this.allowedMethods.add('write')
    this.allowedMethods.add('closeStdin')
    this.allowedMethods.add('kill')
    this.allowedMethods.add('onData')
    this.allowedMethods.add('onStderr')
    this.allowedMethods.add('onExit')
    this.allowedMethods.add('wait')
  }

  get pid(): number {
    return this.stream.pid
  }

  write(data: string): void {
    this.stream.write(data)
  }

  closeStdin(): void {
    this.stream.closeStdin()
  }

  kill(signal?: string): void {
    this.stream.kill(signal)
  }

  onData(callback: (chunk: string) => void): () => void {
    return this.stream.onData(callback)
  }

  onStderr(callback: (chunk: string) => void): () => void {
    return this.stream.onStderr(callback)
  }

  onExit(callback: (exitCode: number, signal?: string) => void): () => void {
    return this.stream.onExit(callback)
  }

  wait(): Promise<ShellResult> {
    return this.stream.wait()
  }

  [Symbol.dispose](): void {
    this.stream[Symbol.dispose]()
  }
}

// ============================================================================
// HTTP RPC Handler - Process RPC requests over HTTP
// ============================================================================

/**
 * Create a Workers RPC response from an RpcTarget and HTTP request.
 *
 * Compatible with dotdo/rpc newWorkersRpcResponse pattern.
 * Handles both single requests and batch requests (via /batch endpoint).
 *
 * @param target - RpcTarget to handle requests
 * @param request - HTTP Request object
 * @returns HTTP Response with JSON-encoded result
 *
 * @example
 * ```typescript
 * const api = new ShellApiRpcTarget()
 *
 * export default {
 *   async fetch(request: Request) {
 *     return newWorkersRpcResponse(api, request)
 *   }
 * }
 * ```
 */
export async function newWorkersRpcResponse(
  target: RpcTarget,
  request: Request
): Promise<Response> {
  const url = new URL(request.url)
  const isBatch = url.pathname.endsWith('/batch')

  try {
    const body = (await request.json()) as RpcRequest | RpcRequest[]

    if (isBatch && Array.isArray(body)) {
      // Handle batch requests
      const results = await Promise.all(
        body.map(async (req) => {
          try {
            const result = await target.invoke(req.method, req.params)
            return { id: req.id, result }
          } catch (error) {
            return {
              id: req.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          }
        })
      )

      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Handle single request
    const req = body as RpcRequest

    if (!target.hasMethod(req.method)) {
      return new Response(JSON.stringify({ error: `Method not found: ${req.method}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      const result = await target.invoke(req.method, req.params)
      return new Response(JSON.stringify({ id: req.id, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      return new Response(
        JSON.stringify({
          id: req.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

// ============================================================================
// WebSocket RPC Handler - Process RPC requests over WebSocket
// ============================================================================

/**
 * Options for WebSocket RPC handler.
 */
export interface WebSocketRpcOptions {
  /** Timeout for method execution in milliseconds (default: 30000) */
  timeout?: number
  /** Called when WebSocket connection opens */
  onOpen?: () => void
  /** Called when WebSocket connection closes */
  onClose?: () => void
  /** Called on WebSocket error */
  onError?: (error: Event) => void
}

/**
 * Handle RPC requests over a WebSocket connection.
 *
 * Messages are JSON-encoded RpcRequest objects. Responses are sent
 * back as JSON-encoded RpcResponse objects.
 *
 * @param target - RpcTarget to handle requests
 * @param socket - WebSocket connection
 * @param options - Handler options
 *
 * @example
 * ```typescript
 * const api = new ShellApiRpcTarget()
 *
 * export default {
 *   async fetch(request: Request) {
 *     if (request.headers.get('Upgrade') === 'websocket') {
 *       const pair = new WebSocketPair()
 *       const [client, server] = Object.values(pair)
 *       server.accept()
 *       handleWebSocketRpc(api, server)
 *       return new Response(null, { status: 101, webSocket: client })
 *     }
 *     return new Response('Expected WebSocket', { status: 400 })
 *   }
 * }
 * ```
 */
export function handleWebSocketRpc(
  target: RpcTarget,
  socket: WebSocket,
  options: WebSocketRpcOptions = {}
): void {
  const timeout = options.timeout ?? 30000

  if (options.onOpen) {
    socket.addEventListener('open', options.onOpen)
  }

  if (options.onClose) {
    socket.addEventListener('close', options.onClose)
  }

  if (options.onError) {
    socket.addEventListener('error', options.onError)
  }

  socket.addEventListener('message', async (event) => {
    const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)

    try {
      const req = JSON.parse(data) as RpcRequest

      if (!target.hasMethod(req.method)) {
        socket.send(
          JSON.stringify({
            id: req.id,
            error: `Method not found: ${req.method}`,
          })
        )
        return
      }

      // Execute with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      })

      try {
        const result = await Promise.race([
          target.invoke(req.method, req.params),
          timeoutPromise,
        ])

        socket.send(JSON.stringify({ id: req.id, result }))
      } catch (error) {
        socket.send(
          JSON.stringify({
            id: req.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        )
      }
    } catch (_error) {
      // JSON parse error
      socket.send(
        JSON.stringify({
          error: 'Invalid JSON request',
        })
      )
    }
  })

  // Clean up target when socket closes
  socket.addEventListener('close', () => {
    if (Symbol.dispose in target) {
      ;(target as { [Symbol.dispose](): void })[Symbol.dispose]()
    }
  })
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a ShellApi RpcTarget.
 *
 * Factory function for creating ShellApiRpcTarget instances.
 * Convenience wrapper for `new ShellApiRpcTarget()`.
 *
 * @returns ShellApiRpcTarget instance
 */
export function createShellApiRpcTarget(): ShellApiRpcTarget {
  return new ShellApiRpcTarget()
}

/**
 * Convert a ShellApiImpl to an RpcTarget-compatible object.
 *
 * This is useful when you have an existing ShellApiImpl and want
 * to expose it via RPC without creating a new instance.
 *
 * @param api - ShellApiImpl to wrap
 * @returns ShellApiRpcTarget wrapping the provided API
 */
export function asRpcTarget(api: ShellApiImpl): ShellApiRpcTarget {
  return new ShellApiRpcTarget({ api })
}

// ============================================================================
// Re-exports
// ============================================================================

// Re-export implementations for convenience
export { ShellApiImpl } from './shell-api-impl.js'
export { ShellStreamImpl } from './shell-stream-impl.js'
