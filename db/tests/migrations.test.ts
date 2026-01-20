import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MigrationRunner,
  createMigration,
  type Migration,
  type MigrationState,
} from '../migrations'

// Mock SqlStorage interface for testing
interface MockSqlStorage {
  exec(sql: string): { results: Array<Record<string, unknown>> }
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first(): Promise<Record<string, unknown> | null>
      all(): Promise<{ results: Array<Record<string, unknown>> }>
      run(): Promise<void>
    }
  }
}

/**
 * Creates a more realistic mock SQL storage that tracks table state
 */
function createMockSqlStorage(): MockSqlStorage & {
  _appliedMigrations: Array<{ version: number; name: string; applied_at: number }>
  _tables: Map<string, boolean>
  _columns: Map<string, string[]>
  _execCalls: string[]
} {
  const state = {
    _appliedMigrations: [] as Array<{ version: number; name: string; applied_at: number }>,
    _tables: new Map<string, boolean>(),
    _columns: new Map<string, string[]>(),
    _execCalls: [] as string[],
  }

  return {
    ...state,

    exec(sql: string): { results: Array<Record<string, unknown>> } {
      state._execCalls.push(sql)

      // Track CREATE TABLE
      const createTableMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)
      if (createTableMatch) {
        createTableMatch.forEach((match) => {
          const tableName = match.replace(/CREATE TABLE IF NOT EXISTS\s+/i, '')
          state._tables.set(tableName, true)
        })
      }

      // Track ALTER TABLE ADD COLUMN
      const alterMatch = sql.match(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i)
      if (alterMatch) {
        const [, tableName, columnName] = alterMatch
        const cols = state._columns.get(tableName) || []
        cols.push(columnName)
        state._columns.set(tableName, cols)
      }

      // Track DROP TABLE
      const dropMatch = sql.match(/DROP TABLE IF EXISTS\s+(\w+)/i)
      if (dropMatch) {
        state._tables.delete(dropMatch[1])
      }

      return { results: [] }
    },

    prepare(sql: string) {
      let boundValues: unknown[] = []

      return {
        bind(...values: unknown[]) {
          boundValues = values
          return {
            async first(): Promise<Record<string, unknown> | null> {
              // Query _migrations table
              if (sql.includes('FROM _migrations')) {
                if (sql.includes('ORDER BY version DESC LIMIT 1')) {
                  // Get latest version
                  const sorted = [...state._appliedMigrations].sort(
                    (a, b) => b.version - a.version
                  )
                  return sorted[0] || null
                }
                if (sql.includes('WHERE version = ?')) {
                  const version = boundValues[0] as number
                  const found = state._appliedMigrations.find((m) => m.version === version)
                  return found || null
                }
              }
              return null
            },

            async all(): Promise<{ results: Array<Record<string, unknown>> }> {
              if (sql.includes('FROM _migrations')) {
                if (sql.includes('ORDER BY version ASC')) {
                  const sorted = [...state._appliedMigrations].sort(
                    (a, b) => a.version - b.version
                  )
                  return { results: sorted }
                }
                return { results: state._appliedMigrations }
              }
              return { results: [] }
            },

            async run(): Promise<void> {
              // INSERT into _migrations
              if (sql.includes('INSERT INTO _migrations')) {
                const [version, name, applied_at] = boundValues as [number, string, number]
                state._appliedMigrations.push({ version, name, applied_at })
              }

              // DELETE from _migrations
              if (sql.includes('DELETE FROM _migrations WHERE version = ?')) {
                const version = boundValues[0] as number
                const index = state._appliedMigrations.findIndex((m) => m.version === version)
                if (index !== -1) {
                  state._appliedMigrations.splice(index, 1)
                }
              }
            },
          }
        },
      }
    },
  }
}

describe('Migration System', () => {
  describe('createMigration', () => {
    it('should create a migration with required fields', () => {
      const migration = createMigration({
        version: 1,
        name: 'create_users_table',
        up: 'CREATE TABLE users (id TEXT PRIMARY KEY)',
      })

      expect(migration.version).toBe(1)
      expect(migration.name).toBe('create_users_table')
      expect(migration.up).toBe('CREATE TABLE users (id TEXT PRIMARY KEY)')
      expect(migration.down).toBeUndefined()
    })

    it('should create a migration with optional down SQL', () => {
      const migration = createMigration({
        version: 1,
        name: 'create_users_table',
        up: 'CREATE TABLE users (id TEXT PRIMARY KEY)',
        down: 'DROP TABLE IF EXISTS users',
      })

      expect(migration.down).toBe('DROP TABLE IF EXISTS users')
    })
  })

  describe('MigrationRunner', () => {
    let sql: ReturnType<typeof createMockSqlStorage>
    let runner: MigrationRunner

    beforeEach(() => {
      sql = createMockSqlStorage()
      runner = new MigrationRunner(sql as any)
    })

    describe('initialization', () => {
      it('should create _migrations table on first run', async () => {
        await runner.initialize()

        expect(sql._tables.has('_migrations')).toBe(true)
      })

      it('should be idempotent (safe to call multiple times)', async () => {
        await runner.initialize()
        await runner.initialize()
        await runner.initialize()

        // Should not throw
        expect(sql._tables.has('_migrations')).toBe(true)
      })
    })

    describe('running migrations in order', () => {
      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS users',
        }),
        createMigration({
          version: 2,
          name: 'create_posts',
          up: 'CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, user_id TEXT)',
          down: 'DROP TABLE IF EXISTS posts',
        }),
        createMigration({
          version: 3,
          name: 'add_email_to_users',
          up: 'ALTER TABLE users ADD COLUMN email TEXT',
          down: 'ALTER TABLE users DROP COLUMN email',
        }),
      ]

      it('should run migrations in version order', async () => {
        await runner.initialize()
        const result = await runner.runMigrations(migrations)

        expect(result.applied).toBe(3)
        expect(result.errors).toHaveLength(0)

        // Verify order by checking exec calls (skip _migrations table creation)
        const execCalls = sql._execCalls.filter(
          (c) =>
            (c.includes('CREATE TABLE') || c.includes('ALTER TABLE')) &&
            !c.includes('_migrations')
        )
        expect(execCalls[0]).toContain('users')
        expect(execCalls[1]).toContain('posts')
        expect(execCalls[2]).toContain('email')
      })

      it('should run migrations even when provided out of order', async () => {
        await runner.initialize()
        const outOfOrder = [migrations[2], migrations[0], migrations[1]]
        const result = await runner.runMigrations(outOfOrder)

        expect(result.applied).toBe(3)

        // Should still run in version order
        const appliedVersions = sql._appliedMigrations.map((m) => m.version)
        expect(appliedVersions).toEqual([1, 2, 3])
      })
    })

    describe('skipping already-applied migrations', () => {
      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)',
        }),
        createMigration({
          version: 2,
          name: 'create_posts',
          up: 'CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY)',
        }),
      ]

      it('should skip migrations that have already been applied', async () => {
        await runner.initialize()

        // Run first time
        await runner.runMigrations(migrations)
        const initialExecCount = sql._execCalls.length

        // Run second time
        const result = await runner.runMigrations(migrations)

        expect(result.applied).toBe(0)
        expect(result.skipped).toBe(2)
        // No new exec calls for the migrations themselves
        expect(sql._execCalls.length).toBe(initialExecCount)
      })

      it('should only run new migrations when some are already applied', async () => {
        await runner.initialize()

        // Apply first migration
        await runner.runMigrations([migrations[0]])
        expect(sql._appliedMigrations).toHaveLength(1)

        // Now run both - should only apply the second
        const result = await runner.runMigrations(migrations)

        expect(result.applied).toBe(1)
        expect(result.skipped).toBe(1)
        expect(sql._appliedMigrations).toHaveLength(2)
      })

      it('should track applied migrations in _migrations table', async () => {
        await runner.initialize()
        await runner.runMigrations(migrations)

        const applied = await runner.getAppliedMigrations()

        expect(applied).toHaveLength(2)
        expect(applied[0].version).toBe(1)
        expect(applied[0].name).toBe('create_users')
        expect(applied[1].version).toBe(2)
        expect(applied[1].name).toBe('create_posts')
      })
    })

    describe('rollback support', () => {
      const migrations: Migration[] = [
        createMigration({
          version: 1,
          name: 'create_users',
          up: 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS users',
        }),
        createMigration({
          version: 2,
          name: 'create_posts',
          up: 'CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS posts',
        }),
        createMigration({
          version: 3,
          name: 'create_comments',
          up: 'CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY)',
          down: 'DROP TABLE IF EXISTS comments',
        }),
      ]

      it('should rollback the most recent migration', async () => {
        await runner.initialize()
        await runner.runMigrations(migrations)

        const result = await runner.rollback(migrations)

        expect(result.rolledBack).toBe(1)
        expect(result.version).toBe(3)
        expect(sql._appliedMigrations).toHaveLength(2)
      })

      it('should rollback to a specific version', async () => {
        await runner.initialize()
        await runner.runMigrations(migrations)

        const result = await runner.rollbackTo(1, migrations)

        expect(result.rolledBack).toBe(2)
        expect(sql._appliedMigrations).toHaveLength(1)
        expect(sql._appliedMigrations[0].version).toBe(1)
      })

      it('should rollback all migrations when rolling back to version 0', async () => {
        await runner.initialize()
        await runner.runMigrations(migrations)

        const result = await runner.rollbackTo(0, migrations)

        expect(result.rolledBack).toBe(3)
        expect(sql._appliedMigrations).toHaveLength(0)
      })

      it('should throw error when migration has no down SQL', async () => {
        const noDownMigration = createMigration({
          version: 1,
          name: 'no_rollback',
          up: 'CREATE TABLE test (id TEXT)',
        })

        await runner.initialize()
        await runner.runMigrations([noDownMigration])

        await expect(runner.rollback([noDownMigration])).rejects.toThrow(
          'Migration no_rollback (version 1) does not support rollback'
        )
      })

      it('should do nothing when no migrations to rollback', async () => {
        await runner.initialize()

        const result = await runner.rollback(migrations)

        expect(result.rolledBack).toBe(0)
      })
    })

    describe('migration state tracking', () => {
      it('should return current schema version', async () => {
        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'v1', up: 'SELECT 1' }),
          createMigration({ version: 2, name: 'v2', up: 'SELECT 1' }),
          createMigration({ version: 3, name: 'v3', up: 'SELECT 1' }),
        ]

        await runner.initialize()
        await runner.runMigrations(migrations)

        const version = await runner.getCurrentVersion()
        expect(version).toBe(3)
      })

      it('should return 0 when no migrations applied', async () => {
        await runner.initialize()

        const version = await runner.getCurrentVersion()
        expect(version).toBe(0)
      })

      it('should detect pending migrations', async () => {
        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'v1', up: 'SELECT 1' }),
          createMigration({ version: 2, name: 'v2', up: 'SELECT 1' }),
          createMigration({ version: 3, name: 'v3', up: 'SELECT 1' }),
        ]

        await runner.initialize()
        await runner.runMigrations([migrations[0]])

        const pending = await runner.getPendingMigrations(migrations)
        expect(pending).toHaveLength(2)
        expect(pending[0].version).toBe(2)
        expect(pending[1].version).toBe(3)
      })
    })

    describe('error handling', () => {
      it('should stop on migration error and report which failed', async () => {
        // Create a mock that throws on specific SQL
        const errorSql = createMockSqlStorage()
        const originalExec = errorSql.exec.bind(errorSql)
        errorSql.exec = (sql: string) => {
          if (sql.includes('INVALID_SQL')) {
            throw new Error('near "INVALID_SQL": syntax error')
          }
          return originalExec(sql)
        }

        const errorRunner = new MigrationRunner(errorSql as any)
        await errorRunner.initialize()

        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'good', up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)' }),
          createMigration({ version: 2, name: 'bad', up: 'INVALID_SQL' }),
          createMigration({ version: 3, name: 'never_runs', up: 'SELECT 1' }),
        ]

        const result = await errorRunner.runMigrations(migrations)

        expect(result.applied).toBe(1)
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0].version).toBe(2)
        expect(result.errors[0].name).toBe('bad')
        expect(result.errors[0].error).toContain('syntax error')
      })

      it('should not mark failed migration as applied', async () => {
        const errorSql = createMockSqlStorage()
        const originalExec = errorSql.exec.bind(errorSql)
        errorSql.exec = (sql: string) => {
          if (sql.includes('FAIL_ME')) {
            throw new Error('Migration failed')
          }
          return originalExec(sql)
        }

        const errorRunner = new MigrationRunner(errorSql as any)
        await errorRunner.initialize()

        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'will_fail', up: 'FAIL_ME' }),
        ]

        await errorRunner.runMigrations(migrations)

        const applied = await errorRunner.getAppliedMigrations()
        expect(applied).toHaveLength(0)
      })
    })

    describe('idempotency', () => {
      it('should be safe to run migration set multiple times', async () => {
        const migrations: Migration[] = [
          createMigration({
            version: 1,
            name: 'create_users',
            up: 'CREATE TABLE IF NOT EXISTS users (id TEXT)',
          }),
        ]

        await runner.initialize()

        // Run 3 times
        await runner.runMigrations(migrations)
        await runner.runMigrations(migrations)
        await runner.runMigrations(migrations)

        // Should still only have 1 migration record
        const applied = await runner.getAppliedMigrations()
        expect(applied).toHaveLength(1)
      })

      it('should handle concurrent migration attempts gracefully', async () => {
        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'v1', up: 'SELECT 1' }),
        ]

        await runner.initialize()

        // Simulate sequential calls (concurrent calls in real implementation
        // would be handled by SQLite's transaction isolation, but our mock
        // doesn't simulate that - testing the idempotent behavior instead)
        const result1 = await runner.runMigrations(migrations)
        const result2 = await runner.runMigrations(migrations)
        const result3 = await runner.runMigrations(migrations)

        // First should apply, others should skip
        expect(result1.applied).toBe(1)
        expect(result2.skipped).toBe(1)
        expect(result3.skipped).toBe(1)
        expect(sql._appliedMigrations).toHaveLength(1)
      })
    })
  })
})
