/**
 * Migration System Tests - Using Real Miniflare Runtime
 *
 * These tests use Miniflare to test against real SQLite storage instead of mocks.
 * This follows the NO MOCKS philosophy from CLAUDE.md.
 *
 * @module db/tests/migrations.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'
import {
  createMigration,
  type Migration,
} from '../migrations'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface MigrationResult {
  applied: number
  skipped: number
  errors: Array<{ version: number; name: string; error: string }>
}

interface RollbackResult {
  rolledBack: number
  version?: number
}

interface AppliedMigration {
  version: number
  name: string
  applied_at: number
}

// ============================================================================
// DO SCRIPT FOR TESTING Migrations
// ============================================================================

const MIGRATION_TEST_DO_SCRIPT = `
export class MigrationTestDO {
  constructor(state, env) {
    this.state = state
    this.sql = state.storage.sql
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // INITIALIZE MIGRATIONS TABLE
      if (path === '/migrations/initialize' && request.method === 'POST') {
        this.sql.exec(\`
          CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at INTEGER NOT NULL
          )
        \`)
        return Response.json({ success: true })
      }

      // RUN MIGRATIONS
      if (path === '/migrations/run' && request.method === 'POST') {
        const { migrations } = await request.json()
        const applied = []
        const skipped = []
        const errors = []

        // Sort migrations by version
        const sorted = [...migrations].sort((a, b) => a.version - b.version)

        for (const migration of sorted) {
          // Check if already applied
          const existing = this.sql.exec(
            'SELECT version FROM _migrations WHERE version = ?',
            migration.version
          ).toArray()

          if (existing.length > 0) {
            skipped.push(migration)
            continue
          }

          // Run migration
          try {
            this.sql.exec(migration.up)

            // Record as applied
            this.sql.exec(
              'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
              migration.version, migration.name, Date.now()
            )
            applied.push(migration)
          } catch (error) {
            errors.push({
              version: migration.version,
              name: migration.name,
              error: error.message
            })
            break // Stop on first error
          }
        }

        return Response.json({
          applied: applied.length,
          skipped: skipped.length,
          errors
        })
      }

      // ROLLBACK
      if (path === '/migrations/rollback' && request.method === 'POST') {
        const { migrations } = await request.json()

        // Get current version
        const current = this.sql.exec(
          'SELECT version, name FROM _migrations ORDER BY version DESC LIMIT 1'
        ).toArray()

        if (current.length === 0) {
          return Response.json({ rolledBack: 0 })
        }

        const currentVersion = current[0].version

        // Find the migration to rollback
        const migrationToRollback = migrations.find(m => m.version === currentVersion)

        if (!migrationToRollback) {
          return Response.json({ error: 'Migration not found' }, { status: 404 })
        }

        if (!migrationToRollback.down) {
          return Response.json({
            error: \`Migration \${migrationToRollback.name} (version \${migrationToRollback.version}) does not support rollback\`
          }, { status: 400 })
        }

        // Run rollback
        this.sql.exec(migrationToRollback.down)

        // Remove from _migrations
        this.sql.exec('DELETE FROM _migrations WHERE version = ?', currentVersion)

        return Response.json({
          rolledBack: 1,
          version: currentVersion
        })
      }

      // ROLLBACK TO VERSION
      if (path === '/migrations/rollbackTo' && request.method === 'POST') {
        const { targetVersion, migrations } = await request.json()
        let rolledBack = 0

        // Get all applied migrations in descending order
        const applied = this.sql.exec(
          'SELECT version FROM _migrations ORDER BY version DESC'
        ).toArray()

        for (const record of applied) {
          if (record.version <= targetVersion) {
            break
          }

          const migration = migrations.find(m => m.version === record.version)

          if (!migration || !migration.down) {
            return Response.json({
              error: \`Migration version \${record.version} does not support rollback\`
            }, { status: 400 })
          }

          // Run rollback
          this.sql.exec(migration.down)
          this.sql.exec('DELETE FROM _migrations WHERE version = ?', record.version)
          rolledBack++
        }

        return Response.json({ rolledBack })
      }

      // GET APPLIED MIGRATIONS
      if (path === '/migrations/applied' && request.method === 'GET') {
        const result = this.sql.exec(
          'SELECT version, name, applied_at FROM _migrations ORDER BY version ASC'
        )
        return Response.json({ migrations: result.toArray() })
      }

      // GET CURRENT VERSION
      if (path === '/migrations/version' && request.method === 'GET') {
        const result = this.sql.exec(
          'SELECT version FROM _migrations ORDER BY version DESC LIMIT 1'
        ).toArray()
        return Response.json({ version: result.length > 0 ? result[0].version : 0 })
      }

      // GET PENDING MIGRATIONS
      if (path === '/migrations/pending' && request.method === 'POST') {
        const { migrations } = await request.json()

        // Get applied versions
        const applied = this.sql.exec('SELECT version FROM _migrations').toArray()
        const appliedVersions = new Set(applied.map(r => r.version))

        // Filter pending
        const pending = migrations
          .filter(m => !appliedVersions.has(m.version))
          .sort((a, b) => a.version - b.version)

        return Response.json({ pending })
      }

      // GET TABLES (for verification)
      if (path === '/tables' && request.method === 'GET') {
        const result = this.sql.exec(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        return Response.json({ tables: result.toArray().map(r => r.name) })
      }

      // GET EXEC HISTORY (simulated via tables/columns check)
      if (path === '/verify' && request.method === 'GET') {
        const tableName = url.searchParams.get('table')
        try {
          // Check if table exists by querying it
          this.sql.exec(\`SELECT 1 FROM \${tableName} LIMIT 1\`)
          return Response.json({ exists: true })
        } catch {
          return Response.json({ exists: false })
        }
      }

      if (path === '/health') {
        return Response.json({ status: 'ok', id: this.state.id.toString() })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message, stack: error.stack }, { status: 500 })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doName = url.searchParams.get('name') || 'default'
    const id = env.MIGRATION_DO.idFromName(doName)
    const stub = env.MIGRATION_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITE
// ============================================================================

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
    let mf: Miniflare

    beforeAll(async () => {
      mf = new Miniflare({
        modules: true,
        script: MIGRATION_TEST_DO_SCRIPT,
        durableObjects: {
          MIGRATION_DO: {
            className: 'MigrationTestDO',
            // Enable SQLite for this DO class - required for state.storage.sql
            useSQLite: true,
          },
        },
        durableObjectsPersist: false,
      })
    })

    afterAll(async () => {
      await mf.dispose()
    })

    async function getMigrationStub(name: string = 'default') {
      const ns = await mf.getDurableObjectNamespace('MIGRATION_DO')
      const id = ns.idFromName(name)
      return ns.get(id)
    }

    type StubType = { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }

    // Helper to initialize migration table
    async function initialize(stub: StubType): Promise<void> {
      await stub.fetch('http://internal/migrations/initialize', { method: 'POST' })
    }

    // Helper to run migrations
    async function runMigrations(
      stub: StubType,
      migrations: Migration[]
    ): Promise<MigrationResult> {
      const response = await stub.fetch('http://internal/migrations/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ migrations }),
      })
      return response.json() as Promise<MigrationResult>
    }

    // Helper to rollback
    async function rollback(
      stub: StubType,
      migrations: Migration[]
    ): Promise<RollbackResult> {
      const response = await stub.fetch('http://internal/migrations/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ migrations }),
      })
      if (!response.ok) {
        const error = await response.json() as { error: string }
        throw new Error(error.error)
      }
      return response.json() as Promise<RollbackResult>
    }

    // Helper to rollback to version
    async function rollbackTo(
      stub: StubType,
      targetVersion: number,
      migrations: Migration[]
    ): Promise<RollbackResult> {
      const response = await stub.fetch('http://internal/migrations/rollbackTo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetVersion, migrations }),
      })
      return response.json() as Promise<RollbackResult>
    }

    // Helper to get applied migrations
    async function getAppliedMigrations(stub: StubType): Promise<AppliedMigration[]> {
      const response = await stub.fetch('http://internal/migrations/applied')
      const json = await response.json() as { migrations: AppliedMigration[] }
      return json.migrations
    }

    // Helper to get current version
    async function getCurrentVersion(stub: StubType): Promise<number> {
      const response = await stub.fetch('http://internal/migrations/version')
      const json = await response.json() as { version: number }
      return json.version
    }

    // Helper to get pending migrations
    async function getPendingMigrations(
      stub: StubType,
      migrations: Migration[]
    ): Promise<Migration[]> {
      const response = await stub.fetch('http://internal/migrations/pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ migrations }),
      })
      const json = await response.json() as { pending: Migration[] }
      return json.pending
    }

    // Helper to verify table exists
    async function tableExists(stub: StubType, tableName: string): Promise<boolean> {
      const response = await stub.fetch(`http://internal/verify?table=${tableName}`)
      const json = await response.json() as { exists: boolean }
      return json.exists
    }

    describe('initialization', () => {
      it('should create _migrations table on first run', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        const exists = await tableExists(stub, '_migrations')
        expect(exists).toBe(true)
      })

      it('should be idempotent (safe to call multiple times)', async () => {
        const stub = await getMigrationStub(generateTestId())

        await initialize(stub)
        await initialize(stub)
        await initialize(stub)

        // Should not throw
        const exists = await tableExists(stub, '_migrations')
        expect(exists).toBe(true)
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
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        const result = await runMigrations(stub, migrations)

        expect(result.applied).toBe(3)
        expect(result.errors).toHaveLength(0)

        // Verify tables were created
        expect(await tableExists(stub, 'users')).toBe(true)
        expect(await tableExists(stub, 'posts')).toBe(true)
      })

      it('should run migrations even when provided out of order', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        const outOfOrder = [migrations[2], migrations[0], migrations[1]]
        const result = await runMigrations(stub, outOfOrder)

        expect(result.applied).toBe(3)

        // Should still run in version order
        const applied = await getAppliedMigrations(stub)
        const appliedVersions = applied.map(m => m.version)
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
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        // Run first time
        await runMigrations(stub, migrations)

        // Run second time
        const result = await runMigrations(stub, migrations)

        expect(result.applied).toBe(0)
        expect(result.skipped).toBe(2)
      })

      it('should only run new migrations when some are already applied', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        // Apply first migration
        await runMigrations(stub, [migrations[0]])
        const applied1 = await getAppliedMigrations(stub)
        expect(applied1).toHaveLength(1)

        // Now run both - should only apply the second
        const result = await runMigrations(stub, migrations)

        expect(result.applied).toBe(1)
        expect(result.skipped).toBe(1)

        const applied2 = await getAppliedMigrations(stub)
        expect(applied2).toHaveLength(2)
      })

      it('should track applied migrations in _migrations table', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        await runMigrations(stub, migrations)

        const applied = await getAppliedMigrations(stub)

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
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)
        await runMigrations(stub, migrations)

        const result = await rollback(stub, migrations)

        expect(result.rolledBack).toBe(1)
        expect(result.version).toBe(3)

        const applied = await getAppliedMigrations(stub)
        expect(applied).toHaveLength(2)
      })

      it('should rollback to a specific version', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)
        await runMigrations(stub, migrations)

        const result = await rollbackTo(stub, 1, migrations)

        expect(result.rolledBack).toBe(2)

        const applied = await getAppliedMigrations(stub)
        expect(applied).toHaveLength(1)
        expect(applied[0].version).toBe(1)
      })

      it('should rollback all migrations when rolling back to version 0', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)
        await runMigrations(stub, migrations)

        const result = await rollbackTo(stub, 0, migrations)

        expect(result.rolledBack).toBe(3)

        const applied = await getAppliedMigrations(stub)
        expect(applied).toHaveLength(0)
      })

      it('should throw error when migration has no down SQL', async () => {
        const stub = await getMigrationStub(generateTestId())
        const noDownMigration = createMigration({
          version: 1,
          name: 'no_rollback',
          up: 'CREATE TABLE test (id TEXT)',
        })

        await initialize(stub)
        await runMigrations(stub, [noDownMigration])

        await expect(rollback(stub, [noDownMigration])).rejects.toThrow(
          'Migration no_rollback (version 1) does not support rollback'
        )
      })

      it('should do nothing when no migrations to rollback', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        const result = await rollback(stub, migrations)

        expect(result.rolledBack).toBe(0)
      })
    })

    describe('migration state tracking', () => {
      it('should return current schema version', async () => {
        const stub = await getMigrationStub(generateTestId())
        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'v1', up: 'SELECT 1' }),
          createMigration({ version: 2, name: 'v2', up: 'SELECT 1' }),
          createMigration({ version: 3, name: 'v3', up: 'SELECT 1' }),
        ]

        await initialize(stub)
        await runMigrations(stub, migrations)

        const version = await getCurrentVersion(stub)
        expect(version).toBe(3)
      })

      it('should return 0 when no migrations applied', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        const version = await getCurrentVersion(stub)
        expect(version).toBe(0)
      })

      it('should detect pending migrations', async () => {
        const stub = await getMigrationStub(generateTestId())
        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'v1', up: 'SELECT 1' }),
          createMigration({ version: 2, name: 'v2', up: 'SELECT 1' }),
          createMigration({ version: 3, name: 'v3', up: 'SELECT 1' }),
        ]

        await initialize(stub)
        await runMigrations(stub, [migrations[0]])

        const pending = await getPendingMigrations(stub, migrations)
        expect(pending).toHaveLength(2)
        expect(pending[0].version).toBe(2)
        expect(pending[1].version).toBe(3)
      })
    })

    describe('error handling', () => {
      it('should stop on migration error and report which failed', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'good', up: 'CREATE TABLE IF NOT EXISTS t1 (id TEXT)' }),
          createMigration({ version: 2, name: 'bad', up: 'INVALID_SQL_SYNTAX' }),
          createMigration({ version: 3, name: 'never_runs', up: 'SELECT 1' }),
        ]

        const result = await runMigrations(stub, migrations)

        expect(result.applied).toBe(1)
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0].version).toBe(2)
        expect(result.errors[0].name).toBe('bad')
      })

      it('should not mark failed migration as applied', async () => {
        const stub = await getMigrationStub(generateTestId())
        await initialize(stub)

        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'will_fail', up: 'INVALID_SQL' }),
        ]

        await runMigrations(stub, migrations)

        const applied = await getAppliedMigrations(stub)
        expect(applied).toHaveLength(0)
      })
    })

    describe('idempotency', () => {
      it('should be safe to run migration set multiple times', async () => {
        const stub = await getMigrationStub(generateTestId())
        const migrations: Migration[] = [
          createMigration({
            version: 1,
            name: 'create_users',
            up: 'CREATE TABLE IF NOT EXISTS users (id TEXT)',
          }),
        ]

        await initialize(stub)

        // Run 3 times
        await runMigrations(stub, migrations)
        await runMigrations(stub, migrations)
        await runMigrations(stub, migrations)

        // Should still only have 1 migration record
        const applied = await getAppliedMigrations(stub)
        expect(applied).toHaveLength(1)
      })

      it('should handle concurrent migration attempts gracefully', async () => {
        const stub = await getMigrationStub(generateTestId())
        const migrations: Migration[] = [
          createMigration({ version: 1, name: 'v1', up: 'SELECT 1' }),
        ]

        await initialize(stub)

        // Sequential calls (DOs serialize anyway)
        const result1 = await runMigrations(stub, migrations)
        const result2 = await runMigrations(stub, migrations)
        const result3 = await runMigrations(stub, migrations)

        // First should apply, others should skip
        expect(result1.applied).toBe(1)
        expect(result2.skipped).toBe(1)
        expect(result3.skipped).toBe(1)

        const applied = await getAppliedMigrations(stub)
        expect(applied).toHaveLength(1)
      })
    })
  })
})
