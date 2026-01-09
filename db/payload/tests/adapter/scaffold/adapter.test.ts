import { describe, it, expect, beforeEach } from 'vitest'

/**
 * dotdoAdapter Scaffold Tests
 *
 * These tests verify that the adapter scaffold is properly structured
 * and can be integrated with Payload CMS's buildConfig.
 *
 * The adapter implements Payload's BaseDatabaseAdapter interface with
 * all 30+ methods stubbed. Tests verify:
 * - Adapter creation and configuration
 * - Storage router delegation
 * - Method presence and signatures
 * - Error handling for not-implemented methods
 *
 * @module @dotdo/payload/tests/adapter/scaffold
 */

import { dotdoAdapter, createStorageRouter } from '../../../src'
import type { DotdoAdapterArgs, DotdoAdapter, StorageRouter } from '../../../src'

// ============================================================================
// ADAPTER CREATION TESTS
// ============================================================================

describe('dotdoAdapter', () => {
  describe('creation', () => {
    it('should create adapter with default configuration', () => {
      const adapter = dotdoAdapter()

      expect(adapter).toBeDefined()
      expect(adapter.name).toBe('dotdo')
      expect(adapter.defaultIDType).toBe('text')
      expect(adapter.allowIDOnCreate).toBe(false)
      expect(typeof adapter.init).toBe('function')
    })

    it('should accept custom ID type', () => {
      const adapter = dotdoAdapter({ idType: 'number' })

      expect(adapter.defaultIDType).toBe('number')
    })

    it('should accept allowIDOnCreate option', () => {
      const adapter = dotdoAdapter({ allowIDOnCreate: true })

      expect(adapter.allowIDOnCreate).toBe(true)
    })

    it('should accept storage mode configuration', () => {
      const adapter = dotdoAdapter({
        storage: 'drizzle',
        collections: {
          users: 'drizzle',
          posts: 'things',
        },
      })

      expect(adapter).toBeDefined()
      expect(adapter.name).toBe('dotdo')
    })
  })

  describe('init', () => {
    it('should return adapter instance when initialized', () => {
      const adapterObj = dotdoAdapter()

      // Mock Payload instance
      const mockPayload = {
        collections: {},
        globals: {},
        config: {
          collections: [],
          globals: [],
        },
      } as any

      const instance = adapterObj.init({ payload: mockPayload })

      expect(instance).toBeDefined()
      expect(instance.name).toBe('dotdo')
      expect(instance.payload).toBe(mockPayload)
    })

    it('should create storage router with config', () => {
      const adapterObj = dotdoAdapter({
        storage: 'things',
        collections: {
          users: 'drizzle',
        },
      })

      const mockPayload = {
        collections: {},
        globals: {},
        config: { collections: [], globals: [] },
      } as any

      const instance = adapterObj.init({ payload: mockPayload })

      expect(instance.storageRouter).toBeDefined()
      expect(instance.storageRouter.getCollectionStrategy('users')).toBe('drizzle')
      expect(instance.storageRouter.getCollectionStrategy('posts')).toBe('things')
    })

    it('should set migration directory from config', () => {
      const adapterObj = dotdoAdapter({ migrationDir: './custom/migrations' })

      const mockPayload = {
        collections: {},
        globals: {},
        config: { collections: [], globals: [] },
      } as any

      const instance = adapterObj.init({ payload: mockPayload })

      expect(instance.migrationDir).toBe('./custom/migrations')
    })

    it('should default migration directory to ./src/migrations', () => {
      const adapterObj = dotdoAdapter()

      const mockPayload = {
        collections: {},
        globals: {},
        config: { collections: [], globals: [] },
      } as any

      const instance = adapterObj.init({ payload: mockPayload })

      expect(instance.migrationDir).toBe('./src/migrations')
    })
  })
})

// ============================================================================
// STORAGE ROUTER TESTS
// ============================================================================

describe('createStorageRouter', () => {
  it('should use default storage mode for all collections', () => {
    const router = createStorageRouter({ storage: 'things' })

    expect(router.getCollectionStrategy('users')).toBe('things')
    expect(router.getCollectionStrategy('posts')).toBe('things')
    expect(router.getCollectionStrategy('media')).toBe('things')
  })

  it('should default to "things" when no storage specified', () => {
    const router = createStorageRouter({})

    expect(router.getCollectionStrategy('anything')).toBe('things')
  })

  it('should override storage mode for specific collections', () => {
    const router = createStorageRouter({
      storage: 'things',
      collections: {
        users: 'drizzle',
        orders: 'drizzle',
      },
    })

    expect(router.getCollectionStrategy('users')).toBe('drizzle')
    expect(router.getCollectionStrategy('orders')).toBe('drizzle')
    expect(router.getCollectionStrategy('posts')).toBe('things')
  })

  it('should handle global strategy overrides', () => {
    const router = createStorageRouter({
      storage: 'things',
      globals: {
        settings: 'drizzle',
      },
    })

    expect(router.getGlobalStrategy('settings')).toBe('drizzle')
    expect(router.getGlobalStrategy('navigation')).toBe('things')
  })

  it('should store configuration', () => {
    const config = {
      storage: 'drizzle' as const,
      collections: { users: 'things' as const },
    }
    const router = createStorageRouter(config)

    expect(router.config.storage).toBe('drizzle')
    expect(router.config.collections?.users).toBe('things')
  })
})

// ============================================================================
// METHOD PRESENCE TESTS
// ============================================================================

describe('BaseDatabaseAdapter methods', () => {
  let instance: DotdoAdapter

  beforeEach(() => {
    const adapterObj = dotdoAdapter()
    const mockPayload = {
      collections: {},
      globals: {},
      config: { collections: [], globals: [] },
    } as any
    instance = adapterObj.init({ payload: mockPayload })
  })

  describe('lifecycle methods', () => {
    it('should have init method', () => {
      expect(typeof instance.init).toBe('function')
    })

    it('should have connect method', () => {
      expect(typeof instance.connect).toBe('function')
    })

    it('should have destroy method', () => {
      expect(typeof instance.destroy).toBe('function')
    })
  })

  describe('CRUD methods', () => {
    it('should have create method', () => {
      expect(typeof instance.create).toBe('function')
    })

    it('should have find method', () => {
      expect(typeof instance.find).toBe('function')
    })

    it('should have findOne method', () => {
      expect(typeof instance.findOne).toBe('function')
    })

    it('should have updateOne method', () => {
      expect(typeof instance.updateOne).toBe('function')
    })

    it('should have updateMany method', () => {
      expect(typeof instance.updateMany).toBe('function')
    })

    it('should have deleteOne method', () => {
      expect(typeof instance.deleteOne).toBe('function')
    })

    it('should have deleteMany method', () => {
      expect(typeof instance.deleteMany).toBe('function')
    })

    it('should have count method', () => {
      expect(typeof instance.count).toBe('function')
    })

    it('should have findDistinct method', () => {
      expect(typeof instance.findDistinct).toBe('function')
    })

    it('should have upsert method', () => {
      expect(typeof instance.upsert).toBe('function')
    })
  })

  describe('global methods', () => {
    it('should have createGlobal method', () => {
      expect(typeof instance.createGlobal).toBe('function')
    })

    it('should have findGlobal method', () => {
      expect(typeof instance.findGlobal).toBe('function')
    })

    it('should have updateGlobal method', () => {
      expect(typeof instance.updateGlobal).toBe('function')
    })
  })

  describe('version methods', () => {
    it('should have createVersion method', () => {
      expect(typeof instance.createVersion).toBe('function')
    })

    it('should have findVersions method', () => {
      expect(typeof instance.findVersions).toBe('function')
    })

    it('should have updateVersion method', () => {
      expect(typeof instance.updateVersion).toBe('function')
    })

    it('should have deleteVersions method', () => {
      expect(typeof instance.deleteVersions).toBe('function')
    })

    it('should have countVersions method', () => {
      expect(typeof instance.countVersions).toBe('function')
    })
  })

  describe('global version methods', () => {
    it('should have createGlobalVersion method', () => {
      expect(typeof instance.createGlobalVersion).toBe('function')
    })

    it('should have findGlobalVersions method', () => {
      expect(typeof instance.findGlobalVersions).toBe('function')
    })

    it('should have updateGlobalVersion method', () => {
      expect(typeof instance.updateGlobalVersion).toBe('function')
    })

    it('should have countGlobalVersions method', () => {
      expect(typeof instance.countGlobalVersions).toBe('function')
    })
  })

  describe('transaction methods', () => {
    it('should have beginTransaction method', () => {
      expect(typeof instance.beginTransaction).toBe('function')
    })

    it('should have commitTransaction method', () => {
      expect(typeof instance.commitTransaction).toBe('function')
    })

    it('should have rollbackTransaction method', () => {
      expect(typeof instance.rollbackTransaction).toBe('function')
    })
  })

  describe('migration methods', () => {
    it('should have createMigration method', () => {
      expect(typeof instance.createMigration).toBe('function')
    })

    it('should have migrate method', () => {
      expect(typeof instance.migrate).toBe('function')
    })

    it('should have migrateDown method', () => {
      expect(typeof instance.migrateDown).toBe('function')
    })

    it('should have migrateFresh method', () => {
      expect(typeof instance.migrateFresh).toBe('function')
    })

    it('should have migrateRefresh method', () => {
      expect(typeof instance.migrateRefresh).toBe('function')
    })

    it('should have migrateReset method', () => {
      expect(typeof instance.migrateReset).toBe('function')
    })

    it('should have migrateStatus method', () => {
      expect(typeof instance.migrateStatus).toBe('function')
    })
  })

  describe('query methods', () => {
    it('should have queryDrafts method', () => {
      expect(typeof instance.queryDrafts).toBe('function')
    })
  })
})

// ============================================================================
// NOT IMPLEMENTED ERROR TESTS
// ============================================================================

describe('not implemented errors', () => {
  let instance: DotdoAdapter

  beforeEach(() => {
    const adapterObj = dotdoAdapter()
    const mockPayload = {
      collections: {},
      globals: {},
      config: { collections: [], globals: [] },
    } as any
    instance = adapterObj.init({ payload: mockPayload })
  })

  it('should throw descriptive error for unimplemented create', async () => {
    await expect(instance.create({} as any)).rejects.toThrow(/not yet implemented/)
    await expect(instance.create({} as any)).rejects.toThrow(/create/)
  })

  it('should throw descriptive error for unimplemented find', async () => {
    await expect(instance.find({} as any)).rejects.toThrow(/not yet implemented/)
    await expect(instance.find({} as any)).rejects.toThrow(/find/)
  })

  it('should throw descriptive error for unimplemented findOne', async () => {
    await expect(instance.findOne({} as any)).rejects.toThrow(/not yet implemented/)
    await expect(instance.findOne({} as any)).rejects.toThrow(/findOne/)
  })

  it('should mention implementing strategies in error', async () => {
    await expect(instance.create({} as any)).rejects.toThrow(/ThingsStrategy|DrizzleStrategy/)
  })
})

// ============================================================================
// TRANSACTION TESTS (Basic)
// ============================================================================

describe('transaction basics', () => {
  let instance: DotdoAdapter

  beforeEach(() => {
    const adapterObj = dotdoAdapter()
    const mockPayload = {
      collections: {},
      globals: {},
      config: { collections: [], globals: [] },
    } as any
    instance = adapterObj.init({ payload: mockPayload })
  })

  it('should begin transaction and return ID', async () => {
    const txId = await instance.beginTransaction()

    expect(txId).toBeDefined()
    expect(typeof txId).toBe('string')
    expect(txId).toMatch(/^tx_/)
  })

  it('should store transaction in sessions', async () => {
    const txId = await instance.beginTransaction()

    expect(instance.sessions.has(txId)).toBe(true)
  })

  it('should commit transaction and remove from sessions', async () => {
    const txId = await instance.beginTransaction()
    await instance.commitTransaction(txId)

    expect(instance.sessions.has(txId)).toBe(false)
  })

  it('should rollback transaction and remove from sessions', async () => {
    const txId = await instance.beginTransaction()
    await instance.rollbackTransaction(txId)

    expect(instance.sessions.has(txId)).toBe(false)
  })

  it('should throw error when committing unknown transaction', async () => {
    await expect(instance.commitTransaction('unknown_tx_123')).rejects.toThrow(/not found/)
  })

  it('should throw error when rolling back unknown transaction', async () => {
    await expect(instance.rollbackTransaction('unknown_tx_123')).rejects.toThrow(/not found/)
  })
})

// ============================================================================
// LIFECYCLE TESTS
// ============================================================================

describe('lifecycle', () => {
  let instance: DotdoAdapter

  beforeEach(() => {
    const adapterObj = dotdoAdapter()
    const mockPayload = {
      collections: {},
      globals: {},
      config: { collections: [], globals: [] },
    } as any
    instance = adapterObj.init({ payload: mockPayload })
  })

  it('should not throw on init', async () => {
    await expect(instance.init()).resolves.not.toThrow()
  })

  it('should not throw on connect', async () => {
    await expect(instance.connect()).resolves.not.toThrow()
  })

  it('should not throw on destroy', async () => {
    await expect(instance.destroy()).resolves.not.toThrow()
  })

  it('should clear sessions on destroy', async () => {
    await instance.beginTransaction()
    await instance.beginTransaction()

    expect(instance.sessions.size).toBe(2)

    await instance.destroy()

    expect(instance.sessions.size).toBe(0)
  })
})

// ============================================================================
// SCHEMA HOOKS TESTS
// ============================================================================

describe('schema hooks', () => {
  it('should call beforeSchemaInit hook during init', async () => {
    let hookCalled = false

    const adapterObj = dotdoAdapter({
      beforeSchemaInit: async ({ schema }) => {
        hookCalled = true
        return schema
      },
    })

    const mockPayload = {
      collections: {},
      globals: {},
      config: { collections: [], globals: [] },
    } as any

    const instance = adapterObj.init({ payload: mockPayload })
    await instance.init()

    expect(hookCalled).toBe(true)
  })

  it('should call afterSchemaInit hook during init', async () => {
    let hookCalled = false

    const adapterObj = dotdoAdapter({
      afterSchemaInit: async ({ schema }) => {
        hookCalled = true
        return schema
      },
    })

    const mockPayload = {
      collections: {},
      globals: {},
      config: { collections: [], globals: [] },
    } as any

    const instance = adapterObj.init({ payload: mockPayload })
    await instance.init()

    expect(hookCalled).toBe(true)
  })

  it('should call hooks in correct order', async () => {
    const callOrder: string[] = []

    const adapterObj = dotdoAdapter({
      beforeSchemaInit: async ({ schema }) => {
        callOrder.push('before')
        return schema
      },
      afterSchemaInit: async ({ schema }) => {
        callOrder.push('after')
        return schema
      },
    })

    const mockPayload = {
      collections: {},
      globals: {},
      config: { collections: [], globals: [] },
    } as any

    const instance = adapterObj.init({ payload: mockPayload })
    await instance.init()

    expect(callOrder).toEqual(['before', 'after'])
  })
})

// ============================================================================
// TYPE EXPORTS TESTS
// ============================================================================

describe('type exports', () => {
  it('should export DotdoAdapterArgs type', () => {
    // This test verifies the type is exported and usable
    const args: DotdoAdapterArgs = {
      storage: 'things',
      idType: 'text',
    }
    expect(args.storage).toBe('things')
  })

  it('should export StorageRouter type', () => {
    const router: StorageRouter = createStorageRouter({ storage: 'things' })
    expect(router.getCollectionStrategy).toBeDefined()
  })
})
