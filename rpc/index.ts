/**
 * @dotdo/rpc - Cap'n Web RPC Layer
 *
 * Provides a complete RPC implementation for all communication patterns:
 * - Client to Worker
 * - Worker to Worker
 * - Worker to DO
 * - DO to Worker
 * - DO to DO
 *
 * Features:
 * - Typed proxy clients with automatic method forwarding
 * - Promise pipelining (Cap'n Proto style) for reduced round trips
 * - Batched RPC for combining multiple calls
 * - Pluggable transport layer (fetch, WebSocket, etc.)
 * - Request correlation for distributed tracing
 * - Circuit breaker pattern for resilience
 *
 * @module @dotdo/rpc
 *
 * @example
 * ```typescript
 * import { createClient, createServer, createDOStub } from '@dotdo/rpc'
 *
 * // Create a typed RPC client
 * interface MyAPI {
 *   greet(name: string): Promise<string>
 *   users: {
 *     create(user: User): Promise<{ id: string }>
 *   }
 * }
 *
 * const client = createClient<MyAPI>({ url: 'https://api.example.com' })
 * const greeting = await client.greet('World')
 * const user = await client.users.create({ name: 'Alice' })
 *
 * // Create an RPC server
 * const server = createServer({
 *   target: new MyAPIImpl(),
 *   whitelist: ['greet', 'users.*']
 * })
 *
 * // Create a DO stub for type-safe DO calls
 * const counter = createDOStub<CounterDO>(env.COUNTER, 'my-counter')
 * const value = await counter.increment()
 * ```
 */

// Re-export Hono's ContentfulStatusCode for type compatibility in consumers.
//
// Design decision (do-irqfu): Using Hono's HTTP status types is intentional:
// - Hono is already a dependency of @dotdo/rpc (for server functionality)
// - ContentfulStatusCode is a type-only export (no runtime impact)
// - TypeScript erases types at compile time (no bundle size impact)
// - Provides well-tested, comprehensive HTTP status code types
// - Consumers can use `number` if they prefer to avoid Hono types
export type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * RPC client for making typed remote calls.
 * Supports flat and nested APIs with automatic proxy handling.
 */
export * from './client'

/**
 * RPC server for exposing methods via HTTP.
 * Includes whitelist security, method validation, and error handling.
 */
export * from './server'

/**
 * Promise pipelining for chaining RPC calls in a single round trip.
 * Implements Cap'n Proto-style promise pipelining.
 */
export * from './pipeline'

/** Batch utilities for grouping operations */
export * from './batch'

/**
 * Batched RPC for combining multiple calls into a single request.
 * Reduces network overhead for bulk operations.
 */
export * from './batch-rpc'

/** RPC error types and serialization */
export * from './errors'

/** Logging utilities for RPC tracing */
export * from './logging'

/** Cross-DO communication utilities */
export * from './cross-do'

/** Circuit breaker for resilient RPC calls */
export * from './circuit-breaker'

/** Type definitions for RPC messages and responses */
export * from './types'

/**
 * Typed client factory for compile-time type safety.
 * Creates clients with full TypeScript inference.
 */
export * from './typed-client'

/** Schema validation for RPC arguments */
export * from './validation'

/** Rate limiting for RPC endpoints */
export * from './rate-limit'

/** Header utilities including correlation ID handling */
export * from './headers'

/**
 * Transport layer abstraction.
 * Enables pluggable transports (fetch, WebSocket, etc.)
 */
export * from './transport'

/**
 * WebSocket event streaming for remote $.on subscriptions.
 * Enables real-time event push from server to client.
 * @see do-9zknf
 */
export * from './websocket-events'
