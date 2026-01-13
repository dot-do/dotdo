/**
 * Schema Migration Tests - TDD RED Phase
 *
 * Tests for entity-level schema migration in DO storage.
 * This provides safe schema evolution with versioning and rollback support.
 *
 * Key features:
 * - Schema version tracked per entity type
 * - Migration registry stores up/down migrations
 * - Forward migration (upgrade) transforms data correctly
 * - Backward migration (rollback) restores previous schema
 * - Lazy migration on read (migrate when accessed)
 * - Batch migration for bulk updates
 * - Concurrent access during migration is safe
 * - Validation of migrated data
 * - Partial migration recovery (resume after failure)
 * - Migration history/audit trail
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SchemaMigrationManager,
  type Migration,
  type MigrationResult,
  type MigrationHistoryEntry,
  type EntityMigrationOptions,
} from '../SchemaMigration'

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

// Mock storage for testing
function createMockStorage() {
  const data = new Map<string, { version: number; data: unknown }>()
  const versions = new Map<string, number>()

  return {
    data,
    versions,
    get(entityType: string, id: string) {
      return data.get(`${entityType}:${id}`)
    },
    set(entityType: string, id: string, version: number, value: unknown) {
      data.set(`${entityType}:${id}`, { version, data: value })
    },
    getVersion(entityType: string) {
      return versions.get(entityType) ?? 0
    },
    setVersion(entityType: string, version: number) {
      versions.set(entityType, version)
    },
    list(entityType: string) {
      const results: Array<{ id: string; version: number; data: unknown }> = []
      for (const [key, value] of data.entries()) {
        if (key.startsWith(`${entityType}:`)) {
          results.push({
            id: key.replace(`${entityType}:`, ''),
            ...value,
          })
        }
      }
      return results
    },
  }
}

// ============================================================================
// TESTS: Schema Version Tracking
// ============================================================================

describe('SchemaMigrationManager', () => {
  describe('schema version tracking per entity type', () => {
    it('should track schema version per entity type', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Initially no version
      expect(await manager.getCurrentVersion('User')).toBe(0)
      expect(await manager.getCurrentVersion('Order')).toBe(0)

      // Register migration for User
      manager.register('User', {
        version: 1,
        name: 'add-user-display-name',
        up: (data: unknown) => ({ ...(data as UserV1), displayName: (data as UserV1).name }),
        down: (data: unknown) => {
          const { displayName, ...rest } = data as UserV2
          return rest
        },
      })

      // After registration, version should still be 0 (not applied yet)
      expect(await manager.getCurrentVersion('User')).toBe(0)
    })

    it('should allow different entity types to have different versions', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      manager.register('User', {
        version: 1,
        name: 'user-v1',
        up: (data: unknown) => data,
        down: (data: unknown) => data,
      })

      manager.register('User', {
        version: 2,
        name: 'user-v2',
        up: (data: unknown) => data,
        down: (data: unknown) => data,
      })

      manager.register('Order', {
        version: 1,
        name: 'order-v1',
        up: (data: unknown) => data,
        down: (data: unknown) => data,
      })

      // Apply only User migrations
      await manager.migrateBatch('User')

      expect(await manager.getCurrentVersion('User')).toBe(2)
      expect(await manager.getCurrentVersion('Order')).toBe(0)
    })
  })

  // ============================================================================
  // TESTS: Migration Registry
  // ============================================================================

  describe('migration registry stores up/down migrations', () => {
    it('should register migrations with up and down functions', () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      const migration: Migration = {
        version: 1,
        name: 'add-display-name',
        up: (data: unknown) => ({ ...(data as UserV1), displayName: (data as UserV1).name }),
        down: (data: unknown) => {
          const { displayName, ...rest } = data as UserV2
          return rest
        },
      }

      manager.register('User', migration)

      const registered = manager.getMigration('User', 1)
      expect(registered).toBeDefined()
      expect(registered?.name).toBe('add-display-name')
      expect(typeof registered?.up).toBe('function')
      expect(typeof registered?.down).toBe('function')
    })

    it('should reject duplicate migration versions', () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      manager.register('User', {
        version: 1,
        name: 'first-migration',
        up: (data: unknown) => data,
        down: (data: unknown) => data,
      })

      expect(() => {
        manager.register('User', {
          version: 1,
          name: 'duplicate-migration',
          up: (data: unknown) => data,
          down: (data: unknown) => data,
        })
      }).toThrow(/duplicate|already.*registered/i)
    })

    it('should list all registered migrations for an entity type', () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      manager.register('User', {
        version: 1,
        name: 'migration-1',
        up: (data: unknown) => data,
        down: (data: unknown) => data,
      })

      manager.register('User', {
        version: 2,
        name: 'migration-2',
        up: (data: unknown) => data,
        down: (data: unknown) => data,
      })

      const migrations = manager.getMigrations('User')
      expect(migrations).toHaveLength(2)
      expect(migrations[0]?.version).toBe(1)
      expect(migrations[1]?.version).toBe(2)
    })
  })

  // ============================================================================
  // TESTS: Forward Migration (Upgrade)
  // ============================================================================

  describe('forward migration (upgrade) transforms data correctly', () => {
    it('should migrate entity from v1 to v2', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Store v1 data
      storage.set('User', 'user-1', 1, {
        name: 'John Doe',
        email: 'john@example.com',
      })
      storage.setVersion('User', 1)

      // Register v2 migration
      manager.register('User', {
        version: 2,
        name: 'add-display-name',
        up: (data: unknown) => ({
          ...(data as UserV1),
          displayName: (data as UserV1).name,
        }),
        down: (data: unknown) => {
          const { displayName, ...rest } = data as UserV2
          return rest
        },
      })

      // Migrate entity
      const migrated = await manager.migrateEntity<UserV2>('User', storage.get('User', 'user-1')!.data)

      expect(migrated.name).toBe('John Doe')
      expect(migrated.email).toBe('john@example.com')
      expect(migrated.displayName).toBe('John Doe')
    })

    it('should chain multiple migrations (v1 -> v2 -> v3)', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Store v1 data
      storage.set('User', 'user-1', 1, {
        name: 'John Doe',
        email: 'john@example.com',
      })
      storage.setVersion('User', 1)

      // Register migrations
      manager.register('User', {
        version: 2,
        name: 'add-display-name',
        up: (data: unknown) => ({
          ...(data as UserV1),
          displayName: (data as UserV1).name,
        }),
        down: (data: unknown) => {
          const { displayName, ...rest } = data as UserV2
          return rest
        },
      })

      manager.register('User', {
        version: 3,
        name: 'rename-to-full-name',
        up: (data: unknown) => {
          const d = data as UserV2
          return {
            fullName: d.name,
            email: d.email,
            displayName: d.displayName,
            createdAt: Date.now(),
          }
        },
        down: (data: unknown) => {
          const d = data as UserV3
          return {
            name: d.fullName,
            email: d.email,
            displayName: d.displayName,
          }
        },
      })

      // Migrate entity through all versions
      const migrated = await manager.migrateEntity<UserV3>(
        'User',
        storage.get('User', 'user-1')!.data,
        { fromVersion: 1, toVersion: 3 }
      )

      expect(migrated.fullName).toBe('John Doe')
      expect(migrated.email).toBe('john@example.com')
      expect(migrated.displayName).toBe('John Doe')
      expect(migrated.createdAt).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TESTS: Backward Migration (Rollback)
  // ============================================================================

  describe('backward migration (rollback) restores previous schema', () => {
    it('should rollback entity from v2 to v1', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Store v2 data
      storage.set('User', 'user-1', 2, {
        name: 'John Doe',
        email: 'john@example.com',
        displayName: 'Johnny',
      })
      storage.setVersion('User', 2)

      // Register migration
      manager.register('User', {
        version: 2,
        name: 'add-display-name',
        up: (data: unknown) => ({
          ...(data as UserV1),
          displayName: (data as UserV1).name,
        }),
        down: (data: unknown) => {
          const { displayName, ...rest } = data as UserV2
          return rest
        },
      })

      // Rollback
      const result = await manager.rollback('User', 1)

      expect(result.success).toBe(true)
      expect(await manager.getCurrentVersion('User')).toBe(1)
    })

    it('should rollback through multiple versions (v3 -> v1)', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Register all migrations
      manager.register('User', {
        version: 2,
        name: 'add-display-name',
        up: (data: unknown) => ({
          ...(data as UserV1),
          displayName: (data as UserV1).name,
        }),
        down: (data: unknown) => {
          const { displayName, ...rest } = data as UserV2
          return rest
        },
      })

      manager.register('User', {
        version: 3,
        name: 'rename-to-full-name',
        up: (data: unknown) => {
          const d = data as UserV2
          return {
            fullName: d.name,
            email: d.email,
            displayName: d.displayName,
            createdAt: Date.now(),
          }
        },
        down: (data: unknown) => {
          const d = data as UserV3
          return {
            name: d.fullName,
            email: d.email,
            displayName: d.displayName,
          }
        },
      })

      // Set current version to 3
      storage.setVersion('User', 3)

      // Rollback to v1
      const result = await manager.rollback('User', 1)

      expect(result.success).toBe(true)
      expect(await manager.getCurrentVersion('User')).toBe(1)
    })

    it('should fail rollback if migration has no down function', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Register irreversible migration
      manager.register('User', {
        version: 2,
        name: 'irreversible-migration',
        up: (data: unknown) => data,
        down: undefined as any, // No down function
      })

      storage.setVersion('User', 2)

      // Attempt rollback should fail
      const result = await manager.rollback('User', 1)

      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TESTS: Lazy Migration on Read
  // ============================================================================

  describe('lazy migration on read (migrate when accessed)', () => {
    it('should migrate data lazily when read', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Store v1 data
      storage.set('User', 'user-1', 1, {
        name: 'John Doe',
        email: 'john@example.com',
      })

      // Register v2 migration and set target version
      manager.register('User', {
        version: 2,
        name: 'add-display-name',
        up: (data: unknown) => ({
          ...(data as UserV1),
          displayName: (data as UserV1).name,
        }),
        down: (data: unknown) => {
          const { displayName, ...rest } = data as UserV2
          return rest
        },
      })

      manager.setTargetVersion('User', 2)

      // Read with lazy migration
      const storedData = storage.get('User', 'user-1')!
      const migrated = await manager.migrateOnRead<UserV2>(
        'User',
        storedData.data,
        storedData.version
      )

      expect(migrated.displayName).toBe('John Doe')
    })

    it('should not migrate if already at target version', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      const upMock = vi.fn((data: unknown) => data)

      manager.register('User', {
        version: 2,
        name: 'migration',
        up: upMock,
        down: (data: unknown) => data,
      })

      manager.setTargetVersion('User', 2)

      // Store v2 data (already at target)
      storage.set('User', 'user-1', 2, {
        name: 'John',
        email: 'john@example.com',
      })

      const storedData = storage.get('User', 'user-1')!
      await manager.migrateOnRead('User', storedData.data, storedData.version)

      expect(upMock).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // TESTS: Batch Migration
  // ============================================================================

  describe('batch migration for bulk updates', () => {
    it('should migrate multiple entities in batch', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Store multiple v1 entities
      for (let i = 0; i < 10; i++) {
        storage.set('User', `user-${i}`, 1, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })
      }
      storage.setVersion('User', 1)

      // Register migration
      manager.register('User', {
        version: 2,
        name: 'add-display-name',
        up: (data: unknown) => ({
          ...(data as UserV1),
          displayName: (data as UserV1).name,
        }),
        down: (data: unknown) => {
          const { displayName, ...rest } = data as UserV2
          return rest
        },
      })

      // Run batch migration
      const result = await manager.migrateBatch('User')

      expect(result.success).toBe(true)
      expect(result.migratedCount).toBe(10)
      expect(result.failedCount).toBe(0)
    })

    it('should respect batch size option', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Store 20 entities
      for (let i = 0; i < 20; i++) {
        storage.set('User', `user-${i}`, 1, { name: `User ${i}`, email: `u${i}@test.com` })
      }
      storage.setVersion('User', 1)

      manager.register('User', {
        version: 2,
        name: 'migration',
        up: (data: unknown) => ({ ...(data as any), migrated: true }),
        down: (data: unknown) => data,
      })

      // Migrate with batch size of 5
      const result = await manager.migrateBatch('User', { batchSize: 5 })

      expect(result.success).toBe(true)
      expect(result.migratedCount).toBe(20)
    })

    it('should continue batch after individual failures', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Store entities - some will fail
      for (let i = 0; i < 10; i++) {
        storage.set('User', `user-${i}`, 1, { name: `User ${i}`, failOnMigrate: i === 5 })
      }
      storage.setVersion('User', 1)

      manager.register('User', {
        version: 2,
        name: 'migration-that-fails',
        up: (data: unknown) => {
          if ((data as any).failOnMigrate) {
            throw new Error('Migration failed for this entity')
          }
          return { ...(data as any), migrated: true }
        },
        down: (data: unknown) => data,
      })

      const result = await manager.migrateBatch('User', { continueOnError: true })

      expect(result.migratedCount).toBe(9)
      expect(result.failedCount).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.id).toBe('user-5')
    })
  })

  // ============================================================================
  // TESTS: Concurrent Access Safety
  // ============================================================================

  describe('concurrent access during migration is safe', () => {
    it('should handle concurrent reads during batch migration', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Store entities
      for (let i = 0; i < 100; i++) {
        storage.set('User', `user-${i}`, 1, { name: `User ${i}` })
      }
      storage.setVersion('User', 1)

      manager.register('User', {
        version: 2,
        name: 'migration',
        up: (data: unknown) => ({ ...(data as any), migrated: true }),
        down: (data: unknown) => data,
      })

      manager.setTargetVersion('User', 2)

      // Simulate concurrent operations
      const batchPromise = manager.migrateBatch('User')
      const readPromises = Array.from({ length: 10 }, (_, i) =>
        manager.migrateOnRead('User', storage.get('User', `user-${i}`)?.data, 1)
      )

      const [batchResult, ...readResults] = await Promise.all([batchPromise, ...readPromises])

      expect(batchResult.success).toBe(true)
      readResults.forEach(result => {
        expect(result).toBeDefined()
      })
    })

    it('should use locking to prevent duplicate migrations', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      let migrationCallCount = 0

      manager.register('User', {
        version: 2,
        name: 'migration',
        up: (data: unknown) => {
          migrationCallCount++
          return { ...(data as any), migrated: true }
        },
        down: (data: unknown) => data,
      })

      storage.set('User', 'user-1', 1, { name: 'John' })
      storage.setVersion('User', 1)

      // Trigger multiple concurrent batch migrations
      const results = await Promise.all([
        manager.migrateBatch('User'),
        manager.migrateBatch('User'),
        manager.migrateBatch('User'),
      ])

      // Only one should actually perform migrations
      const successfulMigrations = results.filter(r => r.migratedCount > 0)
      expect(successfulMigrations.length).toBeLessThanOrEqual(1)
    })
  })

  // ============================================================================
  // TESTS: Data Validation
  // ============================================================================

  describe('validation of migrated data', () => {
    it('should validate migrated data with custom validator', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      const validator = vi.fn((data: unknown): boolean => {
        const d = data as UserV2
        return typeof d.displayName === 'string' && d.displayName.length > 0
      })

      manager.register('User', {
        version: 2,
        name: 'add-display-name',
        up: (data: unknown) => ({
          ...(data as UserV1),
          displayName: (data as UserV1).name,
        }),
        down: (data: unknown) => {
          const { displayName, ...rest } = data as UserV2
          return rest
        },
        validate: validator,
      })

      storage.set('User', 'user-1', 1, { name: 'John', email: 'j@test.com' })
      storage.setVersion('User', 1)

      const migrated = await manager.migrateEntity('User', storage.get('User', 'user-1')!.data)

      expect(validator).toHaveBeenCalled()
      expect(migrated).toBeDefined()
    })

    it('should reject migration if validation fails', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      manager.register('User', {
        version: 2,
        name: 'migration-that-produces-invalid-data',
        up: (data: unknown) => ({
          ...(data as UserV1),
          displayName: '', // Empty string - invalid
        }),
        down: (data: unknown) => data,
        validate: (data: unknown) => {
          const d = data as UserV2
          return typeof d.displayName === 'string' && d.displayName.length > 0
        },
      })

      storage.set('User', 'user-1', 1, { name: 'John', email: 'j@test.com' })

      await expect(
        manager.migrateEntity('User', storage.get('User', 'user-1')!.data)
      ).rejects.toThrow(/validation/i)
    })
  })

  // ============================================================================
  // TESTS: Partial Migration Recovery
  // ============================================================================

  describe('partial migration recovery (resume after failure)', () => {
    it('should track migration progress', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      // Store entities
      for (let i = 0; i < 10; i++) {
        storage.set('User', `user-${i}`, 1, { name: `User ${i}` })
      }
      storage.setVersion('User', 1)

      manager.register('User', {
        version: 2,
        name: 'migration',
        up: (data: unknown) => ({ ...(data as any), migrated: true }),
        down: (data: unknown) => data,
      })

      // Start migration with progress tracking
      await manager.migrateBatch('User')

      const progress = manager.getMigrationProgress('User')
      expect(progress).toBeDefined()
      expect(progress?.completed).toBe(true)
      expect(progress?.processedCount).toBe(10)
    })

    it('should resume migration from last successful point', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      let callCount = 0

      manager.register('User', {
        version: 2,
        name: 'migration',
        up: (data: unknown) => {
          callCount++
          // Fail on 6th entity (simulate crash)
          if (callCount === 6) {
            throw new Error('Simulated crash')
          }
          return { ...(data as any), migrated: true }
        },
        down: (data: unknown) => data,
      })

      // Store entities
      for (let i = 0; i < 10; i++) {
        storage.set('User', `user-${i}`, 1, { name: `User ${i}` })
      }
      storage.setVersion('User', 1)

      // First attempt - will fail
      await manager.migrateBatch('User', { continueOnError: false }).catch(() => {})

      // Reset migration function
      callCount = 100 // Skip the failing check

      // Resume migration
      const result = await manager.resumeMigration('User')

      expect(result.success).toBe(true)
      // Should only migrate remaining entities (not the ones already done)
    })
  })

  // ============================================================================
  // TESTS: Migration History/Audit Trail
  // ============================================================================

  describe('migration history/audit trail', () => {
    it('should record migration history', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      manager.register('User', {
        version: 2,
        name: 'add-display-name',
        up: (data: unknown) => ({ ...(data as any), displayName: 'test' }),
        down: (data: unknown) => data,
      })

      storage.set('User', 'user-1', 1, { name: 'John' })
      storage.setVersion('User', 1)

      await manager.migrateBatch('User')

      const history = manager.getMigrationHistory('User')
      expect(history).toHaveLength(1)
      expect(history[0]?.version).toBe(2)
      expect(history[0]?.name).toBe('add-display-name')
      expect(history[0]?.timestamp).toBeDefined()
      expect(history[0]?.direction).toBe('up')
    })

    it('should record rollback in history', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      manager.register('User', {
        version: 2,
        name: 'migration',
        up: (data: unknown) => ({ ...(data as any), v2: true }),
        down: (data: unknown) => {
          const { v2, ...rest } = data as any
          return rest
        },
      })

      storage.setVersion('User', 2)
      await manager.rollback('User', 1)

      const history = manager.getMigrationHistory('User')
      const rollbackEntry = history.find(h => h.direction === 'down')

      expect(rollbackEntry).toBeDefined()
      expect(rollbackEntry?.version).toBe(2)
      expect(rollbackEntry?.direction).toBe('down')
    })

    it('should include entity counts in history', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      manager.register('User', {
        version: 2,
        name: 'migration',
        up: (data: unknown) => ({ ...(data as any), migrated: true }),
        down: (data: unknown) => data,
      })

      for (let i = 0; i < 5; i++) {
        storage.set('User', `user-${i}`, 1, { name: `User ${i}` })
      }
      storage.setVersion('User', 1)

      await manager.migrateBatch('User')

      const history = manager.getMigrationHistory('User')
      expect(history[0]?.entitiesAffected).toBe(5)
    })

    it('should include duration in history entries', async () => {
      const storage = createMockStorage()
      const manager = new SchemaMigrationManager(storage)

      manager.register('User', {
        version: 2,
        name: 'slow-migration',
        up: async (data: unknown) => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return { ...(data as any), migrated: true }
        },
        down: (data: unknown) => data,
      })

      storage.set('User', 'user-1', 1, { name: 'John' })
      storage.setVersion('User', 1)

      await manager.migrateBatch('User')

      const history = manager.getMigrationHistory('User')
      expect(history[0]?.durationMs).toBeGreaterThanOrEqual(10)
    })
  })
})
