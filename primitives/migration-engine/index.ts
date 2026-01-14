/**
 * @dotdo/migration-engine - Database Migration System
 *
 * A comprehensive database migration system with distributed locking,
 * checksum validation, and schema snapshots.
 *
 * @example
 * ```typescript
 * import { MigrationEngine, InMemoryAdapter } from '@dotdo/migration-engine'
 *
 * const adapter = new InMemoryAdapter()
 * const engine = new MigrationEngine({
 *   migrations: [
 *     {
 *       version: '001',
 *       name: 'create_users',
 *       up: async (ctx) => {
 *         await ctx.execute('CREATE TABLE users (id INT, name TEXT)')
 *       },
 *       down: async (ctx) => {
 *         await ctx.execute('DROP TABLE users')
 *       },
 *     },
 *   ],
 *   adapter,
 * })
 *
 * // Run all pending migrations
 * const results = await engine.migrate()
 *
 * // Check status
 * const status = await engine.status()
 *
 * // Rollback last migration
 * await engine.rollback({ strategy: 'single' })
 * ```
 *
 * @packageDocumentation
 */

import type {
  Migration,
  MigrationAdapter,
  MigrationEngineConfig,
  MigrationResult,
  MigrationStatus,
  MigrationPlan,
  MigrationContext,
  MigrationLock,
  AppliedMigration,
  SchemaSnapshot,
  RollbackOptions,
  MigrateOptions,
} from './types.js'

import {
  LockError,
  ChecksumError,
  DependencyError,
  MigrationError,
  ExecutionError,
} from './types.js'

export {
  LockError,
  ChecksumError,
  ExecutionError,
  DependencyError,
  MigrationError,
}

export type * from './types.js'

// =============================================================================
// ChecksumValidator
// =============================================================================

/**
 * Validates migration checksums to detect tampering
 */
export class ChecksumValidator {
  /**
   * Generate a checksum for a migration
   */
  generate(migration: Migration): string {
    // Create a deterministic string from migration content
    const content = `${migration.version}:${migration.name}:${migration.up.toString()}:${migration.down.toString()}`
    return this.hash(content)
  }

  /**
   * Validate that a migration matches its expected checksum
   */
  validate(migration: Migration, expectedChecksum: string): void {
    const actual = this.generate(migration)
    if (actual !== expectedChecksum) {
      throw new ChecksumError(migration.version, expectedChecksum, actual)
    }
  }

  private hash(content: string): string {
    // Simple hash function for checksum generation
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0')
  }
}

// =============================================================================
// MigrationLockManager
// =============================================================================

/**
 * Manages distributed locks for safe migration execution
 */
export class MigrationLockManager {
  constructor(
    private adapter: MigrationAdapter,
    private timeout: number = 30000
  ) {}

  /**
   * Attempt to acquire the migration lock
   */
  async acquire(holder: string): Promise<boolean> {
    const existingLock = await this.adapter.getLock()

    // Check if there's an existing non-expired lock
    if (existingLock && existingLock.expiresAt > new Date()) {
      return false
    }

    // Acquire the lock
    return this.adapter.acquireLock(holder, this.timeout)
  }

  /**
   * Release the migration lock
   */
  async release(holder: string): Promise<void> {
    await this.adapter.releaseLock(holder)
  }

  /**
   * Check if the lock is currently held
   */
  async isLocked(): Promise<boolean> {
    const lock = await this.adapter.getLock()
    return lock !== null && lock.expiresAt > new Date()
  }

  /**
   * Require the lock or throw an error
   */
  async requireLock(holder: string): Promise<void> {
    const acquired = await this.acquire(holder)
    if (!acquired) {
      throw new LockError('Failed to acquire migration lock - another migration may be in progress')
    }
  }
}

// =============================================================================
// MigrationRunner
// =============================================================================

interface RunnerOptions {
  useTransactions?: boolean
  logger?: (message: string) => void
}

/**
 * Executes individual migrations safely
 */
export class MigrationRunner {
  private useTransactions: boolean
  private logger: (message: string) => void

  constructor(
    private adapter: MigrationAdapter,
    options: RunnerOptions = {}
  ) {
    this.useTransactions = options.useTransactions ?? false
    this.logger = options.logger ?? (() => {})
  }

  /**
   * Run a migration's up function
   */
  async runUp(migration: Migration): Promise<MigrationResult> {
    return this.run(migration, 'up')
  }

  /**
   * Run a migration's down function
   */
  async runDown(migration: Migration): Promise<MigrationResult> {
    return this.run(migration, 'down')
  }

  private async run(migration: Migration, direction: 'up' | 'down'): Promise<MigrationResult> {
    const start = Date.now()
    const fn = direction === 'up' ? migration.up : migration.down

    const ctx: MigrationContext = {
      execute: (sql, params) => this.adapter.execute(sql, params),
      query: (sql, params) => this.adapter.query(sql, params),
      log: (message) => this.logger(`[${migration.version}] ${message}`),
      version: migration.version,
      name: migration.name,
    }

    try {
      if (this.useTransactions) {
        await this.adapter.beginTransaction()
      }

      await fn(ctx)

      if (this.useTransactions) {
        await this.adapter.commitTransaction()
      }

      return {
        success: true,
        version: migration.version,
        name: migration.name,
        duration: Date.now() - start,
        direction,
      }
    } catch (error) {
      if (this.useTransactions) {
        try {
          await this.adapter.rollbackTransaction()
        } catch {
          // Ignore rollback errors
        }
      }

      return {
        success: false,
        version: migration.version,
        name: migration.name,
        duration: Date.now() - start,
        direction,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

// =============================================================================
// SchemaSnapshotter
// =============================================================================

interface SchemaDiff {
  hasChanges: boolean
  before: string
  after: string
}

/**
 * Captures and compares schema snapshots
 */
export class SchemaSnapshotter {
  constructor(private adapter: MigrationAdapter) {}

  /**
   * Capture current schema as a snapshot
   */
  async capture(version: string): Promise<void> {
    const schema = await this.adapter.getCurrentSchema()
    const snapshot: SchemaSnapshot = {
      version,
      schema,
      timestamp: new Date(),
    }
    await this.adapter.saveSnapshot(snapshot)
  }

  /**
   * Get a schema snapshot by version
   */
  async get(version: string): Promise<SchemaSnapshot | null> {
    return this.adapter.getSnapshot(version)
  }

  /**
   * Compare current schema with a snapshot
   */
  async diff(version: string): Promise<SchemaDiff> {
    const snapshot = await this.adapter.getSnapshot(version)
    const currentSchema = await this.adapter.getCurrentSchema()

    if (!snapshot) {
      return {
        hasChanges: true,
        before: '',
        after: currentSchema,
      }
    }

    return {
      hasChanges: snapshot.schema !== currentSchema,
      before: snapshot.schema,
      after: currentSchema,
    }
  }
}

// =============================================================================
// DependencyResolver
// =============================================================================

/**
 * Resolves migration dependencies and ordering
 */
export class DependencyResolver {
  /**
   * Resolve migrations into dependency order
   */
  resolve(migrations: Migration[]): Migration[] {
    const byVersion = new Map<string, Migration>()
    for (const m of migrations) {
      byVersion.set(m.version, m)
    }

    // Check for missing dependencies
    for (const m of migrations) {
      if (m.dependencies) {
        const missing = m.dependencies.filter(dep => !byVersion.has(dep))
        if (missing.length > 0) {
          throw new DependencyError(m.version, missing)
        }
      }
    }

    // Topological sort
    const result: Migration[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (m: Migration) => {
      if (visited.has(m.version)) return
      if (visiting.has(m.version)) {
        throw new DependencyError(m.version, ['circular dependency detected'])
      }

      visiting.add(m.version)

      // Visit dependencies first
      if (m.dependencies) {
        for (const dep of m.dependencies) {
          const depMigration = byVersion.get(dep)!
          visit(depMigration)
        }
      }

      visiting.delete(m.version)
      visited.add(m.version)
      result.push(m)
    }

    // Sort by version first, then apply topological sort
    const sorted = [...migrations].sort((a, b) => a.version.localeCompare(b.version))
    for (const m of sorted) {
      visit(m)
    }

    return result
  }
}

// =============================================================================
// MigrationGenerator
// =============================================================================

/**
 * Generates new migration files
 */
export class MigrationGenerator {
  /**
   * Generate a timestamp-based version
   */
  generateVersion(): string {
    const now = new Date()
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('')
  }

  /**
   * Generate migration file content
   */
  generateContent(name: string): string {
    return `/**
 * Migration: ${name}
 */
import type { MigrationContext } from '@dotdo/migration-engine'

export const migration = {
  name: '${name}',
  up: async (ctx: MigrationContext) => {
    // TODO: Implement up migration
    // await ctx.execute('CREATE TABLE ...')
  },
  down: async (ctx: MigrationContext) => {
    // TODO: Implement down migration
    // await ctx.execute('DROP TABLE ...')
  },
}
`
  }

  /**
   * Generate a migration from schema diff
   */
  fromDiff(_before: string, _after: string, name: string): { version: string; name: string; content: string } {
    const version = this.generateVersion()
    const content = this.generateContent(name)
    return { version, name, content }
  }
}

// =============================================================================
// InMemoryAdapter
// =============================================================================

/**
 * In-memory adapter for testing
 */
export class InMemoryAdapter implements MigrationAdapter {
  appliedMigrations: AppliedMigration[] = []
  lock: MigrationLock | null = null
  snapshots = new Map<string, SchemaSnapshot>()
  schema = ''
  inTransaction = false
  private failedMigrations: AppliedMigration[] = []

  async initialize(): Promise<void> {
    // Nothing to initialize in memory
  }

  async getAppliedMigrations(): Promise<AppliedMigration[]> {
    return [...this.appliedMigrations]
  }

  async recordMigration(migration: AppliedMigration): Promise<void> {
    this.appliedMigrations.push(migration)
  }

  async removeMigration(version: string): Promise<void> {
    this.appliedMigrations = this.appliedMigrations.filter(m => m.version !== version)
  }

  async acquireLock(holder: string, timeout: number): Promise<boolean> {
    const existingLock = this.lock
    if (existingLock && existingLock.expiresAt > new Date()) {
      return false
    }

    this.lock = {
      holder,
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + timeout),
    }
    return true
  }

  async releaseLock(holder: string): Promise<void> {
    if (this.lock?.holder === holder) {
      this.lock = null
    }
  }

  async getLock(): Promise<MigrationLock | null> {
    return this.lock
  }

  async execute(_sql: string, _params?: unknown[]): Promise<void> {
    // No-op for in-memory
  }

  async query<T = unknown>(_sql: string, _params?: unknown[]): Promise<T[]> {
    return []
  }

  async beginTransaction(): Promise<void> {
    this.inTransaction = true
  }

  async commitTransaction(): Promise<void> {
    this.inTransaction = false
  }

  async rollbackTransaction(): Promise<void> {
    this.inTransaction = false
  }

  async saveSnapshot(snapshot: SchemaSnapshot): Promise<void> {
    this.snapshots.set(snapshot.version, snapshot)
  }

  async getSnapshot(version: string): Promise<SchemaSnapshot | null> {
    return this.snapshots.get(version) ?? null
  }

  async getCurrentSchema(): Promise<string> {
    return this.schema
  }

  // For testing failed migrations
  recordFailedMigration(migration: AppliedMigration): void {
    this.failedMigrations.push(migration)
  }

  getFailedMigrations(): AppliedMigration[] {
    return [...this.failedMigrations]
  }
}

// =============================================================================
// MigrationEngine
// =============================================================================

/**
 * Main migration engine - coordinates all migration operations
 */
export class MigrationEngine {
  private migrations: Migration[]
  private adapter: MigrationAdapter
  private lockManager: MigrationLockManager
  private runner: MigrationRunner
  private checksumValidator: ChecksumValidator
  private dependencyResolver: DependencyResolver
  private snapshotter: SchemaSnapshotter
  private generator: MigrationGenerator
  private logger: (message: string) => void
  private useTransactions: boolean
  private failedMigrations: AppliedMigration[] = []

  constructor(config: MigrationEngineConfig) {
    this.migrations = config.migrations
    this.adapter = config.adapter
    this.lockManager = new MigrationLockManager(config.adapter, config.lockTimeout ?? 30000)
    this.checksumValidator = new ChecksumValidator()
    this.dependencyResolver = new DependencyResolver()
    this.snapshotter = new SchemaSnapshotter(config.adapter)
    this.generator = new MigrationGenerator()
    this.logger = config.logger ?? (() => {})
    this.useTransactions = config.useTransactions ?? true
    this.runner = new MigrationRunner(config.adapter, {
      useTransactions: this.useTransactions,
      logger: this.logger,
    })
  }

  /**
   * Run pending migrations
   */
  async migrate(options: MigrateOptions = {}): Promise<MigrationResult[]> {
    const { targetVersion, dryRun = false, skipChecksumValidation = false } = options

    await this.adapter.initialize()

    const applied = await this.adapter.getAppliedMigrations()
    const appliedVersions = new Set(applied.map(m => m.version))

    // Resolve dependencies and get ordered migrations
    const ordered = this.dependencyResolver.resolve(this.migrations)

    // Filter to pending migrations
    let pending = ordered.filter(m => !appliedVersions.has(m.version))

    // Filter to target version if specified
    if (targetVersion) {
      const targetIndex = pending.findIndex(m => m.version === targetVersion)
      if (targetIndex >= 0) {
        pending = pending.slice(0, targetIndex + 1)
      }
    }

    if (pending.length === 0) {
      return []
    }

    // Validate checksums if not skipped
    if (!skipChecksumValidation) {
      for (const migration of pending) {
        const appliedMigration = applied.find(m => m.version === migration.version)
        if (appliedMigration?.checksum) {
          this.checksumValidator.validate(migration, appliedMigration.checksum)
        }
      }
    }

    const results: MigrationResult[] = []

    // Dry run - don't execute
    if (dryRun) {
      for (const migration of pending) {
        results.push({
          success: true,
          version: migration.version,
          name: migration.name,
          duration: 0,
          direction: 'up',
        })
      }
      return results
    }

    // Execute migrations
    for (const migration of pending) {
      this.logger(`Running migration ${migration.version}: ${migration.name}`)

      const result = await this.runner.runUp(migration)
      results.push(result)

      if (result.success) {
        await this.adapter.recordMigration({
          version: migration.version,
          name: migration.name,
          appliedAt: new Date(),
          duration: result.duration,
          checksum: this.checksumValidator.generate(migration),
        })
      } else {
        // Record failed migration
        this.failedMigrations.push({
          version: migration.version,
          name: migration.name,
          appliedAt: new Date(),
          duration: result.duration,
        })
        // Stop on failure
        break
      }
    }

    return results
  }

  /**
   * Rollback migrations
   */
  async rollback(options: RollbackOptions): Promise<MigrationResult[]> {
    await this.adapter.initialize()

    const applied = await this.adapter.getAppliedMigrations()
    const byVersion = new Map(this.migrations.map(m => [m.version, m]))

    // Sort applied migrations by version descending (newest first)
    const sortedApplied = [...applied].sort((a, b) => b.version.localeCompare(a.version))

    let toRollback: AppliedMigration[] = []

    switch (options.strategy) {
      case 'single': {
        const count = options.count ?? 1
        toRollback = sortedApplied.slice(0, count)
        break
      }
      case 'all': {
        toRollback = sortedApplied
        break
      }
      case 'to-version': {
        if (!options.targetVersion) {
          throw new Error('targetVersion is required for to-version strategy')
        }
        const targetIndex = sortedApplied.findIndex(m => m.version === options.targetVersion)
        if (targetIndex < 0) {
          throw new Error(`Target version ${options.targetVersion} not found in applied migrations`)
        }
        toRollback = sortedApplied.slice(0, targetIndex)
        break
      }
    }

    const results: MigrationResult[] = []

    for (const appliedMigration of toRollback) {
      const migration = byVersion.get(appliedMigration.version)
      if (!migration) {
        throw new Error(`Migration ${appliedMigration.version} not found`)
      }

      this.logger(`Rolling back migration ${migration.version}: ${migration.name}`)

      const result = await this.runner.runDown(migration)
      results.push(result)

      if (result.success) {
        await this.adapter.removeMigration(migration.version)
      } else {
        // Stop on failure
        break
      }
    }

    return results
  }

  /**
   * Get migration status
   */
  async status(): Promise<MigrationStatus> {
    await this.adapter.initialize()

    const applied = await this.adapter.getAppliedMigrations()
    const appliedVersions = new Set(applied.map(m => m.version))

    const pending = this.migrations.filter(m => !appliedVersions.has(m.version))

    const sortedApplied = [...applied].sort((a, b) => b.version.localeCompare(a.version))
    const currentVersion = sortedApplied.length > 0 ? sortedApplied[0].version : null

    return {
      applied,
      pending,
      failed: this.failedMigrations,
      currentVersion,
      isUpToDate: pending.length === 0,
    }
  }

  /**
   * Show migration plan without executing
   */
  async plan(options: { direction?: 'up' | 'down' } = {}): Promise<MigrationPlan> {
    const direction = options.direction ?? 'up'

    await this.adapter.initialize()

    const applied = await this.adapter.getAppliedMigrations()
    const appliedVersions = new Set(applied.map(m => m.version))

    let migrations: Migration[]

    if (direction === 'up') {
      const ordered = this.dependencyResolver.resolve(this.migrations)
      migrations = ordered.filter(m => !appliedVersions.has(m.version))
    } else {
      const byVersion = new Map(this.migrations.map(m => [m.version, m]))
      const sortedApplied = [...applied].sort((a, b) => b.version.localeCompare(a.version))
      migrations = sortedApplied
        .map(a => byVersion.get(a.version))
        .filter((m): m is Migration => m !== undefined)
    }

    return {
      migrations,
      direction,
      dryRun: true,
    }
  }

  /**
   * Create a new migration file
   */
  async create(name: string): Promise<{ version: string; name: string; content: string }> {
    const version = this.generator.generateVersion()
    const content = this.generator.generateContent(name)
    return { version, name, content }
  }

  /**
   * Re-run a specific migration (rollback then up)
   */
  async rerun(version: string): Promise<MigrationResult> {
    const migration = this.migrations.find(m => m.version === version)
    if (!migration) {
      throw new Error(`Migration ${version} not found`)
    }

    // First rollback
    const downResult = await this.runner.runDown(migration)
    if (!downResult.success) {
      return downResult
    }

    // Then run up
    const upResult = await this.runner.runUp(migration)
    return upResult
  }
}
