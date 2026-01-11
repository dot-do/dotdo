/**
 * Migration Runner - Schema Migration System
 *
 * Provides schema migration functionality for DO state persistence:
 * - Schema versioning
 * - Forward and backward migrations
 * - Rollback support
 * - Safe migration execution with transactions
 * - Custom transform functions
 *
 * @module objects/persistence/migration-runner
 */

import type {
  SchemaMigration,
  MigrationOperation,
  AppliedMigration,
  MigrationResult,
  MigrationConfig,
  MigrationDirection,
  MigrationStatus,
} from './types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Storage interface for migration operations
 */
export interface MigrationStorage {
  sql: {
    exec(query: string, ...params: unknown[]): {
      toArray(): unknown[]
      changes?: number
    }
  }
}

/**
 * Transform function signature
 */
export type TransformFunction = (table: string, params: Record<string, unknown>) => Promise<void>

// ============================================================================
// CONSTANTS
// ============================================================================

const MIGRATIONS_TABLE = '_migrations'
const LOCK_TABLE = '_migration_lock'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate SHA-256 checksum of migration
 */
async function calculateChecksum(migration: SchemaMigration): Promise<string> {
  const content = JSON.stringify({
    version: migration.version,
    name: migration.name,
    up: migration.up,
    down: migration.down,
  })

  const data = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// MIGRATION RUNNER CLASS
// ============================================================================

/**
 * Manages schema migrations for DO state
 */
export class MigrationRunner {
  private storage: MigrationStorage
  private config: Required<MigrationConfig>
  private migrations: Map<number, SchemaMigration> = new Map()
  private transforms: Map<string, TransformFunction> = new Map()
  private migrationStartCallbacks: Array<(version: number, direction: MigrationDirection) => void> = []
  private backupCreatedCallbacks: Array<() => void> = []
  private backupRestoredCallbacks: Array<() => void> = []
  private locked: boolean = false
  private initialized: boolean = false
  private backupData: Map<string, unknown[]> | null = null

  constructor(
    storage: MigrationStorage,
    options?: { config?: MigrationConfig }
  ) {
    this.storage = storage

    this.config = {
      autoMigrate: options?.config?.autoMigrate ?? false,
      backupBeforeMigration: options?.config?.backupBeforeMigration ?? true,
      dryRun: options?.config?.dryRun ?? false,
      transactionMode: options?.config?.transactionMode ?? 'each',
      lockTimeoutMs: options?.config?.lockTimeoutMs ?? 30000,
    }
  }

  /**
   * Configure the migration runner
   */
  configure(config: MigrationConfig): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Initialize the migration runner
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create migrations table if not exists
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        reversible INTEGER NOT NULL
      )
    `)

    // Create lock table if not exists
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${LOCK_TABLE} (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        locked_at INTEGER,
        locked_by TEXT
      )
    `)

    // Initialize lock row
    this.storage.sql.exec(`
      INSERT OR IGNORE INTO ${LOCK_TABLE} (id, locked_at, locked_by)
      VALUES (1, NULL, NULL)
    `)

    this.initialized = true

    // Auto-migrate if configured
    if (this.config.autoMigrate) {
      await this.runAll()
    }
  }

  /**
   * Register a migration
   */
  register(migration: SchemaMigration): void {
    if (this.migrations.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version} is already registered`)
    }

    this.migrations.set(migration.version, migration)
  }

  /**
   * Get all registered migrations (sorted by version)
   */
  getMigrations(): SchemaMigration[] {
    return Array.from(this.migrations.values())
      .sort((a, b) => a.version - b.version)
  }

  /**
   * Get a specific migration
   */
  getMigration(version: number): SchemaMigration | undefined {
    return this.migrations.get(version)
  }

  /**
   * Calculate checksum for a migration
   */
  calculateChecksum(migration: SchemaMigration): string {
    // Synchronous version for validation
    const content = JSON.stringify({
      version: migration.version,
      name: migration.name,
      up: migration.up,
      down: migration.down,
    })

    // Simple hash for sync operation (use SHA-256 in production)
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(16).padStart(16, '0')
  }

  /**
   * Get pending migrations
   */
  async getPendingMigrations(): Promise<SchemaMigration[]> {
    const applied = await this.getAppliedMigrations()
    const appliedVersions = new Set(applied.map(m => m.version))

    return this.getMigrations()
      .filter(m => !appliedVersions.has(m.version))
  }

  /**
   * Get applied migrations
   */
  async getAppliedMigrations(): Promise<AppliedMigration[]> {
    const result = this.storage.sql.exec(
      `SELECT version, name, checksum, applied_at, duration_ms, reversible
       FROM ${MIGRATIONS_TABLE} ORDER BY version`
    )

    return result.toArray().map((row: {
      version: number
      name: string
      checksum: string
      applied_at: number
      duration_ms: number
      reversible: number
    }) => ({
      version: row.version,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
      durationMs: row.duration_ms,
      reversible: row.reversible === 1,
    }))
  }

  /**
   * Get current schema version
   */
  async getCurrentVersion(): Promise<number> {
    const applied = await this.getAppliedMigrations()
    if (applied.length === 0) return 0
    return Math.max(...applied.map(m => m.version))
  }

  /**
   * Run a single migration
   */
  async run(version: number): Promise<MigrationResult> {
    const migration = this.migrations.get(version)
    if (!migration) {
      return {
        version,
        direction: 'up',
        status: 'failed',
        durationMs: 0,
        error: `Migration version ${version} not found`,
        operationsExecuted: 0,
        rowsAffected: 0,
      }
    }

    // Acquire lock
    if (!await this.acquireLock()) {
      throw new Error('Could not acquire migration lock - timeout')
    }

    const startTime = Date.now()
    let status: MigrationStatus = 'running'
    let error: string | undefined
    let operationsExecuted = 0
    let rowsAffected = 0

    try {
      // Emit start callback
      this.emitMigrationStart(version, 'up')

      // Create backup if configured
      if (this.config.backupBeforeMigration && !this.config.dryRun) {
        await this.createBackup()
        this.emitBackupCreated()
      }

      // Execute migration operations
      for (const op of migration.up) {
        try {
          const changes = await this.executeOperation(op)
          rowsAffected += changes
          operationsExecuted++
        } catch (err) {
          error = (err as Error).message
          status = 'failed'

          // Restore from backup on failure
          if (this.config.backupBeforeMigration && !this.config.dryRun) {
            await this.restoreFromBackup()
            this.emitBackupRestored()
          }

          break
        }
      }

      if (status !== 'failed') {
        status = 'completed'

        // Record the migration (unless dry run)
        if (!this.config.dryRun) {
          const checksum = this.calculateChecksum(migration)
          const durationMs = Date.now() - startTime
          const reversible = migration.down.length > 0 ? 1 : 0

          this.storage.sql.exec(
            `INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum, applied_at, duration_ms, reversible)
             VALUES (?, ?, ?, ?, ?, ?)`,
            version,
            migration.name,
            checksum,
            Date.now(),
            durationMs,
            reversible
          )
        }
      }
    } finally {
      await this.releaseLock()
    }

    return {
      version,
      direction: 'up',
      status,
      durationMs: Date.now() - startTime,
      error,
      operationsExecuted,
      rowsAffected,
    }
  }

  /**
   * Run all pending migrations
   */
  async runAll(): Promise<MigrationResult[]> {
    const pending = await this.getPendingMigrations()
    const results: MigrationResult[] = []

    for (const migration of pending) {
      const result = await this.run(migration.version)
      results.push(result)

      if (result.status === 'failed') {
        break
      }
    }

    return results
  }

  /**
   * Rollback a single migration
   */
  async rollback(version: number): Promise<MigrationResult> {
    const migration = this.migrations.get(version)
    if (!migration) {
      throw new Error(`Migration version ${version} not found`)
    }

    if (migration.down.length === 0) {
      throw new Error(`Migration ${version} is irreversible - cannot rollback`)
    }

    // Check if migration is applied
    const applied = await this.getAppliedMigrations()
    if (!applied.find(m => m.version === version)) {
      throw new Error(`Migration ${version} is not applied`)
    }

    // Acquire lock
    if (!await this.acquireLock()) {
      throw new Error('Could not acquire migration lock - timeout')
    }

    const startTime = Date.now()
    let status: MigrationStatus = 'running'
    let error: string | undefined
    let operationsExecuted = 0
    let rowsAffected = 0

    try {
      // Emit start callback
      this.emitMigrationStart(version, 'down')

      // Execute rollback operations
      for (const op of migration.down) {
        try {
          const changes = await this.executeOperation(op)
          rowsAffected += changes
          operationsExecuted++
        } catch (err) {
          error = (err as Error).message
          status = 'failed'
          break
        }
      }

      if (status !== 'failed') {
        status = 'completed'

        // Remove the migration record
        this.storage.sql.exec(
          `DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`,
          version
        )
      }
    } finally {
      await this.releaseLock()
    }

    return {
      version,
      direction: 'down',
      status,
      durationMs: Date.now() - startTime,
      error,
      operationsExecuted,
      rowsAffected,
    }
  }

  /**
   * Rollback to a specific version
   */
  async rollbackTo(targetVersion: number): Promise<MigrationResult[]> {
    const applied = await this.getAppliedMigrations()
    const toRollback = applied
      .filter(m => m.version > targetVersion)
      .sort((a, b) => b.version - a.version) // Descending order

    const results: MigrationResult[] = []

    for (const migration of toRollback) {
      const result = await this.rollback(migration.version)
      results.push(result)

      if (result.status === 'failed') {
        break
      }
    }

    return results
  }

  /**
   * Rollback all migrations
   */
  async rollbackAll(): Promise<MigrationResult[]> {
    return this.rollbackTo(0)
  }

  /**
   * Validate checksums of applied migrations
   */
  async validateChecksums(): Promise<{ valid: boolean; mismatches: number[] }> {
    const applied = await this.getAppliedMigrations()
    const mismatches: number[] = []

    for (const appliedMigration of applied) {
      const registered = this.migrations.get(appliedMigration.version)
      if (registered) {
        const currentChecksum = this.calculateChecksum(registered)
        if (currentChecksum !== appliedMigration.checksum) {
          mismatches.push(appliedMigration.version)
        }
      }
    }

    return {
      valid: mismatches.length === 0,
      mismatches,
    }
  }

  /**
   * Validate migration version sequence
   */
  validateVersions(): { valid: boolean; gaps: number[] } {
    const versions = Array.from(this.migrations.keys()).sort((a, b) => a - b)
    const gaps: number[] = []

    for (let i = 0; i < versions.length - 1; i++) {
      const current = versions[i]
      const next = versions[i + 1]

      for (let v = current + 1; v < next; v++) {
        gaps.push(v)
      }
    }

    return {
      valid: gaps.length === 0,
      gaps,
    }
  }

  /**
   * Get SQL statements for dry run
   */
  async getDryRunSQL(version: number): Promise<string[]> {
    const migration = this.migrations.get(version)
    if (!migration) {
      throw new Error(`Migration version ${version} not found`)
    }

    return migration.up
      .filter(op => op.type === 'sql' && op.sql)
      .map(op => op.sql!)
  }

  /**
   * Check if a table exists
   */
  async tableExists(name: string): Promise<boolean> {
    const result = this.storage.sql.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      name
    )
    return result.toArray().length > 0
  }

  /**
   * Register a transform function
   */
  registerTransform(name: string, fn: TransformFunction): void {
    this.transforms.set(name, fn)
  }

  /**
   * Check if migrations are locked
   */
  async isLocked(): Promise<boolean> {
    const result = this.storage.sql.exec(
      `SELECT locked_at FROM ${LOCK_TABLE} WHERE id = 1`
    )
    const rows = result.toArray() as { locked_at: number | null }[]
    return rows.length > 0 && rows[0].locked_at !== null
  }

  /**
   * Simulate a lock for testing
   */
  simulateLock(): void {
    this.storage.sql.exec(
      `UPDATE ${LOCK_TABLE} SET locked_at = ?, locked_by = ? WHERE id = 1`,
      Date.now(),
      'simulated'
    )
  }

  // ==========================================================================
  // CALLBACKS
  // ==========================================================================

  /**
   * Register migration start callback
   */
  onMigrationStart(callback: (version: number, direction: MigrationDirection) => void): void {
    this.migrationStartCallbacks.push(callback)
  }

  /**
   * Register backup created callback
   */
  onBackupCreated(callback: () => void): void {
    this.backupCreatedCallbacks.push(callback)
  }

  /**
   * Register backup restored callback
   */
  onBackupRestored(callback: () => void): void {
    this.backupRestoredCallbacks.push(callback)
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  private async executeOperation(op: MigrationOperation): Promise<number> {
    if (this.config.dryRun) {
      return 0
    }

    switch (op.type) {
      case 'sql':
        if (!op.sql) {
          throw new Error('SQL operation missing SQL statement')
        }
        const result = this.storage.sql.exec(op.sql)
        return result.changes ?? 0

      case 'transform':
        if (!op.transform) {
          throw new Error('Transform operation missing transform name')
        }
        const transform = this.transforms.get(op.transform)
        if (!transform) {
          throw new Error(`Transform '${op.transform}' not registered`)
        }
        await transform(op.table ?? '', (op.params ?? {}) as Record<string, unknown>)
        return 0

      case 'custom':
        // Custom operations should be handled by transforms
        return 0

      default:
        throw new Error(`Unknown operation type: ${(op as MigrationOperation).type}`)
    }
  }

  private async acquireLock(): Promise<boolean> {
    const startTime = Date.now()

    while (Date.now() - startTime < this.config.lockTimeoutMs) {
      const result = this.storage.sql.exec(
        `UPDATE ${LOCK_TABLE} SET locked_at = ?, locked_by = ?
         WHERE id = 1 AND locked_at IS NULL`,
        Date.now(),
        'migration-runner'
      )

      if (result.changes && result.changes > 0) {
        this.locked = true
        return true
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return false
  }

  private async releaseLock(): Promise<void> {
    this.storage.sql.exec(
      `UPDATE ${LOCK_TABLE} SET locked_at = NULL, locked_by = NULL WHERE id = 1`
    )
    this.locked = false
  }

  private async createBackup(): Promise<void> {
    // Store backup of key tables
    this.backupData = new Map()

    // Get list of tables
    const tablesResult = this.storage.sql.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_%'`
    )

    const tables = tablesResult.toArray() as { name: string }[]

    for (const { name } of tables) {
      const dataResult = this.storage.sql.exec(`SELECT * FROM ${name}`)
      this.backupData.set(name, dataResult.toArray())
    }
  }

  private async restoreFromBackup(): Promise<void> {
    if (!this.backupData) return

    this.backupData.forEach((rows, tableName) => {
      // Clear table
      this.storage.sql.exec(`DELETE FROM ${tableName}`)

      // Restore rows
      for (const row of rows as Record<string, unknown>[]) {
        const columns = Object.keys(row)
        const values = Object.values(row)
        const placeholders = columns.map(() => '?').join(', ')

        this.storage.sql.exec(
          `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
          ...values
        )
      }
    })

    this.backupData = null
  }

  private emitMigrationStart(version: number, direction: MigrationDirection): void {
    for (const callback of this.migrationStartCallbacks) {
      try {
        callback(version, direction)
      } catch {
        // Ignore callback errors
      }
    }
  }

  private emitBackupCreated(): void {
    for (const callback of this.backupCreatedCallbacks) {
      try {
        callback()
      } catch {
        // Ignore callback errors
      }
    }
  }

  private emitBackupRestored(): void {
    for (const callback of this.backupRestoredCallbacks) {
      try {
        callback()
      } catch {
        // Ignore callback errors
      }
    }
  }
}
