/**
 * Unified Worker Interface Tests
 *
 * Tests for the unified interface for AI agents and human workers:
 * - UnifiedWorkerFactory
 * - UnifiedWorkerImpl
 * - TierRouter
 * - LoadBalancer
 * - withWorkers DSL integration
 * - createWorkerTemplate
 *
 * @module workers/unified.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  UnifiedWorkerFactory,
  TierRouter,
  LoadBalancer,
  withWorkers,
  createWorkerTemplate,
  TIER_ORDER,
  type UnifiedWorker,
  type CreateWorkerInput,
  type WorkerKind,
  type WorkerTier,
  type WorkerStatus,
  type ApprovalRequest,
  type DecisionOption,
} from './unified'
import type { DocumentGraphStore } from '../db/graph/stores/document'

// =============================================================================
// Mock DocumentGraphStore
// =============================================================================

function createMockGraphStore(): DocumentGraphStore {
  const things = new Map<string, {
    id: string
    typeId: number
    typeName: string
    data: Record<string, unknown>
  }>()

  const relationships: Array<{
    id: string
    verb: string
    from: string
    to: string
    data: Record<string, unknown>
  }> = []

  return {
    createThing: vi.fn(async (thing) => {
      things.set(thing.id, thing as any)
      return thing as any
    }),
    getThing: vi.fn(async (id) => things.get(id) ?? null),
    queryThings: vi.fn(async (query) => {
      return Array.from(things.values()).filter((t) => {
        if (query.typeName && t.typeName !== query.typeName) return false
        return true
      })
    }),
    createRelationship: vi.fn(async (rel) => {
      relationships.push(rel)
      return rel
    }),
    queryRelationships: vi.fn(async () => relationships),
  } as unknown as DocumentGraphStore
}

// =============================================================================
// UnifiedWorkerFactory Tests
// =============================================================================

describe('UnifiedWorkerFactory', () => {
  let factory: UnifiedWorkerFactory
  let graphStore: DocumentGraphStore

  beforeEach(() => {
    graphStore = createMockGraphStore()
    factory = new UnifiedWorkerFactory(graphStore)
  })

  describe('createWorker', () => {
    it('creates an agent worker', async () => {
      const input: CreateWorkerInput = {
        kind: 'agent',
        name: 'ralph',
        tier: 'agentic',
        capabilities: ['code', 'review'],
      }

      const worker = await factory.createWorker(input)

      expect(worker.kind).toBe('agent')
      expect(worker.name).toBe('ralph')
      expect(worker.tier).toBe('agentic')
      expect(worker.capabilities).toEqual(['code', 'review'])
      expect(worker.status).toBe('available')
      expect(worker.id).toContain('worker_ralph')
    })

    it('creates a human worker', async () => {
      const input: CreateWorkerInput = {
        kind: 'human',
        name: 'john',
        tier: 'human',
        capabilities: ['approve', 'review'],
        status: 'busy',
      }

      const worker = await factory.createWorker(input)

      expect(worker.kind).toBe('human')
      expect(worker.name).toBe('john')
      expect(worker.tier).toBe('human')
      expect(worker.status).toBe('busy')
    })

    it('stores worker in graph store', async () => {
      const input: CreateWorkerInput = {
        kind: 'agent',
        name: 'test',
        tier: 'generative',
        capabilities: ['generate'],
      }

      await factory.createWorker(input)

      expect(graphStore.createThing).toHaveBeenCalledWith(
        expect.objectContaining({
          typeName: 'Worker',
          data: expect.objectContaining({
            kind: 'agent',
            name: 'test',
            tier: 'generative',
          }),
        })
      )
    })

    it('applies default status when not provided', async () => {
      const input: CreateWorkerInput = {
        kind: 'agent',
        name: 'test',
        tier: 'code',
        capabilities: [],
      }

      const worker = await factory.createWorker(input)
      expect(worker.status).toBe('available')
    })
  })

  describe('getWorker', () => {
    it('returns cached worker by ID', async () => {
      const worker = await factory.createWorker({
        kind: 'agent',
        name: 'test',
        tier: 'code',
        capabilities: [],
      })

      const retrieved = await factory.getWorker(worker.id)
      expect(retrieved).toBe(worker)
    })

    it('returns null for non-existent worker', async () => {
      const worker = await factory.getWorker('non-existent')
      expect(worker).toBeNull()
    })
  })

  describe('getWorkerByName', () => {
    it('returns worker by name', async () => {
      const worker = await factory.createWorker({
        kind: 'agent',
        name: 'unique-name',
        tier: 'code',
        capabilities: [],
      })

      const retrieved = await factory.getWorkerByName('unique-name')
      expect(retrieved?.id).toBe(worker.id)
    })

    it('returns null for non-existent name', async () => {
      const worker = await factory.getWorkerByName('no-such-worker')
      expect(worker).toBeNull()
    })
  })

  describe('listWorkers', () => {
    it('lists all created workers', async () => {
      await factory.createWorker({
        kind: 'agent',
        name: 'worker1',
        tier: 'code',
        capabilities: [],
      })
      await factory.createWorker({
        kind: 'human',
        name: 'worker2',
        tier: 'human',
        capabilities: [],
      })

      const workers = await factory.listWorkers()
      expect(workers.length).toBe(2)
    })

    it('returns empty array when no workers', async () => {
      const workers = await factory.listWorkers()
      expect(workers).toEqual([])
    })
  })

  describe('findByTier', () => {
    it('finds workers by tier', async () => {
      await factory.createWorker({
        kind: 'agent',
        name: 'coder',
        tier: 'code',
        capabilities: [],
      })
      await factory.createWorker({
        kind: 'agent',
        name: 'generator',
        tier: 'generative',
        capabilities: [],
      })
      await factory.createWorker({
        kind: 'agent',
        name: 'agentic',
        tier: 'agentic',
        capabilities: [],
      })

      const codeWorkers = await factory.findByTier('code')
      expect(codeWorkers.length).toBe(1)
      expect(codeWorkers[0].name).toBe('coder')
    })

    it('returns empty array when no workers of tier', async () => {
      await factory.createWorker({
        kind: 'agent',
        name: 'coder',
        tier: 'code',
        capabilities: [],
      })

      const humanWorkers = await factory.findByTier('human')
      expect(humanWorkers).toEqual([])
    })
  })

  describe('findAvailable', () => {
    it('finds only available workers', async () => {
      await factory.createWorker({
        kind: 'agent',
        name: 'available1',
        tier: 'code',
        capabilities: [],
        status: 'available',
      })
      await factory.createWorker({
        kind: 'agent',
        name: 'busy',
        tier: 'code',
        capabilities: [],
        status: 'busy',
      })
      await factory.createWorker({
        kind: 'agent',
        name: 'available2',
        tier: 'code',
        capabilities: [],
        status: 'available',
      })

      const available = await factory.findAvailable()
      expect(available.length).toBe(2)
      expect(available.every((w) => w.status === 'available')).toBe(true)
    })
  })

  describe('findByCapabilities', () => {
    it('finds workers with required capabilities', async () => {
      await factory.createWorker({
        kind: 'agent',
        name: 'coder',
        tier: 'code',
        capabilities: ['code', 'review'],
      })
      await factory.createWorker({
        kind: 'agent',
        name: 'writer',
        tier: 'generative',
        capabilities: ['write', 'edit'],
      })

      const coders = await factory.findByCapabilities(['code'])
      expect(coders.length).toBe(1)
      expect(coders[0].name).toBe('coder')
    })

    it('requires all capabilities to match', async () => {
      await factory.createWorker({
        kind: 'agent',
        name: 'coder',
        tier: 'code',
        capabilities: ['code'],
      })

      const workers = await factory.findByCapabilities(['code', 'review'])
      expect(workers.length).toBe(0)
    })
  })

  describe('createRelationship', () => {
    it('creates relationship between workers', async () => {
      const worker1 = await factory.createWorker({
        kind: 'agent',
        name: 'w1',
        tier: 'code',
        capabilities: [],
      })
      const worker2 = await factory.createWorker({
        kind: 'agent',
        name: 'w2',
        tier: 'code',
        capabilities: [],
      })

      const rel = await factory.createRelationship({
        verb: 'notified',
        from: worker1.id,
        to: worker2.id,
        data: { message: 'Hello' },
      })

      expect(rel.verb).toBe('notified')
      expect(rel.from).toBe(worker1.id)
      expect(rel.to).toBe(worker2.id)
      expect(rel.id).toContain('rel_')
      expect(graphStore.createRelationship).toHaveBeenCalled()
    })
  })

  describe('queryRelationships', () => {
    it('queries relationships from a worker', async () => {
      const worker1 = await factory.createWorker({
        kind: 'agent',
        name: 'w1',
        tier: 'code',
        capabilities: [],
      })
      const worker2 = await factory.createWorker({
        kind: 'agent',
        name: 'w2',
        tier: 'code',
        capabilities: [],
      })

      await factory.createRelationship({
        verb: 'notified',
        from: worker1.id,
        to: worker2.id,
      })
      await factory.createRelationship({
        verb: 'delegatedTo',
        from: worker1.id,
        to: worker2.id,
      })

      const rels = await factory.queryRelationships(worker1.id)
      expect(rels.length).toBe(2)
    })

    it('filters by verb when specified', async () => {
      const worker1 = await factory.createWorker({
        kind: 'agent',
        name: 'w1',
        tier: 'code',
        capabilities: [],
      })
      const worker2 = await factory.createWorker({
        kind: 'agent',
        name: 'w2',
        tier: 'code',
        capabilities: [],
      })

      await factory.createRelationship({
        verb: 'notified',
        from: worker1.id,
        to: worker2.id,
      })
      await factory.createRelationship({
        verb: 'delegatedTo',
        from: worker1.id,
        to: worker2.id,
      })

      const rels = await factory.queryRelationships(worker1.id, 'notified')
      expect(rels.length).toBe(1)
      expect(rels[0].verb).toBe('notified')
    })
  })
})

// =============================================================================
// UnifiedWorker Implementation Tests
// =============================================================================

describe('UnifiedWorkerImpl', () => {
  let factory: UnifiedWorkerFactory
  let worker: UnifiedWorker
  let targetWorker: UnifiedWorker

  beforeEach(async () => {
    factory = new UnifiedWorkerFactory(createMockGraphStore())
    worker = await factory.createWorker({
      kind: 'agent',
      name: 'sender',
      tier: 'agentic',
      capabilities: ['code'],
    })
    targetWorker = await factory.createWorker({
      kind: 'agent',
      name: 'receiver',
      tier: 'agentic',
      capabilities: ['review'],
    })
  })

  describe('notify', () => {
    it('notifies another worker by object', async () => {
      const result = await worker.notify(targetWorker, 'Hello!')

      expect(result.delivered).toBe(true)
      expect(result.messageId).toContain('msg_')
    })

    it('notifies another worker by ID', async () => {
      const result = await worker.notify(targetWorker.id, 'Hello!')

      expect(result.delivered).toBe(true)
    })
  })

  describe('ask', () => {
    it('returns response from agent worker', async () => {
      const result = await worker.ask('What is 2+2?')

      expect(result.answer).toContain('Response to:')
      expect(result.respondedBy).toBe(worker.id)
      expect(result.respondedAt).toBeInstanceOf(Date)
    })

    it('returns response from human worker', async () => {
      const human = await factory.createWorker({
        kind: 'human',
        name: 'human',
        tier: 'human',
        capabilities: [],
      })

      const result = await human.ask('Approve?')

      expect(result.answer).toContain('Human response')
      expect(result.respondedBy).toBe(human.id)
    })

    it('accepts options', async () => {
      const result = await worker.ask('Question?', { timeout: 5000 })
      expect(result.answer).toBeDefined()
    })
  })

  describe('approve', () => {
    it('approves a request', async () => {
      const request: ApprovalRequest = {
        id: 'req-1',
        description: 'Approve deployment',
        requester: 'system',
      }

      const result = await worker.approve(request)

      expect(result.approved).toBe(true)
      expect(result.approver).toBe(worker.id)
      expect(result.approvedAt).toBeInstanceOf(Date)
    })

    it('handles request with data', async () => {
      const request: ApprovalRequest = {
        id: 'req-2',
        description: 'Approve with data',
        requester: 'system',
        data: { amount: 100 },
        deadline: new Date(Date.now() + 3600000),
      }

      const result = await worker.approve(request)
      expect(result.approved).toBe(true)
    })
  })

  describe('decide', () => {
    it('decides between options', async () => {
      const options: DecisionOption[] = [
        { id: 'opt1', label: 'Option 1', description: 'First option' },
        { id: 'opt2', label: 'Option 2', description: 'Second option' },
      ]

      const result = await worker.decide('Which option?', options)

      expect(result.selectedOption).toBe(options[0])
      expect(result.reasoning).toContain('Option 1')
      expect(result.decidedBy).toBe(worker.id)
    })

    it('includes confidence score', async () => {
      const options: DecisionOption[] = [
        { id: 'opt1', label: 'Yes' },
        { id: 'opt2', label: 'No' },
      ]

      const result = await worker.decide('Proceed?', options)
      expect(result.confidence).toBe(0.85)
    })
  })

  describe('do', () => {
    it('executes an action', async () => {
      const result = await worker.do('build project')

      expect(result.success).toBe(true)
      expect(result.output).toEqual({ action: 'build project', completed: true })
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('accepts context for action', async () => {
      const result = await worker.do('deploy', { env: 'production' })

      expect(result.success).toBe(true)
    })
  })

  describe('handoffTo', () => {
    it('hands off to another worker', async () => {
      const result = await worker.handoffTo(targetWorker, {
        task: 'Review PR',
        files: ['src/main.ts'],
      })

      expect(result.accepted).toBe(true)
      expect(result.handoffId).toContain('handoff_')
      expect(result.receivedBy).toBe(targetWorker.id)
      expect(result.receivedAt).toBeInstanceOf(Date)
    })

    it('hands off by worker ID', async () => {
      const result = await worker.handoffTo(targetWorker.id, {
        task: 'Continue work',
      })

      expect(result.accepted).toBe(true)
      expect(result.receivedBy).toBe(targetWorker.id)
    })

    it('preserves context when specified', async () => {
      const result = await worker.handoffTo(targetWorker, {
        task: 'Continue',
        preserveContext: true,
        reason: 'Need expertise',
      })

      expect(result.accepted).toBe(true)
    })
  })

  describe('delegateTo', () => {
    it('delegates task to another worker', async () => {
      const result = await worker.delegateTo(targetWorker, {
        description: 'Write tests',
        constraints: ['Use vitest', 'Cover edge cases'],
      })

      expect(result.delegationId).toContain('delegation_')
      expect(result.assignedTo).toBe(targetWorker.id)
      expect(result.status).toBe('pending')
    })

    it('accepts deadline and progress reporting', async () => {
      const result = await worker.delegateTo(targetWorker, {
        description: 'Complete task',
        deadline: new Date(Date.now() + 86400000),
        reportProgress: true,
      })

      expect(result.status).toBe('pending')
    })
  })

  describe('escalateTo', () => {
    it('escalates to another worker', async () => {
      const result = await worker.escalateTo(targetWorker, 'Need review')

      expect(result.escalationId).toContain('escalation_')
      expect(result.escalatedTo).toBe(targetWorker.id)
      expect(result.escalatedAt).toBeInstanceOf(Date)
      expect(result.priority).toBe('normal')
    })

    it('escalates by worker ID', async () => {
      const result = await worker.escalateTo(targetWorker.id, 'Urgent issue')

      expect(result.escalatedTo).toBe(targetWorker.id)
    })
  })
})

// =============================================================================
// TierRouter Tests
// =============================================================================

describe('TierRouter', () => {
  let factory: UnifiedWorkerFactory
  let router: TierRouter

  beforeEach(async () => {
    factory = new UnifiedWorkerFactory(createMockGraphStore())
    router = new TierRouter(factory)

    // Create workers of different tiers
    await factory.createWorker({
      kind: 'agent',
      name: 'code-worker',
      tier: 'code',
      capabilities: [],
    })
    await factory.createWorker({
      kind: 'agent',
      name: 'gen-worker',
      tier: 'generative',
      capabilities: [],
    })
    await factory.createWorker({
      kind: 'agent',
      name: 'agent-worker',
      tier: 'agentic',
      capabilities: [],
    })
    await factory.createWorker({
      kind: 'human',
      name: 'human-worker',
      tier: 'human',
      capabilities: [],
    })
  })

  describe('routeByTier', () => {
    it('routes to code tier', async () => {
      const worker = await router.routeByTier('code')
      expect(worker?.tier).toBe('code')
    })

    it('routes to generative tier', async () => {
      const worker = await router.routeByTier('generative')
      expect(worker?.tier).toBe('generative')
    })

    it('routes to agentic tier', async () => {
      const worker = await router.routeByTier('agentic')
      expect(worker?.tier).toBe('agentic')
    })

    it('routes to human tier', async () => {
      const worker = await router.routeByTier('human')
      expect(worker?.tier).toBe('human')
    })

    it('returns null when no workers of tier available', async () => {
      const emptyFactory = new UnifiedWorkerFactory(createMockGraphStore())
      const emptyRouter = new TierRouter(emptyFactory)

      const worker = await emptyRouter.routeByTier('code')
      expect(worker).toBeNull()
    })
  })

  describe('escalate', () => {
    it('escalates from code to generative', async () => {
      const worker = await router.escalate('code')
      expect(worker?.tier).toBe('generative')
    })

    it('escalates from generative to agentic', async () => {
      const worker = await router.escalate('generative')
      expect(worker?.tier).toBe('agentic')
    })

    it('escalates from agentic to human', async () => {
      const worker = await router.escalate('agentic')
      expect(worker?.tier).toBe('human')
    })

    it('cannot escalate beyond human tier', async () => {
      const worker = await router.escalate('human')
      expect(worker).toBeNull()
    })
  })

  describe('routeByCapabilities', () => {
    beforeEach(async () => {
      // Add workers with capabilities
      await factory.createWorker({
        kind: 'agent',
        name: 'coder',
        tier: 'code',
        capabilities: ['code', 'debug'],
      })
      await factory.createWorker({
        kind: 'agent',
        name: 'reviewer',
        tier: 'agentic',
        capabilities: ['review', 'approve'],
      })
    })

    it('routes by single capability', async () => {
      const worker = await router.routeByCapabilities(['code'])
      expect(worker?.capabilities).toContain('code')
    })

    it('routes by multiple capabilities', async () => {
      const worker = await router.routeByCapabilities(['code', 'debug'])
      expect(worker?.capabilities).toContain('code')
      expect(worker?.capabilities).toContain('debug')
    })

    it('returns null when no matching capabilities', async () => {
      const worker = await router.routeByCapabilities(['nonexistent'])
      expect(worker).toBeNull()
    })
  })
})

// =============================================================================
// LoadBalancer Tests
// =============================================================================

describe('LoadBalancer', () => {
  let factory: UnifiedWorkerFactory

  beforeEach(async () => {
    factory = new UnifiedWorkerFactory(createMockGraphStore())

    // Create multiple workers
    await factory.createWorker({
      kind: 'agent',
      name: 'w1',
      tier: 'code',
      capabilities: ['a', 'b'],
    })
    await factory.createWorker({
      kind: 'agent',
      name: 'w2',
      tier: 'code',
      capabilities: ['b', 'c'],
    })
    await factory.createWorker({
      kind: 'agent',
      name: 'w3',
      tier: 'generative',
      capabilities: ['c', 'd'],
    })
  })

  describe('round-robin strategy', () => {
    it('cycles through workers', async () => {
      const balancer = new LoadBalancer(factory, 'round-robin')

      const workers = []
      for (let i = 0; i < 6; i++) {
        const worker = await balancer.getNextWorker()
        workers.push(worker?.name)
      }

      // Should cycle through workers twice
      expect(workers).toEqual(['w1', 'w2', 'w3', 'w1', 'w2', 'w3'])
    })
  })

  describe('capability-match strategy', () => {
    it('selects worker with best capability match', async () => {
      const balancer = new LoadBalancer(factory, 'capability-match')

      const worker = await balancer.getNextWorker({ capabilities: ['a', 'b'] })
      expect(worker?.name).toBe('w1')
    })

    it('falls back to first worker when no capabilities specified', async () => {
      const balancer = new LoadBalancer(factory, 'capability-match')

      const worker = await balancer.getNextWorker()
      expect(worker).toBeDefined()
    })
  })

  describe('filtering', () => {
    it('filters by tier', async () => {
      const balancer = new LoadBalancer(factory)

      const worker = await balancer.getNextWorker({ tier: 'generative' })
      expect(worker?.tier).toBe('generative')
    })

    it('filters by capabilities', async () => {
      const balancer = new LoadBalancer(factory)

      const worker = await balancer.getNextWorker({ capabilities: ['d'] })
      expect(worker?.capabilities).toContain('d')
    })

    it('filters by both tier and capabilities', async () => {
      const balancer = new LoadBalancer(factory)

      const worker = await balancer.getNextWorker({
        tier: 'code',
        capabilities: ['a'],
      })
      expect(worker?.tier).toBe('code')
      expect(worker?.capabilities).toContain('a')
    })

    it('returns null when no matching workers', async () => {
      const balancer = new LoadBalancer(factory)

      const worker = await balancer.getNextWorker({
        capabilities: ['nonexistent'],
      })
      expect(worker).toBeNull()
    })
  })

  describe('default strategy', () => {
    it('uses round-robin by default', async () => {
      const balancer = new LoadBalancer(factory)

      const w1 = await balancer.getNextWorker()
      const w2 = await balancer.getNextWorker()
      const w3 = await balancer.getNextWorker()

      expect([w1?.name, w2?.name, w3?.name]).toEqual(['w1', 'w2', 'w3'])
    })
  })
})

// =============================================================================
// withWorkers DSL Integration Tests
// =============================================================================

describe('withWorkers', () => {
  let factory: UnifiedWorkerFactory
  let worker: UnifiedWorker
  let context: Record<string, unknown>

  beforeEach(async () => {
    factory = new UnifiedWorkerFactory(createMockGraphStore())
    worker = await factory.createWorker({
      kind: 'agent',
      name: 'test-worker',
      tier: 'agentic',
      capabilities: [],
    })
    context = { existingProp: 'value' }
  })

  it('preserves existing context properties', () => {
    const enhanced = withWorkers(context, factory)
    expect(enhanced.existingProp).toBe('value')
  })

  it('adds notify method', async () => {
    const enhanced = withWorkers(context, factory)

    const result = await enhanced.notify(worker, 'Test message')
    expect(result.delivered).toBe(true)
  })

  it('notify works with worker ID', async () => {
    const enhanced = withWorkers(context, factory)

    const result = await enhanced.notify(worker.id, 'Test message')
    expect(result.delivered).toBe(true)
  })

  it('adds ask method', async () => {
    const enhanced = withWorkers(context, factory)

    const result = await enhanced.ask(worker, 'Question?')
    expect(result.answer).toBeDefined()
  })

  it('ask returns default for non-existent worker', async () => {
    const enhanced = withWorkers(context, factory)

    const result = await enhanced.ask('non-existent', 'Question?')
    expect(result.answer).toBe('Worker not found')
  })

  it('adds approve method', async () => {
    const enhanced = withWorkers(context, factory)

    const request: ApprovalRequest = {
      id: 'req-1',
      description: 'Approve',
      requester: 'system',
    }

    const result = await enhanced.approve(request, worker)
    expect(result.approved).toBe(true)
  })

  it('approve finds human approver when none specified', async () => {
    await factory.createWorker({
      kind: 'human',
      name: 'approver',
      tier: 'human',
      capabilities: [],
    })

    const enhanced = withWorkers(context, factory)

    const request: ApprovalRequest = {
      id: 'req-2',
      description: 'Approve',
      requester: 'system',
    }

    const result = await enhanced.approve(request)
    expect(result.approved).toBe(true)
  })

  it('approve returns not approved when no human available', async () => {
    const enhanced = withWorkers(context, factory)

    const request: ApprovalRequest = {
      id: 'req-3',
      description: 'Approve',
      requester: 'system',
    }

    const result = await enhanced.approve(request)
    expect(result.approved).toBe(false)
    expect(result.reason).toBe('No approver available')
  })

  it('adds decide method', async () => {
    const enhanced = withWorkers(context, factory)

    const options: DecisionOption[] = [
      { id: 'opt1', label: 'Yes' },
      { id: 'opt2', label: 'No' },
    ]

    const result = await enhanced.decide('Proceed?', options, worker)
    expect(result.selectedOption).toBeDefined()
  })

  it('decide uses default selection when no decider', async () => {
    const enhanced = withWorkers(context, factory)

    const options: DecisionOption[] = [
      { id: 'opt1', label: 'First' },
      { id: 'opt2', label: 'Second' },
    ]

    const result = await enhanced.decide('Pick one', options)
    expect(result.selectedOption.id).toBe('opt1')
    expect(result.reasoning).toBe('Default selection')
  })
})

// =============================================================================
// createWorkerTemplate Tests
// =============================================================================

describe('createWorkerTemplate', () => {
  let factory: UnifiedWorkerFactory
  let worker: UnifiedWorker

  beforeEach(async () => {
    factory = new UnifiedWorkerFactory(createMockGraphStore())
    worker = await factory.createWorker({
      kind: 'agent',
      name: 'ralph',
      tier: 'agentic',
      capabilities: ['code'],
    })
  })

  it('creates template literal function', async () => {
    const ralph = createWorkerTemplate(worker)
    const result = await ralph`build the project`

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ action: 'build the project', completed: true })
  })

  it('interpolates values in template', async () => {
    const ralph = createWorkerTemplate(worker)
    const task = 'tests'
    const result = await ralph`write ${task} for the module`

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      action: 'write tests for the module',
      completed: true,
    })
  })

  it('handles multiple interpolations', async () => {
    const ralph = createWorkerTemplate(worker)
    const action = 'deploy'
    const env = 'production'
    const result = await ralph`${action} to ${env}`

    expect(result.output).toEqual({
      action: 'deploy to production',
      completed: true,
    })
  })
})

// =============================================================================
// TIER_ORDER Tests
// =============================================================================

describe('TIER_ORDER', () => {
  it('has correct order of tiers', () => {
    expect(TIER_ORDER).toEqual(['code', 'generative', 'agentic', 'human'])
  })

  it('code is lowest tier', () => {
    expect(TIER_ORDER[0]).toBe('code')
  })

  it('human is highest tier', () => {
    expect(TIER_ORDER[TIER_ORDER.length - 1]).toBe('human')
  })
})
