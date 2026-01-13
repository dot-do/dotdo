/**
 * DOBase Integration Tests - NO MOCKS
 *
 * Tests DOBase functionality using real miniflare DO instances with actual
 * SQLite storage. This follows the CLAUDE.md guidance to NEVER use mocks
 * for Durable Object tests.
 *
 * Tests via RPC (preferred - 95% of tests) to the TestDOBase class.
 *
 * @module objects/tests/dobase-real.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import type { ThingEntity } from '../../db/stores'

// ============================================================================
// TYPES
// ============================================================================

interface TestDOBaseStub extends DurableObjectStub {
  // RPC methods
  createThing(data: Partial<ThingEntity>): Promise<ThingEntity>
  getThing(id: string): Promise<ThingEntity | null>
  listThings(options?: { type?: string }): Promise<ThingEntity[]>
  updateThing(id: string, data: Partial<ThingEntity>): Promise<ThingEntity>
  deleteThing(id: string): Promise<ThingEntity | null>
  createRel(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<{ id: string }>
  listRels(options?: { from?: string; to?: string; verb?: string }): Promise<Array<{ id: string; verb: string; from: string; to: string }>>
  logAction(options: { verb: string; target: string; actor?: string }): Promise<{ id: string; status: string }>
  emitEvent(options: { verb: string; source: string; data: Record<string, unknown> }): Promise<{ id: string }>
  getHealth(): Promise<{ status: string; ns: string; type: string }>
}

interface TestEnv {
  DO_BASE: DurableObjectNamespace
}

// ============================================================================
// TEST HELPERS
// ============================================================================

let testCounter = 0
function uniqueNs(): string {
  return `dobase-test-${Date.now()}-${++testCounter}`
}

// ============================================================================
// TESTS: DOBase Core Functionality
// ============================================================================

describe('DOBase Integration Tests (Real Miniflare)', () => {
  let stub: TestDOBaseStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as TestEnv).DO_BASE.idFromName(ns)
    stub = (env as TestEnv).DO_BASE.get(id) as TestDOBaseStub
  })

  // ==========================================================================
  // HEALTH CHECK
  // ==========================================================================

  describe('Health Check', () => {
    it('responds to health check via RPC', async () => {
      const health = await stub.getHealth()

      expect(health.status).toBe('ok')
      expect(health.type).toBe('TestDOBase')
    })

    it('responds to health check via fetch', async () => {
      const response = await stub.fetch(new Request('https://test.api/health'))

      expect(response.status).toBe(200)

      const data = await response.json() as { status: string }
      expect(data.status).toBe('ok')
    })
  })

  // ==========================================================================
  // THINGS STORE (CRUD)
  // ==========================================================================

  describe('Things Store', () => {
    describe('create', () => {
      it('creates a thing with $type', async () => {
        const thing = await stub.createThing({
          $type: 'Customer',
          name: 'Alice',
        })

        expect(thing.$id).toBeDefined()
        expect(thing.$type).toBe('Customer')
        expect(thing.name).toBe('Alice')
      })

      it('generates UUID for $id if not provided', async () => {
        const thing = await stub.createThing({
          $type: 'Customer',
          name: 'Bob',
        })

        expect(thing.$id).toMatch(/^[0-9a-f-]{36}$/)
      })

      it('uses provided $id if specified', async () => {
        const thing = await stub.createThing({
          $id: 'custom-id-123',
          $type: 'Customer',
          name: 'Charlie',
        })

        expect(thing.$id).toBe('custom-id-123')
      })

      it('stores data field', async () => {
        const thing = await stub.createThing({
          $type: 'Customer',
          name: 'David',
          data: { email: 'david@example.com', tier: 'premium' },
        })

        expect(thing.data).toEqual({ email: 'david@example.com', tier: 'premium' })
      })
    })

    describe('get', () => {
      it('retrieves a thing by ID', async () => {
        const created = await stub.createThing({
          $type: 'Product',
          name: 'Widget',
        })

        const retrieved = await stub.getThing(created.$id)

        expect(retrieved).not.toBeNull()
        expect(retrieved!.$id).toBe(created.$id)
        expect(retrieved!.name).toBe('Widget')
      })

      it('returns null for non-existent thing', async () => {
        const thing = await stub.getThing('nonexistent-id')

        expect(thing).toBeNull()
      })
    })

    describe('list', () => {
      it('lists all things', async () => {
        await stub.createThing({ $type: 'Order', name: 'Order 1' })
        await stub.createThing({ $type: 'Order', name: 'Order 2' })
        await stub.createThing({ $type: 'Order', name: 'Order 3' })

        const things = await stub.listThings()

        expect(things.length).toBeGreaterThanOrEqual(3)
      })

      it('filters by type', async () => {
        await stub.createThing({ $type: 'Customer', name: 'Customer A' })
        await stub.createThing({ $type: 'Product', name: 'Product B' })
        await stub.createThing({ $type: 'Customer', name: 'Customer C' })

        const customers = await stub.listThings({ type: 'Customer' })

        expect(customers.length).toBeGreaterThanOrEqual(2)
        expect(customers.every((t) => t.$type === 'Customer')).toBe(true)
      })
    })

    describe('update', () => {
      it('updates a thing by ID', async () => {
        const created = await stub.createThing({
          $type: 'Customer',
          name: 'Original Name',
        })

        const updated = await stub.updateThing(created.$id, {
          name: 'Updated Name',
        })

        expect(updated.name).toBe('Updated Name')
        expect(updated.$id).toBe(created.$id)
      })

      it('preserves unchanged fields', async () => {
        const created = await stub.createThing({
          $type: 'Customer',
          name: 'Test',
          data: { email: 'test@example.com' },
        })

        const updated = await stub.updateThing(created.$id, {
          name: 'New Name',
        })

        expect(updated.data).toEqual({ email: 'test@example.com' })
      })
    })

    describe('delete', () => {
      it('soft deletes a thing', async () => {
        const created = await stub.createThing({
          $type: 'Customer',
          name: 'ToDelete',
        })

        const deleted = await stub.deleteThing(created.$id)

        expect(deleted).not.toBeNull()
        expect(deleted!.deleted).toBe(true)
      })

      it('returns null for non-existent thing', async () => {
        const result = await stub.deleteThing('nonexistent')

        expect(result).toBeNull()
      })
    })
  })

  // ==========================================================================
  // RELATIONSHIPS STORE
  // ==========================================================================

  describe('Relationships Store', () => {
    describe('create', () => {
      it('creates a relationship', async () => {
        const customer = await stub.createThing({ $type: 'Customer', name: 'Alice' })
        const order = await stub.createThing({ $type: 'Order', name: 'Order 1' })

        const rel = await stub.createRel({
          verb: 'placed',
          from: `Customer/${customer.$id}`,
          to: `Order/${order.$id}`,
        })

        expect(rel.id).toBeDefined()
      })

      it('creates relationship with data payload', async () => {
        const rel = await stub.createRel({
          verb: 'invested',
          from: 'Investor/inv-1',
          to: 'Startup/startup-1',
          data: { amount: 1000000, round: 'seed' },
        })

        expect(rel.id).toBeDefined()
      })
    })

    describe('list', () => {
      it('lists relationships', async () => {
        await stub.createRel({ verb: 'manages', from: 'Person/alice', to: 'Project/proj-1' })
        await stub.createRel({ verb: 'manages', from: 'Person/alice', to: 'Project/proj-2' })

        const rels = await stub.listRels({ from: 'Person/alice' })

        expect(rels.length).toBeGreaterThanOrEqual(2)
        expect(rels.every((r) => r.from === 'Person/alice')).toBe(true)
      })

      it('filters by verb', async () => {
        await stub.createRel({ verb: 'owns', from: 'Person/bob', to: 'Asset/house' })
        await stub.createRel({ verb: 'manages', from: 'Person/bob', to: 'Team/eng' })

        const ownsRels = await stub.listRels({ from: 'Person/bob', verb: 'owns' })

        expect(ownsRels.length).toBe(1)
        expect(ownsRels[0]!.verb).toBe('owns')
      })
    })
  })

  // ==========================================================================
  // ACTIONS STORE
  // ==========================================================================

  describe('Actions Store', () => {
    it('logs an action', async () => {
      const action = await stub.logAction({
        verb: 'create',
        target: 'Customer/cust-123',
        actor: 'Human/nathan',
      })

      expect(action.id).toBeDefined()
      expect(action.status).toBe('pending')
    })
  })

  // ==========================================================================
  // EVENTS STORE
  // ==========================================================================

  describe('Events Store', () => {
    it('emits an event', async () => {
      const event = await stub.emitEvent({
        verb: 'created',
        source: 'Customer/cust-456',
        data: { name: 'New Customer' },
      })

      expect(event.id).toBeDefined()
    })
  })

  // ==========================================================================
  // REST ROUTER (HTTP API)
  // ==========================================================================

  describe('REST Router', () => {
    it('handles GET /health', async () => {
      const response = await stub.fetch(new Request('https://test.api/health'))

      expect(response.status).toBe(200)
    })

    it('handles POST to create thing via REST', async () => {
      const response = await stub.fetch(
        new Request('https://test.api/customers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-DO-NS': ns,
          },
          body: JSON.stringify({
            name: 'REST Customer',
            data: { via: 'rest' },
          }),
        })
      )

      expect(response.status).toBe(201)

      const data = await response.json() as { $id: string; name: string }
      expect(data.$id).toBeDefined()
      expect(data.name).toBe('REST Customer')
    })

    it('handles GET list via REST', async () => {
      // Create some things first
      await stub.createThing({ $type: 'Product', name: 'Product A' })
      await stub.createThing({ $type: 'Product', name: 'Product B' })

      const response = await stub.fetch(
        new Request('https://test.api/products', {
          headers: { 'X-DO-NS': ns },
        })
      )

      expect(response.status).toBe(200)

      const data = await response.json() as { items: Array<{ name: string }> }
      expect(data.items).toBeDefined()
    })
  })
})
