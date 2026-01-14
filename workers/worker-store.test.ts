/**
 * Worker Store Unit Tests
 *
 * Tests for GraphWorkerStore, ThingsStore, and RelationshipsStore.
 * These tests use the in-memory document graph store.
 *
 * @module workers/worker-store.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentGraphStore } from '../db/graph/stores/document'
import {
  GraphWorkerStore,
  ThingsStore,
  RelationshipsStore,
  createWorkerStore,
  type WorkerStore,
  type WorkerThing,
  type CreateWorkerInput,
  type WorkerKind,
  type WorkerTier,
  type WorkerStatus,
} from './worker-store'

// =============================================================================
// GraphWorkerStore Tests
// =============================================================================

describe('GraphWorkerStore', () => {
  let store: DocumentGraphStore
  let workerStore: GraphWorkerStore

  beforeEach(() => {
    store = new DocumentGraphStore()
    workerStore = new GraphWorkerStore(store, 'https://test.workers.do')
  })

  describe('createWorker', () => {
    it('creates a worker with all required fields', async () => {
      const worker = await workerStore.createWorker({
        kind: 'agent',
        name: 'Ralph',
        capabilities: ['code', 'review'],
        tier: 'agentic',
      })

      expect(worker.$id).toBeDefined()
      expect(worker.$type).toBe('Worker')
      expect(worker.name).toBe('Ralph')
      expect(worker.data.kind).toBe('agent')
      expect(worker.data.capabilities).toEqual(['code', 'review'])
      expect(worker.data.tier).toBe('agentic')
    })

    it('sets default status to available', async () => {
      const worker = await workerStore.createWorker({
        kind: 'agent',
        name: 'Ralph',
        capabilities: ['code'],
        tier: 'code',
      })

      expect(worker.data.status).toBe('available')
    })

    it('allows custom status', async () => {
      const worker = await workerStore.createWorker({
        kind: 'human',
        name: 'Alice',
        capabilities: ['approve'],
        tier: 'human',
        status: 'busy',
      })

      expect(worker.data.status).toBe('busy')
    })

    it('allows custom id', async () => {
      const worker = await workerStore.createWorker({
        $id: 'custom-worker-id',
        kind: 'agent',
        name: 'Custom',
        capabilities: [],
        tier: 'code',
      })

      expect(worker.$id).toBe('custom-worker-id')
    })

    it('includes metadata when provided', async () => {
      const worker = await workerStore.createWorker({
        kind: 'agent',
        name: 'WithMeta',
        capabilities: [],
        tier: 'generative',
        metadata: { model: 'gpt-4', provider: 'openai' },
      })

      expect(worker.data.metadata).toEqual({ model: 'gpt-4', provider: 'openai' })
    })

    it('rejects invalid kind', async () => {
      await expect(
        workerStore.createWorker({
          kind: 'invalid' as WorkerKind,
          name: 'Bad',
          capabilities: [],
          tier: 'code',
        })
      ).rejects.toThrow(/Invalid worker kind/)
    })

    it('rejects invalid tier', async () => {
      await expect(
        workerStore.createWorker({
          kind: 'agent',
          name: 'Bad',
          capabilities: [],
          tier: 'invalid' as WorkerTier,
        })
      ).rejects.toThrow(/Invalid worker tier/)
    })

    it('rejects invalid status', async () => {
      await expect(
        workerStore.createWorker({
          kind: 'agent',
          name: 'Bad',
          capabilities: [],
          tier: 'code',
          status: 'invalid' as WorkerStatus,
        })
      ).rejects.toThrow(/Invalid worker status/)
    })
  })

  describe('getWorker', () => {
    it('retrieves a created worker', async () => {
      const created = await workerStore.createWorker({
        $id: 'worker-1',
        kind: 'agent',
        name: 'Ralph',
        capabilities: ['code'],
        tier: 'agentic',
      })

      const retrieved = await workerStore.getWorker('worker-1')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.$id).toBe(created.$id)
      expect(retrieved?.name).toBe('Ralph')
    })

    it('returns null for non-existent worker', async () => {
      const result = await workerStore.getWorker('non-existent')
      expect(result).toBeNull()
    })

    it('returns null for deleted worker', async () => {
      await workerStore.createWorker({
        $id: 'worker-to-delete',
        kind: 'agent',
        name: 'ToDelete',
        capabilities: [],
        tier: 'code',
      })

      await workerStore.deleteWorker('worker-to-delete')
      const result = await workerStore.getWorker('worker-to-delete')

      expect(result).toBeNull()
    })
  })

  describe('listWorkers', () => {
    beforeEach(async () => {
      await workerStore.createWorker({
        $id: 'agent-1',
        kind: 'agent',
        name: 'Ralph',
        capabilities: ['code'],
        tier: 'agentic',
      })
      await workerStore.createWorker({
        $id: 'agent-2',
        kind: 'agent',
        name: 'Priya',
        capabilities: ['spec'],
        tier: 'generative',
      })
      await workerStore.createWorker({
        $id: 'human-1',
        kind: 'human',
        name: 'Alice',
        capabilities: ['approve'],
        tier: 'human',
      })
    })

    it('lists all workers', async () => {
      const workers = await workerStore.listWorkers()
      expect(workers.length).toBe(3)
    })

    it('excludes deleted workers by default', async () => {
      await workerStore.deleteWorker('agent-1')
      const workers = await workerStore.listWorkers()
      expect(workers.length).toBe(2)
      expect(workers.find((w) => w.$id === 'agent-1')).toBeUndefined()
    })

    it('includes deleted workers when requested', async () => {
      await workerStore.deleteWorker('agent-1')
      const workers = await workerStore.listWorkers({ includeDeleted: true })
      expect(workers.length).toBe(3)
    })
  })

  describe('updateWorker', () => {
    beforeEach(async () => {
      await workerStore.createWorker({
        $id: 'worker-to-update',
        kind: 'agent',
        name: 'Ralph',
        capabilities: ['code'],
        tier: 'code',
        status: 'available',
      })
    })

    it('updates worker name', async () => {
      const updated = await workerStore.updateWorker('worker-to-update', {
        name: 'Ralph Updated',
      })

      expect(updated.data.name).toBe('Ralph Updated')
    })

    it('updates worker capabilities', async () => {
      const updated = await workerStore.updateWorker('worker-to-update', {
        capabilities: ['code', 'review', 'test'],
      })

      expect(updated.data.capabilities).toEqual(['code', 'review', 'test'])
    })

    it('updates worker status', async () => {
      const updated = await workerStore.updateWorker('worker-to-update', {
        status: 'busy',
      })

      expect(updated.data.status).toBe('busy')
    })

    it('updates worker tier', async () => {
      const updated = await workerStore.updateWorker('worker-to-update', {
        tier: 'agentic',
      })

      expect(updated.data.tier).toBe('agentic')
    })

    it('preserves unchanged fields', async () => {
      const updated = await workerStore.updateWorker('worker-to-update', {
        status: 'busy',
      })

      expect(updated.data.name).toBe('Ralph')
      expect(updated.data.kind).toBe('agent')
      expect(updated.data.tier).toBe('code')
    })

    it('throws for non-existent worker', async () => {
      await expect(
        workerStore.updateWorker('non-existent', { status: 'busy' })
      ).rejects.toThrow(/Worker not found/)
    })

    it('rejects invalid update values', async () => {
      await expect(
        workerStore.updateWorker('worker-to-update', {
          tier: 'invalid' as WorkerTier,
        })
      ).rejects.toThrow(/Invalid worker tier/)
    })
  })

  describe('deleteWorker', () => {
    it('soft deletes a worker', async () => {
      await workerStore.createWorker({
        $id: 'worker-delete',
        kind: 'agent',
        name: 'ToDelete',
        capabilities: [],
        tier: 'code',
      })

      const deleted = await workerStore.deleteWorker('worker-delete')

      expect(deleted.$id).toBe('worker-delete')
      expect(deleted.deleted).toBe(true)
    })

    it('throws for non-existent worker', async () => {
      await expect(workerStore.deleteWorker('non-existent')).rejects.toThrow(
        /Worker not found/
      )
    })
  })

  describe('findByCapabilities', () => {
    beforeEach(async () => {
      await workerStore.createWorker({
        $id: 'full-stack',
        kind: 'agent',
        name: 'FullStack',
        capabilities: ['code', 'review', 'test', 'deploy'],
        tier: 'agentic',
      })
      await workerStore.createWorker({
        $id: 'code-only',
        kind: 'agent',
        name: 'CodeOnly',
        capabilities: ['code'],
        tier: 'code',
      })
      await workerStore.createWorker({
        $id: 'reviewer',
        kind: 'human',
        name: 'Reviewer',
        capabilities: ['review', 'approve'],
        tier: 'human',
      })
    })

    it('finds workers with all specified capabilities', async () => {
      const workers = await workerStore.findByCapabilities(['code', 'review'])
      expect(workers.length).toBe(1)
      expect(workers[0].$id).toBe('full-stack')
    })

    it('finds workers with single capability', async () => {
      const workers = await workerStore.findByCapabilities(['code'])
      expect(workers.length).toBe(2)
    })

    it('returns empty for unmatched capabilities', async () => {
      const workers = await workerStore.findByCapabilities(['nonexistent'])
      expect(workers.length).toBe(0)
    })

    it('returns empty when no worker has all capabilities', async () => {
      const workers = await workerStore.findByCapabilities(['code', 'approve'])
      expect(workers.length).toBe(0)
    })
  })

  describe('findByTier', () => {
    beforeEach(async () => {
      await workerStore.createWorker({
        kind: 'agent',
        name: 'Code1',
        capabilities: [],
        tier: 'code',
      })
      await workerStore.createWorker({
        kind: 'agent',
        name: 'Code2',
        capabilities: [],
        tier: 'code',
      })
      await workerStore.createWorker({
        kind: 'agent',
        name: 'Gen1',
        capabilities: [],
        tier: 'generative',
      })
      await workerStore.createWorker({
        kind: 'human',
        name: 'Human1',
        capabilities: [],
        tier: 'human',
      })
    })

    it('finds all workers of a tier', async () => {
      const codeWorkers = await workerStore.findByTier('code')
      expect(codeWorkers.length).toBe(2)
    })

    it('returns empty for tier with no workers', async () => {
      const agenticWorkers = await workerStore.findByTier('agentic')
      expect(agenticWorkers.length).toBe(0)
    })
  })

  describe('findAvailable', () => {
    beforeEach(async () => {
      await workerStore.createWorker({
        $id: 'available-1',
        kind: 'agent',
        name: 'Available1',
        capabilities: [],
        tier: 'code',
        status: 'available',
      })
      await workerStore.createWorker({
        $id: 'busy-1',
        kind: 'agent',
        name: 'Busy1',
        capabilities: [],
        tier: 'code',
        status: 'busy',
      })
      await workerStore.createWorker({
        $id: 'offline-1',
        kind: 'agent',
        name: 'Offline1',
        capabilities: [],
        tier: 'code',
        status: 'offline',
      })
    })

    it('finds only available workers', async () => {
      const available = await workerStore.findAvailable()
      expect(available.length).toBe(1)
      expect(available[0].$id).toBe('available-1')
    })
  })

  describe('findByKind', () => {
    beforeEach(async () => {
      await workerStore.createWorker({
        kind: 'agent',
        name: 'Agent1',
        capabilities: [],
        tier: 'code',
      })
      await workerStore.createWorker({
        kind: 'agent',
        name: 'Agent2',
        capabilities: [],
        tier: 'generative',
      })
      await workerStore.createWorker({
        kind: 'human',
        name: 'Human1',
        capabilities: [],
        tier: 'human',
      })
    })

    it('finds all agents', async () => {
      const agents = await workerStore.findByKind('agent')
      expect(agents.length).toBe(2)
    })

    it('finds all humans', async () => {
      const humans = await workerStore.findByKind('human')
      expect(humans.length).toBe(1)
      expect(humans[0].data.name).toBe('Human1')
    })
  })

  describe('relationships', () => {
    beforeEach(async () => {
      await workerStore.createWorker({
        $id: 'worker-a',
        kind: 'agent',
        name: 'WorkerA',
        capabilities: [],
        tier: 'code',
      })
      await workerStore.createWorker({
        $id: 'worker-b',
        kind: 'agent',
        name: 'WorkerB',
        capabilities: [],
        tier: 'generative',
      })
    })

    it('creates relationship between workers', async () => {
      const rel = await workerStore.createRelationship({
        verb: 'delegates-to',
        from: 'worker-a',
        to: 'worker-b',
        data: { priority: 'high' },
      })

      expect(rel.verb).toBe('delegates-to')
      expect(rel.from).toBe('worker-a')
      expect(rel.to).toBe('worker-b')
      expect(rel.data?.priority).toBe('high')
    })

    it('queries relationships from a worker', async () => {
      await workerStore.createRelationship({
        verb: 'delegates-to',
        from: 'worker-a',
        to: 'worker-b',
      })

      const rels = await workerStore.queryRelationshipsFrom('worker-a')
      expect(rels.length).toBeGreaterThanOrEqual(1)
      expect(rels.some((r) => r.verb === 'delegates-to')).toBe(true)
    })

    it('queries relationships to a worker', async () => {
      await workerStore.createRelationship({
        verb: 'delegates-to',
        from: 'worker-a',
        to: 'worker-b',
      })

      const rels = await workerStore.queryRelationshipsTo('worker-b')
      expect(rels.length).toBeGreaterThanOrEqual(1)
    })

    it('filters relationships by verb', async () => {
      await workerStore.createRelationship({
        verb: 'delegates-to',
        from: 'worker-a',
        to: 'worker-b',
      })
      await workerStore.createRelationship({
        verb: 'supervises',
        from: 'worker-a',
        to: 'worker-b',
      })

      const delegations = await workerStore.queryRelationshipsFrom('worker-a', 'delegates-to')
      expect(delegations.every((r) => r.verb === 'delegates-to')).toBe(true)
    })
  })
})

// =============================================================================
// ThingsStore Tests
// =============================================================================

describe('ThingsStore', () => {
  let graphStore: DocumentGraphStore
  let thingsStore: ThingsStore

  beforeEach(() => {
    graphStore = new DocumentGraphStore()
    thingsStore = new ThingsStore({ db: graphStore, ns: 'https://test.do' })
  })

  describe('create', () => {
    it('creates a thing with type and data', async () => {
      const thing = await thingsStore.create({
        $type: 'Task',
        name: 'My Task',
        data: { priority: 'high', status: 'pending' },
      })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Task')
      expect(thing.name).toBe('My Task')
      expect(thing.data.priority).toBe('high')
    })

    it('allows custom id', async () => {
      const thing = await thingsStore.create({
        $id: 'custom-id',
        $type: 'Task',
        name: 'Custom',
        data: {},
      })

      expect(thing.$id).toBe('custom-id')
    })

    it('validates Worker data when type is Worker', async () => {
      await expect(
        thingsStore.create({
          $type: 'Worker',
          name: 'BadWorker',
          data: { invalid: true },
        })
      ).rejects.toThrow()
    })
  })

  describe('get', () => {
    it('retrieves a created thing', async () => {
      const created = await thingsStore.create({
        $id: 'thing-1',
        $type: 'Task',
        name: 'Test',
        data: { foo: 'bar' },
      })

      const retrieved = await thingsStore.get('thing-1')

      expect(retrieved?.$id).toBe(created.$id)
      expect(retrieved?.data.foo).toBe('bar')
    })

    it('returns null for non-existent thing', async () => {
      const result = await thingsStore.get('non-existent')
      expect(result).toBeNull()
    })

    it('excludes deleted by default', async () => {
      await thingsStore.create({
        $id: 'to-delete',
        $type: 'Task',
        name: 'Delete Me',
        data: {},
      })
      await thingsStore.delete('to-delete')

      const result = await thingsStore.get('to-delete')
      expect(result).toBeNull()
    })

    it('includes deleted when requested', async () => {
      await thingsStore.create({
        $id: 'to-delete-2',
        $type: 'Task',
        name: 'Delete Me',
        data: {},
      })
      await thingsStore.delete('to-delete-2')

      const result = await thingsStore.get('to-delete-2', { includeDeleted: true })
      expect(result).not.toBeNull()
      expect(result?.deleted).toBe(true)
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      await thingsStore.create({ $type: 'Task', name: 'Task1', data: {} })
      await thingsStore.create({ $type: 'Task', name: 'Task2', data: {} })
      await thingsStore.create({ $type: 'Project', name: 'Project1', data: {} })
    })

    it('lists all things', async () => {
      const things = await thingsStore.list()
      expect(things.length).toBe(3)
    })

    it('filters by type', async () => {
      const tasks = await thingsStore.list({ type: 'Task' })
      expect(tasks.length).toBe(2)
      expect(tasks.every((t) => t.$type === 'Task')).toBe(true)
    })
  })

  describe('update', () => {
    it('updates thing data', async () => {
      await thingsStore.create({
        $id: 'update-me',
        $type: 'Task',
        name: 'Original',
        data: { status: 'pending' },
      })

      const updated = await thingsStore.update('update-me', {
        data: { status: 'completed', name: 'Original' },
      })

      expect(updated.data.status).toBe('completed')
    })

    it('throws for non-existent thing', async () => {
      await expect(
        thingsStore.update('non-existent', { data: {} })
      ).rejects.toThrow(/Thing not found/)
    })
  })

  describe('delete', () => {
    it('deletes a thing', async () => {
      await thingsStore.create({
        $id: 'delete-me',
        $type: 'Task',
        name: 'Delete',
        data: {},
      })

      const result = await thingsStore.delete('delete-me')

      expect(result.$id).toBe('delete-me')
      expect(result.deleted).toBe(true)
    })

    it('throws for non-existent thing', async () => {
      await expect(thingsStore.delete('non-existent')).rejects.toThrow(
        /Thing not found/
      )
    })
  })
})

// =============================================================================
// RelationshipsStore Tests
// =============================================================================

describe('RelationshipsStore', () => {
  let graphStore: DocumentGraphStore
  let thingsStore: ThingsStore
  let relStore: RelationshipsStore

  beforeEach(async () => {
    graphStore = new DocumentGraphStore()
    thingsStore = new ThingsStore({ db: graphStore, ns: 'https://test.do' })
    relStore = new RelationshipsStore({ db: graphStore })

    // Create some things to relate
    await thingsStore.create({ $id: 'thing-a', $type: 'Item', name: 'A', data: {} })
    await thingsStore.create({ $id: 'thing-b', $type: 'Item', name: 'B', data: {} })
    await thingsStore.create({ $id: 'thing-c', $type: 'Item', name: 'C', data: {} })
  })

  describe('create', () => {
    it('creates a relationship', async () => {
      const rel = await relStore.create({
        verb: 'relates-to',
        from: 'thing-a',
        to: 'thing-b',
      })

      expect(rel.id).toBeDefined()
      expect(rel.verb).toBe('relates-to')
      expect(rel.from).toBe('thing-a')
      expect(rel.to).toBe('thing-b')
    })

    it('includes data when provided', async () => {
      const rel = await relStore.create({
        verb: 'links',
        from: 'thing-a',
        to: 'thing-b',
        data: { weight: 1.5, label: 'strong' },
      })

      expect(rel.data?.weight).toBe(1.5)
      expect(rel.data?.label).toBe('strong')
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      await relStore.create({ verb: 'links', from: 'thing-a', to: 'thing-b' })
      await relStore.create({ verb: 'links', from: 'thing-a', to: 'thing-c' })
      await relStore.create({ verb: 'references', from: 'thing-b', to: 'thing-a' })
    })

    it('lists relationships from a thing', async () => {
      const rels = await relStore.list({ from: 'thing-a' })
      expect(rels.length).toBe(2)
      expect(rels.every((r) => r.from === 'thing-a')).toBe(true)
    })

    it('lists relationships to a thing', async () => {
      const rels = await relStore.list({ to: 'thing-a' })
      expect(rels.length).toBeGreaterThanOrEqual(1)
    })

    it('filters by verb', async () => {
      const linksFromA = await relStore.list({ from: 'thing-a', verb: 'links' })
      expect(linksFromA.every((r) => r.verb === 'links')).toBe(true)
    })
  })
})

// =============================================================================
// createWorkerStore Factory Tests
// =============================================================================

describe('createWorkerStore', () => {
  it('creates a WorkerStore from context', () => {
    const graphStore = new DocumentGraphStore()
    const ctx = {
      db: graphStore,
      ns: 'https://test.workers.do',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    const workerStore = createWorkerStore(ctx)

    expect(workerStore).toBeDefined()
    expect(typeof workerStore.createWorker).toBe('function')
    expect(typeof workerStore.getWorker).toBe('function')
    expect(typeof workerStore.listWorkers).toBe('function')
  })

  it('creates functional store that can create workers', async () => {
    const graphStore = new DocumentGraphStore()
    const ctx = {
      db: graphStore,
      ns: 'https://test.workers.do',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    const workerStore = createWorkerStore(ctx)
    const worker = await workerStore.createWorker({
      kind: 'agent',
      name: 'TestAgent',
      capabilities: ['test'],
      tier: 'code',
    })

    expect(worker.$id).toBeDefined()
    expect(worker.name).toBe('TestAgent')
  })
})
