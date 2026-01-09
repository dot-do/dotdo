/**
 * @dotdo/payload Database Adapter
 *
 * Main entry point for the dotdo Payload CMS database adapter.
 * Implements Payload's BaseDatabaseAdapter interface with a hybrid storage
 * model that supports both Things (MongoDB-style) and Drizzle (SQL-style) strategies.
 *
 * @module @dotdo/payload/adapter
 */

import type { StorageMode, StorageRouterConfig, Payload as PayloadInstance } from '../strategies/types'
import type { PayloadCollection } from './types'
import {
  MigrationManager,
  type Migration,
  type MigrateOptions,
  type MigrateDownOptions,
  type MigrateFreshOptions,
  type MigrateCreateOptions,
} from '../migrations'

// ============================================================================
// PAYLOAD TYPE STUBS
// ============================================================================

/**
 * Payload type - minimal interface for adapter compatibility
 * The full Payload type comes from the 'payload' package at runtime
 */
type Payload = PayloadInstance

/**
 * Base adapter interface - defines all methods a Payload adapter must implement.
 * This is a minimal stub; the real types come from 'payload' package.
 */
interface BaseDatabaseAdapter {
  name: string
  payload: Payload
  defaultIDType?: 'text' | 'number'
  migrationDir?: string

  // Lifecycle
  init?: () => Promise<void>
  connect?: () => Promise<void>
  destroy?: () => Promise<void>

  // CRUD
  create: (args: any) => Promise<any>
  find: (args: any) => Promise<any>
  findOne: (args: any) => Promise<any>
  updateOne: (args: any) => Promise<any>
  updateMany: (args: any) => Promise<any>
  deleteOne: (args: any) => Promise<any>
  deleteMany: (args: any) => Promise<any>
  count: (args: any) => Promise<any>
  findDistinct: (args: any) => Promise<any>
  upsert: (args: any) => Promise<any>

  // Globals
  createGlobal: (args: any) => Promise<any>
  findGlobal: (args: any) => Promise<any>
  updateGlobal: (args: any) => Promise<any>

  // Versions
  createVersion: (args: any) => Promise<any>
  findVersions: (args: any) => Promise<any>
  updateVersion: (args: any) => Promise<any>
  deleteVersions: (args: any) => Promise<any>
  countVersions: (args: any) => Promise<any>

  // Global versions
  createGlobalVersion: (args: any) => Promise<any>
  findGlobalVersions: (args: any) => Promise<any>
  updateGlobalVersion: (args: any) => Promise<any>
  countGlobalVersions: (args: any) => Promise<any>

  // Transactions
  beginTransaction: () => Promise<string | number>
  commitTransaction: (id: string | number) => Promise<void>
  rollbackTransaction: (id: string | number) => Promise<void>

  // Migrations
  createMigration: (args: any) => Promise<any>
  migrate: () => Promise<any>
  migrateDown: () => Promise<any>
  migrateFresh: () => Promise<any>
  migrateRefresh: () => Promise<any>
  migrateReset: () => Promise<any>
  migrateStatus: () => Promise<any>

  // Query
  queryDrafts: (args: any) => Promise<any>
}

/**
 * The object returned by adapter factory functions.
 * Payload uses this to instantiate the adapter.
 */
interface DatabaseAdapterObj<TAdapter extends BaseDatabaseAdapter = BaseDatabaseAdapter> {
  name: string
  defaultIDType: 'text' | 'number'
  allowIDOnCreate?: boolean
  init: (args: { payload: Payload }) => TAdapter
}

// ============================================================================
// ADAPTER CONFIGURATION TYPES
// ============================================================================

/**
 * ID type for documents - matches Payload's supported ID types
 */
export type IDType = 'text' | 'number'

/**
 * Configuration options for the dotdo adapter
 */
export interface DotdoAdapterArgs extends StorageRouterConfig {
  /**
   * ID type for documents
   * @default 'text'
   */
  idType?: IDType

  /**
   * Allow custom IDs on document creation
   * @default false
   */
  allowIDOnCreate?: boolean

  /**
   * Migration directory path
   * @default './src/migrations'
   */
  migrationDir?: string

  /**
   * Durable Object stub for database access (Workers environment)
   * If not provided, will attempt to use global DO context
   */
  doStub?: unknown

  /**
   * SQLite database instance (for direct SQLite usage)
   */
  db?: unknown

  /**
   * Hook called before schema initialization
   */
  beforeSchemaInit?: (args: { schema: unknown }) => Promise<unknown>

  /**
   * Hook called after schema initialization
   */
  afterSchemaInit?: (args: { schema: unknown }) => Promise<unknown>
}

// ============================================================================
// ADAPTER TYPES
// ============================================================================

/**
 * The dotdo adapter instance type
 * Extends BaseDatabaseAdapter with dotdo-specific properties
 */
export interface DotdoAdapter extends BaseDatabaseAdapter {
  /**
   * Adapter name identifier
   */
  name: 'dotdo'

  /**
   * Storage router for delegating to strategies
   */
  storageRouter: StorageRouter

  /**
   * The Things storage strategy
   */
  thingsStrategy: unknown

  /**
   * The Drizzle storage strategy
   */
  drizzleStrategy: unknown

  /**
   * Raw database access (SQLite instance)
   */
  db: unknown

  /**
   * Migration directory
   */
  migrationDir: string

  /**
   * Session storage for transactions
   */
  sessions: Map<string | number, unknown>

  /**
   * Payload instance (set during init)
   */
  payload: Payload

  /**
   * Migration manager instance
   */
  migrationManager: MigrationManager | null

  /**
   * Register migrations with the adapter
   */
  registerMigrations(migrations: Migration[]): void

  /**
   * Get type ID for a collection (Things mode)
   */
  getTypeId?: (collection: string) => Promise<number>
}

/**
 * Storage router interface - delegates operations to appropriate strategy
 */
export interface StorageRouter {
  /**
   * Get the storage strategy for a collection
   */
  getCollectionStrategy(collection: string): StorageMode

  /**
   * Get the storage strategy for a global
   */
  getGlobalStrategy(slug: string): StorageMode

  /**
   * Configuration for the router
   */
  config: StorageRouterConfig
}

// ============================================================================
// STORAGE ROUTER
// ============================================================================

/**
 * Create a storage router that determines which strategy handles each operation
 */
function createStorageRouter(config: StorageRouterConfig): StorageRouter {
  const defaultMode = config.storage ?? 'things'

  return {
    config,

    getCollectionStrategy(collection: string): StorageMode {
      return config.collections?.[collection] ?? defaultMode
    },

    getGlobalStrategy(slug: string): StorageMode {
      return config.globals?.[slug] ?? defaultMode
    },
  }
}

// ============================================================================
// NOT IMPLEMENTED ERROR
// ============================================================================

/**
 * Create a "not implemented" error for stubbed methods
 */
function notImplemented(method: string): never {
  throw new Error(
    `[dotdo adapter] Method '${method}' is not yet implemented. ` +
      `This is a scaffold - implement ThingsStrategy or DrizzleStrategy to enable this method.`
  )
}

// ============================================================================
// MAIN ADAPTER FUNCTION
// ============================================================================

/**
 * Create a dotdo database adapter for Payload CMS.
 *
 * The adapter supports two storage modes:
 * - 'things': MongoDB-style document storage using the Things table (schema-less)
 * - 'drizzle': Standard relational tables with migrations (typed)
 *
 * @param args - Adapter configuration
 * @returns DatabaseAdapterObj for Payload's buildConfig()
 *
 * @example
 * ```typescript
 * // All collections use Things storage (MongoDB-like)
 * import { buildConfig } from 'payload'
 * import { dotdoAdapter } from '@dotdo/payload'
 *
 * export default buildConfig({
 *   db: dotdoAdapter({
 *     storage: 'things'
 *   }),
 *   collections: [...]
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Mixed mode: default to Things, but use Drizzle for users and orders
 * export default buildConfig({
 *   db: dotdoAdapter({
 *     storage: 'things',
 *     collections: {
 *       users: 'drizzle',
 *       orders: 'drizzle'
 *     }
 *   }),
 *   collections: [...]
 * })
 * ```
 */
export function dotdoAdapter(args: DotdoAdapterArgs = {}): DatabaseAdapterObj<DotdoAdapter> {
  const {
    idType = 'text',
    allowIDOnCreate = false,
    migrationDir = './src/migrations',
    storage = 'things',
    collections: collectionModes,
    globals: globalModes,
    beforeSchemaInit,
    afterSchemaInit,
  } = args

  // Create the adapter factory function
  function adapter({ payload }: { payload: Payload }): DotdoAdapter {
    // Create storage router
    const storageRouter = createStorageRouter({
      storage,
      collections: collectionModes,
      globals: globalModes,
    })

    // Create the adapter instance with all BaseDatabaseAdapter methods
    const adapterInstance: DotdoAdapter = {
      // ─────────────────────────────────────────────────────────────────────
      // ADAPTER METADATA
      // ─────────────────────────────────────────────────────────────────────
      name: 'dotdo',
      payload,
      defaultIDType: idType,
      migrationDir,
      storageRouter,
      sessions: new Map(),

      // Placeholder for strategy instances (set during init)
      thingsStrategy: null,
      drizzleStrategy: null,
      db: null,
      migrationManager: null,

      /**
       * Register migrations with the adapter.
       * Call this after adapter initialization to load migrations.
       */
      registerMigrations(migrations: Migration[]): void {
        if (!this.migrationManager) {
          throw new Error('Migration manager not initialized. Call init() first.')
        }
        this.migrationManager.registerMigrations(migrations)
      },

      // ─────────────────────────────────────────────────────────────────────
      // LIFECYCLE METHODS
      // ─────────────────────────────────────────────────────────────────────

      /**
       * Initialize the adapter - connect to database, set up strategies
       */
      async init() {
        // TODO: Initialize SQLite database connection
        // TODO: Initialize ThingsStrategy and/or DrizzleStrategy based on config
        // TODO: Run schema hooks if provided

        if (beforeSchemaInit) {
          await beforeSchemaInit({ schema: {} })
        }

        // Placeholder for actual initialization
        // In real implementation:
        // 1. Get/create SQLite database from DO context
        // 2. Initialize strategies that are needed
        // 3. Run any schema migrations

        // Initialize migration manager
        // Note: In a real implementation, this.db would be set from DO context
        if (this.db) {
          const collections = payload.config?.collections || []
          this.migrationManager = new MigrationManager({
            db: this.db as any,
            strategy: storage,
            migrationDir,
            payload: payload as any,
            getTypeId: this.getTypeId,
            tablePrefix: '', // Set from config if using Drizzle
            collections: collections as PayloadCollection[],
          })
          await this.migrationManager.init()
        }

        if (afterSchemaInit) {
          await afterSchemaInit({ schema: {} })
        }
      },

      /**
       * Connect to database
       */
      async connect() {
        // For DO SQLite, connection is implicit
        // This may be a no-op or handle reconnection logic
      },

      /**
       * Destroy the adapter - clean up resources
       */
      async destroy() {
        // Clean up strategies
        // Close any open connections
        this.sessions.clear()
      },

      // ─────────────────────────────────────────────────────────────────────
      // CRUD OPERATIONS
      // ─────────────────────────────────────────────────────────────────────

      /**
       * Create a new document in a collection
       */
      async create(args) {
        notImplemented('create')
      },

      /**
       * Find multiple documents
       */
      async find(args) {
        notImplemented('find')
      },

      /**
       * Find a single document
       */
      async findOne(args) {
        notImplemented('findOne')
      },

      /**
       * Update a single document
       */
      async updateOne(args) {
        notImplemented('updateOne')
      },

      /**
       * Update multiple documents
       */
      async updateMany(args) {
        notImplemented('updateMany')
      },

      /**
       * Delete a single document
       */
      async deleteOne(args) {
        notImplemented('deleteOne')
      },

      /**
       * Delete multiple documents
       */
      async deleteMany(args) {
        notImplemented('deleteMany')
      },

      /**
       * Count documents matching a query
       */
      async count(args) {
        notImplemented('count')
      },

      /**
       * Find distinct values for a field
       */
      async findDistinct(args) {
        notImplemented('findDistinct')
      },

      /**
       * Insert or update a document
       */
      async upsert(args) {
        notImplemented('upsert')
      },

      // ─────────────────────────────────────────────────────────────────────
      // GLOBAL OPERATIONS
      // ─────────────────────────────────────────────────────────────────────

      /**
       * Create a global document
       */
      async createGlobal(args) {
        notImplemented('createGlobal')
      },

      /**
       * Find a global document
       */
      async findGlobal(args) {
        notImplemented('findGlobal')
      },

      /**
       * Update a global document
       */
      async updateGlobal(args) {
        notImplemented('updateGlobal')
      },

      // ─────────────────────────────────────────────────────────────────────
      // VERSION OPERATIONS
      // ─────────────────────────────────────────────────────────────────────

      /**
       * Create a version of a document
       */
      async createVersion(args) {
        notImplemented('createVersion')
      },

      /**
       * Find versions of a document
       */
      async findVersions(args) {
        notImplemented('findVersions')
      },

      /**
       * Update a version
       */
      async updateVersion(args) {
        notImplemented('updateVersion')
      },

      /**
       * Delete versions matching criteria
       */
      async deleteVersions(args) {
        notImplemented('deleteVersions')
      },

      /**
       * Count versions matching criteria
       */
      async countVersions(args) {
        notImplemented('countVersions')
      },

      // ─────────────────────────────────────────────────────────────────────
      // GLOBAL VERSION OPERATIONS
      // ─────────────────────────────────────────────────────────────────────

      /**
       * Create a version of a global
       */
      async createGlobalVersion(args) {
        notImplemented('createGlobalVersion')
      },

      /**
       * Find versions of a global
       */
      async findGlobalVersions(args) {
        notImplemented('findGlobalVersions')
      },

      /**
       * Update a global version
       */
      async updateGlobalVersion(args) {
        notImplemented('updateGlobalVersion')
      },

      /**
       * Count global versions
       */
      async countGlobalVersions(args) {
        notImplemented('countGlobalVersions')
      },

      // ─────────────────────────────────────────────────────────────────────
      // TRANSACTION OPERATIONS
      // ─────────────────────────────────────────────────────────────────────

      /**
       * Begin a new transaction
       */
      async beginTransaction() {
        // Generate transaction ID
        const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2)}`

        // Store transaction state
        this.sessions.set(id, {
          id,
          startedAt: Date.now(),
          operations: [],
        })

        return id
      },

      /**
       * Commit a transaction
       */
      async commitTransaction(id) {
        const session = this.sessions.get(id)
        if (!session) {
          throw new Error(`Transaction ${id} not found`)
        }

        // TODO: Apply pending operations atomically
        // For DO SQLite, this would be a real SQL transaction

        this.sessions.delete(id)
      },

      /**
       * Rollback a transaction
       */
      async rollbackTransaction(id) {
        const session = this.sessions.get(id)
        if (!session) {
          throw new Error(`Transaction ${id} not found`)
        }

        // Discard pending operations
        this.sessions.delete(id)
      },

      // ─────────────────────────────────────────────────────────────────────
      // MIGRATION OPERATIONS
      // ─────────────────────────────────────────────────────────────────────

      /**
       * Create a new migration file.
       *
       * Generates a migration template appropriate for the storage strategy:
       * - Things mode: JSON index operations + data transforms
       * - Drizzle mode: Schema DDL + data transforms
       *
       * @param args - Migration creation options (name, blank)
       * @returns Migration file info (name, path, content)
       */
      async createMigration(args: MigrateCreateOptions) {
        if (!this.migrationManager) {
          // Create temporary manager just for template generation
          const tempManager = new MigrationManager({
            db: {} as any,
            strategy: storage,
            migrationDir,
          })
          return tempManager.createMigration(args)
        }
        return this.migrationManager.createMigration(args)
      },

      /**
       * Run pending migrations.
       *
       * Executes all migrations that haven't been run yet, in timestamp order.
       * Migrations are tracked in the payload_migrations table.
       *
       * @param options - Migration options (only, dryRun, force)
       * @returns Result with ran, skipped, and pending migrations
       */
      async migrate(options?: MigrateOptions) {
        if (!this.migrationManager) {
          throw new Error(
            '[dotdo adapter] Migration manager not initialized. ' +
            'Ensure the database is connected and init() has been called.'
          )
        }
        return this.migrationManager.migrate(options)
      },

      /**
       * Rollback the last batch of migrations.
       *
       * Calls the down() function on each migration in the last batch,
       * in reverse timestamp order.
       *
       * @param options - Rollback options (steps, migration)
       * @returns Result with rolled back migrations
       */
      async migrateDown(options?: MigrateDownOptions) {
        if (!this.migrationManager) {
          throw new Error(
            '[dotdo adapter] Migration manager not initialized. ' +
            'Ensure the database is connected and init() has been called.'
          )
        }
        return this.migrationManager.migrateDown(options)
      },

      /**
       * Drop all tables and re-run all migrations.
       *
       * Warning: This will delete all data!
       *
       * @param options - Fresh options (seed)
       * @returns Result with dropped status and ran migrations
       */
      async migrateFresh(options?: MigrateFreshOptions) {
        if (!this.migrationManager) {
          throw new Error(
            '[dotdo adapter] Migration manager not initialized. ' +
            'Ensure the database is connected and init() has been called.'
          )
        }
        return this.migrationManager.migrateFresh(options)
      },

      /**
       * Rollback all migrations and re-run them.
       *
       * Equivalent to migrateReset() followed by migrate().
       *
       * @returns Result with rolled back and re-ran migrations
       */
      async migrateRefresh() {
        if (!this.migrationManager) {
          throw new Error(
            '[dotdo adapter] Migration manager not initialized. ' +
            'Ensure the database is connected and init() has been called.'
          )
        }
        return this.migrationManager.migrateRefresh()
      },

      /**
       * Rollback all migrations.
       *
       * Calls the down() function on all applied migrations,
       * in reverse timestamp order.
       *
       * @returns Result with rolled back migrations
       */
      async migrateReset() {
        if (!this.migrationManager) {
          throw new Error(
            '[dotdo adapter] Migration manager not initialized. ' +
            'Ensure the database is connected and init() has been called.'
          )
        }
        return this.migrationManager.migrateReset()
      },

      /**
       * Get the status of all migrations.
       *
       * Shows which migrations have been run and which are pending.
       *
       * @returns Status result with total, ran, pending counts and migration list
       */
      async migrateStatus() {
        if (!this.migrationManager) {
          throw new Error(
            '[dotdo adapter] Migration manager not initialized. ' +
            'Ensure the database is connected and init() has been called.'
          )
        }
        return this.migrationManager.migrateStatus()
      },

      // ─────────────────────────────────────────────────────────────────────
      // QUERY OPERATIONS
      // ─────────────────────────────────────────────────────────────────────

      /**
       * Query draft documents
       */
      async queryDrafts(args) {
        notImplemented('queryDrafts')
      },
    }

    return adapterInstance
  }

  // Return the DatabaseAdapterObj that Payload expects
  return {
    name: 'dotdo',
    defaultIDType: idType,
    allowIDOnCreate,
    init: adapter,
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { createStorageRouter }

// Re-export migration types and utilities
export {
  MigrationManager,
  type Migration,
  type MigrateOptions,
  type MigrateDownOptions,
  type MigrateFreshOptions,
  type MigrateCreateOptions,
  type MigrateResult,
  type MigrateDownResult,
  type MigrateStatusResult,
  type MigrateCreateResult,
  type MigrateFreshResult,
  type MigrateRefreshResult,
} from '../migrations'

export type {
  MigrateUpArgs,
  MigrateDownArgs,
  ThingsMigrationHelpers,
  DrizzleMigrationHelpers,
} from '../migrations'
