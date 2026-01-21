/**
 * @module rpc.do/transport/types
 *
 * Transport layer type definitions for rpc.do.
 *
 * This module defines the core {@link Transport} interface that all RPC
 * transports must implement, along with supporting types for state management
 * and events.
 *
 * @example Implementing a custom transport
 * ```typescript
 * import { Transport, RPCMessage, RPCResponse } from 'rpc.do'
 *
 * class MyCustomTransport implements Transport {
 *   async send<T>(message: RPCMessage): Promise<RPCResponse<T>> {
 *     // Your transport logic here
 *     return { result: await myBackend.call(message) }
 *   }
 * }
 * ```
 */

import type { RPCMessage, RPCResponse } from '../types'

/**
 * Transport state for stateful transports (e.g., WebSocket)
 */
export enum TransportState {
  /** Transport is ready to send messages */
  CONNECTED = 'CONNECTED',
  /** Transport is establishing connection */
  CONNECTING = 'CONNECTING',
  /** Transport is disconnected */
  DISCONNECTED = 'DISCONNECTED',
  /** Transport has closed permanently */
  CLOSED = 'CLOSED',
}

/**
 * Event types emitted by transports
 */
export type TransportEventType = 'connect' | 'disconnect' | 'error' | 'reconnect' | 'backpressure' | 'resume'

/**
 * Transport event with type-safe data
 */
export interface TransportEvent {
  type: TransportEventType
  error?: Error
  /** For reconnect events, the attempt number */
  attempt?: number
  /** For backpressure/resume events, the current queue size */
  queueSize?: number
}

/**
 * Transport event listener
 */
export type TransportEventListener = (event: TransportEvent) => void

/**
 * Transport interface - the core abstraction for all RPC communication
 *
 * Transports handle the mechanics of sending RPC messages and receiving responses.
 * This separation allows the RPC client to work with different backends:
 * - HTTP/fetch for external API calls
 * - WebSocket for real-time bidirectional communication
 * - DO stubs for Durable Object calls within Cloudflare Workers
 */
export interface Transport {
  /**
   * Send an RPC message and receive the response
   *
   * @param message - The RPC message to send
   * @returns Promise resolving to the RPC response
   * @throws May throw transport-level errors (network, timeout, etc.)
   */
  send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>>

  /**
   * Close the transport and release resources
   *
   * For stateless transports (HTTP), this is a no-op.
   * For stateful transports (WebSocket), this closes the connection.
   *
   * @returns Promise that resolves when close is complete
   */
  close?(): Promise<void>

  /**
   * Get the current state of the transport
   *
   * For stateless transports, always returns CONNECTED.
   * For stateful transports, reflects the actual connection state.
   */
  getState?(): TransportState

  /**
   * Add an event listener for transport events
   *
   * @param listener - Function to call when events occur
   * @returns Function to remove the listener
   */
  addEventListener?(listener: TransportEventListener): () => void
}

/**
 * Options common to all transports
 */
export interface TransportOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Optional correlation ID to use for all requests */
  correlationId?: string
  /** Custom headers to include with requests (where applicable) */
  headers?: Record<string, string>
}

/**
 * Type guard to check if a transport supports close.
 *
 * Use this to safely call `close()` on transports that may or may not
 * support graceful shutdown.
 *
 * @param transport - The transport to check
 * @returns True if the transport has a close method
 *
 * @example
 * ```typescript
 * import { isCloseable } from 'rpc.do'
 *
 * async function cleanup(transport: Transport) {
 *   if (isCloseable(transport)) {
 *     await transport.close()
 *   }
 * }
 * ```
 */
export function isCloseable(transport: Transport): transport is Transport & { close: () => Promise<void> } {
  return typeof transport.close === 'function'
}

/**
 * Type guard to check if a transport supports state tracking.
 *
 * Stateful transports (like WebSocket) have a connection state that
 * changes over time. Stateless transports (like HTTP) are always "connected".
 *
 * @param transport - The transport to check
 * @returns True if the transport has a getState method
 *
 * @example
 * ```typescript
 * import { isStateful, TransportState } from 'rpc.do'
 *
 * function checkConnection(transport: Transport) {
 *   if (isStateful(transport)) {
 *     const state = transport.getState()
 *     if (state === TransportState.DISCONNECTED) {
 *       console.log('Connection lost')
 *     }
 *   }
 * }
 * ```
 */
export function isStateful(transport: Transport): transport is Transport & { getState: () => TransportState } {
  return typeof transport.getState === 'function'
}

/**
 * Type guard to check if a transport supports events.
 *
 * Event-supporting transports emit notifications for connection state
 * changes, errors, and reconnection attempts.
 *
 * @param transport - The transport to check
 * @returns True if the transport has an addEventListener method
 *
 * @example
 * ```typescript
 * import { supportsEvents } from 'rpc.do'
 *
 * function setupEventHandlers(transport: Transport) {
 *   if (supportsEvents(transport)) {
 *     const unsubscribe = transport.addEventListener((event) => {
 *       console.log(`Transport event: ${event.type}`)
 *     })
 *
 *     // Later: unsubscribe()
 *   }
 * }
 * ```
 */
export function supportsEvents(transport: Transport): transport is Transport & { addEventListener: (listener: TransportEventListener) => () => void } {
  return typeof transport.addEventListener === 'function'
}
