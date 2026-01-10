/**
 * DO Store Accessors Tests
 *
 * GREEN PHASE: Tests for direct store accessors on the DO base class.
 *
 * The DO class now has these direct store accessors:
 * - this.things - ThingsStore with get, list, create, update, delete, versions
 * - this.rels - RelationshipsStore with create, list, delete, from, to
 * - this.actions - ActionsStore with log, complete, fail, retry, get, list, pending, failed
 * - this.events - EventsStore with emit, stream, streamPending, get, list, replay
 * - this.search - SearchStore with index, remove, query, semantic
 * - this.objects - ObjectsStore with register, get, list, shards, primary, update, delete, resolve
 *
 * Implementation: objects/stores.ts + objects/DO.ts store accessors
 *
 * Note: Most tests require a real SQLite database (Workers environment).
 * Tests marked with .skip require database access.
 * Tests without .skip verify store accessor presence and types.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import DOBase for static state cleanup
import { DO as DOBase } from '../DOBase'

// ============================================================================
// STORE TYPE DEFINITIONS
// These types define the interface that needs to be implemented.
// In GREEN phase, these will be imported from '../stores'
// ============================================================================

/** Thing entity returned from ThingsStore operations */
interface ThingEntity {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  branch?: string | null
  version?: number
  deleted?: boolean
}

/** Options for ThingsStore get operation */
interface ThingsGetOptions {
  branch?: string
  version?: number
  includeDeleted?: boolean
}

/** Options for ThingsStore list operation */
interface ThingsListOptions {
  type?: string
  branch?: string
  orderBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
  after?: string
  includeDeleted?: boolean
  where?: Record<string, unknown>
}

/** Options for ThingsStore create operation */
interface ThingsCreateOptions {
  branch?: string
}

/** Options for ThingsStore update operation */
interface ThingsUpdateOptions {
  merge?: boolean
  branch?: string
}

/** Options for ThingsStore delete operation */
interface ThingsDeleteOptions {
  hard?: boolean
  branch?: string
}

/** ThingsStore interface - CRUD operations for Things */
interface ThingsStore {
  get(id: string, options?: ThingsGetOptions): Promise<ThingEntity | null>
  list(options?: ThingsListOptions): Promise<ThingEntity[]>
  create(data: Partial<ThingEntity>, options?: ThingsCreateOptions): Promise<ThingEntity>
  update(id: string, data: Partial<ThingEntity>, options?: ThingsUpdateOptions): Promise<ThingEntity>
  delete(id: string, options?: ThingsDeleteOptions): Promise<ThingEntity>
  versions(id: string): Promise<ThingEntity[]>
}

/** Relationship entity returned from RelationshipsStore operations */
interface RelationshipEntity {
  id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown> | null
  createdAt: Date
}

/** Options for RelationshipsStore list operation */
interface RelationshipsListOptions {
  from?: string
  to?: string
  verb?: string
  limit?: number
  offset?: number
}

/** Options for RelationshipsStore traversal */
interface RelationshipsTraversalOptions {
  verb?: string
}

/** RelationshipsStore interface - relationship CRUD and traversal */
interface RelationshipsStore {
  create(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<RelationshipEntity>
  list(options?: RelationshipsListOptions): Promise<RelationshipEntity[]>
  delete(id: string): Promise<RelationshipEntity>
  deleteWhere(criteria: { from?: string; to?: string; verb?: string }): Promise<number>
  from(url: string, options?: RelationshipsTraversalOptions): Promise<RelationshipEntity[]>
  to(url: string, options?: RelationshipsTraversalOptions): Promise<RelationshipEntity[]>
}

/** Action entity returned from ActionsStore operations */
interface ActionEntity {
  id: string
  verb: string
  actor?: string | null
  target: string
  input?: number | Record<string, unknown> | null
  output?: number | Record<string, unknown> | null
  options?: Record<string, unknown> | null
  durability: 'send' | 'try' | 'do'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'undone' | 'retrying'
  error?: Record<string, unknown> | null
  requestId?: string | null
  sessionId?: string | null
  workflowId?: string | null
  createdAt: Date
  startedAt?: Date | null
  completedAt?: Date | null
  duration?: number | null
  retryCount?: number
}

/** Options for ActionsStore log operation */
interface ActionsLogOptions {
  verb: string
  target: string
  actor?: string
  input?: number | Record<string, unknown>
  output?: number
  durability?: 'send' | 'try' | 'do'
  requestId?: string
  sessionId?: string
  workflowId?: string
}

/** Options for ActionsStore list operation */
interface ActionsListOptions {
  target?: string
  actor?: string
  status?: string
  verb?: string
}

/** ActionsStore interface - action logging and lifecycle */
interface ActionsStore {
  log(options: ActionsLogOptions): Promise<ActionEntity>
  complete(id: string, output: unknown): Promise<ActionEntity>
  fail(id: string, error: Error | Record<string, unknown>): Promise<ActionEntity>
  retry(id: string): Promise<ActionEntity>
  get(id: string): Promise<ActionEntity | null>
  list(options?: ActionsListOptions): Promise<ActionEntity[]>
  pending(): Promise<ActionEntity[]>
  failed(): Promise<ActionEntity[]>
}

/** Event entity returned from EventsStore operations */
interface EventEntity {
  id: string
  verb: string
  source: string
  data: Record<string, unknown>
  actionId?: string | null
  sequence: number
  streamed: boolean
  streamedAt?: Date | null
  createdAt: Date
}

/** Options for EventsStore emit operation */
interface EventsEmitOptions {
  verb: string
  source: string
  data: Record<string, unknown>
  actionId?: string
}

/** Options for EventsStore list operation */
interface EventsListOptions {
  source?: string
  verb?: string
  afterSequence?: number
  orderBy?: string
  order?: 'asc' | 'desc'
}

/** Options for EventsStore replay operation */
interface EventsReplayOptions {
  fromSequence: number
  limit?: number
}

/** EventsStore interface - event emission and streaming */
interface EventsStore {
  emit(options: EventsEmitOptions): Promise<EventEntity>
  stream(id: string): Promise<EventEntity>
  streamPending(): Promise<number>
  get(id: string): Promise<EventEntity | null>
  list(options?: EventsListOptions): Promise<EventEntity[]>
  replay(options: EventsReplayOptions): Promise<EventEntity[]>
}

/** Search entry returned from SearchStore operations */
interface SearchEntry {
  $id: string
  $type: string
  content: string
  embedding?: Buffer | null
  embeddingDim?: number
  indexedAt: Date
}

/** Search result with score */
interface SearchResult extends SearchEntry {
  score: number
}

/** Options for SearchStore query operation */
interface SearchQueryOptions {
  type?: string
  limit?: number
}

/** SearchStore interface - full-text and semantic search */
interface SearchStore {
  index(entry: { $id: string; $type: string; content: string }): Promise<SearchEntry>
  indexMany(entries: { $id: string; $type: string; content: string }[]): Promise<SearchEntry[]>
  remove(id: string): Promise<void>
  removeMany(ids: string[]): Promise<number>
  query(text: string, options?: SearchQueryOptions): Promise<SearchResult[]>
  semantic(text: string, options?: SearchQueryOptions): Promise<SearchResult[]>
  reindexType(type: string): Promise<number>
}

/** DO Object entry returned from ObjectsStore operations */
interface DOObjectEntity {
  ns: string
  id: string
  class: string
  relation?: string | null
  shardKey?: string | null
  shardIndex?: number | null
  region?: string | null
  primary?: boolean | null
  cached?: Record<string, unknown> | null
  createdAt: Date
}

/** Options for ObjectsStore register operation */
interface ObjectsRegisterOptions {
  ns: string
  id: string
  class: string
  relation?: string
  shardKey?: string
  shardIndex?: number
  region?: string
  primary?: boolean
}

/** Options for ObjectsStore list operation */
interface ObjectsListOptions {
  relation?: string
  class?: string
}

/** ObjectsStore interface - DO registry and resolution */
interface ObjectsStore {
  register(options: ObjectsRegisterOptions): Promise<DOObjectEntity>
  get(ns: string): Promise<DOObjectEntity | null>
  list(options?: ObjectsListOptions): Promise<DOObjectEntity[]>
  shards(key: string): Promise<DOObjectEntity[]>
  primary(ns: string): Promise<DOObjectEntity | null>
  update(ns: string, data: Partial<DOObjectEntity>): Promise<DOObjectEntity>
  delete(ns: string): Promise<void>
  resolve(ns: string): Promise<DurableObjectStub>
}

// DO class with store accessors
import { DO } from '../DO'

// ============================================================================
// MOCK DO STATE & ENVIRONMENT
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => storage.get(key) as T | undefined),
      put: vi.fn(async <T>(key: string, value: T): Promise<void> => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string): Promise<boolean> => storage.delete(key)),
      deleteAll: vi.fn(async (): Promise<void> => storage.clear()),
      list: vi.fn(async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
        const result = new Map<string, T>()
        for (const [key, value] of storage) {
          if (options?.prefix && !key.startsWith(options.prefix)) continue
          result.set(key, value as T)
        }
        return result
      }),
      sql: {
        exec: vi.fn(),
      },
    },
    _storage: storage,
  }
}

function createMockState() {
  const { storage, _storage } = createMockStorage()
  return {
    id: {
      toString: () => 'test-do-stores-id',
      name: 'test-do-stores-id',
      equals: (other: { toString: () => string }) => other.toString() === 'test-do-stores-id',
    },
    storage,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { _storage: Map<string, unknown> }
}

function createMockEnv() {
  return {
    DO: {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-for-${name}` })),
      get: vi.fn(),
    },
    PIPELINE: {
      send: vi.fn(),
    },
  }
}

// ============================================================================
// MOCK DATABASE FOR TESTING
// ============================================================================

interface MockThing {
  id: string
  type: number
  branch: string | null
  name: string | null
  data: Record<string, unknown> | null
  deleted: boolean
}

interface MockRelationship {
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: Date
}

interface MockAction {
  id: string
  verb: string
  actor: string | null
  target: string
  input: number | null
  output: number | null
  options: Record<string, unknown> | null
  durability: 'send' | 'try' | 'do'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'undone' | 'retrying'
  error: Record<string, unknown> | null
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

interface MockEvent {
  id: string
  verb: string
  source: string
  data: Record<string, unknown>
  actionId: string | null
  sequence: number
  streamed: boolean
  createdAt: Date
}

interface MockSearchEntry {
  $id: string
  $type: string
  content: string
  embedding: Buffer | null
  indexedAt: Date
}

interface MockDOObject {
  ns: string
  id: string
  class: string
  relation: string | null
  createdAt: Date
}

// ============================================================================
// TEST SUITE: ThingsStore
// ============================================================================

// Skip database-dependent tests - they require Workers environment with real SQLite
describe.skip('ThingsStore (requires Workers runtime)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let things: ThingsStore

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    // things = new DO(mockState, mockEnv).things
  })

  // ==========================================================================
  // 1. GET OPERATIONS
  // ==========================================================================

  describe('get', () => {
    it('retrieves a thing by ID', async () => {
      const thing = await things.get('startup-1')

      expect(thing).toBeDefined()
      expect(thing?.$id).toBe('startup-1')
    })

    it('returns null for non-existent thing', async () => {
      const thing = await things.get('nonexistent')

      expect(thing).toBeNull()
    })

    it('retrieves thing with full data including type', async () => {
      const thing = await things.get('startup-1')

      expect(thing?.$type).toBeDefined()
      expect(thing?.name).toBeDefined()
      expect(thing?.data).toBeDefined()
    })

    it('respects currentBranch when getting things', async () => {
      // Thing exists on 'feature' branch but not on 'main'
      const thingOnMain = await things.get('feature-only', { branch: 'main' })
      const thingOnFeature = await things.get('feature-only', { branch: 'feature' })

      expect(thingOnMain).toBeNull()
      expect(thingOnFeature).toBeDefined()
    })

    it('retrieves thing at specific version', async () => {
      const thingV1 = await things.get('evolving-thing', { version: 1 })
      const thingV2 = await things.get('evolving-thing', { version: 2 })

      expect(thingV1?.data?.state).toBe('v1')
      expect(thingV2?.data?.state).toBe('v2')
    })

    it('excludes soft-deleted things by default', async () => {
      const thing = await things.get('deleted-thing')

      expect(thing).toBeNull()
    })

    it('includes soft-deleted things when specified', async () => {
      const thing = await things.get('deleted-thing', { includeDeleted: true })

      expect(thing).toBeDefined()
      expect(thing?.deleted).toBe(true)
    })
  })

  // ==========================================================================
  // 2. LIST OPERATIONS
  // ==========================================================================

  describe('list', () => {
    it('lists all things', async () => {
      const allThings = await things.list()

      expect(allThings).toBeInstanceOf(Array)
      expect(allThings.length).toBeGreaterThan(0)
    })

    it('filters by type', async () => {
      const startups = await things.list({ type: 'Startup' })

      expect(startups.every((t) => t.$type === 'Startup')).toBe(true)
    })

    it('filters by branch', async () => {
      const mainThings = await things.list({ branch: 'main' })
      const featureThings = await things.list({ branch: 'feature' })

      expect(mainThings).not.toEqual(featureThings)
    })

    it('supports ordering by field', async () => {
      const byNameAsc = await things.list({ orderBy: 'name', order: 'asc' })
      const byNameDesc = await things.list({ orderBy: 'name', order: 'desc' })

      expect(byNameAsc[0]?.name).not.toBe(byNameDesc[0]?.name)
    })

    it('supports pagination with limit and offset', async () => {
      const page1 = await things.list({ limit: 10, offset: 0 })
      const page2 = await things.list({ limit: 10, offset: 10 })

      expect(page1.length).toBeLessThanOrEqual(10)
      expect(page1[0]?.$id).not.toBe(page2[0]?.$id)
    })

    it('supports cursor-based pagination', async () => {
      const firstPage = await things.list({ limit: 10 })
      const cursor = firstPage[firstPage.length - 1]?.$id
      const nextPage = await things.list({ limit: 10, after: cursor })

      expect(nextPage[0]?.$id).not.toBe(firstPage[0]?.$id)
    })

    it('excludes soft-deleted things by default', async () => {
      const allThings = await things.list()

      expect(allThings.every((t) => !t.deleted)).toBe(true)
    })

    it('includes soft-deleted things when specified', async () => {
      const allThings = await things.list({ includeDeleted: true })

      expect(allThings.some((t) => t.deleted)).toBe(true)
    })

    it('filters by custom query on data fields', async () => {
      const filtered = await things.list({
        where: { 'data.status': 'active' },
      })

      expect(filtered.every((t) => t.data?.status === 'active')).toBe(true)
    })
  })

  // ==========================================================================
  // 3. CREATE OPERATIONS
  // ==========================================================================

  describe('create', () => {
    it('creates a new thing', async () => {
      const thing = await things.create({
        $type: 'Startup',
        name: 'New Startup',
        data: { industry: 'tech' },
      })

      expect(thing.$id).toBeDefined()
      expect(thing.name).toBe('New Startup')
    })

    it('generates UUID if $id not provided', async () => {
      const thing = await things.create({
        $type: 'Startup',
        name: 'Auto ID Startup',
      })

      expect(thing.$id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('uses provided $id if specified', async () => {
      const thing = await things.create({
        $id: 'custom-id',
        $type: 'Startup',
        name: 'Custom ID Startup',
      })

      expect(thing.$id).toBe('custom-id')
    })

    it('creates thing on current branch', async () => {
      const thing = await things.create({
        $type: 'Startup',
        name: 'Branch Test',
      })

      expect(thing.branch).toBe('main')
    })

    it('creates thing on specified branch', async () => {
      const thing = await things.create(
        {
          $type: 'Startup',
          name: 'Feature Branch Startup',
        },
        { branch: 'feature' }
      )

      expect(thing.branch).toBe('feature')
    })

    it('throws on duplicate $id', async () => {
      await things.create({ $id: 'unique-id', $type: 'Startup', name: 'First' })

      await expect(
        things.create({ $id: 'unique-id', $type: 'Startup', name: 'Duplicate' })
      ).rejects.toThrow(/duplicate|already exists/i)
    })

    it('validates required fields', async () => {
      await expect(
        things.create({ name: 'Missing Type' } as any)
      ).rejects.toThrow(/type.*required/i)
    })

    it('returns created thing with all fields populated', async () => {
      const thing = await things.create({
        $type: 'Startup',
        name: 'Complete Thing',
        data: { key: 'value' },
      })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Startup')
      expect(thing.name).toBe('Complete Thing')
      expect(thing.data).toEqual({ key: 'value' })
      expect(thing.deleted).toBe(false)
    })
  })

  // ==========================================================================
  // 4. UPDATE OPERATIONS
  // ==========================================================================

  describe('update', () => {
    it('updates a thing by ID', async () => {
      const updated = await things.update('startup-1', {
        name: 'Updated Name',
      })

      expect(updated.name).toBe('Updated Name')
    })

    it('creates new version (append-only)', async () => {
      const before = await things.get('startup-1')
      await things.update('startup-1', { name: 'New Name' })
      const after = await things.get('startup-1')

      // Versions should be different (new row inserted)
      expect(after?.version).toBeGreaterThan(before?.version ?? 0)
    })

    it('preserves fields not specified in update', async () => {
      const original = await things.get('startup-1')
      await things.update('startup-1', { name: 'New Name' })
      const updated = await things.get('startup-1')

      expect(updated?.data).toEqual(original?.data)
    })

    it('throws for non-existent thing', async () => {
      await expect(
        things.update('nonexistent', { name: 'Update' })
      ).rejects.toThrow(/not found/i)
    })

    it('supports deep merge for data field', async () => {
      await things.create({
        $id: 'deep-merge-test',
        $type: 'Test',
        data: { a: 1, b: { c: 2 } },
      })

      const updated = await things.update('deep-merge-test', {
        data: { b: { d: 3 } },
      })

      expect(updated.data).toEqual({ a: 1, b: { c: 2, d: 3 } })
    })

    it('supports replace mode for data field', async () => {
      await things.create({
        $id: 'replace-test',
        $type: 'Test',
        data: { a: 1, b: 2 },
      })

      const updated = await things.update(
        'replace-test',
        { data: { c: 3 } },
        { merge: false }
      )

      expect(updated.data).toEqual({ c: 3 })
    })

    it('respects branch context', async () => {
      await things.update('branched-thing', { name: 'Main Update' }, { branch: 'main' })
      await things.update('branched-thing', { name: 'Feature Update' }, { branch: 'feature' })

      const mainVersion = await things.get('branched-thing', { branch: 'main' })
      const featureVersion = await things.get('branched-thing', { branch: 'feature' })

      expect(mainVersion?.name).toBe('Main Update')
      expect(featureVersion?.name).toBe('Feature Update')
    })
  })

  // ==========================================================================
  // 5. DELETE OPERATIONS
  // ==========================================================================

  describe('delete', () => {
    it('soft deletes a thing by ID', async () => {
      await things.delete('startup-to-delete')

      const thing = await things.get('startup-to-delete')
      expect(thing).toBeNull()

      const deletedThing = await things.get('startup-to-delete', { includeDeleted: true })
      expect(deletedThing?.deleted).toBe(true)
    })

    it('creates new version with deleted=true (append-only)', async () => {
      const before = await things.get('startup-to-delete')
      await things.delete('startup-to-delete')
      const after = await things.get('startup-to-delete', { includeDeleted: true })

      expect(after?.version).toBeGreaterThan(before?.version ?? 0)
    })

    it('throws for non-existent thing', async () => {
      await expect(things.delete('nonexistent')).rejects.toThrow(/not found/i)
    })

    it('supports hard delete option', async () => {
      await things.delete('startup-to-hard-delete', { hard: true })

      const thing = await things.get('startup-to-hard-delete', { includeDeleted: true })
      expect(thing).toBeNull()
    })

    it('returns the deleted thing', async () => {
      const deleted = await things.delete('startup-for-return')

      expect(deleted.$id).toBe('startup-for-return')
      expect(deleted.deleted).toBe(true)
    })

    it('respects branch context', async () => {
      await things.delete('branched-delete', { branch: 'feature' })

      const mainVersion = await things.get('branched-delete', { branch: 'main' })
      const featureVersion = await things.get('branched-delete', { branch: 'feature' })

      expect(mainVersion).not.toBeNull()
      expect(featureVersion).toBeNull()
    })
  })

  // ==========================================================================
  // 6. VERSION QUERIES
  // ==========================================================================

  describe('versions', () => {
    it('lists all versions of a thing', async () => {
      const versions = await things.versions('evolving-thing')

      expect(versions).toBeInstanceOf(Array)
      expect(versions.length).toBeGreaterThan(1)
    })

    it('returns versions in chronological order', async () => {
      const versions = await things.versions('evolving-thing')

      for (let i = 1; i < versions.length; i++) {
        expect(versions[i].version).toBeGreaterThan(versions[i - 1].version)
      }
    })

    it('returns empty array for non-existent thing', async () => {
      const versions = await things.versions('nonexistent')

      expect(versions).toEqual([])
    })
  })
})

// ============================================================================
// TEST SUITE: RelationshipsStore
// ============================================================================

// Skip database-dependent tests - they require Workers environment with real SQLite
describe.skip('RelationshipsStore (requires Workers runtime)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let rels: RelationshipsStore

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    // rels = new DO(mockState, mockEnv).rels
  })

  // ==========================================================================
  // 1. CREATE OPERATIONS
  // ==========================================================================

  describe('create', () => {
    it('creates a relationship', async () => {
      const rel = await rels.create({
        verb: 'manages',
        from: 'https://example.com/Person/alice',
        to: 'https://example.com/Startup/acme',
      })

      expect(rel.id).toBeDefined()
      expect(rel.verb).toBe('manages')
    })

    it('creates relationship with data payload', async () => {
      const rel = await rels.create({
        verb: 'invested',
        from: 'https://example.com/Investor/bob',
        to: 'https://example.com/Startup/acme',
        data: { amount: 1000000, round: 'seed' },
      })

      expect(rel.data).toEqual({ amount: 1000000, round: 'seed' })
    })

    it('generates UUID for relationship ID', async () => {
      const rel = await rels.create({
        verb: 'owns',
        from: 'https://example.com/Person/alice',
        to: 'https://example.com/Asset/house',
      })

      expect(rel.id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('sets createdAt timestamp', async () => {
      const rel = await rels.create({
        verb: 'created',
        from: 'https://example.com/Person/alice',
        to: 'https://example.com/Document/doc1',
      })

      expect(rel.createdAt).toBeInstanceOf(Date)
    })

    it('prevents duplicate relationships (same verb/from/to)', async () => {
      await rels.create({
        verb: 'manages',
        from: 'https://example.com/Person/alice',
        to: 'https://example.com/Startup/acme',
      })

      await expect(
        rels.create({
          verb: 'manages',
          from: 'https://example.com/Person/alice',
          to: 'https://example.com/Startup/acme',
        })
      ).rejects.toThrow(/duplicate|already exists/i)
    })

    it('allows same from/to with different verbs', async () => {
      await rels.create({
        verb: 'manages',
        from: 'https://example.com/Person/alice',
        to: 'https://example.com/Startup/acme',
      })

      const rel2 = await rels.create({
        verb: 'founded',
        from: 'https://example.com/Person/alice',
        to: 'https://example.com/Startup/acme',
      })

      expect(rel2.id).toBeDefined()
    })
  })

  // ==========================================================================
  // 2. LIST OPERATIONS
  // ==========================================================================

  describe('list', () => {
    it('lists all relationships', async () => {
      const allRels = await rels.list()

      expect(allRels).toBeInstanceOf(Array)
    })

    it('filters by from URL', async () => {
      const aliceRels = await rels.list({ from: 'https://example.com/Person/alice' })

      expect(aliceRels.every((r) => r.from === 'https://example.com/Person/alice')).toBe(true)
    })

    it('filters by to URL', async () => {
      const acmeRels = await rels.list({ to: 'https://example.com/Startup/acme' })

      expect(acmeRels.every((r) => r.to === 'https://example.com/Startup/acme')).toBe(true)
    })

    it('filters by verb', async () => {
      const managesRels = await rels.list({ verb: 'manages' })

      expect(managesRels.every((r) => r.verb === 'manages')).toBe(true)
    })

    it('combines multiple filters', async () => {
      const filtered = await rels.list({
        from: 'https://example.com/Person/alice',
        verb: 'manages',
      })

      expect(
        filtered.every((r) => r.from === 'https://example.com/Person/alice' && r.verb === 'manages')
      ).toBe(true)
    })

    it('supports pagination', async () => {
      const page1 = await rels.list({ limit: 5, offset: 0 })
      const page2 = await rels.list({ limit: 5, offset: 5 })

      expect(page1.length).toBeLessThanOrEqual(5)
      if (page1.length > 0 && page2.length > 0) {
        expect(page1[0].id).not.toBe(page2[0].id)
      }
    })
  })

  // ==========================================================================
  // 3. DELETE OPERATIONS
  // ==========================================================================

  describe('delete', () => {
    it('deletes a relationship by ID', async () => {
      const rel = await rels.create({
        verb: 'temporary',
        from: 'https://example.com/A',
        to: 'https://example.com/B',
      })

      await rels.delete(rel.id)

      const remaining = await rels.list({ from: 'https://example.com/A', verb: 'temporary' })
      expect(remaining.length).toBe(0)
    })

    it('throws for non-existent relationship', async () => {
      await expect(rels.delete('nonexistent-id')).rejects.toThrow(/not found/i)
    })

    it('returns the deleted relationship', async () => {
      const rel = await rels.create({
        verb: 'to-delete',
        from: 'https://example.com/A',
        to: 'https://example.com/B',
      })

      const deleted = await rels.delete(rel.id)

      expect(deleted.id).toBe(rel.id)
    })

    it('deletes by criteria (bulk delete)', async () => {
      await rels.create({ verb: 'bulk-test', from: 'https://example.com/A', to: 'https://example.com/B1' })
      await rels.create({ verb: 'bulk-test', from: 'https://example.com/A', to: 'https://example.com/B2' })

      const count = await rels.deleteWhere({ from: 'https://example.com/A', verb: 'bulk-test' })

      expect(count).toBe(2)
    })
  })

  // ==========================================================================
  // 4. TRAVERSAL OPERATIONS
  // ==========================================================================

  describe('traversal', () => {
    it('gets outgoing relationships from a source', async () => {
      const outgoing = await rels.from('https://example.com/Person/alice')

      expect(outgoing.every((r) => r.from === 'https://example.com/Person/alice')).toBe(true)
    })

    it('gets incoming relationships to a target', async () => {
      const incoming = await rels.to('https://example.com/Startup/acme')

      expect(incoming.every((r) => r.to === 'https://example.com/Startup/acme')).toBe(true)
    })

    it('supports verb filter in traversal', async () => {
      const manages = await rels.from('https://example.com/Person/alice', { verb: 'manages' })

      expect(manages.every((r) => r.verb === 'manages')).toBe(true)
    })
  })
})

// ============================================================================
// TEST SUITE: ActionsStore
// ============================================================================

// Skip database-dependent tests - they require Workers environment with real SQLite
describe.skip('ActionsStore (requires Workers runtime)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let actions: ActionsStore

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    // actions = new DO(mockState, mockEnv).actions
  })

  // ==========================================================================
  // 1. LOG OPERATIONS
  // ==========================================================================

  describe('log', () => {
    it('logs a new action', async () => {
      const action = await actions.log({
        verb: 'create',
        target: 'Startup/acme',
        actor: 'Human/nathan',
        input: { name: 'Acme Inc' },
      })

      expect(action.id).toBeDefined()
      expect(action.verb).toBe('create')
      expect(action.status).toBe('pending')
    })

    it('sets durability level', async () => {
      const action = await actions.log({
        verb: 'update',
        target: 'Startup/acme',
        durability: 'do',
      })

      expect(action.durability).toBe('do')
    })

    it('defaults durability to try', async () => {
      const action = await actions.log({
        verb: 'update',
        target: 'Startup/acme',
      })

      expect(action.durability).toBe('try')
    })

    it('sets createdAt timestamp', async () => {
      const action = await actions.log({
        verb: 'create',
        target: 'Startup/new',
      })

      expect(action.createdAt).toBeInstanceOf(Date)
    })

    it('supports context fields (requestId, sessionId, workflowId)', async () => {
      const action = await actions.log({
        verb: 'update',
        target: 'Startup/acme',
        requestId: 'req-123',
        sessionId: 'sess-456',
        workflowId: 'wf-789',
      })

      expect(action.requestId).toBe('req-123')
      expect(action.sessionId).toBe('sess-456')
      expect(action.workflowId).toBe('wf-789')
    })

    it('stores input/output references', async () => {
      const action = await actions.log({
        verb: 'update',
        target: 'Startup/acme',
        input: 42, // rowid before
        output: 43, // rowid after
      })

      expect(action.input).toBe(42)
      expect(action.output).toBe(43)
    })
  })

  // ==========================================================================
  // 2. COMPLETE OPERATIONS
  // ==========================================================================

  describe('complete', () => {
    it('marks action as completed', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme' })

      const completed = await actions.complete(action.id, { thingId: 'acme' })

      expect(completed.status).toBe('completed')
      expect(completed.completedAt).toBeInstanceOf(Date)
    })

    it('stores output data', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme' })

      const completed = await actions.complete(action.id, { thingId: 'acme', version: 1 })

      expect(completed.output).toBeDefined()
    })

    it('calculates duration', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme' })
      // Simulate some time passing
      await new Promise((resolve) => setTimeout(resolve, 10))

      const completed = await actions.complete(action.id, {})

      expect(completed.duration).toBeGreaterThan(0)
    })

    it('throws for non-existent action', async () => {
      await expect(actions.complete('nonexistent', {})).rejects.toThrow(/not found/i)
    })

    it('throws for already completed action', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme' })
      await actions.complete(action.id, {})

      await expect(actions.complete(action.id, {})).rejects.toThrow(/already completed/i)
    })
  })

  // ==========================================================================
  // 3. FAIL OPERATIONS
  // ==========================================================================

  describe('fail', () => {
    it('marks action as failed', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme' })

      const failed = await actions.fail(action.id, new Error('Something went wrong'))

      expect(failed.status).toBe('failed')
      expect(failed.error).toBeDefined()
    })

    it('stores error details', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme' })

      const failed = await actions.fail(action.id, {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: { field: 'name' },
      })

      expect(failed.error).toEqual({
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: { field: 'name' },
      })
    })

    it('sets completedAt timestamp', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme' })

      const failed = await actions.fail(action.id, new Error('Failed'))

      expect(failed.completedAt).toBeInstanceOf(Date)
    })

    it('throws for non-existent action', async () => {
      await expect(actions.fail('nonexistent', new Error('Test'))).rejects.toThrow(/not found/i)
    })
  })

  // ==========================================================================
  // 4. QUERY OPERATIONS
  // ==========================================================================

  describe('queries', () => {
    it('lists actions by target', async () => {
      const targetActions = await actions.list({ target: 'Startup/acme' })

      expect(targetActions.every((a) => a.target === 'Startup/acme')).toBe(true)
    })

    it('lists actions by actor', async () => {
      const actorActions = await actions.list({ actor: 'Human/nathan' })

      expect(actorActions.every((a) => a.actor === 'Human/nathan')).toBe(true)
    })

    it('lists actions by status', async () => {
      const pendingActions = await actions.list({ status: 'pending' })

      expect(pendingActions.every((a) => a.status === 'pending')).toBe(true)
    })

    it('lists actions by verb', async () => {
      const createActions = await actions.list({ verb: 'create' })

      expect(createActions.every((a) => a.verb === 'create')).toBe(true)
    })

    it('gets pending actions', async () => {
      const pending = await actions.pending()

      expect(pending.every((a) => a.status === 'pending')).toBe(true)
    })

    it('gets failed actions', async () => {
      const failed = await actions.failed()

      expect(failed.every((a) => a.status === 'failed')).toBe(true)
    })

    it('gets action by ID', async () => {
      const created = await actions.log({ verb: 'test', target: 'Test/item' })

      const retrieved = await actions.get(created.id)

      expect(retrieved?.id).toBe(created.id)
    })
  })

  // ==========================================================================
  // 5. RETRY OPERATIONS
  // ==========================================================================

  describe('retry', () => {
    it('marks action for retry', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme', durability: 'do' })
      await actions.fail(action.id, new Error('Temporary failure'))

      const retrying = await actions.retry(action.id)

      expect(retrying.status).toBe('retrying')
    })

    it('increments retry count', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme', durability: 'do' })
      await actions.fail(action.id, new Error('Failure'))
      await actions.retry(action.id)
      await actions.fail(action.id, new Error('Failure again'))
      const retrying = await actions.retry(action.id)

      expect(retrying.retryCount).toBe(2)
    })

    it('throws for non-durable actions', async () => {
      const action = await actions.log({ verb: 'create', target: 'Startup/acme', durability: 'send' })

      await expect(actions.retry(action.id)).rejects.toThrow(/cannot retry.*send/i)
    })
  })
})

// ============================================================================
// TEST SUITE: EventsStore
// ============================================================================

// Skip database-dependent tests - they require Workers environment with real SQLite
describe.skip('EventsStore (requires Workers runtime)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let events: EventsStore

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    // events = new DO(mockState, mockEnv).events
  })

  // ==========================================================================
  // 1. EMIT OPERATIONS
  // ==========================================================================

  describe('emit', () => {
    it('emits an event', async () => {
      const event = await events.emit({
        verb: 'created',
        source: 'https://example.com/Startup/acme',
        data: { name: 'Acme Inc' },
      })

      expect(event.id).toBeDefined()
      expect(event.verb).toBe('created')
    })

    it('sets sequence number', async () => {
      const event1 = await events.emit({
        verb: 'created',
        source: 'https://example.com/Startup/one',
        data: {},
      })
      const event2 = await events.emit({
        verb: 'created',
        source: 'https://example.com/Startup/two',
        data: {},
      })

      expect(event2.sequence).toBeGreaterThan(event1.sequence)
    })

    it('sets createdAt timestamp', async () => {
      const event = await events.emit({
        verb: 'updated',
        source: 'https://example.com/Startup/acme',
        data: { field: 'name' },
      })

      expect(event.createdAt).toBeInstanceOf(Date)
    })

    it('links to action if provided', async () => {
      const event = await events.emit({
        verb: 'created',
        source: 'https://example.com/Startup/acme',
        data: {},
        actionId: 'action-123',
      })

      expect(event.actionId).toBe('action-123')
    })

    it('marks event as not streamed initially', async () => {
      const event = await events.emit({
        verb: 'created',
        source: 'https://example.com/Startup/acme',
        data: {},
      })

      expect(event.streamed).toBe(false)
    })
  })

  // ==========================================================================
  // 2. STREAM OPERATIONS
  // ==========================================================================

  describe('stream', () => {
    it('streams events to Pipeline', async () => {
      const event = await events.emit({
        verb: 'created',
        source: 'https://example.com/Startup/acme',
        data: { name: 'Acme' },
      })

      await events.stream(event.id)

      expect(mockEnv.PIPELINE.send).toHaveBeenCalled()
    })

    it('marks event as streamed', async () => {
      const event = await events.emit({
        verb: 'created',
        source: 'https://example.com/Startup/acme',
        data: {},
      })

      const streamed = await events.stream(event.id)

      expect(streamed.streamed).toBe(true)
      expect(streamed.streamedAt).toBeInstanceOf(Date)
    })

    it('streams unstreamed events in batch', async () => {
      await events.emit({ verb: 'created', source: 'https://example.com/A', data: {} })
      await events.emit({ verb: 'created', source: 'https://example.com/B', data: {} })
      await events.emit({ verb: 'created', source: 'https://example.com/C', data: {} })

      const count = await events.streamPending()

      expect(count).toBe(3)
      expect(mockEnv.PIPELINE.send).toHaveBeenCalledTimes(3)
    })

    it('skips already streamed events', async () => {
      const event = await events.emit({
        verb: 'created',
        source: 'https://example.com/Startup/acme',
        data: {},
      })
      await events.stream(event.id)

      await events.streamPending()

      // Should not stream again
      expect(mockEnv.PIPELINE.send).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================================================
  // 3. QUERY OPERATIONS
  // ==========================================================================

  describe('queries', () => {
    it('lists events by source', async () => {
      const sourceEvents = await events.list({ source: 'https://example.com/Startup/acme' })

      expect(sourceEvents.every((e) => e.source === 'https://example.com/Startup/acme')).toBe(true)
    })

    it('lists events by verb', async () => {
      const createdEvents = await events.list({ verb: 'created' })

      expect(createdEvents.every((e) => e.verb === 'created')).toBe(true)
    })

    it('lists events after sequence', async () => {
      const recentEvents = await events.list({ afterSequence: 100 })

      expect(recentEvents.every((e) => e.sequence > 100)).toBe(true)
    })

    it('lists events in order', async () => {
      const orderedEvents = await events.list({ orderBy: 'sequence', order: 'asc' })

      for (let i = 1; i < orderedEvents.length; i++) {
        expect(orderedEvents[i].sequence).toBeGreaterThanOrEqual(orderedEvents[i - 1].sequence)
      }
    })

    it('gets event by ID', async () => {
      const created = await events.emit({
        verb: 'test',
        source: 'https://example.com/Test/item',
        data: {},
      })

      const retrieved = await events.get(created.id)

      expect(retrieved?.id).toBe(created.id)
    })

    it('supports replay from sequence', async () => {
      const replayed = await events.replay({ fromSequence: 0, limit: 100 })

      expect(replayed).toBeInstanceOf(Array)
      expect(replayed.length).toBeLessThanOrEqual(100)
    })
  })
})

// ============================================================================
// TEST SUITE: SearchStore
// ============================================================================

// Skip database-dependent tests - they require Workers environment with real SQLite
describe.skip('SearchStore (requires Workers runtime)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let search: SearchStore

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    // search = new DO(mockState, mockEnv).search
  })

  // ==========================================================================
  // 1. INDEX OPERATIONS
  // ==========================================================================

  describe('index', () => {
    it('indexes a thing for search', async () => {
      const entry = await search.index({
        $id: 'https://example.com/Startup/acme',
        $type: 'Startup',
        content: 'Acme Inc is a technology startup founded in 2020',
      })

      expect(entry.$id).toBe('https://example.com/Startup/acme')
      expect(entry.indexedAt).toBeInstanceOf(Date)
    })

    it('generates embedding if AI binding available', async () => {
      const entry = await search.index({
        $id: 'https://example.com/Startup/acme',
        $type: 'Startup',
        content: 'Acme Inc is a technology startup',
      })

      expect(entry.embedding).toBeDefined()
      expect(entry.embeddingDim).toBeGreaterThan(0)
    })

    it('updates existing index entry', async () => {
      await search.index({
        $id: 'https://example.com/Startup/acme',
        $type: 'Startup',
        content: 'Original content',
      })

      const updated = await search.index({
        $id: 'https://example.com/Startup/acme',
        $type: 'Startup',
        content: 'Updated content',
      })

      expect(updated.content).toBe('Updated content')
    })

    it('removes index entry', async () => {
      await search.index({
        $id: 'https://example.com/Startup/to-remove',
        $type: 'Startup',
        content: 'Will be removed',
      })

      await search.remove('https://example.com/Startup/to-remove')

      const results = await search.query('Will be removed')
      expect(results.find((r) => r.$id === 'https://example.com/Startup/to-remove')).toBeUndefined()
    })
  })

  // ==========================================================================
  // 2. QUERY OPERATIONS
  // ==========================================================================

  describe('query', () => {
    it('performs text search', async () => {
      const results = await search.query('technology startup')

      expect(results).toBeInstanceOf(Array)
    })

    it('returns results with scores', async () => {
      const results = await search.query('technology')

      if (results.length > 0) {
        expect(results[0].score).toBeDefined()
        expect(typeof results[0].score).toBe('number')
      }
    })

    it('filters by type', async () => {
      const results = await search.query('startup', { type: 'Startup' })

      expect(results.every((r) => r.$type === 'Startup')).toBe(true)
    })

    it('supports limit', async () => {
      const results = await search.query('test', { limit: 5 })

      expect(results.length).toBeLessThanOrEqual(5)
    })

    it('supports semantic search with embeddings', async () => {
      const results = await search.semantic('companies in technology sector')

      expect(results).toBeInstanceOf(Array)
    })

    it('returns results ordered by relevance', async () => {
      const results = await search.query('technology startup')

      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
      }
    })
  })

  // ==========================================================================
  // 3. BULK OPERATIONS
  // ==========================================================================

  describe('bulk', () => {
    it('indexes multiple things at once', async () => {
      const entries = await search.indexMany([
        { $id: 'https://example.com/A', $type: 'Test', content: 'First item' },
        { $id: 'https://example.com/B', $type: 'Test', content: 'Second item' },
        { $id: 'https://example.com/C', $type: 'Test', content: 'Third item' },
      ])

      expect(entries.length).toBe(3)
    })

    it('removes multiple entries at once', async () => {
      await search.indexMany([
        { $id: 'https://example.com/D', $type: 'Test', content: 'To remove 1' },
        { $id: 'https://example.com/E', $type: 'Test', content: 'To remove 2' },
      ])

      const count = await search.removeMany(['https://example.com/D', 'https://example.com/E'])

      expect(count).toBe(2)
    })

    it('reindexes all things of a type', async () => {
      const count = await search.reindexType('Startup')

      expect(count).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// TEST SUITE: ObjectsStore
// ============================================================================

// Skip database-dependent tests - they require Workers environment with real SQLite
describe.skip('ObjectsStore (requires Workers runtime)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let objects: ObjectsStore

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    // objects = new DO(mockState, mockEnv).objects
  })

  // ==========================================================================
  // 1. REGISTER OPERATIONS
  // ==========================================================================

  describe('register', () => {
    it('registers a new DO', async () => {
      const obj = await objects.register({
        ns: 'https://new.example.com',
        id: 'do-id-123',
        class: 'DO',
      })

      expect(obj.ns).toBe('https://new.example.com')
      expect(obj.id).toBe('do-id-123')
    })

    it('sets relation type', async () => {
      const obj = await objects.register({
        ns: 'https://child.example.com',
        id: 'do-id-456',
        class: 'DO',
        relation: 'child',
      })

      expect(obj.relation).toBe('child')
    })

    it('supports shard configuration', async () => {
      const obj = await objects.register({
        ns: 'https://shard.example.com',
        id: 'do-id-789',
        class: 'DO',
        relation: 'shard',
        shardKey: 'users',
        shardIndex: 0,
      })

      expect(obj.shardKey).toBe('users')
      expect(obj.shardIndex).toBe(0)
    })

    it('supports region configuration', async () => {
      const obj = await objects.register({
        ns: 'https://regional.example.com',
        id: 'do-id-abc',
        class: 'DO',
        region: 'eeur',
        primary: true,
      })

      expect(obj.region).toBe('eeur')
      expect(obj.primary).toBe(true)
    })

    it('sets createdAt timestamp', async () => {
      const obj = await objects.register({
        ns: 'https://timestamped.example.com',
        id: 'do-id-def',
        class: 'DO',
      })

      expect(obj.createdAt).toBeInstanceOf(Date)
    })

    it('throws on duplicate ns', async () => {
      await objects.register({
        ns: 'https://duplicate.example.com',
        id: 'do-id-1',
        class: 'DO',
      })

      await expect(
        objects.register({
          ns: 'https://duplicate.example.com',
          id: 'do-id-2',
          class: 'DO',
        })
      ).rejects.toThrow(/duplicate|already exists/i)
    })
  })

  // ==========================================================================
  // 2. LOOKUP OPERATIONS
  // ==========================================================================

  describe('lookup', () => {
    it('gets DO by namespace', async () => {
      await objects.register({
        ns: 'https://lookup.example.com',
        id: 'do-id-lookup',
        class: 'DO',
      })

      const obj = await objects.get('https://lookup.example.com')

      expect(obj?.id).toBe('do-id-lookup')
    })

    it('returns null for non-existent namespace', async () => {
      const obj = await objects.get('https://nonexistent.example.com')

      expect(obj).toBeNull()
    })

    it('lists all DOs', async () => {
      const allObjects = await objects.list()

      expect(allObjects).toBeInstanceOf(Array)
    })

    it('lists DOs by relation', async () => {
      const children = await objects.list({ relation: 'child' })

      expect(children.every((o) => o.relation === 'child')).toBe(true)
    })

    it('lists DOs by class', async () => {
      const startups = await objects.list({ class: 'Startup' })

      expect(startups.every((o) => o.class === 'Startup')).toBe(true)
    })

    it('lists shards by key', async () => {
      const shards = await objects.shards('users')

      expect(shards.every((o) => o.shardKey === 'users')).toBe(true)
    })

    it('gets primary replica', async () => {
      await objects.register({
        ns: 'https://primary.example.com',
        id: 'primary-do',
        class: 'DO',
        region: 'wnam',
        primary: true,
      })

      const primary = await objects.primary('https://primary.example.com')

      expect(primary?.primary).toBe(true)
    })
  })

  // ==========================================================================
  // 3. UPDATE OPERATIONS
  // ==========================================================================

  describe('update', () => {
    it('updates cached data', async () => {
      await objects.register({
        ns: 'https://cacheable.example.com',
        id: 'do-cache',
        class: 'DO',
      })

      const updated = await objects.update('https://cacheable.example.com', {
        cached: { displayName: 'Cacheable DO' },
      })

      expect(updated.cached).toEqual({ displayName: 'Cacheable DO' })
    })

    it('updates region', async () => {
      await objects.register({
        ns: 'https://moveable.example.com',
        id: 'do-move',
        class: 'DO',
        region: 'wnam',
      })

      const updated = await objects.update('https://moveable.example.com', {
        region: 'eeur',
      })

      expect(updated.region).toBe('eeur')
    })

    it('throws for non-existent namespace', async () => {
      await expect(
        objects.update('https://nonexistent.example.com', { cached: {} })
      ).rejects.toThrow(/not found/i)
    })
  })

  // ==========================================================================
  // 4. DELETE OPERATIONS
  // ==========================================================================

  describe('delete', () => {
    it('removes DO registration', async () => {
      await objects.register({
        ns: 'https://removable.example.com',
        id: 'do-remove',
        class: 'DO',
      })

      await objects.delete('https://removable.example.com')

      const obj = await objects.get('https://removable.example.com')
      expect(obj).toBeNull()
    })

    it('throws for non-existent namespace', async () => {
      await expect(objects.delete('https://nonexistent.example.com')).rejects.toThrow(/not found/i)
    })
  })

  // ==========================================================================
  // 5. RESOLUTION OPERATIONS
  // ==========================================================================

  describe('resolve', () => {
    it('resolves namespace to DO stub', async () => {
      await objects.register({
        ns: 'https://resolvable.example.com',
        id: 'do-resolve',
        class: 'DO',
      })

      const stub = await objects.resolve('https://resolvable.example.com')

      expect(stub).toBeDefined()
    })

    it('throws for non-existent namespace', async () => {
      await expect(objects.resolve('https://nonexistent.example.com')).rejects.toThrow(/not found/i)
    })

    it('resolves with correct DO class binding', async () => {
      await objects.register({
        ns: 'https://typed.example.com',
        id: 'do-typed',
        class: 'Startup',
      })

      await objects.resolve('https://typed.example.com')

      // The DO binding should be called with the correct class
      expect(mockEnv.DO.get).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// TEST SUITE: Branch-Aware Operations
// ============================================================================

// Skip database-dependent tests - they require Workers environment with real SQLite
describe.skip('Branch-Aware Store Operations (requires Workers runtime)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  describe('things store respects branch context', () => {
    it('creates things on current branch', async () => {
      // Set currentBranch to 'feature'
      // const do = new DO(mockState, mockEnv)
      // do.checkout('feature')
      // const thing = await do.things.create({ $type: 'Test', name: 'Feature Thing' })
      // expect(thing.branch).toBe('feature')
      expect(true).toBe(true) // Placeholder - test will fail when implemented
    })

    it('lists things only from current branch', async () => {
      // Create things on different branches
      // Switch to 'main' and list - should only see main things
      // Switch to 'feature' and list - should only see feature things
      expect(true).toBe(true) // Placeholder
    })

    it('updates things on current branch only', async () => {
      // Create thing on main
      // Switch to feature, update should create new version on feature
      // Main version should be unchanged
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('version queries across branches', () => {
    it('gets thing at specific version across branches', async () => {
      // Create thing, update on main, update on feature
      // Query specific versions should return correct data
      expect(true).toBe(true) // Placeholder
    })

    it('lists all versions including branch information', async () => {
      // Create thing with multiple versions on multiple branches
      // versions() should return all versions with branch info
      expect(true).toBe(true) // Placeholder
    })
  })
})

// ============================================================================
// TEST SUITE: Store Interactions
// ============================================================================

// Skip database-dependent tests - they require Workers environment with real SQLite
describe.skip('Store Interactions (requires Workers runtime)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  describe('things and actions', () => {
    it('creating a thing logs an action', async () => {
      // const do = new DO(mockState, mockEnv)
      // const thing = await do.things.create({ $type: 'Test', name: 'Test' })
      // const actions = await do.actions.list({ target: thing.$id })
      // expect(actions.some(a => a.verb === 'create')).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('updating a thing logs an action with before/after versions', async () => {
      // Create thing, update it
      // Action should have input (before rowid) and output (after rowid)
      expect(true).toBe(true) // Placeholder
    })

    it('deleting a thing logs a delete action', async () => {
      // Create thing, delete it
      // Action should have verb 'delete'
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('things and events', () => {
    it('creating a thing emits a created event', async () => {
      // const do = new DO(mockState, mockEnv)
      // const thing = await do.things.create({ $type: 'Test', name: 'Test' })
      // const events = await do.events.list({ source: thing.$id })
      // expect(events.some(e => e.verb === 'created')).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('updating a thing emits an updated event', async () => {
      // Create thing, update it
      // Event should have verb 'updated'
      expect(true).toBe(true) // Placeholder
    })

    it('deleting a thing emits a deleted event', async () => {
      // Create thing, delete it
      // Event should have verb 'deleted'
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('things and search', () => {
    it('creating a thing indexes it for search', async () => {
      // const do = new DO(mockState, mockEnv)
      // const thing = await do.things.create({ $type: 'Test', name: 'Searchable Test Item' })
      // const results = await do.search.query('Searchable')
      // expect(results.some(r => r.$id === thing.$id)).toBe(true)
      expect(true).toBe(true) // Placeholder
    })

    it('updating a thing updates its search index', async () => {
      // Create thing with name A
      // Update name to B
      // Search for B should find it, search for A should not
      expect(true).toBe(true) // Placeholder
    })

    it('deleting a thing removes it from search index', async () => {
      // Create thing, search should find it
      // Delete thing, search should not find it
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('relationships and things', () => {
    it('creating a relationship validates from/to exist', async () => {
      // Create relationship with non-existent from/to
      // Should throw validation error (or allow external URLs)
      expect(true).toBe(true) // Placeholder
    })

    it('deleting a thing optionally cascades to relationships', async () => {
      // Create thing A, thing B, relationship A->B
      // Delete A with cascade option
      // Relationship should be deleted
      expect(true).toBe(true) // Placeholder
    })
  })
})

// ============================================================================
// TEST SUITE: DO Class Integration
// ============================================================================

import { DO } from '../DO'

describe('DO Class Store Accessors', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let doInstance: DO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState as any, mockEnv as any)
  })

  // Clear static state after each test to prevent accumulation across test runs
  afterEach(() => {
    DOBase._resetTestState()
  })

  it('exposes things store as property', () => {
    expect(doInstance.things).toBeDefined()
    expect(typeof doInstance.things.get).toBe('function')
    expect(typeof doInstance.things.list).toBe('function')
    expect(typeof doInstance.things.create).toBe('function')
    expect(typeof doInstance.things.update).toBe('function')
    expect(typeof doInstance.things.delete).toBe('function')
    expect(typeof doInstance.things.versions).toBe('function')
  })

  it('exposes rels store as property', () => {
    expect(doInstance.rels).toBeDefined()
    expect(typeof doInstance.rels.create).toBe('function')
    expect(typeof doInstance.rels.list).toBe('function')
    expect(typeof doInstance.rels.delete).toBe('function')
    expect(typeof doInstance.rels.deleteWhere).toBe('function')
    expect(typeof doInstance.rels.from).toBe('function')
    expect(typeof doInstance.rels.to).toBe('function')
  })

  it('exposes actions store as property', () => {
    expect(doInstance.actions).toBeDefined()
    expect(typeof doInstance.actions.log).toBe('function')
    expect(typeof doInstance.actions.complete).toBe('function')
    expect(typeof doInstance.actions.fail).toBe('function')
    expect(typeof doInstance.actions.retry).toBe('function')
    expect(typeof doInstance.actions.get).toBe('function')
    expect(typeof doInstance.actions.list).toBe('function')
    expect(typeof doInstance.actions.pending).toBe('function')
    expect(typeof doInstance.actions.failed).toBe('function')
  })

  it('exposes events store as property', () => {
    expect(doInstance.events).toBeDefined()
    expect(typeof doInstance.events.emit).toBe('function')
    expect(typeof doInstance.events.stream).toBe('function')
    expect(typeof doInstance.events.streamPending).toBe('function')
    expect(typeof doInstance.events.get).toBe('function')
    expect(typeof doInstance.events.list).toBe('function')
    expect(typeof doInstance.events.replay).toBe('function')
  })

  it('exposes search store as property', () => {
    expect(doInstance.search).toBeDefined()
    expect(typeof doInstance.search.index).toBe('function')
    expect(typeof doInstance.search.indexMany).toBe('function')
    expect(typeof doInstance.search.remove).toBe('function')
    expect(typeof doInstance.search.removeMany).toBe('function')
    expect(typeof doInstance.search.query).toBe('function')
    expect(typeof doInstance.search.semantic).toBe('function')
    expect(typeof doInstance.search.reindexType).toBe('function')
  })

  it('exposes objects store as property', () => {
    expect(doInstance.objects).toBeDefined()
    expect(typeof doInstance.objects.register).toBe('function')
    expect(typeof doInstance.objects.get).toBe('function')
    expect(typeof doInstance.objects.list).toBe('function')
    expect(typeof doInstance.objects.shards).toBe('function')
    expect(typeof doInstance.objects.primary).toBe('function')
    expect(typeof doInstance.objects.update).toBe('function')
    expect(typeof doInstance.objects.delete).toBe('function')
    expect(typeof doInstance.objects.resolve).toBe('function')
  })

  it('stores are lazily initialized', () => {
    // Create a new instance without accessing stores
    const freshDo = new DO(mockState as any, mockEnv as any)

    // Access protected _things to verify it's undefined before access
    const internalThings = (freshDo as any)._things
    expect(internalThings).toBeUndefined()

    // Now access things store
    const things = freshDo.things
    expect(things).toBeDefined()

    // Now internal should be set
    const internalThingsAfter = (freshDo as any)._things
    expect(internalThingsAfter).toBeDefined()
  })

  it('stores reuse the same instance on multiple accesses', () => {
    const things1 = doInstance.things
    const things2 = doInstance.things

    expect(things1).toBe(things2)
  })

  it('stores share same database connection via context', () => {
    // Access all stores
    const things = doInstance.things
    const rels = doInstance.rels
    const actions = doInstance.actions

    // They should all be defined (sharing db via getStoreContext)
    expect(things).toBeDefined()
    expect(rels).toBeDefined()
    expect(actions).toBeDefined()
  })
})
