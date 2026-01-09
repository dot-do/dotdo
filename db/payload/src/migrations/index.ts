/**
 * Migration System for @dotdo/payload
 *
 * Provides full migration support for both Things and Drizzle strategies:
 * - createMigration: Generate migration file
 * - migrate: Run pending up migrations
 * - migrateDown: Rollback last batch
 * - migrateFresh: Drop all and re-run
 * - migrateReset: Rollback all migrations
 * - migrateRefresh: Reset + migrate
 * - migrateStatus: Show migration status
 *
 * @module @dotdo/payload/migrations
 */

// ============================================================================
// MANAGER
// ============================================================================

export {
  MigrationManager,
  createMigrationManager,
  type Migration,
  type MigrationStatus,
  type MigrateResult,
  type MigrateDownResult,
  type MigrateStatusResult,
  type MigrateCreateResult,
  type MigrateFreshResult,
  type MigrateRefreshResult,
  type MigrateOptions,
  type MigrateDownOptions,
  type MigrateFreshOptions,
  type MigrateCreateOptions,
  type MigrationManagerConfig,
} from './manager'

// ============================================================================
// TRACKING
// ============================================================================

export {
  MIGRATIONS_TABLE,
  CREATE_MIGRATIONS_TABLE_SQL,
  ensureMigrationsTable,
  recordMigration,
  removeMigration,
  getAppliedMigrations,
  getCurrentBatch,
  getLastBatch,
  getMigrationsForBatch,
  clearMigrationRecords,
  getAppliedMigrationNames,
  getMigrationState,
  isMigrationApplied,
  type AppliedMigration,
  type MigrationState,
  type TrackingDb,
} from './tracking'

// ============================================================================
// TEMPLATES
// ============================================================================

export {
  generateMigration,
  generateMigrationTemplate,
  generateThingsMigrationTemplate,
  generateDrizzleMigrationTemplate,
  generateTimestamp,
  sanitizeMigrationName,
  parseTimestampFromName,
  type MigrationFileInfo,
  type GenerateMigrationOptions,
} from './templates'

// ============================================================================
// HELPERS
// ============================================================================

export {
  createThingsMigrationHelpers,
  createDrizzleMigrationHelpers,
  createExecuteFunction,
  createMigrationHelpers,
  buildMigrateArgs,
  type BaseMigrateArgs,
  type ThingsMigrateArgs,
  type DrizzleMigrateArgs,
  type MigrateUpArgs,
  type MigrateDownArgs,
  type MigrationPayload,
  type ExecuteFunction,
  type ThingsMigrationHelpers,
  type DrizzleMigrationHelpers,
  type CreateJsonIndexOptions,
  type DropJsonIndexOptions,
  type BulkUpdateOptions,
  type BulkUpdateResult,
} from './helpers'
