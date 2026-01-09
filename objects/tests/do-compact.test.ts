/**
 * DO Compact Options Tests
 *
 * RED TDD: Comprehensive tests for compact(options?: CompactOptions)
 *
 * Tests configurable compaction behavior:
 * - compact(options?) signature with optional CompactOptions
 * - options.threshold - minimum size (in things/versions) before compacting
 * - options.archive - whether to archive compacted data to R2
 * - options.preserveKeys - thing IDs to preserve all versions for
 * - options.ttl - time-to-live for archived data (expiration)
 *
 * These tests define the expected behavior for configurable state compaction
 * within Durable Objects.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for configuring compact behavior
 */
interface CompactOptions {
  /**
   * Minimum number of total thing versions before compacting.
   * If the total version count is below this threshold, compact is a no-op.
   * Default: 0 (always compact)
   */
  threshold?: number

  /**
   * Whether to archive compacted data to R2.
   * When false, old versions are deleted without archiving.
   * Default: true
   */
  archive?: boolean

  /**
   * Thing IDs to preserve all versions for (exempt from compaction).
   * Useful for audit trails or important documents.
   */
  preserveKeys?: string[]

  /**
   * Time-to-live in seconds for archived data in R2.
   * After TTL expires, R2 lifecycle rules will delete the archives.
   * Default: undefined (no expiration)
   */
  ttl?: number
}

/**
 * Result of a compact operation
 */
interface CompactResult {
  thingsCompacted: number
  actionsArchived: number
  eventsArchived: number
  skipped?: boolean // True if threshold not met
  preservedKeys?: string[] // Keys that were preserved
  archiveTtl?: number // TTL applied to archives
}

// ============================================================================
// MOCK DO ENVIRONMENT
// ============================================================================

/**
 * Mock DurableObjectState for testing
 */
function createMockDOState() {
  const storage = new Map<string, unknown>()
  const sqlData: Map<string, unknown[]> = new Map()

  // Initialize tables
  sqlData.set('things', [])
  sqlData.set('branches', [])
  sqlData.set('actions', [])
  sqlData.set('events', [])
  sqlData.set('objects', [])

  return {
    id: {
      toString: () => 'mock-do-id-12345',
      name: 'test-namespace',
    },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async () => storage),
      sql: {
        exec: vi.fn((sql: string) => {
          // Mock SQL execution
          return { results: [] }
        }),
      },
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    _storage: storage,
    _sqlData: sqlData,
  }
}

/**
 * Mock environment bindings with R2 archive tracking
 */
function createMockEnv() {
  const doStubs = new Map<string, unknown>()
  const r2Archives = new Map<string, { data: string; metadata?: Record<string, unknown> }>()

  return {
    DO: {
      get: vi.fn((id: { toString: () => string }) => {
        const stub = {
          fetch: vi.fn(async () => new Response('OK')),
          id: id,
        }
        doStubs.set(id.toString(), stub)
        return stub
      }),
      idFromName: vi.fn((name: string) => ({
        toString: () => `id-from-${name}`,
        name,
      })),
      newUniqueId: vi.fn((options?: { locationHint?: string }) => ({
        toString: () => `new-unique-id-${options?.locationHint || 'default'}`,
        locationHint: options?.locationHint,
      })),
    },
    R2: {
      put: vi.fn(async (key: string, data: string, options?: { customMetadata?: Record<string, string>; httpMetadata?: { cacheExpiry?: Date } }) => {
        r2Archives.set(key, { data, metadata: options })
        return {}
      }),
      get: vi.fn(async (key: string) => {
        const archive = r2Archives.get(key)
        if (!archive) return null
        return {
          text: async () => archive.data,
          json: async () => JSON.parse(archive.data),
        }
      }),
      delete: vi.fn(async () => {}),
    },
    _doStubs: doStubs,
    _r2Archives: r2Archives,
  }
}

/**
 * Mock Thing data for testing
 */
interface MockThing {
  id: string
  type: number
  branch: string | null
  name: string | null
  data: Record<string, unknown> | null
  deleted: boolean
  rowid?: number
}

// ============================================================================
// MOCK DATABASE
// ============================================================================

class MockDatabase {
  constructor(private sqlData: Map<string, unknown[]>) {}

  getThings(): MockThing[] {
    return this.sqlData.get('things') as MockThing[]
  }

  addThing(thing: MockThing): void {
    const things = this.getThings()
    thing.rowid = things.length + 1
    things.push(thing)
  }

  getEvents(): unknown[] {
    return this.sqlData.get('events') as unknown[]
  }

  getActions(): unknown[] {
    return this.sqlData.get('actions') as unknown[]
  }
}

// ============================================================================
// TEST DO CLASS WITH COMPACT OPTIONS
// ============================================================================

/**
 * Test DO class that simulates the DO base class behavior with compact options
 */
class TestDO {
  readonly ns: string = 'https://test.example.com'
  protected db: MockDatabase
  protected ctx: ReturnType<typeof createMockDOState>
  protected env: ReturnType<typeof createMockEnv>

  constructor(ctx: ReturnType<typeof createMockDOState>, env: ReturnType<typeof createMockEnv>) {
    this.ctx = ctx
    this.env = env
    this.db = new MockDatabase(ctx._sqlData)
  }

  // Test helper methods
  _addThing(thing: Omit<MockThing, 'rowid'>): void {
    this.db.addThing({ ...thing, rowid: undefined })
  }

  _getThings(): MockThing[] {
    return this.db.getThings()
  }

  protected async emitEvent(verb: string, data: unknown): Promise<void> {
    const events = this.ctx._sqlData.get('events') as unknown[]
    events.push({
      id: crypto.randomUUID(),
      verb,
      source: this.ns,
      data,
      sequence: events.length + 1,
      streamed: false,
      createdAt: new Date(),
    })
  }

  /**
   * Squash history to current state with configurable options
   * RED: This signature with options is not yet implemented
   */
  async compact(options?: CompactOptions): Promise<CompactResult> {
    // Current implementation does not support options
    // These tests will fail until the implementation is updated
    throw new Error('compact(options) not implemented - RED TDD phase')
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('compact(options?: CompactOptions)', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let testDO: TestDO

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    testDO = new TestDO(mockState, mockEnv)
  })

  // ==========================================================================
  // 1. SIGNATURE COMPATIBILITY
  // ==========================================================================

  describe('Signature Compatibility', () => {
    it('accepts no arguments (backward compatible)', async () => {
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })

      // Should work without options (backward compatible)
      const result = await testDO.compact()

      expect(result.thingsCompacted).toBeGreaterThanOrEqual(0)
    })

    it('accepts empty options object', async () => {
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      const result = await testDO.compact({})

      expect(result.thingsCompacted).toBeGreaterThanOrEqual(0)
    })

    it('accepts partial options object', async () => {
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      const result = await testDO.compact({ threshold: 5 })

      expect(result).toBeDefined()
    })

    it('accepts full options object', async () => {
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      const result = await testDO.compact({
        threshold: 10,
        archive: true,
        preserveKeys: ['important-doc'],
        ttl: 86400,
      })

      expect(result).toBeDefined()
    })
  })

  // ==========================================================================
  // 2. THRESHOLD OPTION
  // ==========================================================================

  describe('options.threshold', () => {
    describe('Basic Threshold Behavior', () => {
      it('skips compaction when version count is below threshold', async () => {
        // 3 total versions (2 for doc-1, 1 for doc-2)
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-2', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

        const result = await testDO.compact({ threshold: 10 })

        expect(result.skipped).toBe(true)
        expect(result.thingsCompacted).toBe(0)
        // All versions should still exist
        expect(testDO._getThings()).toHaveLength(3)
      })

      it('compacts when version count meets threshold', async () => {
        // Add 10 versions
        for (let i = 0; i < 10; i++) {
          testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: `v${i}`, data: { v: i }, deleted: false })
        }

        const result = await testDO.compact({ threshold: 10 })

        expect(result.skipped).toBeFalsy()
        expect(result.thingsCompacted).toBeGreaterThan(0)
        // Should only have 1 version after compaction
        expect(testDO._getThings()).toHaveLength(1)
      })

      it('compacts when version count exceeds threshold', async () => {
        // Add 15 versions
        for (let i = 0; i < 15; i++) {
          testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: `v${i}`, data: { v: i }, deleted: false })
        }

        const result = await testDO.compact({ threshold: 10 })

        expect(result.skipped).toBeFalsy()
        expect(result.thingsCompacted).toBe(14) // Compacted 14, kept 1
      })

      it('uses threshold of 0 by default (always compact)', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact() // No threshold specified

        expect(result.skipped).toBeFalsy()
        expect(result.thingsCompacted).toBe(1)
      })
    })

    describe('Threshold Edge Cases', () => {
      it('threshold of 1 compacts any multi-version state', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact({ threshold: 1 })

        expect(result.skipped).toBeFalsy()
      })

      it('handles threshold with empty state', async () => {
        // No things at all
        await expect(testDO.compact({ threshold: 5 })).rejects.toThrow('Nothing to compact')
      })

      it('handles threshold with single-version state', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

        const result = await testDO.compact({ threshold: 5 })

        expect(result.skipped).toBe(true)
      })

      it('counts versions across all branches for threshold', async () => {
        // 3 versions on main, 3 on feature = 6 total
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'main-v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'main-v2', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'main-v3', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: 'feature', name: 'feat-v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: 'feature', name: 'feat-v2', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: 'feature', name: 'feat-v3', data: {}, deleted: false })

        const result = await testDO.compact({ threshold: 5 })

        expect(result.skipped).toBeFalsy()
        expect(result.thingsCompacted).toBe(4) // 2 from each branch
      })

      it('negative threshold is treated as 0', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact({ threshold: -5 })

        expect(result.skipped).toBeFalsy()
      })
    })
  })

  // ==========================================================================
  // 3. ARCHIVE OPTION
  // ==========================================================================

  describe('options.archive', () => {
    describe('Archive Enabled (Default)', () => {
      it('archives things to R2 by default', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })

        await testDO.compact() // archive: true by default

        expect(mockEnv.R2.put).toHaveBeenCalled()
        // Verify things archive was written
        const putCalls = mockEnv.R2.put.mock.calls
        const thingsArchive = putCalls.find(call => call[0].includes('/things/'))
        expect(thingsArchive).toBeDefined()
      })

      it('archives actions to R2 by default', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

        const actions = mockState._sqlData.get('actions') as unknown[]
        actions.push({ id: '1', verb: 'create', createdAt: new Date() })

        await testDO.compact()

        const putCalls = mockEnv.R2.put.mock.calls
        const actionsArchive = putCalls.find(call => call[0].includes('/actions/'))
        expect(actionsArchive).toBeDefined()
      })

      it('archives events to R2 by default', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

        const events = mockState._sqlData.get('events') as unknown[]
        events.push({ id: '1', verb: 'created', createdAt: new Date() })

        await testDO.compact()

        const putCalls = mockEnv.R2.put.mock.calls
        const eventsArchive = putCalls.find(call => call[0].includes('/events/'))
        expect(eventsArchive).toBeDefined()
      })

      it('explicit archive: true behaves same as default', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        await testDO.compact({ archive: true })

        expect(mockEnv.R2.put).toHaveBeenCalled()
      })
    })

    describe('Archive Disabled', () => {
      it('does not write to R2 when archive: false', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        await testDO.compact({ archive: false })

        expect(mockEnv.R2.put).not.toHaveBeenCalled()
      })

      it('still removes old versions when archive: false', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false })

        const result = await testDO.compact({ archive: false })

        expect(result.thingsCompacted).toBe(2)
        expect(testDO._getThings()).toHaveLength(1)
        expect(testDO._getThings()[0].data).toEqual({ v: 3 })
      })

      it('still clears actions when archive: false', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

        const actions = mockState._sqlData.get('actions') as unknown[]
        actions.push({ id: '1', verb: 'action1' })
        actions.push({ id: '2', verb: 'action2' })

        await testDO.compact({ archive: false })

        // Actions should still be cleared
        expect(actions.length).toBeLessThanOrEqual(1) // May have compact action
      })

      it('reports archiveCounts as 0 when archive: false', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const actions = mockState._sqlData.get('actions') as unknown[]
        actions.push({ id: '1', verb: 'action1' })

        const result = await testDO.compact({ archive: false })

        // Items were deleted but not archived
        expect(result.actionsArchived).toBe(0)
        expect(result.eventsArchived).toBe(0)
      })
    })

    describe('Archive Without R2', () => {
      it('gracefully handles missing R2 binding', async () => {
        const envWithoutR2 = { ...mockEnv, R2: undefined }
        const doWithoutR2 = new TestDO(mockState, envWithoutR2 as any)

        doWithoutR2._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        doWithoutR2._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        // Should not throw, just skip archiving
        const result = await doWithoutR2.compact()

        expect(result.thingsCompacted).toBe(1)
        expect(result.actionsArchived).toBe(0)
      })

      it('archive: true with no R2 logs warning but succeeds', async () => {
        const envWithoutR2 = { ...mockEnv, R2: undefined }
        const doWithoutR2 = new TestDO(mockState, envWithoutR2 as any)

        doWithoutR2._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        doWithoutR2._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        // Should succeed without throwing
        const result = await doWithoutR2.compact({ archive: true })

        expect(result.thingsCompacted).toBe(1)
      })
    })
  })

  // ==========================================================================
  // 4. PRESERVEKEYS OPTION
  // ==========================================================================

  describe('options.preserveKeys', () => {
    describe('Basic Preservation', () => {
      it('preserves all versions of specified keys', async () => {
        // Important doc with multiple versions
        testDO._addThing({ id: 'important', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
        testDO._addThing({ id: 'important', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })
        testDO._addThing({ id: 'important', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false })

        // Regular doc with multiple versions
        testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
        testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })

        const result = await testDO.compact({ preserveKeys: ['important'] })

        const things = testDO._getThings()

        // Important should have all 3 versions
        const importantVersions = things.filter(t => t.id === 'important')
        expect(importantVersions).toHaveLength(3)

        // Regular should only have 1 version
        const regularVersions = things.filter(t => t.id === 'regular')
        expect(regularVersions).toHaveLength(1)
      })

      it('preserves multiple specified keys', async () => {
        testDO._addThing({ id: 'audit-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'audit-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'audit-2', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'audit-2', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'normal', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'normal', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        await testDO.compact({ preserveKeys: ['audit-1', 'audit-2'] })

        const things = testDO._getThings()
        expect(things.filter(t => t.id === 'audit-1')).toHaveLength(2)
        expect(things.filter(t => t.id === 'audit-2')).toHaveLength(2)
        expect(things.filter(t => t.id === 'normal')).toHaveLength(1)
      })

      it('returns preservedKeys in result', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-2', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

        const result = await testDO.compact({ preserveKeys: ['doc-1'] })

        expect(result.preservedKeys).toEqual(['doc-1'])
      })
    })

    describe('Preservation Edge Cases', () => {
      it('ignores non-existent keys in preserveKeys', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact({ preserveKeys: ['non-existent', 'also-missing'] })

        // Should still compact doc-1
        expect(result.thingsCompacted).toBe(1)
        expect(testDO._getThings()).toHaveLength(1)
      })

      it('handles empty preserveKeys array', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact({ preserveKeys: [] })

        expect(result.thingsCompacted).toBe(1)
      })

      it('preserves deleted versions for preserved keys', async () => {
        testDO._addThing({ id: 'audit', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'audit', type: 1, branch: null, name: 'v2', data: {}, deleted: true }) // Deleted version

        await testDO.compact({ preserveKeys: ['audit'] })

        const things = testDO._getThings()
        const auditVersions = things.filter(t => t.id === 'audit')
        expect(auditVersions).toHaveLength(2) // Both versions preserved
      })

      it('preserves across branches for preserved keys', async () => {
        testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main-v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main-v2', data: {}, deleted: false })
        testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feat-v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feat-v2', data: {}, deleted: false })

        await testDO.compact({ preserveKeys: ['doc'] })

        const things = testDO._getThings()
        // All 4 versions should be preserved
        expect(things.filter(t => t.id === 'doc')).toHaveLength(4)
      })

      it('correctly reports thingsCompacted excluding preserved keys', async () => {
        // 3 versions of preserved doc
        testDO._addThing({ id: 'preserved', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'preserved', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'preserved', type: 1, branch: null, name: 'v3', data: {}, deleted: false })

        // 3 versions of regular doc
        testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v3', data: {}, deleted: false })

        const result = await testDO.compact({ preserveKeys: ['preserved'] })

        // Only regular's 2 old versions were compacted
        expect(result.thingsCompacted).toBe(2)
      })
    })

    describe('Preservation with Pattern Matching', () => {
      it('supports wildcard prefix matching', async () => {
        testDO._addThing({ id: 'audit-log-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'audit-log-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'audit-log-2', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'audit-log-2', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'regular-doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'regular-doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        await testDO.compact({ preserveKeys: ['audit-log-*'] })

        const things = testDO._getThings()
        // All audit-log versions preserved
        expect(things.filter(t => t.id.startsWith('audit-log-'))).toHaveLength(4)
        // Regular doc compacted to 1
        expect(things.filter(t => t.id === 'regular-doc')).toHaveLength(1)
      })
    })
  })

  // ==========================================================================
  // 5. TTL OPTION
  // ==========================================================================

  describe('options.ttl', () => {
    describe('TTL Application', () => {
      it('sets expiration metadata on R2 archives', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        await testDO.compact({ ttl: 86400 }) // 24 hours

        const putCalls = mockEnv.R2.put.mock.calls
        expect(putCalls.length).toBeGreaterThan(0)

        // Check that TTL metadata was set
        const [, , options] = putCalls[0]
        expect(options).toBeDefined()
        expect(options.httpMetadata?.cacheExpiry).toBeDefined()
      })

      it('returns ttl in result', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact({ ttl: 604800 }) // 7 days

        expect(result.archiveTtl).toBe(604800)
      })

      it('no TTL when not specified', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact() // No TTL

        expect(result.archiveTtl).toBeUndefined()
      })

      it('applies TTL to all archive types (things, actions, events)', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const actions = mockState._sqlData.get('actions') as unknown[]
        actions.push({ id: '1', verb: 'action1' })

        const events = mockState._sqlData.get('events') as unknown[]
        events.push({ id: '1', verb: 'event1' })

        await testDO.compact({ ttl: 3600 }) // 1 hour

        const putCalls = mockEnv.R2.put.mock.calls
        // All put calls should have TTL
        for (const call of putCalls) {
          const [, , options] = call
          expect(options?.httpMetadata?.cacheExpiry).toBeDefined()
        }
      })
    })

    describe('TTL Edge Cases', () => {
      it('handles TTL of 0 (immediate expiration)', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact({ ttl: 0 })

        expect(result.archiveTtl).toBe(0)
      })

      it('handles very large TTL (10 years)', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const tenYearsInSeconds = 10 * 365 * 24 * 60 * 60
        const result = await testDO.compact({ ttl: tenYearsInSeconds })

        expect(result.archiveTtl).toBe(tenYearsInSeconds)
      })

      it('TTL is ignored when archive: false', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact({ archive: false, ttl: 86400 })

        expect(mockEnv.R2.put).not.toHaveBeenCalled()
        // TTL should not be in result since nothing was archived
        expect(result.archiveTtl).toBeUndefined()
      })

      it('negative TTL throws error', async () => {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        await expect(testDO.compact({ ttl: -100 })).rejects.toThrow('TTL must be non-negative')
      })
    })
  })

  // ==========================================================================
  // 6. COMBINED OPTIONS
  // ==========================================================================

  describe('Combined Options', () => {
    it('threshold + archive: false', async () => {
      for (let i = 0; i < 10; i++) {
        testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }

      const result = await testDO.compact({ threshold: 5, archive: false })

      expect(result.skipped).toBeFalsy()
      expect(result.thingsCompacted).toBe(9)
      expect(mockEnv.R2.put).not.toHaveBeenCalled()
    })

    it('threshold + preserveKeys', async () => {
      // 5 versions of preserved doc
      for (let i = 0; i < 5; i++) {
        testDO._addThing({ id: 'preserved', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }
      // 5 versions of regular doc
      for (let i = 0; i < 5; i++) {
        testDO._addThing({ id: 'regular', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }

      const result = await testDO.compact({ threshold: 8, preserveKeys: ['preserved'] })

      // Total 10 versions meets threshold of 8
      expect(result.skipped).toBeFalsy()
      // Preserved has 5 versions, regular compacted from 5 to 1
      expect(testDO._getThings().filter(t => t.id === 'preserved')).toHaveLength(5)
      expect(testDO._getThings().filter(t => t.id === 'regular')).toHaveLength(1)
    })

    it('archive + ttl + preserveKeys', async () => {
      testDO._addThing({ id: 'audit', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'audit', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
      testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      const result = await testDO.compact({
        archive: true,
        ttl: 86400,
        preserveKeys: ['audit'],
      })

      // Audit preserved, regular compacted and archived
      expect(testDO._getThings().filter(t => t.id === 'audit')).toHaveLength(2)
      expect(testDO._getThings().filter(t => t.id === 'regular')).toHaveLength(1)
      expect(result.archiveTtl).toBe(86400)
      expect(mockEnv.R2.put).toHaveBeenCalled()
    })

    it('all options together', async () => {
      // Create diverse state
      for (let i = 0; i < 15; i++) {
        testDO._addThing({ id: 'normal', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }
      for (let i = 0; i < 5; i++) {
        testDO._addThing({ id: 'audit', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }

      const result = await testDO.compact({
        threshold: 10,
        archive: true,
        preserveKeys: ['audit'],
        ttl: 604800,
      })

      // Total 20 versions exceeds threshold of 10
      expect(result.skipped).toBeFalsy()
      // Normal compacted from 15 to 1
      expect(testDO._getThings().filter(t => t.id === 'normal')).toHaveLength(1)
      // Audit preserved all 5
      expect(testDO._getThings().filter(t => t.id === 'audit')).toHaveLength(5)
      // Archive happened with TTL
      expect(mockEnv.R2.put).toHaveBeenCalled()
      expect(result.archiveTtl).toBe(604800)
    })
  })

  // ==========================================================================
  // 7. EDGE CASES AND ERROR HANDLING
  // ==========================================================================

  describe('Edge Cases', () => {
    describe('Empty State', () => {
      it('throws on completely empty state', async () => {
        await expect(testDO.compact()).rejects.toThrow('Nothing to compact')
      })

      it('throws on empty state with options', async () => {
        await expect(testDO.compact({ threshold: 5 })).rejects.toThrow('Nothing to compact')
      })
    })

    describe('Large State', () => {
      it('handles 1000+ versions efficiently', async () => {
        // Add 1000 versions
        for (let i = 0; i < 1000; i++) {
          testDO._addThing({ id: 'doc', type: 1, branch: null, name: `v${i}`, data: { v: i }, deleted: false })
        }

        const startTime = Date.now()
        const result = await testDO.compact()
        const duration = Date.now() - startTime

        expect(result.thingsCompacted).toBe(999)
        expect(testDO._getThings()).toHaveLength(1)
        expect(duration).toBeLessThan(5000) // Should complete in < 5 seconds
      })

      it('handles 100+ unique keys', async () => {
        // 100 unique docs, each with 3 versions
        for (let doc = 0; doc < 100; doc++) {
          for (let v = 0; v < 3; v++) {
            testDO._addThing({
              id: `doc-${doc}`,
              type: 1,
              branch: null,
              name: `v${v}`,
              data: {},
              deleted: false,
            })
          }
        }

        const result = await testDO.compact()

        // Each doc should have only 1 version (2 compacted per doc = 200 total)
        expect(result.thingsCompacted).toBe(200)
        expect(testDO._getThings()).toHaveLength(100)
      })
    })

    describe('Special Characters', () => {
      it('handles keys with special characters', async () => {
        testDO._addThing({ id: 'doc/with/slashes', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc/with/slashes', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'doc:with:colons', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc:with:colons', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        const result = await testDO.compact()

        expect(result.thingsCompacted).toBe(2)
        expect(testDO._getThings()).toHaveLength(2)
      })

      it('handles unicode keys', async () => {
        testDO._addThing({ id: 'doc-emoji-\u{1F600}', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-emoji-\u{1F600}', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
        testDO._addThing({ id: 'doc-japanese-\u65E5\u672C\u8A9E', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

        const result = await testDO.compact()

        expect(result.thingsCompacted).toBe(1)
      })
    })

    describe('Concurrent Compaction', () => {
      it('second compact after first is no-op (idempotent)', async () => {
        testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

        await testDO.compact()
        const result2 = await testDO.compact()

        // Second compact should have nothing to do
        expect(result2.thingsCompacted).toBe(0)
      })
    })
  })

  // ==========================================================================
  // 8. EVENTS
  // ==========================================================================

  describe('Compact Events with Options', () => {
    it('includes options in compact.started event', async () => {
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      await testDO.compact({
        threshold: 1,
        archive: true,
        preserveKeys: ['audit'],
        ttl: 86400,
      })

      const events = mockState._sqlData.get('events') as any[]
      const startedEvent = events.find(e => e.verb === 'compact.started')

      expect(startedEvent).toBeDefined()
      expect(startedEvent.data.options).toEqual({
        threshold: 1,
        archive: true,
        preserveKeys: ['audit'],
        ttl: 86400,
      })
    })

    it('includes skipped reason in compact.completed event when threshold not met', async () => {
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      await testDO.compact({ threshold: 10 })

      const events = mockState._sqlData.get('events') as any[]
      const completedEvent = events.find(e => e.verb === 'compact.completed')

      expect(completedEvent).toBeDefined()
      expect(completedEvent.data.skipped).toBe(true)
      expect(completedEvent.data.reason).toBe('threshold_not_met')
    })
  })
})
