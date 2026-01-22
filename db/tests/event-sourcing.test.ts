import { describe, it, expect, beforeEach } from 'vitest'
import { createThingsStore, type ThingsStore, type Thing } from '../things'
import { createRelationshipsStore, type RelationshipsStore, type Relationship } from '../relationships'
import { createEventsStore, type EventsStore, type Event } from '../events'
import {
  withEventSourcing,
  withRelationshipEventSourcing,
  type EventSourcingConfig,
  type ThingCreatedPayload,
  type ThingUpdatedPayload,
  type ThingDeletedPayload,
  type RelationshipCreatedPayload,
  type RelationshipDeletedPayload
} from '../event-sourcing'
import type { JsonValue, StorableData } from '../types'

describe('Event Sourcing', () => {
  describe('withEventSourcing (ThingsStore)', () => {
    let baseStore: ThingsStore
    let eventsStore: EventsStore<JsonValue>
    let store: ThingsStore
    let emittedEvents: Event<JsonValue>[]

    beforeEach(() => {
      baseStore = createThingsStore()
      eventsStore = createEventsStore()
      emittedEvents = []

      // Subscribe to capture all emitted events
      eventsStore.subscribe((event) => {
        emittedEvents.push(event)
      })

      store = withEventSourcing(baseStore, eventsStore)
    })

    describe('create', () => {
      it('should emit Thing.created event on create', async () => {
        const thing = await store.create({ $type: 'Customer', name: 'Alice' })

        expect(emittedEvents).toHaveLength(1)
        expect(emittedEvents[0].type).toBe('Thing.created')

        const payload = emittedEvents[0].payload as ThingCreatedPayload
        expect(payload.$type).toBe('Customer')
        expect(payload.$id).toBe(thing.$id)
        expect(payload.data.name).toBe('Alice')
      })

      it('should include full data in created event by default', async () => {
        const thing = await store.create({
          $type: 'Order',
          items: ['item1', 'item2'],
          total: 100
        })

        const payload = emittedEvents[0].payload as ThingCreatedPayload
        expect(payload.data.items).toEqual(['item1', 'item2'])
        expect(payload.data.total).toBe(100)
      })

      it('should not include full data when includeFullData is false', async () => {
        const minimalStore = withEventSourcing(baseStore, eventsStore, {
          includeFullData: false
        })

        const thing = await minimalStore.create({
          $type: 'Customer',
          name: 'Alice',
          email: 'alice@example.com'
        })

        const payload = emittedEvents[0].payload as ThingCreatedPayload
        expect(payload.data.$type).toBe('Customer')
        expect(payload.data.$id).toBe(thing.$id)
        expect(payload.data.name).toBeUndefined()
        expect(payload.data.email).toBeUndefined()
      })
    })

    describe('update', () => {
      it('should emit Thing.updated event on update', async () => {
        const thing = await store.create({ $type: 'Customer', name: 'Alice' })
        emittedEvents.length = 0 // Clear create event

        await store.update(thing.$id, { name: 'Bob' })

        expect(emittedEvents).toHaveLength(1)
        expect(emittedEvents[0].type).toBe('Thing.updated')

        const payload = emittedEvents[0].payload as ThingUpdatedPayload
        expect(payload.$type).toBe('Customer')
        expect(payload.$id).toBe(thing.$id)
        expect(payload.changedFields).toEqual(['name'])
        expect(payload.previousValues).toEqual({ name: 'Alice' })
        expect(payload.newValues).toEqual({ name: 'Bob' })
      })

      it('should include multiple changed fields', async () => {
        const thing = await store.create({
          $type: 'Customer',
          name: 'Alice',
          email: 'alice@example.com',
          age: 30
        })
        emittedEvents.length = 0

        await store.update(thing.$id, { name: 'Bob', age: 31 })

        const payload = emittedEvents[0].payload as ThingUpdatedPayload
        expect(payload.changedFields).toContain('name')
        expect(payload.changedFields).toContain('age')
        expect(payload.previousValues).toEqual({ name: 'Alice', age: 30 })
        expect(payload.newValues).toEqual({ name: 'Bob', age: 31 })
      })

      it('should not emit event when no fields changed', async () => {
        const thing = await store.create({ $type: 'Customer', name: 'Alice' })
        emittedEvents.length = 0

        // Update with same value
        await store.update(thing.$id, { name: 'Alice' })

        expect(emittedEvents).toHaveLength(0)
      })

      it('should not include previous values when includePreviousValues is false', async () => {
        const noPrevStore = withEventSourcing(baseStore, eventsStore, {
          includePreviousValues: false
        })

        const thing = await noPrevStore.create({ $type: 'Customer', name: 'Alice' })
        emittedEvents.length = 0

        await noPrevStore.update(thing.$id, { name: 'Bob' })

        const payload = emittedEvents[0].payload as ThingUpdatedPayload
        expect(payload.previousValues).toEqual({})
        expect(payload.newValues).toEqual({ name: 'Bob' })
      })
    })

    describe('delete', () => {
      it('should emit Thing.deleted event on delete', async () => {
        const thing = await store.create({ $type: 'Customer', name: 'Alice' })
        emittedEvents.length = 0

        await store.delete(thing.$id)

        expect(emittedEvents).toHaveLength(1)
        expect(emittedEvents[0].type).toBe('Thing.deleted')

        const payload = emittedEvents[0].payload as ThingDeletedPayload
        expect(payload.$type).toBe('Customer')
        expect(payload.$id).toBe(thing.$id)
      })
    })

    describe('bulk operations', () => {
      it('should emit events for each item in bulkCreate', async () => {
        const things = await store.bulkCreate([
          { $type: 'Customer', name: 'Alice' },
          { $type: 'Customer', name: 'Bob' }
        ])

        expect(emittedEvents).toHaveLength(2)
        expect(emittedEvents[0].type).toBe('Thing.created')
        expect(emittedEvents[1].type).toBe('Thing.created')

        const payload1 = emittedEvents[0].payload as ThingCreatedPayload
        const payload2 = emittedEvents[1].payload as ThingCreatedPayload
        expect(payload1.$id).toBe(things[0].$id)
        expect(payload2.$id).toBe(things[1].$id)
      })

      it('should emit events for each item in bulkUpdate', async () => {
        const things = await store.bulkCreate([
          { $type: 'Customer', name: 'Alice' },
          { $type: 'Customer', name: 'Bob' }
        ])
        emittedEvents.length = 0

        await store.bulkUpdate([
          { id: things[0].$id, data: { name: 'Alice Updated' } },
          { id: things[1].$id, data: { name: 'Bob Updated' } }
        ])

        expect(emittedEvents).toHaveLength(2)
        expect(emittedEvents[0].type).toBe('Thing.updated')
        expect(emittedEvents[1].type).toBe('Thing.updated')
      })

      it('should emit events for each item in bulkDelete', async () => {
        const things = await store.bulkCreate([
          { $type: 'Customer', name: 'Alice' },
          { $type: 'Customer', name: 'Bob' }
        ])
        emittedEvents.length = 0

        await store.bulkDelete([things[0].$id, things[1].$id])

        expect(emittedEvents).toHaveLength(2)
        expect(emittedEvents[0].type).toBe('Thing.deleted')
        expect(emittedEvents[1].type).toBe('Thing.deleted')
      })
    })

    describe('configuration', () => {
      it('should not emit events when disabled', async () => {
        const disabledStore = withEventSourcing(baseStore, eventsStore, {
          enabled: false
        })

        await disabledStore.create({ $type: 'Customer', name: 'Alice' })

        expect(emittedEvents).toHaveLength(0)
      })

      it('should only emit for included types', async () => {
        const filteredStore = withEventSourcing(baseStore, eventsStore, {
          includeTypes: ['Order']
        })

        await filteredStore.create({ $type: 'Customer', name: 'Alice' })
        expect(emittedEvents).toHaveLength(0)

        await filteredStore.create({ $type: 'Order', total: 100 })
        expect(emittedEvents).toHaveLength(1)
        expect((emittedEvents[0].payload as ThingCreatedPayload).$type).toBe('Order')
      })

      it('should exclude specified types', async () => {
        const filteredStore = withEventSourcing(baseStore, eventsStore, {
          excludeTypes: ['AuditLog']
        })

        await filteredStore.create({ $type: 'AuditLog', action: 'login' })
        expect(emittedEvents).toHaveLength(0)

        await filteredStore.create({ $type: 'Customer', name: 'Alice' })
        expect(emittedEvents).toHaveLength(1)
      })
    })

    describe('context', () => {
      it('should include actor from audit context', async () => {
        const contextStore = withEventSourcing(
          baseStore,
          eventsStore,
          {},
          { auditContext: { actor: 'user-123', correlationId: 'req-456' } }
        )

        await contextStore.create({ $type: 'Customer', name: 'Alice' })

        expect(emittedEvents[0].source).toBe('user-123')
        expect(emittedEvents[0].correlationId).toBe('req-456')
      })
    })

    describe('read operations', () => {
      it('should not emit events for get', async () => {
        const thing = await store.create({ $type: 'Customer', name: 'Alice' })
        emittedEvents.length = 0

        await store.get(thing.$id)

        expect(emittedEvents).toHaveLength(0)
      })

      it('should not emit events for list', async () => {
        await store.create({ $type: 'Customer', name: 'Alice' })
        emittedEvents.length = 0

        await store.list()

        expect(emittedEvents).toHaveLength(0)
      })
    })
  })

  describe('withRelationshipEventSourcing', () => {
    let baseStore: RelationshipsStore
    let eventsStore: EventsStore<JsonValue>
    let store: RelationshipsStore
    let emittedEvents: Event<JsonValue>[]

    beforeEach(() => {
      baseStore = createRelationshipsStore()
      eventsStore = createEventsStore()
      emittedEvents = []

      eventsStore.subscribe((event) => {
        emittedEvents.push(event)
      })

      store = withRelationshipEventSourcing(baseStore, eventsStore)
    })

    describe('add', () => {
      it('should emit Relationship.created event on add', async () => {
        await store.add({
          subject: 'user-1',
          predicate: 'owns',
          object: 'item-1'
        })

        expect(emittedEvents).toHaveLength(1)
        expect(emittedEvents[0].type).toBe('Relationship.created')

        const payload = emittedEvents[0].payload as RelationshipCreatedPayload
        expect(payload.subject).toBe('user-1')
        expect(payload.predicate).toBe('owns')
        expect(payload.object).toBe('item-1')
      })
    })

    describe('remove', () => {
      it('should emit Relationship.deleted event on remove', async () => {
        await store.add({
          subject: 'user-1',
          predicate: 'owns',
          object: 'item-1'
        })
        emittedEvents.length = 0

        await store.remove({
          subject: 'user-1',
          predicate: 'owns',
          object: 'item-1'
        })

        expect(emittedEvents).toHaveLength(1)
        expect(emittedEvents[0].type).toBe('Relationship.deleted')

        const payload = emittedEvents[0].payload as RelationshipDeletedPayload
        expect(payload.subject).toBe('user-1')
        expect(payload.predicate).toBe('owns')
        expect(payload.object).toBe('item-1')
      })
    })

    describe('configuration', () => {
      it('should exclude specified predicates', async () => {
        const filteredStore = withRelationshipEventSourcing(baseStore, eventsStore, {
          excludePredicates: ['_internal']
        })

        await filteredStore.add({
          subject: 'user-1',
          predicate: '_internal',
          object: 'item-1'
        })
        expect(emittedEvents).toHaveLength(0)

        await filteredStore.add({
          subject: 'user-1',
          predicate: 'owns',
          object: 'item-2'
        })
        expect(emittedEvents).toHaveLength(1)
      })
    })

    describe('read operations', () => {
      it('should not emit events for find', async () => {
        await store.add({
          subject: 'user-1',
          predicate: 'owns',
          object: 'item-1'
        })
        emittedEvents.length = 0

        await store.find({ subject: 'user-1' })

        expect(emittedEvents).toHaveLength(0)
      })

      it('should not emit events for getRelated', async () => {
        await store.add({
          subject: 'user-1',
          predicate: 'owns',
          object: 'item-1'
        })
        emittedEvents.length = 0

        await store.getRelated('user-1', 'owns')

        expect(emittedEvents).toHaveLength(0)
      })

      it('should not emit events for getRelatedTo', async () => {
        await store.add({
          subject: 'user-1',
          predicate: 'owns',
          object: 'item-1'
        })
        emittedEvents.length = 0

        await store.getRelatedTo('item-1', 'owns')

        expect(emittedEvents).toHaveLength(0)
      })
    })
  })

  describe('Event persistence', () => {
    it('should persist events to the events store', async () => {
      const baseStore = createThingsStore()
      const eventsStore = createEventsStore()
      const store = withEventSourcing(baseStore, eventsStore)

      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Order', total: 100 })

      // Query events directly from the store
      const events = await eventsStore.query({ type: 'Thing.created' })
      expect(events).toHaveLength(2)

      // Verify events are queryable by type
      const customerEvents = await eventsStore.query()
      expect(customerEvents.length).toBeGreaterThanOrEqual(2)
    })
  })
})
