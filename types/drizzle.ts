/**
 * Type bridge for Drizzle ORM compatibility between different SQLite drivers
 *
 * This module provides type aliases that allow code to work with both:
 * - DrizzleD1Database (for D1 serverless databases in API context)
 * - DrizzleSqliteDODatabase (for Durable Object SQLite storage)
 *
 * Both types extend BaseSQLiteDatabase with the same API surface, just different
 * sync/async modes. This type bridge enables sharing schema types and query code.
 */

import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type * as schema from '../db'

/**
 * Schema type alias for the application database schema
 */
export type AppSchema = typeof schema

/**
 * Drizzle database type for Durable Object SQLite storage
 * Use this in DO classes that use ctx.storage for persistence
 */
export type DODatabase<TSchema extends Record<string, unknown> = AppSchema> = DrizzleSqliteDODatabase<TSchema>

/**
 * Drizzle database type for D1 serverless databases
 * Use this in API handlers and middleware that use D1
 */
export type D1Database<TSchema extends Record<string, unknown> = AppSchema> = DrizzleD1Database<TSchema>

/**
 * Union type for any SQLite database (DO or D1)
 * Use this when code needs to work with either database type
 */
export type AnyDatabase<TSchema extends Record<string, unknown> = AppSchema> =
  | DODatabase<TSchema>
  | D1Database<TSchema>

/**
 * Base SQLite database type for maximum compatibility
 * This is the common interface that both DO and D1 databases implement
 */
export type BaseSQLiteDb<TSchema extends Record<string, unknown> = AppSchema> =
  BaseSQLiteDatabase<'sync' | 'async', unknown, TSchema>

// Re-export the concrete types for direct use
export type { DrizzleD1Database, DrizzleSqliteDODatabase }
