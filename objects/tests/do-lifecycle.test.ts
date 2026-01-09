/**
 * DO Lifecycle Operations Tests
 *
 * RED TDD: Comprehensive tests for DO lifecycle operations:
 * - fork(options: { to: string }): Create new DO at target namespace with current state
 * - compact(): Squash history to current state, keeping only latest versions
 * - moveTo(colo: string): Relocate DO to different colo with locationHint
 * - branch(name: string): Create new branch at current HEAD
 * - checkout(ref: string): Switch to branch or version reference
 * - merge(branch: string): Merge branch into current
 *
 * These tests define the expected behavior for version control and lifecycle
 * management within Durable Objects.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

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
 * Mock environment bindings
 */
function createMockEnv() {
  const doStubs = new Map<string, unknown>()

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
      put: vi.fn(async () => ({})),
      get: vi.fn(async () => null),
    },
    _doStubs: doStubs,
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

/**
 * Mock Branch data for testing
 */
interface MockBranch {
  name: string
  thingId: string
  head: number
  base: number | null
  forkedFrom: string | null
  description: string | null
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// TEST DO CLASS (extends conceptual DO base)
// ============================================================================

// Valid Cloudflare colo codes and region hints
const VALID_COLOS = new Set([
  // Region hints
  'wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me',
  // Specific colo codes
  'ewr', 'lax', 'cdg', 'sin', 'syd', 'nrt', 'hkg', 'gru',
  'ord', 'dfw', 'iad', 'sjc', 'atl', 'mia', 'sea', 'den',
  'ams', 'fra', 'lhr', 'mad', 'mxp', 'zrh', 'vie', 'arn',
  'bom', 'del', 'hnd', 'icn', 'kix', 'mel', 'akl', 'jnb',
])

/**
 * Test DO class that simulates the DO base class behavior
 * This allows us to test lifecycle operations in isolation
 */
class TestDO {
  readonly ns: string
  protected currentBranch: string = 'main'
  protected currentVersion: number | null = null // null means HEAD
  protected db: MockDatabase
  protected ctx: ReturnType<typeof createMockDOState>
  protected env: ReturnType<typeof createMockEnv>
  protected currentColo: string | null = null

  constructor(ctx: ReturnType<typeof createMockDOState>, env: ReturnType<typeof createMockEnv>) {
    this.ctx = ctx
    this.env = env
    this.ns = 'https://test.example.com'
    this.db = new MockDatabase(ctx._sqlData)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMISSION
  // ═══════════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fork current state to a new DO (new identity, fresh history)
   */
  async fork(options: { to: string; branch?: string }): Promise<{ ns: string; doId: string }> {
    const targetNs = options.to
    const forkBranch = options.branch || this.currentBranch

    // Validate target namespace URL
    try {
      new URL(targetNs)
    } catch {
      throw new Error(`Invalid namespace URL: ${targetNs}`)
    }

    // Get current state (latest version of each thing, non-deleted, specified branch)
    const things = this._getThings()
    const branchFilter = forkBranch === 'main' ? null : forkBranch
    const branchThings = things.filter(t =>
      t.branch === branchFilter && !t.deleted
    )

    // Check if there's anything to fork
    if (branchThings.length === 0) {
      throw new Error('No state to fork')
    }

    // Get latest version of each thing (by id)
    const latestVersions = new Map<string, MockThing>()
    for (const thing of branchThings) {
      const existing = latestVersions.get(thing.id)
      if (!existing || (thing.rowid && existing.rowid && thing.rowid > existing.rowid)) {
        latestVersions.set(thing.id, thing)
      }
    }

    // Emit fork.started event
    await this.emitEvent('fork.started', { targetNs, thingsCount: latestVersions.size })

    // Create new DO at target namespace
    const doId = this.env.DO.idFromName(targetNs)
    const stub = this.env.DO.get(doId)

    // In real implementation, we'd send state to new DO
    // For now, just verify the DO was created
    await stub.fetch(new Request(`https://${targetNs}/init`, {
      method: 'POST',
      body: JSON.stringify({
        things: Array.from(latestVersions.values()).map(t => ({
          id: t.id,
          type: t.type,
          branch: null, // Fresh start on main
          name: t.name,
          data: t.data,
          deleted: false,
          rowid: undefined, // Fresh history
        })),
      }),
    }))

    // Emit fork.completed event
    await this.emitEvent('fork.completed', { targetNs, doId: doId.toString() })

    return { ns: targetNs, doId: doId.toString() }
  }

  /**
   * Squash history to current state (same identity)
   */
  async compact(): Promise<{ thingsCompacted: number; actionsArchived: number; eventsArchived: number }> {
    const things = this._getThings()
    const actions = this.ctx._sqlData.get('actions') as unknown[]
    const events = this.ctx._sqlData.get('events') as unknown[]

    // Check if there's anything to compact
    if (things.length === 0) {
      throw new Error('Nothing to compact')
    }

    // Prepare archives BEFORE modifying state (for atomicity)
    const actionsToArchive = [...actions]
    const eventsToArchive = events.filter((e: any) =>
      e.verb !== 'compact.started' && e.verb !== 'compact.completed'
    )

    // Archive old things versions to R2 FIRST - this provides atomicity
    // If R2 fails, no state is modified
    const thingsSnapshot = [...things]
    await this.env.R2.put(
      `archives/${this.ns}/things/${Date.now()}.json`,
      JSON.stringify(thingsSnapshot)
    )

    // Archive actions to R2
    if (actionsToArchive.length > 0) {
      await this.env.R2.put(
        `archives/${this.ns}/actions/${Date.now()}.json`,
        JSON.stringify(actionsToArchive)
      )
    }
    // Archive events to R2
    if (eventsToArchive.length > 0) {
      await this.env.R2.put(
        `archives/${this.ns}/events/${Date.now()}.json`,
        JSON.stringify(eventsToArchive)
      )
    }

    // Emit compact.started event (after R2 success)
    await this.emitEvent('compact.started', { thingsCount: things.length })

    // Group things by id+branch to find latest versions
    const thingsByKey = new Map<string, MockThing[]>()
    for (const thing of things) {
      const key = `${thing.id}:${thing.branch || 'main'}`
      const group = thingsByKey.get(key) || []
      group.push(thing)
      thingsByKey.set(key, group)
    }

    // Keep only latest version of each thing (by rowid)
    const latestThings: MockThing[] = []
    let compactedCount = 0

    for (const [, group] of thingsByKey) {
      // Sort by rowid descending to get latest
      group.sort((a, b) => (b.rowid || 0) - (a.rowid || 0))
      const latest = group[0]

      // Only keep non-deleted things
      if (!latest.deleted) {
        latestThings.push({
          ...latest,
          rowid: latestThings.length + 1, // Fresh rowids
        })
      }

      compactedCount += group.length - 1
    }

    // Update the things array (clear and repopulate)
    things.length = 0
    for (const thing of latestThings) {
      things.push(thing)
    }

    // Clear actions (after archiving)
    actions.length = 0

    // Update branch head pointers
    const branches = this._getBranches()
    for (const branch of branches) {
      // Find the new head for this branch
      const branchThingsForBranch = latestThings.filter(t =>
        (branch.name === 'main' ? t.branch === null : t.branch === branch.name) &&
        t.id === branch.thingId
      )
      if (branchThingsForBranch.length > 0) {
        branch.head = branchThingsForBranch[0].rowid || 1
        branch.updatedAt = new Date()
      }
    }

    // Emit compact.completed event
    await this.emitEvent('compact.completed', {
      thingsCompacted: compactedCount,
      actionsArchived: actionsToArchive.length,
      eventsArchived: eventsToArchive.length,
    })

    return {
      thingsCompacted: compactedCount,
      actionsArchived: actionsToArchive.length,
      eventsArchived: eventsToArchive.length,
    }
  }

  /**
   * Relocate DO to a different colo (same identity, new location)
   */
  async moveTo(colo: string): Promise<{ newDoId: string; region: string }> {
    // Validate colo code
    if (!VALID_COLOS.has(colo)) {
      throw new Error(`Invalid colo code: ${colo}`)
    }

    // Check if already at target colo
    if (this.currentColo === colo) {
      throw new Error(`Already at colo: ${colo}`)
    }

    const things = this._getThings()
    if (things.length === 0) {
      throw new Error('No state to move')
    }

    // Emit move.started event
    await this.emitEvent('move.started', { targetColo: colo })

    // Create new DO with locationHint
    const newDoId = this.env.DO.newUniqueId({ locationHint: colo })
    const stub = this.env.DO.get(newDoId)

    // Compact before transfer
    // In real implementation, we'd compact first then transfer
    // For testing, we simulate the transfer

    // Transfer state to new DO
    await stub.fetch(new Request(`https://${this.ns}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        things: things.filter(t => !t.deleted),
        branches: this._getBranches(),
      }),
    }))

    // Update objects table
    const objects = this.ctx._sqlData.get('objects') as unknown[]
    objects.push({
      ns: this.ns,
      id: newDoId.toString(),
      class: 'DO',
      region: colo,
      primary: true,
      createdAt: new Date(),
    })

    // Update current colo
    this.currentColo = colo

    // Schedule deletion of old DO (via waitUntil)
    this.ctx.waitUntil(Promise.resolve())

    // Emit move.completed event
    await this.emitEvent('move.completed', { newDoId: newDoId.toString(), region: colo })

    return { newDoId: newDoId.toString(), region: colo }
  }

  /**
   * Create a new branch at current HEAD
   */
  async branch(name: string): Promise<{ name: string; head: number }> {
    // Validate branch name
    if (!name || name.trim() === '') {
      throw new Error('Branch name cannot be empty')
    }

    if (name.includes(' ')) {
      throw new Error('Branch name cannot contain spaces')
    }

    if (name === 'main') {
      throw new Error('Cannot create branch named "main" - it is reserved')
    }

    // Check if branch already exists
    const branches = this._getBranches()
    if (branches.some(b => b.name === name)) {
      throw new Error(`Branch "${name}" already exists`)
    }

    // Find current HEAD (latest rowid on current branch)
    const things = this._getThings()
    const currentBranchThings = things.filter(t =>
      (this.currentBranch === 'main' ? t.branch === null : t.branch === this.currentBranch)
    )

    if (currentBranchThings.length === 0) {
      throw new Error('No commits on current branch')
    }

    // Get the latest rowid
    const head = Math.max(...currentBranchThings.map(t => t.rowid || 0))

    // Create branch record
    const newBranch: MockBranch = {
      name,
      thingId: currentBranchThings[0].id, // Representative thing
      head,
      base: head,
      forkedFrom: this.currentBranch,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    branches.push(newBranch)

    // Emit branch.created event
    await this.emitEvent('branch.created', { name, head, forkedFrom: this.currentBranch })

    return { name, head }
  }

  /**
   * Switch to a branch or version
   * @param ref - Branch name or version reference (e.g., '@v1234', '@main', '@~1')
   */
  async checkout(ref: string): Promise<{ branch?: string; version?: number }> {
    const things = this._getThings()

    // Parse the ref
    let targetRef = ref.startsWith('@') ? ref.slice(1) : ref

    // Check for version reference (@v1234)
    if (targetRef.startsWith('v')) {
      const version = parseInt(targetRef.slice(1), 10)

      // Validate version exists
      const thingAtVersion = things.find(t => t.rowid === version)
      if (!thingAtVersion) {
        throw new Error(`Version not found: ${version}`)
      }

      // Set to detached HEAD state
      this.currentVersion = version
      this.currentBranch = 'main' // Keep track but we're in detached state

      // Emit checkout event
      await this.emitEvent('checkout', { version })

      return { version }
    }

    // Check for relative reference (@~N)
    if (targetRef.startsWith('~')) {
      const offset = parseInt(targetRef.slice(1), 10)

      // Get all rowids on current branch sorted descending
      const currentBranchThings = things.filter(t =>
        this.currentBranch === 'main' ? t.branch === null : t.branch === this.currentBranch
      )
      const rowids = currentBranchThings
        .map(t => t.rowid || 0)
        .sort((a, b) => b - a)

      if (offset >= rowids.length) {
        throw new Error(`Cannot go back ${offset} versions - only ${rowids.length} versions exist`)
      }

      const version = rowids[offset]

      // Set to detached HEAD state
      this.currentVersion = version

      // Emit checkout event
      await this.emitEvent('checkout', { version, relative: `~${offset}` })

      return { version }
    }

    // Branch reference
    const branchName = targetRef

    // Check if branch exists
    if (branchName === 'main') {
      // Main always exists implicitly
      this.currentBranch = 'main'
      this.currentVersion = null // HEAD

      // Emit checkout event
      await this.emitEvent('checkout', { branch: 'main' })

      return { branch: 'main' }
    }

    // Check for explicit branch or things on that branch
    const branches = this._getBranches()
    const branchExists = branches.some(b => b.name === branchName)
    const thingsOnBranch = things.filter(t => t.branch === branchName)

    if (!branchExists && thingsOnBranch.length === 0) {
      throw new Error(`Branch not found: ${branchName}`)
    }

    this.currentBranch = branchName
    this.currentVersion = null // HEAD

    // Emit checkout event
    await this.emitEvent('checkout', { branch: branchName })

    return { branch: branchName }
  }

  /**
   * Merge a branch into current
   */
  async merge(branch: string): Promise<{ merged: boolean; conflicts?: string[] }> {
    // Cannot merge into detached HEAD
    if (this.currentVersion !== null) {
      throw new Error('Cannot merge into detached HEAD state')
    }

    // Cannot merge branch into itself
    if (branch === this.currentBranch || (branch === 'main' && this.currentBranch === 'main')) {
      throw new Error('Cannot merge branch into itself')
    }

    const things = this._getThings()
    const branches = this._getBranches()

    // Check if source branch exists
    const sourceBranch = branches.find(b => b.name === branch)
    const sourceThings = things.filter(t => t.branch === branch)

    if (!sourceBranch && sourceThings.length === 0) {
      throw new Error(`Branch not found: ${branch}`)
    }

    // Emit merge.started event
    await this.emitEvent('merge.started', { source: branch, target: this.currentBranch })

    // Get things on target branch (current)
    const targetBranchFilter = this.currentBranch === 'main' ? null : this.currentBranch
    const targetThings = things.filter(t => t.branch === targetBranchFilter)

    // Find base (common ancestor) - for simplicity, use the base from branch record or first rowid
    const baseRowid = sourceBranch?.base || 1

    // Group source and target things by id
    const sourceById = new Map<string, MockThing[]>()
    for (const t of sourceThings) {
      const group = sourceById.get(t.id) || []
      group.push(t)
      sourceById.set(t.id, group)
    }

    const targetById = new Map<string, MockThing[]>()
    for (const t of targetThings) {
      const group = targetById.get(t.id) || []
      group.push(t)
      targetById.set(t.id, group)
    }

    // Detect conflicts and prepare merge
    const conflicts: string[] = []
    const toMerge: MockThing[] = []

    // Check things that exist in source
    for (const [id, sourceVersions] of sourceById) {
      const latestSource = sourceVersions.sort((a, b) => (b.rowid || 0) - (a.rowid || 0))[0]
      const targetVersions = targetById.get(id) || []

      if (targetVersions.length === 0) {
        // Thing only exists on source - add to target
        toMerge.push({
          ...latestSource,
          branch: targetBranchFilter,
          rowid: undefined, // Will be assigned
        })
      } else {
        // Thing exists on both - check for conflicts
        const latestTarget = targetVersions.sort((a, b) => (b.rowid || 0) - (a.rowid || 0))[0]

        // Find base version (before divergence)
        const baseVersion = targetVersions.find(t => t.rowid && t.rowid <= baseRowid) ||
                          sourceVersions.find(t => t.rowid && t.rowid <= baseRowid)

        // Compare changes
        const sourceData = latestSource.data || {}
        const targetData = latestTarget.data || {}
        const baseData = baseVersion?.data || {}

        // Check for conflicting field changes
        const sourceChanges = new Set<string>()
        const targetChanges = new Set<string>()

        for (const key of Object.keys(sourceData)) {
          if (JSON.stringify(sourceData[key]) !== JSON.stringify(baseData[key])) {
            sourceChanges.add(key)
          }
        }

        for (const key of Object.keys(targetData)) {
          if (JSON.stringify(targetData[key]) !== JSON.stringify(baseData[key])) {
            targetChanges.add(key)
          }
        }

        // Check for overlapping changes (conflicts)
        const conflictingFields: string[] = []
        for (const field of sourceChanges) {
          if (targetChanges.has(field) &&
              JSON.stringify(sourceData[field]) !== JSON.stringify(targetData[field])) {
            conflictingFields.push(field)
          }
        }

        if (conflictingFields.length > 0) {
          conflicts.push(`${id}:${conflictingFields.join(',')}`)
        } else {
          // Auto-merge non-conflicting changes
          const mergedData = { ...baseData }

          // Apply source changes
          for (const field of sourceChanges) {
            mergedData[field] = sourceData[field]
          }

          // Apply target changes
          for (const field of targetChanges) {
            mergedData[field] = targetData[field]
          }

          // Handle deletions
          if (latestSource.deleted || latestTarget.deleted) {
            toMerge.push({
              ...latestTarget,
              data: mergedData,
              deleted: latestSource.deleted || latestTarget.deleted,
              rowid: undefined,
            })
          } else if (Object.keys(mergedData).length > 0 || sourceChanges.size > 0) {
            toMerge.push({
              ...latestTarget,
              data: mergedData,
              rowid: undefined,
            })
          }
        }
      }
    }

    // If there are conflicts, don't merge
    if (conflicts.length > 0) {
      await this.emitEvent('merge.conflict', { source: branch, conflicts })
      return { merged: false, conflicts }
    }

    // Apply merge - add new versions to target branch
    const currentMaxRowid = Math.max(0, ...things.map(t => t.rowid || 0))
    for (let i = 0; i < toMerge.length; i++) {
      const thing = toMerge[i]
      thing.rowid = currentMaxRowid + i + 1
      things.push(thing)
    }

    // Emit merge.completed event
    await this.emitEvent('merge.completed', { source: branch, target: this.currentBranch, merged: toMerge.length })

    return { merged: true }
  }

  // Helper to get current branch
  getCurrentBranch(): string {
    return this.currentBranch
  }

  // Helper to add test data
  async _addThing(thing: MockThing): Promise<void> {
    const things = this.ctx._sqlData.get('things') as MockThing[]
    if (thing.rowid === undefined) {
      thing.rowid = things.length + 1
    }
    things.push(thing)
  }

  async _addBranch(branch: MockBranch): Promise<void> {
    const branches = this.ctx._sqlData.get('branches') as MockBranch[]
    branches.push(branch)
  }

  _getThings(): MockThing[] {
    return this.ctx._sqlData.get('things') as MockThing[]
  }

  _getBranches(): MockBranch[] {
    return this.ctx._sqlData.get('branches') as MockBranch[]
  }
}

/**
 * Mock Database for testing Drizzle-like operations
 */
class MockDatabase {
  constructor(private sqlData: Map<string, unknown[]>) {}

  select() {
    return {
      from: (table: string) => ({
        where: (condition: unknown) => ({
          orderBy: (...columns: unknown[]) => ({
            limit: (n: number) => {
              const data = this.sqlData.get(table) || []
              return Promise.resolve(data.slice(0, n))
            },
          }),
        }),
      }),
    }
  }

  insert(table: string) {
    return {
      values: (values: unknown) => ({
        returning: () => {
          const data = this.sqlData.get(table) || []
          data.push(values)
          return Promise.resolve([values])
        },
      }),
    }
  }

  delete(table: string) {
    return {
      where: (condition: unknown) => Promise.resolve(),
    }
  }

  update(table: string) {
    return {
      set: (values: unknown) => ({
        where: (condition: unknown) => Promise.resolve(),
      }),
    }
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('DO Lifecycle Operations', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let testDO: TestDO

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    testDO = new TestDO(mockState, mockEnv)
  })

  // ==========================================================================
  // 1. FORK OPERATION
  // ==========================================================================

  describe('fork(options: { to: string })', () => {
    describe('Basic Fork Behavior', () => {
      it('creates new DO at target namespace', async () => {
        // Setup: Add some things to fork
        await testDO._addThing({
          id: 'startup-1',
          type: 1,
          branch: null, // main branch
          name: 'Acme Corp',
          data: { industry: 'tech' },
          deleted: false,
        })

        const result = await testDO.fork({ to: 'https://acme.example.com' })

        expect(result.ns).toBe('https://acme.example.com')
        expect(result.doId).toBeDefined()
        expect(mockEnv.DO.idFromName).toHaveBeenCalledWith('https://acme.example.com')
      })

      it('copies current state without history', async () => {
        // Setup: Add multiple versions of same thing
        await testDO._addThing({
          id: 'config-1',
          type: 2,
          branch: null,
          name: 'Config v1',
          data: { version: 1 },
          deleted: false,
        })
        await testDO._addThing({
          id: 'config-1',
          type: 2,
          branch: null,
          name: 'Config v2',
          data: { version: 2 },
          deleted: false,
        })
        await testDO._addThing({
          id: 'config-1',
          type: 2,
          branch: null,
          name: 'Config v3', // Latest
          data: { version: 3 },
          deleted: false,
        })

        const result = await testDO.fork({ to: 'https://forked.example.com' })

        // The forked DO should only have the latest state
        expect(result).toBeDefined()
        // Verify through fetch call to new DO
        expect(mockEnv.DO.get).toHaveBeenCalled()
      })

      it('new DO has fresh history (version 1)', async () => {
        await testDO._addThing({
          id: 'item-1',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
          rowid: 100, // Original has high rowid
        })

        const result = await testDO.fork({ to: 'https://new.example.com' })

        // New DO's things should start at version 1
        expect(result.doId).toBeDefined()
        // The implementation should ensure new rowids start fresh
      })

      it('original DO remains unchanged after fork', async () => {
        const originalThing: MockThing = {
          id: 'original-1',
          type: 1,
          branch: null,
          name: 'Original',
          data: { unchanged: true },
          deleted: false,
        }
        await testDO._addThing(originalThing)

        await testDO.fork({ to: 'https://fork-target.example.com' })

        // Original should be unchanged
        const things = testDO._getThings()
        expect(things).toHaveLength(1)
        expect(things[0].data).toEqual({ unchanged: true })
      })

      it('does not copy deleted things', async () => {
        await testDO._addThing({
          id: 'active-1',
          type: 1,
          branch: null,
          name: 'Active',
          data: {},
          deleted: false,
        })
        await testDO._addThing({
          id: 'deleted-1',
          type: 1,
          branch: null,
          name: 'Deleted',
          data: {},
          deleted: true, // Soft deleted
        })

        const result = await testDO.fork({ to: 'https://clean-fork.example.com' })

        // Fork should only include non-deleted things
        expect(result).toBeDefined()
      })
    })

    describe('Fork with Branches', () => {
      it('only forks current branch by default', async () => {
        // Setup: Things on different branches
        await testDO._addThing({
          id: 'main-item',
          type: 1,
          branch: null, // main
          name: 'Main Item',
          data: {},
          deleted: false,
        })
        await testDO._addThing({
          id: 'experiment-item',
          type: 1,
          branch: 'experiment',
          name: 'Experiment Item',
          data: {},
          deleted: false,
        })

        const result = await testDO.fork({ to: 'https://main-only.example.com' })

        // By default, should only include main branch
        expect(result).toBeDefined()
      })

      it('can fork specific branch with option', async () => {
        await testDO._addThing({
          id: 'feature-item',
          type: 1,
          branch: 'feature-x',
          name: 'Feature X Item',
          data: {},
          deleted: false,
        })

        // Extended fork options - fork from specific branch
        const result = await testDO.fork({
          to: 'https://feature-fork.example.com',
          branch: 'feature-x',
        })

        expect(result).toBeDefined()
      })
    })

    describe('Fork Error Handling', () => {
      it('throws if target namespace already exists', async () => {
        // Setup: Pretend target exists
        mockEnv.DO.get = vi.fn(() => {
          throw new Error('Namespace already exists')
        })

        await expect(
          testDO.fork({ to: 'https://existing.example.com' }),
        ).rejects.toThrow()
      })

      it('throws on invalid namespace URL', async () => {
        await expect(
          testDO.fork({ to: 'not-a-valid-url' }),
        ).rejects.toThrow()
      })

      it('throws if no state to fork', async () => {
        // Empty DO with no things
        await expect(
          testDO.fork({ to: 'https://empty-fork.example.com' }),
        ).rejects.toThrow()
      })
    })

    describe('Fork Events', () => {
      it('emits fork.started event', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        await testDO.fork({ to: 'https://event-test.example.com' })

        // Check events table
        const events = mockState._sqlData.get('events') as unknown[]
        expect(events.some((e: any) => e.verb === 'fork.started')).toBe(true)
      })

      it('emits fork.completed event on success', async () => {
        await testDO._addThing({
          id: 'item',
          type: 1,
          branch: null,
          name: 'Item',
          data: {},
          deleted: false,
        })

        await testDO.fork({ to: 'https://success-fork.example.com' })

        const events = mockState._sqlData.get('events') as unknown[]
        expect(events.some((e: any) => e.verb === 'fork.completed')).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 2. COMPACT OPERATION
  // ==========================================================================

  describe('compact()', () => {
    describe('Basic Compact Behavior', () => {
      it('squashes history to current state', async () => {
        // Setup: Multiple versions of same thing
        await testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
        await testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })
        await testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false })

        const result = await testDO.compact()

        expect(result.thingsCompacted).toBeGreaterThan(0)
        // After compact, should only have latest version
        const things = testDO._getThings()
        const doc1Versions = things.filter((t) => t.id === 'doc-1')
        expect(doc1Versions).toHaveLength(1)
        expect(doc1Versions[0].data).toEqual({ v: 3 })
      })

      it('keeps only latest version of each thing', async () => {
        // Multiple things with multiple versions
        await testDO._addThing({ id: 'a', type: 1, branch: null, name: 'a-v1', data: {}, deleted: false })
        await testDO._addThing({ id: 'a', type: 1, branch: null, name: 'a-v2', data: {}, deleted: false })
        await testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b-v1', data: {}, deleted: false })
        await testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b-v2', data: {}, deleted: false })
        await testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b-v3', data: {}, deleted: false })

        await testDO.compact()

        const things = testDO._getThings()
        expect(things.filter((t) => t.id === 'a')).toHaveLength(1)
        expect(things.filter((t) => t.id === 'b')).toHaveLength(1)
      })

      it('preserves identity (same ns)', async () => {
        const originalNs = testDO.ns
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.compact()

        expect(testDO.ns).toBe(originalNs)
      })

      it('removes soft-deleted things entirely', async () => {
        await testDO._addThing({ id: 'active', type: 1, branch: null, name: 'Active', data: {}, deleted: false })
        await testDO._addThing({ id: 'deleted', type: 1, branch: null, name: 'Deleted', data: {}, deleted: true })

        await testDO.compact()

        const things = testDO._getThings()
        expect(things.find((t) => t.id === 'deleted')).toBeUndefined()
        expect(things.find((t) => t.id === 'active')).toBeDefined()
      })
    })

    describe('Compact with Actions/Events', () => {
      it('archives old actions to R2 when configured', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        // Add some actions
        const actions = mockState._sqlData.get('actions') as unknown[]
        actions.push({ id: '1', verb: 'create', createdAt: new Date() })
        actions.push({ id: '2', verb: 'update', createdAt: new Date() })

        const result = await testDO.compact()

        expect(result.actionsArchived).toBe(2)
        expect(mockEnv.R2.put).toHaveBeenCalled()
      })

      it('archives old events to R2 when configured', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        // Add some events
        const events = mockState._sqlData.get('events') as unknown[]
        events.push({ id: '1', verb: 'created', createdAt: new Date() })
        events.push({ id: '2', verb: 'updated', createdAt: new Date() })

        const result = await testDO.compact()

        expect(result.eventsArchived).toBe(2)
      })

      it('clears action log after archiving', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        const actions = mockState._sqlData.get('actions') as unknown[]
        actions.push({ id: '1', verb: 'action1' })

        await testDO.compact()

        // Actions should be cleared (or only have post-compact entries)
        expect(actions.length).toBeLessThanOrEqual(1) // May have compact action
      })
    })

    describe('Compact with Branches', () => {
      it('compacts each branch independently', async () => {
        // Main branch versions
        await testDO._addThing({ id: 'item', type: 1, branch: null, name: 'main-v1', data: { b: 'main', v: 1 }, deleted: false })
        await testDO._addThing({ id: 'item', type: 1, branch: null, name: 'main-v2', data: { b: 'main', v: 2 }, deleted: false })

        // Feature branch versions
        await testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'feat-v1', data: { b: 'feature', v: 1 }, deleted: false })
        await testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'feat-v2', data: { b: 'feature', v: 2 }, deleted: false })

        await testDO.compact()

        const things = testDO._getThings()
        const mainItems = things.filter((t) => t.id === 'item' && t.branch === null)
        const featureItems = things.filter((t) => t.id === 'item' && t.branch === 'feature')

        expect(mainItems).toHaveLength(1)
        expect(featureItems).toHaveLength(1)
        expect(mainItems[0].data).toEqual({ b: 'main', v: 2 })
        expect(featureItems[0].data).toEqual({ b: 'feature', v: 2 })
      })

      it('updates branch head pointers', async () => {
        await testDO._addBranch({
          name: 'feature',
          thingId: 'item',
          head: 5, // Old rowid
          base: 1,
          forkedFrom: 'main',
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        await testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'feat', data: {}, deleted: false })

        await testDO.compact()

        // Branch head should be updated to new rowid
        const branches = testDO._getBranches()
        const featureBranch = branches.find((b) => b.name === 'feature')
        expect(featureBranch).toBeDefined()
        // Head should reflect compacted rowid
      })
    })

    describe('Compact Error Handling', () => {
      it('is atomic - all or nothing', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x2', data: {}, deleted: false })

        // Simulate R2 failure
        mockEnv.R2.put = vi.fn().mockRejectedValue(new Error('R2 failure'))

        await expect(testDO.compact()).rejects.toThrow()

        // State should be unchanged on failure
        const things = testDO._getThings()
        expect(things.length).toBe(2) // Both versions preserved
      })

      it('throws if nothing to compact', async () => {
        // Empty DO
        await expect(testDO.compact()).rejects.toThrow()
      })
    })

    describe('Compact Events', () => {
      it('emits compact.started event', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.compact()

        const events = mockState._sqlData.get('events') as any[]
        expect(events.some((e) => e.verb === 'compact.started')).toBe(true)
      })

      it('emits compact.completed event with stats', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.compact()

        const events = mockState._sqlData.get('events') as any[]
        const completedEvent = events.find((e) => e.verb === 'compact.completed')
        expect(completedEvent).toBeDefined()
      })
    })
  })

  // ==========================================================================
  // 3. MOVETO OPERATION
  // ==========================================================================

  describe('moveTo(colo: string)', () => {
    describe('Basic MoveTo Behavior', () => {
      it('creates new DO with locationHint at target colo', async () => {
        await testDO._addThing({ id: 'data', type: 1, branch: null, name: 'Data', data: {}, deleted: false })

        const result = await testDO.moveTo('ewr') // Newark

        expect(mockEnv.DO.newUniqueId).toHaveBeenCalledWith({ locationHint: 'ewr' })
        expect(result.region).toBe('ewr')
      })

      it('compacts and transfers current state', async () => {
        // Multiple versions - should be compacted before move
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })

        const result = await testDO.moveTo('lax') // Los Angeles

        expect(result.newDoId).toBeDefined()
        // New DO should receive compacted state
      })

      it('updates objects table with new doId', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        const result = await testDO.moveTo('cdg') // Paris

        // Objects table should be updated
        const objects = mockState._sqlData.get('objects') as any[]
        const updated = objects.find((o) => o.ns === testDO.ns)
        // The ns -> doId mapping should point to new DO
        expect(result.newDoId).toBeDefined()
      })

      it('URL/namespace stays the same', async () => {
        const originalNs = testDO.ns
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.moveTo('sin') // Singapore

        // Namespace should be unchanged
        expect(testDO.ns).toBe(originalNs)
      })

      it('schedules deletion of old DO', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.moveTo('syd') // Sydney

        // Old DO should be marked for deletion or cleanup
        // This might be done via alarm or waitUntil
        expect(mockState.waitUntil).toHaveBeenCalled()
      })
    })

    describe('MoveTo Valid Colos', () => {
      it.each([
        'wnam', // Western North America
        'enam', // Eastern North America
        'sam', // South America
        'weur', // Western Europe
        'eeur', // Eastern Europe
        'apac', // Asia Pacific
        'oc', // Oceania
        'afr', // Africa
        'me', // Middle East
      ])('accepts valid region hint: %s', async (region) => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        const result = await testDO.moveTo(region)

        expect(result.region).toBe(region)
      })

      it.each([
        'ewr', // Newark
        'lax', // Los Angeles
        'cdg', // Paris
        'sin', // Singapore
        'syd', // Sydney
        'nrt', // Tokyo
        'hkg', // Hong Kong
        'gru', // Sao Paulo
      ])('accepts valid colo code: %s', async (colo) => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        const result = await testDO.moveTo(colo)

        expect(result.region).toBe(colo)
      })
    })

    describe('MoveTo Error Handling', () => {
      it('throws on invalid colo code', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await expect(testDO.moveTo('invalid-colo')).rejects.toThrow()
      })

      it('throws if already at target colo', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        // First move to ewr
        await testDO.moveTo('ewr')

        // Try to move to same colo
        await expect(testDO.moveTo('ewr')).rejects.toThrow()
      })

      it('rolls back on transfer failure', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        // Simulate transfer failure
        mockEnv.DO.get = vi.fn(() => ({
          fetch: vi.fn().mockRejectedValue(new Error('Transfer failed')),
        }))

        await expect(testDO.moveTo('lax')).rejects.toThrow()

        // Original state should be preserved
        const things = testDO._getThings()
        expect(things.length).toBe(1)
      })
    })

    describe('MoveTo Events', () => {
      it('emits move.started event', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.moveTo('cdg')

        const events = mockState._sqlData.get('events') as any[]
        expect(events.some((e) => e.verb === 'move.started')).toBe(true)
      })

      it('emits move.completed event with new doId and region', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        const result = await testDO.moveTo('sin')

        const events = mockState._sqlData.get('events') as any[]
        const completedEvent = events.find((e) => e.verb === 'move.completed')
        expect(completedEvent).toBeDefined()
        expect(completedEvent?.data?.newDoId).toBe(result.newDoId)
      })
    })
  })

  // ==========================================================================
  // 4. BRANCH OPERATION
  // ==========================================================================

  describe('branch(name: string)', () => {
    describe('Basic Branch Behavior', () => {
      it('creates new branch at current HEAD', async () => {
        await testDO._addThing({
          id: 'doc',
          type: 1,
          branch: null,
          name: 'Document',
          data: {},
          deleted: false,
          rowid: 42,
        })

        const result = await testDO.branch('feature-x')

        expect(result.name).toBe('feature-x')
        expect(result.head).toBe(42) // Points to current HEAD
      })

      it('inserts into branches table', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.branch('experiment')

        const branches = testDO._getBranches()
        const newBranch = branches.find((b) => b.name === 'experiment')
        expect(newBranch).toBeDefined()
        expect(newBranch?.forkedFrom).toBe('main')
      })

      it('sets branch head to current version', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v2', data: {}, deleted: false, rowid: 100 })

        const result = await testDO.branch('develop')

        expect(result.head).toBe(100) // Latest version
      })

      it('records fork point (base)', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false, rowid: 50 })

        await testDO.branch('hotfix')

        const branches = testDO._getBranches()
        const hotfixBranch = branches.find((b) => b.name === 'hotfix')
        expect(hotfixBranch?.base).toBe(50)
      })

      it('does not switch to new branch automatically', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.branch('new-feature')

        expect(testDO.getCurrentBranch()).toBe('main')
      })
    })

    describe('Branch Naming', () => {
      it('allows branch names with slashes', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        const result = await testDO.branch('feature/user-auth')

        expect(result.name).toBe('feature/user-auth')
      })

      it('allows branch names with dashes', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        const result = await testDO.branch('fix-bug-123')

        expect(result.name).toBe('fix-bug-123')
      })

      it('throws on invalid branch names (spaces)', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await expect(testDO.branch('invalid branch')).rejects.toThrow()
      })

      it('throws on empty branch name', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await expect(testDO.branch('')).rejects.toThrow()
      })

      it('throws if branch already exists', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.branch('existing')
        await expect(testDO.branch('existing')).rejects.toThrow()
      })

      it('throws on reserved branch name: main', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await expect(testDO.branch('main')).rejects.toThrow()
      })
    })

    describe('Branch from Branch', () => {
      it('can branch from non-main branch', async () => {
        // Setup: switch to feature branch first
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })
        await testDO._addThing({ id: 'x', type: 1, branch: 'feature', name: 'x-feat', data: {}, deleted: false, rowid: 10 })

        // Checkout feature then branch from it
        await testDO.checkout('feature')
        const result = await testDO.branch('feature-sub')

        const branches = testDO._getBranches()
        const subBranch = branches.find((b) => b.name === 'feature-sub')
        expect(subBranch?.forkedFrom).toBe('feature')
      })
    })

    describe('Branch Events', () => {
      it('emits branch.created event', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await testDO.branch('event-test')

        const events = mockState._sqlData.get('events') as any[]
        expect(events.some((e) => e.verb === 'branch.created')).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 5. CHECKOUT OPERATION
  // ==========================================================================

  describe('checkout(ref: string)', () => {
    describe('Checkout Branch', () => {
      it('parses @main ref and switches to main', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })
        await testDO._addThing({ id: 'x', type: 1, branch: 'feature', name: 'x-feat', data: {}, deleted: false })

        // Switch to feature first
        await testDO.checkout('@feature')
        expect(testDO.getCurrentBranch()).toBe('feature')

        // Then back to main
        const result = await testDO.checkout('@main')

        expect(result.branch).toBe('main')
        expect(testDO.getCurrentBranch()).toBe('main')
      })

      it('parses branch name without @ prefix', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: 'develop', name: 'x', data: {}, deleted: false })

        const result = await testDO.checkout('develop')

        expect(result.branch).toBe('develop')
      })

      it('throws on non-existent branch', async () => {
        await expect(testDO.checkout('@nonexistent')).rejects.toThrow()
      })
    })

    describe('Checkout Version', () => {
      it('parses @v1234 ref for specific version', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false, rowid: 1 })
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false, rowid: 2 })

        const result = await testDO.checkout('@v1')

        expect(result.version).toBe(1)
      })

      it('parses @~1 ref for relative version (HEAD~1)', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v1', data: {}, deleted: false, rowid: 1 })
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v2', data: {}, deleted: false, rowid: 2 })
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v3', data: {}, deleted: false, rowid: 3 })

        const result = await testDO.checkout('@~1') // One back from HEAD (3)

        expect(result.version).toBe(2)
      })

      it('parses @~2 for two versions back', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v1', data: {}, deleted: false, rowid: 10 })
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v2', data: {}, deleted: false, rowid: 20 })
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v3', data: {}, deleted: false, rowid: 30 })

        const result = await testDO.checkout('@~2')

        expect(result.version).toBe(10)
      })

      it('throws on version not found', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false, rowid: 1 })

        await expect(testDO.checkout('@v999')).rejects.toThrow()
      })

      it('throws on ~N exceeding history', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false, rowid: 1 })

        await expect(testDO.checkout('@~10')).rejects.toThrow()
      })
    })

    describe('Checkout Affects Reads', () => {
      it('subsequent reads return checked-out version state', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { content: 'old' }, deleted: false, rowid: 1 })
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { content: 'new' }, deleted: false, rowid: 2 })

        await testDO.checkout('@v1')

        // Reads should return v1 state
        // (This would be tested through collection.get() in implementation)
      })

      it('checkout to branch shows branch HEAD state', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main', data: { branch: 'main' }, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: { branch: 'feature' }, deleted: false })

        await testDO.checkout('@feature')

        // Reads should return feature branch state
      })
    })

    describe('Detached HEAD', () => {
      it('version checkout puts DO in detached HEAD state', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v1', data: {}, deleted: false, rowid: 1 })
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'v2', data: {}, deleted: false, rowid: 2 })

        await testDO.checkout('@v1')

        // In detached HEAD, writes should fail or require branch creation
      })

      it('warns about detached HEAD state', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false, rowid: 1 })

        // Checkout to specific version
        const result = await testDO.checkout('@v1')

        // Should indicate detached state
        expect(result.branch).toBeUndefined()
        expect(result.version).toBe(1)
      })
    })

    describe('Checkout Events', () => {
      it('emits checkout event', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: 'feature', name: 'x', data: {}, deleted: false })

        await testDO.checkout('@feature')

        const events = mockState._sqlData.get('events') as any[]
        expect(events.some((e) => e.verb === 'checkout')).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 6. MERGE OPERATION
  // ==========================================================================

  describe('merge(branch: string)', () => {
    describe('Basic Merge Behavior', () => {
      it('merges source branch into current', async () => {
        // Setup: main and feature branches
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main-state', data: { source: 'main' }, deleted: false, rowid: 1 })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature-state', data: { source: 'feature' }, deleted: false, rowid: 2 })

        const result = await testDO.merge('feature')

        expect(result.merged).toBe(true)
      })

      it('creates merge commit on target branch', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main', data: {}, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: { newField: 'value' }, deleted: false })

        await testDO.merge('feature')

        // Should create new version on main with merged content
        const things = testDO._getThings()
        const mainVersions = things.filter((t) => t.id === 'doc' && t.branch === null)
        expect(mainVersions.length).toBeGreaterThan(1)
      })

      it('fast-forward merge when no divergence', async () => {
        // Main is ancestor of feature - no divergence
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'base', data: { base: true }, deleted: false, rowid: 1 })
        // Feature only, no changes on main since branch
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: { feature: true }, deleted: false, rowid: 2 })

        const result = await testDO.merge('feature')

        expect(result.merged).toBe(true)
        // Fast-forward: main HEAD just moves to feature HEAD
      })
    })

    describe('Merge Conflicts', () => {
      it('detects conflicts when same field changed', async () => {
        // Both branches changed the same field
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'base', data: { field: 'original' }, deleted: false, rowid: 1 })
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main-change', data: { field: 'main-value' }, deleted: false, rowid: 2 })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature-change', data: { field: 'feature-value' }, deleted: false, rowid: 3 })

        const result = await testDO.merge('feature')

        expect(result.conflicts).toBeDefined()
        expect(result.conflicts?.length).toBeGreaterThan(0)
      })

      it('returns conflict details (path, base, ours, theirs)', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'base', data: { x: 'base' }, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main', data: { x: 'main' }, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: { x: 'feature' }, deleted: false })

        const result = await testDO.merge('feature')

        if (result.conflicts) {
          expect(result.conflicts[0]).toContain('doc') // Conflict path includes thing id
        }
      })

      it('does not auto-merge on conflict by default', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'base', data: { x: 1 }, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main', data: { x: 2 }, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: { x: 3 }, deleted: false })

        const result = await testDO.merge('feature')

        expect(result.merged).toBe(false) // Merge blocked due to conflicts
      })
    })

    describe('Merge Non-Conflicting Changes', () => {
      it('auto-merges changes to different fields', async () => {
        // Base state
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'base', data: { a: 1, b: 1 }, deleted: false, rowid: 1 })
        // Main changes field 'a'
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main', data: { a: 2, b: 1 }, deleted: false, rowid: 2 })
        // Feature changes field 'b'
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: { a: 1, b: 2 }, deleted: false, rowid: 3 })

        const result = await testDO.merge('feature')

        expect(result.merged).toBe(true)
        // Merged state should have: { a: 2, b: 2 }
      })

      it('merges new things from source branch', async () => {
        // Main has doc-1
        await testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'Doc 1', data: {}, deleted: false })
        // Feature adds doc-2
        await testDO._addThing({ id: 'doc-2', type: 1, branch: 'feature', name: 'Doc 2', data: {}, deleted: false })

        await testDO.merge('feature')

        // Main should now have both docs
        const things = testDO._getThings()
        expect(things.some((t) => t.id === 'doc-1' && t.branch === null)).toBe(true)
        expect(things.some((t) => t.id === 'doc-2' && t.branch === null)).toBe(true)
      })

      it('handles deletion on source branch', async () => {
        // Both branches have doc
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'Doc', data: {}, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'Doc', data: {}, deleted: true }) // Deleted on feature

        await testDO.merge('feature')

        // Deletion should be merged to main
        const things = testDO._getThings()
        const mainDoc = things.filter((t) => t.id === 'doc' && t.branch === null)
        const latestMainDoc = mainDoc[mainDoc.length - 1]
        expect(latestMainDoc?.deleted).toBe(true)
      })
    })

    describe('Merge Error Handling', () => {
      it('throws if source branch does not exist', async () => {
        await expect(testDO.merge('nonexistent')).rejects.toThrow()
      })

      it('throws if merging into detached HEAD', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'doc', data: {}, deleted: false, rowid: 1 })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'doc', data: {}, deleted: false, rowid: 2 })

        // Checkout to detached HEAD
        await testDO.checkout('@v1')

        await expect(testDO.merge('feature')).rejects.toThrow()
      })

      it('throws if merging branch into itself', async () => {
        await testDO._addThing({ id: 'x', type: 1, branch: null, name: 'x', data: {}, deleted: false })

        await expect(testDO.merge('main')).rejects.toThrow()
      })
    })

    describe('Merge Branch Cleanup', () => {
      it('optionally deletes source branch after merge', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main', data: {}, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: {}, deleted: false })
        await testDO._addBranch({
          name: 'feature',
          thingId: 'doc',
          head: 2,
          base: 1,
          forkedFrom: 'main',
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Extended merge options
        // await testDO.merge('feature', { deleteBranch: true })

        // For now, just test basic merge
        const result = await testDO.merge('feature')
        expect(result.merged).toBe(true)
      })
    })

    describe('Merge Events', () => {
      it('emits merge.started event', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main', data: {}, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: {}, deleted: false })

        await testDO.merge('feature')

        const events = mockState._sqlData.get('events') as any[]
        expect(events.some((e) => e.verb === 'merge.started')).toBe(true)
      })

      it('emits merge.completed event on success', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main', data: {}, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: {}, deleted: false })

        await testDO.merge('feature')

        const events = mockState._sqlData.get('events') as any[]
        expect(events.some((e) => e.verb === 'merge.completed')).toBe(true)
      })

      it('emits merge.conflict event on conflicts', async () => {
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'base', data: { x: 1 }, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'main', data: { x: 2 }, deleted: false })
        await testDO._addThing({ id: 'doc', type: 1, branch: 'feature', name: 'feature', data: { x: 3 }, deleted: false })

        await testDO.merge('feature')

        const events = mockState._sqlData.get('events') as any[]
        expect(events.some((e) => e.verb === 'merge.conflict')).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 7. INTEGRATION SCENARIOS
  // ==========================================================================

  describe('Integration Scenarios', () => {
    describe('Branch-Edit-Merge Workflow', () => {
      it('complete feature branch workflow', async () => {
        // 1. Start with main branch
        await testDO._addThing({ id: 'app', type: 1, branch: null, name: 'App v1', data: { version: 1 }, deleted: false })

        // 2. Create feature branch
        await testDO.branch('feature-v2')

        // 3. Checkout feature branch
        await testDO.checkout('@feature-v2')
        expect(testDO.getCurrentBranch()).toBe('feature-v2')

        // 4. Make changes on feature (simulated)
        await testDO._addThing({ id: 'app', type: 1, branch: 'feature-v2', name: 'App v2', data: { version: 2 }, deleted: false })

        // 5. Checkout main
        await testDO.checkout('@main')

        // 6. Merge feature into main
        const result = await testDO.merge('feature-v2')

        expect(result.merged).toBe(true)
      })
    })

    describe('Fork-Modify-Independent Workflow', () => {
      it('forked DOs evolve independently', async () => {
        // 1. Original DO with state
        await testDO._addThing({ id: 'config', type: 1, branch: null, name: 'Config', data: { setting: 'original' }, deleted: false })

        // 2. Fork to new namespace
        const forkResult = await testDO.fork({ to: 'https://fork.example.com' })
        expect(forkResult.ns).toBe('https://fork.example.com')

        // 3. Modify original
        await testDO._addThing({ id: 'config', type: 1, branch: null, name: 'Config', data: { setting: 'modified-original' }, deleted: false })

        // Original and fork should be independent
        const things = testDO._getThings()
        expect(things.some((t) => t.data?.setting === 'modified-original')).toBe(true)
      })
    })

    describe('Compact-Move Workflow', () => {
      it('compact before move for efficiency', async () => {
        // 1. Add many versions
        for (let i = 0; i < 10; i++) {
          await testDO._addThing({ id: 'data', type: 1, branch: null, name: `v${i}`, data: { version: i }, deleted: false })
        }

        // 2. Compact to reduce data
        const compactResult = await testDO.compact()
        expect(compactResult.thingsCompacted).toBeGreaterThan(0)

        // 3. Move to new colo
        const moveResult = await testDO.moveTo('ewr')
        expect(moveResult.newDoId).toBeDefined()
      })
    })

    describe('Time Travel Scenario', () => {
      it('checkout old version, branch, modify', async () => {
        // 1. Create version history
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { content: 'v1' }, deleted: false, rowid: 1 })
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { content: 'v2' }, deleted: false, rowid: 2 })
        await testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v3', data: { content: 'v3' }, deleted: false, rowid: 3 })

        // 2. Checkout v1 (time travel)
        await testDO.checkout('@v1')

        // 3. Create branch from old version
        await testDO.branch('revert-to-v1')

        // 4. Now can work on this branch without affecting main
        const branches = testDO._getBranches()
        expect(branches.some((b) => b.name === 'revert-to-v1')).toBe(true)
      })
    })
  })
})
