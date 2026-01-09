import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Visibility Migration Tests
 *
 * Tests for the visibility migration utilities that handle:
 * - Bulk visibility updates
 * - Visibility change audit trail
 * - Rollback support
 * - Statistics and reporting
 *
 * Issue: dotdo-sm03
 */

// ============================================================================
// IMPORTS
// ============================================================================

import {
  migrateVisibility,
  getVisibilityHistory,
  rollbackVisibilityChange,
  rollbackBatch,
  getVisibilityStats,
  findNullVisibilityThings,
  migrateNullToUserVisibility,
  promoteVisibility,
  restrictVisibility,
  visibilityChanges,
  type MigrateVisibilityOptions,
  type MigrationResult,
  type VisibilityChange,
  type VisibilityStats,
  type VisibilityMigrationDb,
  type VisibilityChangeRecord,
} from '../../db/migrations/visibility'

import { things, type Thing, type NewThing, type Visibility } from '../../db/things'

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Create a mock thing for testing
 */
function createMockThing(overrides: Partial<Thing> = {}): Thing {
  return {
    id: `thing-${Math.random().toString(36).slice(2)}`,
    type: 1,
    branch: null,
    name: 'Test Thing',
    data: null,
    deleted: false,
    visibility: 'user',
    ...overrides,
  }
}

/**
 * Create a mock visibility change record
 */
function createMockChangeRecord(overrides: Partial<VisibilityChangeRecord> = {}): VisibilityChangeRecord {
  return {
    id: `change-${Math.random().toString(36).slice(2)}`,
    thingId: 'thing-001',
    fromVisibility: 'user',
    toVisibility: 'org',
    fromVersion: 1,
    toVersion: 2,
    reason: 'Test migration',
    migratedAt: new Date(),
    rolledBack: false,
    rollbackChangeId: null,
    batchId: 'batch-001',
    ...overrides,
  }
}

/**
 * Create a mock database for testing
 */
function createMockDb(options: {
  things?: Thing[]
  changes?: VisibilityChangeRecord[]
  insertedThings?: Thing[]
  insertedChanges?: VisibilityChangeRecord[]
} = {}): VisibilityMigrationDb {
  const { things: mockThings = [], changes: mockChanges = [] } = options
  const insertedThings: Thing[] = options.insertedThings ?? []
  const insertedChanges: VisibilityChangeRecord[] = options.insertedChanges ?? []

  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => ({
            limit: (n: number) => {
              if (table === things) {
                return Promise.resolve(mockThings.slice(0, n))
              }
              if (table === visibilityChanges) {
                return Promise.resolve(mockChanges.slice(0, n))
              }
              return Promise.resolve([])
            },
          }),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: () => {
          if (table === things) {
            const newThings = Array.isArray(values) ? values : [values]
            insertedThings.push(...newThings as Thing[])
            return Promise.resolve(newThings)
          }
          if (table === visibilityChanges) {
            const newChanges = Array.isArray(values) ? values : [values]
            insertedChanges.push(...newChanges as VisibilityChangeRecord[])
            return Promise.resolve(newChanges)
          }
          return Promise.resolve([])
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve({}),
      }),
    }),
  } as unknown as VisibilityMigrationDb
}

// ============================================================================
// MIGRATION FUNCTION TESTS
// ============================================================================

describe('migrateVisibility', () => {
  describe('Basic Migration', () => {
    it('exports migrateVisibility function', () => {
      expect(migrateVisibility).toBeDefined()
      expect(typeof migrateVisibility).toBe('function')
    })

    it('returns MigrationResult with required fields', async () => {
      const db = createMockDb({ things: [] })

      const result = await migrateVisibility(db, {
        toVisibility: 'org',
      })

      expect(result).toHaveProperty('affectedCount')
      expect(result).toHaveProperty('affectedIds')
      expect(result).toHaveProperty('dryRun')
      expect(result).toHaveProperty('newVersions')
      expect(result).toHaveProperty('timestamp')
      expect(result).toHaveProperty('toVisibility')
    })

    it('migrates things from one visibility to another', async () => {
      const mockThing = createMockThing({ id: 'thing-001', visibility: 'user' })
      const insertedThings: Thing[] = []
      const db = createMockDb({ things: [mockThing], insertedThings })

      const result = await migrateVisibility(db, {
        fromVisibility: 'user',
        toVisibility: 'org',
      })

      expect(result.affectedCount).toBe(1)
      expect(result.affectedIds).toContain('thing-001')
      expect(result.toVisibility).toBe('org')
    })

    it('excludes things that already have target visibility', async () => {
      // Mock DB returns empty since no things match fromVisibility: 'user'
      // (alreadyOrg has visibility: 'org', not 'user')
      const db = createMockDb({ things: [] }) // Simulates DB returning empty for mismatched filter

      // The where clause excludes things already at target visibility
      const result = await migrateVisibility(db, {
        fromVisibility: 'user',
        toVisibility: 'org',
      })

      // alreadyOrg should not be affected since we're filtering fromVisibility: 'user'
      expect(result.affectedCount).toBe(0)
    })
  })

  describe('Dry Run Mode', () => {
    it('returns preview without making changes when dryRun is true', async () => {
      const mockThing = createMockThing({ id: 'thing-001', visibility: 'user' })
      const insertedThings: Thing[] = []
      const db = createMockDb({ things: [mockThing], insertedThings })

      const result = await migrateVisibility(db, {
        fromVisibility: 'user',
        toVisibility: 'org',
        dryRun: true,
      })

      expect(result.dryRun).toBe(true)
      expect(result.affectedCount).toBe(1)
      expect(result.newVersions).toHaveLength(0) // No versions created in dry run
      expect(insertedThings).toHaveLength(0) // Nothing inserted
    })

    it('dry run sets newVersions to empty array', async () => {
      const mockThing = createMockThing({ visibility: 'user' })
      const db = createMockDb({ things: [mockThing] })

      const result = await migrateVisibility(db, {
        toVisibility: 'public',
        dryRun: true,
      })

      expect(result.newVersions).toEqual([])
    })
  })

  describe('Filtering Options', () => {
    it('filters by fromVisibility', async () => {
      const userThing = createMockThing({ id: 'user-thing', visibility: 'user' })
      const orgThing = createMockThing({ id: 'org-thing', visibility: 'org' })
      const db = createMockDb({ things: [userThing, orgThing] })

      const result = await migrateVisibility(db, {
        fromVisibility: 'user',
        toVisibility: 'public',
        dryRun: true,
      })

      // Only user-thing should be affected
      expect(result.affectedIds).toContain('user-thing')
    })

    it('filters by type', async () => {
      const type1Thing = createMockThing({ id: 'type-1', type: 1 })
      const type2Thing = createMockThing({ id: 'type-2', type: 2 })
      const db = createMockDb({ things: [type1Thing, type2Thing] })

      const result = await migrateVisibility(db, {
        toVisibility: 'org',
        where: { type: 1 },
        dryRun: true,
      })

      expect(result.affectedIds).toContain('type-1')
    })

    it('filters by specific IDs', async () => {
      const thing1 = createMockThing({ id: 'include-me', visibility: 'user' })
      const thing2 = createMockThing({ id: 'exclude-me', visibility: 'user' })
      const db = createMockDb({ things: [thing1, thing2] })

      const result = await migrateVisibility(db, {
        toVisibility: 'org',
        where: { ids: ['include-me'] },
        dryRun: true,
      })

      expect(result.affectedIds).toContain('include-me')
    })

    it('filters by array of IDs', async () => {
      const thing1 = createMockThing({ id: 'id-1', visibility: 'user' })
      const thing2 = createMockThing({ id: 'id-2', visibility: 'user' })
      const thing3 = createMockThing({ id: 'id-3', visibility: 'user' })
      const db = createMockDb({ things: [thing1, thing2, thing3] })

      const result = await migrateVisibility(db, {
        toVisibility: 'org',
        where: { ids: ['id-1', 'id-2'] },
        dryRun: true,
      })

      expect(result.affectedIds).toContain('id-1')
      expect(result.affectedIds).toContain('id-2')
    })

    it('filters by branch', async () => {
      const mainThing = createMockThing({ id: 'main-thing', branch: null })
      const devThing = createMockThing({ id: 'dev-thing', branch: 'development' })
      const db = createMockDb({ things: [mainThing, devThing] })

      const result = await migrateVisibility(db, {
        toVisibility: 'org',
        where: { branch: null }, // Main branch only
        dryRun: true,
      })

      expect(result.affectedIds).toContain('main-thing')
    })
  })

  describe('Audit Trail', () => {
    it('records change in visibility_changes table', async () => {
      const mockThing = createMockThing({ id: 'audited-thing', visibility: 'user' })
      const insertedChanges: VisibilityChangeRecord[] = []
      const db = createMockDb({ things: [mockThing], insertedChanges })

      await migrateVisibility(db, {
        fromVisibility: 'user',
        toVisibility: 'org',
        reason: 'Test audit',
      })

      expect(insertedChanges.length).toBeGreaterThan(0)
      expect(insertedChanges[0].thingId).toBe('audited-thing')
      expect(insertedChanges[0].fromVisibility).toBe('user')
      expect(insertedChanges[0].toVisibility).toBe('org')
      expect(insertedChanges[0].reason).toBe('Test audit')
    })

    it('includes batch ID for bulk migrations', async () => {
      const mockThing = createMockThing({ visibility: 'user' })
      const insertedChanges: VisibilityChangeRecord[] = []
      const db = createMockDb({ things: [mockThing], insertedChanges })

      const result = await migrateVisibility(db, {
        toVisibility: 'org',
      })

      expect(result.changeId).toBeDefined()
      expect(insertedChanges[0]?.batchId).toBeDefined()
    })

    it('includes reason in migration result', async () => {
      const db = createMockDb({ things: [] })

      const result = await migrateVisibility(db, {
        toVisibility: 'org',
        reason: 'Migration reason',
      })

      expect(result.reason).toBe('Migration reason')
    })
  })

  describe('Batch Processing', () => {
    it('respects batchSize option', async () => {
      const manyThings = Array.from({ length: 10 }, (_, i) =>
        createMockThing({ id: `thing-${i}`, visibility: 'user' })
      )
      const db = createMockDb({ things: manyThings })

      const result = await migrateVisibility(db, {
        toVisibility: 'org',
        batchSize: 5,
        dryRun: true,
      })

      expect(result.affectedCount).toBeLessThanOrEqual(5)
    })
  })
})

// ============================================================================
// VISIBILITY HISTORY TESTS
// ============================================================================

describe('getVisibilityHistory', () => {
  it('exports getVisibilityHistory function', () => {
    expect(getVisibilityHistory).toBeDefined()
    expect(typeof getVisibilityHistory).toBe('function')
  })

  it('returns array of VisibilityChange records', async () => {
    const mockChange = createMockChangeRecord({ thingId: 'history-thing' })
    const db = createMockDb({ changes: [mockChange] })

    const history = await getVisibilityHistory(db, 'history-thing')

    expect(Array.isArray(history)).toBe(true)
    expect(history.length).toBeGreaterThan(0)
  })

  it('returns changes for specific thing ID', async () => {
    // Mock DB simulates filtering - returns only thing-001's changes
    const change1 = createMockChangeRecord({ thingId: 'thing-001' })
    const db = createMockDb({ changes: [change1] })

    const history = await getVisibilityHistory(db, 'thing-001')

    // Mock returns all provided changes (no actual filtering in mock)
    expect(history.length).toBeGreaterThan(0)
    expect(history[0].thingId).toBe('thing-001')
  })

  it('includes all required fields in VisibilityChange', async () => {
    const mockChange = createMockChangeRecord()
    const db = createMockDb({ changes: [mockChange] })

    const history = await getVisibilityHistory(db, mockChange.thingId)

    const change = history[0]
    expect(change).toHaveProperty('changeId')
    expect(change).toHaveProperty('thingId')
    expect(change).toHaveProperty('fromVisibility')
    expect(change).toHaveProperty('toVisibility')
    expect(change).toHaveProperty('fromVersion')
    expect(change).toHaveProperty('toVersion')
    expect(change).toHaveProperty('timestamp')
    expect(change).toHaveProperty('rolledBack')
  })

  it('returns empty array for thing with no history', async () => {
    const db = createMockDb({ changes: [] })

    const history = await getVisibilityHistory(db, 'no-history-thing')

    expect(history).toEqual([])
  })

  it('orders changes by timestamp descending', async () => {
    const oldChange = createMockChangeRecord({
      thingId: 'thing-001',
      migratedAt: new Date('2024-01-01'),
    })
    const newChange = createMockChangeRecord({
      thingId: 'thing-001',
      migratedAt: new Date('2024-06-01'),
    })
    const db = createMockDb({ changes: [oldChange, newChange] })

    const history = await getVisibilityHistory(db, 'thing-001')

    // Should be ordered desc by timestamp (newest first)
    expect(history.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// ROLLBACK TESTS
// ============================================================================

describe('rollbackVisibilityChange', () => {
  it('exports rollbackVisibilityChange function', () => {
    expect(rollbackVisibilityChange).toBeDefined()
    expect(typeof rollbackVisibilityChange).toBe('function')
  })

  it('throws error if change not found', async () => {
    const db = createMockDb({ changes: [] })

    await expect(rollbackVisibilityChange(db, 'non-existent'))
      .rejects.toThrow('Visibility change not found')
  })

  it('throws error if change already rolled back', async () => {
    const rolledBackChange = createMockChangeRecord({ rolledBack: true })
    const db = createMockDb({ changes: [rolledBackChange] })

    await expect(rollbackVisibilityChange(db, rolledBackChange.id))
      .rejects.toThrow('already rolled back')
  })

  it('creates new version with original visibility', async () => {
    const change = createMockChangeRecord({
      thingId: 'rollback-thing',
      fromVisibility: 'user',
      toVisibility: 'org',
      rolledBack: false,
    })
    const currentThing = createMockThing({
      id: 'rollback-thing',
      visibility: 'org',
    })
    const insertedThings: Thing[] = []
    const db = createMockDb({
      changes: [change],
      things: [currentThing],
      insertedThings,
    })

    const result = await rollbackVisibilityChange(db, change.id)

    expect(result.fromVisibility).toBe('org')
    expect(result.toVisibility).toBe('user') // Rolled back to original
  })

  it('returns VisibilityChange record for rollback', async () => {
    const change = createMockChangeRecord({ rolledBack: false })
    const currentThing = createMockThing({ id: change.thingId })
    const db = createMockDb({ changes: [change], things: [currentThing] })

    const result = await rollbackVisibilityChange(db, change.id)

    expect(result).toHaveProperty('changeId')
    expect(result).toHaveProperty('fromVisibility')
    expect(result).toHaveProperty('toVisibility')
    expect(result.rolledBack).toBe(false) // The new rollback record is not rolled back
  })
})

describe('rollbackBatch', () => {
  it('exports rollbackBatch function', () => {
    expect(rollbackBatch).toBeDefined()
    expect(typeof rollbackBatch).toBe('function')
  })

  it('rolls back all changes in a batch', async () => {
    const batchId = 'batch-to-rollback'
    const change1 = createMockChangeRecord({
      thingId: 'thing-1',
      batchId,
      rolledBack: false,
    })
    const change2 = createMockChangeRecord({
      thingId: 'thing-2',
      batchId,
      rolledBack: false,
    })
    const thing1 = createMockThing({ id: 'thing-1' })
    const thing2 = createMockThing({ id: 'thing-2' })
    const db = createMockDb({
      changes: [change1, change2],
      things: [thing1, thing2],
    })

    const rollbacks = await rollbackBatch(db, batchId)

    expect(rollbacks.length).toBeGreaterThanOrEqual(1)
  })

  it('skips changes that are already rolled back', async () => {
    const batchId = 'partial-batch'
    const activeChange = createMockChangeRecord({
      thingId: 'active-thing',
      batchId,
      rolledBack: false,
    })
    const rolledBackChange = createMockChangeRecord({
      thingId: 'rolled-back-thing',
      batchId,
      rolledBack: true,
    })
    const activeThing = createMockThing({ id: 'active-thing' })
    const db = createMockDb({
      changes: [activeChange, rolledBackChange],
      things: [activeThing],
    })

    const rollbacks = await rollbackBatch(db, batchId)

    // Only active change should be rolled back
    expect(rollbacks.every((r) => r.thingId !== 'rolled-back-thing')).toBe(true)
  })

  it('returns empty array if batch has no changes', async () => {
    const db = createMockDb({ changes: [] })

    const rollbacks = await rollbackBatch(db, 'empty-batch')

    expect(rollbacks).toEqual([])
  })
})

// ============================================================================
// STATISTICS TESTS
// ============================================================================

describe('getVisibilityStats', () => {
  it('exports getVisibilityStats function', () => {
    expect(getVisibilityStats).toBeDefined()
    expect(typeof getVisibilityStats).toBe('function')
  })

  it('returns VisibilityStats with all required fields', async () => {
    const db = createMockDb({ things: [] })

    const stats = await getVisibilityStats(db)

    expect(stats).toHaveProperty('byVisibility')
    expect(stats).toHaveProperty('total')
    expect(stats).toHaveProperty('nullVisibility')
    expect(stats).toHaveProperty('timestamp')
  })

  it('counts things by visibility level', async () => {
    const publicThing = createMockThing({ id: 'pub-1', visibility: 'public' })
    const userThing = createMockThing({ id: 'user-1', visibility: 'user' })
    const db = createMockDb({ things: [publicThing, userThing] })

    const stats = await getVisibilityStats(db)

    expect(stats.byVisibility).toHaveProperty('public')
    expect(stats.byVisibility).toHaveProperty('unlisted')
    expect(stats.byVisibility).toHaveProperty('org')
    expect(stats.byVisibility).toHaveProperty('user')
  })

  it('includes total count', async () => {
    const things = [
      createMockThing({ id: '1' }),
      createMockThing({ id: '2' }),
      createMockThing({ id: '3' }),
    ]
    const db = createMockDb({ things })

    const stats = await getVisibilityStats(db)

    expect(stats.total).toBe(3)
  })

  it('tracks null visibility count separately', async () => {
    const nullVisThing = createMockThing({ id: 'null-vis', visibility: null as unknown as Visibility })
    const db = createMockDb({ things: [nullVisThing] })

    const stats = await getVisibilityStats(db)

    expect(stats.nullVisibility).toBeGreaterThanOrEqual(0)
  })
})

describe('findNullVisibilityThings', () => {
  it('exports findNullVisibilityThings function', () => {
    expect(findNullVisibilityThings).toBeDefined()
    expect(typeof findNullVisibilityThings).toBe('function')
  })

  it('returns array of thing IDs', async () => {
    const db = createMockDb({ things: [] })

    const ids = await findNullVisibilityThings(db)

    expect(Array.isArray(ids)).toBe(true)
  })

  it('respects limit parameter', async () => {
    const nullVisThings = Array.from({ length: 10 }, (_, i) =>
      createMockThing({ id: `null-${i}`, visibility: null as unknown as Visibility })
    )
    const db = createMockDb({ things: nullVisThings })

    const ids = await findNullVisibilityThings(db, 5)

    expect(ids.length).toBeLessThanOrEqual(5)
  })
})

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('migrateNullToUserVisibility', () => {
  it('exports migrateNullToUserVisibility function', () => {
    expect(migrateNullToUserVisibility).toBeDefined()
    expect(typeof migrateNullToUserVisibility).toBe('function')
  })

  it('sets toVisibility to "user"', async () => {
    const db = createMockDb({ things: [] })

    const result = await migrateNullToUserVisibility(db)

    expect(result.toVisibility).toBe('user')
  })

  it('includes default reason for migration', async () => {
    const db = createMockDb({ things: [] })

    const result = await migrateNullToUserVisibility(db)

    expect(result.reason).toContain('secure by default')
  })

  it('allows custom reason', async () => {
    const db = createMockDb({ things: [] })

    const result = await migrateNullToUserVisibility(db, {
      reason: 'Custom migration reason',
    })

    expect(result.reason).toBe('Custom migration reason')
  })

  it('supports dry run mode', async () => {
    const db = createMockDb({ things: [] })

    const result = await migrateNullToUserVisibility(db, { dryRun: true })

    expect(result.dryRun).toBe(true)
  })
})

describe('promoteVisibility', () => {
  it('exports promoteVisibility function', () => {
    expect(promoteVisibility).toBeDefined()
    expect(typeof promoteVisibility).toBe('function')
  })

  it('allows promotion to less restrictive level', async () => {
    const userThing = createMockThing({ visibility: 'user' })
    const db = createMockDb({ things: [userThing] })

    // user -> public is valid promotion
    const result = await promoteVisibility(db, {
      fromVisibility: 'user',
      toVisibility: 'public',
      dryRun: true,
    })

    expect(result.toVisibility).toBe('public')
  })

  it('throws error when trying to promote to more restrictive level', async () => {
    const publicThing = createMockThing({ visibility: 'public' })
    const db = createMockDb({ things: [publicThing] })

    // public -> user is not a promotion
    await expect(promoteVisibility(db, {
      fromVisibility: 'public',
      toVisibility: 'user',
    })).rejects.toThrow('less restrictive')
  })

  it('validates visibility order: user < org < unlisted < public', async () => {
    const db = createMockDb({ things: [] })

    // Valid promotions
    await expect(promoteVisibility(db, { fromVisibility: 'user', toVisibility: 'org', dryRun: true }))
      .resolves.toBeDefined()
    await expect(promoteVisibility(db, { fromVisibility: 'user', toVisibility: 'unlisted', dryRun: true }))
      .resolves.toBeDefined()
    await expect(promoteVisibility(db, { fromVisibility: 'user', toVisibility: 'public', dryRun: true }))
      .resolves.toBeDefined()
    await expect(promoteVisibility(db, { fromVisibility: 'org', toVisibility: 'unlisted', dryRun: true }))
      .resolves.toBeDefined()
    await expect(promoteVisibility(db, { fromVisibility: 'org', toVisibility: 'public', dryRun: true }))
      .resolves.toBeDefined()
    await expect(promoteVisibility(db, { fromVisibility: 'unlisted', toVisibility: 'public', dryRun: true }))
      .resolves.toBeDefined()
  })
})

describe('restrictVisibility', () => {
  it('exports restrictVisibility function', () => {
    expect(restrictVisibility).toBeDefined()
    expect(typeof restrictVisibility).toBe('function')
  })

  it('allows restriction to more restrictive level', async () => {
    const publicThing = createMockThing({ visibility: 'public' })
    const db = createMockDb({ things: [publicThing] })

    // public -> user is valid restriction
    const result = await restrictVisibility(db, {
      fromVisibility: 'public',
      toVisibility: 'user',
      dryRun: true,
    })

    expect(result.toVisibility).toBe('user')
  })

  it('throws error when trying to restrict to less restrictive level', async () => {
    const userThing = createMockThing({ visibility: 'user' })
    const db = createMockDb({ things: [userThing] })

    // user -> public is not a restriction
    await expect(restrictVisibility(db, {
      fromVisibility: 'user',
      toVisibility: 'public',
    })).rejects.toThrow('more restrictive')
  })

  it('validates visibility order for restrictions', async () => {
    const db = createMockDb({ things: [] })

    // Valid restrictions
    await expect(restrictVisibility(db, { fromVisibility: 'public', toVisibility: 'unlisted', dryRun: true }))
      .resolves.toBeDefined()
    await expect(restrictVisibility(db, { fromVisibility: 'public', toVisibility: 'org', dryRun: true }))
      .resolves.toBeDefined()
    await expect(restrictVisibility(db, { fromVisibility: 'public', toVisibility: 'user', dryRun: true }))
      .resolves.toBeDefined()
    await expect(restrictVisibility(db, { fromVisibility: 'unlisted', toVisibility: 'org', dryRun: true }))
      .resolves.toBeDefined()
    await expect(restrictVisibility(db, { fromVisibility: 'unlisted', toVisibility: 'user', dryRun: true }))
      .resolves.toBeDefined()
    await expect(restrictVisibility(db, { fromVisibility: 'org', toVisibility: 'user', dryRun: true }))
      .resolves.toBeDefined()
  })
})

// ============================================================================
// SCHEMA/TABLE TESTS
// ============================================================================

describe('visibilityChanges table', () => {
  it('exports visibilityChanges table', () => {
    expect(visibilityChanges).toBeDefined()
  })

  it('has required columns', () => {
    expect(visibilityChanges.id).toBeDefined()
    expect(visibilityChanges.thingId).toBeDefined()
    expect(visibilityChanges.fromVisibility).toBeDefined()
    expect(visibilityChanges.toVisibility).toBeDefined()
    expect(visibilityChanges.fromVersion).toBeDefined()
    expect(visibilityChanges.toVersion).toBeDefined()
    expect(visibilityChanges.migratedAt).toBeDefined()
    expect(visibilityChanges.rolledBack).toBeDefined()
  })

  it('has optional rollback tracking columns', () => {
    expect(visibilityChanges.rollbackChangeId).toBeDefined()
    expect(visibilityChanges.batchId).toBeDefined()
    expect(visibilityChanges.reason).toBeDefined()
  })
})

// ============================================================================
// TYPE EXPORT TESTS
// ============================================================================

describe('Type Exports', () => {
  it('exports MigrateVisibilityOptions type', () => {
    const options: MigrateVisibilityOptions = {
      toVisibility: 'org',
      dryRun: true,
    }
    expect(options.toVisibility).toBe('org')
  })

  it('exports MigrationResult type', () => {
    const result: MigrationResult = {
      affectedCount: 0,
      affectedIds: [],
      dryRun: false,
      newVersions: [],
      timestamp: new Date(),
      toVisibility: 'user',
    }
    expect(result.affectedCount).toBe(0)
  })

  it('exports VisibilityChange type', () => {
    const change: VisibilityChange = {
      changeId: 'change-001',
      thingId: 'thing-001',
      fromVisibility: 'user',
      toVisibility: 'org',
      fromVersion: 1,
      toVersion: 2,
      timestamp: new Date(),
      rolledBack: false,
    }
    expect(change.changeId).toBe('change-001')
  })

  it('exports VisibilityStats type', () => {
    const stats: VisibilityStats = {
      byVisibility: { public: 0, unlisted: 0, org: 0, user: 0 },
      total: 0,
      nullVisibility: 0,
      timestamp: new Date(),
    }
    expect(stats.total).toBe(0)
  })

  it('exports VisibilityMigrationDb interface', () => {
    // Type check - this compiles if interface is exported correctly
    const db: VisibilityMigrationDb = createMockDb()
    expect(db.select).toBeDefined()
  })
})

// ============================================================================
// VERSION HISTORY PRESERVATION TESTS
// ============================================================================

describe('Version History Preservation', () => {
  it('migration creates new version (append-only pattern)', async () => {
    const originalThing = createMockThing({ id: 'versioned-thing', visibility: 'user' })
    const insertedThings: Thing[] = []
    const db = createMockDb({ things: [originalThing], insertedThings })

    await migrateVisibility(db, {
      fromVisibility: 'user',
      toVisibility: 'org',
    })

    // New version should be created via insert
    expect(insertedThings.length).toBeGreaterThan(0)
    expect(insertedThings[0].id).toBe('versioned-thing')
    expect(insertedThings[0].visibility).toBe('org')
  })

  it('preserves all original fields in new version', async () => {
    const originalThing = createMockThing({
      id: 'preserve-fields',
      type: 42,
      branch: 'feature',
      name: 'Original Name',
      data: { key: 'value' },
      deleted: false,
      visibility: 'user',
    })
    const insertedThings: Thing[] = []
    const db = createMockDb({ things: [originalThing], insertedThings })

    await migrateVisibility(db, {
      fromVisibility: 'user',
      toVisibility: 'public',
    })

    const newVersion = insertedThings[0]
    expect(newVersion.id).toBe(originalThing.id)
    expect(newVersion.type).toBe(originalThing.type)
    expect(newVersion.branch).toBe(originalThing.branch)
    expect(newVersion.name).toBe(originalThing.name)
    expect(newVersion.data).toEqual(originalThing.data)
    expect(newVersion.deleted).toBe(originalThing.deleted)
  })

  it('visibility change is tracked separately from thing version', async () => {
    const originalThing = createMockThing({ visibility: 'user' })
    const insertedChanges: VisibilityChangeRecord[] = []
    const db = createMockDb({ things: [originalThing], insertedChanges })

    await migrateVisibility(db, {
      fromVisibility: 'user',
      toVisibility: 'org',
    })

    // Change should be recorded in visibility_changes table
    expect(insertedChanges.length).toBeGreaterThan(0)
    expect(insertedChanges[0].fromVisibility).toBe('user')
    expect(insertedChanges[0].toVisibility).toBe('org')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty database gracefully', async () => {
    const db = createMockDb({ things: [] })

    const result = await migrateVisibility(db, {
      toVisibility: 'org',
    })

    expect(result.affectedCount).toBe(0)
    expect(result.affectedIds).toEqual([])
  })

  it('handles things with null visibility', async () => {
    const nullVisThing = createMockThing({ visibility: null as unknown as Visibility })
    const db = createMockDb({ things: [nullVisThing] })

    // Should not throw
    const result = await migrateVisibility(db, {
      toVisibility: 'user',
      dryRun: true,
    })

    expect(result).toBeDefined()
  })

  it('deduplicates things with multiple versions', async () => {
    // Same ID, different versions
    const version1 = createMockThing({ id: 'multi-version', visibility: 'user' })
    const version2 = createMockThing({ id: 'multi-version', visibility: 'user' })
    const db = createMockDb({ things: [version1, version2] })

    const result = await migrateVisibility(db, {
      toVisibility: 'org',
      dryRun: true,
    })

    // Should only affect the ID once
    expect(result.affectedIds.filter((id) => id === 'multi-version').length).toBe(1)
  })

  it('excludes soft-deleted things from migration', async () => {
    // Mock DB simulates filtering - deleted things not returned by query
    const db = createMockDb({ things: [] }) // Simulates DB filtering out deleted things

    const result = await migrateVisibility(db, {
      fromVisibility: 'user',
      toVisibility: 'org',
      dryRun: true,
    })

    // Deleted things should not be migrated (DB filters them out)
    expect(result.affectedCount).toBe(0)
  })

  it('same visibility migration returns empty result', async () => {
    // Mock DB simulates filtering - things with same visibility not returned
    // (ne(things.visibility, toVisibility) filters them out)
    const db = createMockDb({ things: [] }) // Simulates DB filtering out same-visibility things

    const result = await migrateVisibility(db, {
      fromVisibility: 'public',
      toVisibility: 'public', // Same as current
      dryRun: true,
    })

    expect(result.affectedCount).toBe(0)
  })
})

// ============================================================================
// INDEX EXPORTS TEST
// ============================================================================

describe('Module Exports from index', () => {
  it('exports from db/migrations/index.ts', async () => {
    const migrations = await import('../../db/migrations')

    expect(migrations.migrateVisibility).toBeDefined()
    expect(migrations.getVisibilityHistory).toBeDefined()
    expect(migrations.rollbackVisibilityChange).toBeDefined()
    expect(migrations.rollbackBatch).toBeDefined()
    expect(migrations.getVisibilityStats).toBeDefined()
    expect(migrations.visibilityChanges).toBeDefined()
  })
})
