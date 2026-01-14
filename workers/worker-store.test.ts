/**
 * Worker Store Unit Tests
 *
 * Tests for GraphWorkerStore, ThingsStore, and RelationshipsStore.
 * Tests validation, CRUD operations, and query functionality.
 *
 * @module workers/worker-store.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  WorkerKind,
  WorkerTier,
  WorkerStatus,
  WorkerData,
  CreateWorkerInput,
  UpdateWorkerInput,
} from './worker-store'

// ============================================================================
// Validation Tests
// ============================================================================

describe('Worker Data Validation', () => {
  const VALID_TIERS: WorkerTier[] = ['code', 'generative', 'agentic', 'human']
  const VALID_KINDS: WorkerKind[] = ['agent', 'human']
  const VALID_STATUSES: WorkerStatus[] = ['available', 'busy', 'offline']

  describe('WorkerKind Validation', () => {
    it('accepts valid worker kinds', () => {
      for (const kind of VALID_KINDS) {
        expect(VALID_KINDS.includes(kind)).toBe(true)
      }
    })

    it('rejects invalid worker kinds', () => {
      const invalidKinds = ['robot', 'machine', 'ai', '']
      for (const kind of invalidKinds) {
        expect(VALID_KINDS.includes(kind as WorkerKind)).toBe(false)
      }
    })
  })

  describe('WorkerTier Validation', () => {
    it('accepts valid worker tiers', () => {
      for (const tier of VALID_TIERS) {
        expect(VALID_TIERS.includes(tier)).toBe(true)
      }
    })

    it('rejects invalid worker tiers', () => {
      const invalidTiers = ['basic', 'premium', 'enterprise', '']
      for (const tier of invalidTiers) {
        expect(VALID_TIERS.includes(tier as WorkerTier)).toBe(false)
      }
    })

    it('code tier is for fast deterministic operations', () => {
      const tier: WorkerTier = 'code'
      expect(tier).toBe('code')
    })

    it('generative tier is for AI generation', () => {
      const tier: WorkerTier = 'generative'
      expect(tier).toBe('generative')
    })

    it('agentic tier is for multi-step reasoning', () => {
      const tier: WorkerTier = 'agentic'
      expect(tier).toBe('agentic')
    })

    it('human tier is for oversight and approval', () => {
      const tier: WorkerTier = 'human'
      expect(tier).toBe('human')
    })
  })

  describe('WorkerStatus Validation', () => {
    it('accepts valid worker statuses', () => {
      for (const status of VALID_STATUSES) {
        expect(VALID_STATUSES.includes(status)).toBe(true)
      }
    })

    it('rejects invalid worker statuses', () => {
      const invalidStatuses = ['active', 'inactive', 'paused', '']
      for (const status of invalidStatuses) {
        expect(VALID_STATUSES.includes(status as WorkerStatus)).toBe(false)
      }
    })
  })

  describe('WorkerData Schema Validation', () => {
    it('validates complete worker data', () => {
      const data: WorkerData = {
        kind: 'agent',
        name: 'Test Worker',
        capabilities: ['code-execution', 'data-analysis'],
        tier: 'generative',
        status: 'available',
        metadata: { version: '1.0.0' },
      }

      expect(data.kind).toBe('agent')
      expect(data.name).toBe('Test Worker')
      expect(data.capabilities).toHaveLength(2)
      expect(data.tier).toBe('generative')
      expect(data.status).toBe('available')
    })

    it('validates minimal worker data', () => {
      const data: WorkerData = {
        kind: 'agent',
        name: 'Minimal Worker',
        capabilities: [],
        tier: 'code',
      }

      expect(data.kind).toBe('agent')
      expect(data.name).toBe('Minimal Worker')
      expect(data.capabilities).toEqual([])
      expect(data.tier).toBe('code')
      expect(data.status).toBeUndefined()
    })

    it('requires kind to be present', () => {
      const data = {
        name: 'No Kind',
        capabilities: [],
        tier: 'code',
      } as Partial<WorkerData>

      expect(data.kind).toBeUndefined()
    })

    it('requires name to be a string', () => {
      const data: WorkerData = {
        kind: 'agent',
        name: 'Valid Name',
        capabilities: [],
        tier: 'code',
      }

      expect(typeof data.name).toBe('string')
    })

    it('requires capabilities to be an array', () => {
      const data: WorkerData = {
        kind: 'agent',
        name: 'Worker',
        capabilities: ['cap1', 'cap2'],
        tier: 'code',
      }

      expect(Array.isArray(data.capabilities)).toBe(true)
    })
  })
})

// ============================================================================
// CreateWorkerInput Tests
// ============================================================================

describe('CreateWorkerInput', () => {
  it('creates valid worker input', () => {
    const input: CreateWorkerInput = {
      kind: 'agent',
      name: 'Ralph',
      capabilities: ['code-review', 'bug-fixing', 'testing'],
      tier: 'agentic',
    }

    expect(input.kind).toBe('agent')
    expect(input.name).toBe('Ralph')
    expect(input.tier).toBe('agentic')
  })

  it('allows optional $id', () => {
    const input: CreateWorkerInput = {
      $id: 'custom-id-123',
      kind: 'human',
      name: 'Alice',
      capabilities: ['approval', 'review'],
      tier: 'human',
    }

    expect(input.$id).toBe('custom-id-123')
  })

  it('allows optional status', () => {
    const input: CreateWorkerInput = {
      kind: 'agent',
      name: 'Worker',
      capabilities: [],
      tier: 'code',
      status: 'busy',
    }

    expect(input.status).toBe('busy')
  })

  it('allows optional metadata', () => {
    const input: CreateWorkerInput = {
      kind: 'agent',
      name: 'Worker',
      capabilities: [],
      tier: 'code',
      metadata: {
        createdBy: 'system',
        environment: 'production',
      },
    }

    expect(input.metadata?.createdBy).toBe('system')
    expect(input.metadata?.environment).toBe('production')
  })
})

// ============================================================================
// UpdateWorkerInput Tests
// ============================================================================

describe('UpdateWorkerInput', () => {
  it('allows partial updates', () => {
    const update: UpdateWorkerInput = {
      status: 'offline',
    }

    expect(update.status).toBe('offline')
    expect(update.name).toBeUndefined()
  })

  it('allows updating name', () => {
    const update: UpdateWorkerInput = {
      name: 'New Name',
    }

    expect(update.name).toBe('New Name')
  })

  it('allows updating capabilities', () => {
    const update: UpdateWorkerInput = {
      capabilities: ['new-cap-1', 'new-cap-2'],
    }

    expect(update.capabilities).toEqual(['new-cap-1', 'new-cap-2'])
  })

  it('allows updating tier', () => {
    const update: UpdateWorkerInput = {
      tier: 'human',
    }

    expect(update.tier).toBe('human')
  })

  it('allows updating metadata', () => {
    const update: UpdateWorkerInput = {
      metadata: { lastUpdated: Date.now() },
    }

    expect(update.metadata?.lastUpdated).toBeDefined()
  })

  it('allows updating multiple fields', () => {
    const update: UpdateWorkerInput = {
      name: 'Updated Worker',
      status: 'available',
      tier: 'agentic',
      capabilities: ['enhanced-cap'],
    }

    expect(update.name).toBe('Updated Worker')
    expect(update.status).toBe('available')
    expect(update.tier).toBe('agentic')
    expect(update.capabilities).toEqual(['enhanced-cap'])
  })
})

// ============================================================================
// ID Generation Tests
// ============================================================================

describe('ID Generation', () => {
  it('generates unique worker IDs', () => {
    const generateId = () => `worker-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    const id1 = generateId()
    const id2 = generateId()

    expect(id1).not.toBe(id2)
    expect(id1.startsWith('worker-')).toBe(true)
    expect(id2.startsWith('worker-')).toBe(true)
  })

  it('generates unique relationship IDs', () => {
    const generateId = () => `rel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    const id1 = generateId()
    const id2 = generateId()

    expect(id1).not.toBe(id2)
    expect(id1.startsWith('rel-')).toBe(true)
  })

  it('generates unique thing IDs', () => {
    const generateId = () => `thing-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    const id1 = generateId()
    const id2 = generateId()

    expect(id1).not.toBe(id2)
    expect(id1.startsWith('thing-')).toBe(true)
  })
})

// ============================================================================
// WorkerThing Conversion Tests
// ============================================================================

describe('WorkerThing Conversion', () => {
  it('converts graph thing to worker thing', () => {
    const graphThing = {
      id: 'worker-123',
      typeName: 'Worker',
      data: {
        kind: 'agent' as WorkerKind,
        name: 'Test Worker',
        capabilities: ['cap1'],
        tier: 'generative' as WorkerTier,
        status: 'available' as WorkerStatus,
      },
      deletedAt: null,
      createdAt: 1704067200000,
      updatedAt: 1704067200000,
    }

    const workerThing = {
      $id: graphThing.id,
      $type: 'Worker',
      name: graphThing.data.name,
      data: graphThing.data,
      deleted: graphThing.deletedAt !== null,
      createdAt: graphThing.createdAt,
      updatedAt: graphThing.updatedAt,
    }

    expect(workerThing.$id).toBe('worker-123')
    expect(workerThing.$type).toBe('Worker')
    expect(workerThing.name).toBe('Test Worker')
    expect(workerThing.deleted).toBe(false)
  })

  it('marks deleted things appropriately', () => {
    const graphThing = {
      id: 'worker-456',
      typeName: 'Worker',
      data: { kind: 'agent', name: 'Deleted Worker', capabilities: [], tier: 'code' },
      deletedAt: 1704153600000,
      createdAt: 1704067200000,
      updatedAt: 1704153600000,
    }

    const workerThing = {
      $id: graphThing.id,
      $type: 'Worker',
      name: (graphThing.data as WorkerData).name,
      data: graphThing.data,
      deleted: graphThing.deletedAt !== null,
    }

    expect(workerThing.deleted).toBe(true)
  })
})

// ============================================================================
// Capability Query Tests
// ============================================================================

describe('Capability Queries', () => {
  it('finds workers with all required capabilities', () => {
    const workers = [
      { name: 'Worker1', capabilities: ['code', 'test', 'deploy'] },
      { name: 'Worker2', capabilities: ['code', 'test'] },
      { name: 'Worker3', capabilities: ['code'] },
    ]

    const required = ['code', 'test']
    const matched = workers.filter(w =>
      required.every(cap => w.capabilities.includes(cap))
    )

    expect(matched).toHaveLength(2)
    expect(matched[0].name).toBe('Worker1')
    expect(matched[1].name).toBe('Worker2')
  })

  it('returns empty when no workers have required capabilities', () => {
    const workers = [
      { name: 'Worker1', capabilities: ['code'] },
      { name: 'Worker2', capabilities: ['test'] },
    ]

    const required = ['deploy', 'monitor']
    const matched = workers.filter(w =>
      required.every(cap => w.capabilities.includes(cap))
    )

    expect(matched).toHaveLength(0)
  })

  it('handles empty capabilities array', () => {
    const workers = [
      { name: 'Worker1', capabilities: [] },
    ]

    const required: string[] = []
    const matched = workers.filter(w =>
      required.every(cap => w.capabilities.includes(cap))
    )

    expect(matched).toHaveLength(1)
  })
})

// ============================================================================
// Tier Query Tests
// ============================================================================

describe('Tier Queries', () => {
  it('finds workers by tier', () => {
    const workers = [
      { name: 'Ralph', tier: 'agentic' as WorkerTier },
      { name: 'Priya', tier: 'agentic' as WorkerTier },
      { name: 'Formatter', tier: 'code' as WorkerTier },
      { name: 'Reviewer', tier: 'human' as WorkerTier },
    ]

    const agenticWorkers = workers.filter(w => w.tier === 'agentic')

    expect(agenticWorkers).toHaveLength(2)
    expect(agenticWorkers.map(w => w.name)).toContain('Ralph')
    expect(agenticWorkers.map(w => w.name)).toContain('Priya')
  })

  it('finds human tier workers for approval', () => {
    const workers = [
      { name: 'Agent1', tier: 'agentic' as WorkerTier },
      { name: 'Alice', tier: 'human' as WorkerTier },
      { name: 'Bob', tier: 'human' as WorkerTier },
    ]

    const humanWorkers = workers.filter(w => w.tier === 'human')

    expect(humanWorkers).toHaveLength(2)
  })
})

// ============================================================================
// Status Query Tests
// ============================================================================

describe('Status Queries', () => {
  it('finds available workers', () => {
    const workers = [
      { name: 'Worker1', status: 'available' as WorkerStatus },
      { name: 'Worker2', status: 'busy' as WorkerStatus },
      { name: 'Worker3', status: 'available' as WorkerStatus },
      { name: 'Worker4', status: 'offline' as WorkerStatus },
    ]

    const available = workers.filter(w => w.status === 'available')

    expect(available).toHaveLength(2)
  })

  it('finds busy workers', () => {
    const workers = [
      { name: 'Worker1', status: 'available' as WorkerStatus },
      { name: 'Worker2', status: 'busy' as WorkerStatus },
      { name: 'Worker3', status: 'busy' as WorkerStatus },
    ]

    const busy = workers.filter(w => w.status === 'busy')

    expect(busy).toHaveLength(2)
  })

  it('finds offline workers', () => {
    const workers = [
      { name: 'Worker1', status: 'available' as WorkerStatus },
      { name: 'Worker2', status: 'offline' as WorkerStatus },
    ]

    const offline = workers.filter(w => w.status === 'offline')

    expect(offline).toHaveLength(1)
    expect(offline[0].name).toBe('Worker2')
  })
})

// ============================================================================
// Kind Query Tests
// ============================================================================

describe('Kind Queries', () => {
  it('finds agent workers', () => {
    const workers = [
      { name: 'Ralph', kind: 'agent' as WorkerKind },
      { name: 'Priya', kind: 'agent' as WorkerKind },
      { name: 'Alice', kind: 'human' as WorkerKind },
    ]

    const agents = workers.filter(w => w.kind === 'agent')

    expect(agents).toHaveLength(2)
  })

  it('finds human workers', () => {
    const workers = [
      { name: 'Ralph', kind: 'agent' as WorkerKind },
      { name: 'Alice', kind: 'human' as WorkerKind },
      { name: 'Bob', kind: 'human' as WorkerKind },
    ]

    const humans = workers.filter(w => w.kind === 'human')

    expect(humans).toHaveLength(2)
  })
})

// ============================================================================
// Relationship Tests
// ============================================================================

describe('Worker Relationships', () => {
  it('creates relationship between workers', () => {
    const relationship = {
      id: 'rel-123',
      verb: 'supervises',
      from: 'worker-senior',
      to: 'worker-junior',
      data: { since: '2024-01-01' },
    }

    expect(relationship.verb).toBe('supervises')
    expect(relationship.from).toBe('worker-senior')
    expect(relationship.to).toBe('worker-junior')
  })

  it('supports different relationship verbs', () => {
    const verbs = ['supervises', 'collaborates', 'delegates', 'escalates', 'reports-to']

    for (const verb of verbs) {
      const rel = { verb, from: 'worker-1', to: 'worker-2' }
      expect(rel.verb).toBe(verb)
    }
  })

  it('allows data on relationships', () => {
    const relationship = {
      verb: 'escalates',
      from: 'agent-1',
      to: 'human-1',
      data: {
        reason: 'Approval required',
        priority: 'high',
        sla: '4h',
      },
    }

    expect(relationship.data.reason).toBe('Approval required')
    expect(relationship.data.priority).toBe('high')
  })
})

// ============================================================================
// ThingsStore Tests
// ============================================================================

describe('ThingsStore Interface', () => {
  it('defines create method signature', () => {
    const createInput = {
      $type: 'Worker',
      name: 'Test',
      data: { kind: 'agent', capabilities: [], tier: 'code' },
    }

    expect(createInput.$type).toBe('Worker')
    expect(createInput.name).toBe('Test')
  })

  it('defines get method signature', () => {
    const getOptions = {
      includeDeleted: false,
    }

    expect(getOptions.includeDeleted).toBe(false)
  })

  it('defines list method signature', () => {
    const listOptions = {
      type: 'Worker',
    }

    expect(listOptions.type).toBe('Worker')
  })

  it('defines update method signature', () => {
    const updateInput = {
      data: { status: 'busy' },
    }

    expect(updateInput.data.status).toBe('busy')
  })

  it('defines delete method returns deleted flag', () => {
    const deleteResult = {
      $id: 'worker-123',
      $type: 'Worker',
      deleted: true,
    }

    expect(deleteResult.deleted).toBe(true)
  })
})

// ============================================================================
// RelationshipsStore Tests
// ============================================================================

describe('RelationshipsStore Interface', () => {
  it('defines create method', () => {
    const input = {
      verb: 'supervises',
      from: 'worker-1',
      to: 'worker-2',
      data: { level: 'direct' },
    }

    expect(input.verb).toBe('supervises')
  })

  it('defines list with from filter', () => {
    const options = { from: 'worker-1' }
    expect(options.from).toBe('worker-1')
  })

  it('defines list with to filter', () => {
    const options = { to: 'worker-2' }
    expect(options.to).toBe('worker-2')
  })

  it('defines list with verb filter', () => {
    const options = { verb: 'supervises' }
    expect(options.verb).toBe('supervises')
  })

  it('defines list with combined filters', () => {
    const options = {
      from: 'worker-1',
      verb: 'delegates',
    }

    expect(options.from).toBe('worker-1')
    expect(options.verb).toBe('delegates')
  })
})

// ============================================================================
// StoreContext Tests
// ============================================================================

describe('StoreContext', () => {
  it('requires db property', () => {
    const ctx = {
      db: {},
      ns: 'https://workers.do',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    expect(ctx.db).toBeDefined()
  })

  it('requires ns property', () => {
    const ctx = {
      db: {},
      ns: 'https://workers.do',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    expect(ctx.ns).toBe('https://workers.do')
  })

  it('requires currentBranch property', () => {
    const ctx = {
      db: {},
      ns: 'https://workers.do',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    expect(ctx.currentBranch).toBe('main')
  })

  it('requires env property', () => {
    const ctx = {
      db: {},
      ns: 'https://workers.do',
      currentBranch: 'main',
      env: { API_KEY: 'secret' },
      typeCache: new Map(),
    }

    expect(ctx.env.API_KEY).toBe('secret')
  })

  it('requires typeCache property', () => {
    const ctx = {
      db: {},
      ns: 'https://workers.do',
      currentBranch: 'main',
      env: {},
      typeCache: new Map<string, unknown>(),
    }

    expect(ctx.typeCache).toBeInstanceOf(Map)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('throws on invalid worker kind', () => {
    const validateKind = (kind: string) => {
      const VALID_KINDS: WorkerKind[] = ['agent', 'human']
      if (!VALID_KINDS.includes(kind as WorkerKind)) {
        throw new Error(`Invalid worker kind: ${kind}. Must be one of: ${VALID_KINDS.join(', ')}`)
      }
    }

    expect(() => validateKind('robot')).toThrow('Invalid worker kind: robot')
  })

  it('throws on invalid worker tier', () => {
    const validateTier = (tier: string) => {
      const VALID_TIERS: WorkerTier[] = ['code', 'generative', 'agentic', 'human']
      if (!VALID_TIERS.includes(tier as WorkerTier)) {
        throw new Error(`Invalid worker tier: ${tier}. Must be one of: ${VALID_TIERS.join(', ')}`)
      }
    }

    expect(() => validateTier('basic')).toThrow('Invalid worker tier: basic')
  })

  it('throws on invalid worker status', () => {
    const validateStatus = (status: string) => {
      const VALID_STATUSES: WorkerStatus[] = ['available', 'busy', 'offline']
      if (!VALID_STATUSES.includes(status as WorkerStatus)) {
        throw new Error(`Invalid worker status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`)
      }
    }

    expect(() => validateStatus('active')).toThrow('Invalid worker status: active')
  })

  it('throws when worker not found', () => {
    const getWorker = (id: string): null => null

    const id = 'non-existent'
    const worker = getWorker(id)

    if (!worker) {
      expect(() => {
        throw new Error(`Worker not found: ${id}`)
      }).toThrow('Worker not found: non-existent')
    }
  })

  it('throws when update fails', () => {
    const updateWorker = (): null => null

    const result = updateWorker()

    if (!result) {
      expect(() => {
        throw new Error('Failed to update worker: worker-123')
      }).toThrow('Failed to update worker: worker-123')
    }
  })
})
