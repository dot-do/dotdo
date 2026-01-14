/**
 * Test Utilities for Database Stores
 *
 * Provides utilities for creating test contexts with real SQLite databases.
 * These utilities enable integration testing with actual database operations
 * instead of mocks.
 *
 * Key Features:
 * - Creates in-memory SQLite databases for fast, isolated tests
 * - Provides StoreContext compatible with ThingsStore and other stores
 * - Initializes schema automatically
 *
 * @module db/test-utils
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { StoreContext } from './stores'
import type { DODatabase, AppSchema } from '../types/drizzle'

// ============================================================================
// SCHEMA INITIALIZATION
// ============================================================================

/**
 * SQL schema for Things and related tables.
 * This creates the schema needed for ThingsStore operations.
 * Must match the Drizzle schema in db/nouns.ts and db/things.ts.
 */
const THINGS_SCHEMA = `
-- Nouns table (type registry)
-- Matches db/nouns.ts schema
CREATE TABLE IF NOT EXISTS nouns (
  noun TEXT PRIMARY KEY NOT NULL,
  plural TEXT,
  description TEXT,
  schema TEXT,
  do_class TEXT
);

-- Things table (entities with versioning)
-- Matches db/things.ts schema
-- Note: FK constraint removed for test simplicity (nouns.rowid not available with TEXT PK)
CREATE TABLE IF NOT EXISTS things (
  id TEXT NOT NULL,
  type INTEGER NOT NULL,
  branch TEXT,
  name TEXT,
  data TEXT,
  deleted INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'user'
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_things_id ON things(id);
CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
CREATE INDEX IF NOT EXISTS idx_things_branch ON things(branch);
CREATE INDEX IF NOT EXISTS idx_things_deleted ON things(deleted);
CREATE INDEX IF NOT EXISTS idx_things_visibility ON things(visibility);
CREATE INDEX IF NOT EXISTS idx_things_visibility_type ON things(visibility, type);
CREATE INDEX IF NOT EXISTS idx_things_type_visibility ON things(type, visibility);
CREATE INDEX IF NOT EXISTS idx_things_id_branch ON things(id, branch);

-- Events table (for audit history)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  ns TEXT,
  verb TEXT NOT NULL,
  actor TEXT,
  target TEXT,
  data TEXT,
  source TEXT,
  sequence INTEGER,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_target ON events(target);
CREATE INDEX IF NOT EXISTS idx_events_verb ON events(verb);
`

// ============================================================================
// TEST CONTEXT CREATION
// ============================================================================

/**
 * Options for creating a test store context.
 */
export interface CreateStoreContextOptions {
  /** Namespace identifier (default: 'test') */
  namespace?: string
  /** Branch name (default: 'main') */
  branch?: string
  /** Path to SQLite database (default: ':memory:' for in-memory) */
  dbPath?: string
}

/**
 * Result of creating a test context, includes cleanup function.
 */
export interface TestStoreContextResult {
  /** The store context for use with stores */
  ctx: StoreContext
  /** The underlying better-sqlite3 database instance */
  sqlite: Database.Database
  /** The Drizzle ORM database instance */
  db: BetterSQLite3Database
  /** Cleanup function to close database connections */
  cleanup: () => void
}

/**
 * Creates a test store context with an in-memory SQLite database.
 *
 * This function sets up a complete StoreContext that can be used with
 * ThingsStore, HumanRequestThingsStore, and other stores that require
 * database access.
 *
 * @param options - Configuration options
 * @returns A StoreContext instance configured for testing
 *
 * @example
 * ```typescript
 * import { createStoreContext } from '../db/test-utils'
 * import { ThingsStore } from '../db/stores'
 *
 * const ctx = await createStoreContext({ namespace: 'test-human-requests' })
 * const store = new ThingsStore(ctx)
 *
 * const thing = await store.create({
 *   $type: 'Customer',
 *   name: 'Alice',
 * })
 * ```
 */
export async function createStoreContext(
  options: CreateStoreContextOptions = {}
): Promise<StoreContext> {
  const {
    namespace = 'test',
    branch = 'main',
    dbPath = ':memory:',
  } = options

  // Create SQLite database
  const sqlite = new Database(dbPath)

  // Initialize schema
  sqlite.exec(THINGS_SCHEMA)

  // Create Drizzle ORM instance
  const db = drizzle(sqlite)

  // Create store context with type casting for compatibility
  // The better-sqlite3 Drizzle instance is compatible with the DO database interface
  // for the operations used by ThingsStore
  const ctx: StoreContext = {
    db: db as unknown as DODatabase<AppSchema>,
    ns: namespace,
    currentBranch: branch,
    env: {},
    typeCache: new Map(),
  }

  return ctx
}

/**
 * Creates a test store context with cleanup support.
 *
 * This is the preferred method for tests that need explicit cleanup,
 * such as file-based databases or tests that run in parallel.
 *
 * @param options - Configuration options
 * @returns Object containing context and cleanup function
 *
 * @example
 * ```typescript
 * import { createTestStoreContext } from '../db/test-utils'
 *
 * let cleanup: () => void
 *
 * beforeEach(async () => {
 *   const result = await createTestStoreContext({ namespace: 'my-test' })
 *   ctx = result.ctx
 *   cleanup = result.cleanup
 * })
 *
 * afterEach(() => {
 *   cleanup?.()
 * })
 * ```
 */
export async function createTestStoreContext(
  options: CreateStoreContextOptions = {}
): Promise<TestStoreContextResult> {
  const {
    namespace = 'test',
    branch = 'main',
    dbPath = ':memory:',
  } = options

  // Create SQLite database
  const sqlite = new Database(dbPath)

  // Initialize schema
  sqlite.exec(THINGS_SCHEMA)

  // Create Drizzle ORM instance
  const db = drizzle(sqlite)

  // Create store context
  const ctx: StoreContext = {
    db: db as unknown as DODatabase<AppSchema>,
    ns: namespace,
    currentBranch: branch,
    env: {},
    typeCache: new Map(),
  }

  // Return context with cleanup function
  return {
    ctx,
    sqlite,
    db,
    cleanup: () => {
      try {
        sqlite.close()
      } catch {
        // Ignore errors during cleanup
      }
    },
  }
}

/**
 * Utility to clear all data from a test database.
 *
 * Useful for resetting state between tests without recreating the database.
 *
 * @param ctx - The store context to clear
 */
export async function clearTestDatabase(ctx: StoreContext): Promise<void> {
  // Cast to access the underlying database for raw SQL
  const db = ctx.db as unknown as BetterSQLite3Database

  // Clear tables in reverse dependency order
  try {
    await db.run?.('DELETE FROM events')
  } catch {
    // Table might not exist
  }

  try {
    await db.run?.('DELETE FROM things')
  } catch {
    // Table might not exist
  }

  // Don't clear nouns - type registry should persist

  // Clear type cache
  ctx.typeCache.clear()
}
