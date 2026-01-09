/**
 * MigrationManager Unit Tests
 *
 * Tests for the MigrationManager class that handles all migration operations.
 * These tests use a mock database to test the manager logic in isolation.
 *
 * @module @dotdo/payload/tests/migrations/manager.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MigrationManager,
  createMigrationManager,
  type Migration,
  type MigrationManagerConfig,
} from '../../src/migrations/manager'
import type { MigrateUpArgs, MigrateDownArgs } from '../../src/migrations/helpers'

// ============================================================================
// MOCK DATABASE
// ============================================================================

/**
 * Simple in-memory mock database for testing.
 * Simulates better-sqlite3 interface which is what the tracking module expects.
 */
function createMockDb() {
  const tables = new Map<string, any[]>()
  let lastInsertId = 0

  const executeSql = (sql: string) => {
    // Parse CREATE TABLE
    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+"?(\w+)"?/i)
    if (createMatch) {
      if (!tables.has(createMatch[1])) {
        tables.set(createMatch[1], [])
      }
    }

    // Parse CREATE INDEX (ignore, just don't error)
    if (sql.match(/CREATE INDEX/i)) {
      return { changes: 0 }
    }

    // Parse INSERT
    const insertMatch = sql.match(/INSERT INTO\s+"?(\w+)"?\s*\((.*?)\)\s*VALUES\s*\((.*?)\)/is)
    if (insertMatch) {
      const tableName = insertMatch[1]
      const cols = insertMatch[2].split(',').map((c) => c.trim().replace(/"/g, ''))
      const vals = insertMatch[3].split(',').map((v) => {
        v = v.trim()
        if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1)
        if (v === 'NULL') return null
        const parsed = parseInt(v)
        return isNaN(parsed) ? v : parsed
      })

      const row: any = { id: ++lastInsertId }
      cols.forEach((col, i) => (row[col] = vals[i]))

      if (!tables.has(tableName)) {
        tables.set(tableName, [])
      }
      tables.get(tableName)!.push(row)
      return { changes: 1 }
    }

    // Parse DELETE with WHERE
    const deleteMatch = sql.match(/DELETE FROM\s+"?(\w+)"?(?:\s+WHERE\s+"?(\w+)"?\s*=\s*'([^']+)')?/i)
    if (deleteMatch) {
      const tableName = deleteMatch[1]

      if (deleteMatch[2] && deleteMatch[3]) {
        const col = deleteMatch[2]
        const val = deleteMatch[3]

        if (tables.has(tableName)) {
          const rows = tables.get(tableName)!
          const idx = rows.findIndex((r) => r[col] === val)
          if (idx >= 0) rows.splice(idx, 1)
        }
      } else {
        // DELETE all
        if (tables.has(tableName)) {
          tables.set(tableName, [])
        }
      }
      return { changes: 1 }
    }

    return { changes: 0 }
  }

  const queryAll = (sql: string): any[] => {
    // Parse SELECT
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM\s+"?(\w+)"?/is)
    if (selectMatch) {
      const tableName = selectMatch[2]

      if (!tables.has(tableName)) {
        throw new Error(`no such table: ${tableName}`)
      }

      let rows = [...(tables.get(tableName) || [])]

      // Handle WHERE clause
      const whereMatch = sql.match(/WHERE\s+"?(\w+)"?\s*=\s*(\d+|'[^']+')/i)
      if (whereMatch) {
        const col = whereMatch[1]
        let val: string | number = whereMatch[2]
        if (typeof val === 'string' && val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1)
        } else {
          val = parseInt(val as string)
        }
        rows = rows.filter((r) => r[col] === val)
      }

      // Handle ORDER BY
      const orderMatch = sql.match(/ORDER BY\s+"?(\w+)"?\s+(ASC|DESC)?/i)
      if (orderMatch) {
        const col = orderMatch[1]
        const desc = orderMatch[2]?.toUpperCase() === 'DESC'
        rows = rows.sort((a, b) => {
          if (desc) return a[col] > b[col] ? -1 : 1
          return a[col] < b[col] ? -1 : 1
        })
      }

      // Handle MAX
      const maxMatch = sql.match(/SELECT\s+MAX\("?(\w+)"?\)\s+as\s+"?(\w+)"?/i)
      if (maxMatch) {
        const col = maxMatch[1]
        const alias = maxMatch[2]
        const maxVal = rows.length > 0
          ? rows.reduce((max, r) => Math.max(max, r[col] || 0), 0)
          : null
        return [{ [alias]: maxVal }]
      }

      // Handle column aliasing in SELECT
      const columnsStr = selectMatch[1]
      if (columnsStr.includes(' as ')) {
        return rows.map((row) => {
          const newRow: any = {}
          const colParts = columnsStr.split(',').map((c) => c.trim())
          for (const colPart of colParts) {
            const aliasMatch = colPart.match(/(\w+)\s+as\s+(\w+)/i)
            if (aliasMatch) {
              newRow[aliasMatch[2]] = row[aliasMatch[1]]
            } else {
              const colName = colPart.trim()
              newRow[colName] = row[colName]
            }
          }
          return newRow
        })
      }

      return rows
    }

    return []
  }

  // Return mock that simulates better-sqlite3 interface
  const mockDb = {
    $client: {
      exec: executeSql,
      prepare: (sql: string) => ({
        all: () => queryAll(sql),
        run: () => executeSql(sql),
        get: () => queryAll(sql)[0] || null,
      }),
    },
    tables,
    clear: () => {
      tables.clear()
      lastInsertId = 0
    },
    // Convenience method for test assertions
    all: (sql: string): any[] => {
      try {
        return queryAll(sql)
      } catch (e) {
        return []
      }
    },
  }

  return mockDb
}

// ============================================================================
// MOCK PAYLOAD
// ============================================================================

/**
 * Create a mock Payload instance for testing
 */
function createMockPayload() {
  const collections = new Map<string, any[]>()

  return {
    find: async <T>({ collection, where, limit, page }: any) => {
      const docs = collections.get(collection) || []
      return { docs: docs.slice(0, limit || 10) as T[], totalDocs: docs.length }
    },
    findByID: async <T>({ collection, id }: any) => {
      const docs = collections.get(collection) || []
      return (docs.find((d) => d.id === id) || null) as T | null
    },
    update: async <T>({ collection, id, data }: any) => {
      const docs = collections.get(collection) || []
      const idx = docs.findIndex((d) => d.id === id)
      if (idx >= 0) {
        docs[idx] = { ...docs[idx], ...data }
        return docs[idx] as T
      }
      throw new Error(`Document ${id} not found`)
    },
    create: async <T>({ collection, data }: any) => {
      if (!collections.has(collection)) collections.set(collection, [])
      const doc = { id: `${Date.now()}`, ...data }
      collections.get(collection)!.push(doc)
      return doc as T
    },
    delete: async ({ collection, id }: any) => {
      const docs = collections.get(collection) || []
      const idx = docs.findIndex((d) => d.id === id)
      if (idx >= 0) {
        const [deleted] = docs.splice(idx, 1)
        return deleted
      }
      throw new Error(`Document ${id} not found`)
    },
    db: {},
    collections,
  }
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTestMigration(name: string, timestamp: number): Migration {
  return {
    name,
    timestamp,
    up: vi.fn().mockResolvedValue(undefined),
    down: vi.fn().mockResolvedValue(undefined),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('MigrationManager', () => {
  let db: ReturnType<typeof createMockDb>
  let payload: ReturnType<typeof createMockPayload>
  let config: MigrationManagerConfig
  let manager: MigrationManager

  beforeEach(() => {
    db = createMockDb()
    payload = createMockPayload()
    config = {
      db: db as any,
      strategy: 'drizzle',
      migrationDir: './src/migrations',
      payload: payload as any,
      collections: [],
    }
    manager = createMigrationManager(config)
  })

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  describe('initialization', () => {
    it('should create manager via factory function', () => {
      const manager = createMigrationManager(config)
      expect(manager).toBeInstanceOf(MigrationManager)
    })

    it('should initialize tracking table on first operation', async () => {
      await manager.init()
      expect(db.tables.has('payload_migrations')).toBe(true)
    })

    it('should only initialize once', async () => {
      await manager.init()
      await manager.init()
      // No error, and still one table
      expect(db.tables.has('payload_migrations')).toBe(true)
    })
  })

  // ==========================================================================
  // MIGRATION REGISTRATION
  // ==========================================================================

  describe('registerMigrations', () => {
    it('should register migrations', () => {
      const m1 = createTestMigration('20260109_001_test', 1736380800000)

      manager.registerMigrations([m1])

      const registered = manager.getMigrations()
      expect(registered).toHaveLength(1)
      expect(registered[0].name).toBe('20260109_001_test')
    })

    it('should sort migrations by timestamp', () => {
      const m1 = createTestMigration('20260109_003_third', 1736380800000 + 2000)
      const m2 = createTestMigration('20260109_001_first', 1736380800000)
      const m3 = createTestMigration('20260109_002_second', 1736380800000 + 1000)

      manager.registerMigrations([m1, m2, m3])

      const registered = manager.getMigrations()
      expect(registered[0].name).toBe('20260109_001_first')
      expect(registered[1].name).toBe('20260109_002_second')
      expect(registered[2].name).toBe('20260109_003_third')
    })

    it('should throw on duplicate migration names', () => {
      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      const m2 = createTestMigration('20260109_001_test', 1736380800001)

      manager.registerMigrations([m1])

      expect(() => manager.registerMigrations([m2])).toThrow("Migration '20260109_001_test' is already registered")
    })

    it('should clear migrations', () => {
      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      manager.registerMigrations([m1])

      manager.clearMigrations()

      expect(manager.getMigrations()).toHaveLength(0)
    })
  })

  // ==========================================================================
  // CREATE MIGRATION
  // ==========================================================================

  describe('createMigration', () => {
    it('should create migration with timestamp', async () => {
      const result = await manager.createMigration({ name: 'add_posts_table' })

      expect(result.name).toMatch(/^\d{8}_\d{6}_add_posts_table$/)
      expect(result.path).toContain('./src/migrations/')
      expect(result.content).toBeDefined()
    })

    it('should generate Drizzle template by default', async () => {
      const result = await manager.createMigration({ name: 'test_migration' })

      expect(result.content).toContain('execute')
      expect(result.content).toContain('Drizzle')
    })

    it('should generate Things template when strategy is things', async () => {
      const thingsManager = createMigrationManager({
        ...config,
        strategy: 'things',
        getTypeId: async () => 1,
      })

      const result = await thingsManager.createMigration({ name: 'test_migration' })

      expect(result.content).toContain('helpers')
      expect(result.content).toContain('Things')
    })

    it('should generate blank template', async () => {
      const result = await manager.createMigration({ name: 'blank_migration', blank: true })

      expect(result.content).toContain('up')
      expect(result.content).toContain('down')
      expect(result.content).not.toContain('Example:')
    })

    it('should sanitize migration name', async () => {
      const result = await manager.createMigration({ name: 'Add Users Table!!' })

      expect(result.name).toMatch(/add_users_table/)
      expect(result.name).not.toContain(' ')
      expect(result.name).not.toContain('!')
    })
  })

  // ==========================================================================
  // MIGRATE
  // ==========================================================================

  describe('migrate', () => {
    it('should run pending migrations in order', async () => {
      const executionOrder: string[] = []

      const m1: Migration = {
        name: '20260109_001_first',
        timestamp: 1736380800000,
        up: vi.fn().mockImplementation(async () => {
          executionOrder.push('first')
        }),
        down: vi.fn(),
      }
      const m2: Migration = {
        name: '20260109_002_second',
        timestamp: 1736380800001,
        up: vi.fn().mockImplementation(async () => {
          executionOrder.push('second')
        }),
        down: vi.fn(),
      }

      manager.registerMigrations([m2, m1]) // Register out of order
      const result = await manager.migrate()

      expect(result.ran).toHaveLength(2)
      expect(result.ran[0].name).toBe('20260109_001_first')
      expect(result.ran[1].name).toBe('20260109_002_second')
      expect(executionOrder).toEqual(['first', 'second'])
    })

    it('should skip already applied migrations', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)

      manager.registerMigrations([m1, m2])

      // Run first migration
      await manager.migrate()

      // Register a new migration and run again
      manager.clearMigrations()
      manager.registerMigrations([m1, m2])

      const result = await manager.migrate()

      expect(result.ran).toHaveLength(0)
      expect(result.skipped).toHaveLength(2)
    })

    it('should record migrations in tracking table', async () => {
      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      manager.registerMigrations([m1])

      await manager.migrate()

      const migrations = db.all('SELECT * FROM payload_migrations')
      expect(migrations).toHaveLength(1)
      expect(migrations[0].name).toBe('20260109_001_test')
      expect(migrations[0].batch).toBe(1)
    })

    it('should assign batch numbers correctly', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)
      const m3 = createTestMigration('20260109_003_third', 1736380800002)

      // First batch
      manager.registerMigrations([m1])
      await manager.migrate()

      // Second batch
      manager.registerMigrations([m2, m3])
      await manager.migrate()

      const migrations = db.all('SELECT * FROM payload_migrations ORDER BY "name" ASC')
      expect(migrations[0].batch).toBe(1)
      expect(migrations[1].batch).toBe(2)
      expect(migrations[2].batch).toBe(2)
    })

    it('should support --only option', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)

      manager.registerMigrations([m1, m2])

      const result = await manager.migrate({ only: '20260109_001_first' })

      expect(result.ran).toHaveLength(1)
      expect(result.ran[0].name).toBe('20260109_001_first')
    })

    it('should support dry run', async () => {
      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      manager.registerMigrations([m1])

      const result = await manager.migrate({ dryRun: true })

      expect(result.ran).toHaveLength(0)
      expect(result.pending).toHaveLength(1)
      expect(m1.up).not.toHaveBeenCalled()
    })

    it('should throw on migration failure by default', async () => {
      const m1: Migration = {
        name: '20260109_001_failing',
        timestamp: 1736380800000,
        up: vi.fn().mockRejectedValue(new Error('Migration failed!')),
        down: vi.fn(),
      }

      manager.registerMigrations([m1])

      await expect(manager.migrate()).rejects.toThrow('Migration failed!')
    })

    it('should continue on error with force flag', async () => {
      const m1: Migration = {
        name: '20260109_001_failing',
        timestamp: 1736380800000,
        up: vi.fn().mockRejectedValue(new Error('Failed!')),
        down: vi.fn(),
      }
      const m2 = createTestMigration('20260109_002_success', 1736380800001)

      manager.registerMigrations([m1, m2])

      const result = await manager.migrate({ force: true })

      expect(result.ran).toHaveLength(1)
      expect(result.ran[0].name).toBe('20260109_002_success')
      expect(result.errors).toHaveLength(1)
      expect(result.errors![0].name).toBe('20260109_001_failing')
    })

    it('should add migration name to error context', async () => {
      const m1: Migration = {
        name: '20260109_001_test',
        timestamp: 1736380800000,
        up: vi.fn().mockRejectedValue(new Error('SQL error')),
        down: vi.fn(),
      }

      manager.registerMigrations([m1])

      try {
        await manager.migrate()
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.migration).toBe('20260109_001_test')
      }
    })
  })

  // ==========================================================================
  // MIGRATE DOWN
  // ==========================================================================

  describe('migrateDown', () => {
    it('should roll back last batch', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)

      manager.registerMigrations([m1, m2])
      await manager.migrate()

      const result = await manager.migrateDown()

      // Both were in batch 1, so both should be rolled back
      expect(result.rolledBack).toHaveLength(2)
      expect(m2.down).toHaveBeenCalled()
      expect(m1.down).toHaveBeenCalled()
    })

    it('should roll back in reverse order', async () => {
      const executionOrder: string[] = []

      const m1: Migration = {
        name: '20260109_001_first',
        timestamp: 1736380800000,
        up: vi.fn(),
        down: vi.fn().mockImplementation(async () => {
          executionOrder.push('first_down')
        }),
      }
      const m2: Migration = {
        name: '20260109_002_second',
        timestamp: 1736380800001,
        up: vi.fn(),
        down: vi.fn().mockImplementation(async () => {
          executionOrder.push('second_down')
        }),
      }

      manager.registerMigrations([m1, m2])
      await manager.migrate()

      await manager.migrateDown()

      expect(executionOrder).toEqual(['second_down', 'first_down'])
    })

    it('should remove migration records after rollback', async () => {
      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      manager.registerMigrations([m1])
      await manager.migrate()

      expect(db.all('SELECT * FROM payload_migrations')).toHaveLength(1)

      await manager.migrateDown()

      expect(db.all('SELECT * FROM payload_migrations')).toHaveLength(0)
    })

    it('should return empty result when nothing to roll back', async () => {
      const result = await manager.migrateDown()

      expect(result.rolledBack).toHaveLength(0)
    })

    it('should support rolling back multiple steps', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)
      const m3 = createTestMigration('20260109_003_third', 1736380800002)

      manager.registerMigrations([m1])
      await manager.migrate()

      manager.registerMigrations([m2])
      await manager.migrate()

      manager.registerMigrations([m3])
      await manager.migrate()

      const result = await manager.migrateDown({ steps: 2 })

      // Should roll back batches 3 and 2
      expect(result.rolledBack).toHaveLength(2)
      expect(result.rolledBack[0].name).toBe('20260109_003_third')
      expect(result.rolledBack[1].name).toBe('20260109_002_second')
    })

    it('should roll back specific migration', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)

      manager.registerMigrations([m1, m2])
      await manager.migrate()

      const result = await manager.migrateDown({ migration: '20260109_002_second' })

      expect(result.rolledBack).toHaveLength(1)
      expect(result.rolledBack[0].name).toBe('20260109_002_second')
    })

    it('should throw for non-existent migration', async () => {
      await expect(manager.migrateDown({ migration: 'nonexistent' })).rejects.toThrow(
        "Migration 'nonexistent' not found"
      )
    })

    it('should throw for migration without down function', async () => {
      const m1: Migration = {
        name: '20260109_001_no_down',
        timestamp: 1736380800000,
        up: vi.fn(),
        // No down function
      }

      manager.registerMigrations([m1])
      await manager.migrate()

      await expect(manager.migrateDown()).rejects.toThrow("has no down function")
    })
  })

  // ==========================================================================
  // MIGRATE STATUS
  // ==========================================================================

  describe('migrateStatus', () => {
    it('should return status of all migrations', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)

      manager.registerMigrations([m1, m2])
      await manager.migrate()

      const status = await manager.migrateStatus()

      expect(status.total).toBe(2)
      expect(status.ran).toBe(2)
      expect(status.pending).toBe(0)
      expect(status.migrations).toHaveLength(2)
    })

    it('should mark pending migrations correctly', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)

      manager.registerMigrations([m1])
      await manager.migrate()

      manager.registerMigrations([m2])

      const status = await manager.migrateStatus()

      expect(status.ran).toBe(1)
      expect(status.pending).toBe(1)

      const m1Status = status.migrations.find((m) => m.name === '20260109_001_first')
      const m2Status = status.migrations.find((m) => m.name === '20260109_002_second')

      expect(m1Status?.ran).toBe(true)
      expect(m2Status?.ran).toBe(false)
    })

    it('should include batch and ranAt for applied migrations', async () => {
      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      manager.registerMigrations([m1])
      await manager.migrate()

      const status = await manager.migrateStatus()

      expect(status.migrations[0].batch).toBe(1)
      expect(status.migrations[0].ranAt).toBeDefined()
    })

    it('should return empty status when no migrations', async () => {
      const status = await manager.migrateStatus()

      expect(status.total).toBe(0)
      expect(status.ran).toBe(0)
      expect(status.pending).toBe(0)
      expect(status.migrations).toHaveLength(0)
    })
  })

  // ==========================================================================
  // MIGRATE REFRESH
  // ==========================================================================

  describe('migrateRefresh', () => {
    it('should roll back all and re-run migrations', async () => {
      const executionOrder: string[] = []

      // Use properly formatted timestamps that parseTimestampFromName can parse
      // Format: YYYYMMDD_HHMMSS
      const m1: Migration = {
        name: '20260109_000000_first',
        timestamp: 1736380800000,
        up: vi.fn().mockImplementation(async () => {
          executionOrder.push('first_up')
        }),
        down: vi.fn().mockImplementation(async () => {
          executionOrder.push('first_down')
        }),
      }
      const m2: Migration = {
        name: '20260109_000100_second',
        timestamp: 1736380800001,
        up: vi.fn().mockImplementation(async () => {
          executionOrder.push('second_up')
        }),
        down: vi.fn().mockImplementation(async () => {
          executionOrder.push('second_down')
        }),
      }

      manager.registerMigrations([m1, m2])
      await manager.migrate()

      executionOrder.length = 0

      const result = await manager.migrateRefresh()

      expect(result.rolledBack).toHaveLength(2)
      expect(result.ran).toHaveLength(2)
      expect(executionOrder).toEqual(['second_down', 'first_down', 'first_up', 'second_up'])
    })

    it('should reset batch numbers after refresh', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)

      // Run in two batches
      manager.registerMigrations([m1])
      await manager.migrate()

      manager.registerMigrations([m2])
      await manager.migrate()

      await manager.migrateRefresh()

      const migrations = db.all('SELECT * FROM payload_migrations')
      expect(migrations.every((m: any) => m.batch === 1)).toBe(true)
    })

    it('should handle empty migration list', async () => {
      const result = await manager.migrateRefresh()

      expect(result.rolledBack).toHaveLength(0)
      expect(result.ran).toHaveLength(0)
    })
  })

  // ==========================================================================
  // MIGRATE FRESH
  // ==========================================================================

  describe('migrateFresh', () => {
    it('should drop tables and re-run migrations', async () => {
      let dropCalled = false
      const freshManager = createMigrationManager({
        ...config,
        dropAllTables: async () => {
          dropCalled = true
        },
      })

      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      freshManager.registerMigrations([m1])
      await freshManager.migrate()

      const result = await freshManager.migrateFresh()

      expect(dropCalled).toBe(true)
      expect(result.dropped).toBe(true)
      expect(result.ran).toHaveLength(1)
    })

    it('should clear migration history before running', async () => {
      const freshManager = createMigrationManager({
        ...config,
        dropAllTables: async () => {},
      })

      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      freshManager.registerMigrations([m1])
      await freshManager.migrate()

      await freshManager.migrateFresh()

      // Should still have migration recorded (from re-run)
      const migrations = db.all('SELECT * FROM payload_migrations')
      expect(migrations).toHaveLength(1)
      expect(migrations[0].batch).toBe(1) // Reset batch number
    })

    it('should run seed function when seed option is true', async () => {
      let seedCalled = false
      const freshManager = createMigrationManager({
        ...config,
        dropAllTables: async () => {},
        seedFunction: async () => {
          seedCalled = true
        },
      })

      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      freshManager.registerMigrations([m1])

      await freshManager.migrateFresh({ seed: true })

      expect(seedCalled).toBe(true)
    })

    it('should not run seed function when seed option is false', async () => {
      let seedCalled = false
      const freshManager = createMigrationManager({
        ...config,
        dropAllTables: async () => {},
        seedFunction: async () => {
          seedCalled = true
        },
      })

      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      freshManager.registerMigrations([m1])

      await freshManager.migrateFresh({ seed: false })

      expect(seedCalled).toBe(false)
    })
  })

  // ==========================================================================
  // MIGRATE RESET
  // ==========================================================================

  describe('migrateReset', () => {
    it('should roll back all migrations', async () => {
      const m1 = createTestMigration('20260109_001_first', 1736380800000)
      const m2 = createTestMigration('20260109_002_second', 1736380800001)
      const m3 = createTestMigration('20260109_003_third', 1736380800002)

      manager.registerMigrations([m1, m2, m3])
      await manager.migrate()

      const result = await manager.migrateReset()

      expect(result.rolledBack).toHaveLength(3)
      expect(db.all('SELECT * FROM payload_migrations')).toHaveLength(0)
    })

    it('should handle migrations not in registry', async () => {
      const m1 = createTestMigration('20260109_001_test', 1736380800000)
      manager.registerMigrations([m1])
      await manager.migrate()

      // Clear migrations (simulating migration file removed)
      manager.clearMigrations()

      const result = await manager.migrateReset()

      // Should still clean up tracking record
      expect(db.all('SELECT * FROM payload_migrations')).toHaveLength(0)
    })
  })
})
