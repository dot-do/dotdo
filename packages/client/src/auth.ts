/**
 * Auth utilities for @dotdo/client
 *
 * Handles authentication for RPC sessions by building WebSocket subprotocols
 * or HTTP Authorization headers. Auth is handled in this wrapper layer,
 * not in the capnweb core.
 *
 * @module @dotdo/client/auth
 */

import {
  newWebSocketRpcSession,
  newHttpBatchRpcSession,
  type SessionOptions,
} from './capnweb-compat.js'
import type { RpcClient } from './index.js'

/**
 * Options for creating an authenticated RPC client.
 */
export interface AuthenticatedClientOptions {
  /**
   * The URL of the RPC endpoint.
   * - For HTTP batch: https:// or http:// URLs
   * - For WebSocket: wss:// or ws:// URLs
   *
   * The transport is auto-detected from the URL scheme if not specified.
   */
  url: string

  /**
   * Static auth token to use for requests.
   * For HTTP: Sent as `Authorization: Bearer {token}` header.
   * For WebSocket: Sent as `bearer.{token}` subprotocol.
   */
  token?: string

  /**
   * Dynamic token getter for refresh scenarios.
   * Called for each request/connection to get the current token.
   * If both `token` and `getToken` are provided, `getToken` takes precedence.
   */
  getToken?: () => string | undefined

  /**
   * Transport type to use. If not specified, auto-detected from URL:
   * - wss:// or ws:// -> 'websocket'
   * - https:// or http:// -> 'http'
   */
  transport?: 'http' | 'websocket'

  /**
   * Additional custom headers to include with HTTP batch requests.
   * Not applicable to WebSocket transport.
   */
  headers?: Record<string, string>

  /**
   * Local object to expose to the remote peer.
   * Allows bidirectional RPC where the server can call methods on the client.
   */
  localMain?: unknown

  /**
   * Session options passed to capnweb.
   */
  sessionOptions?: SessionOptions

  /**
   * Callback invoked when an authentication error occurs.
   * Useful for triggering token refresh or logout flows.
   */
  onAuthError?: (error: Error) => void
}

/**
 * Detect transport type from URL scheme.
 */
function detectTransport(url: string): 'http' | 'websocket' {
  const lowerUrl = url.toLowerCase()
  if (lowerUrl.startsWith('wss://') || lowerUrl.startsWith('ws://')) {
    return 'websocket'
  }
  return 'http'
}

/**
 * Get the auth token from options, preferring getToken over static token.
 */
function getAuthToken(options: AuthenticatedClientOptions): string | undefined {
  if (options.getToken) {
    return options.getToken()
  }
  return options.token
}

/**
 * Build WebSocket subprotocols array for auth.
 * Always includes 'capnp-rpc' as the base protocol when auth is provided.
 *
 * The `bearer.{token}` subprotocol allows servers to authenticate
 * WebSocket connections during the upgrade handshake.
 */
function buildWebSocketProtocols(token: string | undefined): string[] | undefined {
  if (!token) {
    return undefined
  }
  return ['capnp-rpc', `bearer.${token}`]
}

/**
 * Create an authenticated RPC client that wraps capnweb transport with auth.
 *
 * For HTTP batch transport, auth tokens are sent as `Authorization: Bearer {token}` headers.
 * For WebSocket transport, auth tokens are sent via the `bearer.{token}` subprotocol.
 *
 * @param options - Configuration options for the authenticated client
 * @returns An RpcClient with full pipelining support
 *
 * @example
 * ```typescript
 * import { createAuthenticatedClient } from '@dotdo/client/auth'
 *
 * // HTTP batch with static token
 * const client = createAuthenticatedClient({
 *   url: 'https://api.example.com/rpc',
 *   token: 'my-auth-token',
 * })
 *
 * // HTTP batch with dynamic token (for refresh scenarios)
 * const client = createAuthenticatedClient({
 *   url: 'https://api.example.com/rpc',
 *   getToken: () => localStorage.getItem('accessToken') ?? undefined,
 * })
 *
 * // WebSocket with token
 * const client = createAuthenticatedClient({
 *   url: 'wss://api.example.com/rpc',
 *   token: 'my-auth-token',
 * })
 *
 * // HTTP batch with additional headers
 * const client = createAuthenticatedClient({
 *   url: 'https://api.example.com/rpc',
 *   token: 'my-auth-token',
 *   headers: { 'X-Tenant-ID': 'tenant-123' },
 * })
 * ```
 */
export function createAuthenticatedClient(options: AuthenticatedClientOptions): RpcClient {
  const { url, headers: customHeaders = {}, localMain, sessionOptions } = options
  const transport = options.transport ?? detectTransport(url)

  if (transport === 'websocket') {
    // WebSocket transport - handle auth via subprotocol in the wrapper
    // Get token (prefer getToken callback over static token)
    const token = getAuthToken(options)
    const protocols = buildWebSocketProtocols(token)

    // Create WebSocket manually with protocols, then pass to capnweb
    // The capnweb newWebSocketRpcSession accepts a WebSocket object directly
    const socket = new WebSocket(url, protocols)
    return newWebSocketRpcSession(socket, localMain, sessionOptions) as RpcClient
  }

  // HTTP batch transport - use Authorization header
  const authToken = getAuthToken(options)
  const headers: Record<string, string> = {
    ...customHeaders,
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  // Note: newHttpBatchRpcSession takes (url, options) where options includes headers
  // We need to merge our headers with session options
  const httpOptions = {
    ...sessionOptions,
    headers,
  }

  return newHttpBatchRpcSession(url, httpOptions) as RpcClient
}

/**
 * Create a WebSocket with auth subprotocol.
 *
 * This is a lower-level utility for cases where you need to manage
 * the WebSocket lifecycle yourself.
 *
 * @param url - WebSocket URL (wss:// or ws://)
 * @param token - Optional auth token
 * @returns A WebSocket configured with auth subprotocol
 *
 * @example
 * ```typescript
 * import { createAuthenticatedWebSocket } from '@dotdo/client/auth'
 * import { newWebSocketRpcSession } from '@dotdo/client'
 *
 * const socket = createAuthenticatedWebSocket('wss://api.example.com/rpc', 'my-token')
 * const client = newWebSocketRpcSession(socket)
 * ```
 */
export function createAuthenticatedWebSocket(url: string, token?: string): WebSocket {
  const protocols = buildWebSocketProtocols(token)
  return new WebSocket(url, protocols)
}
