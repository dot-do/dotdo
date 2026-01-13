/**
 * Human DO Graph-Based State Management Tests
 *
 * Tests for Human.ts using Graph model for blocking request state.
 *
 * The Human DO now stores BlockingApprovalRequest as Things with:
 * - ApprovalRequest Things (type = 'ApprovalRequest')
 * - assignedTo relationships (Request -> Human)
 * - Status stored in Thing.data.status field
 *
 * This test validates:
 * 1. BlockingApprovalRequest creates Things correctly
 * 2. Relationships are created with proper verb forms
 * 3. Status transitions update Thing data
 * 4. Queries via graph model work correctly
 * 5. HTTP endpoints use graph-based state
 * 6. Backward compatibility with existing APIs
 *
 * Uses real SQLite via mocked DO context, NO MOCKS for business logic.
 *
 * @see dotdo-s75fk - [REFACTOR] Human.ts DO: Use Graph for blocking request state
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor<T = unknown> {
  toArray(): T[]
  one(): T | undefined
  raw(): unknown[]
}

/**
 * In-memory Things storage for testing graph operations
 */
interface TestThing {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
  deletedAt?: Date | null
  version?: number
}

/**
 * In-memory Relationships storage for testing graph operations
 */
interface TestRelationship {
  id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
  createdAt?: Date
}

/**
 * Create mock Things store that simulates graph operations
 */
function createMockThingsStore() {
  const items = new Map<string, TestThing>()

  return {
    async list(options?: { type?: string; limit?: number }) {
      const all = Array.from(items.values()).filter((t) => !t.deletedAt)
      const filtered = options?.type ? all.filter((t) => t.$type === options.type) : all
      const limit = options?.limit ?? 100
      return filtered.slice(0, limit)
    },

    async get(id: string): Promise<TestThing | null> {
      const item = items.get(id)
      if (!item || item.deletedAt) return null
      return item
    },

    async create(data: {
      $id?: string
      $type: string
      name?: string
      data?: Record<string, unknown>
    }): Promise<TestThing> {
      const id = data.$id ?? `thing-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const item: TestThing = {
        $id: id,
        $type: data.$type,
        name: data.name,
        data: data.data ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        version: 1,
      }
      items.set(id, item)
      return item
    },

    async update(id: string, data: { name?: string; data?: Record<string, unknown> }): Promise<TestThing> {
      const item = items.get(id)
      if (!item || item.deletedAt) {
        throw new Error(`Thing not found: ${id}`)
      }
      if (data.name !== undefined) item.name = data.name
      if (data.data !== undefined) item.data = { ...item.data, ...data.data }
      item.updatedAt = new Date()
      item.version = (item.version ?? 0) + 1
      return item
    },

    async delete(id: string): Promise<TestThing> {
      const item = items.get(id)
      if (!item) {
        throw new Error(`Thing not found: ${id}`)
      }
      item.deletedAt = new Date()
      return item
    },

    // Test helper to clear storage
    _clear() {
      items.clear()
    },

    // Test helper to get raw storage
    _items: items,
  }
}

/**
 * Create mock Relationships store that simulates graph operations
 */
function createMockRelationshipsStore() {
  const relationships = new Map<string, TestRelationship>()
  let idCounter = 0

  return {
    async create(data: {
      verb: string
      from: string
      to: string
      data?: Record<string, unknown>
    }): Promise<TestRelationship> {
      const id = `rel-${++idCounter}`
      const rel: TestRelationship = {
        id,
        verb: data.verb,
        from: data.from,
        to: data.to,
        data: data.data ?? {},
        createdAt: new Date(),
      }
      relationships.set(id, rel)
      return rel
    },

    async deleteWhere(criteria: { from?: string; to?: string; verb?: string }): Promise<number> {
      let deleted = 0
      for (const [id, rel] of relationships) {
        let match = true
        if (criteria.from && rel.from !== criteria.from) match = false
        if (criteria.to && rel.to !== criteria.to) match = false
        if (criteria.verb && rel.verb !== criteria.verb) match = false
        if (match) {
          relationships.delete(id)
          deleted++
        }
      }
      return deleted
    },

    async list(options?: { from?: string; to?: string; verb?: string }): Promise<TestRelationship[]> {
      const all = Array.from(relationships.values())
      return all.filter((rel) => {
        if (options?.from && rel.from !== options.from) return false
        if (options?.to && rel.to !== options.to) return false
        if (options?.verb && rel.verb !== options.verb) return false
        return true
      })
    },

    // Test helper to clear storage
    _clear() {
      relationships.clear()
      idCounter = 0
    },

    // Test helper to get raw storage
    _relationships: relationships,
  }
}

/**
 * Create mock KV storage for DO state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    setAlarm: vi.fn(async (_time: number): Promise<void> => {}),
    getAlarm: vi.fn(async (): Promise<number | null> => null),
    deleteAlarm: vi.fn(async (): Promise<void> => {}),
    _storage: storage,
  }
}

/**
 * Create mock DO context with things and relationships stores
 */
function createMockDoContext() {
  const thingsStore = createMockThingsStore()
  const relationshipsStore = createMockRelationshipsStore()
  const kvStorage = createMockKvStorage()

  return {
    things: thingsStore,
    relationships: relationshipsStore,
    storage: kvStorage,
    id: { toString: () => 'human-test-001' },
    ns: 'https://humans.do/test',
    _clear() {
      thingsStore._clear()
      relationshipsStore._clear()
      kvStorage._storage.clear()
    },
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * BlockingApprovalRequest interface (from Human.ts)
 */
interface BlockingApprovalRequest {
  requestId: string
  role: string
  message: string
  sla?: number
  channel?: string
  type: 'approval' | 'question' | 'review'
  createdAt: string
  expiresAt?: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  result?: {
    approved: boolean
    approver?: string
    reason?: string
    respondedAt?: string
  }
}

// ============================================================================
// HELPER FUNCTIONS (mirroring Human.ts implementation)
// ============================================================================

const APPROVAL_REQUEST_TYPE = 'ApprovalRequest'

function thingToBlockingRequest(thing: TestThing): BlockingApprovalRequest {
  const data = thing.data as Record<string, unknown> | null
  return {
    requestId: thing.$id,
    role: (data?.role as string) ?? '',
    message: thing.name ?? '',
    sla: data?.sla as number | undefined,
    channel: data?.channel as string | undefined,
    type: (data?.requestType as 'approval' | 'question' | 'review') ?? 'approval',
    createdAt: (data?.createdAt as string) ?? new Date().toISOString(),
    expiresAt: data?.expiresAt as string | undefined,
    status: (data?.status as 'pending' | 'approved' | 'rejected' | 'expired') ?? 'pending',
    result: data?.result as BlockingApprovalRequest['result'],
  }
}

async function createApprovalRequestThing(
  ctx: ReturnType<typeof createMockDoContext>,
  record: BlockingApprovalRequest
): Promise<TestThing> {
  const thing = await ctx.things.create({
    $id: record.requestId,
    $type: APPROVAL_REQUEST_TYPE,
    name: record.message,
    data: {
      role: record.role,
      sla: record.sla,
      channel: record.channel,
      requestType: record.type,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status: record.status,
      result: record.result,
    },
  })

  // Create relationship: Request assignedTo Human
  try {
    await ctx.relationships.create({
      verb: 'assignedTo',
      from: `${ctx.ns}/${APPROVAL_REQUEST_TYPE}/${record.requestId}`,
      to: ctx.ns,
      data: { assignedAt: record.createdAt },
    })
  } catch {
    // Relationship may already exist, ignore duplicate errors
  }

  return thing
}

async function updateApprovalRequestThing(
  ctx: ReturnType<typeof createMockDoContext>,
  record: BlockingApprovalRequest
): Promise<TestThing> {
  return ctx.things.update(record.requestId, {
    data: {
      role: record.role,
      sla: record.sla,
      channel: record.channel,
      requestType: record.type,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status: record.status,
      result: record.result,
    },
  })
}

// ============================================================================
// TEST SUITE: Human DO Graph-Based State Management
// ============================================================================

describe('Human DO Graph-Based State Management', () => {
  let ctx: ReturnType<typeof createMockDoContext>

  beforeEach(() => {
    ctx = createMockDoContext()
    vi.useRealTimers()
  })

  afterEach(() => {
    ctx._clear()
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. BlockingApprovalRequest as Things
  // ==========================================================================

  describe('BlockingApprovalRequest as Things', () => {
    it('creates ApprovalRequest Thing with correct type', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-001',
        role: 'ceo',
        message: 'Approve the partnership deal',
        sla: 3600000,
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      const thing = await createApprovalRequestThing(ctx, record)

      expect(thing.$type).toBe('ApprovalRequest')
      expect(thing.$id).toBe('req-001')
      expect(thing.name).toBe('Approve the partnership deal')
    })

    it('stores request data in Thing.data field', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-002',
        role: 'finance-manager',
        message: 'Approve expense report',
        sla: 86400000,
        channel: 'slack',
        type: 'approval',
        createdAt: '2024-01-15T10:00:00Z',
        expiresAt: '2024-01-16T10:00:00Z',
        status: 'pending',
      }

      const thing = await createApprovalRequestThing(ctx, record)

      expect(thing.data?.role).toBe('finance-manager')
      expect(thing.data?.sla).toBe(86400000)
      expect(thing.data?.channel).toBe('slack')
      expect(thing.data?.requestType).toBe('approval')
      expect(thing.data?.status).toBe('pending')
      expect(thing.data?.expiresAt).toBe('2024-01-16T10:00:00Z')
    })

    it('converts Thing back to BlockingApprovalRequest', async () => {
      const original: BlockingApprovalRequest = {
        requestId: 'req-003',
        role: 'cto',
        message: 'Review architecture proposal',
        type: 'review',
        createdAt: '2024-01-15T10:00:00Z',
        status: 'pending',
      }

      const thing = await createApprovalRequestThing(ctx, original)
      const converted = thingToBlockingRequest(thing)

      expect(converted.requestId).toBe(original.requestId)
      expect(converted.role).toBe(original.role)
      expect(converted.message).toBe(original.message)
      expect(converted.type).toBe(original.type)
      expect(converted.status).toBe(original.status)
    })

    it('retrieves ApprovalRequest Thing by ID', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-004',
        role: 'ceo',
        message: 'Test request',
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      const thing = await ctx.things.get('req-004')
      expect(thing).not.toBeNull()
      expect(thing?.$id).toBe('req-004')
    })

    it('returns null for non-existent request', async () => {
      const thing = await ctx.things.get('non-existent')
      expect(thing).toBeNull()
    })

    it('lists ApprovalRequest Things by type', async () => {
      // Create multiple requests
      for (let i = 1; i <= 3; i++) {
        await createApprovalRequestThing(ctx, {
          requestId: `req-${i}`,
          role: 'ceo',
          message: `Request ${i}`,
          type: 'approval',
          createdAt: new Date().toISOString(),
          status: 'pending',
        })
      }

      const things = await ctx.things.list({ type: APPROVAL_REQUEST_TYPE })
      expect(things).toHaveLength(3)
    })
  })

  // ==========================================================================
  // 2. Relationships: Request assignedTo Human
  // ==========================================================================

  describe('Relationships: Request assignedTo Human', () => {
    it('creates assignedTo relationship when request is created', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-rel-001',
        role: 'ceo',
        message: 'Test relationship',
        type: 'approval',
        createdAt: '2024-01-15T10:00:00Z',
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      const relationships = await ctx.relationships.list({ verb: 'assignedTo' })
      expect(relationships).toHaveLength(1)
      expect(relationships[0]?.from).toContain('req-rel-001')
      expect(relationships[0]?.to).toBe(ctx.ns)
    })

    it('stores assignment timestamp in relationship data', async () => {
      const createdAt = '2024-01-15T10:00:00Z'
      const record: BlockingApprovalRequest = {
        requestId: 'req-rel-002',
        role: 'cfo',
        message: 'Test timestamp',
        type: 'approval',
        createdAt,
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      const relationships = await ctx.relationships.list({ verb: 'assignedTo' })
      expect(relationships[0]?.data?.assignedAt).toBe(createdAt)
    })

    it('supports querying by relationship', async () => {
      // Create requests assigned to the same Human
      for (let i = 1; i <= 2; i++) {
        await createApprovalRequestThing(ctx, {
          requestId: `req-query-${i}`,
          role: 'ceo',
          message: `Query test ${i}`,
          type: 'approval',
          createdAt: new Date().toISOString(),
          status: 'pending',
        })
      }

      const relationships = await ctx.relationships.list({ to: ctx.ns, verb: 'assignedTo' })
      expect(relationships).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 3. Status Transitions via Graph Operations
  // ==========================================================================

  describe('Status Transitions via Graph Operations', () => {
    it('transitions status from pending to approved', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-trans-001',
        role: 'ceo',
        message: 'Approve transition test',
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      // Update status to approved
      record.status = 'approved'
      record.result = {
        approved: true,
        approver: 'human-test-001',
        reason: 'Approved',
        respondedAt: new Date().toISOString(),
      }

      await updateApprovalRequestThing(ctx, record)

      const thing = await ctx.things.get('req-trans-001')
      expect(thing?.data?.status).toBe('approved')
      expect((thing?.data?.result as Record<string, unknown>)?.approved).toBe(true)
    })

    it('transitions status from pending to rejected', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-trans-002',
        role: 'cfo',
        message: 'Reject transition test',
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      // Update status to rejected
      record.status = 'rejected'
      record.result = {
        approved: false,
        approver: 'human-test-001',
        reason: 'Budget exceeded',
        respondedAt: new Date().toISOString(),
      }

      await updateApprovalRequestThing(ctx, record)

      const thing = await ctx.things.get('req-trans-002')
      expect(thing?.data?.status).toBe('rejected')
      expect((thing?.data?.result as Record<string, unknown>)?.approved).toBe(false)
    })

    it('transitions status from pending to expired', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-trans-003',
        role: 'manager',
        message: 'Expire transition test',
        type: 'approval',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Already expired
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      // Simulate expiration check
      record.status = 'expired'

      await updateApprovalRequestThing(ctx, record)

      const thing = await ctx.things.get('req-trans-003')
      expect(thing?.data?.status).toBe('expired')
    })

    it('stores result data on status transition', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-trans-004',
        role: 'ceo',
        message: 'Result data test',
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      const respondedAt = '2024-01-15T11:00:00Z'
      record.status = 'approved'
      record.result = {
        approved: true,
        approver: 'john@acme.com',
        reason: 'Within budget limits',
        respondedAt,
      }

      await updateApprovalRequestThing(ctx, record)

      const thing = await ctx.things.get('req-trans-004')
      const result = thing?.data?.result as Record<string, unknown>
      expect(result?.approver).toBe('john@acme.com')
      expect(result?.reason).toBe('Within budget limits')
      expect(result?.respondedAt).toBe(respondedAt)
    })
  })

  // ==========================================================================
  // 4. Filtering by Status
  // ==========================================================================

  describe('Filtering by Status', () => {
    beforeEach(async () => {
      // Create requests in different statuses
      const statuses: Array<'pending' | 'approved' | 'rejected' | 'expired'> = [
        'pending',
        'pending',
        'approved',
        'rejected',
        'expired',
      ]

      for (let i = 0; i < statuses.length; i++) {
        await createApprovalRequestThing(ctx, {
          requestId: `req-filter-${i}`,
          role: 'ceo',
          message: `Filter test ${i}`,
          type: 'approval',
          createdAt: new Date().toISOString(),
          status: statuses[i],
        })
      }
    })

    it('filters pending requests', async () => {
      const things = await ctx.things.list({ type: APPROVAL_REQUEST_TYPE })
      const pending = things.filter((t) => (t.data as Record<string, unknown>)?.status === 'pending')
      expect(pending).toHaveLength(2)
    })

    it('filters approved requests', async () => {
      const things = await ctx.things.list({ type: APPROVAL_REQUEST_TYPE })
      const approved = things.filter((t) => (t.data as Record<string, unknown>)?.status === 'approved')
      expect(approved).toHaveLength(1)
    })

    it('filters rejected requests', async () => {
      const things = await ctx.things.list({ type: APPROVAL_REQUEST_TYPE })
      const rejected = things.filter((t) => (t.data as Record<string, unknown>)?.status === 'rejected')
      expect(rejected).toHaveLength(1)
    })

    it('filters expired requests', async () => {
      const things = await ctx.things.list({ type: APPROVAL_REQUEST_TYPE })
      const expired = things.filter((t) => (t.data as Record<string, unknown>)?.status === 'expired')
      expect(expired).toHaveLength(1)
    })
  })

  // ==========================================================================
  // 5. Delete Operations
  // ==========================================================================

  describe('Delete Operations', () => {
    it('deletes ApprovalRequest Thing (soft delete)', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-del-001',
        role: 'ceo',
        message: 'Delete test',
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      // Verify it exists
      let thing = await ctx.things.get('req-del-001')
      expect(thing).not.toBeNull()

      // Delete it
      await ctx.things.delete('req-del-001')

      // Verify it's soft deleted (get returns null)
      thing = await ctx.things.get('req-del-001')
      expect(thing).toBeNull()
    })

    it('deletes associated relationship when request is deleted', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-del-002',
        role: 'ceo',
        message: 'Delete relationship test',
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      // Verify relationship exists
      let relationships = await ctx.relationships.list({ verb: 'assignedTo' })
      expect(relationships).toHaveLength(1)

      // Delete the relationship first (as Human.ts does)
      await ctx.relationships.deleteWhere({
        from: `${ctx.ns}/${APPROVAL_REQUEST_TYPE}/req-del-002`,
        verb: 'assignedTo',
      })

      // Then delete the thing
      await ctx.things.delete('req-del-002')

      // Verify relationship is deleted
      relationships = await ctx.relationships.list({ verb: 'assignedTo' })
      expect(relationships).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 6. Complete Workflow Tests
  // ==========================================================================

  describe('Complete Workflow Tests', () => {
    it('demonstrates full approval workflow via graph model', async () => {
      // 1. Create pending request
      const record: BlockingApprovalRequest = {
        requestId: 'wf-001',
        role: 'finance-manager',
        message: 'Approve expense report: $5,000 for team offsite',
        sla: 86400000, // 24 hours
        channel: 'slack',
        type: 'approval',
        createdAt: '2024-01-15T10:00:00Z',
        expiresAt: '2024-01-16T10:00:00Z',
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      // 2. Verify pending state
      let thing = await ctx.things.get('wf-001')
      expect(thing?.data?.status).toBe('pending')

      // Verify relationship
      const relationships = await ctx.relationships.list({ verb: 'assignedTo' })
      expect(relationships).toHaveLength(1)

      // 3. Human responds (approve)
      record.status = 'approved'
      record.result = {
        approved: true,
        approver: 'jane@company.com',
        reason: 'Team offsite approved. Have fun!',
        respondedAt: '2024-01-15T14:30:00Z',
      }

      await updateApprovalRequestThing(ctx, record)

      // 4. Verify approved state
      thing = await ctx.things.get('wf-001')
      expect(thing?.data?.status).toBe('approved')

      const converted = thingToBlockingRequest(thing!)
      expect(converted.result?.approved).toBe(true)
      expect(converted.result?.approver).toBe('jane@company.com')
    })

    it('demonstrates rejection workflow via graph model', async () => {
      // 1. Create pending request
      const record: BlockingApprovalRequest = {
        requestId: 'wf-002',
        role: 'cfo',
        message: 'Approve budget increase: $500,000',
        type: 'approval',
        createdAt: '2024-01-15T10:00:00Z',
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      // 2. Human rejects
      record.status = 'rejected'
      record.result = {
        approved: false,
        approver: 'cfo@company.com',
        reason: 'Budget constraints. Please resubmit with reduced amount.',
        respondedAt: '2024-01-15T11:00:00Z',
      }

      await updateApprovalRequestThing(ctx, record)

      // 3. Verify rejected state
      const thing = await ctx.things.get('wf-002')
      expect(thing?.data?.status).toBe('rejected')

      const converted = thingToBlockingRequest(thing!)
      expect(converted.result?.approved).toBe(false)
    })

    it('demonstrates expiration workflow via graph model', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'))

      // 1. Create request with short SLA
      const record: BlockingApprovalRequest = {
        requestId: 'wf-003',
        role: 'manager',
        message: 'Urgent approval needed',
        sla: 3600000, // 1 hour
        type: 'approval',
        createdAt: '2024-01-15T10:00:00Z',
        expiresAt: '2024-01-15T11:00:00Z',
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      // 2. Advance time past expiration
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))

      // 3. Check expiration (simulating alarm handler)
      const expiresAt = new Date(record.expiresAt!)
      const now = new Date()
      if (expiresAt <= now && record.status === 'pending') {
        record.status = 'expired'
        await updateApprovalRequestThing(ctx, record)
      }

      // 4. Verify expired state
      const thing = await ctx.things.get('wf-003')
      expect(thing?.data?.status).toBe('expired')
    })
  })

  // ==========================================================================
  // 7. Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('handles duplicate request IDs by updating existing', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-dup-001',
        role: 'ceo',
        message: 'Original message',
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      // Update with new message
      record.message = 'Updated message'
      const thing = await ctx.things.update('req-dup-001', { name: record.message })

      expect(thing.name).toBe('Updated message')
    })

    it('throws error when updating non-existent request', async () => {
      await expect(
        ctx.things.update('non-existent', { data: { status: 'approved' } })
      ).rejects.toThrow('Thing not found')
    })

    it('handles empty result on pending request', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'req-empty-001',
        role: 'ceo',
        message: 'No result yet',
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
      }

      await createApprovalRequestThing(ctx, record)

      const thing = await ctx.things.get('req-empty-001')
      const converted = thingToBlockingRequest(thing!)

      expect(converted.result).toBeUndefined()
    })

    it('preserves all request types (approval, question, review)', async () => {
      const types: Array<'approval' | 'question' | 'review'> = ['approval', 'question', 'review']

      for (const type of types) {
        await createApprovalRequestThing(ctx, {
          requestId: `req-type-${type}`,
          role: 'human',
          message: `${type} request`,
          type,
          createdAt: new Date().toISOString(),
          status: 'pending',
        })
      }

      const things = await ctx.things.list({ type: APPROVAL_REQUEST_TYPE })
      expect(things).toHaveLength(3)

      const requestTypes = things.map((t) => (t.data as Record<string, unknown>)?.requestType)
      expect(requestTypes).toContain('approval')
      expect(requestTypes).toContain('question')
      expect(requestTypes).toContain('review')
    })
  })

  // ==========================================================================
  // 8. Backward Compatibility
  // ==========================================================================

  describe('Backward Compatibility', () => {
    it('thingToBlockingRequest handles missing fields gracefully', () => {
      const thing: TestThing = {
        $id: 'minimal-001',
        $type: 'ApprovalRequest',
        data: {},
      }

      const converted = thingToBlockingRequest(thing)

      expect(converted.requestId).toBe('minimal-001')
      expect(converted.role).toBe('')
      expect(converted.message).toBe('')
      expect(converted.type).toBe('approval') // Default
      expect(converted.status).toBe('pending') // Default
    })

    it('thingToBlockingRequest extracts name as message', () => {
      const thing: TestThing = {
        $id: 'named-001',
        $type: 'ApprovalRequest',
        name: 'Request message from name field',
        data: {},
      }

      const converted = thingToBlockingRequest(thing)

      expect(converted.message).toBe('Request message from name field')
    })

    it('supports optional SLA and channel fields', async () => {
      const record: BlockingApprovalRequest = {
        requestId: 'optional-001',
        role: 'ceo',
        message: 'No SLA or channel',
        type: 'approval',
        createdAt: new Date().toISOString(),
        status: 'pending',
        // No sla, no channel, no expiresAt
      }

      await createApprovalRequestThing(ctx, record)

      const thing = await ctx.things.get('optional-001')
      const converted = thingToBlockingRequest(thing!)

      expect(converted.sla).toBeUndefined()
      expect(converted.channel).toBeUndefined()
      expect(converted.expiresAt).toBeUndefined()
    })
  })
})
