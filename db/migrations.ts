// SQLite Migration System for @dotdo/db
// Provides versioned schema migrations with rollback support

import type { SqlStorage } from './sqlite'

/**
 * Represents a database migration
 */
export interface Migration {
  /** Unique version number (must be sequential positive integers) */
  version: number
  /** Human-readable name for the migration */
  name: string
  /** SQL to apply the migration */
  up: string
  /** SQL to rollback the migration (optional but recommended) */
  down?: string
}

/**
 * State of a migration that has been applied
 */
export interface MigrationState {
  version: number
  name: string
  applied_at: number
}

/**
 * Result of running migrations
 */
export interface MigrationResult {
  /** Number of migrations successfully applied */
  applied: number
  /** Number of migrations skipped (already applied) */
  skipped: number
  /** Any errors that occurred */
  errors: Array<{
    version: number
    name: string
    error: string
  }>
}

/**
 * Result of rolling back migrations
 */
export interface RollbackResult {
  /** Number of migrations rolled back */
  rolledBack: number
  /** Version that was rolled back (or null if none) */
  version: number | null
}

/**
 * Helper to create a migration with type safety
 */
export function createMigration(migration: Migration): Migration {
  return migration
}

/**
 * MigrationRunner - Manages schema migrations for SQLite
 *
 * Features:
 * - Version tracking in _migrations table
 * - Ordered migration execution
 * - Rollback support
 * - Idempotent (safe to run multiple times)
 */
export class MigrationRunner {
  private sql: SqlStorage
  private initialized = false

  constructor(sql: SqlStorage) {
    this.sql = sql
  }

  /**
   * Initialize the migration system by creating the _migrations table
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `)

    this.initialized = true
  }

  /**
   * Get the current schema version (highest applied migration)
   */
  async getCurrentVersion(): Promise<number> {
    const row = await this.sql
      .prepare('SELECT version FROM _migrations ORDER BY version DESC LIMIT 1')
      .bind()
      .first()

    return row ? (row.version as number) : 0
  }

  /**
   * Get all applied migrations in order
   */
  async getAppliedMigrations(): Promise<MigrationState[]> {
    const result = await this.sql
      .prepare('SELECT version, name, applied_at FROM _migrations ORDER BY version ASC')
      .bind()
      .all()

    return result.results as MigrationState[]
  }

  /**
   * Check if a specific migration has been applied
   */
  async isMigrationApplied(version: number): Promise<boolean> {
    const row = await this.sql
      .prepare('SELECT version FROM _migrations WHERE version = ?')
      .bind(version)
      .first()

    return row !== null
  }

  /**
   * Get migrations that haven't been applied yet
   */
  async getPendingMigrations(migrations: Migration[]): Promise<Migration[]> {
    const applied = await this.getAppliedMigrations()
    const appliedVersions = new Set(applied.map((m) => m.version))

    return migrations
      .filter((m) => !appliedVersions.has(m.version))
      .sort((a, b) => a.version - b.version)
  }

  /**
   * Run all pending migrations
   *
   * Migrations are executed in version order, regardless of the order
   * they are provided. Already-applied migrations are skipped.
   */
  async runMigrations(migrations: Migration[]): Promise<MigrationResult> {
    const result: MigrationResult = {
      applied: 0,
      skipped: 0,
      errors: [],
    }

    // Sort migrations by version
    const sorted = [...migrations].sort((a, b) => a.version - b.version)

    for (const migration of sorted) {
      // Check if already applied
      const isApplied = await this.isMigrationApplied(migration.version)

      if (isApplied) {
        result.skipped++
        continue
      }

      // Apply the migration
      try {
        this.sql.exec(migration.up)

        // Record the migration
        await this.sql
          .prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .bind(migration.version, migration.name, Date.now())
          .run()

        result.applied++
      } catch (error) {
        result.errors.push({
          version: migration.version,
          name: migration.name,
          error: error instanceof Error ? error.message : String(error),
        })
        // Stop on first error
        break
      }
    }

    return result
  }

  /**
   * Rollback the most recent migration
   */
  async rollback(migrations: Migration[]): Promise<RollbackResult> {
    const currentVersion = await this.getCurrentVersion()

    if (currentVersion === 0) {
      return { rolledBack: 0, version: null }
    }

    // Find the migration to rollback
    const migration = migrations.find((m) => m.version === currentVersion)

    if (!migration) {
      throw new Error(`Migration for version ${currentVersion} not found in provided migrations`)
    }

    if (!migration.down) {
      throw new Error(
        `Migration ${migration.name} (version ${migration.version}) does not support rollback`
      )
    }

    // Execute rollback
    this.sql.exec(migration.down)

    // Remove from _migrations table
    await this.sql
      .prepare('DELETE FROM _migrations WHERE version = ?')
      .bind(currentVersion)
      .run()

    return { rolledBack: 1, version: currentVersion }
  }

  /**
   * Rollback to a specific version (exclusive)
   *
   * Rolls back all migrations with version > targetVersion
   */
  async rollbackTo(targetVersion: number, migrations: Migration[]): Promise<RollbackResult> {
    let rolledBack = 0
    let currentVersion = await this.getCurrentVersion()

    // Create a map for quick migration lookup
    const migrationMap = new Map(migrations.map((m) => [m.version, m]))

    while (currentVersion > targetVersion) {
      const migration = migrationMap.get(currentVersion)

      if (!migration) {
        throw new Error(`Migration for version ${currentVersion} not found in provided migrations`)
      }

      if (!migration.down) {
        throw new Error(
          `Migration ${migration.name} (version ${migration.version}) does not support rollback`
        )
      }

      // Execute rollback
      this.sql.exec(migration.down)

      // Remove from _migrations table
      await this.sql
        .prepare('DELETE FROM _migrations WHERE version = ?')
        .bind(currentVersion)
        .run()

      rolledBack++
      currentVersion = await this.getCurrentVersion()
    }

    return {
      rolledBack,
      version: rolledBack > 0 ? currentVersion + 1 : null,
    }
  }
}

/**
 * Built-in migrations for the core @dotdo/db schema
 *
 * These define the standard things, events, and relationships tables.
 */
export const coreMigrations: Migration[] = [
  createMigration({
    version: 1,
    name: 'create_things_table',
    up: `
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
      CREATE INDEX IF NOT EXISTS idx_things_created_at ON things(created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_things_created_at;
      DROP INDEX IF EXISTS idx_things_type;
      DROP TABLE IF EXISTS things;
    `,
  }),
  createMigration({
    version: 2,
    name: 'create_events_table',
    up: `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        source TEXT,
        correlation_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
      CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_timestamp;
      DROP INDEX IF EXISTS idx_events_correlation_id;
      DROP INDEX IF EXISTS idx_events_source;
      DROP INDEX IF EXISTS idx_events_type;
      DROP TABLE IF EXISTS events;
    `,
  }),
  createMigration({
    version: 3,
    name: 'create_relationships_table',
    up: `
      CREATE TABLE IF NOT EXISTS relationships (
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (subject, predicate, object)
      );
      CREATE INDEX IF NOT EXISTS idx_relationships_subject ON relationships(subject);
      CREATE INDEX IF NOT EXISTS idx_relationships_predicate ON relationships(predicate);
      CREATE INDEX IF NOT EXISTS idx_relationships_object ON relationships(object);
    `,
    down: `
      DROP INDEX IF EXISTS idx_relationships_object;
      DROP INDEX IF EXISTS idx_relationships_predicate;
      DROP INDEX IF EXISTS idx_relationships_subject;
      DROP TABLE IF EXISTS relationships;
    `,
  }),
]
