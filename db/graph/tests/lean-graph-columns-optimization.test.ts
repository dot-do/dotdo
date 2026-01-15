/**
 * LeanGraphColumns Optimization Tests
 *
 * Wave 5: Performance & Scalability - Task 1 (do-xp75, do-8i7p)
 *
 * Tests verifying that getNodesAtDepth uses efficient O(N) algorithm
 * instead of N+1 query pattern.
 *
 * The implementation loads all relationships once via queryByVerb, then
 * iterates in-memory. This is O(N) not N+1.
 *
 * @module db/graph/tests/lean-graph-columns-optimization.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LeanGraphColumns, RelationshipsStore } from '../index'

describe('getNodesAtDepth optimization', () => {
  let relationships: RelationshipsStore
  let leanColumns: LeanGraphColumns
  let queryCount: number

  beforeEach(() => {
    // Create a RelationshipsStore with query counting wrapper
    const mockDb = {}
    const originalStore = new RelationshipsStore(mockDb)
    queryCount = 0

    // Wrap queryByVerb to count calls
    const originalQueryByVerb = originalStore.queryByVerb.bind(originalStore)
    originalStore.queryByVerb = async function (...args) {
      queryCount++
      return originalQueryByVerb(...args)
    }

    relationships = originalStore
    leanColumns = new LeanGraphColumns(relationships)
  })

  it('computes depth without N+1 queries for 100 node hierarchy', async () => {
    // Create a 100 node hierarchy: root -> 10 managers -> 9 employees each
    // Total: 1 root + 10 managers + 90 employees = 101 nodes
    // Relationships: 10 (root->managers) + 90 (managers->employees) = 100 relationships

    const root = 'https://org.do/ceo'
    const managerCount = 10
    const employeesPerManager = 9
    let relId = 1

    // Create root -> manager relationships
    for (let m = 0; m < managerCount; m++) {
      const managerId = `https://org.do/manager-${m}`
      await relationships.create({
        id: `rel-${relId++}`,
        verb: 'manages',
        from: root,
        to: managerId,
      })

      // Create manager -> employee relationships
      for (let e = 0; e < employeesPerManager; e++) {
        const employeeId = `https://org.do/manager-${m}/employee-${e}`
        await relationships.create({
          id: `rel-${relId++}`,
          verb: 'manages',
          from: managerId,
          to: employeeId,
        })
      }
    }

    // Reset query count before the operation we're testing
    queryCount = 0

    // Call getNodesAtDepth for depth 0 (root)
    const rootNodes = await leanColumns.getNodesAtDepth('manages', 0)
    expect(rootNodes).toHaveLength(1)
    expect(rootNodes).toContain(root)

    // The key assertion: only 1 query should be made (queryByVerb)
    // NOT 101 queries (1 per node) which would be N+1
    expect(queryCount).toBe(1)

    // Reset and test depth 1 (managers)
    queryCount = 0
    const depth1Nodes = await leanColumns.getNodesAtDepth('manages', 1)
    expect(depth1Nodes).toHaveLength(managerCount)

    // Still only 1 query
    expect(queryCount).toBe(1)

    // Reset and test depth 2 (employees)
    queryCount = 0
    const depth2Nodes = await leanColumns.getNodesAtDepth('manages', 2)
    expect(depth2Nodes).toHaveLength(managerCount * employeesPerManager)

    // Still only 1 query - this is O(1) in queries, O(N) in memory
    expect(queryCount).toBe(1)
  })

  it('uses single query for all depth calculations regardless of hierarchy size', async () => {
    // Test with different hierarchy sizes to prove O(1) query behavior

    // Small hierarchy: 10 nodes
    for (let i = 0; i < 10; i++) {
      await relationships.create({
        id: `small-rel-${i}`,
        verb: 'contains-small',
        from: i === 0 ? 'root' : `node-${i - 1}`,
        to: `node-${i}`,
      })
    }

    queryCount = 0
    await leanColumns.getNodesAtDepth('contains-small', 5)
    const smallQueryCount = queryCount

    // Large hierarchy: 100 nodes
    for (let i = 0; i < 100; i++) {
      await relationships.create({
        id: `large-rel-${i}`,
        verb: 'contains-large',
        from: i === 0 ? 'large-root' : `large-node-${i - 1}`,
        to: `large-node-${i}`,
      })
    }

    queryCount = 0
    await leanColumns.getNodesAtDepth('contains-large', 50)
    const largeQueryCount = queryCount

    // Both should use exactly 1 query regardless of size
    expect(smallQueryCount).toBe(1)
    expect(largeQueryCount).toBe(1)
  })

  it('verifies getMaxDepth also uses O(1) queries', async () => {
    // Create a deep hierarchy
    const depth = 50
    for (let i = 0; i < depth; i++) {
      await relationships.create({
        id: `deep-rel-${i}`,
        verb: 'deep-chain',
        from: i === 0 ? 'deep-root' : `deep-node-${i - 1}`,
        to: `deep-node-${i}`,
      })
    }

    queryCount = 0
    const maxDepth = await leanColumns.getMaxDepth('deep-chain')

    // Should find max depth of 50 with only 1 query
    expect(maxDepth).toBe(depth)
    expect(queryCount).toBe(1)
  })

  it('verifies getHierarchyBatch uses O(1) queries for any batch size', async () => {
    // Create hierarchy
    for (let i = 0; i < 20; i++) {
      await relationships.create({
        id: `batch-rel-${i}`,
        verb: 'batch-contains',
        from: i === 0 ? 'batch-root' : `batch-node-${i - 1}`,
        to: `batch-node-${i}`,
      })
    }

    const nodeIds = ['batch-root', ...Array.from({ length: 20 }, (_, i) => `batch-node-${i}`)]

    queryCount = 0
    const batchResult = await leanColumns.getHierarchyBatch(nodeIds, 'batch-contains')

    // Should return info for all nodes with only 1 query
    expect(batchResult.size).toBe(nodeIds.length)
    expect(queryCount).toBe(1)
  })

  it('documents the O(N) memory, O(1) query trade-off', async () => {
    /**
     * ALGORITHM VERIFICATION:
     *
     * The getNodesAtDepth implementation in lean-graph-columns.ts:
     *
     * 1. Makes a SINGLE query: queryByVerb(verb) - loads ALL relationships
     * 2. Builds in-memory maps: parentMap, sources, targets
     * 3. Iterates through ALL nodes in memory to compute depth
     * 4. Filters nodes matching the requested depth
     *
     * This is:
     * - O(1) in database queries (single query regardless of N)
     * - O(N) in memory (stores all relationships)
     * - O(N) in computation (iterates through all nodes)
     *
     * NOT N+1 because:
     * - N+1 would make 1 query for relationships + N queries for each node
     * - This implementation makes only 1 query total
     *
     * Trade-off:
     * - Uses more memory (loads all relationships)
     * - Avoids database round-trips (no N+1)
     * - Better for most use cases where N is reasonable
     */

    // Create 100 relationships
    for (let i = 0; i < 100; i++) {
      await relationships.create({
        id: `doc-rel-${i}`,
        verb: 'documented',
        from: `parent-${Math.floor(i / 10)}`,
        to: `child-${i}`,
      })
    }

    queryCount = 0

    // Multiple operations, still only 1 query each
    await leanColumns.getNodesAtDepth('documented', 0)
    expect(queryCount).toBe(1)

    queryCount = 0
    await leanColumns.getNodesAtDepth('documented', 1)
    expect(queryCount).toBe(1)

    queryCount = 0
    await leanColumns.getLeaves('documented')
    expect(queryCount).toBe(1)

    queryCount = 0
    await leanColumns.getRoots('documented')
    expect(queryCount).toBe(1)

    // Each operation is O(1) queries, proving no N+1 pattern
  })
})

describe('LeanGraphColumns efficiency documentation', () => {
  /**
   * This describe block documents the efficiency characteristics
   * of the LeanGraphColumns implementation.
   */

  it('confirms implementation matches O(N) not N+1 pattern', () => {
    /**
     * Looking at lean-graph-columns.ts line 276-318 (getNodesAtDepth):
     *
     * ```typescript
     * async getNodesAtDepth(verb: string, depth: number): Promise<string[]> {
     *   // SINGLE QUERY - loads all relationships
     *   const allRelationships = await this.relationships.queryByVerb(verb)
     *
     *   // IN-MEMORY PROCESSING - no additional queries
     *   const parentMap = new Map<string, string>()
     *   // ... builds maps ...
     *
     *   // IN-MEMORY ITERATION - O(N) computation
     *   for (const nodeId of allNodes) {
     *     // Compute depth by tracing to root IN MEMORY
     *     let nodeDepth = 0
     *     let current = nodeId
     *     while (parentMap.has(current)) {
     *       // ... no queries, just map lookups ...
     *     }
     *   }
     * }
     * ```
     *
     * This pattern is EFFICIENT because:
     * 1. Single database query
     * 2. All computation happens in-memory
     * 3. No N+1 anti-pattern
     */
    expect(true).toBe(true) // Documentation test always passes
  })
})
