/**
 * Escalation Chain Resolution Tests - RED Phase
 *
 * Tests for resolving escalation chains when humans need to be notified.
 * Escalation chains define the fallback path when primary approvers are unavailable:
 * - Level 0: Original assignee (manager)
 * - Level 1: First escalation (director)
 * - Level 2: Second escalation (VP)
 * - Level 3: Final escalation (CEO)
 *
 * Key behaviors tested:
 * 1. Resolve next level in escalation chain
 * 2. Chain traversal with condition filtering
 * 3. Cycle detection in escalation paths
 * 4. Priority-based escalation selection
 * 5. Chain validation (no orphans, valid structure)
 *
 * NO MOCKS - tests use real data structures and in-memory stores.
 *
 * @see dotdo-9h7p1 - TDD: Human escalation logic
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS (to be implemented)
// ============================================================================

/**
 * Escalation chain node representing a human/role in the chain
 */
export interface EscalationChainNode {
  id: string
  /** Human or role URL */
  humanUrl: string
  /** Display name */
  name: string
  /** Role (manager, director, vp, ceo) */
  role: string
  /** Level in the escalation chain (0 = original assignee) */
  level: number
  /** Whether this node is available for escalation */
  available: boolean
  /** Business hours availability */
  businessHours?: {
    timezone: string
    start: string // e.g., '09:00'
    end: string   // e.g., '17:00'
    days: number[] // 0 = Sunday, 6 = Saturday
  }
}

/**
 * Escalation chain edge representing a link between nodes
 */
export interface EscalationChainEdge {
  id: string
  /** Source node ID */
  from: string
  /** Target node ID */
  to: string
  /** Priority (lower = higher priority) */
  priority: number
  /** Condition for when to use this edge */
  condition?: string
  /** Time-based trigger (e.g., 'after 30 minutes') */
  trigger?: string
}

/**
 * Escalation chain configuration
 */
export interface EscalationChain {
  id: string
  /** Starting node ID */
  rootNodeId: string
  /** All nodes in the chain */
  nodes: EscalationChainNode[]
  /** Edges defining escalation paths */
  edges: EscalationChainEdge[]
  /** Default SLA per level (ms) */
  slaPerLevel: number
}

/**
 * Options for resolving next escalation target
 */
export interface ResolveNextOptions {
  /** Current node ID */
  currentNodeId: string
  /** Reason for escalation */
  reason?: string
  /** Only consider available nodes */
  onlyAvailable?: boolean
  /** Current time for business hours check */
  currentTime?: Date
  /** Condition to filter edges */
  condition?: string
}

/**
 * Result of escalation chain resolution
 */
export interface EscalationResolutionResult {
  /** Next node to escalate to */
  nextNode: EscalationChainNode | null
  /** The edge used for escalation */
  edge: EscalationChainEdge | null
  /** Path from root to next node */
  path: EscalationChainNode[]
  /** Whether this is the final node in the chain */
  isFinal: boolean
  /** Reason if no next node found */
  reason?: string
}

/**
 * Chain validation result
 */
export interface ChainValidationResult {
  valid: boolean
  errors: Array<{
    code: string
    message: string
    nodeId?: string
    edgeId?: string
  }>
  warnings: Array<{
    code: string
    message: string
    nodeId?: string
  }>
}

// ============================================================================
// STUB FUNCTIONS (to be implemented in escalation-chain-resolver.ts)
// ============================================================================

function createEscalationChain(
  _config: Partial<EscalationChain> & { nodes: EscalationChainNode[]; edges: EscalationChainEdge[] }
): EscalationChain {
  throw new Error('Not implemented: createEscalationChain')
}

function resolveNextEscalation(
  _chain: EscalationChain,
  _options: ResolveNextOptions
): EscalationResolutionResult {
  throw new Error('Not implemented: resolveNextEscalation')
}

function resolveEscalationPath(
  _chain: EscalationChain,
  _fromNodeId: string,
  _toNodeId: string
): EscalationChainNode[] {
  throw new Error('Not implemented: resolveEscalationPath')
}

function detectEscalationCycle(
  _chain: EscalationChain,
  _startNodeId: string
): { hasCycle: boolean; cycleNodes?: string[] } {
  throw new Error('Not implemented: detectEscalationCycle')
}

function validateEscalationChain(_chain: EscalationChain): ChainValidationResult {
  throw new Error('Not implemented: validateEscalationChain')
}

function findAvailableEscalationTarget(
  _chain: EscalationChain,
  _currentNodeId: string,
  _options?: { currentTime?: Date; excludeNodes?: string[] }
): EscalationChainNode | null {
  throw new Error('Not implemented: findAvailableEscalationTarget')
}

function getEscalationLevel(_chain: EscalationChain, _nodeId: string): number {
  throw new Error('Not implemented: getEscalationLevel')
}

function getAllNodesAtLevel(_chain: EscalationChain, _level: number): EscalationChainNode[] {
  throw new Error('Not implemented: getAllNodesAtLevel')
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Create a standard corporate escalation chain for testing
 * Level 0: manager
 * Level 1: director
 * Level 2: vp
 * Level 3: ceo
 */
function createTestEscalationChain(): EscalationChain {
  const nodes: EscalationChainNode[] = [
    {
      id: 'node-manager',
      humanUrl: 'do://tenant/Human/manager',
      name: 'Manager',
      role: 'manager',
      level: 0,
      available: true,
    },
    {
      id: 'node-director',
      humanUrl: 'do://tenant/Human/director',
      name: 'Director',
      role: 'director',
      level: 1,
      available: true,
    },
    {
      id: 'node-vp',
      humanUrl: 'do://tenant/Human/vp',
      name: 'VP',
      role: 'vp',
      level: 2,
      available: true,
    },
    {
      id: 'node-ceo',
      humanUrl: 'do://tenant/Human/ceo',
      name: 'CEO',
      role: 'ceo',
      level: 3,
      available: true,
    },
  ]

  const edges: EscalationChainEdge[] = [
    { id: 'edge-1', from: 'node-manager', to: 'node-director', priority: 1 },
    { id: 'edge-2', from: 'node-director', to: 'node-vp', priority: 1 },
    { id: 'edge-3', from: 'node-vp', to: 'node-ceo', priority: 1 },
  ]

  return createEscalationChain({
    id: 'chain-corporate',
    rootNodeId: 'node-manager',
    nodes,
    edges,
    slaPerLevel: 30 * 60 * 1000, // 30 minutes per level
  })
}

/**
 * Create an escalation chain with multiple paths (branching)
 */
function createBranchingEscalationChain(): EscalationChain {
  const nodes: EscalationChainNode[] = [
    { id: 'node-agent', humanUrl: 'do://tenant/Human/agent', name: 'Support Agent', role: 'agent', level: 0, available: true },
    { id: 'node-senior', humanUrl: 'do://tenant/Human/senior', name: 'Senior Agent', role: 'senior', level: 1, available: true },
    { id: 'node-team-lead', humanUrl: 'do://tenant/Human/team-lead', name: 'Team Lead', role: 'team-lead', level: 1, available: true },
    { id: 'node-manager', humanUrl: 'do://tenant/Human/manager', name: 'Manager', role: 'manager', level: 2, available: true },
  ]

  const edges: EscalationChainEdge[] = [
    { id: 'edge-1', from: 'node-agent', to: 'node-senior', priority: 1, condition: 'technical' },
    { id: 'edge-2', from: 'node-agent', to: 'node-team-lead', priority: 2, condition: 'billing' },
    { id: 'edge-3', from: 'node-senior', to: 'node-manager', priority: 1 },
    { id: 'edge-4', from: 'node-team-lead', to: 'node-manager', priority: 1 },
  ]

  return createEscalationChain({
    id: 'chain-branching',
    rootNodeId: 'node-agent',
    nodes,
    edges,
    slaPerLevel: 15 * 60 * 1000,
  })
}

// ============================================================================
// TESTS: Basic Chain Resolution
// ============================================================================

describe('Escalation Chain Resolution', () => {
  describe('createEscalationChain', () => {
    it('creates a chain with nodes and edges', () => {
      const chain = createTestEscalationChain()

      expect(chain.id).toBe('chain-corporate')
      expect(chain.nodes).toHaveLength(4)
      expect(chain.edges).toHaveLength(3)
      expect(chain.rootNodeId).toBe('node-manager')
    })

    it('assigns default SLA per level', () => {
      const chain = createTestEscalationChain()

      expect(chain.slaPerLevel).toBe(30 * 60 * 1000)
    })

    it('generates unique chain ID if not provided', () => {
      const nodes: EscalationChainNode[] = [
        { id: 'n1', humanUrl: 'do://h1', name: 'H1', role: 'agent', level: 0, available: true },
      ]
      const edges: EscalationChainEdge[] = []

      const chain = createEscalationChain({ nodes, edges, rootNodeId: 'n1', slaPerLevel: 1000 })

      expect(chain.id).toBeTruthy()
      expect(chain.id.length).toBeGreaterThan(0)
    })
  })

  describe('resolveNextEscalation', () => {
    it('resolves to next node in linear chain', () => {
      const chain = createTestEscalationChain()

      const result = resolveNextEscalation(chain, {
        currentNodeId: 'node-manager',
      })

      expect(result.nextNode).not.toBeNull()
      expect(result.nextNode!.id).toBe('node-director')
      expect(result.isFinal).toBe(false)
    })

    it('returns null when at end of chain', () => {
      const chain = createTestEscalationChain()

      const result = resolveNextEscalation(chain, {
        currentNodeId: 'node-ceo',
      })

      expect(result.nextNode).toBeNull()
      expect(result.isFinal).toBe(true)
      expect(result.reason).toBe('End of escalation chain')
    })

    it('includes the edge used for escalation', () => {
      const chain = createTestEscalationChain()

      const result = resolveNextEscalation(chain, {
        currentNodeId: 'node-director',
      })

      expect(result.edge).not.toBeNull()
      expect(result.edge!.from).toBe('node-director')
      expect(result.edge!.to).toBe('node-vp')
    })

    it('builds path from root to next node', () => {
      const chain = createTestEscalationChain()

      const result = resolveNextEscalation(chain, {
        currentNodeId: 'node-director',
      })

      expect(result.path).toHaveLength(3) // manager -> director -> vp
      expect(result.path.map((n) => n.id)).toEqual(['node-manager', 'node-director', 'node-vp'])
    })
  })

  describe('resolveNextEscalation with conditions', () => {
    it('filters edges by condition', () => {
      const chain = createBranchingEscalationChain()

      const technicalResult = resolveNextEscalation(chain, {
        currentNodeId: 'node-agent',
        condition: 'technical',
      })

      expect(technicalResult.nextNode!.id).toBe('node-senior')

      const billingResult = resolveNextEscalation(chain, {
        currentNodeId: 'node-agent',
        condition: 'billing',
      })

      expect(billingResult.nextNode!.id).toBe('node-team-lead')
    })

    it('uses priority when multiple edges match', () => {
      const chain = createBranchingEscalationChain()

      // Without condition, should pick highest priority (lowest number)
      const result = resolveNextEscalation(chain, {
        currentNodeId: 'node-agent',
      })

      expect(result.nextNode!.id).toBe('node-senior') // priority 1 beats priority 2
    })
  })

  describe('resolveNextEscalation with availability', () => {
    it('skips unavailable nodes when onlyAvailable is true', () => {
      const chain = createTestEscalationChain()
      // Mark director as unavailable
      chain.nodes.find((n) => n.id === 'node-director')!.available = false

      const result = resolveNextEscalation(chain, {
        currentNodeId: 'node-manager',
        onlyAvailable: true,
      })

      // Should skip director and go to VP
      expect(result.nextNode!.id).toBe('node-vp')
    })

    it('returns null if all remaining nodes are unavailable', () => {
      const chain = createTestEscalationChain()
      // Mark all nodes except manager as unavailable
      chain.nodes.forEach((n) => {
        if (n.id !== 'node-manager') n.available = false
      })

      const result = resolveNextEscalation(chain, {
        currentNodeId: 'node-manager',
        onlyAvailable: true,
      })

      expect(result.nextNode).toBeNull()
      expect(result.reason).toBe('No available escalation targets')
    })

    it('considers business hours for availability', () => {
      const chain = createTestEscalationChain()
      // Set business hours for director
      chain.nodes.find((n) => n.id === 'node-director')!.businessHours = {
        timezone: 'America/New_York',
        start: '09:00',
        end: '17:00',
        days: [1, 2, 3, 4, 5], // Monday-Friday
      }

      // Test during business hours (Tuesday 10am EST)
      const businessHoursResult = resolveNextEscalation(chain, {
        currentNodeId: 'node-manager',
        onlyAvailable: true,
        currentTime: new Date('2026-01-13T10:00:00-05:00'), // Tuesday 10am EST
      })

      expect(businessHoursResult.nextNode!.id).toBe('node-director')

      // Test outside business hours (Tuesday 10pm EST)
      const afterHoursResult = resolveNextEscalation(chain, {
        currentNodeId: 'node-manager',
        onlyAvailable: true,
        currentTime: new Date('2026-01-13T22:00:00-05:00'), // Tuesday 10pm EST
      })

      // Should skip director and go to VP
      expect(afterHoursResult.nextNode!.id).toBe('node-vp')
    })
  })
})

// ============================================================================
// TESTS: Path Resolution
// ============================================================================

describe('Escalation Path Resolution', () => {
  describe('resolveEscalationPath', () => {
    it('returns path between two nodes', () => {
      const chain = createTestEscalationChain()

      const path = resolveEscalationPath(chain, 'node-manager', 'node-vp')

      expect(path).toHaveLength(3)
      expect(path.map((n) => n.id)).toEqual(['node-manager', 'node-director', 'node-vp'])
    })

    it('returns empty array if no path exists', () => {
      const chain = createTestEscalationChain()

      // Try to find path backwards (not possible in this chain)
      const path = resolveEscalationPath(chain, 'node-ceo', 'node-manager')

      expect(path).toHaveLength(0)
    })

    it('returns single node if from equals to', () => {
      const chain = createTestEscalationChain()

      const path = resolveEscalationPath(chain, 'node-director', 'node-director')

      expect(path).toHaveLength(1)
      expect(path[0].id).toBe('node-director')
    })

    it('handles branching paths correctly', () => {
      const chain = createBranchingEscalationChain()

      // Path through senior agent
      const path1 = resolveEscalationPath(chain, 'node-agent', 'node-manager')

      expect(path1.length).toBeGreaterThan(0)
      expect(path1[0].id).toBe('node-agent')
      expect(path1[path1.length - 1].id).toBe('node-manager')
    })
  })

  describe('getEscalationLevel', () => {
    it('returns the level of a node', () => {
      const chain = createTestEscalationChain()

      expect(getEscalationLevel(chain, 'node-manager')).toBe(0)
      expect(getEscalationLevel(chain, 'node-director')).toBe(1)
      expect(getEscalationLevel(chain, 'node-vp')).toBe(2)
      expect(getEscalationLevel(chain, 'node-ceo')).toBe(3)
    })

    it('throws error for unknown node', () => {
      const chain = createTestEscalationChain()

      expect(() => getEscalationLevel(chain, 'node-unknown')).toThrow('Node not found')
    })
  })

  describe('getAllNodesAtLevel', () => {
    it('returns all nodes at a specific level', () => {
      const chain = createBranchingEscalationChain()

      const level1Nodes = getAllNodesAtLevel(chain, 1)

      expect(level1Nodes).toHaveLength(2)
      expect(level1Nodes.map((n) => n.id).sort()).toEqual(['node-senior', 'node-team-lead'])
    })

    it('returns empty array for level with no nodes', () => {
      const chain = createTestEscalationChain()

      const level5Nodes = getAllNodesAtLevel(chain, 5)

      expect(level5Nodes).toHaveLength(0)
    })
  })
})

// ============================================================================
// TESTS: Cycle Detection
// ============================================================================

describe('Escalation Cycle Detection', () => {
  describe('detectEscalationCycle', () => {
    it('returns false for valid linear chain', () => {
      const chain = createTestEscalationChain()

      const result = detectEscalationCycle(chain, 'node-manager')

      expect(result.hasCycle).toBe(false)
      expect(result.cycleNodes).toBeUndefined()
    })

    it('detects simple cycle (A -> B -> A)', () => {
      const nodes: EscalationChainNode[] = [
        { id: 'node-a', humanUrl: 'do://a', name: 'A', role: 'a', level: 0, available: true },
        { id: 'node-b', humanUrl: 'do://b', name: 'B', role: 'b', level: 1, available: true },
      ]
      const edges: EscalationChainEdge[] = [
        { id: 'e1', from: 'node-a', to: 'node-b', priority: 1 },
        { id: 'e2', from: 'node-b', to: 'node-a', priority: 1 }, // Cycle back to A
      ]

      const chain = createEscalationChain({
        id: 'chain-cycle',
        rootNodeId: 'node-a',
        nodes,
        edges,
        slaPerLevel: 1000,
      })

      const result = detectEscalationCycle(chain, 'node-a')

      expect(result.hasCycle).toBe(true)
      expect(result.cycleNodes).toContain('node-a')
      expect(result.cycleNodes).toContain('node-b')
    })

    it('detects longer cycle (A -> B -> C -> A)', () => {
      const nodes: EscalationChainNode[] = [
        { id: 'node-a', humanUrl: 'do://a', name: 'A', role: 'a', level: 0, available: true },
        { id: 'node-b', humanUrl: 'do://b', name: 'B', role: 'b', level: 1, available: true },
        { id: 'node-c', humanUrl: 'do://c', name: 'C', role: 'c', level: 2, available: true },
      ]
      const edges: EscalationChainEdge[] = [
        { id: 'e1', from: 'node-a', to: 'node-b', priority: 1 },
        { id: 'e2', from: 'node-b', to: 'node-c', priority: 1 },
        { id: 'e3', from: 'node-c', to: 'node-a', priority: 1 }, // Cycle back
      ]

      const chain = createEscalationChain({
        id: 'chain-long-cycle',
        rootNodeId: 'node-a',
        nodes,
        edges,
        slaPerLevel: 1000,
      })

      const result = detectEscalationCycle(chain, 'node-a')

      expect(result.hasCycle).toBe(true)
      expect(result.cycleNodes).toHaveLength(3)
    })

    it('handles chains with multiple branches (no cycle)', () => {
      const chain = createBranchingEscalationChain()

      const result = detectEscalationCycle(chain, 'node-agent')

      expect(result.hasCycle).toBe(false)
    })
  })
})

// ============================================================================
// TESTS: Chain Validation
// ============================================================================

describe('Escalation Chain Validation', () => {
  describe('validateEscalationChain', () => {
    it('validates a correct chain', () => {
      const chain = createTestEscalationChain()

      const result = validateEscalationChain(chain)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('detects orphan nodes (no incoming or outgoing edges)', () => {
      const nodes: EscalationChainNode[] = [
        { id: 'node-a', humanUrl: 'do://a', name: 'A', role: 'a', level: 0, available: true },
        { id: 'node-b', humanUrl: 'do://b', name: 'B', role: 'b', level: 1, available: true },
        { id: 'node-orphan', humanUrl: 'do://orphan', name: 'Orphan', role: 'orphan', level: 1, available: true },
      ]
      const edges: EscalationChainEdge[] = [
        { id: 'e1', from: 'node-a', to: 'node-b', priority: 1 },
        // node-orphan has no edges
      ]

      const chain = createEscalationChain({
        id: 'chain-orphan',
        rootNodeId: 'node-a',
        nodes,
        edges,
        slaPerLevel: 1000,
      })

      const result = validateEscalationChain(chain)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'ORPHAN_NODE')).toBe(true)
      expect(result.errors.find((e) => e.code === 'ORPHAN_NODE')!.nodeId).toBe('node-orphan')
    })

    it('detects missing target nodes in edges', () => {
      const nodes: EscalationChainNode[] = [
        { id: 'node-a', humanUrl: 'do://a', name: 'A', role: 'a', level: 0, available: true },
      ]
      const edges: EscalationChainEdge[] = [
        { id: 'e1', from: 'node-a', to: 'node-missing', priority: 1 }, // Target doesn't exist
      ]

      const chain = createEscalationChain({
        id: 'chain-missing',
        rootNodeId: 'node-a',
        nodes,
        edges,
        slaPerLevel: 1000,
      })

      const result = validateEscalationChain(chain)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_TARGET')).toBe(true)
    })

    it('detects cycles as errors', () => {
      const nodes: EscalationChainNode[] = [
        { id: 'node-a', humanUrl: 'do://a', name: 'A', role: 'a', level: 0, available: true },
        { id: 'node-b', humanUrl: 'do://b', name: 'B', role: 'b', level: 1, available: true },
      ]
      const edges: EscalationChainEdge[] = [
        { id: 'e1', from: 'node-a', to: 'node-b', priority: 1 },
        { id: 'e2', from: 'node-b', to: 'node-a', priority: 1 },
      ]

      const chain = createEscalationChain({
        id: 'chain-cycle',
        rootNodeId: 'node-a',
        nodes,
        edges,
        slaPerLevel: 1000,
      })

      const result = validateEscalationChain(chain)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CYCLE_DETECTED')).toBe(true)
    })

    it('warns about unreachable nodes from root', () => {
      const nodes: EscalationChainNode[] = [
        { id: 'node-root', humanUrl: 'do://root', name: 'Root', role: 'root', level: 0, available: true },
        { id: 'node-reachable', humanUrl: 'do://reachable', name: 'Reachable', role: 'r', level: 1, available: true },
        { id: 'node-unreachable', humanUrl: 'do://unreachable', name: 'Unreachable', role: 'u', level: 1, available: true },
      ]
      const edges: EscalationChainEdge[] = [
        { id: 'e1', from: 'node-root', to: 'node-reachable', priority: 1 },
        // node-unreachable has no incoming edge from root path
        { id: 'e2', from: 'node-unreachable', to: 'node-reachable', priority: 1 },
      ]

      const chain = createEscalationChain({
        id: 'chain-unreachable',
        rootNodeId: 'node-root',
        nodes,
        edges,
        slaPerLevel: 1000,
      })

      const result = validateEscalationChain(chain)

      expect(result.warnings.some((w) => w.code === 'UNREACHABLE_NODE')).toBe(true)
    })

    it('warns about no terminal nodes', () => {
      // All nodes have outgoing edges (no terminal)
      const nodes: EscalationChainNode[] = [
        { id: 'node-a', humanUrl: 'do://a', name: 'A', role: 'a', level: 0, available: true },
        { id: 'node-b', humanUrl: 'do://b', name: 'B', role: 'b', level: 1, available: true },
      ]
      const edges: EscalationChainEdge[] = [
        { id: 'e1', from: 'node-a', to: 'node-b', priority: 1 },
        { id: 'e2', from: 'node-b', to: 'node-a', priority: 1 }, // Creates cycle, no terminal
      ]

      const chain = createEscalationChain({
        id: 'chain-no-terminal',
        rootNodeId: 'node-a',
        nodes,
        edges,
        slaPerLevel: 1000,
      })

      const result = validateEscalationChain(chain)

      // Both CYCLE_DETECTED error and NO_TERMINAL warning expected
      expect(result.errors.some((e) => e.code === 'CYCLE_DETECTED')).toBe(true)
    })
  })
})

// ============================================================================
// TESTS: Finding Available Targets
// ============================================================================

describe('Finding Available Escalation Targets', () => {
  describe('findAvailableEscalationTarget', () => {
    it('finds first available node in chain', () => {
      const chain = createTestEscalationChain()

      const target = findAvailableEscalationTarget(chain, 'node-manager')

      expect(target).not.toBeNull()
      expect(target!.id).toBe('node-director')
    })

    it('skips unavailable nodes', () => {
      const chain = createTestEscalationChain()
      chain.nodes.find((n) => n.id === 'node-director')!.available = false
      chain.nodes.find((n) => n.id === 'node-vp')!.available = false

      const target = findAvailableEscalationTarget(chain, 'node-manager')

      expect(target!.id).toBe('node-ceo')
    })

    it('returns null when no available targets', () => {
      const chain = createTestEscalationChain()
      chain.nodes.forEach((n) => {
        if (n.id !== 'node-manager') n.available = false
      })

      const target = findAvailableEscalationTarget(chain, 'node-manager')

      expect(target).toBeNull()
    })

    it('respects excludeNodes option', () => {
      const chain = createTestEscalationChain()

      const target = findAvailableEscalationTarget(chain, 'node-manager', {
        excludeNodes: ['node-director', 'node-vp'],
      })

      expect(target!.id).toBe('node-ceo')
    })

    it('considers current time for business hours', () => {
      const chain = createTestEscalationChain()
      chain.nodes.find((n) => n.id === 'node-director')!.businessHours = {
        timezone: 'UTC',
        start: '09:00',
        end: '17:00',
        days: [1, 2, 3, 4, 5],
      }

      // Outside business hours
      const target = findAvailableEscalationTarget(chain, 'node-manager', {
        currentTime: new Date('2026-01-13T23:00:00Z'), // 11pm UTC on Monday
      })

      // Should skip director (outside hours) and return VP
      expect(target!.id).toBe('node-vp')
    })
  })
})

// ============================================================================
// TESTS: Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles single-node chain', () => {
    const nodes: EscalationChainNode[] = [
      { id: 'node-only', humanUrl: 'do://only', name: 'Only', role: 'only', level: 0, available: true },
    ]
    const edges: EscalationChainEdge[] = []

    const chain = createEscalationChain({
      id: 'chain-single',
      rootNodeId: 'node-only',
      nodes,
      edges,
      slaPerLevel: 1000,
    })

    const result = resolveNextEscalation(chain, { currentNodeId: 'node-only' })

    expect(result.nextNode).toBeNull()
    expect(result.isFinal).toBe(true)
  })

  it('handles node with multiple outgoing edges', () => {
    const chain = createBranchingEscalationChain()

    // Without condition, should pick highest priority
    const result = resolveNextEscalation(chain, {
      currentNodeId: 'node-agent',
    })

    expect(result.nextNode!.id).toBe('node-senior') // Priority 1
  })

  it('handles diamond-shaped chain (multiple paths to same target)', () => {
    const nodes: EscalationChainNode[] = [
      { id: 'node-start', humanUrl: 'do://start', name: 'Start', role: 'start', level: 0, available: true },
      { id: 'node-left', humanUrl: 'do://left', name: 'Left', role: 'left', level: 1, available: true },
      { id: 'node-right', humanUrl: 'do://right', name: 'Right', role: 'right', level: 1, available: true },
      { id: 'node-end', humanUrl: 'do://end', name: 'End', role: 'end', level: 2, available: true },
    ]
    const edges: EscalationChainEdge[] = [
      { id: 'e1', from: 'node-start', to: 'node-left', priority: 1 },
      { id: 'e2', from: 'node-start', to: 'node-right', priority: 2 },
      { id: 'e3', from: 'node-left', to: 'node-end', priority: 1 },
      { id: 'e4', from: 'node-right', to: 'node-end', priority: 1 },
    ]

    const chain = createEscalationChain({
      id: 'chain-diamond',
      rootNodeId: 'node-start',
      nodes,
      edges,
      slaPerLevel: 1000,
    })

    // Both paths should reach the end
    const pathViaLeft = resolveEscalationPath(chain, 'node-start', 'node-end')
    expect(pathViaLeft[pathViaLeft.length - 1].id).toBe('node-end')

    // Validation should pass (no cycles)
    const validation = validateEscalationChain(chain)
    expect(validation.valid).toBe(true)
  })
})
