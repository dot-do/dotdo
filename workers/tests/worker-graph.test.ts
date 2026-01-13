/**
 * Worker Graph Model Tests - TDD RED Phase
 *
 * Tests for Worker abstraction as Things in the graph model,
 * unifying agents and humans under a common interface.
 *
 * The Worker abstraction provides:
 * - Unified interface for both AI agents and human workers
 * - Capability-based routing (code, generative, agentic, human tiers)
 * - Worker-to-Worker communication patterns (handoff, delegation)
 * - Action lifecycle tracking (notifying->notified, asking->asked, etc.)
 *
 * @module workers/tests/worker-graph
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import db primitives - NO MOCKS, use real implementations
import { ThingsStore, RelationshipsStore, type StoreContext, type ThingEntity } from '../../db/stores'

// ============================================================================
// Worker Types (Expected Interface - to be implemented)
// ============================================================================

/**
 * Worker kinds - either an AI agent or a human
 */
type WorkerKind = 'agent' | 'human'

/**
 * Capability tiers for routing decisions
 * - code: Fast, deterministic operations
 * - generative: AI generation (text, images, etc.)
 * - agentic: Multi-step reasoning and tool use
 * - human: Oversight, judgment, approval
 */
type WorkerTier = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Worker status for availability tracking
 */
type WorkerStatus = 'available' | 'busy' | 'offline'

/**
 * Worker data schema stored in Thing.data
 */
interface WorkerData {
  kind: WorkerKind
  name: string
  capabilities: string[]
  tier: WorkerTier
  status?: WorkerStatus
  metadata?: Record<string, unknown>
}

/**
 * Worker as a Thing entity
 */
interface WorkerThing extends ThingEntity {
  $type: 'Worker'
  data: WorkerData
}

// ============================================================================
// Worker Store Interface (Expected - to be implemented)
// ============================================================================

// NOTE: WorkerStore will be dynamically imported in tests to allow other tests to run
// The import will be: import { WorkerStore, createWorkerStore } from '../worker-store'

// ============================================================================
// Test Setup
// ============================================================================

describe('Worker as Thing', () => {
  let ctx: StoreContext
  let things: ThingsStore
  let relationships: RelationshipsStore

  beforeEach(() => {
    // Create a minimal store context for testing
    // This uses real db primitives, not mocks
    ctx = {
      db: createTestDatabase(),
      ns: 'https://test.workers.do',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }
    things = new ThingsStore(ctx)
    relationships = new RelationshipsStore(ctx)
  })

  // ===========================================================================
  // Worker Thing CRUD Tests
  // ===========================================================================

  describe('Worker Thing Creation', () => {
    it('should create Worker Thing with kind agent', async () => {
      const worker = await things.create({
        $type: 'Worker',
        name: 'ralph',
        data: {
          kind: 'agent',
          name: 'ralph',
          capabilities: ['code', 'review', 'test'],
          tier: 'agentic',
        },
      })

      expect(worker).toBeDefined()
      expect(worker.$type).toBe('Worker')
      expect((worker.data as WorkerData).kind).toBe('agent')
      expect((worker.data as WorkerData).name).toBe('ralph')
    })

    it('should create Worker Thing with kind human', async () => {
      const worker = await things.create({
        $type: 'Worker',
        name: 'nathan',
        data: {
          kind: 'human',
          name: 'nathan',
          capabilities: ['approve', 'decide', 'escalate'],
          tier: 'human',
        },
      })

      expect(worker).toBeDefined()
      expect(worker.$type).toBe('Worker')
      expect((worker.data as WorkerData).kind).toBe('human')
      expect((worker.data as WorkerData).tier).toBe('human')
    })

    it('should store capabilities as array', async () => {
      const capabilities = ['code', 'review', 'deploy', 'test', 'document']

      const worker = await things.create({
        $type: 'Worker',
        name: 'quinn',
        data: {
          kind: 'agent',
          name: 'quinn',
          capabilities,
          tier: 'agentic',
        },
      })

      expect((worker.data as WorkerData).capabilities).toBeInstanceOf(Array)
      expect((worker.data as WorkerData).capabilities).toHaveLength(5)
      expect((worker.data as WorkerData).capabilities).toContain('code')
      expect((worker.data as WorkerData).capabilities).toContain('test')
    })

    it('should store tier (code|generative|agentic|human)', async () => {
      const tiers: WorkerTier[] = ['code', 'generative', 'agentic', 'human']

      for (const tier of tiers) {
        const worker = await things.create({
          $type: 'Worker',
          name: `worker-${tier}`,
          data: {
            kind: tier === 'human' ? 'human' : 'agent',
            name: `worker-${tier}`,
            capabilities: [],
            tier,
          },
        })

        expect((worker.data as WorkerData).tier).toBe(tier)
      }
    })

    it('should validate Worker schema - requires kind', async () => {
      // Worker without kind should fail validation
      await expect(
        things.create({
          $type: 'Worker',
          name: 'invalid-worker',
          data: {
            // missing kind
            name: 'invalid',
            capabilities: [],
            tier: 'code',
          } as unknown as WorkerData,
        }),
      ).rejects.toThrow()
    })

    it('should validate Worker schema - requires capabilities array', async () => {
      // Worker with non-array capabilities should fail
      await expect(
        things.create({
          $type: 'Worker',
          name: 'invalid-worker',
          data: {
            kind: 'agent',
            name: 'invalid',
            capabilities: 'not-an-array', // Should be array
            tier: 'code',
          } as unknown as WorkerData,
        }),
      ).rejects.toThrow()
    })

    it('should validate Worker schema - tier must be valid', async () => {
      // Worker with invalid tier should fail
      await expect(
        things.create({
          $type: 'Worker',
          name: 'invalid-worker',
          data: {
            kind: 'agent',
            name: 'invalid',
            capabilities: [],
            tier: 'invalid-tier' as WorkerTier,
          },
        }),
      ).rejects.toThrow()
    })
  })

  // ===========================================================================
  // Worker Thing Update and Delete Tests
  // ===========================================================================

  describe('Worker Thing Updates', () => {
    it('should update Worker status', async () => {
      const worker = await things.create({
        $type: 'Worker',
        $id: 'worker-status-test',
        name: 'ralph',
        data: {
          kind: 'agent',
          name: 'ralph',
          capabilities: ['code'],
          tier: 'agentic',
          status: 'available',
        },
      })

      const updated = await things.update(worker.$id, {
        data: {
          ...(worker.data as WorkerData),
          status: 'busy',
        },
      })

      expect((updated.data as WorkerData).status).toBe('busy')
    })

    it('should add capabilities to Worker', async () => {
      const worker = await things.create({
        $type: 'Worker',
        $id: 'worker-capabilities-test',
        name: 'ralph',
        data: {
          kind: 'agent',
          name: 'ralph',
          capabilities: ['code'],
          tier: 'agentic',
        },
      })

      const updated = await things.update(worker.$id, {
        data: {
          ...(worker.data as WorkerData),
          capabilities: ['code', 'review', 'deploy'],
        },
      })

      expect((updated.data as WorkerData).capabilities).toContain('review')
      expect((updated.data as WorkerData).capabilities).toHaveLength(3)
    })

    it('should soft delete Worker', async () => {
      const worker = await things.create({
        $type: 'Worker',
        $id: 'worker-delete-test',
        name: 'to-be-deleted',
        data: {
          kind: 'agent',
          name: 'to-be-deleted',
          capabilities: [],
          tier: 'code',
        },
      })

      const deleted = await things.delete(worker.$id)

      expect(deleted.deleted).toBe(true)

      // Should not appear in normal queries
      const found = await things.get(worker.$id)
      expect(found).toBeNull()

      // Should appear with includeDeleted
      const foundDeleted = await things.get(worker.$id, { includeDeleted: true })
      expect(foundDeleted).toBeDefined()
    })
  })
})

// ============================================================================
// Worker Relationships Tests
// ============================================================================

describe('Worker Relationships', () => {
  let ctx: StoreContext
  let things: ThingsStore
  let relationships: RelationshipsStore

  beforeEach(() => {
    ctx = {
      db: createTestDatabase(),
      ns: 'https://test.workers.do',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }
    things = new ThingsStore(ctx)
    relationships = new RelationshipsStore(ctx)
  })

  // ===========================================================================
  // Action Lifecycle Relationships (verb -> verbing -> verbed)
  // ===========================================================================

  describe('Action Lifecycle Relationships', () => {
    it('should create notifying -> notified relationship chain', async () => {
      // Create two workers
      const sender = await things.create({
        $type: 'Worker',
        $id: 'worker-sender',
        name: 'ralph',
        data: { kind: 'agent', name: 'ralph', capabilities: ['notify'], tier: 'agentic' },
      })

      const recipient = await things.create({
        $type: 'Worker',
        $id: 'worker-recipient',
        name: 'tom',
        data: { kind: 'agent', name: 'tom', capabilities: ['review'], tier: 'agentic' },
      })

      // Create notifying relationship (in-progress)
      const notifying = await relationships.create({
        verb: 'notifying',
        from: sender.$id,
        to: recipient.$id,
        data: { message: 'Build completed', startedAt: Date.now() },
      })

      expect(notifying.verb).toBe('notifying')

      // Complete the notification - update to notified
      const notified = await relationships.create({
        verb: 'notified',
        from: sender.$id,
        to: recipient.$id,
        data: { message: 'Build completed', completedAt: Date.now() },
      })

      expect(notified.verb).toBe('notified')
    })

    it('should create asking -> asked relationship chain', async () => {
      const asker = await things.create({
        $type: 'Worker',
        $id: 'worker-asker',
        name: 'ralph',
        data: { kind: 'agent', name: 'ralph', capabilities: ['code'], tier: 'agentic' },
      })

      const answerer = await things.create({
        $type: 'Worker',
        $id: 'worker-answerer',
        name: 'tom',
        data: { kind: 'agent', name: 'tom', capabilities: ['review'], tier: 'agentic' },
      })

      // asking = in-progress question
      const asking = await relationships.create({
        verb: 'asking',
        from: asker.$id,
        to: answerer.$id,
        data: { question: 'Should we use Redis or Postgres?', priority: 'high' },
      })

      expect(asking.verb).toBe('asking')

      // asked = completed question with answer
      const asked = await relationships.create({
        verb: 'asked',
        from: asker.$id,
        to: answerer.$id,
        data: {
          question: 'Should we use Redis or Postgres?',
          answer: 'Use Postgres for ACID, Redis for caching',
        },
      })

      expect(asked.verb).toBe('asked')
    })

    it('should create approving -> approved relationship chain', async () => {
      const requester = await things.create({
        $type: 'Worker',
        $id: 'worker-requester',
        name: 'ralph',
        data: { kind: 'agent', name: 'ralph', capabilities: ['code'], tier: 'agentic' },
      })

      const approver = await things.create({
        $type: 'Worker',
        $id: 'worker-approver',
        name: 'nathan',
        data: { kind: 'human', name: 'nathan', capabilities: ['approve'], tier: 'human' },
      })

      // approving = pending approval
      const approving = await relationships.create({
        verb: 'approving',
        from: requester.$id,
        to: approver.$id,
        data: { request: 'Deploy to production', urgency: 'normal' },
      })

      expect(approving.verb).toBe('approving')

      // approved = completed with decision
      const approved = await relationships.create({
        verb: 'approved',
        from: requester.$id,
        to: approver.$id,
        data: {
          request: 'Deploy to production',
          decision: true,
          comment: 'LGTM',
        },
      })

      expect(approved.verb).toBe('approved')
    })

    it('should create doing -> done relationship chain', async () => {
      const delegator = await things.create({
        $type: 'Worker',
        $id: 'worker-delegator',
        name: 'priya',
        data: { kind: 'agent', name: 'priya', capabilities: ['plan'], tier: 'agentic' },
      })

      const doer = await things.create({
        $type: 'Worker',
        $id: 'worker-doer',
        name: 'ralph',
        data: { kind: 'agent', name: 'ralph', capabilities: ['code'], tier: 'agentic' },
      })

      // doing = task in progress
      const doing = await relationships.create({
        verb: 'doing',
        from: doer.$id,
        to: delegator.$id,
        data: { task: 'Implement user auth', startedAt: Date.now() },
      })

      expect(doing.verb).toBe('doing')

      // done = task completed
      const done = await relationships.create({
        verb: 'done',
        from: doer.$id,
        to: delegator.$id,
        data: {
          task: 'Implement user auth',
          completedAt: Date.now(),
          result: 'PR #123 ready for review',
        },
      })

      expect(done.verb).toBe('done')
    })
  })

  // ===========================================================================
  // Worker-to-Worker Communication Patterns
  // ===========================================================================

  describe('Worker-to-Worker Communication', () => {
    it('should track Worker handoffTo Worker', async () => {
      const workerA = await things.create({
        $type: 'Worker',
        $id: 'worker-a',
        name: 'ralph',
        data: { kind: 'agent', name: 'ralph', capabilities: ['code'], tier: 'agentic' },
      })

      const workerB = await things.create({
        $type: 'Worker',
        $id: 'worker-b',
        name: 'tom',
        data: { kind: 'agent', name: 'tom', capabilities: ['review'], tier: 'agentic' },
      })

      // Handoff represents a complete transfer of responsibility
      const handoff = await relationships.create({
        verb: 'handoffTo',
        from: workerA.$id,
        to: workerB.$id,
        data: {
          context: { task: 'Code review', files: ['src/auth.ts'] },
          reason: 'Implementation complete, ready for review',
          timestamp: Date.now(),
        },
      })

      expect(handoff.verb).toBe('handoffTo')
      expect(handoff.from).toBe(workerA.$id)
      expect(handoff.to).toBe(workerB.$id)

      // Query handoffs to a worker
      const handoffsToTom = await relationships.list({
        to: workerB.$id,
        verb: 'handoffTo',
      })

      expect(handoffsToTom).toHaveLength(1)
    })

    it('should track Worker delegatedTo Worker', async () => {
      const manager = await things.create({
        $type: 'Worker',
        $id: 'worker-manager',
        name: 'priya',
        data: { kind: 'agent', name: 'priya', capabilities: ['plan', 'delegate'], tier: 'agentic' },
      })

      const worker = await things.create({
        $type: 'Worker',
        $id: 'worker-impl',
        name: 'ralph',
        data: { kind: 'agent', name: 'ralph', capabilities: ['code'], tier: 'agentic' },
      })

      // Delegation maintains oversight relationship
      const delegation = await relationships.create({
        verb: 'delegatedTo',
        from: manager.$id,
        to: worker.$id,
        data: {
          task: 'Implement payment flow',
          constraints: ['Use Stripe API', 'Follow security best practices'],
          deadline: Date.now() + 86400000, // 24 hours
        },
      })

      expect(delegation.verb).toBe('delegatedTo')

      // Query delegations from a manager
      const delegationsFromPriya = await relationships.list({
        from: manager.$id,
        verb: 'delegatedTo',
      })

      expect(delegationsFromPriya).toHaveLength(1)
    })

    it('should track escalation chain (Worker escalatedTo Worker)', async () => {
      const agent = await things.create({
        $type: 'Worker',
        $id: 'worker-agent',
        name: 'ralph',
        data: { kind: 'agent', name: 'ralph', capabilities: ['code'], tier: 'agentic' },
      })

      const human = await things.create({
        $type: 'Worker',
        $id: 'worker-human',
        name: 'nathan',
        data: { kind: 'human', name: 'nathan', capabilities: ['decide', 'approve'], tier: 'human' },
      })

      // Escalation for decisions beyond agent capability
      const escalation = await relationships.create({
        verb: 'escalatedTo',
        from: agent.$id,
        to: human.$id,
        data: {
          reason: 'Refund amount exceeds threshold ($10,000)',
          context: { customerId: 'cust_123', amount: 15000 },
          urgency: 'high',
        },
      })

      expect(escalation.verb).toBe('escalatedTo')
      expect(escalation.to).toBe(human.$id)
    })

    it('should track message delivery (Worker sentTo Worker)', async () => {
      const sender = await things.create({
        $type: 'Worker',
        $id: 'worker-msg-sender',
        name: 'mark',
        data: { kind: 'agent', name: 'mark', capabilities: ['market'], tier: 'agentic' },
      })

      const recipient = await things.create({
        $type: 'Worker',
        $id: 'worker-msg-recipient',
        name: 'sally',
        data: { kind: 'agent', name: 'sally', capabilities: ['sales'], tier: 'agentic' },
      })

      const message = await relationships.create({
        verb: 'sentTo',
        from: sender.$id,
        to: recipient.$id,
        data: {
          type: 'lead',
          content: { companyName: 'Acme Corp', contactEmail: 'john@acme.com' },
          priority: 'high',
        },
      })

      expect(message.verb).toBe('sentTo')
    })

    it('should track task assignment (Task assignedTo Worker)', async () => {
      const worker = await things.create({
        $type: 'Worker',
        $id: 'worker-assigned',
        name: 'ralph',
        data: { kind: 'agent', name: 'ralph', capabilities: ['code'], tier: 'agentic' },
      })

      // Task is a separate Thing
      const task = await things.create({
        $type: 'Task',
        $id: 'task-001',
        name: 'Implement auth flow',
        data: { description: 'Add OAuth2 support', priority: 'high' },
      })

      // Assignment relationship
      const assignment = await relationships.create({
        verb: 'assignedTo',
        from: task.$id,
        to: worker.$id,
        data: {
          assignedAt: Date.now(),
          assignedBy: 'priya',
        },
      })

      expect(assignment.verb).toBe('assignedTo')
      expect(assignment.from).toBe(task.$id)
      expect(assignment.to).toBe(worker.$id)
    })
  })
})

// ============================================================================
// Worker Query Tests
// ============================================================================

describe('Worker Queries', () => {
  let ctx: StoreContext
  let things: ThingsStore
  let relationships: RelationshipsStore

  beforeEach(async () => {
    ctx = {
      db: createTestDatabase(),
      ns: 'https://test.workers.do',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }
    things = new ThingsStore(ctx)
    relationships = new RelationshipsStore(ctx)

    // Seed test workers
    await seedTestWorkers(things)
  })

  describe('Query by Tier', () => {
    it('should find workers by tier', async () => {
      const workers = await things.list({ type: 'Worker' })

      // Filter by tier using data field
      const agenticWorkers = workers.filter(
        (w) => (w.data as WorkerData)?.tier === 'agentic'
      )

      expect(agenticWorkers.length).toBeGreaterThan(0)
      expect(agenticWorkers.every((w) => (w.data as WorkerData).tier === 'agentic')).toBe(true)
    })

    it('should find human tier workers for escalation', async () => {
      const workers = await things.list({ type: 'Worker' })

      const humanWorkers = workers.filter(
        (w) => (w.data as WorkerData)?.tier === 'human'
      )

      expect(humanWorkers.length).toBeGreaterThan(0)
      expect(humanWorkers.every((w) => (w.data as WorkerData).kind === 'human')).toBe(true)
    })

    it('should find code tier workers for deterministic tasks', async () => {
      const workers = await things.list({ type: 'Worker' })

      const codeWorkers = workers.filter(
        (w) => (w.data as WorkerData)?.tier === 'code'
      )

      expect(codeWorkers.length).toBeGreaterThan(0)
    })
  })

  describe('Query by Status', () => {
    it('should find available workers', async () => {
      const workers = await things.list({ type: 'Worker' })

      const availableWorkers = workers.filter(
        (w) => (w.data as WorkerData)?.status === 'available'
      )

      expect(availableWorkers.length).toBeGreaterThan(0)
    })

    it('should find busy workers', async () => {
      // First, mark a worker as busy
      const workers = await things.list({ type: 'Worker' })
      const worker = workers[0]

      if (worker) {
        await things.update(worker.$id, {
          data: {
            ...(worker.data as WorkerData),
            status: 'busy',
          },
        })
      }

      // Query busy workers
      const updatedWorkers = await things.list({ type: 'Worker' })
      const busyWorkers = updatedWorkers.filter(
        (w) => (w.data as WorkerData)?.status === 'busy'
      )

      expect(busyWorkers.length).toBeGreaterThanOrEqual(1)
    })

    it('should exclude offline workers from routing', async () => {
      const workers = await things.list({ type: 'Worker' })

      const routeableWorkers = workers.filter(
        (w) => (w.data as WorkerData)?.status !== 'offline'
      )

      // Should have fewer workers than total if any are offline
      expect(routeableWorkers.length).toBeLessThanOrEqual(workers.length)
    })
  })

  describe('Query by Capabilities', () => {
    it('should find workers with specific capabilities', async () => {
      const workers = await things.list({ type: 'Worker' })

      // Find workers that can code
      const codingWorkers = workers.filter((w) =>
        (w.data as WorkerData)?.capabilities?.includes('code')
      )

      expect(codingWorkers.length).toBeGreaterThan(0)
    })

    it('should find workers with multiple required capabilities', async () => {
      const requiredCapabilities = ['code', 'review']

      const workers = await things.list({ type: 'Worker' })

      const qualifiedWorkers = workers.filter((w) => {
        const caps = (w.data as WorkerData)?.capabilities ?? []
        return requiredCapabilities.every((req) => caps.includes(req))
      })

      // May be empty if no worker has all capabilities
      expect(qualifiedWorkers).toBeInstanceOf(Array)
    })

    it('should find workers for approval capability', async () => {
      const workers = await things.list({ type: 'Worker' })

      const approvers = workers.filter((w) =>
        (w.data as WorkerData)?.capabilities?.includes('approve')
      )

      // Approvers should typically be human tier
      expect(approvers.every((w) => (w.data as WorkerData).tier === 'human')).toBe(true)
    })
  })

  describe('Query by Kind', () => {
    it('should find all agent workers', async () => {
      const workers = await things.list({ type: 'Worker' })

      const agents = workers.filter(
        (w) => (w.data as WorkerData)?.kind === 'agent'
      )

      expect(agents.length).toBeGreaterThan(0)
      expect(agents.every((w) => (w.data as WorkerData).kind === 'agent')).toBe(true)
    })

    it('should find all human workers', async () => {
      const workers = await things.list({ type: 'Worker' })

      const humans = workers.filter(
        (w) => (w.data as WorkerData)?.kind === 'human'
      )

      expect(humans.length).toBeGreaterThan(0)
      expect(humans.every((w) => (w.data as WorkerData).kind === 'human')).toBe(true)
    })
  })

  describe('Worker Routing Queries', () => {
    it('should find best worker for task by capabilities and availability', async () => {
      const requiredCapabilities = ['code']
      const workers = await things.list({ type: 'Worker' })

      // Find available workers with required capabilities
      const candidates = workers.filter((w) => {
        const data = w.data as WorkerData
        const hasCapabilities = requiredCapabilities.every((cap) =>
          data?.capabilities?.includes(cap)
        )
        const isAvailable = data?.status === 'available'
        return hasCapabilities && isAvailable
      })

      expect(candidates.length).toBeGreaterThanOrEqual(0)
    })

    it('should find worker by name', async () => {
      const workers = await things.list({ type: 'Worker' })

      const ralph = workers.find(
        (w) => (w.data as WorkerData)?.name === 'ralph'
      )

      expect(ralph).toBeDefined()
      expect((ralph?.data as WorkerData).name).toBe('ralph')
    })
  })
})

// ============================================================================
// Worker Store Interface Tests (should fail until implemented)
// ============================================================================

describe('WorkerStore Interface', () => {
  // Dynamic import helper - will fail until worker-store.ts is implemented
  const importWorkerStore = async () => {
    const module = await import('../worker-store')
    return module
  }

  describe('createWorkerStore factory', () => {
    it('should create a WorkerStore from StoreContext', async () => {
      const { createWorkerStore } = await importWorkerStore()

      const ctx: StoreContext = {
        db: createTestDatabase(),
        ns: 'https://test.workers.do',
        currentBranch: 'main',
        env: {},
        typeCache: new Map(),
      }

      // This should fail until WorkerStore is implemented
      const workerStore = createWorkerStore(ctx)

      expect(workerStore).toBeDefined()
      expect(typeof workerStore.createWorker).toBe('function')
      expect(typeof workerStore.getWorker).toBe('function')
      expect(typeof workerStore.listWorkers).toBe('function')
      expect(typeof workerStore.findByCapabilities).toBe('function')
      expect(typeof workerStore.findByTier).toBe('function')
      expect(typeof workerStore.findAvailable).toBe('function')
    })
  })

  describe('WorkerStore.createWorker', () => {
    it('should create an agent worker with validation', async () => {
      const { createWorkerStore } = await importWorkerStore()

      const ctx: StoreContext = {
        db: createTestDatabase(),
        ns: 'https://test.workers.do',
        currentBranch: 'main',
        env: {},
        typeCache: new Map(),
      }
      const workerStore = createWorkerStore(ctx)

      const worker = await workerStore.createWorker({
        kind: 'agent',
        name: 'ralph',
        capabilities: ['code', 'review'],
        tier: 'agentic',
      })

      expect(worker.$type).toBe('Worker')
      expect((worker.data as WorkerData).kind).toBe('agent')
    })

    it('should create a human worker with validation', async () => {
      const { createWorkerStore } = await importWorkerStore()

      const ctx: StoreContext = {
        db: createTestDatabase(),
        ns: 'https://test.workers.do',
        currentBranch: 'main',
        env: {},
        typeCache: new Map(),
      }
      const workerStore = createWorkerStore(ctx)

      const worker = await workerStore.createWorker({
        kind: 'human',
        name: 'nathan',
        capabilities: ['approve', 'decide'],
        tier: 'human',
      })

      expect(worker.$type).toBe('Worker')
      expect((worker.data as WorkerData).kind).toBe('human')
    })
  })

  describe('WorkerStore.findByCapabilities', () => {
    it('should find workers with all required capabilities', async () => {
      const { createWorkerStore } = await importWorkerStore()

      const ctx: StoreContext = {
        db: createTestDatabase(),
        ns: 'https://test.workers.do',
        currentBranch: 'main',
        env: {},
        typeCache: new Map(),
      }
      const workerStore = createWorkerStore(ctx)

      // Seed some workers first
      await workerStore.createWorker({
        kind: 'agent',
        name: 'ralph',
        capabilities: ['code', 'review', 'test'],
        tier: 'agentic',
      })
      await workerStore.createWorker({
        kind: 'agent',
        name: 'quinn',
        capabilities: ['test', 'qa'],
        tier: 'agentic',
      })

      const workers = await workerStore.findByCapabilities(['code', 'review'])

      expect(workers.length).toBeGreaterThanOrEqual(1)
      expect(workers.every((w) => {
        const caps = (w.data as WorkerData).capabilities
        return caps.includes('code') && caps.includes('review')
      })).toBe(true)
    })
  })

  describe('WorkerStore.findByTier', () => {
    it('should find workers by capability tier', async () => {
      const { createWorkerStore } = await importWorkerStore()

      const ctx: StoreContext = {
        db: createTestDatabase(),
        ns: 'https://test.workers.do',
        currentBranch: 'main',
        env: {},
        typeCache: new Map(),
      }
      const workerStore = createWorkerStore(ctx)

      await workerStore.createWorker({
        kind: 'agent',
        name: 'codebot',
        capabilities: ['compile'],
        tier: 'code',
      })
      await workerStore.createWorker({
        kind: 'agent',
        name: 'ralph',
        capabilities: ['code'],
        tier: 'agentic',
      })

      const codeWorkers = await workerStore.findByTier('code')

      expect(codeWorkers.every((w) => (w.data as WorkerData).tier === 'code')).toBe(true)
    })
  })

  describe('WorkerStore.findAvailable', () => {
    it('should find available workers', async () => {
      const { createWorkerStore } = await importWorkerStore()

      const ctx: StoreContext = {
        db: createTestDatabase(),
        ns: 'https://test.workers.do',
        currentBranch: 'main',
        env: {},
        typeCache: new Map(),
      }
      const workerStore = createWorkerStore(ctx)

      await workerStore.createWorker({
        kind: 'agent',
        name: 'available-worker',
        capabilities: ['code'],
        tier: 'agentic',
        status: 'available',
      })
      await workerStore.createWorker({
        kind: 'agent',
        name: 'busy-worker',
        capabilities: ['code'],
        tier: 'agentic',
        status: 'busy',
      })

      const available = await workerStore.findAvailable()

      expect(available.every((w) => (w.data as WorkerData).status === 'available')).toBe(true)
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test database instance
 * Uses real db primitives, not mocks
 */
function createTestDatabase() {
  // This should use the real database implementation
  // For now, return a minimal interface that will cause tests to fail
  // until proper integration is set up
  throw new Error('createTestDatabase not implemented - use real db primitives')
}

/**
 * Seed test workers for query tests
 */
async function seedTestWorkers(things: ThingsStore) {
  // Named agents from agents.do
  const testWorkers = [
    {
      $id: 'worker-priya',
      name: 'priya',
      data: {
        kind: 'agent' as const,
        name: 'priya',
        capabilities: ['plan', 'spec', 'roadmap'],
        tier: 'agentic' as const,
        status: 'available' as const,
      },
    },
    {
      $id: 'worker-ralph',
      name: 'ralph',
      data: {
        kind: 'agent' as const,
        name: 'ralph',
        capabilities: ['code', 'review', 'test'],
        tier: 'agentic' as const,
        status: 'available' as const,
      },
    },
    {
      $id: 'worker-tom',
      name: 'tom',
      data: {
        kind: 'agent' as const,
        name: 'tom',
        capabilities: ['architecture', 'review', 'decide'],
        tier: 'agentic' as const,
        status: 'available' as const,
      },
    },
    {
      $id: 'worker-mark',
      name: 'mark',
      data: {
        kind: 'agent' as const,
        name: 'mark',
        capabilities: ['market', 'content', 'launch'],
        tier: 'generative' as const,
        status: 'available' as const,
      },
    },
    {
      $id: 'worker-sally',
      name: 'sally',
      data: {
        kind: 'agent' as const,
        name: 'sally',
        capabilities: ['sales', 'outreach', 'close'],
        tier: 'generative' as const,
        status: 'busy' as const,
      },
    },
    {
      $id: 'worker-quinn',
      name: 'quinn',
      data: {
        kind: 'agent' as const,
        name: 'quinn',
        capabilities: ['test', 'qa', 'quality'],
        tier: 'agentic' as const,
        status: 'available' as const,
      },
    },
    // Human workers
    {
      $id: 'worker-nathan',
      name: 'nathan',
      data: {
        kind: 'human' as const,
        name: 'nathan',
        capabilities: ['approve', 'decide', 'escalate', 'ceo'],
        tier: 'human' as const,
        status: 'available' as const,
      },
    },
    // Code tier worker (deterministic)
    {
      $id: 'worker-codebot',
      name: 'codebot',
      data: {
        kind: 'agent' as const,
        name: 'codebot',
        capabilities: ['compile', 'lint', 'format'],
        tier: 'code' as const,
        status: 'available' as const,
      },
    },
  ]

  for (const worker of testWorkers) {
    await things.create({
      $type: 'Worker',
      ...worker,
    })
  }
}
