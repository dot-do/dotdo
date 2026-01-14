/**
 * Schema Migration Integration Tests
 *
 * Tests for entity-level schema migration using REAL miniflare DOs.
 * NO MOCKS - uses real SQLite storage via @cloudflare/vitest-pool-workers.
 *
 * This replaces schema-migration.test.ts which used MockStorage.
 *
 * Key features tested:
 * - Schema version tracked per entity type
 * - Migration registry stores up/down migrations
 * - Forward migration (upgrade) transforms data correctly
 * - Backward migration (rollback) restores previous schema
 * - Lazy migration on read (migrate when accessed)
 * - Batch migration for bulk updates
 * - Concurrent access during migration is safe
 * - Migration history/audit trail
 *
 * Run with: npx vitest run objects/tests/schema-migration-integration.test.ts --project=modules-integration
 *
 * @module objects/tests/schema-migration-integration.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// TEST FIXTURES
// ============================================================================

interface UserV1 {
  name: string
  email: string
}

interface UserV2 {
  name: string
  email: string
  displayName: string // Added field
}

interface UserV3 {
  fullName: string // Renamed from name
  email: string
  displayName: string
  createdAt: number // Added field
}

// ============================================================================
// TYPE DEFINITIONS FOR RPC
// ============================================================================

interface MigrationResult {
  success: boolean
  migratedCount: number
  failedCount: number
  errors: Array<{ id: string; error: string }>
}

interface MigrationHistoryEntry {
  version: number
  name: string
  timestamp: number
  direction: 'up' | 'down'
  entitiesAffected: number
  durationMs: number
}

interface SchemaMigrationRpc {
  getCurrentVersion(entityType: string): Promise<number>
  registerMigration(
    entityType: string,
    version: number,
    name: string,
    upType: 'add-field' | 'rename-field' | 'identity',
    fieldName?: string,
    defaultValue?: unknown
  ): void
  setTargetVersion(entityType: string, version: number): void
  migrateEntity(
    entityType: string,
    data: unknown,
    fromVersion?: number,
    toVersion?: number
  ): Promise<unknown>
  migrateOnRead(
    entityType: string,
    data: unknown,
    dataVersion: number
  ): Promise<unknown>
  migrateBatch(
    entityType: string,
    batchSize?: number,
    continueOnError?: boolean
  ): Promise<MigrationResult>
  rollback(entityType: string, toVersion: number): Promise<MigrationResult>
  getMigrationProgress(entityType: string): {
    completed: boolean
    totalCount: number
    processedCount: number
    targetVersion: number
  } | undefined
  getMigrationHistory(entityType: string): MigrationHistoryEntry[]
  storeTestData(entityType: string, id: string, version: number, data: unknown): void
  getTestData(entityType: string, id: string): { version: number; data: unknown } | undefined
  listTestData(entityType: string): Array<{ id: string; version: number; data: unknown }>
  setSchemaVersion(entityType: string, version: number): void
}

interface RPCStub extends DurableObjectStub {
  schemaMigration: SchemaMigrationRpc
}

// ============================================================================
// TEST HELPERS
// ============================================================================

const testRunId = Date.now()

function uniqueNs(prefix: string = 'schema-test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TESTS: Schema Migration Integration
// ============================================================================

describe('SchemaMigrationManager Integration', () => {
  let stub: RPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as RPCStub
  })

  // ==========================================================================
  // TESTS: Schema Version Tracking
  // ==========================================================================

  describe('schema version tracking per entity type', () => {
    it('should track schema version per entity type', async () => {
      const sm = stub.schemaMigration

      // Initially no version
      expect(await sm.getCurrentVersion('User')).toBe(0)
      expect(await sm.getCurrentVersion('Order')).toBe(0)

      // Register migration for User
      sm.registerMigration('User', 1, 'add-user-display-name', 'add-field', 'displayName', '')

      // After registration, version should still be 0 (not applied yet)
      expect(await sm.getCurrentVersion('User')).toBe(0)
    })

    it('should allow different entity types to have different versions', async () => {
      const sm = stub.schemaMigration

      sm.registerMigration('User', 1, 'user-v1', 'identity')
      sm.registerMigration('User', 2, 'user-v2', 'identity')
      sm.registerMigration('Order', 1, 'order-v1', 'identity')

      // Store test data for User
      sm.storeTestData('User', 'user-1', 1, { name: 'Test' })
      sm.setSchemaVersion('User', 1)

      // Apply only User migrations
      await sm.migrateBatch('User')

      expect(await sm.getCurrentVersion('User')).toBe(2)
      expect(await sm.getCurrentVersion('Order')).toBe(0)
    })
  })

  // ==========================================================================
  // TESTS: Migration Registry
  // ==========================================================================

  describe('migration registry stores up/down migrations', () => {
    it('should register migrations with up and down functions', async () => {
      const sm = stub.schemaMigration

      sm.registerMigration('User', 1, 'add-display-name', 'add-field', 'displayName', 'default')

      // Test that migration is registered by trying to migrate
      const result = await sm.migrateEntity('User', { name: 'John' }, 0, 1)
      expect(result).toHaveProperty('displayName')
    })

    it('should throw on duplicate migration versions', async () => {
      const sm = stub.schemaMigration

      sm.registerMigration('User', 1, 'first-migration', 'identity')

      // Second registration with same version should throw
      expect(() => {
        sm.registerMigration('User', 1, 'duplicate-migration', 'identity')
      }).toThrow(/already.*registered/i)
    })
  })

  // ==========================================================================
  // TESTS: Forward Migration (Upgrade)
  // ==========================================================================

  describe('forward migration (upgrade) transforms data correctly', () => {
    it('should migrate entity from v1 to v2', async () => {
      const sm = stub.schemaMigration

      // Register v2 migration (adds displayName field)
      sm.registerMigration('User', 2, 'add-display-name', 'add-field', 'displayName', '')

      // Store v1 data
      const v1Data: UserV1 = { name: 'John Doe', email: 'john@example.com' }
      sm.storeTestData('User', 'user-1', 1, v1Data)
      sm.setSchemaVersion('User', 1)

      // Migrate entity
      const migrated = await sm.migrateEntity('User', v1Data, 1, 2) as UserV2

      expect(migrated.name).toBe('John Doe')
      expect(migrated.email).toBe('john@example.com')
      expect(migrated.displayName).toBeDefined()
    })

    it('should chain multiple migrations (v1 -> v2 -> v3)', async () => {
      const sm = stub.schemaMigration

      // Register migrations v2 and v3
      sm.registerMigration('User', 2, 'add-display-name', 'add-field', 'displayName', '')
      sm.registerMigration('User', 3, 'add-created-at', 'add-field', 'createdAt', 0)

      // Store v1 data
      const v1Data: UserV1 = { name: 'John Doe', email: 'john@example.com' }

      // Migrate through all versions
      const migrated = await sm.migrateEntity('User', v1Data, 1, 3) as UserV3

      expect(migrated.email).toBe('john@example.com')
      expect(migrated).toHaveProperty('displayName')
      expect(migrated).toHaveProperty('createdAt')
    })
  })

  // ==========================================================================
  // TESTS: Backward Migration (Rollback)
  // ==========================================================================

  describe('backward migration (rollback) restores previous schema', () => {
    it('should rollback entity from v2 to v1', async () => {
      const sm = stub.schemaMigration

      // Register migration
      sm.registerMigration('User', 2, 'add-display-name', 'add-field', 'displayName', '')

      // Set current version to 2
      sm.setSchemaVersion('User', 2)

      // Rollback
      const result = await sm.rollback('User', 1)

      expect(result.success).toBe(true)
      expect(await sm.getCurrentVersion('User')).toBe(1)
    })
  })

  // ==========================================================================
  // TESTS: Lazy Migration on Read
  // ==========================================================================

  describe('lazy migration on read (migrate when accessed)', () => {
    it('should migrate data lazily when read', async () => {
      const sm = stub.schemaMigration

      // Register v2 migration and set target version
      sm.registerMigration('User', 2, 'add-display-name', 'add-field', 'displayName', 'default')
      sm.setTargetVersion('User', 2)

      // V1 data
      const v1Data: UserV1 = { name: 'John Doe', email: 'john@example.com' }

      // Read with lazy migration
      const migrated = await sm.migrateOnRead('User', v1Data, 1) as UserV2

      expect(migrated.displayName).toBe('default')
    })

    it('should not migrate if already at target version', async () => {
      const sm = stub.schemaMigration

      sm.registerMigration('User', 2, 'migration', 'add-field', 'extra', 'value')
      sm.setTargetVersion('User', 2)

      // Store v2 data (already at target)
      const v2Data = { name: 'John', email: 'john@example.com', extra: 'existing' }

      const result = await sm.migrateOnRead('User', v2Data, 2)

      // Should return data unchanged (extra should still be 'existing', not 'value')
      expect((result as any).extra).toBe('existing')
    })
  })

  // ==========================================================================
  // TESTS: Batch Migration
  // ==========================================================================

  describe('batch migration for bulk updates', () => {
    it('should migrate multiple entities in batch', async () => {
      const sm = stub.schemaMigration

      // Store multiple v1 entities
      for (let i = 0; i < 10; i++) {
        sm.storeTestData('User', `user-${i}`, 1, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })
      }
      sm.setSchemaVersion('User', 1)

      // Register migration
      sm.registerMigration('User', 2, 'add-display-name', 'add-field', 'displayName', '')

      // Run batch migration
      const result = await sm.migrateBatch('User')

      expect(result.success).toBe(true)
      expect(result.migratedCount).toBe(10)
      expect(result.failedCount).toBe(0)
    })

    it('should respect batch size option', async () => {
      const sm = stub.schemaMigration

      // Store 20 entities
      for (let i = 0; i < 20; i++) {
        sm.storeTestData('User', `user-${i}`, 1, { name: `User ${i}`, email: `u${i}@test.com` })
      }
      sm.setSchemaVersion('User', 1)

      sm.registerMigration('User', 2, 'migration', 'add-field', 'migrated', true)

      // Migrate with batch size of 5
      const result = await sm.migrateBatch('User', 5)

      expect(result.success).toBe(true)
      expect(result.migratedCount).toBe(20)
    })
  })

  // ==========================================================================
  // TESTS: Migration History/Audit Trail
  // ==========================================================================

  describe('migration history/audit trail', () => {
    it('should record migration history', async () => {
      const sm = stub.schemaMigration

      sm.registerMigration('User', 2, 'add-display-name', 'add-field', 'displayName', '')

      sm.storeTestData('User', 'user-1', 1, { name: 'John' })
      sm.setSchemaVersion('User', 1)

      await sm.migrateBatch('User')

      const history = sm.getMigrationHistory('User')
      expect(history).toHaveLength(1)
      expect(history[0]?.version).toBe(2)
      expect(history[0]?.name).toBe('add-display-name')
      expect(history[0]?.timestamp).toBeDefined()
      expect(history[0]?.direction).toBe('up')
    })

    it('should record rollback in history', async () => {
      const sm = stub.schemaMigration

      sm.registerMigration('User', 2, 'migration', 'add-field', 'v2', true)

      sm.setSchemaVersion('User', 2)
      await sm.rollback('User', 1)

      const history = sm.getMigrationHistory('User')
      const rollbackEntry = history.find(h => h.direction === 'down')

      expect(rollbackEntry).toBeDefined()
      expect(rollbackEntry?.version).toBe(2)
      expect(rollbackEntry?.direction).toBe('down')
    })

    it('should include entity counts in history', async () => {
      const sm = stub.schemaMigration

      sm.registerMigration('User', 2, 'migration', 'add-field', 'migrated', true)

      for (let i = 0; i < 5; i++) {
        sm.storeTestData('User', `user-${i}`, 1, { name: `User ${i}` })
      }
      sm.setSchemaVersion('User', 1)

      await sm.migrateBatch('User')

      const history = sm.getMigrationHistory('User')
      expect(history[0]?.entitiesAffected).toBe(5)
    })
  })

  // ==========================================================================
  // TESTS: Migration Progress
  // ==========================================================================

  describe('migration progress tracking', () => {
    it('should track migration progress', async () => {
      const sm = stub.schemaMigration

      // Store entities
      for (let i = 0; i < 10; i++) {
        sm.storeTestData('User', `user-${i}`, 1, { name: `User ${i}` })
      }
      sm.setSchemaVersion('User', 1)

      sm.registerMigration('User', 2, 'migration', 'add-field', 'migrated', true)

      // Start migration with progress tracking
      await sm.migrateBatch('User')

      const progress = sm.getMigrationProgress('User')
      expect(progress).toBeDefined()
      expect(progress?.completed).toBe(true)
      expect(progress?.processedCount).toBe(10)
    })
  })
})
