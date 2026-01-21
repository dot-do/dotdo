// Transport Layer Types
// Defines the interface for all RPC transports

import type { SerializedError } from '../errors'

/**
 * Standard RPC message format sent over any transport
 */
export interface RPCMessage {
  /** The method to invoke (supports dot notation for nested methods) */
  method: string
  /** Arguments to pass to the method */
  args: unknown[]
  /** Optional correlation ID for request tracing */
  correlationId?: string
}

/**
 * RPC response from the server
 */
export interface RPCResponse<T = unknown> {
  /** The result of the RPC call (undefined if error) */
  result?: T
  /** Error if the call failed */
  error?: SerializedError
  /** Correlation ID echoed back for request tracing */
  correlationId?: string
}

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
export type TransportEventType = 'connect' | 'disconnect' | 'error' | 'reconnect'

/**
 * Transport event with type-safe data
 */
export interface TransportEvent {
  type: TransportEventType
  error?: Error
  /** For reconnect events, the attempt number */
  attempt?: number
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
 *
 * @example
 * ```typescript
 * const transport = new FetchTransport({ url: 'https://api.example.com' })
 * const response = await transport.send({
 *   method: 'users.create',
 *   args: [{ name: 'Alice' }],
 *   correlationId: 'req-123'
 * })
 * ```
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
  /** Request timeout in milliseconds (default: DEFAULT_RPC_TIMEOUT_MS = 30000 from @dotdo/utils) */
  timeout?: number
  /** Optional correlation ID to use for all requests */
  correlationId?: string
  /** Custom headers to include with requests (where applicable) */
  headers?: Record<string, string>
}

/**
 * Type guard to check if a transport supports close
 */
export function isCloseable(transport: Transport): transport is Transport & { close: () => Promise<void> } {
  return typeof transport.close === 'function'
}

/**
 * Type guard to check if a transport supports state tracking
 */
export function isStateful(transport: Transport): transport is Transport & { getState: () => TransportState } {
  return typeof transport.getState === 'function'
}

/**
 * Type guard to check if a transport supports events
 */
export function supportsEvents(transport: Transport): transport is Transport & { addEventListener: (listener: TransportEventListener) => () => void } {
  return typeof transport.addEventListener === 'function'
}
