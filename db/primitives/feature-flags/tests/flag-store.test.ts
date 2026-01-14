/**
 * FlagStore tests
 *
 * Tests for the FlagStore primitive that provides feature flag storage
 * with versioning, rollback, and audit trail capabilities.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createFlagStore,
  type FlagStore,
  type FlagDefinition,
  type Flag,
  type FlagVersion,
  type FlagFilters,
  type Environment,
} from '../flag-store'

// =============================================================================
// TEST TYPES AND HELPERS
// =============================================================================

function createTestStore(): FlagStore {
  return createFlagStore()
}

function createTestStoreWithEnv(environment: Environment): FlagStore {
  return createFlagStore({ defaultEnvironment: environment })
}

// =============================================================================
// BASIC CRUD OPERATIONS
// =============================================================================

describe('FlagStore', () => {
  describe('create operations', () => {
    it('should create a flag and return it with version 1', async () => {
      const store = createTestStore()

      const flag = await store.create({
        key: 'new-feature',
        name: 'New Feature',
        enabled: true,
        description: 'A brand new feature',
      })

      expect(flag.key).toBe('new-feature')
      expect(flag.name).toBe('New Feature')
      expect(flag.enabled).toBe(true)
      expect(flag.version).toBe(1)
      expect(flag.createdAt).toBeInstanceOf(Date)
      expect(flag.updatedAt).toBeInstanceOf(Date)
    })

    it('should create a flag with metadata (owner, expiry)', async () => {
      const store = createTestStore()
      const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

      const flag = await store.create({
        key: 'temp-feature',
        name: 'Temporary Feature',
        enabled: true,
        owner: 'alice@example.com',
        expiry: expiryDate,
        description: 'A temporary feature for testing',
      })

      expect(flag.owner).toBe('alice@example.com')
      expect(flag.expiry).toEqual(expiryDate)
    })

    it('should throw error for duplicate flag key', async () => {
      const store = createTestStore()

      await store.create({
        key: 'my-flag',
        name: 'My Flag',
        enabled: true,
      })

      await expect(
        store.create({
          key: 'my-flag',
          name: 'Duplicate Flag',
          enabled: false,
        })
      ).rejects.toThrow(/already exists|duplicate/i)
    })

    it('should create a flag in specific environment', async () => {
      const store = createTestStore()

      const flag = await store.create({
        key: 'staging-only',
        name: 'Staging Only Feature',
        enabled: true,
        environment: 'staging',
      })

      expect(flag.environment).toBe('staging')
    })

    it('should default to dev environment when not specified', async () => {
      const store = createTestStore()

      const flag = await store.create({
        key: 'default-env',
        name: 'Default Environment',
        enabled: true,
      })

      expect(flag.environment).toBe('dev')
    })

    it('should create flags with tags for organization', async () => {
      const store = createTestStore()

      const flag = await store.create({
        key: 'tagged-flag',
        name: 'Tagged Flag',
        enabled: true,
        tags: ['frontend', 'experiment', 'v2'],
      })

      expect(flag.tags).toEqual(['frontend', 'experiment', 'v2'])
    })
  })

  describe('update operations', () => {
    it('should update a flag and increment version', async () => {
      const store = createTestStore()

      await store.create({
        key: 'update-test',
        name: 'Update Test',
        enabled: true,
      })

      const updated = await store.update('update-test', {
        enabled: false,
        description: 'Updated description',
      })

      expect(updated.enabled).toBe(false)
      expect(updated.description).toBe('Updated description')
      expect(updated.version).toBe(2)
    })

    it('should preserve unchanged fields during update', async () => {
      const store = createTestStore()

      await store.create({
        key: 'preserve-test',
        name: 'Original Name',
        enabled: true,
        description: 'Original description',
        owner: 'alice@example.com',
      })

      const updated = await store.update('preserve-test', {
        enabled: false,
      })

      expect(updated.name).toBe('Original Name')
      expect(updated.description).toBe('Original description')
      expect(updated.owner).toBe('alice@example.com')
    })

    it('should throw error when updating non-existent flag', async () => {
      const store = createTestStore()

      await expect(
        store.update('nonexistent', { enabled: true })
      ).rejects.toThrow(/not found/i)
    })

    it('should update flag in specific environment', async () => {
      const store = createTestStore()

      await store.create({
        key: 'multi-env',
        name: 'Multi Environment',
        enabled: true,
        environment: 'prod',
      })

      const updated = await store.update('multi-env', { enabled: false }, 'prod')

      expect(updated.enabled).toBe(false)
      expect(updated.environment).toBe('prod')
    })
  })

  describe('get operations', () => {
    it('should retrieve a flag by key', async () => {
      const store = createTestStore()

      await store.create({
        key: 'get-test',
        name: 'Get Test',
        enabled: true,
      })

      const flag = await store.get('get-test')

      expect(flag).not.toBeNull()
      expect(flag?.key).toBe('get-test')
      expect(flag?.name).toBe('Get Test')
    })

    it('should return null for non-existent flag', async () => {
      const store = createTestStore()

      const flag = await store.get('nonexistent')

      expect(flag).toBeNull()
    })

    it('should retrieve flag from specific environment', async () => {
      const store = createTestStore()

      await store.create({
        key: 'env-flag',
        name: 'Dev Flag',
        enabled: true,
        environment: 'dev',
      })

      await store.create({
        key: 'env-flag',
        name: 'Prod Flag',
        enabled: false,
        environment: 'prod',
      })

      const devFlag = await store.get('env-flag', 'dev')
      const prodFlag = await store.get('env-flag', 'prod')

      expect(devFlag?.enabled).toBe(true)
      expect(prodFlag?.enabled).toBe(false)
    })
  })

  describe('list operations', () => {
    it('should list all flags', async () => {
      const store = createTestStore()

      await store.create({ key: 'flag-1', name: 'Flag 1', enabled: true })
      await store.create({ key: 'flag-2', name: 'Flag 2', enabled: false })
      await store.create({ key: 'flag-3', name: 'Flag 3', enabled: true })

      const flags = await store.list()

      expect(flags).toHaveLength(3)
    })

    it('should filter flags by enabled status', async () => {
      const store = createTestStore()

      await store.create({ key: 'enabled-1', name: 'Enabled 1', enabled: true })
      await store.create({ key: 'disabled-1', name: 'Disabled 1', enabled: false })
      await store.create({ key: 'enabled-2', name: 'Enabled 2', enabled: true })

      const enabledFlags = await store.list({ enabled: true })
      const disabledFlags = await store.list({ enabled: false })

      expect(enabledFlags).toHaveLength(2)
      expect(disabledFlags).toHaveLength(1)
    })

    it('should filter flags by environment', async () => {
      const store = createTestStore()

      await store.create({ key: 'dev-1', name: 'Dev 1', enabled: true, environment: 'dev' })
      await store.create({ key: 'prod-1', name: 'Prod 1', enabled: true, environment: 'prod' })
      await store.create({ key: 'staging-1', name: 'Staging 1', enabled: true, environment: 'staging' })

      const devFlags = await store.list({ environment: 'dev' })
      const prodFlags = await store.list({ environment: 'prod' })

      expect(devFlags).toHaveLength(1)
      expect(prodFlags).toHaveLength(1)
    })

    it('should filter flags by owner', async () => {
      const store = createTestStore()

      await store.create({ key: 'alice-1', name: 'Alice 1', enabled: true, owner: 'alice@example.com' })
      await store.create({ key: 'bob-1', name: 'Bob 1', enabled: true, owner: 'bob@example.com' })
      await store.create({ key: 'alice-2', name: 'Alice 2', enabled: true, owner: 'alice@example.com' })

      const aliceFlags = await store.list({ owner: 'alice@example.com' })

      expect(aliceFlags).toHaveLength(2)
    })

    it('should filter flags by tags', async () => {
      const store = createTestStore()

      await store.create({ key: 'tagged-1', name: 'Tagged 1', enabled: true, tags: ['frontend', 'experiment'] })
      await store.create({ key: 'tagged-2', name: 'Tagged 2', enabled: true, tags: ['backend'] })
      await store.create({ key: 'tagged-3', name: 'Tagged 3', enabled: true, tags: ['frontend', 'release'] })

      const frontendFlags = await store.list({ tags: ['frontend'] })

      expect(frontendFlags).toHaveLength(2)
    })

    it('should exclude archived flags by default', async () => {
      const store = createTestStore()

      await store.create({ key: 'active', name: 'Active', enabled: true })
      await store.create({ key: 'archived', name: 'Archived', enabled: true })
      await store.archive('archived')

      const flags = await store.list()

      expect(flags).toHaveLength(1)
      expect(flags[0].key).toBe('active')
    })

    it('should include archived flags when specified', async () => {
      const store = createTestStore()

      await store.create({ key: 'active', name: 'Active', enabled: true })
      await store.create({ key: 'archived', name: 'Archived', enabled: true })
      await store.archive('archived')

      const flags = await store.list({ includeArchived: true })

      expect(flags).toHaveLength(2)
    })
  })

  // ===========================================================================
  // VERSIONING AND HISTORY
  // ===========================================================================

  describe('versioning', () => {
    it('should track version history for a flag', async () => {
      const store = createTestStore()

      await store.create({ key: 'versioned', name: 'Version 1', enabled: true })
      await store.update('versioned', { name: 'Version 2', enabled: false })
      await store.update('versioned', { name: 'Version 3', enabled: true })

      const flag = await store.get('versioned')

      expect(flag?.version).toBe(3)
    })

    it('should retrieve version history for a flag', async () => {
      const store = createTestStore()

      await store.create({ key: 'history-test', name: 'V1', enabled: true })
      await store.update('history-test', { name: 'V2', enabled: false })
      await store.update('history-test', { name: 'V3', enabled: true })

      const history = await store.getHistory('history-test')

      expect(history).toHaveLength(3)
      expect(history[0].version).toBe(1)
      expect(history[0].name).toBe('V1')
      expect(history[1].version).toBe(2)
      expect(history[2].version).toBe(3)
    })

    it('should include change author in version history', async () => {
      const store = createFlagStore({ defaultActor: 'alice@example.com' })

      await store.create({ key: 'authored', name: 'Authored', enabled: true })

      const history = await store.getHistory('authored')

      expect(history[0].changedBy).toBe('alice@example.com')
    })

    it('should return empty array for non-existent flag history', async () => {
      const store = createTestStore()

      const history = await store.getHistory('nonexistent')

      expect(history).toEqual([])
    })
  })

  describe('rollback operations', () => {
    it('should rollback to a previous version', async () => {
      const store = createTestStore()

      await store.create({ key: 'rollback-test', name: 'V1', enabled: true, description: 'Original' })
      await store.update('rollback-test', { name: 'V2', enabled: false, description: 'Changed' })
      await store.update('rollback-test', { name: 'V3', enabled: true, description: 'Changed again' })

      const rolledBack = await store.rollback('rollback-test', 1)

      expect(rolledBack.name).toBe('V1')
      expect(rolledBack.enabled).toBe(true)
      expect(rolledBack.description).toBe('Original')
      expect(rolledBack.version).toBe(4) // Rollback creates a new version
    })

    it('should throw error for invalid version number', async () => {
      const store = createTestStore()

      await store.create({ key: 'invalid-rollback', name: 'Test', enabled: true })

      await expect(
        store.rollback('invalid-rollback', 99)
      ).rejects.toThrow(/version.*not found|invalid version/i)
    })

    it('should throw error when rolling back non-existent flag', async () => {
      const store = createTestStore()

      await expect(
        store.rollback('nonexistent', 1)
      ).rejects.toThrow(/not found/i)
    })

    it('should record rollback in audit trail', async () => {
      const store = createTestStore()

      await store.create({ key: 'audit-rollback', name: 'V1', enabled: true })
      await store.update('audit-rollback', { name: 'V2', enabled: false })
      await store.rollback('audit-rollback', 1)

      const history = await store.getHistory('audit-rollback')
      const lastEntry = history[history.length - 1]

      expect(lastEntry.changeType).toBe('rollback')
      expect(lastEntry.rolledBackTo).toBe(1)
    })
  })

  // ===========================================================================
  // ARCHIVING (SOFT DELETE)
  // ===========================================================================

  describe('archive operations', () => {
    it('should archive a flag (soft delete)', async () => {
      const store = createTestStore()

      await store.create({ key: 'to-archive', name: 'To Archive', enabled: true })
      await store.archive('to-archive')

      const flag = await store.get('to-archive')

      expect(flag?.archived).toBe(true)
      expect(flag?.archivedAt).toBeInstanceOf(Date)
    })

    it('should not return archived flag by default get', async () => {
      const store = createTestStore()

      await store.create({ key: 'archived-get', name: 'Archived Get', enabled: true })
      await store.archive('archived-get')

      const flag = await store.get('archived-get')

      // The flag still exists but is marked as archived
      expect(flag?.archived).toBe(true)
    })

    it('should throw error when archiving non-existent flag', async () => {
      const store = createTestStore()

      await expect(
        store.archive('nonexistent')
      ).rejects.toThrow(/not found/i)
    })

    it('should allow restoring archived flag', async () => {
      const store = createTestStore()

      await store.create({ key: 'restorable', name: 'Restorable', enabled: true })
      await store.archive('restorable')
      await store.restore('restorable')

      const flag = await store.get('restorable')

      expect(flag?.archived).toBe(false)
      expect(flag?.archivedAt).toBeNull()
    })

    it('should record archive action in audit trail', async () => {
      const store = createTestStore()

      await store.create({ key: 'archive-audit', name: 'Archive Audit', enabled: true })
      await store.archive('archive-audit')

      const history = await store.getHistory('archive-audit')
      const lastEntry = history[history.length - 1]

      expect(lastEntry.changeType).toBe('archive')
    })
  })

  // ===========================================================================
  // BULK OPERATIONS
  // ===========================================================================

  describe('bulk operations', () => {
    it('should create multiple flags at once', async () => {
      const store = createTestStore()

      const flags = await store.createMany([
        { key: 'bulk-1', name: 'Bulk 1', enabled: true },
        { key: 'bulk-2', name: 'Bulk 2', enabled: false },
        { key: 'bulk-3', name: 'Bulk 3', enabled: true },
      ])

      expect(flags).toHaveLength(3)
      expect(flags.every(f => f.version === 1)).toBe(true)
    })

    it('should update multiple flags at once', async () => {
      const store = createTestStore()

      await store.create({ key: 'batch-1', name: 'Batch 1', enabled: true })
      await store.create({ key: 'batch-2', name: 'Batch 2', enabled: true })
      await store.create({ key: 'batch-3', name: 'Batch 3', enabled: true })

      const updated = await store.updateMany(['batch-1', 'batch-2', 'batch-3'], { enabled: false })

      expect(updated).toHaveLength(3)
      expect(updated.every(f => f.enabled === false)).toBe(true)
      expect(updated.every(f => f.version === 2)).toBe(true)
    })

    it('should archive multiple flags at once', async () => {
      const store = createTestStore()

      await store.create({ key: 'archive-batch-1', name: 'Archive Batch 1', enabled: true })
      await store.create({ key: 'archive-batch-2', name: 'Archive Batch 2', enabled: true })

      await store.archiveMany(['archive-batch-1', 'archive-batch-2'])

      const flag1 = await store.get('archive-batch-1')
      const flag2 = await store.get('archive-batch-2')

      expect(flag1?.archived).toBe(true)
      expect(flag2?.archived).toBe(true)
    })

    it('should handle partial failures in bulk operations', async () => {
      const store = createTestStore()

      await store.create({ key: 'exists', name: 'Exists', enabled: true })

      await expect(
        store.updateMany(['exists', 'nonexistent'], { enabled: false })
      ).rejects.toThrow(/not found/i)
    })
  })

  // ===========================================================================
  // AUDIT TRAIL
  // ===========================================================================

  describe('audit trail', () => {
    it('should record creation with timestamp and actor', async () => {
      const store = createFlagStore({ defaultActor: 'system' })

      await store.create({ key: 'audit-create', name: 'Audit Create', enabled: true })

      const history = await store.getHistory('audit-create')

      expect(history[0].changeType).toBe('create')
      expect(history[0].changedBy).toBe('system')
      expect(history[0].changedAt).toBeInstanceOf(Date)
    })

    it('should record updates with changes diff', async () => {
      const store = createTestStore()

      await store.create({ key: 'audit-update', name: 'Original', enabled: true })
      await store.update('audit-update', { name: 'Updated', enabled: false })

      const history = await store.getHistory('audit-update')
      const updateEntry = history[1]

      expect(updateEntry.changeType).toBe('update')
      expect(updateEntry.changes).toBeDefined()
      expect(updateEntry.changes?.name).toEqual({ from: 'Original', to: 'Updated' })
      expect(updateEntry.changes?.enabled).toEqual({ from: true, to: false })
    })

    it('should support custom actor per operation', async () => {
      const store = createTestStore()

      await store.create({ key: 'actor-test', name: 'Actor Test', enabled: true }, 'alice@example.com')
      await store.update('actor-test', { enabled: false }, undefined, 'bob@example.com')

      const history = await store.getHistory('actor-test')

      expect(history[0].changedBy).toBe('alice@example.com')
      expect(history[1].changedBy).toBe('bob@example.com')
    })

    it('should include reason/notes for changes when provided', async () => {
      const store = createTestStore()

      await store.create({ key: 'reason-test', name: 'Reason Test', enabled: true })
      await store.update('reason-test', { enabled: false }, undefined, undefined, 'Disabling due to bug #123')

      const history = await store.getHistory('reason-test')

      expect(history[1].reason).toBe('Disabling due to bug #123')
    })
  })

  // ===========================================================================
  // ENVIRONMENT SCOPING
  // ===========================================================================

  describe('environment scoping', () => {
    it('should isolate flags across environments', async () => {
      const store = createTestStore()

      await store.create({ key: 'isolated', name: 'Dev Version', enabled: true, environment: 'dev' })
      await store.create({ key: 'isolated', name: 'Prod Version', enabled: false, environment: 'prod' })

      const devFlag = await store.get('isolated', 'dev')
      const prodFlag = await store.get('isolated', 'prod')

      expect(devFlag?.name).toBe('Dev Version')
      expect(prodFlag?.name).toBe('Prod Version')
    })

    it('should promote flag from one environment to another', async () => {
      const store = createTestStore()

      await store.create({ key: 'promote', name: 'Staging Feature', enabled: true, environment: 'staging' })

      const promoted = await store.promote('promote', 'staging', 'prod')

      expect(promoted.environment).toBe('prod')

      const stagingFlag = await store.get('promote', 'staging')
      const prodFlag = await store.get('promote', 'prod')

      expect(stagingFlag).not.toBeNull()
      expect(prodFlag).not.toBeNull()
    })

    it('should support cloning flag to another environment', async () => {
      const store = createTestStore()

      await store.create({ key: 'clone-source', name: 'Source', enabled: true, environment: 'dev' })

      const cloned = await store.clone('clone-source', 'dev', 'staging')

      expect(cloned.environment).toBe('staging')
      expect(cloned.name).toBe('Source')
      expect(cloned.version).toBe(1)
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle flags with empty description', async () => {
      const store = createTestStore()

      const flag = await store.create({
        key: 'empty-desc',
        name: 'Empty Description',
        enabled: true,
        description: '',
      })

      expect(flag.description).toBe('')
    })

    it('should handle flags with special characters in key', async () => {
      const store = createTestStore()

      const flag = await store.create({
        key: 'feature.sub-feature_v2',
        name: 'Special Key',
        enabled: true,
      })

      const retrieved = await store.get('feature.sub-feature_v2')
      expect(retrieved?.key).toBe('feature.sub-feature_v2')
    })

    it('should handle concurrent updates correctly', async () => {
      const store = createTestStore()

      await store.create({ key: 'concurrent', name: 'Concurrent', enabled: true })

      // Simulate concurrent updates
      const [update1, update2] = await Promise.all([
        store.update('concurrent', { description: 'Update 1' }),
        store.update('concurrent', { description: 'Update 2' }),
      ])

      // Both updates should have different versions
      expect(new Set([update1.version, update2.version]).size).toBe(2)
    })

    it('should handle listing with pagination', async () => {
      const store = createTestStore()

      for (let i = 0; i < 25; i++) {
        await store.create({ key: `page-${i}`, name: `Page ${i}`, enabled: true })
      }

      const page1 = await store.list({ limit: 10, offset: 0 })
      const page2 = await store.list({ limit: 10, offset: 10 })
      const page3 = await store.list({ limit: 10, offset: 20 })

      expect(page1).toHaveLength(10)
      expect(page2).toHaveLength(10)
      expect(page3).toHaveLength(5)
    })

    it('should handle null/undefined optional fields', async () => {
      const store = createTestStore()

      const flag = await store.create({
        key: 'minimal',
        name: 'Minimal',
        enabled: false,
      })

      expect(flag.description).toBeUndefined()
      expect(flag.owner).toBeUndefined()
      expect(flag.expiry).toBeUndefined()
      expect(flag.tags).toBeUndefined()
    })
  })
})
