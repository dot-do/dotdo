/**
 * @dotdo/turso - Turso/libSQL integration with Durable Objects
 *
 * Provides:
 * - libsql-client compatible API (createClient, execute, batch, transaction)
 * - DO-based query routing with multi-tenant isolation
 * - Embedded replica sync protocol
 * - Read/write routing (primary vs replica)
 * - Connection pooling per DO
 * - Failover handling
 * - DO stub caching
 */

export * from './do-router'
export * from './sync'
export * from './libsql-compat'
