/**
 * GraphStore Factory
 *
 * Factory function for creating GraphStore instances with different backends.
 *
 * @module db/graph/factory
 */

import type { GraphStore } from './types'
import { SQLiteGraphStore } from './stores/sqlite'
import { DocumentGraphStore } from './stores/document'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Available GraphStore backend types.
 *
 * - `sqlite`: Basic SQLite backend with Drizzle ORM (SQLiteGraphStore)
 * - `document`: Document-store style backend with MongoDB-like operators (DocumentGraphStore)
 */
export type GraphStoreBackend = 'sqlite' | 'document'

/**
 * Options for creating a GraphStore instance.
 */
export interface CreateGraphStoreOptions {
  /**
   * The backend to use for storage.
   *
   * - `sqlite`: Use SQLiteGraphStore for basic graph operations
   * - `document`: Use DocumentGraphStore for MongoDB-style queries
   *
   * @default 'sqlite'
   */
  backend?: GraphStoreBackend

  /**
   * SQLite connection string or file path.
   *
   * - ':memory:' for in-memory database (great for testing)
   * - '/path/to/file.db' for file-based persistence
   *
   * @default ':memory:'
   */
  connectionString?: string

  /**
   * For SQLite backend: an existing better-sqlite3 Database instance.
   * If provided, connectionString is ignored.
   */
  existingConnection?: import('better-sqlite3').Database
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a GraphStore instance with the specified backend.
 *
 * This factory function provides a unified way to create GraphStore instances
 * with different storage backends while maintaining a consistent interface.
 *
 * @param options - Configuration options for the GraphStore
 * @returns A Promise that resolves to an initialized GraphStore instance
 *
 * @example
 * ```typescript
 * // Create an in-memory SQLite store (default)
 * const store = await createGraphStore()
 *
 * // Create a document-style store with MongoDB-like queries
 * const docStore = await createGraphStore({
 *   backend: 'document',
 *   connectionString: ':memory:'
 * })
 *
 * // Create a file-based SQLite store
 * const fileStore = await createGraphStore({
 *   backend: 'sqlite',
 *   connectionString: '/path/to/graph.db'
 * })
 *
 * // Use existing better-sqlite3 connection (SQLite only)
 * const existingStore = await createGraphStore({
 *   backend: 'sqlite',
 *   existingConnection: myBetterSqlite3Db
 * })
 * ```
 */
export async function createGraphStore(options: CreateGraphStoreOptions = {}): Promise<GraphStore> {
  const { backend = 'sqlite', connectionString = ':memory:', existingConnection } = options

  let store: SQLiteGraphStore | DocumentGraphStore

  switch (backend) {
    case 'sqlite':
      if (existingConnection) {
        store = new SQLiteGraphStore(existingConnection)
      } else {
        store = new SQLiteGraphStore(connectionString)
      }
      await store.initialize()
      return store

    case 'document':
      if (existingConnection) {
        throw new Error('DocumentGraphStore does not support existingConnection. Use connectionString instead.')
      }
      store = new DocumentGraphStore(connectionString)
      await store.initialize()
      return store

    default:
      throw new Error(`Unknown GraphStore backend: ${backend}. Supported backends: 'sqlite', 'document'`)
  }
}

/**
 * Create a SQLiteGraphStore instance.
 *
 * Convenience function that wraps createGraphStore with backend: 'sqlite'.
 *
 * @param connectionString - SQLite connection string (default: ':memory:')
 * @returns A Promise that resolves to an initialized SQLiteGraphStore
 *
 * @example
 * ```typescript
 * const store = await createSQLiteGraphStore()
 * // or with file
 * const fileStore = await createSQLiteGraphStore('/path/to/graph.db')
 * ```
 */
export async function createSQLiteGraphStore(
  connectionString: string = ':memory:'
): Promise<SQLiteGraphStore> {
  const store = new SQLiteGraphStore(connectionString)
  await store.initialize()
  return store
}

/**
 * Create a DocumentGraphStore instance.
 *
 * Convenience function that wraps createGraphStore with backend: 'document'.
 * The DocumentGraphStore provides MongoDB-style query operators and batch operations.
 *
 * @param connectionString - SQLite connection string (default: ':memory:')
 * @returns A Promise that resolves to an initialized DocumentGraphStore
 *
 * @example
 * ```typescript
 * const store = await createDocumentGraphStore()
 *
 * // Use MongoDB-style operators
 * const results = await store.findThings({
 *   typeId: 1,
 *   dataQuery: { 'data.age': { $gte: 25 } }
 * })
 * ```
 */
export async function createDocumentGraphStore(
  connectionString: string = ':memory:'
): Promise<DocumentGraphStore> {
  const store = new DocumentGraphStore(connectionString)
  await store.initialize()
  return store
}
