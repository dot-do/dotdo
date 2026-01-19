import { describe, it, expect, beforeEach } from 'vitest'
import { AdminDO } from '../admin'
import { createThingsStore, createEventsStore, createRelationshipsStore } from '../../db'

describe('Admin Interface', () => {
  let admin: AdminDO
  let things: ReturnType<typeof createThingsStore>
  let events: ReturnType<typeof createEventsStore>
  let relationships: ReturnType<typeof createRelationshipsStore>

  beforeEach(() => {
    things = createThingsStore()
    events = createEventsStore()
    relationships = createRelationshipsStore()

    admin = new AdminDO({
      things,
      events,
      relationships
    })
  })

  describe('listEntities', () => {
    it('should list all entities with type filter', async () => {
      await things.create({ $type: 'Customer', name: 'Alice' })
      await things.create({ $type: 'Customer', name: 'Bob' })
      await things.create({ $type: 'Order', total: 100 })

      const result = await admin.listEntities({ type: 'Customer' })

      expect(result.entities).toHaveLength(2)
      expect(result.entities[0].$type).toBe('Customer')
      expect(result.total).toBe(2)
    })

    it('should list all entities without filter', async () => {
      await things.create({ $type: 'Customer', name: 'Alice' })
      await things.create({ $type: 'Order', total: 100 })

      const result = await admin.listEntities()

      expect(result.entities).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should support pagination', async () => {
      await things.create({ $type: 'Customer', name: 'Alice' })
      await things.create({ $type: 'Customer', name: 'Bob' })
      await things.create({ $type: 'Customer', name: 'Charlie' })

      const page1 = await admin.listEntities({ limit: 2, offset: 0 })
      expect(page1.entities).toHaveLength(2)

      const page2 = await admin.listEntities({ limit: 2, offset: 2 })
      expect(page2.entities).toHaveLength(1)
    })

    it('should include metadata about entity types', async () => {
      await things.create({ $type: 'Customer', name: 'Alice' })
      await things.create({ $type: 'Customer', name: 'Bob' })
      await things.create({ $type: 'Order', total: 100 })

      const result = await admin.listEntities()

      expect(result.meta?.types).toEqual({
        Customer: 2,
        Order: 1
      })
    })
  })

  describe('listEvents', () => {
    it('should list events with type filter', async () => {
      await events.emit({ type: 'Customer.created', payload: { id: '1' } })
      await events.emit({ type: 'Customer.updated', payload: { id: '1' } })
      await events.emit({ type: 'Order.created', payload: { id: '2' } })

      const result = await admin.listEvents({ type: 'Customer.created' })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('Customer.created')
      expect(result.total).toBe(1)
    })

    it('should filter by time range', async () => {
      const now = Date.now()
      await events.emit({ type: 'test.event', payload: {} })

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10))

      const later = Date.now()
      await events.emit({ type: 'test.event', payload: {} })

      const result = await admin.listEvents({ since: later })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].$timestamp).toBeGreaterThanOrEqual(later)
    })

    it('should filter by source', async () => {
      await events.emit({ type: 'test.event', payload: {}, source: 'system' })
      await events.emit({ type: 'test.event', payload: {}, source: 'user-123' })

      const result = await admin.listEvents({ source: 'system' })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].source).toBe('system')
    })

    it('should support pagination', async () => {
      await events.emit({ type: 'test.event', payload: {} })
      await events.emit({ type: 'test.event', payload: {} })
      await events.emit({ type: 'test.event', payload: {} })

      const page1 = await admin.listEvents({ limit: 2, offset: 0 })
      expect(page1.events).toHaveLength(2)

      const page2 = await admin.listEvents({ limit: 2, offset: 2 })
      expect(page2.events).toHaveLength(1)
    })
  })

  describe('listRelationships', () => {
    it('should list all relationships', async () => {
      await relationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await relationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-2' })

      const result = await admin.listRelationships()

      expect(result.relationships).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should filter by subject', async () => {
      await relationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await relationships.add({ subject: 'user-2', predicate: 'owns', object: 'order-2' })

      const result = await admin.listRelationships({ subject: 'user-1' })

      expect(result.relationships).toHaveLength(1)
      expect(result.relationships[0].subject).toBe('user-1')
    })

    it('should filter by predicate', async () => {
      await relationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await relationships.add({ subject: 'user-1', predicate: 'created', object: 'post-1' })

      const result = await admin.listRelationships({ predicate: 'owns' })

      expect(result.relationships).toHaveLength(1)
      expect(result.relationships[0].predicate).toBe('owns')
    })

    it('should filter by object', async () => {
      await relationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await relationships.add({ subject: 'user-2', predicate: 'owns', object: 'order-1' })

      const result = await admin.listRelationships({ object: 'order-1' })

      expect(result.relationships).toHaveLength(2)
      expect(result.relationships[0].object).toBe('order-1')
    })
  })

  describe('emitEvent', () => {
    it('should emit a manual event', async () => {
      const event = await admin.emitEvent({
        type: 'admin.test',
        payload: { message: 'test' },
        source: 'admin'
      })

      expect(event.$id).toBeDefined()
      expect(event.type).toBe('admin.test')
      expect(event.payload).toEqual({ message: 'test' })
      expect(event.source).toBe('admin')
    })

    it('should store emitted events', async () => {
      await admin.emitEvent({
        type: 'admin.test',
        payload: { message: 'test' }
      })

      const result = await admin.listEvents({ type: 'admin.test' })
      expect(result.events).toHaveLength(1)
    })

    it('should support correlation ID', async () => {
      const event = await admin.emitEvent({
        type: 'admin.test',
        payload: {},
        correlationId: 'test-correlation-123'
      })

      expect(event.correlationId).toBe('test-correlation-123')
    })
  })

  describe('inspectState', () => {
    it('should return comprehensive state summary', async () => {
      await things.create({ $type: 'Customer', name: 'Alice' })
      await things.create({ $type: 'Order', total: 100 })
      await events.emit({ type: 'test.event', payload: {} })
      await relationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })

      const state = await admin.inspectState()

      expect(state.entities.total).toBe(2)
      expect(state.entities.byType).toEqual({
        Customer: 1,
        Order: 1
      })
      expect(state.events.total).toBe(1)
      expect(state.relationships.total).toBe(1)
    })

    it('should include event type breakdown', async () => {
      await events.emit({ type: 'Customer.created', payload: {} })
      await events.emit({ type: 'Customer.created', payload: {} })
      await events.emit({ type: 'Order.created', payload: {} })

      const state = await admin.inspectState()

      expect(state.events.byType).toEqual({
        'Customer.created': 2,
        'Order.created': 1
      })
    })

    it('should include relationship predicate breakdown', async () => {
      await relationships.add({ subject: 'user-1', predicate: 'owns', object: 'order-1' })
      await relationships.add({ subject: 'user-2', predicate: 'owns', object: 'order-2' })
      await relationships.add({ subject: 'user-1', predicate: 'created', object: 'post-1' })

      const state = await admin.inspectState()

      expect(state.relationships.byPredicate).toEqual({
        owns: 2,
        created: 1
      })
    })
  })

  describe('healthCheck', () => {
    it('should return health status', async () => {
      const health = await admin.healthCheck()

      expect(health.status).toBe('healthy')
      expect(health.timestamp).toBeDefined()
      expect(typeof health.timestamp).toBe('number')
    })

    it('should include store availability', async () => {
      const health = await admin.healthCheck()

      expect(health.stores.things).toBe(true)
      expect(health.stores.events).toBe(true)
      expect(health.stores.relationships).toBe(true)
    })

    it('should include basic metrics', async () => {
      await things.create({ $type: 'Customer', name: 'Alice' })
      await events.emit({ type: 'test.event', payload: {} })

      const health = await admin.healthCheck()

      expect(health.metrics).toBeDefined()
      expect(health.metrics.entityCount).toBe(1)
      expect(health.metrics.eventCount).toBe(1)
    })
  })

  describe('getEntity', () => {
    it('should get entity by ID', async () => {
      const created = await things.create({ $type: 'Customer', name: 'Alice' })

      const entity = await admin.getEntity(created.$id)

      expect(entity).toBeDefined()
      expect(entity?.$id).toBe(created.$id)
      expect(entity?.name).toBe('Alice')
    })

    it('should return null for non-existent entity', async () => {
      const entity = await admin.getEntity('non-existent')

      expect(entity).toBeNull()
    })
  })

  describe('getEvent', () => {
    it('should get event by ID', async () => {
      const created = await events.emit({ type: 'test.event', payload: { data: 123 } })

      const event = await admin.getEvent(created.$id)

      expect(event).toBeDefined()
      expect(event?.$id).toBe(created.$id)
      expect(event?.type).toBe('test.event')
    })

    it('should return null for non-existent event', async () => {
      const event = await admin.getEvent('non-existent')

      expect(event).toBeNull()
    })
  })

  describe('deleteEntity', () => {
    it('should delete an entity', async () => {
      const created = await things.create({ $type: 'Customer', name: 'Alice' })

      await admin.deleteEntity(created.$id)

      const entity = await things.get(created.$id)
      expect(entity).toBeNull()
    })

    it('should throw error for non-existent entity', async () => {
      await expect(admin.deleteEntity('non-existent')).rejects.toThrow()
    })
  })
})
