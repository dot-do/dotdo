/**
 * Cascade Chain Resolution via Relationships Tests
 *
 * RED PHASE: Tests for resolving function cascade chains (Code -> Generative -> Agentic -> Human)
 * via graph Relationships using a dedicated CascadeChainResolver class.
 *
 * @see dotdo-pc1at - [RED] Cascade Chain Resolution via Relationships Tests
 *
 * These tests use real SQLite via SQLiteGraphStore - NO MOCKS.
 *
 * Cascade Model:
 * Functions are linked via 'cascadesTo' relationships with priority and condition data.
 * The cascade chain represents fallback execution order:
 * 1. Code (fastest, cheapest, deterministic)
 * 2. Generative (AI inference, single call)
 * 3. Agentic (AI + tools, multi-step)
 * 4. Human (slowest, most expensive, guaranteed judgment)
 *
 * Test Categories:
 * 1. Chain Definition - Creating cascade relationships
 * 2. Chain Resolution - Resolving next function in chain
 * 3. Chain Traversal - Building full cascade path
 * 4. Priority Ordering - Handling multiple fallback options
 * 5. Observability - Querying cascade paths for monitoring
 * 6. CascadeChainResolver Class Tests (RED - to be implemented)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import type { GraphRelationship, GraphThing } from '../types'

// ============================================================================
// CASCADE CHAIN RESOLVER INTERFACE (to be implemented)
// ============================================================================

/**
 * CascadeChainResolver resolves function cascade chains via graph relationships.
 * This interface defines the contract for cascade chain resolution.
 */
export interface CascadeChainResolver {
  /**
   * Resolve the next function in the cascade chain.
   * Returns null when no cascadesTo relationship exists.
   */
  resolveNext(functionId: string): Promise<GraphThing | null>

  /**
   * Build the full cascade path starting from a function.
   * Returns all functions in order from start to end of chain.
   */
  buildCascadePath(functionId: string, options?: CascadePathOptions): Promise<CascadePathEntry[]>

  /**
   * Check if cascade chain has cycles (circular references).
   */
  detectCycle(functionId: string): Promise<boolean>

  /**
   * Get all possible cascade targets with priorities (for branching cascades).
   */
  getCascadeTargets(functionId: string): Promise<CascadeTarget[]>

  /**
   * Find the terminal function in the cascade chain (typically Human).
   */
  findTerminal(functionId: string, maxDepth?: number): Promise<GraphThing | null>

  /**
   * Get cascade chain statistics for observability.
   */
  getCascadeStats(functionId: string): Promise<CascadeChainStats>

  /**
   * Get all paths from start to a specific target function.
   */
  findPathsTo(startId: string, targetId: string): Promise<CascadePath[]>

  /**
   * Validate cascade chain structure (no orphans, valid priorities, etc.)
   */
  validateChain(functionId: string): Promise<CascadeValidationResult>
}

export interface CascadePathOptions {
  /** Maximum depth to traverse (default: 100) */
  maxDepth?: number
  /** Only follow cascades matching this condition */
  condition?: string
  /** Include disabled functions in path */
  includeDisabled?: boolean
  /** Include relationship data in path entries */
  includeRelationships?: boolean
  /** Filter by function types */
  types?: Array<'code' | 'generative' | 'agentic' | 'human'>
}

export interface CascadePathEntry {
  /** The function at this position in the chain */
  function: GraphThing
  /** The relationship that led to this function (null for first entry) */
  relationship: GraphRelationship | null
  /** Depth in the cascade chain (0-indexed) */
  depth: number
  /** Function type (code, generative, agentic, human) */
  type: 'code' | 'generative' | 'agentic' | 'human'
}

export interface CascadeTarget {
  /** Target function */
  function: GraphThing
  /** The cascade relationship */
  relationship: GraphRelationship
  /** Priority (lower = higher priority, executed first) */
  priority: number
  /** Optional condition for when to use this cascade */
  condition?: string
}

export interface CascadeChainStats {
  /** Total length of the cascade chain */
  chainLength: number
  /** Function types in order */
  typeSequence: Array<'code' | 'generative' | 'agentic' | 'human'>
  /** Whether chain has cycles */
  hasCycle: boolean
  /** Total branching factor (count of all cascadesTo relationships) */
  branchingFactor: number
  /** Maximum depth reached */
  maxDepth: number
  /** IDs of all functions in the chain */
  functionIds: string[]
  /** Disabled functions in chain */
  disabledCount: number
}

export interface CascadePath {
  /** Path entries from start to target */
  entries: CascadePathEntry[]
  /** Total priority sum along path */
  totalPriority: number
  /** Whether path passes through disabled functions */
  hasDisabled: boolean
}

export interface CascadeValidationResult {
  /** Overall validation passed */
  valid: boolean
  /** List of validation errors */
  errors: CascadeValidationError[]
  /** List of validation warnings */
  warnings: CascadeValidationWarning[]
}

export interface CascadeValidationError {
  code: 'CYCLE_DETECTED' | 'ORPHAN_FUNCTION' | 'MISSING_TARGET' | 'DUPLICATE_PRIORITY' | 'INVALID_TYPE_ORDER'
  message: string
  functionId?: string
  relationshipId?: string
}

export interface CascadeValidationWarning {
  code: 'DISABLED_IN_PATH' | 'DEEP_CHAIN' | 'HIGH_BRANCHING' | 'NO_TERMINAL'
  message: string
  functionId?: string
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Helper to create a function Thing for tests
 */
async function createFunction(
  store: SQLiteGraphStore,
  name: string,
  type: 'code' | 'generative' | 'agentic' | 'human',
  options?: { enabled?: boolean; id?: string }
): Promise<GraphThing> {
  const typeIdMap = {
    code: 100,
    generative: 101,
    agentic: 102,
    human: 103,
  }

  const typeNameMap = {
    code: 'CodeFunction',
    generative: 'GenerativeFunction',
    agentic: 'AgenticFunction',
    human: 'HumanFunction',
  }

  const id = options?.id ?? `${type}-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return store.createThing({
    id,
    typeId: typeIdMap[type],
    typeName: typeNameMap[type],
    data: {
      name,
      type,
      enabled: options?.enabled ?? true,
      version: '1.0.0',
    },
  })
}

/**
 * Helper to create a cascadesTo relationship
 */
async function createCascadeRelationship(
  store: SQLiteGraphStore,
  from: string,
  to: string,
  options?: { priority?: number; condition?: string; metadata?: Record<string, unknown> }
): Promise<GraphRelationship> {
  const priority = options?.priority ?? 0
  const relId = `cascade-${from}-${to}-${Date.now()}`

  return store.createRelationship({
    id: relId,
    verb: 'cascadesTo',
    from: `do://functions/${from}`,
    to: `do://functions/${to}`,
    data: {
      priority,
      condition: options?.condition,
      metadata: options?.metadata,
    },
  })
}

// ============================================================================
// 1. CHAIN DEFINITION TESTS
// ============================================================================

describe('Cascade Chain via Relationships', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Chain Definition', () => {
    it('links Code function to Generative via cascadesTo', async () => {
      // Create functions
      const codeFunc = await createFunction(store, 'processOrder', 'code')
      const generativeFunc = await createFunction(store, 'processOrder', 'generative')

      // Create cascade relationship
      const rel = await createCascadeRelationship(store, codeFunc.id, generativeFunc.id, {
        priority: 1,
        condition: 'on-error',
      })

      // Verify relationship was created
      expect(rel.verb).toBe('cascadesTo')
      expect(rel.from).toBe(`do://functions/${codeFunc.id}`)
      expect(rel.to).toBe(`do://functions/${generativeFunc.id}`)
      expect(rel.data).toEqual({
        priority: 1,
        condition: 'on-error',
      })

      // Query relationships from code function
      const rels = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`)
      expect(rels).toHaveLength(1)
      expect(rels[0]!.verb).toBe('cascadesTo')
    })

    it('creates full cascade chain Code -> Generative -> Agentic -> Human', async () => {
      // Create all four function types
      const codeFunc = await createFunction(store, 'processOrder', 'code')
      const generativeFunc = await createFunction(store, 'processOrder', 'generative')
      const agenticFunc = await createFunction(store, 'processOrder', 'agentic')
      const humanFunc = await createFunction(store, 'processOrder', 'human')

      // Link them in cascade order
      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id, {
        priority: 1,
        condition: 'on-error',
      })
      await createCascadeRelationship(store, generativeFunc.id, agenticFunc.id, {
        priority: 1,
        condition: 'on-error',
      })
      await createCascadeRelationship(store, agenticFunc.id, humanFunc.id, {
        priority: 1,
        condition: 'on-error',
      })

      // Query all cascadesTo relationships
      const allCascades = await store.queryRelationshipsByVerb('cascadesTo')
      expect(allCascades).toHaveLength(3)

      // Verify chain structure by querying from each function
      const fromCode = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(fromCode).toHaveLength(1)
      expect(fromCode[0]!.to).toBe(`do://functions/${generativeFunc.id}`)

      const fromGenerative = await store.queryRelationshipsFrom(`do://functions/${generativeFunc.id}`, {
        verb: 'cascadesTo',
      })
      expect(fromGenerative).toHaveLength(1)
      expect(fromGenerative[0]!.to).toBe(`do://functions/${agenticFunc.id}`)

      const fromAgentic = await store.queryRelationshipsFrom(`do://functions/${agenticFunc.id}`, {
        verb: 'cascadesTo',
      })
      expect(fromAgentic).toHaveLength(1)
      expect(fromAgentic[0]!.to).toBe(`do://functions/${humanFunc.id}`)

      // Human should have no outgoing cascades (terminal)
      const fromHuman = await store.queryRelationshipsFrom(`do://functions/${humanFunc.id}`, { verb: 'cascadesTo' })
      expect(fromHuman).toHaveLength(0)
    })

    it('supports partial chains (e.g., Code -> Human with no Generative)', async () => {
      // Create only Code and Human functions
      const codeFunc = await createFunction(store, 'emergencyApproval', 'code')
      const humanFunc = await createFunction(store, 'emergencyApproval', 'human')

      // Direct cascade from Code to Human (skipping Generative and Agentic)
      await createCascadeRelationship(store, codeFunc.id, humanFunc.id, {
        priority: 1,
        condition: 'on-error',
      })

      const fromCode = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(fromCode).toHaveLength(1)
      expect(fromCode[0]!.to).toBe(`do://functions/${humanFunc.id}`)
    })

    it('allows multiple cascadesTo relationships with different conditions', async () => {
      const codeFunc = await createFunction(store, 'multiCondition', 'code')
      const generativeFunc = await createFunction(store, 'multiCondition-gen', 'generative')
      const agenticFunc = await createFunction(store, 'multiCondition-agent', 'agentic')
      const humanFunc = await createFunction(store, 'multiCondition-human', 'human')

      // Different cascade paths for different error conditions
      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id, {
        priority: 1,
        condition: 'on-error',
      })
      await createCascadeRelationship(store, codeFunc.id, agenticFunc.id, {
        priority: 2,
        condition: 'on-timeout',
      })
      await createCascadeRelationship(store, codeFunc.id, humanFunc.id, {
        priority: 3,
        condition: 'on-validation-failure',
      })

      const fromCode = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(fromCode).toHaveLength(3)

      // Verify each has different condition
      const conditions = fromCode.map((r) => (r.data as { condition?: string } | null)?.condition)
      expect(conditions).toContain('on-error')
      expect(conditions).toContain('on-timeout')
      expect(conditions).toContain('on-validation-failure')
    })

    it('stores metadata on cascade relationship', async () => {
      const codeFunc = await createFunction(store, 'withMetadata', 'code')
      const generativeFunc = await createFunction(store, 'withMetadata', 'generative')

      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id, {
        priority: 1,
        condition: 'on-error',
        metadata: {
          retryCount: 3,
          timeout: 5000,
          escalationReason: 'Code handler failed with exception',
          createdBy: 'system',
          createdAt: Date.now(),
        },
      })

      const rels = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(rels).toHaveLength(1)

      const data = rels[0]!.data as {
        priority: number
        condition: string
        metadata: { retryCount: number; timeout: number }
      }
      expect(data.metadata.retryCount).toBe(3)
      expect(data.metadata.timeout).toBe(5000)
    })
  })

  // ============================================================================
  // 2. CHAIN RESOLUTION TESTS
  // ============================================================================

  describe('Chain Resolution', () => {
    it('resolves next function in chain via cascadesTo relationship', async () => {
      const codeFunc = await createFunction(store, 'resolve', 'code')
      const generativeFunc = await createFunction(store, 'resolve', 'generative')

      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id)

      // Query the next function in chain
      const rels = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(rels).toHaveLength(1)

      // Extract target ID from URL
      const targetUrl = rels[0]!.to
      const targetId = targetUrl.replace('do://functions/', '')

      // Retrieve the target function
      const nextFunc = await store.getThing(targetId)
      expect(nextFunc).not.toBeNull()
      expect(nextFunc!.id).toBe(generativeFunc.id)
      expect((nextFunc!.data as { type: string }).type).toBe('generative')
    })

    it('returns null when no cascadesTo exists (terminal function)', async () => {
      const humanFunc = await createFunction(store, 'terminal', 'human')

      // Human function has no outgoing cascadesTo
      const rels = await store.queryRelationshipsFrom(`do://functions/${humanFunc.id}`, { verb: 'cascadesTo' })
      expect(rels).toHaveLength(0)
    })

    it('respects priority order for multiple cascades', async () => {
      const codeFunc = await createFunction(store, 'priority', 'code')
      const generativeFunc = await createFunction(store, 'priority-gen', 'generative')
      const agenticFunc = await createFunction(store, 'priority-agent', 'agentic')
      const humanFunc = await createFunction(store, 'priority-human', 'human')

      // Create cascades with explicit priorities (out of order)
      await createCascadeRelationship(store, codeFunc.id, humanFunc.id, { priority: 3 })
      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id, { priority: 1 })
      await createCascadeRelationship(store, codeFunc.id, agenticFunc.id, { priority: 2 })

      const rels = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(rels).toHaveLength(3)

      // Sort by priority (lowest = highest priority)
      const sorted = [...rels].sort((a, b) => {
        const priorityA = (a.data as { priority: number } | null)?.priority ?? 0
        const priorityB = (b.data as { priority: number } | null)?.priority ?? 0
        return priorityA - priorityB
      })

      // First should be generative (priority 1)
      expect(sorted[0]!.to).toBe(`do://functions/${generativeFunc.id}`)
      // Second should be agentic (priority 2)
      expect(sorted[1]!.to).toBe(`do://functions/${agenticFunc.id}`)
      // Third should be human (priority 3)
      expect(sorted[2]!.to).toBe(`do://functions/${humanFunc.id}`)
    })

    it('resolves next function filtered by condition', async () => {
      const codeFunc = await createFunction(store, 'conditioned', 'code')
      const genOnError = await createFunction(store, 'genOnError', 'generative')
      const genOnTimeout = await createFunction(store, 'genOnTimeout', 'generative')

      await createCascadeRelationship(store, codeFunc.id, genOnError.id, {
        priority: 1,
        condition: 'on-error',
      })
      await createCascadeRelationship(store, codeFunc.id, genOnTimeout.id, {
        priority: 1,
        condition: 'on-timeout',
      })

      const allRels = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })

      // Filter by condition 'on-error'
      const onErrorRels = allRels.filter((r) => {
        const data = r.data as { condition?: string } | null
        return data?.condition === 'on-error'
      })
      expect(onErrorRels).toHaveLength(1)
      expect(onErrorRels[0]!.to).toBe(`do://functions/${genOnError.id}`)

      // Filter by condition 'on-timeout'
      const onTimeoutRels = allRels.filter((r) => {
        const data = r.data as { condition?: string } | null
        return data?.condition === 'on-timeout'
      })
      expect(onTimeoutRels).toHaveLength(1)
      expect(onTimeoutRels[0]!.to).toBe(`do://functions/${genOnTimeout.id}`)
    })
  })

  // ============================================================================
  // 3. CHAIN TRAVERSAL TESTS
  // ============================================================================

  describe('Chain Traversal', () => {
    it('builds full cascade path from Code to Human', async () => {
      const codeFunc = await createFunction(store, 'traverse', 'code')
      const generativeFunc = await createFunction(store, 'traverse', 'generative')
      const agenticFunc = await createFunction(store, 'traverse', 'agentic')
      const humanFunc = await createFunction(store, 'traverse', 'human')

      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id)
      await createCascadeRelationship(store, generativeFunc.id, agenticFunc.id)
      await createCascadeRelationship(store, agenticFunc.id, humanFunc.id)

      // Traverse the chain manually
      const chain: GraphThing[] = []
      let currentId = codeFunc.id
      const visited = new Set<string>()
      const maxDepth = 100

      while (currentId && !visited.has(currentId) && chain.length < maxDepth) {
        visited.add(currentId)

        const fn = await store.getThing(currentId)
        if (!fn) break
        chain.push(fn)

        const rels = await store.queryRelationshipsFrom(`do://functions/${currentId}`, { verb: 'cascadesTo' })
        if (rels.length === 0) break

        // Sort by priority and get first
        rels.sort((a, b) => {
          const pA = (a.data as { priority?: number } | null)?.priority ?? 0
          const pB = (b.data as { priority?: number } | null)?.priority ?? 0
          return pA - pB
        })

        const nextUrl = rels[0]!.to
        currentId = nextUrl.replace('do://functions/', '')
      }

      expect(chain).toHaveLength(4)
      expect(chain[0]!.id).toBe(codeFunc.id)
      expect(chain[1]!.id).toBe(generativeFunc.id)
      expect(chain[2]!.id).toBe(agenticFunc.id)
      expect(chain[3]!.id).toBe(humanFunc.id)
    })

    it('handles cycles gracefully', async () => {
      const fn1 = await createFunction(store, 'cycle1', 'code')
      const fn2 = await createFunction(store, 'cycle2', 'generative')
      const fn3 = await createFunction(store, 'cycle3', 'agentic')

      // Create a cycle: fn1 -> fn2 -> fn3 -> fn1
      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn3.id)
      await createCascadeRelationship(store, fn3.id, fn1.id) // Cycle back!

      // Traverse with cycle detection
      const chain: string[] = []
      let currentId = fn1.id
      const visited = new Set<string>()

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId)
        chain.push(currentId)

        const rels = await store.queryRelationshipsFrom(`do://functions/${currentId}`, { verb: 'cascadesTo' })
        if (rels.length === 0) break

        currentId = rels[0]!.to.replace('do://functions/', '')
      }

      // Should stop at the cycle, not loop forever
      expect(chain).toHaveLength(3)
      expect(chain[0]).toBe(fn1.id)
      expect(chain[1]).toBe(fn2.id)
      expect(chain[2]).toBe(fn3.id)
      // fn1 is not duplicated because visited set detected the cycle
    })

    it('respects max depth limit', async () => {
      // Create a chain of 10 functions
      const functions: GraphThing[] = []
      for (let i = 0; i < 10; i++) {
        const type: 'code' | 'generative' | 'agentic' | 'human' = ['code', 'generative', 'agentic', 'human'][i % 4] as
          | 'code'
          | 'generative'
          | 'agentic'
          | 'human'
        functions.push(await createFunction(store, `depth-${i}`, type))
      }

      // Link them in a chain
      for (let i = 0; i < functions.length - 1; i++) {
        await createCascadeRelationship(store, functions[i]!.id, functions[i + 1]!.id)
      }

      // Traverse with max depth of 5
      const maxDepth = 5
      const chain: string[] = []
      let currentId = functions[0]!.id
      const visited = new Set<string>()

      while (currentId && !visited.has(currentId) && chain.length < maxDepth) {
        visited.add(currentId)
        chain.push(currentId)

        const rels = await store.queryRelationshipsFrom(`do://functions/${currentId}`, { verb: 'cascadesTo' })
        if (rels.length === 0) break

        currentId = rels[0]!.to.replace('do://functions/', '')
      }

      // Should stop at depth 5 even though chain is longer
      expect(chain).toHaveLength(5)
    })

    it('builds cascade path with relationship data for observability', async () => {
      const codeFunc = await createFunction(store, 'observable', 'code')
      const generativeFunc = await createFunction(store, 'observable', 'generative')
      const humanFunc = await createFunction(store, 'observable', 'human')

      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id, {
        priority: 1,
        condition: 'on-error',
        metadata: { escalationLevel: 1 },
      })
      await createCascadeRelationship(store, generativeFunc.id, humanFunc.id, {
        priority: 1,
        condition: 'on-error',
        metadata: { escalationLevel: 2 },
      })

      // Build detailed path with relationships
      const path: Array<{
        function: GraphThing
        relationship: GraphRelationship | null
        depth: number
      }> = []

      let currentId = codeFunc.id
      let prevRel: GraphRelationship | null = null
      const visited = new Set<string>()

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId)

        const fn = await store.getThing(currentId)
        if (!fn) break

        path.push({
          function: fn,
          relationship: prevRel,
          depth: path.length,
        })

        const rels = await store.queryRelationshipsFrom(`do://functions/${currentId}`, { verb: 'cascadesTo' })
        if (rels.length === 0) break

        prevRel = rels[0]!
        currentId = rels[0]!.to.replace('do://functions/', '')
      }

      expect(path).toHaveLength(3)

      // First entry has no incoming relationship
      expect(path[0]!.relationship).toBeNull()
      expect(path[0]!.depth).toBe(0)

      // Second entry has relationship with metadata
      expect(path[1]!.relationship).not.toBeNull()
      expect(path[1]!.relationship!.verb).toBe('cascadesTo')
      expect((path[1]!.relationship!.data as { metadata: { escalationLevel: number } }).metadata.escalationLevel).toBe(1)
      expect(path[1]!.depth).toBe(1)

      // Third entry
      expect(path[2]!.relationship).not.toBeNull()
      expect((path[2]!.relationship!.data as { metadata: { escalationLevel: number } }).metadata.escalationLevel).toBe(2)
      expect(path[2]!.depth).toBe(2)
    })
  })

  // ============================================================================
  // 4. BRANCHING CASCADES TESTS
  // ============================================================================

  describe('Branching Cascades', () => {
    it('supports multiple fallback options from single function', async () => {
      const codeFunc = await createFunction(store, 'branching', 'code')
      const genFallback1 = await createFunction(store, 'fallback1', 'generative')
      const genFallback2 = await createFunction(store, 'fallback2', 'generative')
      const agentFallback = await createFunction(store, 'fallback3', 'agentic')

      // Three different fallback options with different priorities
      await createCascadeRelationship(store, codeFunc.id, genFallback1.id, { priority: 1 })
      await createCascadeRelationship(store, codeFunc.id, genFallback2.id, { priority: 2 })
      await createCascadeRelationship(store, codeFunc.id, agentFallback.id, { priority: 3 })

      const targets = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(targets).toHaveLength(3)

      // Sort by priority to get fallback order
      targets.sort((a, b) => {
        const pA = (a.data as { priority: number } | null)?.priority ?? 0
        const pB = (b.data as { priority: number } | null)?.priority ?? 0
        return pA - pB
      })

      // First fallback should be genFallback1 (priority 1)
      expect(targets[0]!.to).toBe(`do://functions/${genFallback1.id}`)
      // Second should be genFallback2 (priority 2)
      expect(targets[1]!.to).toBe(`do://functions/${genFallback2.id}`)
      // Third should be agentFallback (priority 3)
      expect(targets[2]!.to).toBe(`do://functions/${agentFallback.id}`)
    })

    it('supports condition-based branching', async () => {
      const codeFunc = await createFunction(store, 'condBranch', 'code')
      const errorHandler = await createFunction(store, 'errorHandler', 'generative')
      const timeoutHandler = await createFunction(store, 'timeoutHandler', 'agentic')
      const fallbackHandler = await createFunction(store, 'fallbackHandler', 'human')

      await createCascadeRelationship(store, codeFunc.id, errorHandler.id, {
        priority: 1,
        condition: 'on-error',
      })
      await createCascadeRelationship(store, codeFunc.id, timeoutHandler.id, {
        priority: 2,
        condition: 'on-timeout',
      })
      await createCascadeRelationship(store, codeFunc.id, fallbackHandler.id, {
        priority: 99,
        condition: 'always', // Final fallback
      })

      const allRels = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })

      // Group by condition
      const byCondition = new Map<string, GraphRelationship[]>()
      for (const rel of allRels) {
        const condition = (rel.data as { condition?: string } | null)?.condition ?? 'default'
        if (!byCondition.has(condition)) {
          byCondition.set(condition, [])
        }
        byCondition.get(condition)!.push(rel)
      }

      expect(byCondition.get('on-error')).toHaveLength(1)
      expect(byCondition.get('on-timeout')).toHaveLength(1)
      expect(byCondition.get('always')).toHaveLength(1)
    })

    it('merges branching paths at terminal', async () => {
      // Diamond pattern: Code -> (Gen1, Gen2) -> Human
      const codeFunc = await createFunction(store, 'diamond', 'code')
      const gen1 = await createFunction(store, 'gen1', 'generative')
      const gen2 = await createFunction(store, 'gen2', 'generative')
      const humanFunc = await createFunction(store, 'diamond', 'human')

      // Code branches to both gen1 and gen2
      await createCascadeRelationship(store, codeFunc.id, gen1.id, { priority: 1 })
      await createCascadeRelationship(store, codeFunc.id, gen2.id, { priority: 2 })

      // Both gen1 and gen2 cascade to human
      await createCascadeRelationship(store, gen1.id, humanFunc.id)
      await createCascadeRelationship(store, gen2.id, humanFunc.id)

      // Verify both paths exist
      const fromGen1 = await store.queryRelationshipsFrom(`do://functions/${gen1.id}`, { verb: 'cascadesTo' })
      expect(fromGen1).toHaveLength(1)
      expect(fromGen1[0]!.to).toBe(`do://functions/${humanFunc.id}`)

      const fromGen2 = await store.queryRelationshipsFrom(`do://functions/${gen2.id}`, { verb: 'cascadesTo' })
      expect(fromGen2).toHaveLength(1)
      expect(fromGen2[0]!.to).toBe(`do://functions/${humanFunc.id}`)

      // Reverse lookup: Human has 2 incoming cascadesTo
      const toHuman = await store.queryRelationshipsTo(`do://functions/${humanFunc.id}`, { verb: 'cascadesTo' })
      expect(toHuman).toHaveLength(2)
    })
  })

  // ============================================================================
  // 5. CASCADE PATH QUERY FOR OBSERVABILITY
  // ============================================================================

  describe('Cascade Path Observability', () => {
    it('queries cascade path for a specific function', async () => {
      const codeFunc = await createFunction(store, 'observe', 'code')
      const generativeFunc = await createFunction(store, 'observe', 'generative')
      const humanFunc = await createFunction(store, 'observe', 'human')

      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id, {
        priority: 1,
        metadata: { reason: 'code-failure' },
      })
      await createCascadeRelationship(store, generativeFunc.id, humanFunc.id, {
        priority: 1,
        metadata: { reason: 'ai-uncertainty' },
      })

      // Build and return path information for monitoring
      const pathInfo: Array<{
        functionId: string
        functionType: string
        nextTarget: string | null
        cascadeReason: string | null
      }> = []

      let currentId = codeFunc.id
      const visited = new Set<string>()

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId)

        const fn = await store.getThing(currentId)
        if (!fn) break

        const rels = await store.queryRelationshipsFrom(`do://functions/${currentId}`, { verb: 'cascadesTo' })
        const nextRel = rels[0] ?? null

        pathInfo.push({
          functionId: fn.id,
          functionType: (fn.data as { type: string }).type,
          nextTarget: nextRel?.to.replace('do://functions/', '') ?? null,
          cascadeReason: nextRel ? (nextRel.data as { metadata?: { reason?: string } } | null)?.metadata?.reason ?? null : null,
        })

        if (!nextRel) break
        currentId = nextRel.to.replace('do://functions/', '')
      }

      expect(pathInfo).toHaveLength(3)

      expect(pathInfo[0]!.functionType).toBe('code')
      expect(pathInfo[0]!.nextTarget).toBe(generativeFunc.id)
      expect(pathInfo[0]!.cascadeReason).toBe('code-failure')

      expect(pathInfo[1]!.functionType).toBe('generative')
      expect(pathInfo[1]!.nextTarget).toBe(humanFunc.id)
      expect(pathInfo[1]!.cascadeReason).toBe('ai-uncertainty')

      expect(pathInfo[2]!.functionType).toBe('human')
      expect(pathInfo[2]!.nextTarget).toBeNull() // Terminal
      expect(pathInfo[2]!.cascadeReason).toBeNull()
    })

    it('counts cascade chain statistics', async () => {
      // Create a chain with branches
      const code = await createFunction(store, 'stats', 'code')
      const gen1 = await createFunction(store, 'stats1', 'generative')
      const gen2 = await createFunction(store, 'stats2', 'generative')
      const agentic = await createFunction(store, 'stats', 'agentic')
      const human = await createFunction(store, 'stats', 'human')

      // Code branches to gen1 and gen2
      await createCascadeRelationship(store, code.id, gen1.id, { priority: 1 })
      await createCascadeRelationship(store, code.id, gen2.id, { priority: 2 })
      // Both gens cascade to agentic
      await createCascadeRelationship(store, gen1.id, agentic.id)
      await createCascadeRelationship(store, gen2.id, agentic.id)
      // Agentic cascades to human
      await createCascadeRelationship(store, agentic.id, human.id)

      // Calculate stats
      const allCascades = await store.queryRelationshipsByVerb('cascadesTo')
      const totalRelationships = allCascades.length

      // Count unique functions in chain starting from code (following primary path)
      const chainLength = await (async () => {
        let length = 0
        let currentId = code.id
        const visited = new Set<string>()

        while (currentId && !visited.has(currentId)) {
          visited.add(currentId)
          length++

          const rels = await store.queryRelationshipsFrom(`do://functions/${currentId}`, { verb: 'cascadesTo' })
          if (rels.length === 0) break

          // Follow primary (lowest priority)
          rels.sort((a, b) => {
            const pA = (a.data as { priority: number } | null)?.priority ?? 0
            const pB = (b.data as { priority: number } | null)?.priority ?? 0
            return pA - pB
          })
          currentId = rels[0]!.to.replace('do://functions/', '')
        }
        return length
      })()

      expect(totalRelationships).toBe(5) // 2 from code, 1 from gen1, 1 from gen2, 1 from agentic
      expect(chainLength).toBe(4) // code -> gen1 -> agentic -> human (following primary)
    })

    it('finds all cascade sources for a terminal function', async () => {
      // Multiple paths converging to human
      const code1 = await createFunction(store, 'source1', 'code')
      const code2 = await createFunction(store, 'source2', 'code')
      const gen = await createFunction(store, 'intermediate', 'generative')
      const human = await createFunction(store, 'terminal', 'human')

      await createCascadeRelationship(store, code1.id, gen.id)
      await createCascadeRelationship(store, code2.id, gen.id)
      await createCascadeRelationship(store, gen.id, human.id)

      // Find all functions that cascade to human (directly)
      const directSources = await store.queryRelationshipsTo(`do://functions/${human.id}`, { verb: 'cascadesTo' })
      expect(directSources).toHaveLength(1)
      expect(directSources[0]!.from).toBe(`do://functions/${gen.id}`)

      // Find all functions that cascade to gen
      const genSources = await store.queryRelationshipsTo(`do://functions/${gen.id}`, { verb: 'cascadesTo' })
      expect(genSources).toHaveLength(2)
      const sourceIds = genSources.map((r) => r.from.replace('do://functions/', ''))
      expect(sourceIds).toContain(code1.id)
      expect(sourceIds).toContain(code2.id)
    })

    it('detects cycle presence in cascade chain', async () => {
      const fn1 = await createFunction(store, 'cycleDetect1', 'code')
      const fn2 = await createFunction(store, 'cycleDetect2', 'generative')
      const fn3 = await createFunction(store, 'cycleDetect3', 'agentic')

      // Create a cycle: fn1 -> fn2 -> fn3 -> fn1
      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn3.id)
      await createCascadeRelationship(store, fn3.id, fn1.id)

      // Detect cycle by traversing and checking visited
      const detectCycle = async (startId: string): Promise<boolean> => {
        const visited = new Set<string>()
        let currentId: string | null = startId

        while (currentId) {
          if (visited.has(currentId)) {
            return true // Cycle detected
          }
          visited.add(currentId)

          const rels = await store.queryRelationshipsFrom(`do://functions/${currentId}`, { verb: 'cascadesTo' })
          if (rels.length === 0) break

          currentId = rels[0]!.to.replace('do://functions/', '')
        }

        return false
      }

      const hasCycle = await detectCycle(fn1.id)
      expect(hasCycle).toBe(true)

      // Now test a non-cyclic chain
      const cleanFn1 = await createFunction(store, 'clean1', 'code')
      const cleanFn2 = await createFunction(store, 'clean2', 'generative')

      await createCascadeRelationship(store, cleanFn1.id, cleanFn2.id)

      const hasCleanCycle = await detectCycle(cleanFn1.id)
      expect(hasCleanCycle).toBe(false)
    })
  })

  // ============================================================================
  // 6. EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles empty cascade chain (single function)', async () => {
      const standalone = await createFunction(store, 'standalone', 'code')

      const rels = await store.queryRelationshipsFrom(`do://functions/${standalone.id}`, { verb: 'cascadesTo' })
      expect(rels).toHaveLength(0)
    })

    it('handles disabled functions in chain', async () => {
      const codeFunc = await createFunction(store, 'enabled', 'code', { enabled: true })
      const disabledGen = await createFunction(store, 'disabled', 'generative', { enabled: false })
      const humanFunc = await createFunction(store, 'enabled', 'human', { enabled: true })

      await createCascadeRelationship(store, codeFunc.id, disabledGen.id)
      await createCascadeRelationship(store, disabledGen.id, humanFunc.id)

      // Traversal can skip disabled functions
      const chain: GraphThing[] = []
      let currentId = codeFunc.id
      const visited = new Set<string>()

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId)

        const fn = await store.getThing(currentId)
        if (!fn) break

        // Check if enabled
        const isEnabled = (fn.data as { enabled?: boolean }).enabled !== false
        if (isEnabled) {
          chain.push(fn)
        }

        const rels = await store.queryRelationshipsFrom(`do://functions/${currentId}`, { verb: 'cascadesTo' })
        if (rels.length === 0) break

        currentId = rels[0]!.to.replace('do://functions/', '')
      }

      // Should include code and human, skip disabled gen
      expect(chain).toHaveLength(2)
      expect(chain[0]!.id).toBe(codeFunc.id)
      expect(chain[1]!.id).toBe(humanFunc.id)
    })

    it('handles very long cascade chains', async () => {
      const chainLength = 50
      const functions: GraphThing[] = []

      // Create a long chain
      for (let i = 0; i < chainLength; i++) {
        const type: 'code' | 'generative' | 'agentic' | 'human' = ['code', 'generative', 'agentic', 'human'][i % 4] as
          | 'code'
          | 'generative'
          | 'agentic'
          | 'human'
        functions.push(await createFunction(store, `long-${i}`, type))
      }

      // Link them
      for (let i = 0; i < functions.length - 1; i++) {
        await createCascadeRelationship(store, functions[i]!.id, functions[i + 1]!.id)
      }

      // Traverse and verify
      let traverseCount = 0
      let currentId = functions[0]!.id
      const visited = new Set<string>()

      while (currentId && !visited.has(currentId) && traverseCount < 100) {
        visited.add(currentId)
        traverseCount++

        const rels = await store.queryRelationshipsFrom(`do://functions/${currentId}`, { verb: 'cascadesTo' })
        if (rels.length === 0) break

        currentId = rels[0]!.to.replace('do://functions/', '')
      }

      expect(traverseCount).toBe(chainLength)
    })

    it('handles concurrent cascade relationship creation', async () => {
      const codeFunc = await createFunction(store, 'concurrent', 'code')

      // Create multiple targets
      const targets = await Promise.all([
        createFunction(store, 'target1', 'generative'),
        createFunction(store, 'target2', 'agentic'),
        createFunction(store, 'target3', 'human'),
      ])

      // Create cascade relationships concurrently
      await Promise.all(
        targets.map((target, i) =>
          createCascadeRelationship(store, codeFunc.id, target.id, {
            priority: i + 1,
          })
        )
      )

      const rels = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(rels).toHaveLength(3)
    })

    it('deletes cascade relationship cleanly', async () => {
      const codeFunc = await createFunction(store, 'deletable', 'code')
      const genFunc = await createFunction(store, 'deletable', 'generative')

      const rel = await createCascadeRelationship(store, codeFunc.id, genFunc.id)

      // Verify it exists
      let rels = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(rels).toHaveLength(1)

      // Delete the relationship
      const deleted = await store.deleteRelationship(rel.id)
      expect(deleted).toBe(true)

      // Verify it's gone
      rels = await store.queryRelationshipsFrom(`do://functions/${codeFunc.id}`, { verb: 'cascadesTo' })
      expect(rels).toHaveLength(0)
    })
  })
})

// ============================================================================
// 7. CASCADE CHAIN RESOLVER CLASS TESTS (RED PHASE)
// ============================================================================

/**
 * RED PHASE: Tests for the CascadeChainResolver class implementation.
 *
 * These tests will FAIL until the CascadeChainResolver class is implemented.
 * The resolver provides a clean API for cascade chain resolution, replacing
 * the inline manual traversal logic used in the tests above.
 *
 * Implementation should be at: db/graph/cascade-chain-resolver.ts
 */
describe('CascadeChainResolver Class (RED Phase)', () => {
  let store: SQLiteGraphStore
  let resolver: CascadeChainResolver

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // This import will FAIL until CascadeChainResolver is implemented
    const { CascadeChainResolver: ResolverClass } = await import('../cascade-chain-resolver')
    resolver = new ResolverClass(store)
  })

  afterEach(async () => {
    await store.close()
  })

  describe('resolveNext()', () => {
    it('should resolve the next function in chain via cascadesTo', async () => {
      const codeFunc = await createFunction(store, 'processOrder', 'code')
      const generativeFunc = await createFunction(store, 'processOrder', 'generative')

      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id, {
        priority: 1,
        condition: 'on-error',
      })

      const next = await resolver.resolveNext(codeFunc.id)

      expect(next).not.toBeNull()
      expect(next!.id).toBe(generativeFunc.id)
      expect((next!.data as { type: string }).type).toBe('generative')
    })

    it('should return null when no cascadesTo exists', async () => {
      const humanFunc = await createFunction(store, 'terminal', 'human')

      const next = await resolver.resolveNext(humanFunc.id)

      expect(next).toBeNull()
    })

    it('should respect priority when multiple cascades exist', async () => {
      const codeFunc = await createFunction(store, 'priority', 'code')
      const genLow = await createFunction(store, 'low-priority', 'generative')
      const genHigh = await createFunction(store, 'high-priority', 'generative')

      // Create with higher priority (lower number = higher priority)
      await createCascadeRelationship(store, codeFunc.id, genLow.id, { priority: 10 })
      await createCascadeRelationship(store, codeFunc.id, genHigh.id, { priority: 1 })

      const next = await resolver.resolveNext(codeFunc.id)

      expect(next).not.toBeNull()
      expect(next!.id).toBe(genHigh.id)
    })

    it('should return null for non-existent function', async () => {
      const next = await resolver.resolveNext('non-existent-function-id')

      expect(next).toBeNull()
    })
  })

  describe('buildCascadePath()', () => {
    it('should build full cascade path from Code to Human', async () => {
      const codeFunc = await createFunction(store, 'fullChain', 'code')
      const generativeFunc = await createFunction(store, 'fullChain', 'generative')
      const agenticFunc = await createFunction(store, 'fullChain', 'agentic')
      const humanFunc = await createFunction(store, 'fullChain', 'human')

      await createCascadeRelationship(store, codeFunc.id, generativeFunc.id)
      await createCascadeRelationship(store, generativeFunc.id, agenticFunc.id)
      await createCascadeRelationship(store, agenticFunc.id, humanFunc.id)

      const path = await resolver.buildCascadePath(codeFunc.id)

      expect(path).toHaveLength(4)
      expect(path[0]!.function.id).toBe(codeFunc.id)
      expect(path[0]!.type).toBe('code')
      expect(path[0]!.depth).toBe(0)
      expect(path[0]!.relationship).toBeNull()

      expect(path[1]!.function.id).toBe(generativeFunc.id)
      expect(path[1]!.type).toBe('generative')
      expect(path[1]!.depth).toBe(1)
      expect(path[1]!.relationship).not.toBeNull()

      expect(path[2]!.function.id).toBe(agenticFunc.id)
      expect(path[2]!.type).toBe('agentic')
      expect(path[2]!.depth).toBe(2)

      expect(path[3]!.function.id).toBe(humanFunc.id)
      expect(path[3]!.type).toBe('human')
      expect(path[3]!.depth).toBe(3)
    })

    it('should respect maxDepth option', async () => {
      const fn1 = await createFunction(store, 'depth1', 'code')
      const fn2 = await createFunction(store, 'depth2', 'generative')
      const fn3 = await createFunction(store, 'depth3', 'agentic')
      const fn4 = await createFunction(store, 'depth4', 'human')

      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn3.id)
      await createCascadeRelationship(store, fn3.id, fn4.id)

      const path = await resolver.buildCascadePath(fn1.id, { maxDepth: 2 })

      expect(path).toHaveLength(2)
      expect(path[0]!.function.id).toBe(fn1.id)
      expect(path[1]!.function.id).toBe(fn2.id)
    })

    it('should filter by condition', async () => {
      const codeFunc = await createFunction(store, 'conditioned', 'code')
      const genOnError = await createFunction(store, 'onError', 'generative')
      const genOnTimeout = await createFunction(store, 'onTimeout', 'generative')

      await createCascadeRelationship(store, codeFunc.id, genOnError.id, {
        priority: 1,
        condition: 'on-error',
      })
      await createCascadeRelationship(store, codeFunc.id, genOnTimeout.id, {
        priority: 1,
        condition: 'on-timeout',
      })

      const pathError = await resolver.buildCascadePath(codeFunc.id, { condition: 'on-error' })

      expect(pathError).toHaveLength(2)
      expect(pathError[1]!.function.id).toBe(genOnError.id)
    })

    it('should include disabled functions when includeDisabled is true', async () => {
      const fn1 = await createFunction(store, 'enabled1', 'code', { enabled: true })
      const fn2 = await createFunction(store, 'disabled', 'generative', { enabled: false })
      const fn3 = await createFunction(store, 'enabled2', 'human', { enabled: true })

      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn3.id)

      const pathWithDisabled = await resolver.buildCascadePath(fn1.id, { includeDisabled: true })
      const pathWithoutDisabled = await resolver.buildCascadePath(fn1.id, { includeDisabled: false })

      expect(pathWithDisabled).toHaveLength(3)
      expect(pathWithoutDisabled).toHaveLength(1) // Stops at disabled
    })

    it('should include relationship data when includeRelationships is true', async () => {
      const fn1 = await createFunction(store, 'rel1', 'code')
      const fn2 = await createFunction(store, 'rel2', 'generative')

      await createCascadeRelationship(store, fn1.id, fn2.id, {
        priority: 5,
        condition: 'on-error',
        metadata: { escalationLevel: 1 },
      })

      const path = await resolver.buildCascadePath(fn1.id, { includeRelationships: true })

      expect(path).toHaveLength(2)
      expect(path[1]!.relationship).not.toBeNull()
      const relData = path[1]!.relationship!.data as { priority: number; condition: string; metadata: { escalationLevel: number } }
      expect(relData.priority).toBe(5)
      expect(relData.condition).toBe('on-error')
      expect(relData.metadata.escalationLevel).toBe(1)
    })

    it('should filter by function types', async () => {
      const code = await createFunction(store, 'typeFilter', 'code')
      const gen = await createFunction(store, 'typeFilter', 'generative')
      const agent = await createFunction(store, 'typeFilter', 'agentic')
      const human = await createFunction(store, 'typeFilter', 'human')

      await createCascadeRelationship(store, code.id, gen.id)
      await createCascadeRelationship(store, gen.id, agent.id)
      await createCascadeRelationship(store, agent.id, human.id)

      const path = await resolver.buildCascadePath(code.id, { types: ['code', 'human'] })

      // Should only include code and human, skipping generative and agentic
      expect(path.map(p => p.type)).toEqual(['code', 'human'])
    })
  })

  describe('detectCycle()', () => {
    it('should return true when cycle exists', async () => {
      const fn1 = await createFunction(store, 'cycle1', 'code')
      const fn2 = await createFunction(store, 'cycle2', 'generative')
      const fn3 = await createFunction(store, 'cycle3', 'agentic')

      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn3.id)
      await createCascadeRelationship(store, fn3.id, fn1.id) // Cycle!

      const hasCycle = await resolver.detectCycle(fn1.id)

      expect(hasCycle).toBe(true)
    })

    it('should return false when no cycle exists', async () => {
      const fn1 = await createFunction(store, 'noCycle1', 'code')
      const fn2 = await createFunction(store, 'noCycle2', 'generative')

      await createCascadeRelationship(store, fn1.id, fn2.id)

      const hasCycle = await resolver.detectCycle(fn1.id)

      expect(hasCycle).toBe(false)
    })

    it('should detect self-referencing cycle', async () => {
      const fn = await createFunction(store, 'selfRef', 'code')

      await createCascadeRelationship(store, fn.id, fn.id) // Self-reference

      const hasCycle = await resolver.detectCycle(fn.id)

      expect(hasCycle).toBe(true)
    })
  })

  describe('getCascadeTargets()', () => {
    it('should return all cascade targets sorted by priority', async () => {
      const source = await createFunction(store, 'source', 'code')
      const target1 = await createFunction(store, 'target1', 'generative')
      const target2 = await createFunction(store, 'target2', 'agentic')
      const target3 = await createFunction(store, 'target3', 'human')

      await createCascadeRelationship(store, source.id, target3.id, { priority: 3 })
      await createCascadeRelationship(store, source.id, target1.id, { priority: 1 })
      await createCascadeRelationship(store, source.id, target2.id, { priority: 2 })

      const targets = await resolver.getCascadeTargets(source.id)

      expect(targets).toHaveLength(3)
      expect(targets[0]!.function.id).toBe(target1.id)
      expect(targets[0]!.priority).toBe(1)
      expect(targets[1]!.function.id).toBe(target2.id)
      expect(targets[1]!.priority).toBe(2)
      expect(targets[2]!.function.id).toBe(target3.id)
      expect(targets[2]!.priority).toBe(3)
    })

    it('should include condition in targets', async () => {
      const source = await createFunction(store, 'condSource', 'code')
      const target = await createFunction(store, 'condTarget', 'generative')

      await createCascadeRelationship(store, source.id, target.id, {
        priority: 1,
        condition: 'on-timeout',
      })

      const targets = await resolver.getCascadeTargets(source.id)

      expect(targets).toHaveLength(1)
      expect(targets[0]!.condition).toBe('on-timeout')
    })

    it('should return empty array for function with no cascades', async () => {
      const standalone = await createFunction(store, 'standalone', 'human')

      const targets = await resolver.getCascadeTargets(standalone.id)

      expect(targets).toEqual([])
    })
  })

  describe('findTerminal()', () => {
    it('should find the terminal function in chain (Human)', async () => {
      const code = await createFunction(store, 'terminal', 'code')
      const gen = await createFunction(store, 'terminal', 'generative')
      const agent = await createFunction(store, 'terminal', 'agentic')
      const human = await createFunction(store, 'terminal', 'human')

      await createCascadeRelationship(store, code.id, gen.id)
      await createCascadeRelationship(store, gen.id, agent.id)
      await createCascadeRelationship(store, agent.id, human.id)

      const terminal = await resolver.findTerminal(code.id)

      expect(terminal).not.toBeNull()
      expect(terminal!.id).toBe(human.id)
      expect((terminal!.data as { type: string }).type).toBe('human')
    })

    it('should return starting function if no cascades exist', async () => {
      const standalone = await createFunction(store, 'standalone', 'code')

      const terminal = await resolver.findTerminal(standalone.id)

      expect(terminal).not.toBeNull()
      expect(terminal!.id).toBe(standalone.id)
    })

    it('should respect maxDepth limit', async () => {
      const fn1 = await createFunction(store, 'term1', 'code')
      const fn2 = await createFunction(store, 'term2', 'generative')
      const fn3 = await createFunction(store, 'term3', 'agentic')
      const fn4 = await createFunction(store, 'term4', 'human')

      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn3.id)
      await createCascadeRelationship(store, fn3.id, fn4.id)

      const terminal = await resolver.findTerminal(fn1.id, 2)

      expect(terminal).not.toBeNull()
      expect(terminal!.id).toBe(fn2.id) // Stopped at depth 2
    })
  })

  describe('getCascadeStats()', () => {
    it('should return complete cascade chain statistics', async () => {
      const code = await createFunction(store, 'stats', 'code')
      const gen = await createFunction(store, 'stats', 'generative')
      const agent = await createFunction(store, 'stats', 'agentic')
      const human = await createFunction(store, 'stats', 'human')

      await createCascadeRelationship(store, code.id, gen.id)
      await createCascadeRelationship(store, gen.id, agent.id)
      await createCascadeRelationship(store, agent.id, human.id)

      const stats = await resolver.getCascadeStats(code.id)

      expect(stats.chainLength).toBe(4)
      expect(stats.typeSequence).toEqual(['code', 'generative', 'agentic', 'human'])
      expect(stats.hasCycle).toBe(false)
      expect(stats.branchingFactor).toBe(3) // 3 cascadesTo relationships
      expect(stats.maxDepth).toBe(3)
      expect(stats.functionIds).toHaveLength(4)
      expect(stats.disabledCount).toBe(0)
    })

    it('should detect disabled functions in stats', async () => {
      const fn1 = await createFunction(store, 'disabledStats1', 'code')
      const fn2 = await createFunction(store, 'disabledStats2', 'generative', { enabled: false })
      const fn3 = await createFunction(store, 'disabledStats3', 'human')

      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn3.id)

      const stats = await resolver.getCascadeStats(fn1.id)

      expect(stats.disabledCount).toBe(1)
    })

    it('should include cycle detection in stats', async () => {
      const fn1 = await createFunction(store, 'cycleStats1', 'code')
      const fn2 = await createFunction(store, 'cycleStats2', 'generative')

      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn1.id) // Cycle

      const stats = await resolver.getCascadeStats(fn1.id)

      expect(stats.hasCycle).toBe(true)
    })

    it('should count branching factor with multiple targets', async () => {
      const source = await createFunction(store, 'branchSource', 'code')
      const target1 = await createFunction(store, 'branchTarget1', 'generative')
      const target2 = await createFunction(store, 'branchTarget2', 'generative')
      const target3 = await createFunction(store, 'branchTarget3', 'agentic')

      await createCascadeRelationship(store, source.id, target1.id, { priority: 1 })
      await createCascadeRelationship(store, source.id, target2.id, { priority: 2 })
      await createCascadeRelationship(store, source.id, target3.id, { priority: 3 })

      const stats = await resolver.getCascadeStats(source.id)

      expect(stats.branchingFactor).toBe(3)
    })
  })

  describe('findPathsTo()', () => {
    it('should find all paths from source to target', async () => {
      // Diamond pattern: code -> (gen1, gen2) -> human
      const code = await createFunction(store, 'diamond', 'code')
      const gen1 = await createFunction(store, 'diamond-gen1', 'generative')
      const gen2 = await createFunction(store, 'diamond-gen2', 'generative')
      const human = await createFunction(store, 'diamond', 'human')

      await createCascadeRelationship(store, code.id, gen1.id, { priority: 1 })
      await createCascadeRelationship(store, code.id, gen2.id, { priority: 2 })
      await createCascadeRelationship(store, gen1.id, human.id)
      await createCascadeRelationship(store, gen2.id, human.id)

      const paths = await resolver.findPathsTo(code.id, human.id)

      expect(paths).toHaveLength(2)

      // Path 1: code -> gen1 -> human
      // Path 2: code -> gen2 -> human
      const pathFunctionIds = paths.map(p => p.entries.map(e => e.function.id))
      expect(pathFunctionIds).toContainEqual([code.id, gen1.id, human.id])
      expect(pathFunctionIds).toContainEqual([code.id, gen2.id, human.id])
    })

    it('should return empty array when no path exists', async () => {
      const fn1 = await createFunction(store, 'noPath1', 'code')
      const fn2 = await createFunction(store, 'noPath2', 'human')

      // No cascade relationship

      const paths = await resolver.findPathsTo(fn1.id, fn2.id)

      expect(paths).toEqual([])
    })

    it('should calculate total priority for each path', async () => {
      const fn1 = await createFunction(store, 'prioPath', 'code')
      const fn2 = await createFunction(store, 'prioPath', 'generative')
      const fn3 = await createFunction(store, 'prioPath', 'human')

      await createCascadeRelationship(store, fn1.id, fn2.id, { priority: 5 })
      await createCascadeRelationship(store, fn2.id, fn3.id, { priority: 3 })

      const paths = await resolver.findPathsTo(fn1.id, fn3.id)

      expect(paths).toHaveLength(1)
      expect(paths[0]!.totalPriority).toBe(8) // 5 + 3
    })

    it('should indicate if path passes through disabled functions', async () => {
      const fn1 = await createFunction(store, 'disPath1', 'code')
      const fn2 = await createFunction(store, 'disPath2', 'generative', { enabled: false })
      const fn3 = await createFunction(store, 'disPath3', 'human')

      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn3.id)

      const paths = await resolver.findPathsTo(fn1.id, fn3.id)

      expect(paths).toHaveLength(1)
      expect(paths[0]!.hasDisabled).toBe(true)
    })
  })

  describe('validateChain()', () => {
    it('should return valid result for well-formed chain', async () => {
      const code = await createFunction(store, 'valid', 'code')
      const gen = await createFunction(store, 'valid', 'generative')
      const human = await createFunction(store, 'valid', 'human')

      await createCascadeRelationship(store, code.id, gen.id, { priority: 1 })
      await createCascadeRelationship(store, gen.id, human.id, { priority: 1 })

      const result = await resolver.validateChain(code.id)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect cycle as error', async () => {
      const fn1 = await createFunction(store, 'valCycle1', 'code')
      const fn2 = await createFunction(store, 'valCycle2', 'generative')

      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn1.id) // Cycle

      const result = await resolver.validateChain(fn1.id)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.code === 'CYCLE_DETECTED')).toBe(true)
    })

    it('should detect duplicate priorities as error', async () => {
      const source = await createFunction(store, 'dupPrio', 'code')
      const target1 = await createFunction(store, 'dupPrio1', 'generative')
      const target2 = await createFunction(store, 'dupPrio2', 'generative')

      // Same priority = ambiguous ordering
      await createCascadeRelationship(store, source.id, target1.id, { priority: 1 })
      await createCascadeRelationship(store, source.id, target2.id, { priority: 1 })

      const result = await resolver.validateChain(source.id)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.code === 'DUPLICATE_PRIORITY')).toBe(true)
    })

    it('should detect invalid type order as error', async () => {
      // Human -> Code is wrong order (should be Code -> Human)
      const human = await createFunction(store, 'wrongOrder', 'human')
      const code = await createFunction(store, 'wrongOrder', 'code')

      await createCascadeRelationship(store, human.id, code.id) // Wrong direction

      const result = await resolver.validateChain(human.id)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_TYPE_ORDER')).toBe(true)
    })

    it('should detect missing target as error', async () => {
      const fn = await createFunction(store, 'missingTarget', 'code')

      // Create relationship to non-existent target (manually)
      await store.createRelationship({
        id: 'rel-missing-target',
        verb: 'cascadesTo',
        from: `do://functions/${fn.id}`,
        to: 'do://functions/non-existent-function',
        data: { priority: 1 },
      })

      const result = await resolver.validateChain(fn.id)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.code === 'MISSING_TARGET')).toBe(true)
    })

    it('should warn about disabled functions in path', async () => {
      const fn1 = await createFunction(store, 'warnDisabled1', 'code')
      const fn2 = await createFunction(store, 'warnDisabled2', 'generative', { enabled: false })
      const fn3 = await createFunction(store, 'warnDisabled3', 'human')

      await createCascadeRelationship(store, fn1.id, fn2.id)
      await createCascadeRelationship(store, fn2.id, fn3.id)

      const result = await resolver.validateChain(fn1.id)

      expect(result.warnings.some(w => w.code === 'DISABLED_IN_PATH')).toBe(true)
    })

    it('should warn about deep chains', async () => {
      // Create a chain of 15 functions (exceeds typical depth limit)
      const functions: GraphThing[] = []
      for (let i = 0; i < 15; i++) {
        const type: 'code' | 'generative' | 'agentic' | 'human' = ['code', 'generative', 'agentic', 'human'][i % 4] as
          | 'code'
          | 'generative'
          | 'agentic'
          | 'human'
        functions.push(await createFunction(store, `deep-${i}`, type))
      }

      for (let i = 0; i < functions.length - 1; i++) {
        await createCascadeRelationship(store, functions[i]!.id, functions[i + 1]!.id)
      }

      const result = await resolver.validateChain(functions[0]!.id)

      expect(result.warnings.some(w => w.code === 'DEEP_CHAIN')).toBe(true)
    })

    it('should warn about high branching factor', async () => {
      const source = await createFunction(store, 'highBranch', 'code')

      // Create 10 cascade targets
      for (let i = 0; i < 10; i++) {
        const target = await createFunction(store, `branch-${i}`, 'generative')
        await createCascadeRelationship(store, source.id, target.id, { priority: i })
      }

      const result = await resolver.validateChain(source.id)

      expect(result.warnings.some(w => w.code === 'HIGH_BRANCHING')).toBe(true)
    })

    it('should warn when chain has no terminal', async () => {
      // A chain that ends without reaching Human (no terminal)
      const code = await createFunction(store, 'noTerminal', 'code')
      const gen = await createFunction(store, 'noTerminal', 'generative')

      await createCascadeRelationship(store, code.id, gen.id)
      // Chain ends at generative - no human terminal

      const result = await resolver.validateChain(code.id)

      expect(result.warnings.some(w => w.code === 'NO_TERMINAL')).toBe(true)
    })
  })
})

// ============================================================================
// 8. PARTIAL CHAIN TESTS (RED PHASE)
// ============================================================================

describe('Partial Cascade Chains (RED Phase)', () => {
  let store: SQLiteGraphStore
  let resolver: CascadeChainResolver

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    const { CascadeChainResolver: ResolverClass } = await import('../cascade-chain-resolver')
    resolver = new ResolverClass(store)
  })

  afterEach(async () => {
    await store.close()
  })

  it('should handle Code -> Human direct cascade (skipping Generative and Agentic)', async () => {
    const code = await createFunction(store, 'direct', 'code')
    const human = await createFunction(store, 'direct', 'human')

    await createCascadeRelationship(store, code.id, human.id, {
      priority: 1,
      condition: 'on-critical-error',
    })

    const path = await resolver.buildCascadePath(code.id)

    expect(path).toHaveLength(2)
    expect(path[0]!.type).toBe('code')
    expect(path[1]!.type).toBe('human')
  })

  it('should handle Code -> Agentic cascade (skipping Generative)', async () => {
    const code = await createFunction(store, 'skipGen', 'code')
    const agentic = await createFunction(store, 'skipGen', 'agentic')
    const human = await createFunction(store, 'skipGen', 'human')

    await createCascadeRelationship(store, code.id, agentic.id)
    await createCascadeRelationship(store, agentic.id, human.id)

    const path = await resolver.buildCascadePath(code.id)

    expect(path).toHaveLength(3)
    expect(path.map(p => p.type)).toEqual(['code', 'agentic', 'human'])
  })

  it('should handle Generative -> Human cascade (starting mid-chain)', async () => {
    const gen = await createFunction(store, 'midStart', 'generative')
    const human = await createFunction(store, 'midStart', 'human')

    await createCascadeRelationship(store, gen.id, human.id)

    const path = await resolver.buildCascadePath(gen.id)

    expect(path).toHaveLength(2)
    expect(path[0]!.type).toBe('generative')
    expect(path[1]!.type).toBe('human')
  })

  it('should handle standalone function with no cascade', async () => {
    const standalone = await createFunction(store, 'standalone', 'agentic')

    const path = await resolver.buildCascadePath(standalone.id)

    expect(path).toHaveLength(1)
    expect(path[0]!.type).toBe('agentic')
  })
})
