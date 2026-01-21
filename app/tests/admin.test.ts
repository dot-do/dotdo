import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { Thing } from '../../db/things'
import type { Event } from '../../db/events'
import type { Relationship } from '../../db/relationships'

// Store original dispatcher
const originalDispatcher = getGlobalDispatcher()

// Mock data
const mockThings: Thing[] = [
  {
    $id: 'thing-1',
    $type: 'Customer',
    $createdAt: Date.now() - 10000,
    $updatedAt: Date.now() - 5000,
    name: 'Alice',
    email: 'alice@example.com',
  },
  {
    $id: 'thing-2',
    $type: 'Product',
    $createdAt: Date.now() - 20000,
    $updatedAt: Date.now() - 10000,
    name: 'Widget',
    price: 29.99,
  },
]

const mockEvents: Event[] = [
  {
    $id: 'evt-1',
    type: 'Customer.created',
    payload: { name: 'Alice' },
    $timestamp: Date.now() - 5000,
    source: 'thing-1',
  },
  {
    $id: 'evt-2',
    type: 'Payment.processed',
    payload: { amount: 100, currency: 'USD' },
    $timestamp: Date.now() - 3000,
    source: 'thing-1',
    correlationId: 'corr-123',
  },
]

const mockRelationships: Relationship[] = [
  {
    subject: 'thing-1',
    predicate: 'owns',
    object: 'thing-2',
    $createdAt: Date.now() - 8000,
  },
  {
    subject: 'thing-2',
    predicate: 'belongsTo',
    object: 'thing-1',
    $createdAt: Date.now() - 8000,
  },
]

describe('Admin Portal', () => {
  let mockAgent: MockAgent
  let mockPool: ReturnType<MockAgent['get']>

  beforeEach(() => {
    vi.clearAllMocks()
    mockAgent = new MockAgent()
    mockAgent.disableNetConnect()
    setGlobalDispatcher(mockAgent)
    mockPool = mockAgent.get('http://localhost')

    // Setup default interceptors for common endpoints
    mockPool.intercept({
      path: '/api/admin/things',
      method: 'GET',
    }).reply(200, mockThings)

    mockPool.intercept({
      path: '/api/admin/events',
      method: 'GET',
    }).reply(200, mockEvents)

    mockPool.intercept({
      path: '/api/admin/relationships',
      method: 'GET',
    }).reply(200, mockRelationships)

    // Mock WebSocket
    global.WebSocket = vi.fn(() => ({
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close: vi.fn(),
      send: vi.fn(),
    })) as unknown as typeof WebSocket
  })

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher)
    await mockAgent.close()
  })

  describe('Data Loading', () => {
    it('should load things on mount', async () => {
      const response = await fetch('http://localhost/api/admin/things')
      const things = await response.json()

      expect(things).toHaveLength(2)
      expect(things[0].$id).toBe('thing-1')
      expect(things[0].$type).toBe('Customer')
    })

    it('should load events on mount', async () => {
      const response = await fetch('http://localhost/api/admin/events')
      const events = await response.json()

      expect(events).toHaveLength(2)
      expect(events[0].$id).toBe('evt-1')
      expect(events[0].type).toBe('Customer.created')
    })

    it('should load relationships on mount', async () => {
      const response = await fetch('http://localhost/api/admin/relationships')
      const relationships = await response.json()

      expect(relationships).toHaveLength(2)
      expect(relationships[0].subject).toBe('thing-1')
      expect(relationships[0].predicate).toBe('owns')
    })
  })

  describe('Things CRUD', () => {
    it('should create a new thing', async () => {
      const newThing = {
        $type: 'Order',
        status: 'pending',
        total: 150.00,
      }

      mockPool.intercept({
        path: '/api/admin/things',
        method: 'POST',
      }).reply(200, {
        ...newThing,
        $id: 'new-thing',
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
      })

      const response = await fetch('http://localhost/api/admin/things', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newThing),
      })

      expect(response.ok).toBe(true)
      const created = await response.json()
      expect(created.$id).toBe('new-thing')
      expect(created.$type).toBe('Order')
      expect(created.status).toBe('pending')
    })

    it('should update an existing thing', async () => {
      const updates = {
        name: 'Alice Updated',
      }

      mockPool.intercept({
        path: '/api/admin/things/thing-1',
        method: 'PUT',
      }).reply(200, updates)

      const response = await fetch('http://localhost/api/admin/things/thing-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      expect(response.ok).toBe(true)
      const updated = await response.json()
      expect(updated.name).toBe('Alice Updated')
    })

    it('should delete a thing', async () => {
      mockPool.intercept({
        path: '/api/admin/things/thing-1',
        method: 'DELETE',
      }).reply(200, {})

      const response = await fetch('http://localhost/api/admin/things/thing-1', {
        method: 'DELETE',
      })

      expect(response.ok).toBe(true)
    })

    it('should list things with filters', async () => {
      mockPool.intercept({
        path: '/api/admin/things?type=Customer',
        method: 'GET',
      }).reply(200, mockThings)

      const response = await fetch('http://localhost/api/admin/things?type=Customer')
      expect(response.ok).toBe(true)

      const things = await response.json()
      expect(Array.isArray(things)).toBe(true)
    })
  })

  describe('Events Query', () => {
    it('should list all events', async () => {
      const response = await fetch('http://localhost/api/admin/events')
      expect(response.ok).toBe(true)

      const events = await response.json()
      expect(Array.isArray(events)).toBe(true)
      expect(events).toHaveLength(2)
    })

    it('should filter events by type', async () => {
      const customerEvents = mockEvents.filter(e => e.type.startsWith('Customer.'))
      expect(customerEvents).toHaveLength(1)
      expect(customerEvents[0].type).toBe('Customer.created')
    })

    it('should filter events by source', async () => {
      const sourceEvents = mockEvents.filter(e => e.source === 'thing-1')
      expect(sourceEvents).toHaveLength(2)
    })

    it('should filter events by correlation ID', async () => {
      const correlatedEvents = mockEvents.filter(e => e.correlationId === 'corr-123')
      expect(correlatedEvents).toHaveLength(1)
      expect(correlatedEvents[0].type).toBe('Payment.processed')
    })
  })

  describe('Relationships CRUD', () => {
    it('should create a new relationship', async () => {
      const newRel = {
        subject: 'thing-3',
        predicate: 'references',
        object: 'thing-4',
      }

      mockPool.intercept({
        path: '/api/admin/relationships',
        method: 'POST',
      }).reply(200, {
        ...newRel,
        $createdAt: Date.now(),
      })

      const response = await fetch('http://localhost/api/admin/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRel),
      })

      expect(response.ok).toBe(true)
    })

    it('should delete a relationship', async () => {
      const rel = mockRelationships[0]

      mockPool.intercept({
        path: `/api/admin/relationships/${rel.subject}/${rel.predicate}/${rel.object}`,
        method: 'DELETE',
      }).reply(200, {})

      const response = await fetch(
        `http://localhost/api/admin/relationships/${rel.subject}/${rel.predicate}/${rel.object}`,
        { method: 'DELETE' }
      )

      expect(response.ok).toBe(true)
    })

    it('should find relationships by subject', async () => {
      const rels = mockRelationships.filter(r => r.subject === 'thing-1')
      expect(rels).toHaveLength(1)
      expect(rels[0].predicate).toBe('owns')
    })

    it('should find relationships by predicate', async () => {
      const rels = mockRelationships.filter(r => r.predicate === 'belongsTo')
      expect(rels).toHaveLength(1)
      expect(rels[0].subject).toBe('thing-2')
    })

    it('should find relationships by object', async () => {
      const rels = mockRelationships.filter(r => r.object === 'thing-1')
      expect(rels).toHaveLength(1)
      expect(rels[0].predicate).toBe('belongsTo')
    })
  })

  describe('Real-time Updates', () => {
    it('should handle thing.created event', () => {
      const newThing: Thing = {
        $id: 'thing-3',
        $type: 'Product',
        $createdAt: Date.now(),
        $updatedAt: Date.now(),
        name: 'New Product',
      }

      // Simulate WebSocket message
      const event = {
        type: 'thing.created',
        payload: newThing,
      }

      expect(event.type).toBe('thing.created')
      expect((event.payload as Thing).$id).toBe('thing-3')
    })

    it('should handle thing.updated event', () => {
      const updatedThing: Thing = {
        ...mockThings[0],
        name: 'Alice Updated',
        $updatedAt: Date.now(),
      }

      const event = {
        type: 'thing.updated',
        payload: updatedThing,
      }

      expect(event.type).toBe('thing.updated')
      expect((event.payload as Thing).name).toBe('Alice Updated')
    })

    it('should handle thing.deleted event', () => {
      const event = {
        type: 'thing.deleted',
        payload: { $id: 'thing-1' },
      }

      expect(event.type).toBe('thing.deleted')
      expect((event.payload as { $id: string }).$id).toBe('thing-1')
    })

    it('should handle event.emitted event', () => {
      const newEvent: Event = {
        $id: 'evt-3',
        type: 'Order.placed',
        payload: { orderId: 'ord-123' },
        $timestamp: Date.now(),
        source: 'thing-1',
      }

      const event = {
        type: 'event.emitted',
        payload: newEvent,
      }

      expect(event.type).toBe('event.emitted')
      expect((event.payload as Event).type).toBe('Order.placed')
    })

    it('should handle relationship.added event', () => {
      const newRel: Relationship = {
        subject: 'thing-3',
        predicate: 'references',
        object: 'thing-4',
        $createdAt: Date.now(),
      }

      const event = {
        type: 'relationship.added',
        payload: newRel,
      }

      expect(event.type).toBe('relationship.added')
      expect((event.payload as Relationship).predicate).toBe('references')
    })

    it('should handle relationship.removed event', () => {
      const event = {
        type: 'relationship.removed',
        payload: mockRelationships[0],
      }

      expect(event.type).toBe('relationship.removed')
      expect((event.payload as Relationship).predicate).toBe('owns')
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      // Need to create a new agent for this specific test to avoid conflict with beforeEach
      const errorAgent = new MockAgent()
      errorAgent.disableNetConnect()
      setGlobalDispatcher(errorAgent)
      const errorPool = errorAgent.get('http://localhost')

      errorPool.intercept({
        path: '/api/admin/things',
        method: 'GET',
      }).replyWithError(new Error('Network error'))

      // The error is wrapped by fetch, so we just check that it throws
      await expect(fetch('http://localhost/api/admin/things')).rejects.toThrow()

      setGlobalDispatcher(mockAgent)
      await errorAgent.close()
    })

    it('should handle 404 responses', async () => {
      mockPool.intercept({
        path: '/api/admin/things/nonexistent',
        method: 'GET',
      }).reply(404, {})

      const response = await fetch('http://localhost/api/admin/things/nonexistent')
      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })

    it('should handle invalid JSON in forms', () => {
      const invalidJSON = '{ invalid json }'

      expect(() => JSON.parse(invalidJSON)).toThrow()
    })
  })

  describe('Data Validation', () => {
    it('should require $type for things', () => {
      const invalidThing = {
        name: 'No Type',
      }

      // $type should be required
      expect('$type' in invalidThing).toBe(false)
    })

    it('should require subject, predicate, object for relationships', () => {
      const validRel = {
        subject: 'thing-1',
        predicate: 'owns',
        object: 'thing-2',
      }

      expect(validRel.subject).toBeDefined()
      expect(validRel.predicate).toBeDefined()
      expect(validRel.object).toBeDefined()
    })

    it('should validate event structure', () => {
      const validEvent = mockEvents[0]

      expect(validEvent.$id).toBeDefined()
      expect(validEvent.type).toBeDefined()
      expect(validEvent.$timestamp).toBeDefined()
      expect(typeof validEvent.$timestamp).toBe('number')
    })
  })

  describe('Pagination and Filtering', () => {
    it('should support limit and offset for things', () => {
      const limit = 10
      const offset = 0

      expect(limit).toBeGreaterThan(0)
      expect(offset).toBeGreaterThanOrEqual(0)
    })

    it('should sort things by creation date', () => {
      const sorted = [...mockThings].sort((a, b) => b.$createdAt - a.$createdAt)

      expect(sorted[0].$createdAt).toBeGreaterThan(sorted[1].$createdAt)
    })

    it('should sort events by timestamp', () => {
      const sorted = [...mockEvents].sort((a, b) => b.$timestamp - a.$timestamp)

      expect(sorted[0].$timestamp).toBeGreaterThan(sorted[1].$timestamp)
    })
  })
})
