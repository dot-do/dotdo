/**
 * Unified Worker Interface Tests - TDD RED/GREEN Phase
 *
 * Tests for the unified Worker interface that bridges AI agents and human workers.
 * The unified interface allows workflows to work with any worker type transparently.
 *
 * @see dotdo-gfduh - Digital Workers - Unified Agent/Human Interface
 *
 * Design (from epic):
 * - Worker abstraction unifies agents and humans
 * - Capability tiers work for routing (code -> generative -> agentic -> human)
 * - Handoff protocol functional
 * - Load balancing via graph queries
 * - Integrates with ai-workflows DSL
 * - NO MOCKS - use real db primitives
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DocumentGraphStore } from '../../db/graph/stores/document'

// ============================================================================
// Expected Type Definitions
// ============================================================================

/**
 * Unified Worker interface - works for both agents and humans
 */
interface UnifiedWorker {
  /** Worker ID */
  id: string
  /** Worker kind: agent or human */
  kind: 'agent' | 'human'
  /** Human-readable name */
  name: string
  /** Capability tier for routing */
  tier: 'code' | 'generative' | 'agentic' | 'human'
  /** Capabilities this worker has */
  capabilities: string[]
  /** Current availability status */
  status: 'available' | 'busy' | 'offline'

  // Unified actions - same API for agents and humans
  /** Notify another worker */
  notify(target: UnifiedWorker | string, message: string): Promise<NotifyResult>
  /** Ask a question and wait for answer */
  ask(question: string, options?: AskOptions): Promise<AskResult>
  /** Request approval */
  approve(request: ApprovalRequest): Promise<ApprovalResult>
  /** Make a decision from options */
  decide(question: string, options: DecisionOption[]): Promise<DecisionResult>
  /** Perform a task/action */
  do(action: string, context?: Record<string, unknown>): Promise<DoResult>

  // Worker coordination
  /** Hand off to another worker */
  handoffTo(target: UnifiedWorker | string, context: HandoffContext): Promise<HandoffResult>
  /** Delegate to another worker (with oversight) */
  delegateTo(target: UnifiedWorker | string, task: DelegationTask): Promise<DelegationResult>
  /** Escalate to higher tier worker */
  escalateTo(target: UnifiedWorker | string, reason: string): Promise<EscalationResult>
}

interface NotifyResult {
  delivered: boolean
  channel?: string
  messageId?: string
}

interface AskOptions {
  timeout?: number
  schema?: Record<string, unknown>
}

interface AskResult {
  answer: string
  confidence?: number
  respondedBy?: string
  respondedAt?: Date
}

interface ApprovalRequest {
  id: string
  description: string
  requester: string
  data?: Record<string, unknown>
  deadline?: Date
}

interface ApprovalResult {
  approved: boolean
  approver: string
  reason?: string
  approvedAt?: Date
}

interface DecisionOption {
  id: string
  label: string
  description?: string
}

interface DecisionResult {
  selectedOption: DecisionOption
  reasoning?: string
  confidence?: number
  decidedBy?: string
}

interface DoResult {
  success: boolean
  output?: unknown
  error?: string
  duration?: number
}

interface HandoffContext {
  task?: string
  files?: string[]
  reason?: string
  preserveContext?: boolean
}

interface HandoffResult {
  accepted: boolean
  handoffId: string
  receivedBy: string
  receivedAt: Date
}

interface DelegationTask {
  description: string
  constraints?: string[]
  deadline?: Date
  reportProgress?: boolean
}

interface DelegationResult {
  delegationId: string
  assignedTo: string
  assignedAt: Date
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'failed'
}

interface EscalationResult {
  escalationId: string
  escalatedTo: string
  escalatedAt: Date
  priority: 'normal' | 'high' | 'urgent'
}

// ============================================================================
// Test Setup
// ============================================================================

describe('Unified Worker Interface', () => {
  let graphStore: DocumentGraphStore

  beforeEach(async () => {
    graphStore = new DocumentGraphStore(':memory:')
    await graphStore.initialize()
  })

  afterEach(async () => {
    await graphStore.close()
  })

  // ============================================================================
  // UnifiedWorkerFactory Tests
  // ============================================================================

  describe('UnifiedWorkerFactory', () => {
    it('should be exported from workers/unified', async () => {
      const module = await import('../unified').catch(() => null)
      expect(module?.UnifiedWorkerFactory).toBeDefined()
    })

    it('should create agent worker from graph Thing', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)
      const worker = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code', 'review'],
      })

      expect(worker).toBeDefined()
      expect(worker.kind).toBe('agent')
      expect(worker.name).toBe('ralph')
      expect(worker.tier).toBe('agentic')
    })

    it('should create human worker from graph Thing', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)
      const worker = await factory.createWorker({
        kind: 'human',
        name: 'nathan',
        tier: 'human',
        capabilities: ['approve', 'decide'],
      })

      expect(worker).toBeDefined()
      expect(worker.kind).toBe('human')
      expect(worker.name).toBe('nathan')
      expect(worker.tier).toBe('human')
    })

    it('should get worker by ID', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)
      const created = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      const found = await factory.getWorker(created.id)

      expect(found).toBeDefined()
      expect(found?.id).toBe(created.id)
      expect(found?.name).toBe('ralph')
    })

    it('should get worker by name', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)
      await factory.createWorker({
        kind: 'agent',
        name: 'priya',
        tier: 'agentic',
        capabilities: ['plan', 'spec'],
      })

      const found = await factory.getWorkerByName('priya')

      expect(found).toBeDefined()
      expect(found?.name).toBe('priya')
    })
  })

  // ============================================================================
  // Unified Worker Actions Tests
  // ============================================================================

  describe('Unified Worker Actions', () => {
    it('should have notify method for both agent and human', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const agent = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      const human = await factory.createWorker({
        kind: 'human',
        name: 'nathan',
        tier: 'human',
        capabilities: ['approve'],
      })

      // Both should have notify method
      expect(typeof agent.notify).toBe('function')
      expect(typeof human.notify).toBe('function')
    })

    it('should have ask method for both agent and human', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const agent = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      expect(typeof agent.ask).toBe('function')
    })

    it('should have approve method for both agent and human', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const human = await factory.createWorker({
        kind: 'human',
        name: 'nathan',
        tier: 'human',
        capabilities: ['approve'],
      })

      expect(typeof human.approve).toBe('function')
    })

    it('should have decide method for both agent and human', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const worker = await factory.createWorker({
        kind: 'agent',
        name: 'tom',
        tier: 'agentic',
        capabilities: ['review', 'decide'],
      })

      expect(typeof worker.decide).toBe('function')
    })

    it('should have do method for both agent and human', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const worker = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      expect(typeof worker.do).toBe('function')
    })
  })

  // ============================================================================
  // Worker Coordination Tests
  // ============================================================================

  describe('Worker Coordination', () => {
    it('should support handoffTo between workers', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const agent = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      const reviewer = await factory.createWorker({
        kind: 'agent',
        name: 'tom',
        tier: 'agentic',
        capabilities: ['review'],
      })

      expect(typeof agent.handoffTo).toBe('function')

      const result = await agent.handoffTo(reviewer, {
        task: 'Review PR #123',
        reason: 'Code implementation complete',
      })

      expect(result.accepted).toBe(true)
      expect(result.receivedBy).toBe(reviewer.id)
    })

    it('should support delegateTo between workers', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const manager = await factory.createWorker({
        kind: 'agent',
        name: 'priya',
        tier: 'agentic',
        capabilities: ['plan', 'delegate'],
      })

      const engineer = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      expect(typeof manager.delegateTo).toBe('function')

      const result = await manager.delegateTo(engineer, {
        description: 'Implement user authentication',
        constraints: ['Use OAuth2'],
        deadline: new Date(Date.now() + 86400000),
      })

      expect(result.delegationId).toBeDefined()
      expect(result.assignedTo).toBe(engineer.id)
      expect(result.status).toBe('pending')
    })

    it('should support escalateTo for tier promotion', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const agent = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      const human = await factory.createWorker({
        kind: 'human',
        name: 'nathan',
        tier: 'human',
        capabilities: ['approve', 'escalate'],
      })

      expect(typeof agent.escalateTo).toBe('function')

      const result = await agent.escalateTo(human, 'Refund exceeds $10,000 threshold')

      expect(result.escalationId).toBeDefined()
      expect(result.escalatedTo).toBe(human.id)
    })
  })

  // ============================================================================
  // Capability Tier Routing Tests
  // ============================================================================

  describe('Capability Tier Routing', () => {
    it('should route to code tier for deterministic operations', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory || !module?.TierRouter) {
        throw new Error('UnifiedWorkerFactory or TierRouter not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      // Create workers at different tiers
      await factory.createWorker({
        kind: 'agent',
        name: 'codebot',
        tier: 'code',
        capabilities: ['format', 'lint'],
        status: 'available',
      })

      await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
        status: 'available',
      })

      const router = new module.TierRouter(factory)
      const worker = await router.routeByTier('code')

      expect(worker).toBeDefined()
      expect(worker?.tier).toBe('code')
    })

    it('should route to generative tier for AI generation', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory || !module?.TierRouter) {
        throw new Error('UnifiedWorkerFactory or TierRouter not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      await factory.createWorker({
        kind: 'agent',
        name: 'mark',
        tier: 'generative',
        capabilities: ['content', 'summarize'],
        status: 'available',
      })

      const router = new module.TierRouter(factory)
      const worker = await router.routeByTier('generative')

      expect(worker).toBeDefined()
      expect(worker?.tier).toBe('generative')
    })

    it('should route to agentic tier for multi-step reasoning', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory || !module?.TierRouter) {
        throw new Error('UnifiedWorkerFactory or TierRouter not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code', 'plan', 'debug'],
        status: 'available',
      })

      const router = new module.TierRouter(factory)
      const worker = await router.routeByTier('agentic')

      expect(worker).toBeDefined()
      expect(worker?.tier).toBe('agentic')
    })

    it('should route to human tier for oversight', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory || !module?.TierRouter) {
        throw new Error('UnifiedWorkerFactory or TierRouter not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      await factory.createWorker({
        kind: 'human',
        name: 'nathan',
        tier: 'human',
        capabilities: ['approve', 'decide'],
        status: 'available',
      })

      const router = new module.TierRouter(factory)
      const worker = await router.routeByTier('human')

      expect(worker).toBeDefined()
      expect(worker?.tier).toBe('human')
      expect(worker?.kind).toBe('human')
    })

    it('should cascade through tiers on escalation', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory || !module?.TierRouter) {
        throw new Error('UnifiedWorkerFactory or TierRouter not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      await factory.createWorker({
        kind: 'agent',
        name: 'codebot',
        tier: 'code',
        capabilities: ['format'],
        status: 'available',
      })

      await factory.createWorker({
        kind: 'agent',
        name: 'mark',
        tier: 'generative',
        capabilities: ['summarize'],
        status: 'available',
      })

      await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
        status: 'available',
      })

      await factory.createWorker({
        kind: 'human',
        name: 'nathan',
        tier: 'human',
        capabilities: ['approve'],
        status: 'available',
      })

      const router = new module.TierRouter(factory)

      // Escalate from code to generative
      const escalated1 = await router.escalate('code')
      expect(escalated1?.tier).toBe('generative')

      // Escalate from generative to agentic
      const escalated2 = await router.escalate('generative')
      expect(escalated2?.tier).toBe('agentic')

      // Escalate from agentic to human
      const escalated3 = await router.escalate('agentic')
      expect(escalated3?.tier).toBe('human')

      // Cannot escalate beyond human
      const escalated4 = await router.escalate('human')
      expect(escalated4).toBeNull()
    })
  })

  // ============================================================================
  // Load Balancing Tests
  // ============================================================================

  describe('Load Balancing via Graph', () => {
    it('should round-robin route to available workers', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory || !module?.LoadBalancer) {
        throw new Error('UnifiedWorkerFactory or LoadBalancer not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      // Create multiple available workers
      await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
        status: 'available',
      })

      await factory.createWorker({
        kind: 'agent',
        name: 'quinn',
        tier: 'agentic',
        capabilities: ['code'],
        status: 'available',
      })

      const balancer = new module.LoadBalancer(factory, 'round-robin')

      const first = await balancer.getNextWorker({ tier: 'agentic' })
      const second = await balancer.getNextWorker({ tier: 'agentic' })
      const third = await balancer.getNextWorker({ tier: 'agentic' })

      // Should alternate between workers
      expect(first?.id).not.toBe(second?.id)
      expect(third?.id).toBe(first?.id) // wraps around
    })

    it('should skip offline workers in routing', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory || !module?.LoadBalancer) {
        throw new Error('UnifiedWorkerFactory or LoadBalancer not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
        status: 'offline',
      })

      await factory.createWorker({
        kind: 'agent',
        name: 'quinn',
        tier: 'agentic',
        capabilities: ['code'],
        status: 'available',
      })

      const balancer = new module.LoadBalancer(factory)

      const worker = await balancer.getNextWorker({ tier: 'agentic' })

      expect(worker).toBeDefined()
      expect(worker?.name).toBe('quinn') // Should get available worker
      expect(worker?.status).toBe('available')
    })

    it('should route by capability match', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory || !module?.LoadBalancer) {
        throw new Error('UnifiedWorkerFactory or LoadBalancer not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code', 'review'],
        status: 'available',
      })

      await factory.createWorker({
        kind: 'agent',
        name: 'quinn',
        tier: 'agentic',
        capabilities: ['test', 'qa'],
        status: 'available',
      })

      const balancer = new module.LoadBalancer(factory)

      const worker = await balancer.getNextWorker({
        tier: 'agentic',
        capabilities: ['code', 'review'],
      })

      expect(worker).toBeDefined()
      expect(worker?.name).toBe('ralph')
      expect(worker?.capabilities).toContain('code')
      expect(worker?.capabilities).toContain('review')
    })
  })

  // ============================================================================
  // AI Workflows DSL Integration Tests
  // ============================================================================

  describe('AI Workflows DSL Integration', () => {
    it('should integrate with $ context via withWorkers()', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.withWorkers) {
        throw new Error('withWorkers not implemented')
      }

      const factory = await import('../unified').then((m) => {
        if (!m.UnifiedWorkerFactory) throw new Error('Factory not implemented')
        return new m.UnifiedWorkerFactory(graphStore)
      })

      await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
        status: 'available',
      })

      // Mock $ context
      const mockContext = {} as Record<string, unknown>

      const enhanced = module.withWorkers(mockContext, factory)

      expect(enhanced.notify).toBeDefined()
      expect(enhanced.ask).toBeDefined()
      expect(enhanced.approve).toBeDefined()
      expect(enhanced.decide).toBeDefined()
    })

    it('should provide $.notify convenience method', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.withWorkers || !module?.UnifiedWorkerFactory) {
        throw new Error('withWorkers or UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const worker = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
        status: 'available',
      })

      const mockContext = {} as Record<string, unknown>
      const enhanced = module.withWorkers(mockContext, factory)

      const result = await enhanced.notify(worker, 'Build completed')

      expect(result.delivered).toBe(true)
    })

    it('should provide $.approve convenience method', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.withWorkers || !module?.UnifiedWorkerFactory) {
        throw new Error('withWorkers or UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const human = await factory.createWorker({
        kind: 'human',
        name: 'nathan',
        tier: 'human',
        capabilities: ['approve'],
        status: 'available',
      })

      const mockContext = {} as Record<string, unknown>
      const enhanced = module.withWorkers(mockContext, factory)

      // Note: This would normally block waiting for human response
      // In tests, we mock or provide immediate response
      expect(typeof enhanced.approve).toBe('function')
    })
  })

  // ============================================================================
  // Graph Relationship Tests
  // ============================================================================

  describe('Worker Relationships in Graph', () => {
    it('should track handoff relationships in graph', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const sender = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      const receiver = await factory.createWorker({
        kind: 'agent',
        name: 'tom',
        tier: 'agentic',
        capabilities: ['review'],
      })

      await sender.handoffTo(receiver, { task: 'Review PR' })

      // Query handoffs from graph
      const handoffs = await factory.queryRelationships(sender.id, 'handoffTo')

      expect(handoffs.length).toBe(1)
      expect(handoffs[0].to).toBe(receiver.id)
    })

    it('should track delegation relationships in graph', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const manager = await factory.createWorker({
        kind: 'agent',
        name: 'priya',
        tier: 'agentic',
        capabilities: ['plan'],
      })

      const worker = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      await manager.delegateTo(worker, { description: 'Build feature X' })

      // Query delegations from graph
      const delegations = await factory.queryRelationships(manager.id, 'delegatedTo')

      expect(delegations.length).toBe(1)
      expect(delegations[0].to).toBe(worker.id)
    })

    it('should track escalation relationships in graph', async () => {
      const module = await import('../unified').catch(() => null)
      if (!module?.UnifiedWorkerFactory) {
        throw new Error('UnifiedWorkerFactory not implemented')
      }

      const factory = new module.UnifiedWorkerFactory(graphStore)

      const agent = await factory.createWorker({
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code'],
      })

      const human = await factory.createWorker({
        kind: 'human',
        name: 'nathan',
        tier: 'human',
        capabilities: ['approve'],
      })

      await agent.escalateTo(human, 'Needs human approval')

      // Query escalations from graph
      const escalations = await factory.queryRelationships(agent.id, 'escalatedTo')

      expect(escalations.length).toBe(1)
      expect(escalations[0].to).toBe(human.id)
    })
  })
})
