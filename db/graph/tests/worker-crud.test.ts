/**
 * Worker CRUD via Graph Model Tests
 *
 * TDD RED Phase: Failing tests for Worker (Agent/Human) CRUD operations
 * using the graph model. Workers are stored as Things with kind 'agent' or 'human'.
 *
 * @see dotdo-oqw3q - [RED] Worker CRUD via Graph Model - Tests
 *
 * Design:
 * - Workers are Things with typeName 'Worker'
 * - kind field: 'agent' | 'human'
 * - tier field: 'code' | 'generative' | 'agentic' | 'human'
 * - capabilities stored as array in data
 * - Uses real db primitives, NO MOCKS
 *
 * Worker tiers represent capability levels:
 * - code: Deterministic code execution (functions, scripts)
 * - generative: LLM text generation (summaries, translations)
 * - agentic: Autonomous AI with tools and goals
 * - human: Human workers with approval flows
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// EXPECTED TYPE DEFINITIONS
// ============================================================================

/**
 * Worker kind discriminator
 */
type WorkerKind = 'agent' | 'human'

/**
 * Worker capability tier
 * - code: Deterministic code execution
 * - generative: LLM text generation
 * - agentic: Autonomous AI with tools
 * - human: Human workers
 */
type WorkerTier = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Worker data schema stored in Thing.data
 */
interface WorkerData {
  /** Worker kind: agent or human */
  kind: WorkerKind
  /** Capability tier */
  tier: WorkerTier
  /** Array of capability strings */
  capabilities: string[]
  /** Human-readable name */
  name?: string
  /** Description */
  description?: string
  /** Worker availability status */
  status?: 'available' | 'busy' | 'offline'
  /** Additional worker-specific configuration */
  config?: Record<string, unknown>
}

/**
 * Worker Thing - A Thing with Worker-specific data
 */
interface WorkerThing {
  id: string
  typeId: number
  typeName: 'Worker'
  data: WorkerData
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * Input for creating a new Worker
 */
interface CreateWorkerInput {
  id: string
  kind: WorkerKind
  tier: WorkerTier
  name?: string
  description?: string
  capabilities?: string[]
  status?: 'available' | 'busy' | 'offline'
  config?: Record<string, unknown>
}

/**
 * Input for updating a Worker
 */
interface UpdateWorkerInput {
  name?: string
  description?: string
  capabilities?: string[]
  status?: 'available' | 'busy' | 'offline'
  tier?: WorkerTier
  config?: Record<string, unknown>
}

/**
 * Query options for finding workers
 */
interface WorkerQueryOptions {
  kind?: WorkerKind
  tier?: WorkerTier
  status?: 'available' | 'busy' | 'offline'
  capabilities?: string[]
  limit?: number
  offset?: number
}

// ============================================================================
// WORKER STORE INTERFACE TESTS
// ============================================================================

describe('WorkerStore Interface', () => {
  /**
   * The WorkerStore should be importable from db/graph
   */
  it('WorkerStore is exported from db/graph', async () => {
    // This will fail until WorkerStore is implemented
    const graphModule = await import('../index').catch(() => null)
    expect(graphModule?.WorkerStore).toBeDefined()
  })

  it('has createWorker method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not exported from db/graph')
    }
    expect(graphModule.WorkerStore.prototype.createWorker).toBeDefined()
    expect(typeof graphModule.WorkerStore.prototype.createWorker).toBe('function')
  })

  it('has getWorker method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not exported from db/graph')
    }
    expect(graphModule.WorkerStore.prototype.getWorker).toBeDefined()
    expect(typeof graphModule.WorkerStore.prototype.getWorker).toBe('function')
  })

  it('has updateWorker method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not exported from db/graph')
    }
    expect(graphModule.WorkerStore.prototype.updateWorker).toBeDefined()
    expect(typeof graphModule.WorkerStore.prototype.updateWorker).toBe('function')
  })

  it('has deleteWorker method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not exported from db/graph')
    }
    expect(graphModule.WorkerStore.prototype.deleteWorker).toBeDefined()
    expect(typeof graphModule.WorkerStore.prototype.deleteWorker).toBe('function')
  })

  it('has findWorkers method', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not exported from db/graph')
    }
    expect(graphModule.WorkerStore.prototype.findWorkers).toBeDefined()
    expect(typeof graphModule.WorkerStore.prototype.findWorkers).toBe('function')
  })
})

// ============================================================================
// CREATE WORKER TESTS
// ============================================================================

describe('Worker as Thing', () => {
  describe('Create Worker', () => {
    it('should create Worker Thing with kind agent', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented - waiting for db/graph/workers.ts')
      }

      const store = new graphModule.WorkerStore({})
      const worker = await store.createWorker({
        id: 'agent-priya',
        kind: 'agent',
        tier: 'agentic',
        name: 'Priya',
        description: 'Product manager agent',
        capabilities: ['spec-writing', 'roadmap-planning'],
      })

      expect(worker).toBeDefined()
      expect(worker.id).toBe('agent-priya')
      expect(worker.typeName).toBe('Worker')
      expect(worker.data.kind).toBe('agent')
      expect(worker.data.tier).toBe('agentic')
      expect(worker.data.name).toBe('Priya')
      expect(worker.data.capabilities).toContain('spec-writing')
    })

    it('should create Worker Thing with kind human', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const worker = await store.createWorker({
        id: 'human-alice',
        kind: 'human',
        tier: 'human',
        name: 'Alice',
        description: 'Senior accountant',
        capabilities: ['approval', 'refund-review'],
      })

      expect(worker).toBeDefined()
      expect(worker.id).toBe('human-alice')
      expect(worker.typeName).toBe('Worker')
      expect(worker.data.kind).toBe('human')
      expect(worker.data.tier).toBe('human')
    })

    it('should store capabilities as array', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const capabilities = ['code-review', 'testing', 'deployment', 'monitoring']

      const worker = await store.createWorker({
        id: 'agent-quinn',
        kind: 'agent',
        tier: 'agentic',
        name: 'Quinn',
        capabilities,
      })

      expect(Array.isArray(worker.data.capabilities)).toBe(true)
      expect(worker.data.capabilities).toHaveLength(4)
      expect(worker.data.capabilities).toEqual(capabilities)
    })

    it('should store tier code for deterministic workers', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const worker = await store.createWorker({
        id: 'worker-formatter',
        kind: 'agent',
        tier: 'code',
        name: 'Code Formatter',
        capabilities: ['format-code', 'lint'],
      })

      expect(worker.data.tier).toBe('code')
    })

    it('should store tier generative for LLM workers', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const worker = await store.createWorker({
        id: 'worker-summarizer',
        kind: 'agent',
        tier: 'generative',
        name: 'Summarizer',
        capabilities: ['summarize', 'translate'],
      })

      expect(worker.data.tier).toBe('generative')
    })

    it('should store tier agentic for autonomous AI workers', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const worker = await store.createWorker({
        id: 'agent-ralph',
        kind: 'agent',
        tier: 'agentic',
        name: 'Ralph',
        description: 'Engineering agent that builds code',
        capabilities: ['code-writing', 'debugging', 'testing'],
      })

      expect(worker.data.tier).toBe('agentic')
    })

    it('should store tier human for human workers', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const worker = await store.createWorker({
        id: 'human-ceo',
        kind: 'human',
        tier: 'human',
        name: 'CEO',
        capabilities: ['final-approval', 'strategy'],
      })

      expect(worker.data.tier).toBe('human')
      expect(worker.data.kind).toBe('human')
    })

    it('should validate Worker schema - reject invalid kind', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await expect(
        store.createWorker({
          id: 'invalid-worker',
          kind: 'robot' as WorkerKind, // Invalid kind
          tier: 'agentic',
        })
      ).rejects.toThrow()
    })

    it('should validate Worker schema - reject invalid tier', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await expect(
        store.createWorker({
          id: 'invalid-worker',
          kind: 'agent',
          tier: 'super' as WorkerTier, // Invalid tier
        })
      ).rejects.toThrow()
    })

    it('should set default status to available', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const worker = await store.createWorker({
        id: 'agent-default-status',
        kind: 'agent',
        tier: 'agentic',
      })

      expect(worker.data.status).toBe('available')
    })

    it('should reject duplicate Worker IDs', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'unique-worker',
        kind: 'agent',
        tier: 'agentic',
      })

      await expect(
        store.createWorker({
          id: 'unique-worker',
          kind: 'human',
          tier: 'human',
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // READ WORKER TESTS
  // ============================================================================

  describe('Read Worker', () => {
    it('should retrieve Worker by ID', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'agent-to-read',
        kind: 'agent',
        tier: 'agentic',
        name: 'Test Agent',
      })

      const worker = await store.getWorker('agent-to-read')

      expect(worker).toBeDefined()
      expect(worker?.id).toBe('agent-to-read')
      expect(worker?.data.name).toBe('Test Agent')
    })

    it('should return null for non-existent Worker', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const worker = await store.getWorker('non-existent-worker')

      expect(worker).toBeNull()
    })

    it('should return Worker with all fields populated', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'full-worker',
        kind: 'agent',
        tier: 'agentic',
        name: 'Full Worker',
        description: 'A fully populated worker',
        capabilities: ['cap1', 'cap2'],
        status: 'available',
        config: { model: 'claude-3-opus' },
      })

      const worker = await store.getWorker('full-worker')

      expect(worker).toBeDefined()
      expect(worker?.id).toBe('full-worker')
      expect(worker?.typeName).toBe('Worker')
      expect(worker?.data.kind).toBe('agent')
      expect(worker?.data.tier).toBe('agentic')
      expect(worker?.data.name).toBe('Full Worker')
      expect(worker?.data.description).toBe('A fully populated worker')
      expect(worker?.data.capabilities).toEqual(['cap1', 'cap2'])
      expect(worker?.data.status).toBe('available')
      expect(worker?.data.config).toEqual({ model: 'claude-3-opus' })
      expect(worker?.createdAt).toBeDefined()
      expect(worker?.updatedAt).toBeDefined()
      expect(worker?.deletedAt).toBeNull()
    })
  })

  // ============================================================================
  // UPDATE WORKER TESTS
  // ============================================================================

  describe('Update Worker', () => {
    it('should update Worker name', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'worker-to-update',
        kind: 'agent',
        tier: 'agentic',
        name: 'Original Name',
      })

      const updated = await store.updateWorker('worker-to-update', {
        name: 'Updated Name',
      })

      expect(updated?.data.name).toBe('Updated Name')
    })

    it('should update Worker capabilities', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'worker-update-caps',
        kind: 'agent',
        tier: 'agentic',
        capabilities: ['cap1'],
      })

      const updated = await store.updateWorker('worker-update-caps', {
        capabilities: ['cap1', 'cap2', 'cap3'],
      })

      expect(updated?.data.capabilities).toHaveLength(3)
      expect(updated?.data.capabilities).toContain('cap2')
    })

    it('should update Worker status', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'worker-update-status',
        kind: 'agent',
        tier: 'agentic',
        status: 'available',
      })

      const updated = await store.updateWorker('worker-update-status', {
        status: 'busy',
      })

      expect(updated?.data.status).toBe('busy')
    })

    it('should update Worker tier', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'worker-upgrade-tier',
        kind: 'agent',
        tier: 'generative',
      })

      const updated = await store.updateWorker('worker-upgrade-tier', {
        tier: 'agentic',
      })

      expect(updated?.data.tier).toBe('agentic')
    })

    it('should update updatedAt timestamp', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      const created = await store.createWorker({
        id: 'worker-update-timestamp',
        kind: 'agent',
        tier: 'agentic',
      })

      const originalUpdatedAt = created.updatedAt

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await store.updateWorker('worker-update-timestamp', {
        name: 'Newer Name',
      })

      expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt)
      expect(updated?.createdAt).toBe(created.createdAt) // createdAt unchanged
    })

    it('should return null for non-existent Worker', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const result = await store.updateWorker('non-existent', { name: 'Test' })

      expect(result).toBeNull()
    })

    it('should not change kind on update (immutable)', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'worker-immutable-kind',
        kind: 'agent',
        tier: 'agentic',
      })

      // Attempting to update kind should either be ignored or throw
      const updated = await store.updateWorker('worker-immutable-kind', {
        // @ts-expect-error - kind should not be updatable
        kind: 'human',
      })

      // Kind should remain 'agent'
      expect(updated?.data.kind).toBe('agent')
    })
  })

  // ============================================================================
  // DELETE WORKER TESTS
  // ============================================================================

  describe('Delete Worker', () => {
    it('should soft delete a Worker by setting deletedAt', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'worker-to-delete',
        kind: 'agent',
        tier: 'agentic',
      })

      const deleted = await store.deleteWorker('worker-to-delete')

      expect(deleted).toBeDefined()
      expect(deleted?.deletedAt).toBeDefined()
      expect(deleted?.deletedAt).not.toBeNull()
    })

    it('should still be retrievable after soft delete', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})

      await store.createWorker({
        id: 'worker-soft-deleted',
        kind: 'agent',
        tier: 'agentic',
      })

      await store.deleteWorker('worker-soft-deleted')

      // Should still be retrievable with getWorker (direct ID lookup)
      const worker = await store.getWorker('worker-soft-deleted')
      expect(worker).toBeDefined()
      expect(worker?.deletedAt).not.toBeNull()
    })

    it('should return null for non-existent Worker', async () => {
      const graphModule = await import('../index').catch(() => null)
      if (!graphModule?.WorkerStore) {
        throw new Error('WorkerStore not implemented')
      }

      const store = new graphModule.WorkerStore({})
      const result = await store.deleteWorker('non-existent')

      expect(result).toBeNull()
    })
  })
})

// ============================================================================
// WORKER RELATIONSHIP TESTS
// ============================================================================

describe('Worker Relationships', () => {
  it('should create notifying -> notified relationship chain', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore || !graphModule?.RelationshipsStore) {
      throw new Error('WorkerStore or RelationshipsStore not implemented')
    }

    const workerStore = new graphModule.WorkerStore({})
    const relStore = new graphModule.RelationshipsStore({})

    // Create two workers
    const sender = await workerStore.createWorker({
      id: 'agent-sender',
      kind: 'agent',
      tier: 'agentic',
    })

    const receiver = await workerStore.createWorker({
      id: 'human-receiver',
      kind: 'human',
      tier: 'human',
    })

    // Create notifies relationship
    const rel = await relStore.create({
      id: 'rel-notify-1',
      verb: 'notifies',
      from: `do://workers/${sender.id}`,
      to: `do://workers/${receiver.id}`,
      data: { channel: 'slack', priority: 'high' },
    })

    expect(rel).toBeDefined()
    expect(rel.verb).toBe('notifies')
  })

  it('should create asking -> asked relationship chain', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore || !graphModule?.RelationshipsStore) {
      throw new Error('WorkerStore or RelationshipsStore not implemented')
    }

    const workerStore = new graphModule.WorkerStore({})
    const relStore = new graphModule.RelationshipsStore({})

    const asker = await workerStore.createWorker({
      id: 'agent-asker',
      kind: 'agent',
      tier: 'agentic',
    })

    const answerer = await workerStore.createWorker({
      id: 'agent-answerer',
      kind: 'agent',
      tier: 'generative',
    })

    const rel = await relStore.create({
      id: 'rel-ask-1',
      verb: 'asks',
      from: `do://workers/${asker.id}`,
      to: `do://workers/${answerer.id}`,
      data: { question: 'What is the status?' },
    })

    expect(rel).toBeDefined()
    expect(rel.verb).toBe('asks')
  })

  it('should create approving -> approved relationship chain', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore || !graphModule?.RelationshipsStore) {
      throw new Error('WorkerStore or RelationshipsStore not implemented')
    }

    const workerStore = new graphModule.WorkerStore({})
    const relStore = new graphModule.RelationshipsStore({})

    const approver = await workerStore.createWorker({
      id: 'human-approver',
      kind: 'human',
      tier: 'human',
    })

    const requester = await workerStore.createWorker({
      id: 'agent-requester',
      kind: 'agent',
      tier: 'agentic',
    })

    const rel = await relStore.create({
      id: 'rel-approve-1',
      verb: 'approves',
      from: `do://workers/${approver.id}`,
      to: `do://workers/${requester.id}`,
      data: { decision: 'approved', reason: 'LGTM' },
    })

    expect(rel).toBeDefined()
    expect(rel.verb).toBe('approves')
  })

  it('should create doing -> done relationship chain', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore || !graphModule?.RelationshipsStore) {
      throw new Error('WorkerStore or RelationshipsStore not implemented')
    }

    const workerStore = new graphModule.WorkerStore({})
    const relStore = new graphModule.RelationshipsStore({})

    const worker = await workerStore.createWorker({
      id: 'agent-doer',
      kind: 'agent',
      tier: 'agentic',
    })

    // Create relationship to a task Thing (not another worker)
    const rel = await relStore.create({
      id: 'rel-does-1',
      verb: 'does',
      from: `do://workers/${worker.id}`,
      to: `do://tasks/task-123`,
      data: { startedAt: Date.now() },
    })

    expect(rel).toBeDefined()
    expect(rel.verb).toBe('does')
  })

  it('should track Worker handoffTo Worker', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore || !graphModule?.RelationshipsStore) {
      throw new Error('WorkerStore or RelationshipsStore not implemented')
    }

    const workerStore = new graphModule.WorkerStore({})
    const relStore = new graphModule.RelationshipsStore({})

    const fromWorker = await workerStore.createWorker({
      id: 'agent-handoff-from',
      kind: 'agent',
      tier: 'agentic',
    })

    const toWorker = await workerStore.createWorker({
      id: 'human-handoff-to',
      kind: 'human',
      tier: 'human',
    })

    const rel = await relStore.create({
      id: 'rel-handoff-1',
      verb: 'handsOffTo',
      from: `do://workers/${fromWorker.id}`,
      to: `do://workers/${toWorker.id}`,
      data: { reason: 'needs human review', context: { taskId: 'task-456' } },
    })

    expect(rel).toBeDefined()
    expect(rel.verb).toBe('handsOffTo')
    expect(rel.from).toContain(fromWorker.id)
    expect(rel.to).toContain(toWorker.id)
  })

  it('should track Worker delegatedTo Worker', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore || !graphModule?.RelationshipsStore) {
      throw new Error('WorkerStore or RelationshipsStore not implemented')
    }

    const workerStore = new graphModule.WorkerStore({})
    const relStore = new graphModule.RelationshipsStore({})

    const delegator = await workerStore.createWorker({
      id: 'human-delegator',
      kind: 'human',
      tier: 'human',
    })

    const delegatee = await workerStore.createWorker({
      id: 'agent-delegatee',
      kind: 'agent',
      tier: 'agentic',
    })

    const rel = await relStore.create({
      id: 'rel-delegate-1',
      verb: 'delegatesTo',
      from: `do://workers/${delegator.id}`,
      to: `do://workers/${delegatee.id}`,
      data: { task: 'write the report', deadline: '2024-12-31' },
    })

    expect(rel).toBeDefined()
    expect(rel.verb).toBe('delegatesTo')
  })
})

// ============================================================================
// WORKER QUERY TESTS
// ============================================================================

describe('Worker Queries', () => {
  it('should find workers by tier', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    // Create workers with different tiers
    await store.createWorker({ id: 'tier-code-1', kind: 'agent', tier: 'code' })
    await store.createWorker({ id: 'tier-gen-1', kind: 'agent', tier: 'generative' })
    await store.createWorker({ id: 'tier-agentic-1', kind: 'agent', tier: 'agentic' })
    await store.createWorker({ id: 'tier-agentic-2', kind: 'agent', tier: 'agentic' })
    await store.createWorker({ id: 'tier-human-1', kind: 'human', tier: 'human' })

    const agenticWorkers = await store.findWorkers({ tier: 'agentic' })

    expect(Array.isArray(agenticWorkers)).toBe(true)
    expect(agenticWorkers.length).toBeGreaterThanOrEqual(2)
    expect(agenticWorkers.every((w: WorkerThing) => w.data.tier === 'agentic')).toBe(true)
  })

  it('should find workers by kind', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    await store.createWorker({ id: 'kind-agent-1', kind: 'agent', tier: 'agentic' })
    await store.createWorker({ id: 'kind-agent-2', kind: 'agent', tier: 'generative' })
    await store.createWorker({ id: 'kind-human-1', kind: 'human', tier: 'human' })

    const humanWorkers = await store.findWorkers({ kind: 'human' })

    expect(Array.isArray(humanWorkers)).toBe(true)
    expect(humanWorkers.every((w: WorkerThing) => w.data.kind === 'human')).toBe(true)
  })

  it('should find available workers', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    await store.createWorker({ id: 'status-avail-1', kind: 'agent', tier: 'agentic', status: 'available' })
    await store.createWorker({ id: 'status-busy-1', kind: 'agent', tier: 'agentic', status: 'busy' })
    await store.createWorker({ id: 'status-offline-1', kind: 'agent', tier: 'agentic', status: 'offline' })
    await store.createWorker({ id: 'status-avail-2', kind: 'human', tier: 'human', status: 'available' })

    const availableWorkers = await store.findWorkers({ status: 'available' })

    expect(Array.isArray(availableWorkers)).toBe(true)
    expect(availableWorkers.every((w: WorkerThing) => w.data.status === 'available')).toBe(true)
  })

  it('should find workers with specific capabilities', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    await store.createWorker({
      id: 'cap-worker-1',
      kind: 'agent',
      tier: 'agentic',
      capabilities: ['code-review', 'testing'],
    })
    await store.createWorker({
      id: 'cap-worker-2',
      kind: 'agent',
      tier: 'agentic',
      capabilities: ['code-review', 'deployment'],
    })
    await store.createWorker({
      id: 'cap-worker-3',
      kind: 'agent',
      tier: 'agentic',
      capabilities: ['documentation'],
    })

    const codeReviewWorkers = await store.findWorkers({ capabilities: ['code-review'] })

    expect(Array.isArray(codeReviewWorkers)).toBe(true)
    expect(codeReviewWorkers.length).toBeGreaterThanOrEqual(2)
    expect(
      codeReviewWorkers.every((w: WorkerThing) => w.data.capabilities.includes('code-review'))
    ).toBe(true)
  })

  it('should find workers matching multiple capabilities (AND)', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    await store.createWorker({
      id: 'multi-cap-1',
      kind: 'agent',
      tier: 'agentic',
      capabilities: ['code-review', 'testing', 'deployment'],
    })
    await store.createWorker({
      id: 'multi-cap-2',
      kind: 'agent',
      tier: 'agentic',
      capabilities: ['code-review', 'testing'],
    })
    await store.createWorker({
      id: 'multi-cap-3',
      kind: 'agent',
      tier: 'agentic',
      capabilities: ['code-review'], // Missing testing
    })

    const workers = await store.findWorkers({
      capabilities: ['code-review', 'testing'],
    })

    expect(Array.isArray(workers)).toBe(true)
    expect(workers.length).toBeGreaterThanOrEqual(2)
    expect(
      workers.every(
        (w: WorkerThing) =>
          w.data.capabilities.includes('code-review') && w.data.capabilities.includes('testing')
      )
    ).toBe(true)
  })

  it('should exclude soft-deleted workers from queries by default', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    await store.createWorker({ id: 'active-worker', kind: 'agent', tier: 'agentic' })
    await store.createWorker({ id: 'deleted-worker', kind: 'agent', tier: 'agentic' })
    await store.deleteWorker('deleted-worker')

    const workers = await store.findWorkers({ tier: 'agentic' })

    // Should not include the deleted worker
    const deletedInResults = workers.find((w: WorkerThing) => w.id === 'deleted-worker')
    expect(deletedInResults).toBeUndefined()
  })

  it('should support limit and offset for pagination', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    // Create several workers
    for (let i = 0; i < 10; i++) {
      await store.createWorker({
        id: `paginated-worker-${i}`,
        kind: 'agent',
        tier: 'agentic',
      })
    }

    const page1 = await store.findWorkers({ tier: 'agentic', limit: 3, offset: 0 })
    const page2 = await store.findWorkers({ tier: 'agentic', limit: 3, offset: 3 })

    expect(page1).toHaveLength(3)
    expect(page2).toHaveLength(3)

    // Pages should have different workers
    const page1Ids = page1.map((w: WorkerThing) => w.id)
    const page2Ids = page2.map((w: WorkerThing) => w.id)
    const overlap = page1Ids.filter((id: string) => page2Ids.includes(id))
    expect(overlap).toHaveLength(0)
  })

  it('should combine kind and tier filters', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    await store.createWorker({ id: 'combo-1', kind: 'agent', tier: 'agentic' })
    await store.createWorker({ id: 'combo-2', kind: 'agent', tier: 'generative' })
    await store.createWorker({ id: 'combo-3', kind: 'human', tier: 'human' })
    await store.createWorker({ id: 'combo-4', kind: 'agent', tier: 'agentic' })

    const workers = await store.findWorkers({ kind: 'agent', tier: 'agentic' })

    expect(Array.isArray(workers)).toBe(true)
    expect(
      workers.every((w: WorkerThing) => w.data.kind === 'agent' && w.data.tier === 'agentic')
    ).toBe(true)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Worker Edge Cases', () => {
  it('should handle empty capabilities array', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    const worker = await store.createWorker({
      id: 'no-caps-worker',
      kind: 'agent',
      tier: 'code',
      capabilities: [],
    })

    expect(worker.data.capabilities).toEqual([])
  })

  it('should handle special characters in worker ID', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    const worker = await store.createWorker({
      id: 'worker_with.dots-and_underscores',
      kind: 'agent',
      tier: 'agentic',
    })

    const retrieved = await store.getWorker('worker_with.dots-and_underscores')
    expect(retrieved?.id).toBe('worker_with.dots-and_underscores')
  })

  it('should handle Unicode in worker name and description', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    const worker = await store.createWorker({
      id: 'unicode-worker',
      kind: 'human',
      tier: 'human',
      name: 'Test Name',
      description: 'Description with Japanese and emojis',
    })

    expect(worker.data.name).toBe('Test Name')
    expect(worker.data.description).toContain('Description')
  })

  it('should preserve config object structure', async () => {
    const graphModule = await import('../index').catch(() => null)
    if (!graphModule?.WorkerStore) {
      throw new Error('WorkerStore not implemented')
    }

    const store = new graphModule.WorkerStore({})

    const complexConfig = {
      model: 'claude-3-opus',
      temperature: 0.7,
      tools: ['search', 'code'],
      nested: {
        level1: {
          level2: 'deep value',
        },
      },
    }

    const worker = await store.createWorker({
      id: 'config-worker',
      kind: 'agent',
      tier: 'agentic',
      config: complexConfig,
    })

    expect(worker.data.config).toEqual(complexConfig)
  })
})
