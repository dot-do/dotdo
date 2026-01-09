/**
 * Migration Manager
 *
 * Central class for managing migrations across both Things and Drizzle strategies.
 * Handles loading, running, and tracking migrations with proper transaction support.
 *
 * @module @dotdo/payload/migrations/manager
 */

import type { StorageMode } from '../strategies/types'
import type { PayloadCollection } from '../adapter/types'
import {
  ensureMigrationsTable,
  recordMigration,
  removeMigration,
  getAppliedMigrations,
  getCurrentBatch,
  getLastBatch,
  getMigrationsForBatch,
  clearMigrationRecords,
  getAppliedMigrationNames,
  type AppliedMigration,
  type TrackingDb,
} from './tracking'
import {
  generateMigration,
  parseTimestampFromName,
  type MigrationFileInfo,
} from './templates'
import {
  buildMigrateArgs,
  createExecuteFunction,
  type MigrationPayload,
  type MigrateUpArgs,
  type MigrateDownArgs,
} from './helpers'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Migration definition loaded from a file
 */
export interface Migration {
  /** Migration name (unique identifier) */
  name: string
  /** Timestamp for ordering */
  timestamp: number
  /** Up migration function */
  up: (args: MigrateUpArgs) => Promise<void>
  /** Down migration function (optional but recommended) */
  down?: (args: MigrateDownArgs) => Promise<void>
}

/**
 * Migration status entry
 */
export interface MigrationStatus {
  /** Migration name */
  name: string
  /** Whether the migration has been run */
  ran: boolean
  /** Batch number if ran */
  batch?: number
  /** When it was executed */
  ranAt?: string
}

/**
 * Result of migrate operation
 */
export interface MigrateResult {
  /** Migrations that were run */
  ran: Array<{ name: string }>
  /** Migrations that were already applied */
  skipped: Array<{ name: string }>
  /** Migrations still pending */
  pending: Array<{ name: string }>
  /** Errors encountered */
  errors?: Array<{ name: string; error: Error }>
}

/**
 * Result of migrateDown operation
 */
export interface MigrateDownResult {
  /** Migrations that were rolled back */
  rolledBack: Array<{ name: string }>
}

/**
 * Result of migrateStatus operation
 */
export interface MigrateStatusResult {
  /** Total number of migrations */
  total: number
  /** Number of applied migrations */
  ran: number
  /** Number of pending migrations */
  pending: number
  /** Migration status entries */
  migrations: MigrationStatus[]
}

/**
 * Result of migrateCreate operation
 */
export interface MigrateCreateResult {
  /** Migration name */
  name: string
  /** File path */
  path: string
  /** File content */
  content: string
}

/**
 * Result of migrateFresh operation
 */
export interface MigrateFreshResult {
  /** Whether tables were dropped */
  dropped: boolean
  /** Migrations that were run */
  ran: Array<{ name: string }>
}

/**
 * Result of migrateRefresh operation
 */
export interface MigrateRefreshResult {
  /** Migrations that were rolled back */
  rolledBack: Array<{ name: string }>
  /** Migrations that were re-run */
  ran: Array<{ name: string }>
}

/**
 * Options for migrate operation
 */
export interface MigrateOptions {
  /** Only run a specific migration */
  only?: string
  /** Dry run - don't actually run migrations */
  dryRun?: boolean
  /** Continue on error */
  force?: boolean
}

/**
 * Options for migrateDown operation
 */
export interface MigrateDownOptions {
  /** Number of batches to roll back */
  steps?: number
  /** Specific migration to roll back */
  migration?: string
}

/**
 * Options for migrateFresh operation
 */
export interface MigrateFreshOptions {
  /** Run seeder after migrations */
  seed?: boolean
}

/**
 * Options for migrateCreate operation
 */
export interface MigrateCreateOptions {
  /** Migration name */
  name: string
  /** Generate blank template */
  blank?: boolean
}

/**
 * Configuration for MigrationManager
 */
export interface MigrationManagerConfig {
  /** Database instance */
  db: TrackingDb
  /** Storage strategy */
  strategy: StorageMode
  /** Migration directory path */
  migrationDir: string
  /** Payload instance (for data transforms) */
  payload?: MigrationPayload
  /** Function to get type ID for a collection (Things mode) */
  getTypeId?: (collection: string) => Promise<number>
  /** Table prefix (Drizzle mode) */
  tablePrefix?: string
  /** Collections config (for fresh/reset) */
  collections?: PayloadCollection[]
  /** Drop tables function (for fresh) */
  dropAllTables?: () => Promise<void>
  /** Seed function */
  seedFunction?: () => Promise<void>
}

// ============================================================================
// MIGRATION MANAGER
// ============================================================================

/**
 * Migration Manager
 *
 * Handles all migration operations for the Payload database adapter.
 */
export class MigrationManager {
  private db: TrackingDb
  private strategy: StorageMode
  private migrationDir: string
  private payload?: MigrationPayload
  private getTypeId?: (collection: string) => Promise<number>
  private tablePrefix: string
  private collections: PayloadCollection[]
  private dropAllTables?: () => Promise<void>
  private seedFunction?: () => Promise<void>

  /** Registered migrations (loaded from files) */
  private migrations: Map<string, Migration> = new Map()

  /** Whether tracking table has been initialized */
  private initialized = false

  constructor(config: MigrationManagerConfig) {
    this.db = config.db
    this.strategy = config.strategy
    this.migrationDir = config.migrationDir
    this.payload = config.payload
    this.getTypeId = config.getTypeId
    this.tablePrefix = config.tablePrefix ?? ''
    this.collections = config.collections ?? []
    this.dropAllTables = config.dropAllTables
    this.seedFunction = config.seedFunction
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the migration manager.
   * Creates the tracking table if it doesn't exist.
   */
  async init(): Promise<void> {
    if (this.initialized) return

    await ensureMigrationsTable(this.db)
    this.initialized = true
  }

  /**
   * Register migrations to be managed.
   *
   * @param migrations - Array of migration objects
   */
  registerMigrations(migrations: Migration[]): void {
    for (const migration of migrations) {
      if (this.migrations.has(migration.name)) {
        throw new Error(`Migration '${migration.name}' is already registered`)
      }
      this.migrations.set(migration.name, migration)
    }
  }

  /**
   * Clear registered migrations.
   */
  clearMigrations(): void {
    this.migrations.clear()
  }

  /**
   * Get all registered migrations sorted by timestamp.
   */
  getMigrations(): Migration[] {
    return Array.from(this.migrations.values()).sort((a, b) => a.timestamp - b.timestamp)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MIGRATION OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new migration file.
   *
   * @param options - Creation options
   * @returns Migration file info
   */
  async createMigration(options: MigrateCreateOptions): Promise<MigrateCreateResult> {
    const fileInfo = generateMigration({
      name: options.name,
      strategy: this.strategy,
      blank: options.blank,
      migrationDir: this.migrationDir,
    })

    return {
      name: fileInfo.name,
      path: fileInfo.path,
      content: fileInfo.content,
    }
  }

  /**
   * Run pending migrations.
   *
   * @param options - Migration options
   * @returns Result of migration
   */
  async migrate(options: MigrateOptions = {}): Promise<MigrateResult> {
    await this.init()

    const result: MigrateResult = {
      ran: [],
      skipped: [],
      pending: [],
    }

    // Get applied migration names
    const appliedNames = await getAppliedMigrationNames(this.db)

    // Get sorted migrations
    const allMigrations = this.getMigrations()

    // Separate applied and pending
    const pendingMigrations: Migration[] = []

    for (const migration of allMigrations) {
      if (appliedNames.has(migration.name)) {
        result.skipped.push({ name: migration.name })
      } else {
        pendingMigrations.push(migration)
      }
    }

    // Filter by --only option
    const migrationsToRun = options.only
      ? pendingMigrations.filter((m) => m.name === options.only)
      : pendingMigrations

    // Handle dry run
    if (options.dryRun) {
      result.pending = migrationsToRun.map((m) => ({ name: m.name }))
      return result
    }

    // Get next batch number
    const currentBatch = await getCurrentBatch(this.db)
    const batch = currentBatch + 1

    // Build migration args
    const migrateArgs = this.buildMigrateArgs()

    // Run migrations
    const errors: Array<{ name: string; error: Error }> = []

    for (const migration of migrationsToRun) {
      try {
        // Run up migration
        await migration.up(migrateArgs)

        // Record as applied
        await recordMigration(this.db, migration.name, batch)

        result.ran.push({ name: migration.name })
      } catch (error) {
        if (options.force) {
          errors.push({ name: migration.name, error: error as Error })
        } else {
          // Rollback this batch on failure
          for (const ran of result.ran) {
            await removeMigration(this.db, ran.name)
          }

          // Re-throw with context
          const enhancedError = new Error((error as Error).message) as Error & {
            migration: string
          }
          enhancedError.migration = migration.name
          throw enhancedError
        }
      }
    }

    if (errors.length > 0) {
      result.errors = errors
    }

    // Calculate remaining pending
    const ranNames = new Set(result.ran.map((r) => r.name))
    result.pending = pendingMigrations
      .filter((m) => !ranNames.has(m.name))
      .map((m) => ({ name: m.name }))

    return result
  }

  /**
   * Roll back migrations.
   *
   * @param options - Rollback options
   * @returns Rollback result
   */
  async migrateDown(options: MigrateDownOptions = {}): Promise<MigrateDownResult> {
    await this.init()

    const result: MigrateDownResult = {
      rolledBack: [],
    }

    // Handle rolling back specific migration
    if (options.migration) {
      const migration = this.migrations.get(options.migration)
      if (!migration) {
        throw new Error(`Migration '${options.migration}' not found`)
      }
      if (!migration.down) {
        throw new Error(`Migration '${options.migration}' has no down function`)
      }

      const migrateArgs = this.buildMigrateArgs()
      await migration.down(migrateArgs)
      await removeMigration(this.db, migration.name)
      result.rolledBack.push({ name: migration.name })
      return result
    }

    // Get last batch to roll back
    const lastBatch = await getLastBatch(this.db)
    if (lastBatch === 0) {
      return result // Nothing to roll back
    }

    // Determine how many batches to roll back
    const steps = options.steps ?? 1
    const targetBatch = Math.max(0, lastBatch - steps + 1)

    // Get migrations to roll back (in reverse order)
    const migrationsToRollback: AppliedMigration[] = []

    for (let batch = lastBatch; batch >= targetBatch; batch--) {
      const batchMigrations = await getMigrationsForBatch(this.db, batch)
      migrationsToRollback.push(...batchMigrations)
    }

    // Build migration args
    const migrateArgs = this.buildMigrateArgs()

    // Roll back in reverse timestamp order
    const sortedRollbacks = migrationsToRollback.sort((a, b) => {
      const aTs = parseTimestampFromName(a.name)
      const bTs = parseTimestampFromName(b.name)
      return bTs - aTs // Most recent first
    })

    for (const applied of sortedRollbacks) {
      const migration = this.migrations.get(applied.name)
      if (!migration) {
        throw new Error(`Migration '${applied.name}' not found in registry`)
      }
      if (!migration.down) {
        throw new Error(`Migration '${applied.name}' has no down function`)
      }

      await migration.down(migrateArgs)
      await removeMigration(this.db, applied.name)
      result.rolledBack.push({ name: applied.name })
    }

    return result
  }

  /**
   * Drop all tables and re-run all migrations.
   *
   * @param options - Fresh options
   * @returns Fresh result
   */
  async migrateFresh(options: MigrateFreshOptions = {}): Promise<MigrateFreshResult> {
    await this.init()

    // Drop all tables
    if (this.dropAllTables) {
      await this.dropAllTables()
    } else {
      // Default: execute DROP TABLE for each collection
      const execute = createExecuteFunction(this.db)
      for (const collection of this.collections) {
        const tableName = `${this.tablePrefix}${collection.slug}`
        try {
          await execute(`DROP TABLE IF EXISTS "${tableName}"`)
          await execute(`DROP TABLE IF EXISTS "${tableName}_versions"`)
        } catch (error) {
          // Table may not exist
        }
      }
    }

    // Clear migration records
    await clearMigrationRecords(this.db)

    // Re-initialize tracking table
    await ensureMigrationsTable(this.db)

    // Run all migrations
    const migrateResult = await this.migrate()

    // Run seeder if requested
    if (options.seed && this.seedFunction) {
      await this.seedFunction()
    }

    return {
      dropped: true,
      ran: migrateResult.ran,
    }
  }

  /**
   * Roll back all migrations and re-run them.
   *
   * @returns Refresh result
   */
  async migrateRefresh(): Promise<MigrateRefreshResult> {
    await this.init()

    const result: MigrateRefreshResult = {
      rolledBack: [],
      ran: [],
    }

    // Roll back all migrations
    const resetResult = await this.migrateReset()
    result.rolledBack = resetResult.rolledBack

    // Re-run all migrations
    const migrateResult = await this.migrate()
    result.ran = migrateResult.ran

    return result
  }

  /**
   * Roll back all migrations.
   *
   * @returns Reset result
   */
  async migrateReset(): Promise<MigrateDownResult> {
    await this.init()

    const result: MigrateDownResult = {
      rolledBack: [],
    }

    // Get all applied migrations
    const applied = await getAppliedMigrations(this.db)
    if (applied.length === 0) {
      return result
    }

    // Build migration args
    const migrateArgs = this.buildMigrateArgs()

    // Roll back in reverse timestamp order
    const sortedApplied = applied.sort((a, b) => {
      const aTs = parseTimestampFromName(a.name)
      const bTs = parseTimestampFromName(b.name)
      return bTs - aTs // Most recent first
    })

    for (const applied of sortedApplied) {
      const migration = this.migrations.get(applied.name)
      if (!migration) {
        // Skip migrations not in registry
        await removeMigration(this.db, applied.name)
        continue
      }

      if (migration.down) {
        await migration.down(migrateArgs)
      }

      await removeMigration(this.db, applied.name)
      result.rolledBack.push({ name: applied.name })
    }

    return result
  }

  /**
   * Get the status of all migrations.
   *
   * @returns Migration status
   */
  async migrateStatus(): Promise<MigrateStatusResult> {
    await this.init()

    // Get applied migrations
    const applied = await getAppliedMigrations(this.db)
    const appliedMap = new Map(applied.map((a) => [a.name, a]))

    // Build status for all migrations
    const allMigrations = this.getMigrations()
    const migrations: MigrationStatus[] = []

    let ranCount = 0
    let pendingCount = 0

    for (const migration of allMigrations) {
      const appliedMigration = appliedMap.get(migration.name)

      if (appliedMigration) {
        migrations.push({
          name: migration.name,
          ran: true,
          batch: appliedMigration.batch,
          ranAt: appliedMigration.executedAt,
        })
        ranCount++
      } else {
        migrations.push({
          name: migration.name,
          ran: false,
        })
        pendingCount++
      }
    }

    return {
      total: migrations.length,
      ran: ranCount,
      pending: pendingCount,
      migrations,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build migration arguments for up/down functions.
   */
  private buildMigrateArgs(): MigrateUpArgs {
    if (!this.payload) {
      throw new Error('Payload instance required to run migrations')
    }

    return buildMigrateArgs(this.strategy, this.db, this.payload, {
      getTypeId: this.getTypeId,
      tablePrefix: this.tablePrefix,
    })
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a MigrationManager instance.
 *
 * @param config - Manager configuration
 * @returns Configured MigrationManager
 */
export function createMigrationManager(config: MigrationManagerConfig): MigrationManager {
  return new MigrationManager(config)
}
