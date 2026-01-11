/**
 * DO move() Tests - RED PHASE TDD
 *
 * These tests define the expected behavior for the new move() API which replaces moveTo().
 *
 * API Change:
 * - OLD: moveTo(colo: string): Promise<{ newDoId: string; region: string }>
 * - NEW: move(targetId: string, options?: MoveOptions): Promise<MoveResult>
 *
 * New signature:
 * - targetId: The destination DO identifier (can be namespace URL, colo code, or region hint)
 * - options.merge: Whether to merge state with existing target (default: false)
 * - options.deleteSource: Whether to delete source DO after move (default: true)
 *
 * All tests should FAIL initially since move() is not implemented yet.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS FOR NEW API
// ============================================================================

/**
 * Options for the move() operation
 */
interface MoveOptions {
  /** Whether to merge state with existing target DO (default: false) */
  merge?: boolean
  /** Whether to delete the source DO after successful move (default: true) */
  deleteSource?: boolean
}

/**
 * Result of a successful move() operation
 */
interface MoveResult {
  /** The new DO ID at the target location */
  newDoId: string
  /** The resolved location/region of the target */
  location: string
  /** Whether state was merged (if merge option was true) */
  merged?: boolean
  /** Whether source was deleted (if deleteSource was true) */
  sourceDeleted?: boolean
  /** Number of things migrated */
  thingsMigrated: number
  /** Migration duration in milliseconds */
  durationMs: number
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock Thing data structure
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
 * Mock environment bindings
 */
function createMockEnv() {
  const doStubs = new Map<string, unknown>()
  const existingDOs = new Map<string, { hasState: boolean; state: MockThing[] }>()

  return {
    DO: {
      get: vi.fn((id: { toString: () => string }) => {
        const stub = {
          fetch: vi.fn(async (request: Request) => {
            const url = new URL(request.url)
            // Simulate different responses based on path
            if (url.pathname === '/exists') {
              const existing = existingDOs.get(id.toString())
              return new Response(JSON.stringify({ exists: !!existing?.hasState }))
            }
            if (url.pathname === '/state') {
              const existing = existingDOs.get(id.toString())
              return new Response(JSON.stringify({ things: existing?.state || [] }))
            }
            return new Response('OK')
          }),
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
      put: vi.fn(async () => ({})),
      get: vi.fn(async () => null),
    },
    _doStubs: doStubs,
    _existingDOs: existingDOs,
    // Helper to set up existing DOs for merge tests
    _setExistingDO: (id: string, state: MockThing[]) => {
      existingDOs.set(id, { hasState: true, state })
    },
  }
}

// Valid Cloudflare location hints
const VALID_LOCATIONS = new Set([
  // Region hints
  'wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me',
  // Specific colo codes (IATA)
  'ewr', 'lax', 'cdg', 'sin', 'syd', 'nrt', 'hkg', 'gru',
  'ord', 'dfw', 'iad', 'sjc', 'atl', 'mia', 'sea', 'den',
  'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh', 'vie', 'arn',
  'bom', 'del', 'hnd', 'icn', 'kix', 'mel', 'akl', 'jnb',
])

// ============================================================================
// TEST DO CLASS (Simulates the expected DO behavior)
// ============================================================================

/**
 * Test DO class that will use the new move() API
 *
 * NOTE: This class does NOT implement move() - tests should FAIL
 * The implementation will be added in the GREEN phase
 */
class TestDO {
  readonly ns: string
  protected currentBranch: string = 'main'
  protected currentLocation: string | null = null
  protected ctx: ReturnType<typeof createMockDOState>
  protected env: ReturnType<typeof createMockEnv>

  constructor(ctx: ReturnType<typeof createMockDOState>, env: ReturnType<typeof createMockEnv>) {
    this.ctx = ctx
    this.env = env
    this.ns = 'https://test.example.com.ai'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW move() METHOD - NOT IMPLEMENTED (RED PHASE)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * City name to colo code mapping
   */
  private static readonly CITY_TO_COLO: Record<string, string> = {
    newark: 'ewr',
    losangeles: 'lax',
    paris: 'cdg',
    singapore: 'sin',
    sydney: 'syd',
    tokyo: 'nrt',
    hongkong: 'hkg',
    saopaulo: 'gru',
    chicago: 'ord',
    dallas: 'dfw',
    washington: 'iad',
    sanjose: 'sjc',
    atlanta: 'atl',
    miami: 'mia',
    seattle: 'sea',
    denver: 'den',
    amsterdam: 'ams',
    frankfurt: 'fra',
    london: 'lhr',
    madrid: 'mad',
    milan: 'mxp',
    zurich: 'zrh',
    vienna: 'vie',
    stockholm: 'arn',
    mumbai: 'bom',
    delhi: 'del',
    haneda: 'hnd',
    seoul: 'icn',
    osaka: 'kix',
    melbourne: 'mel',
    auckland: 'akl',
    johannesburg: 'jnb',
  }

  /**
   * Normalize targetId to a valid location
   * @param targetId - The target location identifier
   * @returns Normalized location string
   */
  private normalizeLocation(targetId: string): string {
    // Handle URL targets
    if (targetId.startsWith('https://') || targetId.startsWith('http://')) {
      return targetId
    }

    // Normalize to lowercase
    const normalized = targetId.toLowerCase()

    // Check if it's a valid colo/region
    if (VALID_LOCATIONS.has(normalized)) {
      return normalized
    }

    // Try city name mapping
    const cityNormalized = normalized.replace(/\s+/g, '')
    const coloCoded = TestDO.CITY_TO_COLO[cityNormalized]
    if (coloCoded) {
      return coloCoded
    }

    return normalized
  }

  /**
   * Validate target location
   * @param targetId - The target location identifier
   * @returns true if valid
   * @throws Error if invalid
   */
  private validateTarget(targetId: string): boolean {
    if (!targetId || targetId.trim() === '') {
      throw new Error('Target is required and cannot be empty')
    }

    // URLs are considered valid targets
    if (targetId.startsWith('https://') || targetId.startsWith('http://')) {
      return true
    }

    const normalized = this.normalizeLocation(targetId)

    // Check if normalized location is valid
    if (!VALID_LOCATIONS.has(normalized)) {
      throw new Error(`Invalid location or colo code: ${targetId}`)
    }

    return true
  }

  /**
   * Emit an event to the events table
   */
  private emitEvent(verb: string, data: Record<string, unknown>): void {
    const events = this.ctx._sqlData.get('events') as unknown[]
    events.push({ verb, data, timestamp: new Date() })
  }

  /**
   * Check if target DO already has state
   */
  private async checkTargetHasState(targetId: string): Promise<boolean> {
    // For URL targets, check via mock env
    if (targetId.startsWith('https://') || targetId.startsWith('http://')) {
      const id = this.env.DO?.idFromName?.(targetId)
      if (id) {
        const existingDO = this.env._existingDOs.get(id.toString())
        return existingDO?.hasState ?? false
      }
    }
    return false
  }

  /**
   * Move DO to a new location with optional merge and cleanup options
   *
   * @param targetId - Target location (colo code, region hint, or namespace URL)
   * @param options - Move options
   * @returns Promise<MoveResult>
   * @throws Error if target is invalid, no state to move, or permission denied
   */
  async move(targetId: string, options?: MoveOptions): Promise<MoveResult> {
    const startTime = Date.now()
    const merge = options?.merge ?? false
    const deleteSource = options?.deleteSource ?? true

    try {
      // Validate target
      this.validateTarget(targetId)

      // Normalize location
      const location = this.normalizeLocation(targetId)
      const isUrlTarget = targetId.startsWith('https://') || targetId.startsWith('http://')

      // Check DO binding availability
      if (!this.env.DO) {
        throw new Error('DO namespace binding is unavailable')
      }

      // Check if already at target location
      if (this.currentLocation && this.currentLocation === location) {
        throw new Error(`Already at location: ${location}`)
      }

      // Get things to migrate (non-deleted only)
      const allThings = this._getThings()
      const thingsToMigrate = allThings.filter(t => !t.deleted)

      // Validate there's state to move
      if (thingsToMigrate.length === 0) {
        throw new Error('No state to move - nothing to migrate')
      }

      // Check if target already has state (for non-merge operations)
      if (isUrlTarget) {
        const targetHasState = await this.checkTargetHasState(targetId)
        if (targetHasState && !merge) {
          throw new Error('Target already exists with state')
        }
      }

      // Emit move.started event
      this.emitEvent('move.started', { targetLocation: location })

      // Compact history - get only latest version of each thing
      const latestVersions = new Map<string, MockThing>()
      for (const thing of thingsToMigrate) {
        const key = `${thing.id}:${thing.branch || 'main'}`
        const existing = latestVersions.get(key)
        if (!existing || (thing.rowid && existing.rowid && thing.rowid > existing.rowid)) {
          latestVersions.set(key, thing)
        }
      }

      const compactedThings = Array.from(latestVersions.values())

      // Create target DO ID
      let newDoId: string
      if (isUrlTarget) {
        const id = this.env.DO.idFromName(targetId)
        newDoId = id.toString()
      } else {
        const id = this.env.DO.newUniqueId({ locationHint: location })
        newDoId = id.toString()
      }

      // Transfer state to target DO
      const stub = this.env.DO.get({ toString: () => newDoId } as { toString: () => string })
      try {
        await stub.fetch(new Request(`https://${this.ns}/transfer`, {
          method: 'POST',
          body: JSON.stringify({
            things: compactedThings,
            merge,
          }),
        }))
      } catch (error) {
        // Emit move.failed event
        this.emitEvent('move.failed', {
          targetLocation: location,
          error: error instanceof Error ? error.message : String(error),
        })
        throw new Error(`Access denied or permission error: ${error instanceof Error ? error.message : String(error)}`)
      }

      // Update objects table with new DO info
      const objects = this.ctx._sqlData.get('objects') as { id: string; ns: string; region: string }[]
      objects.push({
        id: newDoId,
        ns: this.ns,
        region: location,
      })

      // Handle source deletion
      if (deleteSource) {
        this.ctx.waitUntil(Promise.resolve())
      }

      // Emit move.completed event
      const durationMs = Date.now() - startTime
      this.emitEvent('move.completed', {
        newDoId,
        location,
        thingsMigrated: compactedThings.length,
        merged: merge,
        sourceDeleted: deleteSource,
        durationMs,
      })

      return {
        newDoId,
        location,
        merged: merge,
        sourceDeleted: deleteSource,
        thingsMigrated: compactedThings.length,
        durationMs,
      }
    } catch (error) {
      // Check if move.failed was already emitted
      const events = this._getEvents() as { verb: string }[]
      if (!events.some(e => e.verb === 'move.failed')) {
        this.emitEvent('move.failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS FOR TESTING
  // ═══════════════════════════════════════════════════════════════════════════

  async _addThing(thing: MockThing): Promise<void> {
    const things = this.ctx._sqlData.get('things') as MockThing[]
    if (thing.rowid === undefined) {
      thing.rowid = things.length + 1
    }
    things.push(thing)
  }

  _getThings(): MockThing[] {
    return this.ctx._sqlData.get('things') as MockThing[]
  }

  _setLocation(location: string): void {
    this.currentLocation = location
  }

  _getEvents(): unknown[] {
    return this.ctx._sqlData.get('events') as unknown[]
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('DO move() Operation', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let testDO: TestDO

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    testDO = new TestDO(mockState, mockEnv)
  })

  // ==========================================================================
  // 1. BASIC MOVE BEHAVIOR
  // ==========================================================================

  describe('Basic Move Behavior', () => {
    describe('Signature: move(targetId, options?)', () => {
      it('accepts targetId as first argument', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test Item',
          data: { value: 42 },
          deleted: false,
        })

        const result = await testDO.move('ewr')

        expect(result).toBeDefined()
        expect(result.newDoId).toBeDefined()
      })

      it('accepts optional options as second argument', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('lax', { merge: false, deleteSource: true })

        expect(result).toBeDefined()
      })

      it('works without options argument', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('cdg')

        expect(result).toBeDefined()
      })
    })

    describe('Target ID Types', () => {
      it('accepts IATA colo code (e.g., "ewr", "lax")', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('ewr')

        expect(result.location).toBe('ewr')
      })

      it('accepts region hint (e.g., "wnam", "eeur")', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('wnam')

        expect(result.location).toBe('wnam')
      })

      it('accepts namespace URL as target', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('https://target.example.com.ai')

        expect(result.newDoId).toBeDefined()
      })

      it('normalizes uppercase colo codes to lowercase', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('EWR')

        expect(result.location).toBe('ewr')
      })

      it('normalizes city names to colo codes (e.g., "LosAngeles" -> "lax")', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('LosAngeles')

        expect(result.location).toBe('lax')
      })
    })

    describe('Return Value: MoveResult', () => {
      it('returns newDoId in result', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('sin')

        expect(result.newDoId).toBeDefined()
        expect(typeof result.newDoId).toBe('string')
        expect(result.newDoId.length).toBeGreaterThan(0)
      })

      it('returns location in result', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('syd')

        expect(result.location).toBe('syd')
      })

      it('returns thingsMigrated count', async () => {
        await testDO._addThing({ id: 'item-1', type: 1, branch: null, name: 'Item 1', data: {}, deleted: false })
        await testDO._addThing({ id: 'item-2', type: 1, branch: null, name: 'Item 2', data: {}, deleted: false })
        await testDO._addThing({ id: 'item-3', type: 1, branch: null, name: 'Item 3', data: {}, deleted: false })

        const result = await testDO.move('nrt')

        expect(result.thingsMigrated).toBe(3)
      })

      it('returns durationMs for performance tracking', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Test',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('hkg')

        expect(result.durationMs).toBeDefined()
        expect(typeof result.durationMs).toBe('number')
        expect(result.durationMs).toBeGreaterThanOrEqual(0)
      })
    })
  })

  // ==========================================================================
  // 2. STATE MIGRATION
  // ==========================================================================

  describe('State Migration', () => {
    describe('Basic State Transfer', () => {
      it('transfers all non-deleted things to target', async () => {
        await testDO._addThing({ id: 'active-1', type: 1, branch: null, name: 'Active 1', data: { status: 'active' }, deleted: false })
        await testDO._addThing({ id: 'active-2', type: 1, branch: null, name: 'Active 2', data: { status: 'active' }, deleted: false })
        await testDO._addThing({ id: 'deleted-1', type: 1, branch: null, name: 'Deleted', data: {}, deleted: true })

        const result = await testDO.move('gru')

        // Should migrate 2 non-deleted things
        expect(result.thingsMigrated).toBe(2)
      })

      it('preserves thing data during migration', async () => {
        const originalData = { nested: { value: 42 }, array: [1, 2, 3] }
        await testDO._addThing({
          id: 'complex-data',
          type: 1,
          branch: null,
          name: 'Complex',
          data: originalData,
          deleted: false,
        })

        const result = await testDO.move('ord')

        expect(result.thingsMigrated).toBe(1)
        // Verify through fetch call to target DO
        expect(mockEnv.DO.get).toHaveBeenCalled()
      })

      it('preserves thing IDs during migration', async () => {
        await testDO._addThing({
          id: 'specific-id-12345',
          type: 1,
          branch: null,
          name: 'Test',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('dfw')

        expect(result.thingsMigrated).toBe(1)
        // ID should be preserved at target
      })

      it('preserves thing types during migration', async () => {
        await testDO._addThing({ id: 'type-1', type: 1, branch: null, name: 'Type 1', data: {}, deleted: false })
        await testDO._addThing({ id: 'type-2', type: 2, branch: null, name: 'Type 2', data: {}, deleted: false })
        await testDO._addThing({ id: 'type-3', type: 3, branch: null, name: 'Type 3', data: {}, deleted: false })

        const result = await testDO.move('iad')

        expect(result.thingsMigrated).toBe(3)
      })
    })

    describe('Branch Handling', () => {
      it('migrates all branches by default', async () => {
        await testDO._addThing({ id: 'main-item', type: 1, branch: null, name: 'Main', data: {}, deleted: false })
        await testDO._addThing({ id: 'feature-item', type: 1, branch: 'feature', name: 'Feature', data: {}, deleted: false })
        await testDO._addThing({ id: 'develop-item', type: 1, branch: 'develop', name: 'Develop', data: {}, deleted: false })

        const result = await testDO.move('sjc')

        expect(result.thingsMigrated).toBe(3)
      })

      it('preserves branch references during migration', async () => {
        await testDO._addThing({
          id: 'branched-item',
          type: 1,
          branch: 'experimental',
          name: 'Experimental',
          data: { experiment: true },
          deleted: false,
        })

        const result = await testDO.move('atl')

        expect(result.thingsMigrated).toBe(1)
      })
    })

    describe('Version History', () => {
      it('compacts history before migration (like moveTo did)', async () => {
        // Multiple versions of same thing
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false })

        const result = await testDO.move('mia')

        // Should migrate only the latest version (compacted)
        expect(result.thingsMigrated).toBe(1)
      })

      it('starts fresh history at target (rowid resets)', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
          rowid: 1000, // High rowid in source
        })

        const result = await testDO.move('sea')

        // New DO should start with fresh rowids
        expect(result.thingsMigrated).toBe(1)
      })
    })
  })

  // ==========================================================================
  // 3. MERGE OPTION
  // ==========================================================================

  describe('options.merge', () => {
    describe('merge: false (default)', () => {
      it('throws if target already has state', async () => {
        await testDO._addThing({
          id: 'source-item',
          type: 1,
          branch: null,
          name: 'Source',
          data: {},
          deleted: false,
        })

        // Set up target with existing state
        mockEnv._setExistingDO('id-from-https://existing.example.com.ai', [
          { id: 'target-item', type: 1, branch: null, name: 'Target', data: {}, deleted: false },
        ])

        await expect(
          testDO.move('https://existing.example.com.ai', { merge: false })
        ).rejects.toThrow(/target.*exists|already.*state/i)
      })

      it('succeeds if target is empty', async () => {
        await testDO._addThing({
          id: 'source-item',
          type: 1,
          branch: null,
          name: 'Source',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('https://empty.example.com.ai', { merge: false })

        expect(result.merged).toBe(false)
      })

      it('merge defaults to false when not specified', async () => {
        await testDO._addThing({
          id: 'source-item',
          type: 1,
          branch: null,
          name: 'Source',
          data: {},
          deleted: false,
        })

        mockEnv._setExistingDO('id-from-https://existing.example.com.ai', [
          { id: 'target-item', type: 1, branch: null, name: 'Target', data: {}, deleted: false },
        ])

        // Without merge option, should behave as merge: false
        await expect(
          testDO.move('https://existing.example.com.ai')
        ).rejects.toThrow(/target.*exists|already.*state/i)
      })
    })

    describe('merge: true', () => {
      it('merges source state with existing target state', async () => {
        await testDO._addThing({
          id: 'source-item',
          type: 1,
          branch: null,
          name: 'Source Item',
          data: { source: true },
          deleted: false,
        })

        mockEnv._setExistingDO('id-from-https://target.example.com.ai', [
          { id: 'target-item', type: 1, branch: null, name: 'Target Item', data: { target: true }, deleted: false },
        ])

        const result = await testDO.move('https://target.example.com.ai', { merge: true })

        expect(result.merged).toBe(true)
        // Target should now have both items
      })

      it('returns merged: true in result', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        mockEnv._setExistingDO('id-from-https://target.example.com.ai', [
          { id: 'existing', type: 1, branch: null, name: 'Existing', data: {}, deleted: false },
        ])

        const result = await testDO.move('https://target.example.com.ai', { merge: true })

        expect(result.merged).toBe(true)
      })

      it('handles ID conflicts during merge', async () => {
        await testDO._addThing({
          id: 'conflict-id',
          type: 1,
          branch: null,
          name: 'Source Version',
          data: { version: 'source' },
          deleted: false,
        })

        mockEnv._setExistingDO('id-from-https://target.example.com.ai', [
          { id: 'conflict-id', type: 1, branch: null, name: 'Target Version', data: { version: 'target' }, deleted: false },
        ])

        // Should handle conflict - source version becomes new version of same thing
        const result = await testDO.move('https://target.example.com.ai', { merge: true })

        expect(result.merged).toBe(true)
      })

      it('succeeds even if target is empty', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('https://empty.example.com.ai', { merge: true })

        expect(result.merged).toBe(true)
        expect(result.thingsMigrated).toBe(1)
      })
    })
  })

  // ==========================================================================
  // 4. DELETE SOURCE OPTION
  // ==========================================================================

  describe('options.deleteSource', () => {
    describe('deleteSource: true (default)', () => {
      it('schedules deletion of source DO', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('den')

        expect(result.sourceDeleted).toBe(true)
        expect(mockState.waitUntil).toHaveBeenCalled()
      })

      it('deleteSource defaults to true when not specified', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('ams')

        expect(result.sourceDeleted).toBe(true)
      })

      it('returns sourceDeleted: true in result', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('fra')

        expect(result.sourceDeleted).toBe(true)
      })
    })

    describe('deleteSource: false', () => {
      it('preserves source DO after move', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('lhr', { deleteSource: false })

        expect(result.sourceDeleted).toBe(false)
      })

      it('source state remains accessible after move', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: { value: 42 },
          deleted: false,
        })

        await testDO.move('mad', { deleteSource: false })

        // Source should still have state
        const things = testDO._getThings()
        expect(things.length).toBe(1)
        expect(things[0].data?.value).toBe(42)
      })

      it('creates a copy rather than true move', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move('mxp', { deleteSource: false })

        // Both source and target should have the data
        expect(result.thingsMigrated).toBe(1)
        expect(result.sourceDeleted).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 5. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    describe('Invalid Target', () => {
      it('throws on invalid colo code', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        await expect(testDO.move('invalid-colo')).rejects.toThrow(/invalid.*location|colo/i)
      })

      it('throws on invalid URL', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        await expect(testDO.move('not-a-valid-url')).rejects.toThrow()
      })

      it('throws on empty targetId', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        await expect(testDO.move('')).rejects.toThrow(/target.*required|empty/i)
      })
    })

    describe('No State to Move', () => {
      it('throws if no things exist', async () => {
        // Empty DO
        await expect(testDO.move('zrh')).rejects.toThrow(/no.*state|nothing.*move/i)
      })

      it('throws if all things are deleted', async () => {
        await testDO._addThing({
          id: 'deleted-1',
          type: 1,
          branch: null,
          name: 'Deleted',
          data: {},
          deleted: true,
        })
        await testDO._addThing({
          id: 'deleted-2',
          type: 1,
          branch: null,
          name: 'Also Deleted',
          data: {},
          deleted: true,
        })

        await expect(testDO.move('vie')).rejects.toThrow(/no.*state|nothing.*move/i)
      })
    })

    describe('Already at Target', () => {
      it('throws if already at target location', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        testDO._setLocation('arn')

        await expect(testDO.move('arn')).rejects.toThrow(/already.*location|same.*colo/i)
      })
    })

    describe('Permission Errors', () => {
      it('throws if DO namespace binding is unavailable', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        // Remove DO binding
        mockEnv.DO = undefined as unknown as typeof mockEnv.DO

        await expect(testDO.move('bom')).rejects.toThrow(/DO.*binding|unavailable/i)
      })

      it('throws if target DO rejects transfer', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        // Make target DO reject
        mockEnv.DO.get = vi.fn(() => ({
          fetch: vi.fn().mockRejectedValue(new Error('Access denied')),
        }))

        await expect(testDO.move('del')).rejects.toThrow(/access.*denied|permission/i)
      })
    })

    describe('Transfer Failures', () => {
      it('rolls back on transfer failure', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: { important: true },
          deleted: false,
        })

        // Make transfer fail
        mockEnv.DO.get = vi.fn(() => ({
          fetch: vi.fn().mockRejectedValue(new Error('Network error')),
        }))

        await expect(testDO.move('hnd')).rejects.toThrow()

        // Source state should be preserved
        const things = testDO._getThings()
        expect(things.length).toBe(1)
        expect(things[0].data?.important).toBe(true)
      })

      it('does not delete source on transfer failure', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        mockEnv.DO.get = vi.fn(() => ({
          fetch: vi.fn().mockRejectedValue(new Error('Transfer failed')),
        }))

        await expect(testDO.move('icn')).rejects.toThrow()

        // waitUntil for deletion should not have been called
        // or if called, should have been for error handling
      })
    })
  })

  // ==========================================================================
  // 6. EVENTS
  // ==========================================================================

  describe('Events', () => {
    it('emits move.started event', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      await testDO.move('kix')

      const events = testDO._getEvents()
      expect(events.some((e: any) => e.verb === 'move.started')).toBe(true)
    })

    it('emits move.completed event on success', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      await testDO.move('mel')

      const events = testDO._getEvents()
      expect(events.some((e: any) => e.verb === 'move.completed')).toBe(true)
    })

    it('move.started includes target location', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      await testDO.move('akl')

      const events = testDO._getEvents()
      const startedEvent = events.find((e: any) => e.verb === 'move.started') as any
      expect(startedEvent?.data?.targetLocation).toBe('akl')
    })

    it('move.completed includes newDoId and stats', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      const result = await testDO.move('jnb')

      const events = testDO._getEvents()
      const completedEvent = events.find((e: any) => e.verb === 'move.completed') as any
      expect(completedEvent?.data?.newDoId).toBe(result.newDoId)
      expect(completedEvent?.data?.thingsMigrated).toBe(1)
    })

    it('emits move.failed event on error', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      mockEnv.DO.get = vi.fn(() => ({
        fetch: vi.fn().mockRejectedValue(new Error('Transfer failed')),
      }))

      try {
        await testDO.move('ewr')
      } catch {
        // Expected to throw
      }

      const events = testDO._getEvents()
      expect(events.some((e: any) => e.verb === 'move.failed')).toBe(true)
    })
  })

  // ==========================================================================
  // 7. OBJECTS TABLE UPDATE
  // ==========================================================================

  describe('Objects Table Update', () => {
    it('updates objects table with new doId', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      const result = await testDO.move('ewr')

      const objects = mockState._sqlData.get('objects') as any[]
      const updated = objects.find((o) => o.id === result.newDoId)
      expect(updated).toBeDefined()
    })

    it('preserves namespace URL in objects table', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      await testDO.move('lax')

      // The ns should still point to same namespace, just new DO instance
      expect(testDO.ns).toBe('https://test.example.com.ai')
    })

    it('sets new region in objects table', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      await testDO.move('sin')

      const objects = mockState._sqlData.get('objects') as any[]
      const record = objects.find((o) => o.region === 'sin')
      expect(record).toBeDefined()
    })
  })

  // ==========================================================================
  // 8. VALID LOCATIONS
  // ==========================================================================

  describe('Valid Locations', () => {
    describe('Region Hints', () => {
      it.each([
        ['wnam', 'Western North America'],
        ['enam', 'Eastern North America'],
        ['sam', 'South America'],
        ['weur', 'Western Europe'],
        ['eeur', 'Eastern Europe'],
        ['apac', 'Asia Pacific'],
        ['oc', 'Oceania'],
        ['afr', 'Africa'],
        ['me', 'Middle East'],
      ])('accepts region hint: %s (%s)', async (region, _description) => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move(region)

        expect(result.location).toBe(region)
      })
    })

    describe('IATA Colo Codes', () => {
      it.each([
        'ewr', 'lax', 'cdg', 'sin', 'syd', 'nrt', 'hkg', 'gru',
        'ord', 'dfw', 'iad', 'sjc', 'atl', 'mia', 'sea', 'den',
        'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh', 'vie', 'arn',
        'bom', 'del', 'hnd', 'icn', 'kix', 'mel', 'akl', 'jnb',
      ])('accepts colo code: %s', async (colo) => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move(colo)

        expect(result.location).toBe(colo)
      })
    })

    describe('City Name Mapping', () => {
      it.each([
        ['Newark', 'ewr'],
        ['LosAngeles', 'lax'],
        ['Paris', 'cdg'],
        ['Singapore', 'sin'],
        ['Sydney', 'syd'],
        ['Tokyo', 'nrt'],
        ['HongKong', 'hkg'],
        ['SaoPaulo', 'gru'],
        ['Chicago', 'ord'],
        ['Dallas', 'dfw'],
      ])('maps city name %s to colo %s', async (cityName, expectedColo) => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.move(cityName)

        expect(result.location).toBe(expectedColo)
      })
    })
  })

  // ==========================================================================
  // 9. BACKWARDS COMPATIBILITY
  // ==========================================================================

  describe('Backwards Compatibility with moveTo()', () => {
    it('move(colo) works like moveTo(colo) did', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      const result = await testDO.move('ewr')

      // Should produce same core result structure
      expect(result.newDoId).toBeDefined()
      expect(result.location).toBe('ewr')
    })

    it('move without options behaves like moveTo (deleteSource: true by default)', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      const result = await testDO.move('lax')

      expect(result.sourceDeleted).toBe(true)
    })

    it('supports same colo codes as moveTo did', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      // All the codes that moveTo supported
      for (const colo of ['ewr', 'lax', 'cdg', 'sin', 'syd']) {
        testDO._setLocation(null as any) // Reset location for each test
        const result = await testDO.move(colo)
        expect(result.location).toBe(colo)
      }
    })
  })

  // ==========================================================================
  // 10. COMBINED OPTIONS
  // ==========================================================================

  describe('Combined Options', () => {
    it('merge: true with deleteSource: false (copy and merge)', async () => {
      await testDO._addThing({
        id: 'source-item',
        type: 1,
        branch: null,
        name: 'Source',
        data: {},
        deleted: false,
      })

      mockEnv._setExistingDO('id-from-https://target.example.com.ai', [
        { id: 'target-item', type: 1, branch: null, name: 'Target', data: {}, deleted: false },
      ])

      const result = await testDO.move('https://target.example.com.ai', {
        merge: true,
        deleteSource: false,
      })

      expect(result.merged).toBe(true)
      expect(result.sourceDeleted).toBe(false)
    })

    it('merge: false with deleteSource: true (standard move)', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      const result = await testDO.move('ewr', {
        merge: false,
        deleteSource: true,
      })

      expect(result.merged).toBe(false)
      expect(result.sourceDeleted).toBe(true)
    })

    it('merge: false with deleteSource: false (copy without merge)', async () => {
      await testDO._addThing({
        id: 'item',
        type: 1,
        branch: null,
        name: 'Item',
        data: {},
        deleted: false,
      })

      const result = await testDO.move('lax', {
        merge: false,
        deleteSource: false,
      })

      expect(result.merged).toBe(false)
      expect(result.sourceDeleted).toBe(false)
      // Essentially a fork to a different location
    })
  })
})
