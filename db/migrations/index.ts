/**
 * Schema Migration System
 *
 * Provides versioned, ordered migrations for SQLite schemas in Durable Objects.
 *
 * Features:
 * - Version tracking in schema_migrations table
 * - Idempotent execution (migrations only run once)
 * - Ordered execution by version number
 * - Optional target version for partial migrations
 * - Migration history with timestamps
 *
 * Usage:
 * ```typescript
 * // In DO constructor or onStart
 * const runner = new MigrationRunner(ctx.storage.sql)
 * await runner.migrate()
 * ```
 */

import type { SqlStorage } from '@cloudflare/workers-types'

// ============================================================================
// Types
// ============================================================================

/**
 * A single migration definition
 */
export interface Migration {
  /** Unique version number (must be sequential, starting from 1) */
  version: number
  /** Human-readable name for the migration */
  name: string
  /** Function to apply the migration (runs inside transaction) */
  up: (sql: SqlStorage) => void
  /** Optional rollback function (not currently used, reserved for future) */
  down?: (sql: SqlStorage) => void
}

/**
 * Result of running migrations
 */
export interface MigrationResult {
  /** Whether all migrations succeeded */
  success: boolean
  /** Number of migrations applied in this run */
  migrationsRun: number
  /** List of version numbers that were applied */
  appliedVersions: number[]
  /** Error message if something failed */
  error?: string
  /** Current schema version after migration */
  currentVersion: number
}

/**
 * Information about a pending migration
 */
export interface PendingMigration {
  version: number
  name: string
}

// ============================================================================
// Core Tables Migration
// ============================================================================

/**
 * All migrations in order.
 * Each migration has a unique version number and is applied exactly once.
 *
 * IMPORTANT: Never modify existing migrations. Only add new ones.
 */
export const migrations: Migration[] = [
  // Version 1: Core state table (DOCore)
  {
    version: 1,
    name: 'create_state_table',
    up: (sql) => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS state (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `)
    },
  },

  // Version 2: Things table with full schema (DOCore)
  {
    version: 2,
    name: 'create_things_table',
    up: (sql) => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS things (
          id TEXT PRIMARY KEY,
          type TEXT,
          data TEXT,
          created_at INTEGER,
          updated_at INTEGER,
          version INTEGER DEFAULT 1
        )
      `)
      sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_things_type ON things(type)
      `)
    },
  },

  // Version 3: Schedules table (DOCore)
  {
    version: 3,
    name: 'create_schedules_table',
    up: (sql) => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS schedules (
          cron TEXT PRIMARY KEY,
          handler_id TEXT,
          registered_at INTEGER
        )
      `)
    },
  },

  // Version 4: Action log table (DOCore)
  {
    version: 4,
    name: 'create_action_log_table',
    up: (sql) => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS action_log (
          step_id TEXT PRIMARY KEY,
          status TEXT,
          result TEXT,
          error TEXT,
          created_at INTEGER
        )
      `)
    },
  },

  // Version 5: Semantic tables - nouns (DOSemantic)
  {
    version: 5,
    name: 'create_nouns_table',
    up: (sql) => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS nouns (
          name TEXT PRIMARY KEY,
          singular TEXT,
          plural TEXT
        )
      `)
    },
  },

  // Version 6: Semantic tables - verbs (DOSemantic)
  {
    version: 6,
    name: 'create_verbs_table',
    up: (sql) => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS verbs (
          name TEXT PRIMARY KEY,
          base TEXT,
          past TEXT,
          present TEXT,
          gerund TEXT
        )
      `)
    },
  },

  // Version 7: Semantic tables - edges (DOSemantic)
  {
    version: 7,
    name: 'create_edges_table',
    up: (sql) => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_id TEXT,
          from_type TEXT,
          to_id TEXT,
          to_type TEXT,
          verb TEXT
        )
      `)
      sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id, from_type)
      `)
      sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id, to_type)
      `)
    },
  },

  // Version 8: Storage layer - L2 things (DOStorage)
  {
    version: 8,
    name: 'create_l2_things_table',
    up: (sql) => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS l2_things (
          id TEXT PRIMARY KEY,
          type TEXT,
          version INTEGER DEFAULT 1,
          data TEXT,
          updated_at INTEGER
        )
      `)
      sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_l2_things_type ON l2_things(type)
      `)
    },
  },
]

// ============================================================================
// Migration Runner
// ============================================================================

/**
 * MigrationRunner - Executes schema migrations in order
 *
 * Design principles:
 * - Migrations are idempotent (safe to run multiple times)
 * - Migrations run in version order
 * - Each migration runs exactly once
 * - Version tracking stored in schema_migrations table
 */
export class MigrationRunner {
  private sql: SqlStorage
  private migrationsList: Migration[]

  constructor(sql: SqlStorage, customMigrations?: Migration[]) {
    this.sql = sql
    this.migrationsList = customMigrations ?? migrations
  }

  /**
   * Ensure the schema_migrations table exists
   */
  private ensureMigrationsTable(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `)
  }

  /**
   * Get the current schema version (highest applied migration)
   */
  getCurrentVersion(): number {
    this.ensureMigrationsTable()

    const result = this.sql
      .exec('SELECT MAX(version) as max_version FROM schema_migrations')
      .toArray()

    if (result.length === 0 || result[0].max_version === null) {
      return 0
    }

    return result[0].max_version as number
  }

  /**
   * Get list of migrations that haven't been applied yet
   */
  getPendingMigrations(): PendingMigration[] {
    const currentVersion = this.getCurrentVersion()

    return this.migrationsList
      .filter((m) => m.version > currentVersion)
      .map((m) => ({ version: m.version, name: m.name }))
      .sort((a, b) => a.version - b.version)
  }

  /**
   * Run all pending migrations up to optional target version
   *
   * @param targetVersion - Optional maximum version to migrate to
   * @returns MigrationResult with details of what was done
   */
  migrate(targetVersion?: number): MigrationResult {
    this.ensureMigrationsTable()

    const currentVersion = this.getCurrentVersion()
    const appliedVersions: number[] = []

    // Determine which migrations to run
    const pendingMigrations = this.migrationsList
      .filter((m) => m.version > currentVersion)
      .filter((m) => targetVersion === undefined || m.version <= targetVersion)
      .sort((a, b) => a.version - b.version)

    // Apply each migration in order
    for (const migration of pendingMigrations) {
      try {
        // Run the migration
        migration.up(this.sql)

        // Record that it was applied
        this.sql.exec(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          migration.version,
          migration.name,
          Date.now()
        )

        appliedVersions.push(migration.version)
      } catch (error) {
        // Migration failed - return error
        return {
          success: false,
          migrationsRun: appliedVersions.length,
          appliedVersions,
          error: `Migration ${migration.version} (${migration.name}) failed: ${(error as Error).message}`,
          currentVersion: this.getCurrentVersion(),
        }
      }
    }

    return {
      success: true,
      migrationsRun: appliedVersions.length,
      appliedVersions,
      currentVersion: this.getCurrentVersion(),
    }
  }

  /**
   * Get migration history (all applied migrations)
   */
  getHistory(): Array<{ version: number; name: string; applied_at: number }> {
    this.ensureMigrationsTable()

    const result = this.sql
      .exec('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
      .toArray()

    return result.map((row) => ({
      version: row.version as number,
      name: row.name as string,
      applied_at: row.applied_at as number,
    }))
  }
}

// ============================================================================
// Helper for DO Integration
// ============================================================================

/**
 * Run migrations on a DO's SQLite storage
 *
 * Call this in the DO constructor or onStart hook:
 * ```typescript
 * constructor(ctx: DurableObjectState, env: Env) {
 *   super(ctx, env)
 *   runMigrations(ctx.storage.sql)
 * }
 * ```
 */
export function runMigrations(sql: SqlStorage, targetVersion?: number): MigrationResult {
  const runner = new MigrationRunner(sql)
  return runner.migrate(targetVersion)
}

/**
 * Get current schema version from DO's SQLite storage
 */
export function getMigrationVersion(sql: SqlStorage): number {
  const runner = new MigrationRunner(sql)
  return runner.getCurrentVersion()
}

/**
 * Get pending migrations for DO's SQLite storage
 */
export function getPendingMigrations(sql: SqlStorage): PendingMigration[] {
  const runner = new MigrationRunner(sql)
  return runner.getPendingMigrations()
}
