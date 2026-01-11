/**
 * Migration Runner Tests (RED Phase - TDD)
 *
 * Tests for the schema migration system that provides:
 * - Schema versioning
 * - Forward and backward migrations
 * - Rollback support
 * - Safe migration execution
 *
 * RED PHASE: All tests should FAIL initially.
 * GREEN PHASE: Implement MigrationRunner to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module objects/persistence/tests/migration-runner.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  SchemaMigration,
  MigrationOperation,
  AppliedMigration,
  MigrationResult,
  MigrationConfig,
  MigrationDirection,
  MigrationStatus,
} from '../types'

// Will be implemented in GREEN phase
// import { MigrationRunner } from '../migration-runner'

// ============================================================================
// MOCK TYPES FOR TESTING
// ============================================================================

interface MockStorage {
  sql: {
    exec(query: string, ...params: unknown[]): {
      toArray(): unknown[]
      changes?: number
    }
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockStorage(): MockStorage {
  const appliedMigrations: AppliedMigration[] = []
  const tables: Map<string, Map<string, unknown>> = new Map([
    ['things', new Map()],
  ])

  return {
    sql: {
      exec(query: string, ...params: unknown[]) {
        const upperQuery = query.toUpperCase()

        // Migration tracking
        if (upperQuery.includes('INSERT INTO _MIGRATIONS')) {
          appliedMigrations.push({
            version: params[0] as number,
            name: params[1] as string,
            checksum: params[2] as string,
            appliedAt: Date.now(),
            durationMs: params[3] as number || 0,
            reversible: params[4] as boolean ?? true,
          })
          return { toArray: () => [] }
        }

        if (upperQuery.includes('SELECT') && upperQuery.includes('FROM _MIGRATIONS')) {
          return { toArray: () => [...appliedMigrations] }
        }

        if (upperQuery.includes('DELETE FROM _MIGRATIONS')) {
          const version = params[0] as number
          const index = appliedMigrations.findIndex(m => m.version === version)
          if (index >= 0) appliedMigrations.splice(index, 1)
          return { toArray: () => [], changes: 1 }
        }

        // Schema operations
        if (upperQuery.includes('CREATE TABLE')) {
          const tableMatch = query.match(/CREATE TABLE\s+(\w+)/i)
          if (tableMatch) {
            tables.set(tableMatch[1], new Map())
          }
          return { toArray: () => [], changes: 1 }
        }

        if (upperQuery.includes('DROP TABLE')) {
          const tableMatch = query.match(/DROP TABLE\s+(\w+)/i)
          if (tableMatch) {
            tables.delete(tableMatch[1])
          }
          return { toArray: () => [], changes: 1 }
        }

        if (upperQuery.includes('ALTER TABLE')) {
          return { toArray: () => [], changes: 1 }
        }

        return { toArray: () => [] }
      }
    }
  }
}

function createTestMigration(version: number, name: string): SchemaMigration {
  return {
    version,
    name,
    up: [
      { type: 'sql', sql: `CREATE TABLE test_${version} (id TEXT PRIMARY KEY)` }
    ],
    down: [
      { type: 'sql', sql: `DROP TABLE test_${version}` }
    ],
    createdAt: Date.now(),
    checksum: `checksum-${version}`,
  }
}

// ============================================================================
// TEST SUITE: MIGRATION RUNNER
// ============================================================================

describe('MigrationRunner', () => {
  let storage: MockStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // MIGRATION REGISTRATION
  // ==========================================================================

  describe('Migration Registration', () => {
    it('should register migrations', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        getMigrations(): SchemaMigration[]
      }

      runner.register(createTestMigration(1, 'Create users table'))
      runner.register(createTestMigration(2, 'Add email column'))

      const migrations = runner.getMigrations()

      expect(migrations.length).toBe(2)
    })

    it('should order migrations by version', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        getMigrations(): SchemaMigration[]
      }

      runner.register(createTestMigration(3, 'Third'))
      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))

      const migrations = runner.getMigrations()

      expect(migrations[0].version).toBe(1)
      expect(migrations[1].version).toBe(2)
      expect(migrations[2].version).toBe(3)
    })

    it('should reject duplicate versions', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
      }

      runner.register(createTestMigration(1, 'First'))

      expect(() => runner.register(createTestMigration(1, 'Duplicate')))
        .toThrow(/duplicate.*version|already registered/i)
    })

    it('should calculate migration checksum', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        getMigration(version: number): SchemaMigration | undefined
        calculateChecksum(migration: SchemaMigration): string
      }

      const migration = createTestMigration(1, 'Test')
      runner.register(migration)

      const checksum = runner.calculateChecksum(migration)

      expect(checksum).toBeDefined()
      expect(typeof checksum).toBe('string')
      expect(checksum.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // PENDING MIGRATIONS
  // ==========================================================================

  describe('Pending Migrations', () => {
    it('should identify pending migrations', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        getPendingMigrations(): Promise<SchemaMigration[]>
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))
      runner.register(createTestMigration(3, 'Third'))

      const pending = await runner.getPendingMigrations()

      expect(pending.length).toBe(3)
    })

    it('should exclude already applied migrations', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
        getPendingMigrations(): Promise<SchemaMigration[]>
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))
      runner.register(createTestMigration(3, 'Third'))

      await runner.run(1)
      await runner.run(2)

      const pending = await runner.getPendingMigrations()

      expect(pending.length).toBe(1)
      expect(pending[0].version).toBe(3)
    })

    it('should return empty array when all applied', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        runAll(): Promise<MigrationResult[]>
        getPendingMigrations(): Promise<SchemaMigration[]>
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))

      await runner.runAll()

      const pending = await runner.getPendingMigrations()

      expect(pending.length).toBe(0)
    })
  })

  // ==========================================================================
  // RUNNING MIGRATIONS
  // ==========================================================================

  describe('Running Migrations', () => {
    it('should run single migration', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
      }

      runner.register(createTestMigration(1, 'Create table'))

      const result = await runner.run(1)

      expect(result.version).toBe(1)
      expect(result.status).toBe('completed')
      expect(result.direction).toBe('up')
    })

    it('should run all pending migrations', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        runAll(): Promise<MigrationResult[]>
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))
      runner.register(createTestMigration(3, 'Third'))

      const results = await runner.runAll()

      expect(results.length).toBe(3)
      expect(results.every(r => r.status === 'completed')).toBe(true)
    })

    it('should run migrations in order', async () => {
      const executionOrder: number[] = []
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        onMigrationStart(callback: (version: number) => void): void
        runAll(): Promise<MigrationResult[]>
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))
      runner.register(createTestMigration(3, 'Third'))

      runner.onMigrationStart((v) => executionOrder.push(v))

      await runner.runAll()

      expect(executionOrder).toEqual([1, 2, 3])
    })

    it('should record applied migration', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
        getAppliedMigrations(): Promise<AppliedMigration[]>
      }

      runner.register(createTestMigration(1, 'Test'))

      await runner.run(1)

      const applied = await runner.getAppliedMigrations()

      expect(applied.length).toBe(1)
      expect(applied[0].version).toBe(1)
    })

    it('should track migration duration', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
      }

      runner.register(createTestMigration(1, 'Test'))

      const result = await runner.run(1)

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should count affected rows', async () => {
      const migration: SchemaMigration = {
        version: 1,
        name: 'Bulk update',
        up: [
          { type: 'sql', sql: 'UPDATE things SET status = "active"' }
        ],
        down: [],
        createdAt: Date.now(),
        checksum: 'test',
      }

      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
      }

      runner.register(migration)

      const result = await runner.run(1)

      expect(result.rowsAffected).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // ROLLBACK
  // ==========================================================================

  describe('Rollback', () => {
    it('should rollback single migration', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
        rollback(version: number): Promise<MigrationResult>
      }

      runner.register(createTestMigration(1, 'Test'))

      await runner.run(1)
      const result = await runner.rollback(1)

      expect(result.version).toBe(1)
      expect(result.status).toBe('completed')
      expect(result.direction).toBe('down')
    })

    it('should rollback to specific version', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        runAll(): Promise<MigrationResult[]>
        rollbackTo(version: number): Promise<MigrationResult[]>
        getCurrentVersion(): Promise<number>
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))
      runner.register(createTestMigration(3, 'Third'))

      await runner.runAll()
      await runner.rollbackTo(1)

      const currentVersion = await runner.getCurrentVersion()

      expect(currentVersion).toBe(1)
    })

    it('should rollback all migrations', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        runAll(): Promise<MigrationResult[]>
        rollbackAll(): Promise<MigrationResult[]>
        getAppliedMigrations(): Promise<AppliedMigration[]>
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))

      await runner.runAll()
      await runner.rollbackAll()

      const applied = await runner.getAppliedMigrations()

      expect(applied.length).toBe(0)
    })

    it('should rollback in reverse order', async () => {
      const rollbackOrder: number[] = []
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        runAll(): Promise<MigrationResult[]>
        onMigrationStart(callback: (version: number, direction: MigrationDirection) => void): void
        rollbackAll(): Promise<MigrationResult[]>
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))
      runner.register(createTestMigration(3, 'Third'))

      await runner.runAll()

      runner.onMigrationStart((v, d) => {
        if (d === 'down') rollbackOrder.push(v)
      })

      await runner.rollbackAll()

      expect(rollbackOrder).toEqual([3, 2, 1])
    })

    it('should reject rollback for irreversible migration', async () => {
      const migration: SchemaMigration = {
        version: 1,
        name: 'Drop column',
        up: [
          { type: 'sql', sql: 'ALTER TABLE things DROP COLUMN old_field' }
        ],
        down: [], // Empty down = irreversible
        createdAt: Date.now(),
        checksum: 'test',
      }

      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
        rollback(version: number): Promise<MigrationResult>
      }

      runner.register(migration)
      await runner.run(1)

      await expect(runner.rollback(1))
        .rejects.toThrow(/irreversible|cannot rollback/i)
    })

    it('should remove migration record on successful rollback', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
        rollback(version: number): Promise<MigrationResult>
        getAppliedMigrations(): Promise<AppliedMigration[]>
      }

      runner.register(createTestMigration(1, 'Test'))

      await runner.run(1)
      await runner.rollback(1)

      const applied = await runner.getAppliedMigrations()

      expect(applied.find(m => m.version === 1)).toBeUndefined()
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('should mark failed migration with error status', async () => {
      const badMigration: SchemaMigration = {
        version: 1,
        name: 'Bad migration',
        up: [
          { type: 'sql', sql: 'INVALID SQL SYNTAX' }
        ],
        down: [],
        createdAt: Date.now(),
        checksum: 'test',
      }

      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
      }

      runner.register(badMigration)

      const result = await runner.run(1)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
    })

    it('should stop on first failure when running all', async () => {
      const badMigration: SchemaMigration = {
        version: 2,
        name: 'Bad migration',
        up: [
          { type: 'sql', sql: 'INVALID SQL' }
        ],
        down: [],
        createdAt: Date.now(),
        checksum: 'test',
      }

      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        runAll(): Promise<MigrationResult[]>
      }

      runner.register(createTestMigration(1, 'Good'))
      runner.register(badMigration)
      runner.register(createTestMigration(3, 'Never runs'))

      const results = await runner.runAll()

      expect(results.length).toBe(2)
      expect(results[0].status).toBe('completed')
      expect(results[1].status).toBe('failed')
    })

    it('should rollback failed migration within transaction', async () => {
      const config: MigrationConfig = { transactionMode: 'each' }
      const badMigration: SchemaMigration = {
        version: 1,
        name: 'Partial failure',
        up: [
          { type: 'sql', sql: 'CREATE TABLE test1 (id TEXT)' },
          { type: 'sql', sql: 'INVALID SQL' },
        ],
        down: [],
        createdAt: Date.now(),
        checksum: 'test',
      }

      const runner = null as unknown as {
        configure(config: MigrationConfig): void
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
        tableExists(name: string): Promise<boolean>
      }

      runner.configure(config)
      runner.register(badMigration)

      await runner.run(1)

      // Table should not exist due to rollback
      const exists = await runner.tableExists('test1')
      expect(exists).toBe(false)
    })

    it('should detect checksum mismatch', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
        validateChecksums(): Promise<{ valid: boolean; mismatches: number[] }>
      }

      runner.register(createTestMigration(1, 'Original'))
      await runner.run(1)

      // Modify the migration (simulating code change)
      runner.register({
        ...createTestMigration(1, 'Modified'),
        checksum: 'different-checksum',
      })

      const validation = await runner.validateChecksums()

      expect(validation.valid).toBe(false)
      expect(validation.mismatches).toContain(1)
    })
  })

  // ==========================================================================
  // DRY RUN
  // ==========================================================================

  describe('Dry Run', () => {
    it('should preview migrations without applying', async () => {
      const config: MigrationConfig = { dryRun: true }
      const runner = null as unknown as {
        configure(config: MigrationConfig): void
        register(migration: SchemaMigration): void
        runAll(): Promise<MigrationResult[]>
        getAppliedMigrations(): Promise<AppliedMigration[]>
      }

      runner.configure(config)
      runner.register(createTestMigration(1, 'Test'))

      const results = await runner.runAll()

      expect(results[0].status).toBe('completed')

      const applied = await runner.getAppliedMigrations()
      expect(applied.length).toBe(0)
    })

    it('should return SQL statements in dry run', async () => {
      const config: MigrationConfig = { dryRun: true }
      const runner = null as unknown as {
        configure(config: MigrationConfig): void
        register(migration: SchemaMigration): void
        getDryRunSQL(version: number): Promise<string[]>
      }

      runner.configure(config)
      runner.register(createTestMigration(1, 'Test'))

      const sql = await runner.getDryRunSQL(1)

      expect(sql.length).toBeGreaterThan(0)
      expect(sql[0]).toContain('CREATE TABLE')
    })
  })

  // ==========================================================================
  // BACKUP
  // ==========================================================================

  describe('Backup Before Migration', () => {
    it('should create backup before migration', async () => {
      const config: MigrationConfig = { backupBeforeMigration: true }
      let backupCreated = false
      const runner = null as unknown as {
        configure(config: MigrationConfig): void
        register(migration: SchemaMigration): void
        onBackupCreated(callback: () => void): void
        run(version: number): Promise<MigrationResult>
      }

      runner.configure(config)
      runner.register(createTestMigration(1, 'Test'))
      runner.onBackupCreated(() => { backupCreated = true })

      await runner.run(1)

      expect(backupCreated).toBe(true)
    })

    it('should restore from backup on failure', async () => {
      const config: MigrationConfig = { backupBeforeMigration: true }
      let backupRestored = false
      const badMigration: SchemaMigration = {
        version: 1,
        name: 'Failing migration',
        up: [
          { type: 'sql', sql: 'INVALID SQL' }
        ],
        down: [],
        createdAt: Date.now(),
        checksum: 'test',
      }

      const runner = null as unknown as {
        configure(config: MigrationConfig): void
        register(migration: SchemaMigration): void
        onBackupRestored(callback: () => void): void
        run(version: number): Promise<MigrationResult>
      }

      runner.configure(config)
      runner.register(badMigration)
      runner.onBackupRestored(() => { backupRestored = true })

      await runner.run(1)

      expect(backupRestored).toBe(true)
    })
  })

  // ==========================================================================
  // LOCKING
  // ==========================================================================

  describe('Migration Locking', () => {
    it('should acquire lock before migration', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
        isLocked(): Promise<boolean>
      }

      runner.register(createTestMigration(1, 'Test'))

      // Check lock during migration
      const migrationPromise = runner.run(1)
      const isLocked = await runner.isLocked()

      await migrationPromise

      expect(isLocked).toBe(true)
    })

    it('should release lock after migration', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
        isLocked(): Promise<boolean>
      }

      runner.register(createTestMigration(1, 'Test'))

      await runner.run(1)

      const isLocked = await runner.isLocked()

      expect(isLocked).toBe(false)
    })

    it('should block concurrent migrations', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        run(version: number): Promise<MigrationResult>
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))

      const promise1 = runner.run(1)
      const promise2 = runner.run(2)

      const results = await Promise.allSettled([promise1, promise2])

      // One should succeed, one should be blocked
      const rejected = results.filter(r => r.status === 'rejected')
      expect(rejected.length).toBe(1)
    })

    it('should timeout on lock acquisition', async () => {
      const config: MigrationConfig = { lockTimeoutMs: 1000 }
      const runner = null as unknown as {
        configure(config: MigrationConfig): void
        register(migration: SchemaMigration): void
        simulateLock(): void
        run(version: number): Promise<MigrationResult>
      }

      runner.configure(config)
      runner.register(createTestMigration(1, 'Test'))
      runner.simulateLock()

      await expect(runner.run(1))
        .rejects.toThrow(/lock.*timeout|could not acquire lock/i)
    })
  })

  // ==========================================================================
  // CUSTOM TRANSFORMS
  // ==========================================================================

  describe('Custom Transforms', () => {
    it('should execute transform function', async () => {
      let transformExecuted = false
      const migration: SchemaMigration = {
        version: 1,
        name: 'Data transform',
        up: [
          {
            type: 'transform',
            table: 'things',
            transform: 'normalizeNames',
            params: { uppercase: true }
          }
        ],
        down: [],
        createdAt: Date.now(),
        checksum: 'test',
      }

      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        registerTransform(name: string, fn: (table: string, params: unknown) => Promise<void>): void
        run(version: number): Promise<MigrationResult>
      }

      runner.register(migration)
      runner.registerTransform('normalizeNames', async () => {
        transformExecuted = true
      })

      await runner.run(1)

      expect(transformExecuted).toBe(true)
    })

    it('should pass parameters to transform', async () => {
      let receivedParams: unknown = null
      const migration: SchemaMigration = {
        version: 1,
        name: 'Parameterized transform',
        up: [
          {
            type: 'transform',
            table: 'things',
            transform: 'customTransform',
            params: { value: 42, flag: true }
          }
        ],
        down: [],
        createdAt: Date.now(),
        checksum: 'test',
      }

      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        registerTransform(name: string, fn: (table: string, params: unknown) => Promise<void>): void
        run(version: number): Promise<MigrationResult>
      }

      runner.register(migration)
      runner.registerTransform('customTransform', async (table, params) => {
        receivedParams = params
      })

      await runner.run(1)

      expect(receivedParams).toEqual({ value: 42, flag: true })
    })
  })

  // ==========================================================================
  // VERSION TRACKING
  // ==========================================================================

  describe('Version Tracking', () => {
    it('should track current schema version', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        runAll(): Promise<MigrationResult[]>
        getCurrentVersion(): Promise<number>
      }

      runner.register(createTestMigration(1, 'V1'))
      runner.register(createTestMigration(2, 'V2'))
      runner.register(createTestMigration(3, 'V3'))

      await runner.runAll()

      const version = await runner.getCurrentVersion()

      expect(version).toBe(3)
    })

    it('should return 0 when no migrations applied', async () => {
      const runner = null as unknown as {
        getCurrentVersion(): Promise<number>
      }

      const version = await runner.getCurrentVersion()

      expect(version).toBe(0)
    })

    it('should detect gap in migration versions', async () => {
      const runner = null as unknown as {
        register(migration: SchemaMigration): void
        validateVersions(): { valid: boolean; gaps: number[] }
      }

      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(3, 'Third')) // Gap at 2

      const validation = runner.validateVersions()

      expect(validation.valid).toBe(false)
      expect(validation.gaps).toContain(2)
    })
  })

  // ==========================================================================
  // AUTO MIGRATION
  // ==========================================================================

  describe('Auto Migration', () => {
    it('should run pending migrations on startup', async () => {
      const config: MigrationConfig = { autoMigrate: true }
      const runner = null as unknown as {
        configure(config: MigrationConfig): void
        register(migration: SchemaMigration): void
        initialize(): Promise<void>
        getCurrentVersion(): Promise<number>
      }

      runner.configure(config)
      runner.register(createTestMigration(1, 'First'))
      runner.register(createTestMigration(2, 'Second'))

      await runner.initialize()

      const version = await runner.getCurrentVersion()

      expect(version).toBe(2)
    })

    it('should skip auto migration when disabled', async () => {
      const config: MigrationConfig = { autoMigrate: false }
      const runner = null as unknown as {
        configure(config: MigrationConfig): void
        register(migration: SchemaMigration): void
        initialize(): Promise<void>
        getPendingMigrations(): Promise<SchemaMigration[]>
      }

      runner.configure(config)
      runner.register(createTestMigration(1, 'First'))

      await runner.initialize()

      const pending = await runner.getPendingMigrations()

      expect(pending.length).toBe(1)
    })
  })
})
