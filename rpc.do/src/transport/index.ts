/**
 * @module rpc.do/transport
 *
 * Transport layer for rpc.do - pluggable communication backends.
 *
 * This module provides the {@link Transport} interface and implementations
 * for different communication backends:
 *
 * - {@link FetchTransport} - HTTP/fetch-based transport for client-to-worker
 * - {@link RetryTransport} - Retry wrapper with exponential backoff
 * - (Future) WebSocketTransport - Real-time bidirectional communication
 * - (Future) DOStubTransport - Direct Durable Object stub communication
 *
 * The transport layer is decoupled from the RPC protocol, allowing the same
 * client code to work with different backends.
 *
 * @example Basic usage
 * ```typescript
 * import { createClient, FetchTransport } from 'rpc.do'
 *
 * // Create a transport
 * const transport = new FetchTransport({
 *   url: 'https://api.example.com',
 *   timeout: 5000,
 * })
 *
 * // Use it with createClient
 * const client = createClient<MyAPI>('https://api.example.com', { transport })
 * ```
 *
 * @example With retry transport
 * ```typescript
 * import { RetryTransport, FetchTransport, RetryPolicy } from 'rpc.do'
 *
 * // Wrap fetch transport with retry logic
 * const transport = new RetryTransport({
 *   transport: new FetchTransport({ url: 'https://api.example.com' }),
 *   ...RetryPolicy.aggressive,
 * })
 * ```
 */

// Types
export * from './types'

// Transports
export * from './fetch'
export * from './websocket'
export * from './retry'
