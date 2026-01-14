/**
 * @dotdo/migration-engine - Tests
 *
 * TDD Red-Green-Refactor tests for migration engine
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  MigrationEngine,
  MigrationRunner,
  MigrationLockManager,
  ChecksumValidator,
  SchemaSnapshotter,
  MigrationGenerator,
  DependencyResolver,
  InMemoryAdapter,
} from './index.js'
import type {
  Migration,
  MigrationAdapter,
  AppliedMigration,
  MigrationLock,
  SchemaSnapshot,
  MigrationContext,
} from './types.js'
import { LockError, ChecksumError, ExecutionError, DependencyError } from './types.js'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMigration(
  version: string,
  name: string,
  options: Partial<Migration> = {}
): Migration {
  return {
    version,
    name,
    up: vi.fn().mockResolvedValue(undefined),
    down: vi.fn().mockResolvedValue(undefined),
    ...options,
  }
}

function createAdapter(): MigrationAdapter & {
  appliedMigrations: AppliedMigration[]
  lock: MigrationLock | null
  snapshots: Map<string, SchemaSnapshot>
  schema: string
  inTransaction: boolean
} {
  return new InMemoryAdapter()
}

// =============================================================================
// MigrationEngine Tests
// =============================================================================

describe('MigrationEngine', () => {
  let adapter: ReturnType<typeof createAdapter>
  let engine: MigrationEngine

  beforeEach(async () => {
    adapter = createAdapter()
    engine = new MigrationEngine({
      migrations: [],
      adapter,
    })
  })

  describe('migrate()', () => {
    it('should run single pending migration', async () => {
      const migration = createMigration('001', 'create_users')
      engine = new MigrationEngine({
        migrations: [migration],
        adapter,
      })

      const results = await engine.migrate()

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
      expect(results[0].version).toBe('001')
      expect(results[0].direction).toBe('up')
      expect(migration.up).toHaveBeenCalled()
    })

    it('should run multiple migrations in order', async () => {
      const executionOrder: string[] = []
      const m1 = createMigration('001', 'create_users', {
        up: vi.fn().mockImplementation(async () => {
          executionOrder.push('001')
        }),
      })
      const m2 = createMigration('002', 'create_posts', {
        up: vi.fn().mockImplementation(async () => {
          executionOrder.push('002')
        }),
      })
      const m3 = createMigration('003', 'add_user_email', {
        up: vi.fn().mockImplementation(async () => {
          executionOrder.push('003')
        }),
      })

      engine = new MigrationEngine({
        migrations: [m3, m1, m2], // Out of order
        adapter,
      })

      const results = await engine.migrate()

      expect(results).toHaveLength(3)
      expect(executionOrder).toEqual(['001', '002', '003'])
    })

    it('should skip already applied migrations', async () => {
      const m1 = createMigration('001', 'create_users')
      const m2 = createMigration('002', 'create_posts')

      adapter.appliedMigrations.push({
        version: '001',
        name: 'create_users',
        appliedAt: new Date(),
        duration: 100,
      })

      engine = new MigrationEngine({
        migrations: [m1, m2],
        adapter,
      })

      const results = await engine.migrate()

      expect(results).toHaveLength(1)
      expect(results[0].version).toBe('002')
      expect(m1.up).not.toHaveBeenCalled()
      expect(m2.up).toHaveBeenCalled()
    })

    it('should migrate to specific target version', async () => {
      const m1 = createMigration('001', 'create_users')
      const m2 = createMigration('002', 'create_posts')
      const m3 = createMigration('003', 'add_user_email')

      engine = new MigrationEngine({
        migrations: [m1, m2, m3],
        adapter,
      })

      const results = await engine.migrate({ targetVersion: '002' })

      expect(results).toHaveLength(2)
      expect(m1.up).toHaveBeenCalled()
      expect(m2.up).toHaveBeenCalled()
      expect(m3.up).not.toHaveBeenCalled()
    })

    it('should return empty array when no pending migrations', async () => {
      adapter.appliedMigrations.push({
        version: '001',
        name: 'create_users',
        appliedAt: new Date(),
        duration: 100,
      })

      engine = new MigrationEngine({
        migrations: [createMigration('001', 'create_users')],
        adapter,
      })

      const results = await engine.migrate()

      expect(results).toHaveLength(0)
    })
  })

  describe('rollback()', () => {
    beforeEach(async () => {
      adapter.appliedMigrations = [
        { version: '001', name: 'create_users', appliedAt: new Date(), duration: 100 },
        { version: '002', name: 'create_posts', appliedAt: new Date(), duration: 100 },
        { version: '003', name: 'add_user_email', appliedAt: new Date(), duration: 100 },
      ]
    })

    it('should rollback single migration (default)', async () => {
      const m1 = createMigration('001', 'create_users')
      const m2 = createMigration('002', 'create_posts')
      const m3 = createMigration('003', 'add_user_email')

      engine = new MigrationEngine({
        migrations: [m1, m2, m3],
        adapter,
      })

      const results = await engine.rollback({ strategy: 'single' })

      expect(results).toHaveLength(1)
      expect(results[0].version).toBe('003')
      expect(results[0].direction).toBe('down')
      expect(m3.down).toHaveBeenCalled()
      expect(m2.down).not.toHaveBeenCalled()
    })

    it('should rollback to specific version', async () => {
      const m1 = createMigration('001', 'create_users')
      const m2 = createMigration('002', 'create_posts')
      const m3 = createMigration('003', 'add_user_email')

      engine = new MigrationEngine({
        migrations: [m1, m2, m3],
        adapter,
      })

      const results = await engine.rollback({
        strategy: 'to-version',
        targetVersion: '001',
      })

      expect(results).toHaveLength(2)
      expect(results[0].version).toBe('003')
      expect(results[1].version).toBe('002')
      expect(m3.down).toHaveBeenCalled()
      expect(m2.down).toHaveBeenCalled()
      expect(m1.down).not.toHaveBeenCalled()
    })

    it('should rollback all migrations', async () => {
      const m1 = createMigration('001', 'create_users')
      const m2 = createMigration('002', 'create_posts')
      const m3 = createMigration('003', 'add_user_email')

      engine = new MigrationEngine({
        migrations: [m1, m2, m3],
        adapter,
      })

      const results = await engine.rollback({ strategy: 'all' })

      expect(results).toHaveLength(3)
      expect(m3.down).toHaveBeenCalled()
      expect(m2.down).toHaveBeenCalled()
      expect(m1.down).toHaveBeenCalled()
    })

    it('should rollback multiple migrations with count option', async () => {
      const m1 = createMigration('001', 'create_users')
      const m2 = createMigration('002', 'create_posts')
      const m3 = createMigration('003', 'add_user_email')

      engine = new MigrationEngine({
        migrations: [m1, m2, m3],
        adapter,
      })

      const results = await engine.rollback({ strategy: 'single', count: 2 })

      expect(results).toHaveLength(2)
      expect(results[0].version).toBe('003')
      expect(results[1].version).toBe('002')
    })
  })

  describe('status()', () => {
    it('should return correct migration status', async () => {
      const m1 = createMigration('001', 'create_users')
      const m2 = createMigration('002', 'create_posts')
      const m3 = createMigration('003', 'add_user_email')

      adapter.appliedMigrations = [
        { version: '001', name: 'create_users', appliedAt: new Date(), duration: 100 },
      ]

      engine = new MigrationEngine({
        migrations: [m1, m2, m3],
        adapter,
      })

      const status = await engine.status()

      expect(status.applied).toHaveLength(1)
      expect(status.pending).toHaveLength(2)
      expect(status.currentVersion).toBe('001')
      expect(status.isUpToDate).toBe(false)
    })

    it('should indicate when database is up to date', async () => {
      const m1 = createMigration('001', 'create_users')

      adapter.appliedMigrations = [
        { version: '001', name: 'create_users', appliedAt: new Date(), duration: 100 },
      ]

      engine = new MigrationEngine({
        migrations: [m1],
        adapter,
      })

      const status = await engine.status()

      expect(status.isUpToDate).toBe(true)
      expect(status.pending).toHaveLength(0)
    })
  })

  describe('plan()', () => {
    it('should show migration plan without executing', async () => {
      const m1 = createMigration('001', 'create_users')
      const m2 = createMigration('002', 'create_posts')

      engine = new MigrationEngine({
        migrations: [m1, m2],
        adapter,
      })

      const plan = await engine.plan()

      expect(plan.migrations).toHaveLength(2)
      expect(plan.direction).toBe('up')
      expect(plan.dryRun).toBe(true)
      expect(m1.up).not.toHaveBeenCalled()
      expect(m2.up).not.toHaveBeenCalled()
    })

    it('should show rollback plan', async () => {
      adapter.appliedMigrations = [
        { version: '001', name: 'create_users', appliedAt: new Date(), duration: 100 },
        { version: '002', name: 'create_posts', appliedAt: new Date(), duration: 100 },
      ]

      const m1 = createMigration('001', 'create_users')
      const m2 = createMigration('002', 'create_posts')

      engine = new MigrationEngine({
        migrations: [m1, m2],
        adapter,
      })

      const plan = await engine.plan({ direction: 'down' })

      expect(plan.migrations).toHaveLength(2)
      expect(plan.direction).toBe('down')
    })
  })

  describe('create()', () => {
    it('should generate new migration file content', async () => {
      engine = new MigrationEngine({
        migrations: [],
        adapter,
      })

      const result = await engine.create('create_users')

      expect(result.version).toMatch(/^\d{14}$/) // Timestamp format
      expect(result.name).toBe('create_users')
      expect(result.content).toContain('export const migration')
      expect(result.content).toContain('up:')
      expect(result.content).toContain('down:')
    })
  })
})

// =============================================================================
// ChecksumValidator Tests
// =============================================================================

describe('ChecksumValidator', () => {
  let validator: ChecksumValidator

  beforeEach(() => {
    validator = new ChecksumValidator()
  })

  it('should generate consistent checksum for migration', () => {
    const migration = createMigration('001', 'create_users')

    const checksum1 = validator.generate(migration)
    const checksum2 = validator.generate(migration)

    expect(checksum1).toBe(checksum2)
  })

  it('should detect checksum mismatch', () => {
    const migration = createMigration('001', 'create_users', {
      checksum: 'original-checksum',
    })

    expect(() => validator.validate(migration, 'different-checksum')).toThrow(
      ChecksumError
    )
  })

  it('should pass validation when checksums match', () => {
    const migration = createMigration('001', 'create_users')
    const checksum = validator.generate(migration)

    expect(() => validator.validate(migration, checksum)).not.toThrow()
  })

  it('should generate different checksums for different migrations', () => {
    const m1 = createMigration('001', 'create_users')
    const m2 = createMigration('002', 'create_posts')

    const checksum1 = validator.generate(m1)
    const checksum2 = validator.generate(m2)

    expect(checksum1).not.toBe(checksum2)
  })
})

// =============================================================================
// MigrationLockManager Tests
// =============================================================================

describe('MigrationLockManager', () => {
  let adapter: ReturnType<typeof createAdapter>
  let lockManager: MigrationLockManager

  beforeEach(() => {
    adapter = createAdapter()
    lockManager = new MigrationLockManager(adapter, 30000)
  })

  it('should acquire lock successfully', async () => {
    const acquired = await lockManager.acquire('instance-1')

    expect(acquired).toBe(true)
    expect(adapter.lock).not.toBeNull()
    expect(adapter.lock?.holder).toBe('instance-1')
  })

  it('should release lock', async () => {
    await lockManager.acquire('instance-1')
    await lockManager.release('instance-1')

    expect(adapter.lock).toBeNull()
  })

  it('should prevent concurrent migration (lock already held)', async () => {
    adapter.lock = {
      holder: 'other-instance',
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 30000),
    }

    const acquired = await lockManager.acquire('instance-1')

    expect(acquired).toBe(false)
  })

  it('should allow acquiring expired lock', async () => {
    adapter.lock = {
      holder: 'other-instance',
      acquiredAt: new Date(Date.now() - 60000),
      expiresAt: new Date(Date.now() - 30000), // Expired
    }

    const acquired = await lockManager.acquire('instance-1')

    expect(acquired).toBe(true)
    expect(adapter.lock?.holder).toBe('instance-1')
  })

  it('should check if lock is held', async () => {
    expect(await lockManager.isLocked()).toBe(false)

    await lockManager.acquire('instance-1')

    expect(await lockManager.isLocked()).toBe(true)
  })

  it('should throw LockError when migration runs without lock', async () => {
    adapter.lock = {
      holder: 'other-instance',
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 30000),
    }

    await expect(lockManager.requireLock('my-instance')).rejects.toThrow(LockError)
  })
})

// =============================================================================
// MigrationRunner Tests
// =============================================================================

describe('MigrationRunner', () => {
  let adapter: ReturnType<typeof createAdapter>
  let runner: MigrationRunner

  beforeEach(() => {
    adapter = createAdapter()
    runner = new MigrationRunner(adapter)
  })

  describe('runUp()', () => {
    it('should execute migration up function', async () => {
      const migration = createMigration('001', 'create_users')

      const result = await runner.runUp(migration)

      expect(result.success).toBe(true)
      expect(result.version).toBe('001')
      expect(result.direction).toBe('up')
      expect(migration.up).toHaveBeenCalled()
    })

    it('should handle failed migration', async () => {
      const migration = createMigration('001', 'create_users', {
        up: vi.fn().mockRejectedValue(new Error('SQL error')),
      })

      const result = await runner.runUp(migration)

      expect(result.success).toBe(false)
      expect(result.error).toContain('SQL error')
    })

    it('should measure execution duration', async () => {
      const migration = createMigration('001', 'create_users', {
        up: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 50))
        }),
      })

      const result = await runner.runUp(migration)

      expect(result.duration).toBeGreaterThanOrEqual(50)
    })
  })

  describe('runDown()', () => {
    it('should execute migration down function', async () => {
      const migration = createMigration('001', 'create_users')

      const result = await runner.runDown(migration)

      expect(result.success).toBe(true)
      expect(result.direction).toBe('down')
      expect(migration.down).toHaveBeenCalled()
    })
  })

  describe('transaction handling', () => {
    it('should wrap migration in transaction', async () => {
      const migration = createMigration('001', 'create_users')
      runner = new MigrationRunner(adapter, { useTransactions: true })

      await runner.runUp(migration)

      // Transaction should have been used
      expect(adapter.inTransaction).toBe(false) // Should be committed
    })

    it('should rollback transaction on failure', async () => {
      const migration = createMigration('001', 'create_users', {
        up: vi.fn().mockRejectedValue(new Error('SQL error')),
      })
      runner = new MigrationRunner(adapter, { useTransactions: true })

      await runner.runUp(migration)

      // Transaction should have been rolled back
      expect(adapter.inTransaction).toBe(false)
    })
  })
})

// =============================================================================
// SchemaSnapshotter Tests
// =============================================================================

describe('SchemaSnapshotter', () => {
  let adapter: ReturnType<typeof createAdapter>
  let snapshotter: SchemaSnapshotter

  beforeEach(() => {
    adapter = createAdapter()
    snapshotter = new SchemaSnapshotter(adapter)
  })

  it('should capture schema snapshot after migration', async () => {
    adapter.schema = 'CREATE TABLE users (id INT, name TEXT)'

    await snapshotter.capture('001')

    expect(adapter.snapshots.has('001')).toBe(true)
    const snapshot = adapter.snapshots.get('001')!
    expect(snapshot.schema).toContain('CREATE TABLE users')
  })

  it('should retrieve schema snapshot', async () => {
    adapter.snapshots.set('001', {
      version: '001',
      schema: 'CREATE TABLE users (id INT)',
      timestamp: new Date(),
    })

    const snapshot = await snapshotter.get('001')

    expect(snapshot).not.toBeNull()
    expect(snapshot?.version).toBe('001')
  })

  it('should compare current schema with snapshot', async () => {
    adapter.snapshots.set('001', {
      version: '001',
      schema: 'CREATE TABLE users (id INT)',
      timestamp: new Date(),
    })
    adapter.schema = 'CREATE TABLE users (id INT, name TEXT)'

    const diff = await snapshotter.diff('001')

    expect(diff.hasChanges).toBe(true)
    expect(diff.before).toBe('CREATE TABLE users (id INT)')
    expect(diff.after).toContain('name TEXT')
  })
})

// =============================================================================
// DependencyResolver Tests
// =============================================================================

describe('DependencyResolver', () => {
  let resolver: DependencyResolver

  beforeEach(() => {
    resolver = new DependencyResolver()
  })

  it('should resolve migrations in dependency order', () => {
    const m1 = createMigration('001', 'create_users')
    const m2 = createMigration('002', 'create_posts', { dependencies: ['001'] })
    const m3 = createMigration('003', 'create_comments', {
      dependencies: ['001', '002'],
    })

    const ordered = resolver.resolve([m3, m1, m2])

    expect(ordered.map((m) => m.version)).toEqual(['001', '002', '003'])
  })

  it('should detect circular dependencies', () => {
    const m1 = createMigration('001', 'create_users', { dependencies: ['002'] })
    const m2 = createMigration('002', 'create_posts', { dependencies: ['001'] })

    expect(() => resolver.resolve([m1, m2])).toThrow(DependencyError)
  })

  it('should detect missing dependencies', () => {
    const m1 = createMigration('001', 'create_users', {
      dependencies: ['999'], // Non-existent
    })

    expect(() => resolver.resolve([m1])).toThrow(DependencyError)
  })

  it('should handle migrations without dependencies', () => {
    const m1 = createMigration('001', 'create_users')
    const m2 = createMigration('002', 'create_posts')

    const ordered = resolver.resolve([m2, m1])

    // Should order by version when no deps
    expect(ordered.map((m) => m.version)).toEqual(['001', '002'])
  })
})

// =============================================================================
// MigrationGenerator Tests
// =============================================================================

describe('MigrationGenerator', () => {
  let generator: MigrationGenerator

  beforeEach(() => {
    generator = new MigrationGenerator()
  })

  it('should generate migration from schema diff', () => {
    const before = 'CREATE TABLE users (id INT)'
    const after = 'CREATE TABLE users (id INT, email TEXT)'

    const migration = generator.fromDiff(before, after, 'add_user_email')

    expect(migration.name).toBe('add_user_email')
    expect(migration.version).toMatch(/^\d{14}$/)
  })

  it('should generate timestamp-based version', () => {
    const version = generator.generateVersion()

    expect(version).toMatch(/^\d{14}$/)
    // Should be close to current time
    const now = new Date()
    const versionDate = new Date(
      parseInt(version.slice(0, 4)),
      parseInt(version.slice(4, 6)) - 1,
      parseInt(version.slice(6, 8)),
      parseInt(version.slice(8, 10)),
      parseInt(version.slice(10, 12)),
      parseInt(version.slice(12, 14))
    )
    expect(Math.abs(versionDate.getTime() - now.getTime())).toBeLessThan(60000)
  })

  it('should generate migration file content', () => {
    const content = generator.generateContent('create_users')

    expect(content).toContain('export const migration')
    expect(content).toContain('up:')
    expect(content).toContain('down:')
    expect(content).toContain('create_users')
  })
})

// =============================================================================
// Dry Run Mode Tests
// =============================================================================

describe('Dry Run Mode', () => {
  let adapter: ReturnType<typeof createAdapter>
  let engine: MigrationEngine

  beforeEach(() => {
    adapter = createAdapter()
  })

  it('should not execute migrations in dry run mode', async () => {
    const migration = createMigration('001', 'create_users')
    engine = new MigrationEngine({
      migrations: [migration],
      adapter,
    })

    const results = await engine.migrate({ dryRun: true })

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
    expect(migration.up).not.toHaveBeenCalled()
    expect(adapter.appliedMigrations).toHaveLength(0)
  })

  it('should show what would be executed in dry run', async () => {
    const m1 = createMigration('001', 'create_users')
    const m2 = createMigration('002', 'create_posts')

    engine = new MigrationEngine({
      migrations: [m1, m2],
      adapter,
    })

    const results = await engine.migrate({ dryRun: true })

    expect(results).toHaveLength(2)
    expect(results.map((r) => r.version)).toEqual(['001', '002'])
  })
})

// =============================================================================
// Idempotent Migration Tests
// =============================================================================

describe('Idempotent Migrations', () => {
  let adapter: ReturnType<typeof createAdapter>
  let engine: MigrationEngine

  beforeEach(() => {
    adapter = createAdapter()
  })

  it('should not re-apply already applied migrations', async () => {
    const migration = createMigration('001', 'create_users')

    adapter.appliedMigrations = [
      { version: '001', name: 'create_users', appliedAt: new Date(), duration: 100 },
    ]

    engine = new MigrationEngine({
      migrations: [migration],
      adapter,
    })

    const results = await engine.migrate()

    expect(results).toHaveLength(0)
    expect(migration.up).not.toHaveBeenCalled()
  })

  it('should allow re-running specific migration if forced', async () => {
    const migration = createMigration('001', 'create_users')

    adapter.appliedMigrations = [
      { version: '001', name: 'create_users', appliedAt: new Date(), duration: 100 },
    ]

    engine = new MigrationEngine({
      migrations: [migration],
      adapter,
    })

    // Re-run specific migration
    const result = await engine.rerun('001')

    expect(result.success).toBe(true)
    expect(migration.down).toHaveBeenCalled()
    expect(migration.up).toHaveBeenCalled()
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  let adapter: ReturnType<typeof createAdapter>
  let engine: MigrationEngine

  beforeEach(() => {
    adapter = createAdapter()
  })

  it('should handle failed migration gracefully', async () => {
    const m1 = createMigration('001', 'create_users')
    const m2 = createMigration('002', 'create_posts', {
      up: vi.fn().mockRejectedValue(new Error('Table already exists')),
    })
    const m3 = createMigration('003', 'add_email')

    engine = new MigrationEngine({
      migrations: [m1, m2, m3],
      adapter,
    })

    const results = await engine.migrate()

    expect(results).toHaveLength(2) // Only m1 and m2 (failed)
    expect(results[0].success).toBe(true)
    expect(results[1].success).toBe(false)
    expect(results[1].error).toContain('Table already exists')
    // m3 should not be attempted after m2 fails
    expect(m3.up).not.toHaveBeenCalled()
  })

  it('should record failed migration state', async () => {
    const migration = createMigration('001', 'create_users', {
      up: vi.fn().mockRejectedValue(new Error('SQL syntax error')),
    })

    engine = new MigrationEngine({
      migrations: [migration],
      adapter,
    })

    await engine.migrate()

    const status = await engine.status()
    expect(status.failed).toHaveLength(1)
    expect(status.failed[0].version).toBe('001')
  })

  it('should throw ExecutionError with proper details', async () => {
    const migration = createMigration('001', 'create_users', {
      up: vi.fn().mockRejectedValue(new Error('Connection refused')),
    })

    engine = new MigrationEngine({
      migrations: [migration],
      adapter,
    })

    const results = await engine.migrate()

    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('Connection refused')
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration: Full Migration Lifecycle', () => {
  let adapter: ReturnType<typeof createAdapter>
  let engine: MigrationEngine

  beforeEach(() => {
    adapter = createAdapter()
  })

  it('should complete full migrate-rollback cycle', async () => {
    const m1 = createMigration('001', 'create_users')
    const m2 = createMigration('002', 'create_posts')

    engine = new MigrationEngine({
      migrations: [m1, m2],
      adapter,
    })

    // Migrate up
    let results = await engine.migrate()
    expect(results).toHaveLength(2)
    expect(adapter.appliedMigrations).toHaveLength(2)

    // Check status
    let status = await engine.status()
    expect(status.isUpToDate).toBe(true)

    // Rollback one
    results = await engine.rollback({ strategy: 'single' })
    expect(results).toHaveLength(1)
    expect(adapter.appliedMigrations).toHaveLength(1)

    // Check status again
    status = await engine.status()
    expect(status.isUpToDate).toBe(false)
    expect(status.pending).toHaveLength(1)

    // Migrate up again
    results = await engine.migrate()
    expect(results).toHaveLength(1)
    expect(results[0].version).toBe('002')
  })

  it('should handle migrations with dependencies correctly', async () => {
    const executionOrder: string[] = []

    const m1 = createMigration('001', 'create_users', {
      up: vi.fn().mockImplementation(async () => {
        executionOrder.push('001')
      }),
    })
    const m2 = createMigration('002', 'create_posts', {
      dependencies: ['001'],
      up: vi.fn().mockImplementation(async () => {
        executionOrder.push('002')
      }),
    })
    const m3 = createMigration('003', 'create_comments', {
      dependencies: ['002'],
      up: vi.fn().mockImplementation(async () => {
        executionOrder.push('003')
      }),
    })

    engine = new MigrationEngine({
      migrations: [m3, m1, m2], // Out of order
      adapter,
    })

    await engine.migrate()

    expect(executionOrder).toEqual(['001', '002', '003'])
  })
})
