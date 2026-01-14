/**
 * Escalation Chains via Graph Traversal Tests
 *
 * TDD RED Phase: Tests for organizational escalation chains that traverse
 * the graph hierarchy: Human -> Manager -> Executive
 *
 * Unlike capability-tier escalation (Code -> Generative -> Agentic -> Human),
 * these tests focus on ORGANIZATIONAL escalation paths within the Human tier:
 *
 * 1. Support Agent -> Team Manager -> Department Head -> VP -> C-Level
 * 2. Role-based escalation using graph relationships
 * 3. Multi-path escalation (parallel to legal, finance, etc.)
 *
 * Uses GraphEngine for integration - NO MOCKS per CLAUDE.md guidelines.
 *
 * @see dotdo-ebkg0 - [RED] Test: Escalation chains via graph traversal
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine } from '../graph-engine'
import { EscalationChainGraph, TIER_ORDER } from '../escalation-chain-graph'

// ============================================================================
// TYPES FOR ORGANIZATIONAL ESCALATION
// ============================================================================

/**
 * Organizational escalation target (human role in hierarchy)
 */
interface OrgEscalationTarget {
  id: string
  role: string
  tier: 'human' // Always human tier for org escalation
  reportingTo?: string // Manager's target ID
  department?: string
  sla?: number
  available: boolean
}

/**
 * Organizational escalation path entry
 */
interface OrgEscalationPathEntry {
  targetId: string
  role: string
  level: number // 0 = direct report, 1 = manager, 2 = director, etc.
  sla?: number
}

/**
 * Organizational escalation chain service interface
 *
 * This is the interface we're testing for (RED phase - does not exist yet)
 */
interface OrgEscalationChainService {
  /**
   * Register a human role in the escalation hierarchy
   */
  registerHumanRole(target: OrgEscalationTarget): Promise<void>

  /**
   * Set reporting relationship (A reports to B)
   */
  setReportingTo(targetId: string, managerId: string): Promise<void>

  /**
   * Get the escalation path from a starting role up the hierarchy
   */
  getEscalationPath(
    startingRoleId: string,
    options?: { maxLevels?: number; availableOnly?: boolean }
  ): Promise<OrgEscalationPathEntry[]>

  /**
   * Find the next available escalation target
   */
  findNextEscalationTarget(
    currentTargetId: string,
    options?: { excludeIds?: string[] }
  ): Promise<OrgEscalationTarget | null>

  /**
   * Create an escalation chain for a request
   */
  createEscalationChain(
    requestId: string,
    startingRoleId: string,
    options?: { reason: string; priority?: number }
  ): Promise<{
    chainId: string
    currentTarget: OrgEscalationTarget
    path: OrgEscalationPathEntry[]
  }>

  /**
   * Escalate to the next level in the chain
   */
  escalateToNextLevel(
    chainId: string,
    reason: string
  ): Promise<{
    newTarget: OrgEscalationTarget | null
    level: number
    exhausted: boolean
  }>

  /**
   * Get the full organizational hierarchy for a department
   */
  getDepartmentHierarchy(
    department: string
  ): Promise<Array<{ target: OrgEscalationTarget; level: number; subordinates: string[] }>>

  /**
   * Find shortest escalation path between two roles
   */
  findShortestPath(
    fromRoleId: string,
    toRoleId: string
  ): Promise<OrgEscalationPathEntry[] | null>

  /**
   * Check if escalation to a specific target is valid
   */
  canEscalateTo(
    fromTargetId: string,
    toTargetId: string
  ): Promise<{ valid: boolean; reason?: string }>
}

// ============================================================================
// TEST SUITE: Organizational Escalation Chains via Graph Traversal
// ============================================================================

describe('Escalation Chains via Graph Traversal [RED]', () => {
  let graph: GraphEngine
  let escalationGraph: EscalationChainGraph

  beforeEach(async () => {
    graph = new GraphEngine()
    escalationGraph = new EscalationChainGraph(graph)
  })

  // ==========================================================================
  // 1. Organizational Hierarchy Setup
  // ==========================================================================

  describe('Organizational Hierarchy Setup', () => {
    it('should register human roles with reporting relationships', async () => {
      // Register CEO (top of hierarchy)
      const ceo = await escalationGraph.registerTarget({
        type: 'human',
        name: 'CEO',
        tier: 'human',
        priority: 1,
        sla: 4 * 60 * 60 * 1000, // 4 hours
      })

      // Register VP
      const vp = await escalationGraph.registerTarget({
        type: 'human',
        name: 'VP Engineering',
        tier: 'human',
        priority: 2,
        sla: 2 * 60 * 60 * 1000, // 2 hours
      })

      // Register Director
      const director = await escalationGraph.registerTarget({
        type: 'human',
        name: 'Engineering Director',
        tier: 'human',
        priority: 3,
        sla: 1 * 60 * 60 * 1000, // 1 hour
      })

      // Register Manager
      const manager = await escalationGraph.registerTarget({
        type: 'human',
        name: 'Team Manager',
        tier: 'human',
        priority: 4,
        sla: 30 * 60 * 1000, // 30 minutes
      })

      expect(ceo).toBeDefined()
      expect(vp).toBeDefined()
      expect(director).toBeDefined()
      expect(manager).toBeDefined()
    })

    it('should create REPORTS_TO edges for organizational hierarchy', async () => {
      // Note: Graph engine supports creating arbitrary edges already.
      // This test verifies that REPORTS_TO edges can be created for org hierarchy.
      // The RED phase test is about traversing these edges for escalation paths.
      const ceo = await escalationGraph.registerTarget({
        type: 'human',
        name: 'CEO',
        tier: 'human',
      })

      const vp = await escalationGraph.registerTarget({
        type: 'human',
        name: 'VP',
        tier: 'human',
      })

      // Create REPORTS_TO edge: VP reports to CEO
      const edge = await graph.createEdge(vp.id, 'REPORTS_TO', ceo.id, {
        relationship: 'direct',
        department: 'engineering',
      })

      expect(edge.type).toBe('REPORTS_TO')

      // Query edges to verify the relationship
      const edges = await graph.queryEdges({
        from: vp.id,
        type: 'REPORTS_TO',
      })

      expect(edges.length).toBe(1)
      expect(edges[0]?.to).toBe(ceo.id)
    })

    it.fails('should traverse organizational hierarchy via graph relationships', async () => {
      // Setup hierarchy: Support -> Manager -> Director -> VP -> CEO
      const targets = await setupOrgHierarchy(escalationGraph)

      // This should fail because we haven't implemented getEscalationPath
      // that uses REPORTS_TO relationships for organizational escalation
      const path = await escalationGraph.getTargetEscalationChain(targets.support.id)

      // Expected: [Manager, Director, VP, CEO]
      expect(path.length).toBe(4)
      expect(path[0]?.properties.name).toBe('Manager')
      expect(path[1]?.properties.name).toBe('Director')
      expect(path[2]?.properties.name).toBe('VP')
      expect(path[3]?.properties.name).toBe('CEO')
    })
  })

  // ==========================================================================
  // 2. Escalation Path Resolution
  // ==========================================================================

  describe('Escalation Path Resolution', () => {
    it.fails('should resolve full escalation path from support to executive', async () => {
      // Setup hierarchy
      const targets = await setupOrgHierarchy(escalationGraph)

      // This should fail because getOrgEscalationPath doesn't exist yet
      const service = createOrgEscalationService(escalationGraph)

      const path = await service.getEscalationPath(targets.support.id)

      expect(path).toEqual([
        { targetId: targets.manager.id, role: 'Manager', level: 1, sla: 30 * 60 * 1000 },
        { targetId: targets.director.id, role: 'Director', level: 2, sla: 60 * 60 * 1000 },
        { targetId: targets.vp.id, role: 'VP', level: 3, sla: 2 * 60 * 60 * 1000 },
        { targetId: targets.ceo.id, role: 'CEO', level: 4, sla: 4 * 60 * 60 * 1000 },
      ])
    })

    it.fails('should skip unavailable targets in escalation path', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      // Mark manager as unavailable
      await escalationGraph.setTargetAvailability(targets.manager.id, false)

      const service = createOrgEscalationService(escalationGraph)
      const path = await service.getEscalationPath(targets.support.id, {
        availableOnly: true,
      })

      // Should skip manager and go directly to director
      expect(path[0]?.role).toBe('Director')
      expect(path.length).toBe(3) // Director, VP, CEO
    })

    it.fails('should respect max levels in escalation path', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      const service = createOrgEscalationService(escalationGraph)
      const path = await service.getEscalationPath(targets.support.id, {
        maxLevels: 2,
      })

      expect(path.length).toBe(2) // Only Manager and Director
      expect(path[0]?.role).toBe('Manager')
      expect(path[1]?.role).toBe('Director')
    })

    it.fails('should find shortest path between two roles', async () => {
      // Setup a more complex hierarchy with multiple paths
      // Support -> Manager -> Director -> VP -> CEO
      //         -> Legal Manager -> Legal Director -> CEO

      const targets = await setupComplexOrgHierarchy(escalationGraph)

      const service = createOrgEscalationService(escalationGraph)
      const shortestPath = await service.findShortestPath(
        targets.support.id,
        targets.ceo.id
      )

      // Should find the shortest path (fewer hops)
      expect(shortestPath).not.toBeNull()
      expect(shortestPath!.length).toBeLessThanOrEqual(4)
    })
  })

  // ==========================================================================
  // 3. Escalation Chain Lifecycle
  // ==========================================================================

  describe('Escalation Chain Lifecycle', () => {
    it.fails('should create organizational escalation chain', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      const service = createOrgEscalationService(escalationGraph)

      const result = await service.createEscalationChain(
        'request-123',
        targets.support.id,
        { reason: 'Customer issue needs manager approval', priority: 2 }
      )

      expect(result.chainId).toBeDefined()
      expect(result.currentTarget.role).toBe('Support')
      expect(result.path.length).toBe(4) // Manager, Director, VP, CEO
    })

    it.fails('should escalate through organizational hierarchy', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      const service = createOrgEscalationService(escalationGraph)

      // Create chain at support level
      const chain = await service.createEscalationChain(
        'request-456',
        targets.support.id,
        { reason: 'Initial request', priority: 1 }
      )

      // Escalate to manager
      const level1 = await service.escalateToNextLevel(
        chain.chainId,
        'Support unable to resolve within SLA'
      )

      expect(level1.newTarget?.role).toBe('Manager')
      expect(level1.level).toBe(1)
      expect(level1.exhausted).toBe(false)

      // Escalate to director
      const level2 = await service.escalateToNextLevel(
        chain.chainId,
        'Manager unable to resolve'
      )

      expect(level2.newTarget?.role).toBe('Director')
      expect(level2.level).toBe(2)

      // Escalate to VP
      const level3 = await service.escalateToNextLevel(chain.chainId, 'Needs VP approval')

      expect(level3.newTarget?.role).toBe('VP')
      expect(level3.level).toBe(3)

      // Escalate to CEO (final level)
      const level4 = await service.escalateToNextLevel(chain.chainId, 'Needs CEO decision')

      expect(level4.newTarget?.role).toBe('CEO')
      expect(level4.level).toBe(4)

      // Try to escalate beyond CEO
      const beyond = await service.escalateToNextLevel(chain.chainId, 'No more levels')

      expect(beyond.newTarget).toBeNull()
      expect(beyond.exhausted).toBe(true)
    })

    it.fails('should record escalation history in graph', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      const service = createOrgEscalationService(escalationGraph)
      const chain = await service.createEscalationChain(
        'request-789',
        targets.support.id,
        { reason: 'Test request', priority: 2 }
      )

      // Escalate twice
      await service.escalateToNextLevel(chain.chainId, 'First escalation')
      await service.escalateToNextLevel(chain.chainId, 'Second escalation')

      // Query the escalation chain via graph
      const traversal = await escalationGraph.traverseChain(chain.chainId)

      expect(traversal.steps.length).toBe(3) // Support, Manager, Director
      expect(traversal.path.length).toBe(2) // Two ESCALATED_TO edges
    })
  })

  // ==========================================================================
  // 4. Department-Based Escalation
  // ==========================================================================

  describe('Department-Based Escalation', () => {
    it.fails('should get department hierarchy from graph', async () => {
      // Setup Engineering department hierarchy
      const engineering = await setupDepartmentHierarchy(escalationGraph, 'Engineering')

      const service = createOrgEscalationService(escalationGraph)
      const hierarchy = await service.getDepartmentHierarchy('Engineering')

      expect(hierarchy.length).toBeGreaterThan(0)

      // CEO should be at top
      const ceoEntry = hierarchy.find((h) => h.target.role === 'CEO')
      expect(ceoEntry).toBeDefined()
      expect(ceoEntry!.level).toBe(0)

      // VP should report to CEO
      const vpEntry = hierarchy.find((h) => h.target.role === 'VP')
      expect(vpEntry).toBeDefined()
      expect(vpEntry!.level).toBe(1)
    })

    it.fails('should escalate within department before cross-department', async () => {
      // Setup multiple departments
      const engineering = await setupDepartmentHierarchy(escalationGraph, 'Engineering')
      const legal = await setupDepartmentHierarchy(escalationGraph, 'Legal')

      const service = createOrgEscalationService(escalationGraph)

      // Escalation from Engineering support should go up Engineering hierarchy
      const path = await service.getEscalationPath(engineering.support.id)

      // Should escalate within Engineering first
      expect(path[0]?.department).toBe('Engineering')
      expect(path[1]?.department).toBe('Engineering')

      // Only at top should cross to Legal if needed
      const topLevel = path[path.length - 1]
      expect(topLevel?.role).toBe('CEO')
    })
  })

  // ==========================================================================
  // 5. Cross-Functional Escalation
  // ==========================================================================

  describe('Cross-Functional Escalation', () => {
    it.fails('should support parallel escalation to multiple departments', async () => {
      // Setup scenario: Technical issue that needs both Engineering and Legal
      const engineering = await setupDepartmentHierarchy(escalationGraph, 'Engineering')
      const legal = await setupDepartmentHierarchy(escalationGraph, 'Legal')

      const service = createOrgEscalationService(escalationGraph)

      // Create a request that needs multi-department escalation
      const chain = await service.createEscalationChain(
        'request-complex-001',
        engineering.support.id,
        { reason: 'Security breach - needs Engineering AND Legal', priority: 1 }
      )

      // Should be able to escalate to both Engineering VP and Legal VP in parallel
      // This tests graph's ability to handle multi-path escalation
      const engPath = await service.getEscalationPath(engineering.support.id)
      const legalPath = await service.getEscalationPath(legal.support.id)

      // Both paths should lead to CEO eventually
      const engTop = engPath[engPath.length - 1]
      const legalTop = legalPath[legalPath.length - 1]

      expect(engTop?.role).toBe('CEO')
      expect(legalTop?.role).toBe('CEO')
    })

    it.fails('should validate escalation targets before escalating', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      const service = createOrgEscalationService(escalationGraph)

      // Valid escalation: Support -> Manager
      const valid = await service.canEscalateTo(targets.support.id, targets.manager.id)
      expect(valid.valid).toBe(true)

      // Invalid escalation: Support -> CEO (skipping levels)
      const skipLevels = await service.canEscalateTo(targets.support.id, targets.ceo.id)
      expect(skipLevels.valid).toBe(false)
      expect(skipLevels.reason).toContain('skip')

      // Invalid escalation: Manager -> Support (downward)
      const downward = await service.canEscalateTo(targets.manager.id, targets.support.id)
      expect(downward.valid).toBe(false)
      expect(downward.reason).toContain('downward')
    })
  })

  // ==========================================================================
  // 6. SLA-Based Automatic Escalation
  // ==========================================================================

  describe('SLA-Based Automatic Escalation', () => {
    it.fails('should auto-escalate when SLA breached', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      const service = createOrgEscalationService(escalationGraph)
      const chain = await service.createEscalationChain(
        'request-sla-001',
        targets.support.id,
        { reason: 'Time-sensitive issue', priority: 1 }
      )

      // Simulate SLA breach at support level (30 min SLA)
      // In real implementation, this would be triggered by a timer/scheduler

      // Check SLA status - should indicate breach
      const slaStatus = await escalationGraph.getTierMetrics('human')

      // The chain should have auto-escalated to manager
      const currentTarget = await service.findNextEscalationTarget(targets.support.id)

      expect(currentTarget?.role).toBe('Manager')
    })

    it.fails('should respect escalation cooldown periods', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      const service = createOrgEscalationService(escalationGraph)
      const chain = await service.createEscalationChain(
        'request-cooldown-001',
        targets.support.id,
        { reason: 'Test cooldown', priority: 2 }
      )

      // First escalation should succeed
      const first = await service.escalateToNextLevel(chain.chainId, 'First')
      expect(first.newTarget).not.toBeNull()

      // Immediate second escalation should be blocked by cooldown
      // (can't spam escalations)
      await expect(
        service.escalateToNextLevel(chain.chainId, 'Too fast')
      ).rejects.toThrow(/cooldown/)
    })
  })

  // ==========================================================================
  // 7. Graph Traversal Queries
  // ==========================================================================

  describe('Graph Traversal Queries', () => {
    it.fails('should find all paths from a node to any executive', async () => {
      const targets = await setupComplexOrgHierarchy(escalationGraph)

      // Use graph traversal to find all paths from Support to any C-level
      const allPaths = await graph.traverse({
        start: targets.support.id,
        direction: 'outgoing',
        edgeType: 'REPORTS_TO',
        maxDepth: 10,
        filter: (node) => node.properties.role?.toString().startsWith('C'),
      })

      expect(allPaths.length).toBeGreaterThan(0)

      // All paths should eventually lead to CEO
      for (const path of allPaths) {
        const lastNode = path.nodes[path.nodes.length - 1]
        expect(['CEO', 'CFO', 'CTO']).toContain(lastNode?.properties.name)
      }
    })

    it.fails('should detect circular escalation paths', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      // Attempt to create circular reporting structure (should be prevented)
      // CEO -> VP -> Director -> CEO (circular!)

      await expect(
        graph.createEdge(targets.ceo.id, 'REPORTS_TO', targets.director.id)
      ).rejects.toThrow(/circular|cycle/)
    })

    it.fails('should calculate escalation chain depth efficiently', async () => {
      // Create a deep hierarchy (10 levels)
      const deepHierarchy = await setupDeepHierarchy(escalationGraph, 10)

      const service = createOrgEscalationService(escalationGraph)
      const path = await service.getEscalationPath(deepHierarchy.bottom.id)

      // Should traverse all 10 levels
      expect(path.length).toBe(10)

      // Performance check: should complete in reasonable time
      // (graph traversal should be O(depth), not O(n^2))
    })
  })

  // ==========================================================================
  // 8. Integration with Capability Tier Escalation
  // ==========================================================================

  describe('Integration with Capability Tier Escalation', () => {
    it('should support escalation from agentic tier to organizational hierarchy', async () => {
      // First, escalate through capability tiers
      const chain = await escalationGraph.createChain({
        errorMessage: 'Complex issue requiring human judgment',
        severity: 'high',
      })

      // Code tier fails
      await escalationGraph.recordStep(chain.id, {
        tier: 'code',
        success: false,
        error: 'No automated fix available',
        duration: 1000,
      })

      // Generative tier fails
      await escalationGraph.recordStep(chain.id, {
        tier: 'generative',
        success: false,
        error: 'AI cannot make business decision',
        duration: 2000,
      })

      // Agentic tier fails
      await escalationGraph.recordStep(chain.id, {
        tier: 'agentic',
        success: false,
        error: 'Requires human approval',
        duration: 3000,
      })

      // Now at human tier - should integrate with org hierarchy
      await escalationGraph.recordStep(chain.id, {
        tier: 'human',
        success: false, // Support couldn't handle
        error: 'Needs manager approval',
        duration: 5000,
      })

      // Verify chain reached human tier
      const traversal = await escalationGraph.traverseChain(chain.id)
      expect(traversal.steps.length).toBe(4)
      expect(traversal.steps[3]?.properties.tier).toBe('human')
    })

    it.fails('should handoff from capability chain to org chain at human tier', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)

      // Create capability-tier chain
      const capabilityChain = await escalationGraph.createChain({
        errorMessage: 'Needs human decision',
        severity: 'high',
      })

      // Reach human tier
      for (const tier of ['code', 'generative', 'agentic'] as const) {
        await escalationGraph.recordStep(capabilityChain.id, {
          tier,
          success: false,
          error: 'Escalating',
          duration: 1000,
        })
      }

      // At human tier, create organizational escalation chain
      const service = createOrgEscalationService(escalationGraph)
      const orgChain = await service.createEscalationChain(
        capabilityChain.id, // Link to capability chain
        targets.support.id,
        { reason: 'Handoff from agentic tier', priority: 1 }
      )

      // Verify linkage
      expect(orgChain.chainId).toBeDefined()

      // The organizational chain should now handle escalation within human tier
      const level1 = await service.escalateToNextLevel(orgChain.chainId, 'Support escalating')
      expect(level1.newTarget?.role).toBe('Manager')
    })
  })

  // ==========================================================================
  // 9. Metrics and Analytics
  // ==========================================================================

  describe('Metrics and Analytics', () => {
    it.fails('should calculate organizational escalation metrics', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)
      const service = createOrgEscalationService(escalationGraph)

      // Create and complete several escalation chains
      for (let i = 0; i < 5; i++) {
        const chain = await service.createEscalationChain(
          `request-metric-${i}`,
          targets.support.id,
          { reason: `Test ${i}`, priority: 2 }
        )

        // Escalate to different levels
        const escalations = Math.floor(Math.random() * 4)
        for (let j = 0; j < escalations; j++) {
          await service.escalateToNextLevel(chain.chainId, `Escalation ${j}`)
        }
      }

      // Get metrics
      const metrics = await escalationGraph.calculateMetrics()

      expect(metrics.totalChains).toBe(5)
      expect(metrics.averageEscalationDepth).toBeGreaterThan(0)
    })

    it.fails('should detect bottlenecks in organizational hierarchy', async () => {
      const targets = await setupOrgHierarchy(escalationGraph)
      const service = createOrgEscalationService(escalationGraph)

      // Create multiple chains that all get stuck at Director level
      for (let i = 0; i < 10; i++) {
        const chain = await service.createEscalationChain(
          `request-bottleneck-${i}`,
          targets.support.id,
          { reason: 'Test bottleneck', priority: 2 }
        )

        // Escalate to director and stop (simulating bottleneck)
        await service.escalateToNextLevel(chain.chainId, 'To manager')
        await service.escalateToNextLevel(chain.chainId, 'To director')
        // Director never resolves...
      }

      // Detect patterns
      const patterns = await escalationGraph.detectPatterns({ minOccurrences: 5 })

      // Should detect bottleneck at director level
      const bottleneck = patterns.find(
        (p) => p.type === 'tier-bottleneck' && p.affectedTiers.includes('human')
      )
      expect(bottleneck).toBeDefined()
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS (Will need implementation)
// ============================================================================

/**
 * Setup a standard organizational hierarchy for testing
 */
async function setupOrgHierarchy(escalationGraph: EscalationChainGraph) {
  const ceo = await escalationGraph.registerTarget({
    type: 'human',
    name: 'CEO',
    tier: 'human',
    priority: 1,
    sla: 4 * 60 * 60 * 1000,
  })

  const vp = await escalationGraph.registerTarget({
    type: 'human',
    name: 'VP',
    tier: 'human',
    priority: 2,
    sla: 2 * 60 * 60 * 1000,
  })

  const director = await escalationGraph.registerTarget({
    type: 'human',
    name: 'Director',
    tier: 'human',
    priority: 3,
    sla: 60 * 60 * 1000,
  })

  const manager = await escalationGraph.registerTarget({
    type: 'human',
    name: 'Manager',
    tier: 'human',
    priority: 4,
    sla: 30 * 60 * 1000,
  })

  const support = await escalationGraph.registerTarget({
    type: 'human',
    name: 'Support',
    tier: 'human',
    priority: 5,
    sla: 15 * 60 * 1000,
  })

  return { ceo, vp, director, manager, support }
}

/**
 * Setup complex hierarchy with multiple departments
 */
async function setupComplexOrgHierarchy(escalationGraph: EscalationChainGraph) {
  // Engineering path
  const support = await escalationGraph.registerTarget({
    type: 'human',
    name: 'Support',
    tier: 'human',
  })

  const engManager = await escalationGraph.registerTarget({
    type: 'human',
    name: 'Engineering Manager',
    tier: 'human',
  })

  const engDirector = await escalationGraph.registerTarget({
    type: 'human',
    name: 'Engineering Director',
    tier: 'human',
  })

  const cto = await escalationGraph.registerTarget({
    type: 'human',
    name: 'CTO',
    tier: 'human',
  })

  // Legal path
  const legalManager = await escalationGraph.registerTarget({
    type: 'human',
    name: 'Legal Manager',
    tier: 'human',
  })

  const legalDirector = await escalationGraph.registerTarget({
    type: 'human',
    name: 'Legal Director',
    tier: 'human',
  })

  const ceo = await escalationGraph.registerTarget({
    type: 'human',
    name: 'CEO',
    tier: 'human',
  })

  return { support, engManager, engDirector, cto, legalManager, legalDirector, ceo }
}

/**
 * Setup department-specific hierarchy
 */
async function setupDepartmentHierarchy(
  escalationGraph: EscalationChainGraph,
  department: string
) {
  const prefix = department.toLowerCase()

  const support = await escalationGraph.registerTarget({
    type: 'human',
    name: `${department} Support`,
    tier: 'human',
    priority: 5,
  })

  const manager = await escalationGraph.registerTarget({
    type: 'human',
    name: `${department} Manager`,
    tier: 'human',
    priority: 4,
  })

  const director = await escalationGraph.registerTarget({
    type: 'human',
    name: `${department} Director`,
    tier: 'human',
    priority: 3,
  })

  const vp = await escalationGraph.registerTarget({
    type: 'human',
    name: `${department} VP`,
    tier: 'human',
    priority: 2,
  })

  // CEO is shared across departments
  const ceo = await escalationGraph.registerTarget({
    type: 'human',
    name: 'CEO',
    tier: 'human',
    priority: 1,
  })

  return { support, manager, director, vp, ceo }
}

/**
 * Setup a deep hierarchy for performance testing
 */
async function setupDeepHierarchy(
  escalationGraph: EscalationChainGraph,
  depth: number
) {
  const levels: Array<Awaited<ReturnType<typeof escalationGraph.registerTarget>>> = []

  for (let i = depth; i >= 1; i--) {
    const level = await escalationGraph.registerTarget({
      type: 'human',
      name: `Level ${i}`,
      tier: 'human',
      priority: i,
    })
    levels.push(level)
  }

  return {
    top: levels[0]!,
    bottom: levels[levels.length - 1]!,
    levels,
  }
}

/**
 * Create organizational escalation service (stub - will fail in RED phase)
 */
function createOrgEscalationService(
  _escalationGraph: EscalationChainGraph
): OrgEscalationChainService {
  // This is a stub that will throw when any method is called
  // In GREEN phase, we'll implement the actual service
  return {
    registerHumanRole: async () => {
      throw new Error('Not implemented: registerHumanRole')
    },
    setReportingTo: async () => {
      throw new Error('Not implemented: setReportingTo')
    },
    getEscalationPath: async () => {
      throw new Error('Not implemented: getEscalationPath')
    },
    findNextEscalationTarget: async () => {
      throw new Error('Not implemented: findNextEscalationTarget')
    },
    createEscalationChain: async () => {
      throw new Error('Not implemented: createEscalationChain')
    },
    escalateToNextLevel: async () => {
      throw new Error('Not implemented: escalateToNextLevel')
    },
    getDepartmentHierarchy: async () => {
      throw new Error('Not implemented: getDepartmentHierarchy')
    },
    findShortestPath: async () => {
      throw new Error('Not implemented: findShortestPath')
    },
    canEscalateTo: async () => {
      throw new Error('Not implemented: canEscalateTo')
    },
  }
}
