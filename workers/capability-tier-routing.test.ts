/**
 * Capability Tier Routing Tests
 *
 * TDD tests for capability tier routing that cascades from
 * code -> generative -> agentic -> human.
 *
 * These tests verify:
 * 1. Tier selection by task complexity
 * 2. Tier escalation paths
 * 3. Tool availability per tier
 * 4. Integration with graph model
 *
 * @module workers/capability-tier-routing
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { GraphEngine, type Node, type Edge } from '../db/graph'
import {
  CapabilityTierRouter,
  CAPABILITY_TIERS,
  TIER_ORDER,
  TIER_TOOLS,
  type CapabilityTier,
  type TaskRequest,
  type TierRouteResult,
  type WorkerNode,
  assessComplexity,
  matchTierToComplexity,
  getNextTier,
  compareTiers,
  TierRegistry,
} from './capability-tier-routing'

// =============================================================================
// TEST SETUP
// =============================================================================

describe('CapabilityTierRouter', () => {
  let graph: GraphEngine
  let router: CapabilityTierRouter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    graph = new GraphEngine()
    router = new CapabilityTierRouter(graph)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ===========================================================================
  // 1. TIER SELECTION BY COMPLEXITY
  // ===========================================================================

  describe('Tier Selection', () => {
    it('should select code tier for complexity 1-2', async () => {
      const task: TaskRequest = {
        id: 'task-1',
        type: 'lookup',
        complexity: 1,
      }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('code')
    })

    it('should select code tier for complexity 2', async () => {
      const task: TaskRequest = {
        id: 'task-2',
        type: 'transform',
        complexity: 2,
      }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('code')
    })

    it('should select generative tier for complexity 3-5', async () => {
      const task: TaskRequest = {
        id: 'task-3',
        type: 'generate',
        complexity: 3,
      }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('generative')
    })

    it('should select generative tier for complexity 5', async () => {
      const task: TaskRequest = {
        id: 'task-4',
        type: 'summarize',
        complexity: 5,
      }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('generative')
    })

    it('should select agentic tier for complexity 6-8', async () => {
      const task: TaskRequest = {
        id: 'task-5',
        type: 'plan',
        complexity: 6,
      }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('agentic')
    })

    it('should select agentic tier for complexity 8', async () => {
      const task: TaskRequest = {
        id: 'task-6',
        type: 'execute',
        complexity: 8,
      }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('agentic')
    })

    it('should select human tier for complexity 9-10', async () => {
      const task: TaskRequest = {
        id: 'task-7',
        type: 'decide',
        complexity: 9,
      }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('human')
    })

    it('should select human tier for complexity 10', async () => {
      const task: TaskRequest = {
        id: 'task-8',
        type: 'approve',
        complexity: 10,
      }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('human')
    })

    it('should handle boundary case at complexity 2/3', async () => {
      const task2: TaskRequest = { id: 't1', type: 'calc', complexity: 2 }
      const task3: TaskRequest = { id: 't2', type: 'gen', complexity: 3 }

      const result2 = await router.selectTier(task2)
      const result3 = await router.selectTier(task3)

      expect(result2.tier).toBe('code')
      expect(result3.tier).toBe('generative')
    })

    it('should handle boundary case at complexity 5/6', async () => {
      const task5: TaskRequest = { id: 't3', type: 'sum', complexity: 5 }
      const task6: TaskRequest = { id: 't4', type: 'plan', complexity: 6 }

      const result5 = await router.selectTier(task5)
      const result6 = await router.selectTier(task6)

      expect(result5.tier).toBe('generative')
      expect(result6.tier).toBe('agentic')
    })

    it('should handle boundary case at complexity 8/9', async () => {
      const task8: TaskRequest = { id: 't5', type: 'exec', complexity: 8 }
      const task9: TaskRequest = { id: 't6', type: 'decide', complexity: 9 }

      const result8 = await router.selectTier(task8)
      const result9 = await router.selectTier(task9)

      expect(result8.tier).toBe('agentic')
      expect(result9.tier).toBe('human')
    })

    it('should clamp complexity below 1 to code tier', async () => {
      const task: TaskRequest = { id: 't7', type: 'trivial', complexity: 0 }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('code')
    })

    it('should clamp complexity above 10 to human tier', async () => {
      const task: TaskRequest = { id: 't8', type: 'impossible', complexity: 15 }

      const result = await router.selectTier(task)

      expect(result.tier).toBe('human')
    })
  })

  // ===========================================================================
  // 2. TIER ESCALATION
  // ===========================================================================

  describe('Tier Escalation', () => {
    beforeEach(async () => {
      // Register workers for each tier
      await router.registerWorker({
        id: 'worker-code',
        tier: 'code',
        endpoint: 'http://code:3000',
      })
      await router.registerWorker({
        id: 'worker-generative',
        tier: 'generative',
        endpoint: 'http://generative:3000',
      })
      await router.registerWorker({
        id: 'worker-agentic',
        tier: 'agentic',
        endpoint: 'http://agentic:3000',
      })
      await router.registerWorker({
        id: 'worker-human',
        tier: 'human',
        endpoint: 'http://human:3000',
      })
    })

    it('should escalate from code to generative on failure', async () => {
      const task: TaskRequest = {
        id: 'task-esc-1',
        type: 'compute',
        complexity: 2,
      }

      // First route to code tier
      const result1 = await router.route(task)
      expect(result1.tier).toBe('code')

      // Simulate failure and escalate
      const escalated = await router.escalate(task, 'code', 'Task too complex for code tier')

      expect(escalated.tier).toBe('generative')
      expect(escalated.escalatedFrom).toBe('code')
      expect(escalated.reason).toBe('Task too complex for code tier')
    })

    it('should escalate from generative to agentic on failure', async () => {
      const task: TaskRequest = {
        id: 'task-esc-2',
        type: 'analyze',
        complexity: 4,
      }

      const escalated = await router.escalate(task, 'generative', 'Requires multi-step reasoning')

      expect(escalated.tier).toBe('agentic')
      expect(escalated.escalatedFrom).toBe('generative')
    })

    it('should escalate from agentic to human on failure', async () => {
      const task: TaskRequest = {
        id: 'task-esc-3',
        type: 'decide',
        complexity: 7,
      }

      const escalated = await router.escalate(task, 'agentic', 'Requires human judgment')

      expect(escalated.tier).toBe('human')
      expect(escalated.escalatedFrom).toBe('agentic')
    })

    it('should require justification for skip-tier escalation', async () => {
      const task: TaskRequest = {
        id: 'task-esc-4',
        type: 'critical',
        complexity: 2,
      }

      // Trying to skip from code directly to agentic
      await expect(
        router.escalate(task, 'code', '', { skipTo: 'agentic' })
      ).rejects.toThrow('Skip-tier escalation requires justification')
    })

    it('should allow skip-tier escalation with justification', async () => {
      const task: TaskRequest = {
        id: 'task-esc-5',
        type: 'urgent',
        complexity: 2,
      }

      const escalated = await router.escalate(task, 'code', 'Security incident requires immediate human review', {
        skipTo: 'human',
      })

      expect(escalated.tier).toBe('human')
      expect(escalated.escalatedFrom).toBe('code')
      expect(escalated.skippedTiers).toEqual(['generative', 'agentic'])
    })

    it('should detect circular escalation', async () => {
      const task: TaskRequest = {
        id: 'task-esc-6',
        type: 'loop',
        complexity: 5,
      }

      // Escalate through all tiers
      await router.escalate(task, 'code', 'First failure')
      await router.escalate(task, 'generative', 'Second failure')
      await router.escalate(task, 'agentic', 'Third failure')

      // Track history shows we've been through all tiers
      const history = await router.getEscalationHistory(task.id)
      expect(history).toHaveLength(3)

      // Now at human tier, attempting to use allowDowngrade should detect circularity
      // since we've already visited all tiers in the escalation chain
      await expect(
        router.escalate(task, 'human', 'Cannot complete', { allowDowngrade: true })
      ).rejects.toThrow(/Circular escalation detected|Cannot escalate beyond human tier/)
    })

    it('should not escalate beyond human tier', async () => {
      const task: TaskRequest = {
        id: 'task-esc-7',
        type: 'impossible',
        complexity: 10,
      }

      await expect(
        router.escalate(task, 'human', 'Human also failed')
      ).rejects.toThrow('Cannot escalate beyond human tier')
    })

    it('should track escalation history in graph', async () => {
      const task: TaskRequest = {
        id: 'task-esc-8',
        type: 'tracked',
        complexity: 3,
      }

      await router.escalate(task, 'code', 'First escalation')
      await router.escalate(task, 'generative', 'Second escalation')

      const history = await router.getEscalationHistory(task.id)

      expect(history).toHaveLength(2)
      expect(history[0]!.from).toBe('code')
      expect(history[0]!.to).toBe('generative')
      expect(history[1]!.from).toBe('generative')
      expect(history[1]!.to).toBe('agentic')
    })
  })

  // ===========================================================================
  // 3. TOOL AVAILABILITY BY TIER
  // ===========================================================================

  describe('Tool Availability by Tier', () => {
    it('should provide calculate, lookup, validate, transform for code tier', () => {
      const tools = router.getToolsForTier('code')

      expect(tools).toContain('calculate')
      expect(tools).toContain('lookup')
      expect(tools).toContain('validate')
      expect(tools).toContain('transform')
    })

    it('should add generate, summarize, analyze, classify for generative tier', () => {
      const tools = router.getToolsForTier('generative')

      // Should have code tier tools
      expect(tools).toContain('calculate')
      expect(tools).toContain('lookup')
      expect(tools).toContain('validate')
      expect(tools).toContain('transform')

      // Plus generative tier tools
      expect(tools).toContain('generate')
      expect(tools).toContain('summarize')
      expect(tools).toContain('analyze')
      expect(tools).toContain('classify')
    })

    it('should add browse, execute, plan, delegate for agentic tier', () => {
      const tools = router.getToolsForTier('agentic')

      // Should have generative tier tools (which includes code tier)
      expect(tools).toContain('generate')
      expect(tools).toContain('summarize')

      // Plus agentic tier tools
      expect(tools).toContain('browse')
      expect(tools).toContain('execute')
      expect(tools).toContain('plan')
      expect(tools).toContain('delegate')
    })

    it('should add approve, review, decide, escalate for human tier', () => {
      const tools = router.getToolsForTier('human')

      // Should have agentic tier tools (which includes all previous tiers)
      expect(tools).toContain('execute')
      expect(tools).toContain('plan')

      // Plus human tier tools
      expect(tools).toContain('approve')
      expect(tools).toContain('review')
      expect(tools).toContain('decide')
      expect(tools).toContain('escalate')
    })

    it('should enforce tool restrictions per tier', async () => {
      const task: TaskRequest = {
        id: 'task-tool-1',
        type: 'restricted',
        complexity: 2,
        requiredTools: ['approve'], // Human-only tool
      }

      // Code tier should not be able to handle this task
      const result = await router.canTierHandleTask('code', task)

      expect(result.canHandle).toBe(false)
      expect(result.missingTools).toContain('approve')
    })

    it('should allow tier to handle task if all tools available', async () => {
      const task: TaskRequest = {
        id: 'task-tool-2',
        type: 'compute',
        complexity: 2,
        requiredTools: ['calculate', 'transform'],
      }

      const result = await router.canTierHandleTask('code', task)

      expect(result.canHandle).toBe(true)
      expect(result.missingTools).toHaveLength(0)
    })

    it('should auto-escalate to tier with required tools', async () => {
      await router.registerWorker({
        id: 'worker-code',
        tier: 'code',
        endpoint: 'http://code:3000',
      })
      await router.registerWorker({
        id: 'worker-human',
        tier: 'human',
        endpoint: 'http://human:3000',
      })

      const task: TaskRequest = {
        id: 'task-tool-3',
        type: 'approval',
        complexity: 2, // Low complexity but needs human tool
        requiredTools: ['approve'],
      }

      const result = await router.route(task)

      // Should auto-escalate to human despite low complexity
      expect(result.tier).toBe('human')
      expect(result.reason).toContain('Required tools only available at human tier')
    })
  })

  // ===========================================================================
  // 4. INTEGRATION WITH GRAPH MODEL
  // ===========================================================================

  describe('Graph Model Integration', () => {
    beforeEach(async () => {
      await router.registerWorker({
        id: 'worker-code-1',
        tier: 'code',
        endpoint: 'http://code1:3000',
      })
      await router.registerWorker({
        id: 'worker-code-2',
        tier: 'code',
        endpoint: 'http://code2:3000',
      })
      await router.registerWorker({
        id: 'worker-gen-1',
        tier: 'generative',
        endpoint: 'http://gen1:3000',
      })
      await router.registerWorker({
        id: 'worker-human-1',
        tier: 'human',
        endpoint: 'http://human1:3000',
      })
    })

    it('should store workers as graph nodes with tier property', async () => {
      const node = await graph.getNode('worker-code-1')

      expect(node).not.toBeNull()
      expect(node?.label).toBe('Worker')
      expect(node?.properties.tier).toBe('code')
    })

    it('should query workers by tier from graph', async () => {
      const codeWorkers = await router.getWorkersByTier('code')

      expect(codeWorkers).toHaveLength(2)
      expect(codeWorkers.every(w => w.tier === 'code')).toBe(true)
    })

    it('should store tier routing decisions as graph edges', async () => {
      const task: TaskRequest = {
        id: 'task-graph-1',
        type: 'compute',
        complexity: 2,
      }

      const result = await router.route(task)

      // Check that a ROUTED_TO_TIER edge was created
      const edges = await graph.queryEdges({
        type: 'ROUTED_TO_TIER',
      })

      expect(edges.length).toBeGreaterThanOrEqual(1)
      const routingEdge = edges.find(e => e.properties.taskId === 'task-graph-1')
      expect(routingEdge).toBeDefined()
      expect(routingEdge?.properties.tier).toBe('code')
    })

    it('should store escalation decisions as graph edges', async () => {
      const task: TaskRequest = {
        id: 'task-graph-2',
        type: 'complex',
        complexity: 3,
      }

      await router.escalate(task, 'code', 'Too complex')

      const edges = await graph.queryEdges({
        type: 'ESCALATED_TO',
      })

      expect(edges.length).toBeGreaterThanOrEqual(1)
      const escalationEdge = edges.find(e => e.properties.taskId === 'task-graph-2')
      expect(escalationEdge).toBeDefined()
      expect(escalationEdge?.properties.fromTier).toBe('code')
      expect(escalationEdge?.properties.toTier).toBe('generative')
    })

    it('should create HAS_CAPABILITY edges for tier tools', async () => {
      // Query capability edges for a code worker
      const edges = await graph.queryEdges({
        type: 'HAS_CAPABILITY',
        from: 'worker-code-1',
      })

      // Code worker should have capability edges for code tier tools
      expect(edges.length).toBeGreaterThanOrEqual(1)
    })

    it('should track task-worker assignments via graph', async () => {
      const task: TaskRequest = {
        id: 'task-graph-3',
        type: 'compute',
        complexity: 2,
      }

      const result = await router.route(task)

      // Should create a ASSIGNED_TO edge
      const edges = await graph.queryEdges({
        type: 'ASSIGNED_TO',
        to: result.workerId!,
      })

      expect(edges.length).toBeGreaterThanOrEqual(1)
    })

    it('should support querying tier routing history via graph patterns', async () => {
      // Route multiple tasks
      await router.route({ id: 'task-h1', type: 'a', complexity: 1 })
      await router.route({ id: 'task-h2', type: 'b', complexity: 4 })
      await router.route({ id: 'task-h3', type: 'c', complexity: 9 })

      const history = await router.getRoutingHistory()

      expect(history).toHaveLength(3)
      expect(history.map(h => h.tier)).toEqual(
        expect.arrayContaining(['code', 'generative', 'human'])
      )
    })
  })

  // ===========================================================================
  // 5. WORKER REGISTRATION AND MANAGEMENT
  // ===========================================================================

  describe('Worker Registration', () => {
    it('should register worker with tier', async () => {
      const worker = await router.registerWorker({
        id: 'new-worker',
        tier: 'agentic',
        endpoint: 'http://new:3000',
      })

      expect(worker.id).toBe('new-worker')
      expect(worker.tier).toBe('agentic')
      expect(worker.status).toBe('available')
    })

    it('should set default tools based on tier', async () => {
      const worker = await router.registerWorker({
        id: 'tools-worker',
        tier: 'generative',
        endpoint: 'http://tools:3000',
      })

      expect(worker.tools).toEqual(expect.arrayContaining([
        'calculate', 'lookup', 'validate', 'transform',
        'generate', 'summarize', 'analyze', 'classify',
      ]))
    })

    it('should allow custom tools beyond tier defaults', async () => {
      const worker = await router.registerWorker({
        id: 'custom-worker',
        tier: 'code',
        endpoint: 'http://custom:3000',
        additionalTools: ['special-tool'],
      })

      expect(worker.tools).toContain('special-tool')
      expect(worker.tools).toContain('calculate') // Still has tier defaults
    })

    it('should deregister worker and clean up graph', async () => {
      await router.registerWorker({
        id: 'temp-worker',
        tier: 'code',
        endpoint: 'http://temp:3000',
      })

      await router.deregisterWorker('temp-worker')

      const node = await graph.getNode('temp-worker')
      expect(node).toBeNull()
    })
  })
})

// =============================================================================
// STANDALONE FUNCTION TESTS
// =============================================================================

describe('Capability Tier Functions', () => {
  describe('TIER_ORDER', () => {
    it('should define correct tier order', () => {
      expect(TIER_ORDER).toEqual(['code', 'generative', 'agentic', 'human'])
    })
  })

  describe('compareTiers', () => {
    it('should return negative when first tier is lower', () => {
      expect(compareTiers('code', 'generative')).toBeLessThan(0)
      expect(compareTiers('code', 'human')).toBeLessThan(0)
      expect(compareTiers('generative', 'agentic')).toBeLessThan(0)
    })

    it('should return positive when first tier is higher', () => {
      expect(compareTiers('human', 'code')).toBeGreaterThan(0)
      expect(compareTiers('agentic', 'generative')).toBeGreaterThan(0)
    })

    it('should return zero for equal tiers', () => {
      expect(compareTiers('code', 'code')).toBe(0)
      expect(compareTiers('human', 'human')).toBe(0)
    })
  })

  describe('getNextTier', () => {
    it('should return next tier in escalation path', () => {
      expect(getNextTier('code')).toBe('generative')
      expect(getNextTier('generative')).toBe('agentic')
      expect(getNextTier('agentic')).toBe('human')
    })

    it('should return null for human tier (no escalation possible)', () => {
      expect(getNextTier('human')).toBeNull()
    })
  })

  describe('matchTierToComplexity', () => {
    it('should map complexity 1-2 to code', () => {
      expect(matchTierToComplexity(1)).toBe('code')
      expect(matchTierToComplexity(2)).toBe('code')
    })

    it('should map complexity 3-5 to generative', () => {
      expect(matchTierToComplexity(3)).toBe('generative')
      expect(matchTierToComplexity(4)).toBe('generative')
      expect(matchTierToComplexity(5)).toBe('generative')
    })

    it('should map complexity 6-8 to agentic', () => {
      expect(matchTierToComplexity(6)).toBe('agentic')
      expect(matchTierToComplexity(7)).toBe('agentic')
      expect(matchTierToComplexity(8)).toBe('agentic')
    })

    it('should map complexity 9-10 to human', () => {
      expect(matchTierToComplexity(9)).toBe('human')
      expect(matchTierToComplexity(10)).toBe('human')
    })
  })

  describe('assessComplexity', () => {
    it('should assess complexity from task properties', () => {
      const simpleTask = { id: 't1', type: 'lookup', input: 'query' }
      const complexTask = { id: 't2', type: 'approve', input: { data: 'large', nested: { deep: true } } }

      const simple = assessComplexity(simpleTask)
      const complex = assessComplexity(complexTask)

      expect(simple).toBeLessThan(complex)
    })

    it('should factor in task type', () => {
      const approvalTask = { id: 't3', type: 'approve' }
      const lookupTask = { id: 't4', type: 'lookup' }

      expect(assessComplexity(approvalTask)).toBeGreaterThan(assessComplexity(lookupTask))
    })
  })

  describe('TierRegistry', () => {
    it('should allow custom tier profiles', () => {
      const registry = new TierRegistry()

      registry.registerProfile('custom', {
        complexityRange: [4, 6],
        tools: ['custom-tool-1', 'custom-tool-2'],
        escalatesTo: 'agentic',
      })

      const profile = registry.getProfile('custom')

      expect(profile).toBeDefined()
      expect(profile?.tools).toContain('custom-tool-1')
    })

    it('should validate tier profiles', () => {
      const registry = new TierRegistry()

      expect(() => {
        registry.registerProfile('invalid', {
          complexityRange: [10, 5], // Invalid: min > max
          tools: [],
          escalatesTo: 'human',
        })
      }).toThrow('Invalid complexity range')
    })
  })
})

// =============================================================================
// TIER TOOLS CONSTANT TESTS
// =============================================================================

describe('TIER_TOOLS', () => {
  it('should define code tier tools', () => {
    expect(TIER_TOOLS.code).toEqual(['calculate', 'lookup', 'validate', 'transform'])
  })

  it('should define generative tier tools', () => {
    expect(TIER_TOOLS.generative).toEqual(['generate', 'summarize', 'analyze', 'classify'])
  })

  it('should define agentic tier tools', () => {
    expect(TIER_TOOLS.agentic).toEqual(['browse', 'execute', 'plan', 'delegate'])
  })

  it('should define human tier tools', () => {
    expect(TIER_TOOLS.human).toEqual(['approve', 'review', 'decide', 'escalate'])
  })
})

// =============================================================================
// CAPABILITY TIERS CONSTANT TESTS
// =============================================================================

describe('CAPABILITY_TIERS', () => {
  it('should define code tier with complexity 1-2', () => {
    expect(CAPABILITY_TIERS.code.minComplexity).toBe(1)
    expect(CAPABILITY_TIERS.code.maxComplexity).toBe(2)
  })

  it('should define generative tier with complexity 3-5', () => {
    expect(CAPABILITY_TIERS.generative.minComplexity).toBe(3)
    expect(CAPABILITY_TIERS.generative.maxComplexity).toBe(5)
  })

  it('should define agentic tier with complexity 6-8', () => {
    expect(CAPABILITY_TIERS.agentic.minComplexity).toBe(6)
    expect(CAPABILITY_TIERS.agentic.maxComplexity).toBe(8)
  })

  it('should define human tier with complexity 9-10', () => {
    expect(CAPABILITY_TIERS.human.minComplexity).toBe(9)
    expect(CAPABILITY_TIERS.human.maxComplexity).toBe(10)
  })
})
