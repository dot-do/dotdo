/**
 * Tests for the schema migration system
 *
 * Note: DOCore constructor automatically runs migrations, so many tests
 * verify behavior with already-migrated DOs.
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

describe('MigrationRunner', () => {
  describe('version tracking', () => {
    it('should have migrations applied automatically by DOCore constructor', async () => {
      // DOCore runs migrations in constructor, so fresh DO is already migrated
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-fresh'))
      const version = await stub.getMigrationVersion()
      // All 8 migrations should be applied automatically
      expect(version).toBe(8)
    })

    it('should track migration version correctly', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-track'))
      const version = await stub.getMigrationVersion()
      expect(version).toBeGreaterThan(0)
    })

    it('should return empty pending list when all migrations applied', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-pending'))
      const pending = await stub.getPendingMigrations()
      expect(Array.isArray(pending)).toBe(true)
      // All migrations already applied in constructor
      expect(pending.length).toBe(0)
    })
  })

  describe('migration execution', () => {
    it('should create schema_migrations table automatically', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-schema'))

      // Query to verify the table exists (created by constructor)
      const result = await stub.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      )
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('schema_migrations')
    })

    it('should have migrations applied in order', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-order'))

      // Check migration history is in order
      const history = await stub.query('SELECT version FROM schema_migrations ORDER BY version')
      const versions = history.map((row) => row.version as number)

      expect(versions.length).toBeGreaterThan(0)
      // Verify they are in sequential order
      expect(versions).toEqual([...versions].sort((a, b) => a - b))
    })

    it('should be idempotent - running again applies no new migrations', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-idempotent'))

      // Migrations already ran in constructor
      const versionBefore = await stub.getMigrationVersion()

      // Run migrations again explicitly
      const result = await stub.runMigrations()
      expect(result.success).toBe(true)
      expect(result.migrationsRun).toBe(0)

      // Version should be unchanged
      const versionAfter = await stub.getMigrationVersion()
      expect(versionAfter).toBe(versionBefore)
    })

    it('should skip already-applied migrations', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-skip'))

      const version1 = await stub.getMigrationVersion()

      // Run again
      const result = await stub.runMigrations()
      const version2 = await stub.getMigrationVersion()

      expect(result.migrationsRun).toBe(0)
      expect(version2).toBe(version1)
    })
  })

  describe('core tables migration', () => {
    it('should create state table', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-state'))

      const result = await stub.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='state'"
      )
      expect(result.length).toBe(1)
    })

    it('should create things table with all columns', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-things'))

      // Verify the table exists
      const result = await stub.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='things'"
      )
      expect(result.length).toBe(1)

      // Verify we can use the table (columns exist if INSERT/SELECT work)
      const thing = await stub.create('TestType', { name: 'test' })
      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('TestType')
      expect(thing.$version).toBe(1)
      expect(thing.$createdAt).toBeDefined()
      expect(thing.$updatedAt).toBeDefined()
    })

    it('should create schedules table', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-schedules'))

      const result = await stub.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schedules'"
      )
      expect(result.length).toBe(1)
    })

    it('should create action_log table', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-action-log'))

      const result = await stub.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='action_log'"
      )
      expect(result.length).toBe(1)
    })

    it('should create semantic tables (nouns, verbs, edges)', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-semantic'))

      const nouns = await stub.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='nouns'"
      )
      expect(nouns.length).toBe(1)

      const verbs = await stub.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='verbs'"
      )
      expect(verbs.length).toBe(1)

      const edges = await stub.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='edges'"
      )
      expect(edges.length).toBe(1)
    })

    it('should create l2_things table for storage layer', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-l2'))

      const result = await stub.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='l2_things'"
      )
      expect(result.length).toBe(1)
    })
  })

  describe('error handling', () => {
    it('should handle re-running migrations gracefully', async () => {
      const stub = env.DOCore.get(env.DOCore.idFromName('migration-test-error'))

      // This should not throw even when run multiple times
      const result = await stub.runMigrations()
      expect(result).toBeDefined()
      expect(result.success).toBe(true)
    })
  })
})

describe('Migration history', () => {
  it('should record migration history with timestamps', async () => {
    const stub = env.DOCore.get(env.DOCore.idFromName('migration-history-test'))

    const history = await stub.query('SELECT * FROM schema_migrations ORDER BY version')
    expect(history.length).toBeGreaterThan(0)

    for (const entry of history) {
      expect(entry.version).toBeDefined()
      expect(entry.name).toBeDefined()
      expect(entry.applied_at).toBeDefined()
    }
  })

  it('should track all 8 migrations', async () => {
    const stub = env.DOCore.get(env.DOCore.idFromName('migration-history-count'))

    const history = await stub.query('SELECT COUNT(*) as count FROM schema_migrations')
    expect(history[0].count).toBe(8)
  })
})
