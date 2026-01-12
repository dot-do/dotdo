/**
 * @dotdo/migration-engine - Database Migration System
 *
 * A comprehensive database migration system with distributed locking,
 * checksum validation, and schema snapshots.
 *
 * @packageDocumentation
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Migration definition
 */
export interface Migration {
  /** Unique version identifier (typically timestamp) */
  version: string
  /** Human-readable name */
  name: string
  /** Up migration function (apply changes) */
  up: (ctx: MigrationContext) => Promise<void>
  /** Down migration function (rollback changes) */
  down: (ctx: MigrationContext) => Promise<void>
  /** Optional checksum to detect tampering */
  checksum?: string
  /** Optional dependencies on other migrations */
  dependencies?: string[]
}

/**
 * Migration state in the database
 */
export type MigrationState = 'applied' | 'pending' | 'failed'

/**
 * Result of a migration execution
 */
export interface MigrationResult {
  /** Whether the migration succeeded */
  success: boolean
  /** Migration version */
  version: string
  /** Migration name */
  name: string
  /** Execution duration in milliseconds */
  duration: number
  /** Error message if failed */
  error?: string
  /** Migration direction */
  direction: 'up' | 'down'
}

/**
 * Migration execution plan
 */
export interface MigrationPlan {
  /** Migrations to execute */
  migrations: Migration[]
  /** Direction of migration */
  direction: 'up' | 'down'
  /** Whether this is a dry run */
  dryRun: boolean
}

/**
 * Distributed lock for migration safety
 */
export interface MigrationLock {
  /** Lock holder identifier */
  holder: string
  /** When the lock was acquired */
  acquiredAt: Date
  /** When the lock expires */
  expiresAt: Date
}

/**
 * Rollback strategy options
 */
export type RollbackStrategy = 'single' | 'all' | 'to-version'

/**
 * Schema snapshot for a specific version
 */
export interface SchemaSnapshot {
  /** Migration version this snapshot corresponds to */
  version: string
  /** Serialized schema state */
  schema: string
  /** When the snapshot was taken */
  timestamp: Date
}

// =============================================================================
// Status Types
// =============================================================================

/**
 * Applied migration record
 */
export interface AppliedMigration {
  /** Migration version */
  version: string
  /** Migration name */
  name: string
  /** When it was applied */
  appliedAt: Date
  /** Execution duration in ms */
  duration: number
  /** Checksum at time of application */
  checksum?: string
}

/**
 * Migration status information
 */
export interface MigrationStatus {
  /** Currently applied migrations */
  applied: AppliedMigration[]
  /** Pending migrations (not yet applied) */
  pending: Migration[]
  /** Failed migrations (if any) */
  failed: AppliedMigration[]
  /** Current database version (latest applied) */
  currentVersion: string | null
  /** Is the database up to date? */
  isUpToDate: boolean
}

// =============================================================================
// Context and Options
// =============================================================================

/**
 * Context provided to migration functions
 */
export interface MigrationContext {
  /** Execute SQL (or equivalent) */
  execute: (sql: string, params?: unknown[]) => Promise<void>
  /** Execute SQL and return results */
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>
  /** Log a message */
  log: (message: string) => void
  /** Current migration version */
  version: string
  /** Current migration name */
  name: string
}

/**
 * Options for rollback operation
 */
export interface RollbackOptions {
  /** Rollback strategy */
  strategy: RollbackStrategy
  /** Target version (for 'to-version' strategy) */
  targetVersion?: string
  /** Number of migrations to rollback (for 'single' strategy, default 1) */
  count?: number
  /** Force rollback even if there are checksum mismatches */
  force?: boolean
}

/**
 * Options for migration operation
 */
export interface MigrateOptions {
  /** Target version to migrate to (default: latest) */
  targetVersion?: string
  /** Run in dry-run mode */
  dryRun?: boolean
  /** Skip checksum validation */
  skipChecksumValidation?: boolean
}

/**
 * Options for creating a new migration
 */
export interface CreateOptions {
  /** Migration template to use */
  template?: 'default' | 'sql' | 'typescript'
  /** Output directory */
  directory?: string
}

// =============================================================================
// Engine Configuration
// =============================================================================

/**
 * Migration engine configuration
 */
export interface MigrationEngineConfig {
  /** Migrations to manage */
  migrations: Migration[]
  /** Database adapter */
  adapter: MigrationAdapter
  /** Lock timeout in milliseconds (default: 30000) */
  lockTimeout?: number
  /** Table name for migration history (default: '_migrations') */
  tableName?: string
  /** Enable transaction wrapping (default: true) */
  useTransactions?: boolean
  /** Logger function */
  logger?: (message: string) => void
}

/**
 * Database adapter interface
 */
export interface MigrationAdapter {
  /** Initialize the migration table if it doesn't exist */
  initialize(): Promise<void>
  /** Get all applied migrations */
  getAppliedMigrations(): Promise<AppliedMigration[]>
  /** Record a migration as applied */
  recordMigration(migration: AppliedMigration): Promise<void>
  /** Remove a migration record (for rollback) */
  removeMigration(version: string): Promise<void>
  /** Acquire a distributed lock */
  acquireLock(holder: string, timeout: number): Promise<boolean>
  /** Release a distributed lock */
  releaseLock(holder: string): Promise<void>
  /** Get current lock status */
  getLock(): Promise<MigrationLock | null>
  /** Execute SQL */
  execute(sql: string, params?: unknown[]): Promise<void>
  /** Execute SQL and return results */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  /** Begin a transaction */
  beginTransaction(): Promise<void>
  /** Commit a transaction */
  commitTransaction(): Promise<void>
  /** Rollback a transaction */
  rollbackTransaction(): Promise<void>
  /** Save a schema snapshot */
  saveSnapshot(snapshot: SchemaSnapshot): Promise<void>
  /** Get a schema snapshot */
  getSnapshot(version: string): Promise<SchemaSnapshot | null>
  /** Get the current database schema */
  getCurrentSchema(): Promise<string>
}

// =============================================================================
// Events
// =============================================================================

/**
 * Migration event types
 */
export type MigrationEventType =
  | 'migration:start'
  | 'migration:complete'
  | 'migration:error'
  | 'rollback:start'
  | 'rollback:complete'
  | 'rollback:error'
  | 'lock:acquired'
  | 'lock:released'
  | 'lock:failed'

/**
 * Migration event payload
 */
export interface MigrationEvent {
  type: MigrationEventType
  version?: string
  name?: string
  error?: string
  duration?: number
  timestamp: Date
}

/**
 * Event handler type
 */
export type MigrationEventHandler = (event: MigrationEvent) => void

// =============================================================================
// Errors
// =============================================================================

/**
 * Base migration error
 */
export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly version?: string
  ) {
    super(message)
    this.name = 'MigrationError'
  }
}

/**
 * Lock acquisition failed
 */
export class LockError extends MigrationError {
  constructor(message: string) {
    super(message, 'LOCK_FAILED')
    this.name = 'LockError'
  }
}

/**
 * Checksum mismatch error
 */
export class ChecksumError extends MigrationError {
  constructor(
    version: string,
    expected: string,
    actual: string
  ) {
    super(
      `Checksum mismatch for migration ${version}: expected ${expected}, got ${actual}`,
      'CHECKSUM_MISMATCH',
      version
    )
    this.name = 'ChecksumError'
  }
}

/**
 * Migration execution failed
 */
export class ExecutionError extends MigrationError {
  readonly originalCause: Error

  constructor(
    version: string,
    cause: Error
  ) {
    super(
      `Migration ${version} failed: ${cause.message}`,
      'EXECUTION_FAILED',
      version
    )
    this.name = 'ExecutionError'
    this.originalCause = cause
  }
}

/**
 * Dependency not satisfied
 */
export class DependencyError extends MigrationError {
  constructor(
    version: string,
    missingDeps: string[]
  ) {
    super(
      `Migration ${version} has unsatisfied dependencies: ${missingDeps.join(', ')}`,
      'DEPENDENCY_NOT_SATISFIED',
      version
    )
    this.name = 'DependencyError'
  }
}
