/**
 * @module rpc.do
 *
 * Cap'n Web RPC Client/Server for Durable Objects
 *
 * rpc.do provides a complete RPC solution for Cloudflare Durable Objects with:
 * - Type-safe proxy clients with nested API support
 * - Pluggable transport layer (fetch, WebSocket, DO stubs)
 * - OAuth 2.0 authentication with device flow
 * - CLI tools for type generation, REPL, and scripting
 * - Structured logging with correlation ID propagation
 *
 * @example Basic client usage
 * ```typescript
 * import { createClient, FetchTransport } from 'rpc.do'
 *
 * interface MyAPI {
 *   greet(name: string): Promise<string>
 *   users: {
 *     create(user: User): Promise<{ id: string }>
 *   }
 * }
 *
 * const transport = new FetchTransport({ url: 'https://api.example.com' })
 * const client = createClient<MyAPI>('https://api.example.com', { transport })
 *
 * const greeting = await client.greet('World')
 * const user = await client.users.create({ name: 'Alice' })
 * ```
 *
 * @example Authenticated client
 * ```typescript
 * import { createClient, AuthTransport, TokenStore } from 'rpc.do'
 *
 * const transport = new AuthTransport({
 *   url: 'https://api.example.com',
 *   tokenStore: new TokenStore(),
 * })
 *
 * const client = createClient<MyAPI>('https://api.example.com', { transport })
 * ```
 *
 * @see {@link createClient} - Factory for creating RPC clients
 * @see {@link FetchTransport} - HTTP transport for client-to-worker
 * @see {@link WebSocketTransport} - Real-time bidirectional transport
 * @see {@link AuthTransport} - Transport with OAuth authentication
 * @see {@link createLogger} - Structured logging
 *
 * @since 0.0.1
 * @packageDocumentation
 */

// Types
export * from './types'

// Client
export * from './client'

// Transport layer
export * from './transport'

// Auth module (OAuth device flow, token store, auth transport)
export * from './auth'

// Logger module (structured logging)
export * from './logger'
