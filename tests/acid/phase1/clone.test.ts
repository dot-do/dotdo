/**
 * ACID Test Suite - Phase 1: clone() - Comprehensive Clone Operations
 *
 * RED TDD: These tests define the expected behavior for clone() operations.
 * This is the foundation for Phase 2's advanced clone modes (atomic, eventual,
 * resumable, staged).
 *
 * The clone() operation supports:
 * - Full clone (complete state with all versions)
 * - Shallow clone (latest version only)
 * - Clone with specific branch
 * - Clone with submodules (nested DO references)
 *
 * ACID Properties Tested:
 * - Atomicity: Clone completes fully or not at all
 * - Consistency: Cloned state is identical to source
 * - Isolation: Clone doesn't affect source DO
 * - Durability: Cloned state persists at target
 *
 * @see objects/DOFull.ts for clone() implementation
 * @see objects/lifecycle/Clone.ts for CloneModule
 * @see tests/acid/phase2/ for advanced clone modes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../harness/do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS FOR CLONE API
// ============================================================================

/**
 * Options for the clone() operation
 */
interface CloneOptions {
  /** Include full version history (default: false - latest only) */
  includeHistory?: boolean
  /** Clone only a specific branch */
  branch?: string
  /** Location hint for target DO */
  colo?: string
  /** Correlation ID for tracing */
  correlationId?: string
  /** Clone depth (0 = shallow, undefined = full) */
  depth?: number
  /** Include submodule references */
  includeSubmodules?: boolean
  /** Recursively clone submodules */
  recursive?: boolean
}

/**
 * Result of a clone operation
 */
interface CloneResult {
  /** Target namespace URL */
  targetNs: string
  /** New DO ID */
  doId?: string
  /** Number of things cloned */
  clonedThings: number
  /** Number of relationships cloned */
  clonedRelationships: number
  /** Number of branches cloned */
  clonedBranches?: number
  /** Number of submodules cloned */
  clonedSubmodules?: number
  /** History entries cloned */
  clonedHistory?: number
  /** Duration in ms */
  durationMs?: number
}

/**
 * Clone event types
 */
type CloneEventType =
  | 'clone.started'
  | 'clone.completed'
  | 'clone.failed'
  | 'clone.progress'

/**
 * Branch record in the database
 */
interface BranchRecord {
  name: string
  thingId: string
  head: number
  base: number | null
  forkedFrom: string | null
  description: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Submodule record
 */
interface SubmoduleRecord {
  id: string
  path: string
  ns: string
  doId: string
  branch?: string
  commit?: string
  status: 'active' | 'detached' | 'uninitialized'
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample thing data for testing
 */
function createSampleThing(overrides: Partial<{
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  rowid: number
  version: number
}> = {}) {
  return {
    id: overrides.id ?? 'thing-001',
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? { key: 'value' },
    deleted: overrides.deleted ?? false,
    rowid: overrides.rowid ?? 1,
    version: overrides.version ?? 1,
  }
}

/**
 * Create sample relationship data
 */
function createSampleRelationship(overrides: Partial<{
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
}> = {}) {
  return {
    id: overrides.id ?? 'rel-001',
    verb: overrides.verb ?? 'relates-to',
    from: overrides.from ?? 'thing-001',
    to: overrides.to ?? 'thing-002',
    data: overrides.data ?? null,
  }
}

/**
 * Create sample branch data
 */
function createSampleBranch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    name: overrides.name ?? 'main',
    thingId: overrides.thingId ?? '',
    head: overrides.head ?? 1,
    base: overrides.base ?? null,
    forkedFrom: overrides.forkedFrom ?? null,
    description: overrides.description ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  }
}

/**
 * Create sample submodule data
 */
function createSampleSubmodule(overrides: Partial<SubmoduleRecord> = {}): SubmoduleRecord {
  return {
    id: overrides.id ?? 'submodule-001',
    path: overrides.path ?? '/modules/shared',
    ns: overrides.ns ?? 'https://shared.example.com',
    doId: overrides.doId ?? 'shared-do-id',
    branch: overrides.branch ?? 'main',
    commit: overrides.commit ?? undefined,
    status: overrides.status ?? 'active',
  }
}

// ============================================================================
// FULL CLONE TESTS
// ============================================================================

describe('ACID Phase 1: clone() - Full Clone Operations', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'source-do',
      ns: 'https://source.example.com',
    })

    // Set up comprehensive initial state
    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'customer-1', rowid: 1, name: 'Alice', data: { email: 'alice@example.com' }, version: 1 }),
      createSampleThing({ id: 'customer-1', rowid: 2, name: 'Alice Updated', data: { email: 'alice@example.com', verified: true }, version: 2 }),
      createSampleThing({ id: 'customer-1', rowid: 3, name: 'Alice Final', data: { email: 'alice@example.com', verified: true, premium: true }, version: 3 }),
      createSampleThing({ id: 'customer-2', rowid: 4, name: 'Bob', data: { email: 'bob@example.com' }, version: 1 }),
      createSampleThing({ id: 'order-1', rowid: 5, name: 'Order 1', data: { total: 100, items: ['item-1', 'item-2'] }, version: 1 }),
    ])

    mockResult.sqlData.set('relationships', [
      createSampleRelationship({ id: 'rel-1', from: 'customer-1', to: 'order-1', verb: 'placed' }),
      createSampleRelationship({ id: 'rel-2', from: 'order-1', to: 'customer-1', verb: 'belongs-to' }),
    ])

    mockResult.sqlData.set('branches', [
      createSampleBranch({ name: 'main', head: 5, base: null, forkedFrom: null }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC FULL CLONE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Full Clone Operations', () => {
    it('should clone state to target namespace', async () => {
      const result = await mockResult.instance.clone('https://target.example.com')

      expect(result).toHaveProperty('targetNs', 'https://target.example.com')
      expect(result.clonedThings).toBeGreaterThan(0)
    })

    it('should clone all things with history when includeHistory is true', async () => {
      let clonedData: { things?: unknown[] } = {}
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            clonedData = await req.json()
          }
          return new Response('OK')
        }),
      })

      const result = await mockResult.instance.clone('https://target.example.com', {
        includeHistory: true,
      })

      // Should include all 5 thing records (3 versions of customer-1 + customer-2 + order-1)
      expect(clonedData.things?.length).toBe(5)
      expect(result.clonedHistory).toBeGreaterThan(0)
    })

    it('should clone all relationships', async () => {
      const result = await mockResult.instance.clone('https://target.example.com')

      expect(result.clonedRelationships).toBe(2) // 2 relationships in source
    })

    it('should clone all branches', async () => {
      // Add feature branch
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      branches.push(createSampleBranch({ name: 'feature-x', head: 3, base: 2, forkedFrom: 'main' }))

      const result = await mockResult.instance.clone('https://target.example.com', {
        includeHistory: true,
      })

      expect(result.clonedBranches).toBe(2) // main + feature-x
    })

    it('should emit clone.started and clone.completed events', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.clone('https://target.example.com')

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('clone.started')
      expect(eventVerbs).toContain('clone.completed')
    })

    it('should return accurate clone statistics', async () => {
      const result = await mockResult.instance.clone('https://target.example.com', {
        includeHistory: true,
      })

      expect(result.clonedThings).toBe(5)
      expect(result.clonedRelationships).toBe(2)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL CLONE DATA INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full Clone Data Integrity', () => {
    it('should preserve all data fields during full clone', async () => {
      let clonedThings: Array<{ id: string; data: unknown }> = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: Array<{ id: string; data: unknown }> }
            clonedThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        includeHistory: true,
      })

      // Verify final version of customer-1
      const aliceFinal = clonedThings.find(t => t.id === 'customer-1' && (t.data as { premium?: boolean })?.premium === true)
      expect(aliceFinal).toBeDefined()
      expect((aliceFinal?.data as { email: string }).email).toBe('alice@example.com')
    })

    it('should preserve version ordering in history', async () => {
      let clonedThings: Array<{ id: string; rowid: number; version: number }> = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: Array<{ id: string; rowid: number; version: number }> }
            clonedThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        includeHistory: true,
      })

      // Customer-1 versions should be in order
      const customer1Versions = clonedThings
        .filter(t => t.id === 'customer-1')
        .sort((a, b) => a.rowid - b.rowid)

      expect(customer1Versions.length).toBe(3)
      expect(customer1Versions[0]?.version).toBe(1)
      expect(customer1Versions[1]?.version).toBe(2)
      expect(customer1Versions[2]?.version).toBe(3)
    })

    it('should preserve relationship data', async () => {
      let clonedRels: Array<{ id: string; verb: string; from: string; to: string }> = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { relationships?: Array<{ id: string; verb: string; from: string; to: string }> }
            clonedRels = body.relationships || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com')

      expect(clonedRels.find(r => r.verb === 'placed')).toBeDefined()
      expect(clonedRels.find(r => r.verb === 'belongs-to')).toBeDefined()
    })

    it('should preserve type information', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'typed-1', type: 5, data: { custom: true } }),
        createSampleThing({ id: 'typed-2', type: 10, data: { different: 'type' } }),
      ])

      let clonedThings: Array<{ id: string; type: number }> = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: Array<{ id: string; type: number }> }
            clonedThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com')

      expect(clonedThings.find(t => t.type === 5)).toBeDefined()
      expect(clonedThings.find(t => t.type === 10)).toBeDefined()
    })

    it('should preserve branch metadata', async () => {
      // Add branch with description
      mockResult.sqlData.set('branches', [
        createSampleBranch({
          name: 'main',
          head: 5,
          description: 'Main development branch',
        }),
        createSampleBranch({
          name: 'feature-auth',
          head: 3,
          base: 2,
          forkedFrom: 'main',
          description: 'Authentication feature',
        }),
      ])

      let clonedBranches: Array<{ name: string; description: string | null; forkedFrom: string | null }> = []

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { branches?: Array<{ name: string; description: string | null; forkedFrom: string | null }> }
            clonedBranches = body.branches || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', { includeHistory: true })

      const featureBranch = clonedBranches.find(b => b.name === 'feature-auth')
      expect(featureBranch?.description).toBe('Authentication feature')
      expect(featureBranch?.forkedFrom).toBe('main')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL CLONE ACID PROPERTIES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full Clone ACID Properties', () => {
    it('should complete clone atomically or not at all', async () => {
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockRejectedValue(new Error('Network error')),
      })

      await expect(mockResult.instance.clone('https://target.example.com'))
        .rejects.toThrow()

      // Source state should be unchanged
      const things = mockResult.sqlData.get('things') as unknown[]
      expect(things.length).toBe(5)
    })

    it('should maintain consistency between source and clone', async () => {
      let clonedData: { things?: unknown[]; relationships?: unknown[] } = {}

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            clonedData = await req.json()
          }
          return new Response('OK')
        }),
      })

      const sourceThings = mockResult.sqlData.get('things') as unknown[]
      const sourceRels = mockResult.sqlData.get('relationships') as unknown[]

      await mockResult.instance.clone('https://target.example.com', { includeHistory: true })

      expect(clonedData.things?.length).toBe(sourceThings.length)
      expect(clonedData.relationships?.length).toBe(sourceRels.length)
    })

    it('should isolate source from clone operations', async () => {
      const thingsBefore = [...(mockResult.sqlData.get('things') as unknown[])]
      const relsBefore = [...(mockResult.sqlData.get('relationships') as unknown[])]

      await mockResult.instance.clone('https://target.example.com')

      // Source should be unchanged
      const thingsAfter = mockResult.sqlData.get('things') as unknown[]
      const relsAfter = mockResult.sqlData.get('relationships') as unknown[]

      expect(thingsAfter.length).toBe(thingsBefore.length)
      expect(relsAfter.length).toBe(relsBefore.length)
    })

    it('should ensure durability at target before completing', async () => {
      let targetPersisted = false

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async () => {
          targetPersisted = true
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com')

      expect(targetPersisted).toBe(true)
    })
  })
})

// ============================================================================
// SHALLOW CLONE TESTS
// ============================================================================

describe('ACID Phase 1: clone() - Shallow Clone Operations', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'source-do',
      ns: 'https://source.example.com',
    })

    // Set up state with multiple versions
    mockResult.sqlData.set('things', [
      // customer-1 has 5 versions
      createSampleThing({ id: 'customer-1', rowid: 1, version: 1, data: { v: 1 } }),
      createSampleThing({ id: 'customer-1', rowid: 2, version: 2, data: { v: 2 } }),
      createSampleThing({ id: 'customer-1', rowid: 3, version: 3, data: { v: 3 } }),
      createSampleThing({ id: 'customer-1', rowid: 4, version: 4, data: { v: 4 } }),
      createSampleThing({ id: 'customer-1', rowid: 5, version: 5, data: { v: 5 } }), // Latest
      // customer-2 has 3 versions
      createSampleThing({ id: 'customer-2', rowid: 6, version: 1, data: { v: 1 } }),
      createSampleThing({ id: 'customer-2', rowid: 7, version: 2, data: { v: 2 } }),
      createSampleThing({ id: 'customer-2', rowid: 8, version: 3, data: { v: 3 } }), // Latest
      // order-1 has 1 version
      createSampleThing({ id: 'order-1', rowid: 9, version: 1, data: { v: 1 } }),
    ])

    mockResult.sqlData.set('relationships', [
      createSampleRelationship({ id: 'rel-1', from: 'customer-1', to: 'order-1', verb: 'placed' }),
    ])

    mockResult.sqlData.set('branches', [
      createSampleBranch({ name: 'main', head: 9 }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC SHALLOW CLONE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Shallow Clone Operations', () => {
    it('should only clone latest version by default (shallow)', async () => {
      let clonedData: { things?: unknown[] } = {}
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            clonedData = await req.json()
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com')

      // Should only clone 3 things (latest of each: customer-1 v5, customer-2 v3, order-1 v1)
      expect(clonedData.things?.length).toBe(3)
    })

    it('should clone latest version with depth=0 (explicit shallow)', async () => {
      let clonedData: { things?: unknown[] } = {}
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            clonedData = await req.json()
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        depth: 0,
      })

      expect(clonedData.things?.length).toBe(3)
    })

    it('should clone with limited depth when depth > 0', async () => {
      let clonedThings: Array<{ id: string; version: number }> = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: Array<{ id: string; version: number }> }
            clonedThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        depth: 2, // Last 2 versions
      })

      // customer-1: versions 4,5 (2 versions)
      // customer-2: versions 2,3 (2 versions)
      // order-1: version 1 (only 1 exists)
      const customer1Versions = clonedThings.filter(t => t.id === 'customer-1')
      const customer2Versions = clonedThings.filter(t => t.id === 'customer-2')
      const order1Versions = clonedThings.filter(t => t.id === 'order-1')

      expect(customer1Versions.length).toBe(2)
      expect(customer2Versions.length).toBe(2)
      expect(order1Versions.length).toBe(1)
    })

    it('should include all versions with depth=-1 (unlimited)', async () => {
      let clonedData: { things?: unknown[] } = {}
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            clonedData = await req.json()
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        depth: -1,
      })

      // Should clone all 9 things
      expect(clonedData.things?.length).toBe(9)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SHALLOW CLONE DATA INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Shallow Clone Data Integrity', () => {
    it('should preserve latest version data accurately', async () => {
      // Update source data to have distinct latest versions
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'item', rowid: 1, version: 1, data: { value: 'old' } }),
        createSampleThing({ id: 'item', rowid: 2, version: 2, data: { value: 'current' } }),
      ])

      let clonedThings: Array<{ data: { value: string } }> = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: Array<{ data: { value: string } }> }
            clonedThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', { depth: 0 })

      expect(clonedThings.length).toBe(1)
      expect(clonedThings[0]?.data.value).toBe('current')
    })

    it('should still clone all relationships in shallow mode', async () => {
      const result = await mockResult.instance.clone('https://target.example.com', {
        depth: 0,
      })

      expect(result.clonedRelationships).toBe(1)
    })

    it('should not include branch history in shallow clone', async () => {
      const result = await mockResult.instance.clone('https://target.example.com', {
        depth: 0,
      })

      // clonedHistory should be 0 or undefined for shallow clone
      expect(result.clonedHistory ?? 0).toBe(0)
    })

    it('should correctly report zero history in shallow clone stats', async () => {
      const result = await mockResult.instance.clone('https://target.example.com')

      // By default (shallow), no history is cloned
      expect(result.clonedHistory ?? 0).toBe(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SHALLOW CLONE ATOMICITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Shallow Clone Atomicity', () => {
    it('should complete shallow clone fully or not at all', async () => {
      let transferCount = 0
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async () => {
          transferCount++
          if (transferCount > 1) {
            throw new Error('Partial failure')
          }
          return new Response('OK')
        }),
      })

      await expect(mockResult.instance.clone('https://target.example.com'))
        .rejects.toThrow()
    })

    it('should emit clone.failed on shallow clone error', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockRejectedValue(new Error('Network error')),
      })

      await expect(mockResult.instance.clone('https://target.example.com'))
        .rejects.toThrow()

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('clone.started')
      expect(eventVerbs).not.toContain('clone.completed')
    })
  })
})

// ============================================================================
// CLONE WITH SPECIFIC BRANCH TESTS
// ============================================================================

describe('ACID Phase 1: clone() - Clone with Specific Branch', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'source-do',
      ns: 'https://source.example.com',
    })

    // Set up multi-branch state
    mockResult.sqlData.set('things', [
      // Main branch items
      createSampleThing({ id: 'main-item-1', rowid: 1, branch: null, data: { on: 'main' } }),
      createSampleThing({ id: 'main-item-2', rowid: 2, branch: null, data: { on: 'main' } }),
      createSampleThing({ id: 'shared-item', rowid: 3, branch: null, data: { version: 'main' } }),
      // Feature-auth branch items
      createSampleThing({ id: 'auth-item-1', rowid: 4, branch: 'feature-auth', data: { on: 'feature-auth' } }),
      createSampleThing({ id: 'auth-item-2', rowid: 5, branch: 'feature-auth', data: { on: 'feature-auth' } }),
      createSampleThing({ id: 'shared-item', rowid: 6, branch: 'feature-auth', data: { version: 'feature-auth' } }),
      // Feature-ui branch items
      createSampleThing({ id: 'ui-item-1', rowid: 7, branch: 'feature-ui', data: { on: 'feature-ui' } }),
      createSampleThing({ id: 'shared-item', rowid: 8, branch: 'feature-ui', data: { version: 'feature-ui' } }),
    ])

    mockResult.sqlData.set('relationships', [
      createSampleRelationship({ id: 'rel-main', from: 'main-item-1', to: 'main-item-2', verb: 'main-rel' }),
      createSampleRelationship({ id: 'rel-auth', from: 'auth-item-1', to: 'auth-item-2', verb: 'auth-rel' }),
      createSampleRelationship({ id: 'rel-ui', from: 'ui-item-1', to: 'shared-item', verb: 'ui-rel' }),
    ])

    mockResult.sqlData.set('branches', [
      createSampleBranch({ name: 'main', head: 3, base: null, forkedFrom: null }),
      createSampleBranch({ name: 'feature-auth', head: 6, base: 3, forkedFrom: 'main' }),
      createSampleBranch({ name: 'feature-ui', head: 8, base: 3, forkedFrom: 'main' }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC BRANCH CLONE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Branch Clone Operations', () => {
    it('should clone only main branch when branch="main"', async () => {
      let clonedThings: Array<{ id: string; branch: string | null }> = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: Array<{ id: string; branch: string | null }> }
            clonedThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        branch: 'main',
      })

      // Should only clone main branch items (null branch)
      expect(clonedThings.every(t => t.branch === null)).toBe(true)
      expect(clonedThings.length).toBe(3)
    })

    it('should clone only feature-auth branch when specified', async () => {
      let clonedThings: Array<{ id: string; branch: string | null }> = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: Array<{ id: string; branch: string | null }> }
            clonedThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        branch: 'feature-auth',
      })

      // Should only clone feature-auth branch items
      expect(clonedThings.every(t => t.branch === 'feature-auth')).toBe(true)
      expect(clonedThings.length).toBe(3)
    })

    it('should clone specified branch with history when includeHistory is true', async () => {
      // Add version history to feature-auth
      mockResult.sqlData.set('things', [
        ...(mockResult.sqlData.get('things') as unknown[]),
        createSampleThing({ id: 'auth-item-1', rowid: 10, branch: 'feature-auth', version: 2, data: { on: 'feature-auth', v: 2 } }),
      ])

      let clonedThings: Array<{ id: string; branch: string | null }> = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: Array<{ id: string; branch: string | null }> }
            clonedThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        branch: 'feature-auth',
        includeHistory: true,
      })

      // Should include history (4 items total: 3 original + 1 version)
      expect(clonedThings.length).toBe(4)
    })

    it('should only clone one branch metadata when branch is specified', async () => {
      let clonedBranches: Array<{ name: string }> = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { branches?: Array<{ name: string }> }
            clonedBranches = body.branches || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        branch: 'feature-ui',
      })

      // Should only include the specified branch
      expect(clonedBranches.length).toBe(1)
      expect(clonedBranches[0]?.name).toBe('feature-ui')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH CLONE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Branch Clone Validation', () => {
    it('should error when branch does not exist', async () => {
      await expect(mockResult.instance.clone('https://target.example.com', {
        branch: 'non-existent-branch',
      })).rejects.toThrow(/Branch .* does not exist|not found/)
    })

    it('should error when branch is empty string', async () => {
      await expect(mockResult.instance.clone('https://target.example.com', {
        branch: '',
      })).rejects.toThrow(/Invalid branch name|empty/)
    })

    it('should clone all branches when no branch is specified', async () => {
      let clonedData: { things?: unknown[] } = {}
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            clonedData = await req.json()
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com')

      // Should clone all branches (8 things total)
      expect(clonedData.things?.length).toBe(8)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH CLONE RELATIONSHIPS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Branch Clone Relationships', () => {
    it('should only clone relationships for the specified branch', async () => {
      // Set up branch-specific relationships
      mockResult.sqlData.set('relationships', [
        createSampleRelationship({ id: 'rel-main', from: 'main-item-1', to: 'main-item-2', verb: 'main-rel' }),
        createSampleRelationship({ id: 'rel-auth-1', from: 'auth-item-1', to: 'auth-item-2', verb: 'auth-rel' }),
        createSampleRelationship({ id: 'rel-auth-2', from: 'auth-item-2', to: 'shared-item', verb: 'uses' }),
      ])

      let clonedRels: Array<{ id: string }> = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { relationships?: Array<{ id: string }> }
            clonedRels = body.relationships || []
          }
          return new Response('OK')
        }),
      })

      const result = await mockResult.instance.clone('https://target.example.com', {
        branch: 'feature-auth',
      })

      // Should only clone relationships involving feature-auth items
      expect(result.clonedRelationships).toBe(2)
      expect(clonedRels.find(r => r.id === 'rel-main')).toBeUndefined()
    })

    it('should handle shared items across branches correctly', async () => {
      let clonedThings: Array<{ id: string; data: { version: string } }> = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { things?: Array<{ id: string; data: { version: string } }> }
            clonedThings = body.things || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        branch: 'feature-ui',
      })

      // shared-item should have feature-ui version, not main
      const sharedItem = clonedThings.find(t => t.id === 'shared-item')
      expect(sharedItem?.data.version).toBe('feature-ui')
    })
  })
})

// ============================================================================
// CLONE WITH SUBMODULES TESTS
// ============================================================================

describe('ACID Phase 1: clone() - Clone with Submodules', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'source-do',
      ns: 'https://source.example.com',
    })

    // Set up state with submodules
    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'main-item', rowid: 1, data: { name: 'Main' } }),
      createSampleThing({ id: 'uses-shared', rowid: 2, data: { module: '/modules/shared' } }),
    ])

    mockResult.sqlData.set('submodules', [
      createSampleSubmodule({
        id: 'submod-1',
        path: '/modules/shared',
        ns: 'https://shared.example.com',
        doId: 'shared-do-id',
        branch: 'main',
        status: 'active',
      }),
      createSampleSubmodule({
        id: 'submod-2',
        path: '/modules/auth',
        ns: 'https://auth.example.com',
        doId: 'auth-do-id',
        branch: 'v2',
        status: 'active',
      }),
      createSampleSubmodule({
        id: 'submod-3',
        path: '/modules/legacy',
        ns: 'https://legacy.example.com',
        doId: 'legacy-do-id',
        status: 'detached',
      }),
    ])

    mockResult.sqlData.set('relationships', [
      createSampleRelationship({ id: 'rel-1', from: 'main-item', to: 'uses-shared', verb: 'contains' }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC SUBMODULE CLONE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Submodule Clone Operations', () => {
    it('should include submodule references when includeSubmodules is true', async () => {
      let clonedSubmodules: SubmoduleRecord[] = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { submodules?: SubmoduleRecord[] }
            clonedSubmodules = body.submodules || []
          }
          return new Response('OK')
        }),
      })

      const result = await mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
      })

      expect(clonedSubmodules.length).toBe(3)
      expect(result.clonedSubmodules).toBe(3)
    })

    it('should not include submodules by default', async () => {
      let clonedSubmodules: SubmoduleRecord[] = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { submodules?: SubmoduleRecord[] }
            clonedSubmodules = body.submodules || []
          }
          return new Response('OK')
        }),
      })

      const result = await mockResult.instance.clone('https://target.example.com')

      expect(clonedSubmodules.length).toBe(0)
      expect(result.clonedSubmodules ?? 0).toBe(0)
    })

    it('should preserve submodule metadata', async () => {
      let clonedSubmodules: SubmoduleRecord[] = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { submodules?: SubmoduleRecord[] }
            clonedSubmodules = body.submodules || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
      })

      const sharedModule = clonedSubmodules.find(s => s.path === '/modules/shared')
      expect(sharedModule?.ns).toBe('https://shared.example.com')
      expect(sharedModule?.branch).toBe('main')
      expect(sharedModule?.status).toBe('active')

      const authModule = clonedSubmodules.find(s => s.path === '/modules/auth')
      expect(authModule?.branch).toBe('v2')
    })

    it('should include detached submodules', async () => {
      let clonedSubmodules: SubmoduleRecord[] = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { submodules?: SubmoduleRecord[] }
            clonedSubmodules = body.submodules || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
      })

      const legacyModule = clonedSubmodules.find(s => s.path === '/modules/legacy')
      expect(legacyModule?.status).toBe('detached')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RECURSIVE SUBMODULE CLONE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Recursive Submodule Clone', () => {
    it('should recursively clone submodules when recursive is true', async () => {
      const clonedDOs: string[] = []
      mockResult.env.DO.get = vi.fn().mockImplementation((id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          clonedDOs.push(id.toString())
          return new Response('OK')
        }),
      }))

      await mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
        recursive: true,
      })

      // Should have cloned main DO + submodule DOs
      expect(clonedDOs.length).toBeGreaterThan(1)
    })

    it('should not recursively clone when recursive is false', async () => {
      const clonedDOs: string[] = []
      mockResult.env.DO.get = vi.fn().mockImplementation((id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          clonedDOs.push(id.toString())
          return new Response('OK')
        }),
      }))

      await mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
        recursive: false,
      })

      // Should have cloned only main DO (submodules are references only)
      expect(clonedDOs.length).toBe(1)
    })

    it('should emit progress events during recursive clone', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })

      await mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
        recursive: true,
      })

      const eventVerbs = events.map(e => e.verb)
      // Should have progress events for recursive operations
      expect(eventVerbs.some(v => v === 'clone.progress' || v === 'clone.completed')).toBe(true)
    })

    it('should handle recursive clone failure gracefully', async () => {
      let callCount = 0
      mockResult.env.DO.get = vi.fn().mockImplementation(() => ({
        id: { toString: () => `target-id-${callCount++}` },
        fetch: vi.fn().mockImplementation(async () => {
          if (callCount > 2) {
            throw new Error('Submodule clone failed')
          }
          return new Response('OK')
        }),
      }))

      await expect(mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
        recursive: true,
      })).rejects.toThrow()
    })

    it('should skip uninitialized submodules during recursive clone', async () => {
      // Add uninitialized submodule
      const submodules = mockResult.sqlData.get('submodules') as SubmoduleRecord[]
      submodules.push(createSampleSubmodule({
        id: 'submod-uninit',
        path: '/modules/new',
        ns: 'https://new.example.com',
        doId: 'new-do-id',
        status: 'uninitialized',
      }))

      const clonedDOs: string[] = []
      mockResult.env.DO.get = vi.fn().mockImplementation((id) => ({
        id,
        fetch: vi.fn().mockImplementation(async () => {
          clonedDOs.push(id.toString())
          return new Response('OK')
        }),
      }))

      await mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
        recursive: true,
      })

      // Should not have attempted to clone uninitialized submodule
      expect(clonedDOs.some(id => id.includes('new-do-id'))).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBMODULE CLONE ATOMICITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Submodule Clone Atomicity', () => {
    it('should rollback all submodule clones on failure', async () => {
      let successfulClones = 0
      mockResult.env.DO.get = vi.fn().mockImplementation(() => ({
        id: { toString: () => `target-${successfulClones}` },
        fetch: vi.fn().mockImplementation(async () => {
          successfulClones++
          if (successfulClones === 2) {
            throw new Error('Clone failed mid-way')
          }
          return new Response('OK')
        }),
      }))

      await expect(mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
        recursive: true,
      })).rejects.toThrow()

      // Source should be unchanged
      const submodules = mockResult.sqlData.get('submodules') as SubmoduleRecord[]
      expect(submodules.length).toBe(3)
    })

    it('should maintain referential integrity of submodules', async () => {
      let clonedSubmodules: SubmoduleRecord[] = []
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            const body = await req.json() as { submodules?: SubmoduleRecord[] }
            clonedSubmodules = body.submodules || []
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com', {
        includeSubmodules: true,
      })

      // All submodules should have valid references
      for (const submodule of clonedSubmodules) {
        expect(submodule.ns).toBeTruthy()
        expect(submodule.path).toBeTruthy()
        expect(submodule.id).toBeTruthy()
      }
    })
  })
})

// ============================================================================
// CLONE VALIDATION TESTS
// ============================================================================

describe('ACID Phase 1: clone() - Validation', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'source-do',
      ns: 'https://source.example.com',
    })

    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'item-1' }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Target Namespace Validation', () => {
    it('should validate target namespace URL', async () => {
      await expect(mockResult.instance.clone('not-a-valid-url'))
        .rejects.toThrow(/Invalid.*URL|Invalid target/)
    })

    it('should handle empty target', async () => {
      await expect(mockResult.instance.clone(''))
        .rejects.toThrow(/Invalid|empty/)
    })

    it('should handle null target', async () => {
      await expect(mockResult.instance.clone(null as unknown as string))
        .rejects.toThrow(/Invalid|null/)
    })

    it('should accept valid HTTPS URL', async () => {
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })

      const result = await mockResult.instance.clone('https://target.example.com')
      expect(result.targetNs).toBe('https://target.example.com')
    })

    it('should handle cross-region targets', async () => {
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })

      const result = await mockResult.instance.clone('https://target.eu.example.com')
      expect(result.targetNs).toBe('https://target.eu.example.com')
    })
  })

  describe('Clone Options Validation', () => {
    it('should validate depth option', async () => {
      await expect(mockResult.instance.clone('https://target.example.com', {
        depth: -2, // Only -1, 0, and positive are valid
      })).rejects.toThrow(/Invalid depth/)
    })

    it('should accept valid depth values', async () => {
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })

      // depth: 0 (shallow)
      await expect(mockResult.instance.clone('https://target1.example.com', { depth: 0 }))
        .resolves.toBeDefined()

      // depth: -1 (unlimited)
      await expect(mockResult.instance.clone('https://target2.example.com', { depth: -1 }))
        .resolves.toBeDefined()

      // depth: 5 (limited)
      await expect(mockResult.instance.clone('https://target3.example.com', { depth: 5 }))
        .resolves.toBeDefined()
    })

    it('should use location hint when colo is specified', async () => {
      mockResult.env.DO.newUniqueId = vi.fn().mockReturnValue({
        toString: () => 'new-id-ewr',
      })

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })

      await mockResult.instance.clone('https://target.example.com', {
        colo: 'ewr',
      })

      expect(mockResult.env.DO.newUniqueId).toHaveBeenCalledWith(
        expect.objectContaining({ locationHint: 'ewr' })
      )
    })
  })
})

// ============================================================================
// LARGE STATE HANDLING TESTS
// ============================================================================

describe('ACID Phase 1: clone() - Large State Handling', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'source-do',
      ns: 'https://source.example.com',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Large Dataset Clone', () => {
    it('should handle large number of things efficiently', async () => {
      // Create 1000 things
      const manyThings = Array.from({ length: 1000 }, (_, i) =>
        createSampleThing({
          id: `thing-${i}`,
          rowid: i + 1,
          data: { index: i, timestamp: Date.now() },
        })
      )
      mockResult.sqlData.set('things', manyThings)

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })

      const result = await mockResult.instance.clone('https://target.example.com')

      expect(result.clonedThings).toBe(1000)
    })

    it('should handle things with large data', async () => {
      // Create thing with large data (10KB)
      const largeData = { content: 'x'.repeat(10000), metadata: { size: 10000 } }
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'large-thing', data: largeData }),
      ])

      let clonedData: { things?: Array<{ data: { content: string } }> } = {}
      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          if (req.method === 'POST') {
            clonedData = await req.json()
          }
          return new Response('OK')
        }),
      })

      await mockResult.instance.clone('https://target.example.com')

      expect(clonedData.things?.[0]?.data.content.length).toBe(10000)
    })

    it('should handle large number of relationships', async () => {
      // Create 500 relationships
      const manyRels = Array.from({ length: 500 }, (_, i) =>
        createSampleRelationship({
          id: `rel-${i}`,
          from: `thing-${i}`,
          to: `thing-${i + 1}`,
          verb: i % 2 === 0 ? 'links-to' : 'depends-on',
        })
      )
      mockResult.sqlData.set('relationships', manyRels)

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })

      const result = await mockResult.instance.clone('https://target.example.com')

      expect(result.clonedRelationships).toBe(500)
    })

    it('should emit progress events for large clones', async () => {
      // Create large dataset
      const manyThings = Array.from({ length: 500 }, (_, i) =>
        createSampleThing({ id: `thing-${i}`, rowid: i + 1 })
      )
      mockResult.sqlData.set('things', manyThings)

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })

      await mockResult.instance.clone('https://target.example.com')

      // Should have progress events for large datasets
      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs.some(v => v === 'clone.progress' || v === 'clone.completed')).toBe(true)
    })
  })

  describe('Clone Performance', () => {
    it('should complete clone within reasonable time', async () => {
      const things = Array.from({ length: 100 }, (_, i) =>
        createSampleThing({ id: `thing-${i}`, rowid: i + 1 })
      )
      mockResult.sqlData.set('things', things)

      mockResult.env.DO.get = vi.fn().mockReturnValue({
        id: { toString: () => 'target-id' },
        fetch: vi.fn().mockResolvedValue(new Response('OK')),
      })

      const startTime = Date.now()
      const result = await mockResult.instance.clone('https://target.example.com')
      const endTime = Date.now()

      expect(endTime - startTime).toBeLessThan(5000) // Should complete in under 5 seconds
      expect(result.durationMs).toBeDefined()
    })
  })
})
