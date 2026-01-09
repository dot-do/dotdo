/**
 * Feature Flag Persistence Tests (DO Storage)
 *
 * RED TDD: These tests exercise flag CRUD operations in DO SQLite storage.
 * Tests should FAIL initially as the FlagStore implementation does not exist yet.
 *
 * The FlagStore persists feature flags to DO SQLite via Drizzle, providing:
 * - Create: Insert new flag into storage
 * - Read: Get flag by ID
 * - Update: Modify flag properties (traffic, status, branches)
 * - Delete: Remove flag from storage
 * - List: Get all flags with optional filters
 *
 * Flags must survive DO "restarts" (new Drizzle instance with same underlying DB).
 *
 * Interface:
 * ```typescript
 * class FlagStore {
 *   constructor(db: DrizzleDB)
 *   create(flag: NewFlag): Promise<Flag>
 *   get(id: string): Promise<Flag | null>
 *   update(id: string, updates: Partial<Flag>): Promise<Flag>
 *   delete(id: string): Promise<boolean>
 *   list(options?: ListOptions): Promise<Flag[]>
 * }
 * ```
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

// ============================================================================
// FLAG SCHEMA (expected to be created in db/flags.ts)
// ============================================================================

/**
 * Schema for feature flags.
 * This mirrors the Flag interface from tests/flags/schema.test.ts.
 */
const flags = sqliteTable('flags', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  traffic: real('traffic').notNull(),
  stickiness: text('stickiness').notNull(), // 'user_id' | 'session_id' | 'random'
  status: text('status').notNull(), // 'active' | 'disabled'
  branches: text('branches', { mode: 'json' }).notNull(), // JSON array of Branch[]
  filters: text('filters', { mode: 'json' }), // JSON array of Filter[] (optional)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

type FlagSchema = {
  flags: typeof flags
}

// ============================================================================
// TYPE DEFINITIONS (expected interface from Flag type)
// ============================================================================

interface Branch {
  key: string
  weight: number
  payload?: Record<string, unknown>
}

interface Filter {
  type: 'property' | 'cohort'
  property?: string
  operator?: 'eq' | 'gt' | 'lt' | 'contains' | 'in'
  value?: unknown
  cohortId?: string
}

interface Flag {
  id: string
  key: string
  traffic: number
  stickiness: 'user_id' | 'session_id' | 'random'
  status: 'active' | 'disabled'
  branches: Branch[]
  filters?: Filter[]
  createdAt: Date
  updatedAt: Date
}

type NewFlag = Omit<Flag, 'createdAt' | 'updatedAt'>

interface ListOptions {
  status?: 'active' | 'disabled'
  limit?: number
  offset?: number
}

// ============================================================================
// FlagStore Import
// ============================================================================

import { FlagStore } from '../../lib/flags/store'

interface FlagStoreInstance {
  create(flag: NewFlag): Promise<Flag>
  get(id: string): Promise<Flag | null>
  update(id: string, updates: Partial<NewFlag>): Promise<Flag>
  delete(id: string): Promise<boolean>
  list(options?: ListOptions): Promise<Flag[]>
}

// ============================================================================
// TEST DATABASE SETUP
// ============================================================================

/**
 * Creates an in-memory SQLite database with Drizzle for testing.
 * This simulates the DO SQLite environment.
 */
function createTestDB(): { db: BetterSQLite3Database<FlagSchema>; sqlite: Database.Database } {
  const sqlite = new Database(':memory:')

  // Create the flags table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS flags (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      traffic REAL NOT NULL,
      stickiness TEXT NOT NULL,
      status TEXT NOT NULL,
      branches TEXT NOT NULL,
      filters TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  // Create indexes for common queries
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_flags_key ON flags(key)
  `)
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status)
  `)

  return {
    db: drizzle(sqlite, { schema: { flags } }) as BetterSQLite3Database<FlagSchema>,
    sqlite,
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a valid flag for testing
 */
function createValidFlag(overrides?: Partial<NewFlag>): NewFlag {
  return {
    id: 'flag-001',
    key: 'test-feature',
    traffic: 0.5,
    stickiness: 'user_id',
    status: 'active',
    branches: [
      { key: 'control', weight: 50 },
      { key: 'variant', weight: 50 },
    ],
    ...overrides,
  }
}

// ============================================================================
// TESTS: FLAGSTORE INITIALIZATION
// ============================================================================

describe('FlagStore', () => {
  let db: BetterSQLite3Database<FlagSchema>
  let sqlite: Database.Database
  let store: FlagStoreInstance

  beforeEach(() => {
    const testDb = createTestDB()
    db = testDb.db
    sqlite = testDb.sqlite
    // RED TDD: This will throw "FlagStore is not a constructor" until implemented
    store = new FlagStore(db)
  })

  afterEach(() => {
    sqlite.close()
  })

  // ==========================================================================
  // TESTS: CREATE FLAG
  // ==========================================================================

  describe('create', () => {
    it('creates a new flag in storage', async () => {
      const flagData = createValidFlag()

      const flag = await store.create(flagData)

      expect(flag).toBeDefined()
      expect(flag.id).toBe('flag-001')
      expect(flag.key).toBe('test-feature')
      expect(flag.traffic).toBe(0.5)
      expect(flag.status).toBe('active')
    })

    it('sets createdAt and updatedAt timestamps on create', async () => {
      const flagData = createValidFlag()

      const flag = await store.create(flagData)

      expect(flag.createdAt).toBeInstanceOf(Date)
      expect(flag.updatedAt).toBeInstanceOf(Date)
      expect(flag.createdAt.getTime()).toBeLessThanOrEqual(Date.now())
      expect(flag.updatedAt.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('stores branches correctly as JSON', async () => {
      const branches: Branch[] = [
        { key: 'control', weight: 50 },
        { key: 'variant-a', weight: 25, payload: { color: 'blue' } },
        { key: 'variant-b', weight: 25, payload: { color: 'green' } },
      ]
      const flagData = createValidFlag({ branches })

      const flag = await store.create(flagData)

      expect(flag.branches).toHaveLength(3)
      expect(flag.branches[0]).toEqual({ key: 'control', weight: 50 })
      expect(flag.branches[1]).toEqual({ key: 'variant-a', weight: 25, payload: { color: 'blue' } })
      expect(flag.branches[2]).toEqual({ key: 'variant-b', weight: 25, payload: { color: 'green' } })
    })

    it('stores filters correctly as JSON', async () => {
      const filters: Filter[] = [
        { type: 'property', property: 'country', operator: 'eq', value: 'US' },
        { type: 'cohort', cohortId: 'beta-users' },
      ]
      const flagData = createValidFlag({ filters })

      const flag = await store.create(flagData)

      expect(flag.filters).toHaveLength(2)
      expect(flag.filters![0]).toEqual({ type: 'property', property: 'country', operator: 'eq', value: 'US' })
      expect(flag.filters![1]).toEqual({ type: 'cohort', cohortId: 'beta-users' })
    })

    it('creates flag without filters (optional field)', async () => {
      const flagData = createValidFlag()
      delete (flagData as Partial<NewFlag>).filters

      const flag = await store.create(flagData)

      expect(flag.filters).toBeUndefined()
    })

    it('rejects duplicate flag ID', async () => {
      const flagData = createValidFlag()

      await store.create(flagData)

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('allows multiple flags with different IDs', async () => {
      const flag1 = createValidFlag({ id: 'flag-001', key: 'feature-1' })
      const flag2 = createValidFlag({ id: 'flag-002', key: 'feature-2' })
      const flag3 = createValidFlag({ id: 'flag-003', key: 'feature-3' })

      const created1 = await store.create(flag1)
      const created2 = await store.create(flag2)
      const created3 = await store.create(flag3)

      expect(created1.id).toBe('flag-001')
      expect(created2.id).toBe('flag-002')
      expect(created3.id).toBe('flag-003')
    })

    it('stores all stickiness values correctly', async () => {
      const stickinessValues: Array<'user_id' | 'session_id' | 'random'> = ['user_id', 'session_id', 'random']

      for (let i = 0; i < stickinessValues.length; i++) {
        const flagData = createValidFlag({
          id: `flag-stickiness-${i}`,
          stickiness: stickinessValues[i],
        })

        const flag = await store.create(flagData)
        expect(flag.stickiness).toBe(stickinessValues[i])
      }
    })

    it('stores all status values correctly', async () => {
      const statusValues: Array<'active' | 'disabled'> = ['active', 'disabled']

      for (let i = 0; i < statusValues.length; i++) {
        const flagData = createValidFlag({
          id: `flag-status-${i}`,
          status: statusValues[i],
        })

        const flag = await store.create(flagData)
        expect(flag.status).toBe(statusValues[i])
      }
    })

    it('stores traffic boundary values correctly', async () => {
      // Traffic = 0
      const flag0 = await store.create(createValidFlag({ id: 'flag-traffic-0', traffic: 0 }))
      expect(flag0.traffic).toBe(0)

      // Traffic = 1
      const flag1 = await store.create(createValidFlag({ id: 'flag-traffic-1', traffic: 1 }))
      expect(flag1.traffic).toBe(1)

      // Traffic = 0.001 (very small)
      const flagSmall = await store.create(createValidFlag({ id: 'flag-traffic-small', traffic: 0.001 }))
      expect(flagSmall.traffic).toBe(0.001)

      // Traffic = 0.999 (nearly 100%)
      const flagLarge = await store.create(createValidFlag({ id: 'flag-traffic-large', traffic: 0.999 }))
      expect(flagLarge.traffic).toBe(0.999)
    })
  })

  // ==========================================================================
  // TESTS: GET FLAG
  // ==========================================================================

  describe('get', () => {
    it('retrieves an existing flag by ID', async () => {
      const flagData = createValidFlag()
      await store.create(flagData)

      const flag = await store.get('flag-001')

      expect(flag).not.toBeNull()
      expect(flag!.id).toBe('flag-001')
      expect(flag!.key).toBe('test-feature')
      expect(flag!.traffic).toBe(0.5)
    })

    it('returns null for non-existent flag', async () => {
      const flag = await store.get('non-existent-flag')

      expect(flag).toBeNull()
    })

    it('retrieves flag with all fields intact', async () => {
      const flagData = createValidFlag({
        id: 'flag-full',
        key: 'full-feature',
        traffic: 0.75,
        stickiness: 'session_id',
        status: 'disabled',
        branches: [
          { key: 'control', weight: 70 },
          { key: 'variant', weight: 30, payload: { theme: 'dark' } },
        ],
        filters: [
          { type: 'property', property: 'plan', operator: 'eq', value: 'premium' },
        ],
      })
      await store.create(flagData)

      const flag = await store.get('flag-full')

      expect(flag).not.toBeNull()
      expect(flag!.key).toBe('full-feature')
      expect(flag!.traffic).toBe(0.75)
      expect(flag!.stickiness).toBe('session_id')
      expect(flag!.status).toBe('disabled')
      expect(flag!.branches).toEqual([
        { key: 'control', weight: 70 },
        { key: 'variant', weight: 30, payload: { theme: 'dark' } },
      ])
      expect(flag!.filters).toEqual([
        { type: 'property', property: 'plan', operator: 'eq', value: 'premium' },
      ])
    })

    it('retrieves flag with complex branch payloads', async () => {
      const complexPayload = {
        nested: { deep: { value: 'test' } },
        array: [1, 2, 3],
        boolean: true,
        number: 42,
      }
      const flagData = createValidFlag({
        id: 'flag-complex',
        branches: [{ key: 'variant', weight: 100, payload: complexPayload }],
      })
      await store.create(flagData)

      const flag = await store.get('flag-complex')

      expect(flag!.branches[0].payload).toEqual(complexPayload)
    })

    it('retrieves flag timestamps as Date objects', async () => {
      const flagData = createValidFlag()
      await store.create(flagData)

      const flag = await store.get('flag-001')

      expect(flag!.createdAt).toBeInstanceOf(Date)
      expect(flag!.updatedAt).toBeInstanceOf(Date)
    })
  })

  // ==========================================================================
  // TESTS: UPDATE FLAG
  // ==========================================================================

  describe('update', () => {
    it('updates flag traffic', async () => {
      const flagData = createValidFlag({ traffic: 0.5 })
      await store.create(flagData)

      const updated = await store.update('flag-001', { traffic: 0.75 })

      expect(updated.traffic).toBe(0.75)

      // Verify persisted
      const retrieved = await store.get('flag-001')
      expect(retrieved!.traffic).toBe(0.75)
    })

    it('updates flag status', async () => {
      const flagData = createValidFlag({ status: 'active' })
      await store.create(flagData)

      const updated = await store.update('flag-001', { status: 'disabled' })

      expect(updated.status).toBe('disabled')

      // Verify persisted
      const retrieved = await store.get('flag-001')
      expect(retrieved!.status).toBe('disabled')
    })

    it('updates flag branches', async () => {
      const flagData = createValidFlag({
        branches: [{ key: 'control', weight: 100 }],
      })
      await store.create(flagData)

      const newBranches: Branch[] = [
        { key: 'control', weight: 50 },
        { key: 'variant-a', weight: 25 },
        { key: 'variant-b', weight: 25 },
      ]
      const updated = await store.update('flag-001', { branches: newBranches })

      expect(updated.branches).toEqual(newBranches)

      // Verify persisted
      const retrieved = await store.get('flag-001')
      expect(retrieved!.branches).toEqual(newBranches)
    })

    it('updates flag stickiness', async () => {
      const flagData = createValidFlag({ stickiness: 'user_id' })
      await store.create(flagData)

      const updated = await store.update('flag-001', { stickiness: 'session_id' })

      expect(updated.stickiness).toBe('session_id')
    })

    it('updates flag filters', async () => {
      const flagData = createValidFlag()
      await store.create(flagData)

      const newFilters: Filter[] = [
        { type: 'cohort', cohortId: 'enterprise-users' },
      ]
      const updated = await store.update('flag-001', { filters: newFilters })

      expect(updated.filters).toEqual(newFilters)
    })

    it('updates flag key', async () => {
      const flagData = createValidFlag({ key: 'old-key' })
      await store.create(flagData)

      const updated = await store.update('flag-001', { key: 'new-key' })

      expect(updated.key).toBe('new-key')
    })

    it('updates multiple fields at once', async () => {
      const flagData = createValidFlag({
        traffic: 0.5,
        status: 'active',
        stickiness: 'user_id',
      })
      await store.create(flagData)

      const updated = await store.update('flag-001', {
        traffic: 0.9,
        status: 'disabled',
        stickiness: 'random',
      })

      expect(updated.traffic).toBe(0.9)
      expect(updated.status).toBe('disabled')
      expect(updated.stickiness).toBe('random')
    })

    it('updates updatedAt timestamp', async () => {
      const flagData = createValidFlag()
      const created = await store.create(flagData)
      const originalUpdatedAt = created.updatedAt

      // Wait for more than 1 second to ensure timestamp changes
      // SQLite timestamps have second-level precision
      await new Promise((resolve) => setTimeout(resolve, 1100))

      const updated = await store.update('flag-001', { traffic: 0.9 })

      expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
    })

    it('preserves createdAt timestamp on update', async () => {
      const flagData = createValidFlag()
      const created = await store.create(flagData)
      const originalCreatedAt = created.createdAt

      const updated = await store.update('flag-001', { traffic: 0.9 })

      expect(updated.createdAt.getTime()).toBe(originalCreatedAt.getTime())
    })

    it('throws error when updating non-existent flag', async () => {
      await expect(store.update('non-existent', { traffic: 0.5 })).rejects.toThrow()
    })

    it('preserves unchanged fields on partial update', async () => {
      const flagData = createValidFlag({
        key: 'test-feature',
        traffic: 0.5,
        status: 'active',
        stickiness: 'user_id',
        branches: [{ key: 'control', weight: 100 }],
      })
      await store.create(flagData)

      // Only update traffic
      const updated = await store.update('flag-001', { traffic: 0.9 })

      expect(updated.key).toBe('test-feature')
      expect(updated.status).toBe('active')
      expect(updated.stickiness).toBe('user_id')
      expect(updated.branches).toEqual([{ key: 'control', weight: 100 }])
    })
  })

  // ==========================================================================
  // TESTS: DELETE FLAG
  // ==========================================================================

  describe('delete', () => {
    it('deletes an existing flag', async () => {
      const flagData = createValidFlag()
      await store.create(flagData)

      const result = await store.delete('flag-001')

      expect(result).toBe(true)

      // Verify deleted
      const flag = await store.get('flag-001')
      expect(flag).toBeNull()
    })

    it('returns false when deleting non-existent flag', async () => {
      const result = await store.delete('non-existent')

      expect(result).toBe(false)
    })

    it('deletes only the specified flag', async () => {
      await store.create(createValidFlag({ id: 'flag-001' }))
      await store.create(createValidFlag({ id: 'flag-002' }))
      await store.create(createValidFlag({ id: 'flag-003' }))

      await store.delete('flag-002')

      expect(await store.get('flag-001')).not.toBeNull()
      expect(await store.get('flag-002')).toBeNull()
      expect(await store.get('flag-003')).not.toBeNull()
    })

    it('allows creating flag with same ID after deletion', async () => {
      const originalFlag = createValidFlag({ key: 'original-feature' })
      await store.create(originalFlag)
      await store.delete('flag-001')

      const newFlag = createValidFlag({ key: 'new-feature' })
      const created = await store.create(newFlag)

      expect(created.key).toBe('new-feature')
    })

    it('deletes flag with complex data', async () => {
      const flagData = createValidFlag({
        branches: [
          { key: 'a', weight: 25, payload: { deep: { nested: 'value' } } },
          { key: 'b', weight: 25, payload: { array: [1, 2, 3] } },
          { key: 'c', weight: 50 },
        ],
        filters: [
          { type: 'property', property: 'x', operator: 'in', value: ['a', 'b', 'c'] },
          { type: 'cohort', cohortId: 'test' },
        ],
      })
      await store.create(flagData)

      const result = await store.delete('flag-001')

      expect(result).toBe(true)
      expect(await store.get('flag-001')).toBeNull()
    })
  })

  // ==========================================================================
  // TESTS: LIST FLAGS
  // ==========================================================================

  describe('list', () => {
    it('returns empty array when no flags exist', async () => {
      const flags = await store.list()

      expect(flags).toEqual([])
    })

    it('returns all flags', async () => {
      await store.create(createValidFlag({ id: 'flag-001', key: 'feature-1' }))
      await store.create(createValidFlag({ id: 'flag-002', key: 'feature-2' }))
      await store.create(createValidFlag({ id: 'flag-003', key: 'feature-3' }))

      const flags = await store.list()

      expect(flags).toHaveLength(3)
      expect(flags.map((f) => f.id).sort()).toEqual(['flag-001', 'flag-002', 'flag-003'])
    })

    it('filters by status = active', async () => {
      await store.create(createValidFlag({ id: 'flag-001', status: 'active' }))
      await store.create(createValidFlag({ id: 'flag-002', status: 'disabled' }))
      await store.create(createValidFlag({ id: 'flag-003', status: 'active' }))

      const flags = await store.list({ status: 'active' })

      expect(flags).toHaveLength(2)
      expect(flags.every((f) => f.status === 'active')).toBe(true)
    })

    it('filters by status = disabled', async () => {
      await store.create(createValidFlag({ id: 'flag-001', status: 'active' }))
      await store.create(createValidFlag({ id: 'flag-002', status: 'disabled' }))
      await store.create(createValidFlag({ id: 'flag-003', status: 'disabled' }))

      const flags = await store.list({ status: 'disabled' })

      expect(flags).toHaveLength(2)
      expect(flags.every((f) => f.status === 'disabled')).toBe(true)
    })

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await store.create(createValidFlag({ id: `flag-${i.toString().padStart(3, '0')}` }))
      }

      const flags = await store.list({ limit: 5 })

      expect(flags).toHaveLength(5)
    })

    it('respects offset parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await store.create(createValidFlag({ id: `flag-${i.toString().padStart(3, '0')}` }))
      }

      const allFlags = await store.list()
      const offsetFlags = await store.list({ offset: 3 })

      expect(offsetFlags).toHaveLength(7)
      expect(offsetFlags[0].id).toBe(allFlags[3].id)
    })

    it('combines limit and offset for pagination', async () => {
      for (let i = 0; i < 10; i++) {
        await store.create(createValidFlag({ id: `flag-${i.toString().padStart(3, '0')}` }))
      }

      const page1 = await store.list({ limit: 3, offset: 0 })
      const page2 = await store.list({ limit: 3, offset: 3 })
      const page3 = await store.list({ limit: 3, offset: 6 })
      const page4 = await store.list({ limit: 3, offset: 9 })

      expect(page1).toHaveLength(3)
      expect(page2).toHaveLength(3)
      expect(page3).toHaveLength(3)
      expect(page4).toHaveLength(1)

      // Ensure no overlap
      const allIds = [...page1, ...page2, ...page3, ...page4].map((f) => f.id)
      expect(new Set(allIds).size).toBe(10)
    })

    it('combines status filter with pagination', async () => {
      for (let i = 0; i < 10; i++) {
        await store.create(createValidFlag({
          id: `flag-${i.toString().padStart(3, '0')}`,
          status: i % 2 === 0 ? 'active' : 'disabled',
        }))
      }

      const activeFlags = await store.list({ status: 'active', limit: 2 })

      expect(activeFlags).toHaveLength(2)
      expect(activeFlags.every((f) => f.status === 'active')).toBe(true)
    })

    it('returns flags with all fields populated', async () => {
      const flagData = createValidFlag({
        id: 'flag-full',
        key: 'full-feature',
        branches: [{ key: 'control', weight: 100, payload: { test: true } }],
        filters: [{ type: 'cohort', cohortId: 'test' }],
      })
      await store.create(flagData)

      const flags = await store.list()

      expect(flags[0].id).toBe('flag-full')
      expect(flags[0].key).toBe('full-feature')
      expect(flags[0].branches).toEqual([{ key: 'control', weight: 100, payload: { test: true } }])
      expect(flags[0].filters).toEqual([{ type: 'cohort', cohortId: 'test' }])
      expect(flags[0].createdAt).toBeInstanceOf(Date)
      expect(flags[0].updatedAt).toBeInstanceOf(Date)
    })
  })

  // ==========================================================================
  // TESTS: PERSISTENCE ACROSS RESTARTS
  // ==========================================================================

  describe('persistence across restarts', () => {
    it('flags survive DO restart (new Drizzle instance, same DB)', async () => {
      // Create flag with first store instance
      const flagData = createValidFlag({
        id: 'persistent-flag',
        key: 'persistent-feature',
        traffic: 0.75,
      })
      await store.create(flagData)

      // Simulate DO restart by creating new Drizzle instance with same SQLite DB
      const newDb = drizzle(sqlite, { schema: { flags } }) as BetterSQLite3Database<FlagSchema>
      const newStore = new FlagStore(newDb)

      // Verify flag persists
      const flag = await newStore.get('persistent-flag')

      expect(flag).not.toBeNull()
      expect(flag!.id).toBe('persistent-flag')
      expect(flag!.key).toBe('persistent-feature')
      expect(flag!.traffic).toBe(0.75)
    })

    it('updated flags persist across restarts', async () => {
      // Create and update flag
      await store.create(createValidFlag({ id: 'update-test', traffic: 0.5 }))
      await store.update('update-test', { traffic: 0.9 })

      // Simulate restart
      const newDb = drizzle(sqlite, { schema: { flags } }) as BetterSQLite3Database<FlagSchema>
      const newStore = new FlagStore(newDb)

      const flag = await newStore.get('update-test')

      expect(flag!.traffic).toBe(0.9)
    })

    it('deleted flags stay deleted across restarts', async () => {
      await store.create(createValidFlag({ id: 'delete-test' }))
      await store.delete('delete-test')

      // Simulate restart
      const newDb = drizzle(sqlite, { schema: { flags } }) as BetterSQLite3Database<FlagSchema>
      const newStore = new FlagStore(newDb)

      const flag = await newStore.get('delete-test')

      expect(flag).toBeNull()
    })

    it('complex flag data persists correctly', async () => {
      const complexFlag = createValidFlag({
        id: 'complex-test',
        branches: [
          {
            key: 'variant',
            weight: 100,
            payload: {
              nested: { deep: { value: 'test' } },
              array: [1, 2, 3],
              unicode: 'test-unicode',
            },
          },
        ],
        filters: [
          { type: 'property', property: 'country', operator: 'in', value: ['US', 'CA', 'UK'] },
          { type: 'cohort', cohortId: 'beta-testers' },
        ],
      })
      await store.create(complexFlag)

      // Simulate restart
      const newDb = drizzle(sqlite, { schema: { flags } }) as BetterSQLite3Database<FlagSchema>
      const newStore = new FlagStore(newDb)

      const flag = await newStore.get('complex-test')

      expect(flag!.branches[0].payload).toEqual({
        nested: { deep: { value: 'test' } },
        array: [1, 2, 3],
        unicode: 'test-unicode',
      })
      expect(flag!.filters).toEqual([
        { type: 'property', property: 'country', operator: 'in', value: ['US', 'CA', 'UK'] },
        { type: 'cohort', cohortId: 'beta-testers' },
      ])
    })

    it('timestamps persist correctly across restarts', async () => {
      await store.create(createValidFlag({ id: 'timestamp-test' }))
      const created = await store.get('timestamp-test')

      // Simulate restart
      const newDb = drizzle(sqlite, { schema: { flags } }) as BetterSQLite3Database<FlagSchema>
      const newStore = new FlagStore(newDb)

      const flag = await newStore.get('timestamp-test')

      expect(flag!.createdAt.getTime()).toBe(created!.createdAt.getTime())
      expect(flag!.updatedAt.getTime()).toBe(created!.updatedAt.getTime())
    })

    it('list works correctly after restart', async () => {
      await store.create(createValidFlag({ id: 'list-test-1' }))
      await store.create(createValidFlag({ id: 'list-test-2' }))
      await store.create(createValidFlag({ id: 'list-test-3' }))

      // Simulate restart
      const newDb = drizzle(sqlite, { schema: { flags } }) as BetterSQLite3Database<FlagSchema>
      const newStore = new FlagStore(newDb)

      const flagsList = await newStore.list()

      expect(flagsList).toHaveLength(3)
    })
  })

  // ==========================================================================
  // TESTS: VALIDATION ERRORS
  // ==========================================================================

  describe('validation errors', () => {
    it('rejects flag with empty id', async () => {
      const flagData = createValidFlag({ id: '' })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects flag with empty key', async () => {
      const flagData = createValidFlag({ key: '' })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects flag with traffic less than 0', async () => {
      const flagData = createValidFlag({ traffic: -0.1 })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects flag with traffic greater than 1', async () => {
      const flagData = createValidFlag({ traffic: 1.1 })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects flag with empty branches array', async () => {
      const flagData = createValidFlag({ branches: [] })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects flag with invalid stickiness value', async () => {
      const flagData = createValidFlag({
        // @ts-expect-error - Testing invalid stickiness
        stickiness: 'invalid',
      })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects flag with invalid status value', async () => {
      const flagData = createValidFlag({
        // @ts-expect-error - Testing invalid status
        status: 'invalid',
      })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects branch with missing key', async () => {
      const flagData = createValidFlag({
        branches: [
          // @ts-expect-error - Testing branch without key
          { weight: 100 },
        ],
      })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects branch with missing weight', async () => {
      const flagData = createValidFlag({
        branches: [
          // @ts-expect-error - Testing branch without weight
          { key: 'control' },
        ],
      })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects branch with negative weight', async () => {
      const flagData = createValidFlag({
        branches: [{ key: 'control', weight: -10 }],
      })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects filter with missing type', async () => {
      const flagData = createValidFlag({
        filters: [
          // @ts-expect-error - Testing filter without type
          { property: 'country', operator: 'eq', value: 'US' },
        ],
      })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects filter with invalid type', async () => {
      const flagData = createValidFlag({
        filters: [
          // @ts-expect-error - Testing invalid filter type
          { type: 'invalid', property: 'country', operator: 'eq', value: 'US' },
        ],
      })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects property filter with invalid operator', async () => {
      const flagData = createValidFlag({
        filters: [
          {
            type: 'property',
            property: 'country',
            // @ts-expect-error - Testing invalid operator
            operator: 'invalid',
            value: 'US',
          },
        ],
      })

      await expect(store.create(flagData)).rejects.toThrow()
    })

    it('rejects update with invalid traffic value', async () => {
      await store.create(createValidFlag())

      await expect(store.update('flag-001', { traffic: -0.5 })).rejects.toThrow()
      await expect(store.update('flag-001', { traffic: 1.5 })).rejects.toThrow()
    })

    it('rejects update with empty branches', async () => {
      await store.create(createValidFlag())

      await expect(store.update('flag-001', { branches: [] })).rejects.toThrow()
    })

    it('rejects update with invalid status', async () => {
      await store.create(createValidFlag())

      await expect(store.update('flag-001', {
        // @ts-expect-error - Testing invalid status
        status: 'invalid',
      })).rejects.toThrow()
    })

    it('rejects null/undefined for required fields', async () => {
      await expect(store.create({
        // @ts-expect-error - Testing null id
        id: null,
        key: 'test',
        traffic: 0.5,
        stickiness: 'user_id',
        status: 'active',
        branches: [{ key: 'control', weight: 100 }],
      })).rejects.toThrow()

      await expect(store.create({
        id: 'test',
        // @ts-expect-error - Testing undefined key
        key: undefined,
        traffic: 0.5,
        stickiness: 'user_id',
        status: 'active',
        branches: [{ key: 'control', weight: 100 }],
      })).rejects.toThrow()
    })
  })

  // ==========================================================================
  // TESTS: EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles flag ID with special characters', async () => {
      const flagData = createValidFlag({ id: 'flag:special/chars.test_123' })

      const created = await store.create(flagData)
      const retrieved = await store.get('flag:special/chars.test_123')

      expect(created.id).toBe('flag:special/chars.test_123')
      expect(retrieved).not.toBeNull()
    })

    it('handles flag key with unicode characters', async () => {
      const flagData = createValidFlag({ key: 'feature-test-unicode' })

      const created = await store.create(flagData)

      expect(created.key).toBe('feature-test-unicode')
    })

    it('handles very long flag ID', async () => {
      const longId = 'flag-' + 'a'.repeat(1000)
      const flagData = createValidFlag({ id: longId })

      const created = await store.create(flagData)
      const retrieved = await store.get(longId)

      expect(created.id).toBe(longId)
      expect(retrieved).not.toBeNull()
    })

    it('handles many branches', async () => {
      const branches: Branch[] = []
      for (let i = 0; i < 100; i++) {
        branches.push({ key: `variant-${i}`, weight: 1 })
      }
      const flagData = createValidFlag({ branches })

      const created = await store.create(flagData)

      expect(created.branches).toHaveLength(100)
    })

    it('handles many filters', async () => {
      const filters: Filter[] = []
      for (let i = 0; i < 50; i++) {
        filters.push({ type: 'property', property: `prop-${i}`, operator: 'eq', value: `value-${i}` })
      }
      const flagData = createValidFlag({ filters })

      const created = await store.create(flagData)

      expect(created.filters).toHaveLength(50)
    })

    it('handles concurrent creates', async () => {
      const createPromises = Array.from({ length: 10 }, (_, i) =>
        store.create(createValidFlag({ id: `concurrent-${i}` }))
      )

      const results = await Promise.all(createPromises)

      expect(results).toHaveLength(10)
      expect(new Set(results.map((r) => r.id)).size).toBe(10)
    })

    it('handles concurrent updates to different flags', async () => {
      // Create flags first
      for (let i = 0; i < 10; i++) {
        await store.create(createValidFlag({ id: `update-concurrent-${i}`, traffic: 0.5 }))
      }

      // Update all concurrently
      const updatePromises = Array.from({ length: 10 }, (_, i) =>
        store.update(`update-concurrent-${i}`, { traffic: 0.5 + i * 0.05 })
      )

      const results = await Promise.all(updatePromises)

      expect(results).toHaveLength(10)
      for (let i = 0; i < 10; i++) {
        expect(results[i].traffic).toBeCloseTo(0.5 + i * 0.05)
      }
    })

    it('handles branch payload with circular-like structure (no actual circular refs)', async () => {
      const payload = {
        self: { ref: 'self' },
        parent: { child: { grandchild: 'value' } },
      }
      const flagData = createValidFlag({
        branches: [{ key: 'variant', weight: 100, payload }],
      })

      const created = await store.create(flagData)

      expect(created.branches[0].payload).toEqual(payload)
    })

    it('handles empty string values in payload', async () => {
      const flagData = createValidFlag({
        branches: [{ key: 'variant', weight: 100, payload: { empty: '', spaces: '   ' } }],
      })

      const created = await store.create(flagData)

      expect(created.branches[0].payload).toEqual({ empty: '', spaces: '   ' })
    })

    it('handles null values in payload', async () => {
      const flagData = createValidFlag({
        branches: [{ key: 'variant', weight: 100, payload: { nullable: null } as Record<string, unknown> }],
      })

      const created = await store.create(flagData)

      expect(created.branches[0].payload).toEqual({ nullable: null })
    })
  })
})
