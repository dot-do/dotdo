/**
 * @dotdo/planetscale - PlanetScale SDK compat
 *
 * Drop-in replacement for @planetscale/database backed by DO SQLite.
 * This implementation provides the PlanetScale serverless driver API including:
 * - connect() - Create connection via HTTP-based driver
 * - execute() - Execute queries with ? placeholders
 * - transaction() - Execute multiple queries atomically
 *
 * @example
 * ```typescript
 * import { connect } from '@dotdo/planetscale'
 *
 * const conn = connect({
 *   host: process.env.DATABASE_HOST,
 *   username: process.env.DATABASE_USERNAME,
 *   password: process.env.DATABASE_PASSWORD
 * })
 *
 * // Execute query
 * const results = await conn.execute('SELECT * FROM users WHERE id = ?', [1])
 * console.log(results.rows)
 *
 * // With types
 * const { rows } = await conn.execute<{ id: number; name: string }>(
 *   'SELECT id, name FROM users'
 * )
 *
 * // Transaction
 * await conn.transaction(async (tx) => {
 *   await tx.execute('INSERT INTO users (name) VALUES (?)', ['Alice'])
 *   await tx.execute('INSERT INTO users (name) VALUES (?)', ['Bob'])
 * })
 * ```
 *
 * @see https://github.com/planetscale/database-js
 */

// Types
export type { Config, ExecutedQuery, Row, Transaction } from './types'

// Error classes
export { DatabaseError } from './types'

// Core implementation - stub for now (RED phase)
export { Connection, connect, cast, hex, datetime, json } from './planetscale'
