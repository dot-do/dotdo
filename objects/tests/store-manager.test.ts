/**
 * StoreManager Tests
 *
 * Tests for the StoreManager service extracted from DOBase.
 * Verifies:
 * - Lazy initialization of stores
 * - Store context creation
 * - Branch switching
 * - Type cache management
 * - DLQ handler configuration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StoreManager, type StoreManagerConfig, type DLQHandlerMap } from '../services/StoreManager'
import {
  ThingsStore,
  RelationshipsStore,
  ActionsStore,
  EventsStore,
  SearchStore,
  ObjectsStore,
  DLQStore,
} from '../../db/stores'

// Create a minimal mock database that satisfies the interface
function createMockDb() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue([]),
    run: vi.fn().mockResolvedValue(undefined),
  } as any
}

// Create a minimal mock environment
function createMockEnv() {
  return {
    DO: undefined,
    PIPELINE: undefined,
    AI: undefined,
    R2_SQL: undefined,
  }
}

describe('StoreManager', () => {
  let config: StoreManagerConfig
  let mockDb: ReturnType<typeof createMockDb>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockDb = createMockDb()
    mockEnv = createMockEnv()
    config = {
      db: mockDb,
      ns: 'test-namespace',
      currentBranch: 'main',
      env: mockEnv,
    }
  })

  describe('constructor', () => {
    it('should create instance with provided config', () => {
      const manager = new StoreManager(config)

      expect(manager.ns).toBe('test-namespace')
      expect(manager.currentBranch).toBe('main')
      expect(manager.db).toBe(mockDb)
    })

    it('should create internal type cache if not provided', () => {
      const manager = new StoreManager(config)

      expect(manager.typeCache).toBeInstanceOf(Map)
      expect(manager.typeCache.size).toBe(0)
    })

    it('should use provided type cache', () => {
      const sharedCache = new Map<string, number>()
      sharedCache.set('Customer', 1)

      const manager = new StoreManager({ ...config, typeCache: sharedCache })

      expect(manager.typeCache).toBe(sharedCache)
      expect(manager.typeCache.get('Customer')).toBe(1)
    })
  })

  describe('getStoreContext', () => {
    it('should return correct store context', () => {
      const manager = new StoreManager(config)
      const context = manager.getStoreContext()

      expect(context.db).toBe(mockDb)
      expect(context.ns).toBe('test-namespace')
      expect(context.currentBranch).toBe('main')
      expect(context.env).toBe(mockEnv)
      expect(context.typeCache).toBe(manager.typeCache)
    })

    it('should reflect current branch changes', () => {
      const manager = new StoreManager(config)

      manager.currentBranch = 'feature-branch'
      const context = manager.getStoreContext()

      expect(context.currentBranch).toBe('feature-branch')
    })
  })

  describe('lazy store initialization', () => {
    it('should not initialize stores on construction', () => {
      const manager = new StoreManager(config)

      expect(manager.isStoreInitialized('things')).toBe(false)
      expect(manager.isStoreInitialized('rels')).toBe(false)
      expect(manager.isStoreInitialized('actions')).toBe(false)
      expect(manager.isStoreInitialized('events')).toBe(false)
      expect(manager.isStoreInitialized('search')).toBe(false)
      expect(manager.isStoreInitialized('objects')).toBe(false)
      expect(manager.isStoreInitialized('dlq')).toBe(false)
      expect(manager.getInitializedStores()).toEqual([])
    })

    it('should initialize things store on first access', () => {
      const manager = new StoreManager(config)

      const things = manager.things

      expect(things).toBeInstanceOf(ThingsStore)
      expect(manager.isStoreInitialized('things')).toBe(true)
      expect(manager.getInitializedStores()).toContain('things')
    })

    it('should return same instance on subsequent access', () => {
      const manager = new StoreManager(config)

      const first = manager.things
      const second = manager.things

      expect(first).toBe(second)
    })

    it('should initialize rels store on first access', () => {
      const manager = new StoreManager(config)

      const rels = manager.rels

      expect(rels).toBeInstanceOf(RelationshipsStore)
      expect(manager.isStoreInitialized('rels')).toBe(true)
    })

    it('should initialize actions store on first access', () => {
      const manager = new StoreManager(config)

      const actions = manager.actions

      expect(actions).toBeInstanceOf(ActionsStore)
      expect(manager.isStoreInitialized('actions')).toBe(true)
    })

    it('should initialize events store on first access', () => {
      const manager = new StoreManager(config)

      const events = manager.events

      expect(events).toBeInstanceOf(EventsStore)
      expect(manager.isStoreInitialized('events')).toBe(true)
    })

    it('should initialize search store on first access', () => {
      const manager = new StoreManager(config)

      const search = manager.search

      expect(search).toBeInstanceOf(SearchStore)
      expect(manager.isStoreInitialized('search')).toBe(true)
    })

    it('should initialize objects store on first access', () => {
      const manager = new StoreManager(config)

      const objects = manager.objects

      expect(objects).toBeInstanceOf(ObjectsStore)
      expect(manager.isStoreInitialized('objects')).toBe(true)
    })

    it('should initialize dlq store on first access', () => {
      const manager = new StoreManager(config)

      const dlq = manager.dlq

      expect(dlq).toBeInstanceOf(DLQStore)
      expect(manager.isStoreInitialized('dlq')).toBe(true)
    })
  })

  describe('branch switching', () => {
    it('should update currentBranch', () => {
      const manager = new StoreManager(config)

      manager.currentBranch = 'feature-branch'

      expect(manager.currentBranch).toBe('feature-branch')
    })

    it('should reset stores on branch change', () => {
      const manager = new StoreManager(config)

      // Initialize some stores
      const _things = manager.things
      const _actions = manager.actions
      expect(manager.isStoreInitialized('things')).toBe(true)
      expect(manager.isStoreInitialized('actions')).toBe(true)

      // Change branch
      manager.currentBranch = 'feature-branch'

      // Stores should be reset
      expect(manager.isStoreInitialized('things')).toBe(false)
      expect(manager.isStoreInitialized('actions')).toBe(false)
    })

    it('should create new store instances with new branch', () => {
      const manager = new StoreManager(config)

      const thingsMain = manager.things
      const contextMain = manager.getStoreContext()
      expect(contextMain.currentBranch).toBe('main')

      manager.currentBranch = 'feature-branch'

      const thingsFeature = manager.things
      const contextFeature = manager.getStoreContext()

      expect(thingsMain).not.toBe(thingsFeature)
      expect(contextFeature.currentBranch).toBe('feature-branch')
    })
  })

  describe('resetStores', () => {
    it('should reset all initialized stores', () => {
      const manager = new StoreManager(config)

      // Initialize all stores
      const _things = manager.things
      const _rels = manager.rels
      const _actions = manager.actions
      const _events = manager.events
      const _search = manager.search
      const _objects = manager.objects
      const _dlq = manager.dlq

      expect(manager.getInitializedStores().length).toBe(7)

      // Reset
      manager.resetStores()

      expect(manager.getInitializedStores().length).toBe(0)
    })

    it('should allow re-initialization after reset', () => {
      const manager = new StoreManager(config)

      const thingsBefore = manager.things
      manager.resetStores()
      const thingsAfter = manager.things

      expect(thingsBefore).not.toBe(thingsAfter)
    })
  })

  describe('DLQ handlers', () => {
    it('should set DLQ handlers', () => {
      const manager = new StoreManager(config)
      const handlers: DLQHandlerMap = new Map()
      handlers.set('Customer.created', async (data) => data)

      manager.setDlqHandlers(handlers)

      // Access DLQ to verify handlers are passed
      const dlq = manager.dlq
      expect(dlq).toBeInstanceOf(DLQStore)
    })

    it('should reset DLQ store when handlers change', () => {
      const manager = new StoreManager(config)

      // Initialize DLQ first
      const dlqBefore = manager.dlq

      // Set new handlers
      const handlers: DLQHandlerMap = new Map()
      handlers.set('Customer.created', async (data) => data)
      manager.setDlqHandlers(handlers)

      // Should be reset
      expect(manager.isStoreInitialized('dlq')).toBe(false)

      // New instance
      const dlqAfter = manager.dlq
      expect(dlqBefore).not.toBe(dlqAfter)
    })
  })

  describe('type cache', () => {
    it('should expose type cache for noun FK resolution', () => {
      const manager = new StoreManager(config)

      manager.typeCache.set('Customer', 1)
      manager.typeCache.set('Order', 2)

      expect(manager.typeCache.get('Customer')).toBe(1)
      expect(manager.typeCache.get('Order')).toBe(2)
    })

    it('should share type cache across stores', () => {
      const manager = new StoreManager(config)

      manager.typeCache.set('Product', 3)

      const context = manager.getStoreContext()
      expect(context.typeCache.get('Product')).toBe(3)
    })
  })

  describe('getInitializedStores', () => {
    it('should return empty array when no stores initialized', () => {
      const manager = new StoreManager(config)

      expect(manager.getInitializedStores()).toEqual([])
    })

    it('should return list of initialized store names', () => {
      const manager = new StoreManager(config)

      const _things = manager.things
      const _events = manager.events

      const initialized = manager.getInitializedStores()
      expect(initialized).toContain('things')
      expect(initialized).toContain('events')
      expect(initialized).not.toContain('rels')
      expect(initialized.length).toBe(2)
    })
  })
})
