/**
 * Organization Cycle Detection Tests - TDD RED Phase
 *
 * Tests for detecting infinite loop vulnerabilities in OrganizationStore.getAncestors()
 * and getDescendants() methods.
 *
 * VULNERABILITY: The current implementation at db/graph/organization.ts:520-532 has:
 * ```typescript
 * async getAncestors(orgId: string): Promise<Organization[]> {
 *   const ancestors: Organization[] = []
 *   let currentId = orgId
 *
 *   while (true) {  // NO CYCLE DETECTION!
 *     const parent = await this.getParent(currentId)
 *     if (!parent) break
 *     ancestors.push(parent)
 *     currentId = parent.id
 *   }
 *   return ancestors
 * }
 * ```
 *
 * RED PHASE TEST STRATEGY:
 * Since the vulnerable implementation doesn't yield to the event loop (it's a tight
 * while loop with async/await), Promise.race timeouts don't work - the loop runs until
 * memory is exhausted. Instead, we:
 *
 * 1. Test that cycles CAN be created (setup verification)
 * 2. Test normal (non-cyclic) hierarchies work correctly
 * 3. Use `.fails` modifier for cycle tests to document they should fail/hang
 * 4. GREEN phase will convert these to passing tests
 *
 * Uses real GraphEngine, NO MOCKS - per project testing philosophy.
 *
 * @see dotdo-sf4zf - [RED] Infinite Loop Tests - Organization getAncestors cycle detection
 * @see dotdo-tcwbd - [GREEN] Infinite Loop Fix - Cycle detection in getAncestors
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine } from '../index'
import { createOrganizationStore, CycleDetectedError, type OrganizationStore, type Organization, CHILD_OF_EDGE } from '../organization'

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum depth for hierarchy tests.
 * Used to verify the implementation handles deep hierarchies without cycles.
 */
const DEEP_HIERARCHY_DEPTH = 100

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper to create an organization hierarchy
 */
async function createOrgHierarchy(
  store: OrganizationStore,
  depth: number,
  prefix = 'org'
): Promise<Organization[]> {
  const orgs: Organization[] = []

  for (let i = 0; i < depth; i++) {
    const parentId = i > 0 ? orgs[i - 1]!.id : undefined
    const org = await store.create({
      name: `${prefix}-${i}`,
      slug: `${prefix}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'department',
      status: 'active',
      parentId,
    })
    orgs.push(org)
  }

  return orgs
}

/**
 * Helper to create a circular hierarchy by manually adding an edge.
 * This bypasses normal validation to simulate data corruption or malicious injection.
 */
async function injectCircularReference(
  graph: GraphEngine,
  fromOrgId: string,
  toOrgId: string
): Promise<void> {
  // Directly create an edge that creates a cycle
  await graph.createEdge(fromOrgId, CHILD_OF_EDGE, toOrgId)
}

/**
 * Verifies that a circular reference was successfully injected by checking
 * that querying edges returns the cycle edge.
 */
async function verifyCycleExists(
  graph: GraphEngine,
  fromOrgId: string,
  toOrgId: string
): Promise<boolean> {
  const edges = await graph.queryEdges({
    from: fromOrgId,
    to: toOrgId,
    type: CHILD_OF_EDGE,
  })
  return edges.length > 0
}

// ============================================================================
// SETUP VERIFICATION TESTS
// These tests verify that our test setup works correctly
// ============================================================================

describe('Cycle Detection Test Setup', () => {
  let graph: GraphEngine
  let store: OrganizationStore

  beforeEach(() => {
    graph = new GraphEngine()
    store = createOrganizationStore(graph)
  })

  it('can create organizations with parent-child relationships', async () => {
    const parent = await store.create({
      name: 'Parent',
      slug: `parent-setup-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    const child = await store.create({
      name: 'Child',
      slug: `child-setup-${Date.now()}`,
      type: 'department',
      status: 'active',
      parentId: parent.id,
    })

    const foundParent = await store.getParent(child.id)
    expect(foundParent).not.toBeNull()
    expect(foundParent?.id).toBe(parent.id)
  })

  it('can inject circular references using direct edge creation', async () => {
    const orgA = await store.create({
      name: 'Org A',
      slug: `setup-a-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    const orgB = await store.create({
      name: 'Org B',
      slug: `setup-b-${Date.now()}`,
      type: 'department',
      status: 'active',
      parentId: orgA.id,
    })

    // Inject cycle: A's parent is B (this creates A -> B -> A)
    await injectCircularReference(graph, orgA.id, orgB.id)

    // Verify the cycle edge exists
    const cycleExists = await verifyCycleExists(graph, orgA.id, orgB.id)
    expect(cycleExists).toBe(true)
  })

  it('can inject self-referential cycle', async () => {
    const orgA = await store.create({
      name: 'Self Ref Org',
      slug: `self-ref-setup-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    // Inject self-reference: A points to itself
    await injectCircularReference(graph, orgA.id, orgA.id)

    // Verify the self-reference exists
    const cycleExists = await verifyCycleExists(graph, orgA.id, orgA.id)
    expect(cycleExists).toBe(true)
  })
})

// ============================================================================
// NORMAL HIERARCHY TESTS (should always pass)
// These verify getAncestors works correctly without cycles
// ============================================================================

describe('OrganizationStore.getAncestors - Normal Hierarchies', () => {
  let graph: GraphEngine
  let store: OrganizationStore

  beforeEach(() => {
    graph = new GraphEngine()
    store = createOrganizationStore(graph)
  })

  it('returns empty array for root node (no ancestors)', async () => {
    const rootOrg = await store.create({
      name: 'Root Org',
      slug: `root-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    const ancestors = await store.getAncestors(rootOrg.id)
    expect(ancestors).toEqual([])
  })

  it('returns single ancestor for direct child', async () => {
    const parent = await store.create({
      name: 'Parent',
      slug: `parent-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    const child = await store.create({
      name: 'Child',
      slug: `child-${Date.now()}`,
      type: 'department',
      status: 'active',
      parentId: parent.id,
    })

    const ancestors = await store.getAncestors(child.id)
    expect(ancestors).toHaveLength(1)
    expect(ancestors[0]!.id).toBe(parent.id)
  })

  it('returns ancestors in correct order (parent first, root last)', async () => {
    const grandparent = await store.create({
      name: 'Grandparent',
      slug: `gp-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    const parent = await store.create({
      name: 'Parent',
      slug: `p-${Date.now()}`,
      type: 'department',
      status: 'active',
      parentId: grandparent.id,
    })

    const child = await store.create({
      name: 'Child',
      slug: `c-${Date.now()}`,
      type: 'team',
      status: 'active',
      parentId: parent.id,
    })

    const ancestors = await store.getAncestors(child.id)
    expect(ancestors).toHaveLength(2)
    expect(ancestors[0]!.id).toBe(parent.id) // Immediate parent first
    expect(ancestors[1]!.id).toBe(grandparent.id) // Root last
  })

  it('handles deep hierarchy without cycles (100 levels)', async () => {
    const orgs = await createOrgHierarchy(store, DEEP_HIERARCHY_DEPTH, 'deep')

    // Get ancestors from the deepest node
    const deepestOrg = orgs[DEEP_HIERARCHY_DEPTH - 1]!
    const ancestors = await store.getAncestors(deepestOrg.id)

    // Should return all ancestors (depth - 1 because root has no ancestor)
    expect(ancestors.length).toBe(DEEP_HIERARCHY_DEPTH - 1)

    // Verify order: immediate parent first, root last
    expect(ancestors[0]!.id).toBe(orgs[DEEP_HIERARCHY_DEPTH - 2]!.id)
    expect(ancestors[ancestors.length - 1]!.id).toBe(orgs[0]!.id)
  }, 30000)
})

// ============================================================================
// NORMAL DESCENDANTS TESTS (should always pass)
// ============================================================================

describe('OrganizationStore.getDescendants - Normal Hierarchies', () => {
  let graph: GraphEngine
  let store: OrganizationStore

  beforeEach(() => {
    graph = new GraphEngine()
    store = createOrganizationStore(graph)
  })

  it('returns empty array for leaf node (no descendants)', async () => {
    const leafOrg = await store.create({
      name: 'Leaf Org',
      slug: `leaf-${Date.now()}`,
      type: 'team',
      status: 'active',
    })

    const descendants = await store.getDescendants(leafOrg.id)
    expect(descendants).toEqual([])
  })

  it('returns single descendant for parent with one child', async () => {
    const parent = await store.create({
      name: 'Parent',
      slug: `parent-desc-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    const child = await store.create({
      name: 'Child',
      slug: `child-desc-${Date.now()}`,
      type: 'department',
      status: 'active',
      parentId: parent.id,
    })

    const descendants = await store.getDescendants(parent.id)
    expect(descendants).toHaveLength(1)
    expect(descendants[0]!.id).toBe(child.id)
  })

  it('returns all descendants in multi-level hierarchy', async () => {
    const depth = 50
    const orgs = await createOrgHierarchy(store, depth, 'desc-deep')

    // Get descendants from the root node
    const rootOrg = orgs[0]!
    const descendants = await store.getDescendants(rootOrg.id)

    // Should return all descendants (depth - 1 because root is not its own descendant)
    expect(descendants.length).toBe(depth - 1)
  }, 15000)
})

// ============================================================================
// CYCLE DETECTION TESTS - getAncestors()
//
// These tests document the EXPECTED behavior after the fix is applied.
// During RED phase, these tests are skipped because they would cause OOM.
// During GREEN phase, unskip these and they should pass.
// ============================================================================

describe('OrganizationStore.getAncestors - Cycle Detection (RED: skipped, GREEN: unskip)', () => {
  let graph: GraphEngine
  let store: OrganizationStore

  beforeEach(() => {
    graph = new GraphEngine()
    store = createOrganizationStore(graph)
  })

  describe('3-Node Cycle (A -> B -> C -> A)', () => {
    /**
     * GREEN PHASE: This test is now enabled and expects CycleDetectedError
     *
     * Current vulnerable code will loop forever on this input:
     * - A is parent of B
     * - B is parent of C
     * - We inject: C is also parent of A (creating cycle)
     * - getAncestors(C) will loop: C -> B -> A -> C -> B -> A -> ... (infinite)
     */
    it('should detect cycle and throw CycleDetectedError', async () => {
      const orgA = await store.create({
        name: 'Org A',
        slug: `cycle-a-${Date.now()}`,
        type: 'company',
        status: 'active',
      })

      const orgB = await store.create({
        name: 'Org B',
        slug: `cycle-b-${Date.now()}`,
        type: 'department',
        status: 'active',
        parentId: orgA.id,
      })

      const orgC = await store.create({
        name: 'Org C',
        slug: `cycle-c-${Date.now()}`,
        type: 'team',
        status: 'active',
        parentId: orgB.id,
      })

      // Inject cycle: A's parent is C (creating A -> B -> C -> A)
      await injectCircularReference(graph, orgA.id, orgC.id)

      // After fix, this should throw CycleDetectedError
      await expect(store.getAncestors(orgC.id)).rejects.toThrow(CycleDetectedError)
    })
  })

  describe('Self-Referential Cycle (A -> A)', () => {
    /**
     * GREEN PHASE: This test is now enabled and expects CycleDetectedError
     */
    it('should detect self-reference and throw CycleDetectedError', async () => {
      const orgA = await store.create({
        name: 'Self-Ref Org',
        slug: `self-${Date.now()}`,
        type: 'company',
        status: 'active',
      })

      // Inject self-reference
      await injectCircularReference(graph, orgA.id, orgA.id)

      // After fix, should detect self-reference immediately and throw
      await expect(store.getAncestors(orgA.id)).rejects.toThrow(CycleDetectedError)
    })
  })

  describe('2-Node Cycle (A -> B -> A)', () => {
    /**
     * GREEN PHASE: This test is now enabled and expects CycleDetectedError
     */
    it('should detect 2-node cycle and throw CycleDetectedError', async () => {
      const orgA = await store.create({
        name: 'Org A',
        slug: `two-a-${Date.now()}`,
        type: 'company',
        status: 'active',
      })

      const orgB = await store.create({
        name: 'Org B',
        slug: `two-b-${Date.now()}`,
        type: 'department',
        status: 'active',
        parentId: orgA.id,
      })

      // Inject cycle: A's parent is B (A -> B -> A)
      await injectCircularReference(graph, orgA.id, orgB.id)

      // After fix, should detect cycle and throw
      await expect(store.getAncestors(orgB.id)).rejects.toThrow(CycleDetectedError)
    })
  })

  describe('5-Node Cycle (A -> B -> C -> D -> E -> A)', () => {
    /**
     * GREEN PHASE: This test is now enabled and expects CycleDetectedError
     */
    it('should detect 5-node cycle and throw CycleDetectedError', async () => {
      const orgs: Organization[] = []
      let parentId: string | undefined

      for (let i = 0; i < 5; i++) {
        const org = await store.create({
          name: `Org ${String.fromCharCode(65 + i)}`,
          slug: `five-${String.fromCharCode(97 + i)}-${Date.now()}`,
          type: 'department',
          status: 'active',
          parentId,
        })
        orgs.push(org)
        parentId = org.id
      }

      // Inject cycle: A's parent is E
      await injectCircularReference(graph, orgs[0]!.id, orgs[4]!.id)

      // After fix, should detect cycle and throw
      await expect(store.getAncestors(orgs[4]!.id)).rejects.toThrow(CycleDetectedError)
    })
  })
})

// ============================================================================
// CYCLE DETECTION TESTS - getDescendants()
// ============================================================================

describe('OrganizationStore.getDescendants - Cycle Detection', () => {
  let graph: GraphEngine
  let store: OrganizationStore

  beforeEach(() => {
    graph = new GraphEngine()
    store = createOrganizationStore(graph)
  })

  /**
   * GREEN PHASE: This test is now enabled and expects CycleDetectedError
   */
  it('should detect cycle when traversing descendants and throw CycleDetectedError', async () => {
    const orgA = await store.create({
      name: 'Org A',
      slug: `desc-cycle-a-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    const orgB = await store.create({
      name: 'Org B',
      slug: `desc-cycle-b-${Date.now()}`,
      type: 'department',
      status: 'active',
      parentId: orgA.id,
    })

    const orgC = await store.create({
      name: 'Org C',
      slug: `desc-cycle-c-${Date.now()}`,
      type: 'team',
      status: 'active',
      parentId: orgB.id,
    })

    // Inject cycle: A is also a child of C (creating A -> B -> C -> A loop in descendant traversal)
    await injectCircularReference(graph, orgA.id, orgC.id)

    // After fix, should detect cycle and throw
    await expect(store.getDescendants(orgA.id)).rejects.toThrow(CycleDetectedError)
  })
})

// ============================================================================
// EXPECTED ERROR BEHAVIOR (GREEN phase)
// ============================================================================

describe('CycleDetectedError Behavior', () => {
  let graph: GraphEngine
  let store: OrganizationStore

  beforeEach(() => {
    graph = new GraphEngine()
    store = createOrganizationStore(graph)
  })

  it('should throw CycleDetectedError on circular hierarchy', async () => {
    const orgA = await store.create({
      name: 'Org A',
      slug: `err-a-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    const orgB = await store.create({
      name: 'Org B',
      slug: `err-b-${Date.now()}`,
      type: 'department',
      status: 'active',
      parentId: orgA.id,
    })

    await injectCircularReference(graph, orgA.id, orgB.id)

    // Should throw CycleDetectedError
    await expect(store.getAncestors(orgB.id)).rejects.toThrow(CycleDetectedError)
  })

  it('should include cycle node id in error', async () => {
    const orgA = await store.create({
      name: 'Org A',
      slug: `path-a-${Date.now()}`,
      type: 'company',
      status: 'active',
    })

    const orgB = await store.create({
      name: 'Org B',
      slug: `path-b-${Date.now()}`,
      type: 'department',
      status: 'active',
      parentId: orgA.id,
    })

    await injectCircularReference(graph, orgA.id, orgB.id)

    try {
      await store.getAncestors(orgB.id)
      expect.fail('Should have thrown CycleDetectedError')
    } catch (error) {
      expect(error).toBeInstanceOf(CycleDetectedError)
      expect((error as CycleDetectedError).message).toMatch(/cycle/i)
      expect((error as CycleDetectedError).cycleNodeId).toBeDefined()
    }
  })
})

// ============================================================================
// MAX DEPTH PROTECTION (GREEN phase)
// ============================================================================

describe('Max Depth Protection', () => {
  let graph: GraphEngine
  let store: OrganizationStore

  beforeEach(() => {
    graph = new GraphEngine()
    store = createOrganizationStore(graph)
  })

  it('should respect maxDepth parameter to prevent runaway traversal', async () => {
    const orgs = await createOrgHierarchy(store, 50, 'maxdepth')
    const deepestOrg = orgs[49]!

    // getAncestors accepts optional maxDepth
    const ancestors = await store.getAncestors(deepestOrg.id, 10)

    expect(ancestors.length).toBe(10)
  })

  it('should use default maxDepth of 100', async () => {
    const orgs = await createOrgHierarchy(store, DEEP_HIERARCHY_DEPTH, 'default-depth')
    const deepestOrg = orgs[DEEP_HIERARCHY_DEPTH - 1]!

    // Default maxDepth is 100, so with 100 levels (99 ancestors), all should be returned
    const ancestors = await store.getAncestors(deepestOrg.id)
    expect(ancestors.length).toBe(DEEP_HIERARCHY_DEPTH - 1)
  }, 30000)

  it('should respect maxDepth parameter for getDescendants', async () => {
    const orgs = await createOrgHierarchy(store, 50, 'desc-maxdepth')
    const rootOrg = orgs[0]!

    // getDescendants accepts optional maxDepth
    const descendants = await store.getDescendants(rootOrg.id, 10)

    expect(descendants.length).toBe(10)
  })
})
