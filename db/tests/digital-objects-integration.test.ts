/**
 * TDD Integration Tests: @dotdo/db with digital-objects
 *
 * These tests verify that @dotdo/db's core stores (Things, Relationships, Events)
 * integrate properly with the digital-objects package patterns:
 * - Things store matches digital-objects nouns pattern
 * - Relationships match digital-objects verbs pattern
 * - Events match digital-objects actions pattern
 *
 * @see primitives/packages/digital-objects/src/types.ts for digital-objects patterns
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryProvider } from '../../primitives/packages/digital-objects/src/memory-provider.js'
import type {
  DigitalObjectsProvider,
  Noun,
  Verb,
  Thing as DOThing,
  Action as DOAction,
} from '../../primitives/packages/digital-objects/src/types.js'
import { createThingsStore, type ThingsStore, type Thing } from '../things'
import { createRelationshipsStore, type RelationshipsStore, type Relationship } from '../relationships'
import { createEventsStore, type EventsStore, type Event } from '../events'

describe('Digital Objects Integration', () => {
  describe('Things Store matches Nouns Pattern', () => {
    /**
     * digital-objects defines Nouns as entity type definitions with:
     * - name: string (e.g., 'Customer')
     * - singular: string (e.g., 'customer')
     * - plural: string (e.g., 'customers')
     * - schema: Record<string, FieldDefinition>
     *
     * @dotdo/db Things should:
     * - Use $type to reference the noun name
     * - Support the same field types as digital-objects schemas
     * - Provide equivalent CRUD operations
     */

    let doProvider: DigitalObjectsProvider
    let dbThings: ThingsStore

    beforeEach(async () => {
      doProvider = createMemoryProvider()
      dbThings = createThingsStore()

      // Define nouns in digital-objects
      await doProvider.defineNoun({
        name: 'Customer',
        description: 'A customer entity',
        schema: {
          name: { type: 'string', required: true },
          email: 'string?',
          age: 'number?',
        },
      })
    })

    it('should map $type to noun name', async () => {
      // digital-objects: thing.noun = 'Customer'
      const doThing = await doProvider.create('Customer', { name: 'Alice', email: 'alice@example.com' })
      expect(doThing.noun).toBe('Customer')

      // @dotdo/db: thing.$type = 'Customer'
      const dbThing = await dbThings.create({ $type: 'Customer', name: 'Alice', email: 'alice@example.com' })
      expect(dbThing.$type).toBe('Customer')

      // Both should use equivalent type reference
      expect(doThing.noun).toBe(dbThing.$type)
    })

    it('should map id to $id', async () => {
      // digital-objects: thing.id
      const doThing = await doProvider.create('Customer', { name: 'Bob' })
      expect(doThing.id).toBeDefined()
      expect(typeof doThing.id).toBe('string')

      // @dotdo/db: thing.$id
      const dbThing = await dbThings.create({ $type: 'Customer', name: 'Bob' })
      expect(dbThing.$id).toBeDefined()
      expect(typeof dbThing.$id).toBe('string')
    })

    it('should map createdAt/updatedAt timestamps', async () => {
      // digital-objects: thing.createdAt (Date), thing.updatedAt (Date)
      const doThing = await doProvider.create('Customer', { name: 'Charlie' })
      expect(doThing.createdAt).toBeInstanceOf(Date)
      expect(doThing.updatedAt).toBeInstanceOf(Date)

      // @dotdo/db: thing.$createdAt (number), thing.$updatedAt (number)
      const dbThing = await dbThings.create({ $type: 'Customer', name: 'Charlie' })
      expect(typeof dbThing.$createdAt).toBe('number')
      expect(typeof dbThing.$updatedAt).toBe('number')

      // Both should represent the same concept (creation/modification time)
      expect(doThing.createdAt.getTime()).toBeLessThanOrEqual(Date.now())
      expect(dbThing.$createdAt).toBeLessThanOrEqual(Date.now())
    })

    it('should flatten data fields to top level in @dotdo/db', async () => {
      // digital-objects: data is nested in thing.data
      const doThing = await doProvider.create('Customer', { name: 'Diana', email: 'diana@example.com', age: 30 })
      expect(doThing.data.name).toBe('Diana')
      expect(doThing.data.email).toBe('diana@example.com')
      expect(doThing.data.age).toBe(30)

      // @dotdo/db: data fields are at top level
      const dbThing = await dbThings.create({ $type: 'Customer', name: 'Diana', email: 'diana@example.com', age: 30 })
      expect(dbThing.name).toBe('Diana')
      expect(dbThing.email).toBe('diana@example.com')
      expect(dbThing.age).toBe(30)
    })

    it('should support equivalent CRUD operations', async () => {
      // CREATE
      const doThing = await doProvider.create('Customer', { name: 'Eve' })
      const dbThing = await dbThings.create({ $type: 'Customer', name: 'Eve' })
      expect(doThing.data.name).toBe('Eve')
      expect(dbThing.name).toBe('Eve')

      // READ
      const doRead = await doProvider.get(doThing.id)
      const dbRead = await dbThings.get(dbThing.$id)
      expect(doRead).not.toBeNull()
      expect(dbRead).not.toBeNull()

      // UPDATE
      const doUpdated = await doProvider.update(doThing.id, { name: 'Eve Updated' })
      const dbUpdated = await dbThings.update(dbThing.$id, { name: 'Eve Updated' })
      expect(doUpdated.data.name).toBe('Eve Updated')
      expect(dbUpdated.name).toBe('Eve Updated')

      // DELETE
      await doProvider.delete(doThing.id)
      await dbThings.delete(dbThing.$id)
      expect(await doProvider.get(doThing.id)).toBeNull()
      expect(await dbThings.get(dbThing.$id)).toBeNull()
    })

    it('should support equivalent list operations by type/noun', async () => {
      // digital-objects: list by noun
      await doProvider.create('Customer', { name: 'User1' })
      await doProvider.create('Customer', { name: 'User2' })
      const doList = await doProvider.list('Customer')
      expect(doList.length).toBeGreaterThanOrEqual(2)

      // @dotdo/db: list by type
      await dbThings.create({ $type: 'Customer', name: 'User1' })
      await dbThings.create({ $type: 'Customer', name: 'User2' })
      const dbList = await dbThings.list({ type: 'Customer' })
      expect(dbList.length).toBeGreaterThanOrEqual(2)
    })

    it('should support field filtering like digital-objects where clause', async () => {
      // digital-objects: list with where
      await doProvider.create('Customer', { name: 'Frank', age: 25 })
      await doProvider.create('Customer', { name: 'Grace', age: 30 })
      const doFiltered = await doProvider.list('Customer', { where: { age: 30 } })
      expect(doFiltered.length).toBe(1)
      expect(doFiltered[0].data.name).toBe('Grace')

      // @dotdo/db should support similar filtering (currently may need query builder)
      // This test documents the expected behavior for integration
      await dbThings.create({ $type: 'Customer', name: 'Frank', age: 25 })
      await dbThings.create({ $type: 'Customer', name: 'Grace', age: 30 })
      // Note: Basic ThingsStore.list() doesn't have where support
      // This is a gap that may need addressing for full digital-objects compat
      const dbAll = await dbThings.list({ type: 'Customer' })
      const dbFiltered = dbAll.filter(t => t.age === 30)
      expect(dbFiltered.length).toBe(1)
      expect(dbFiltered[0].name).toBe('Grace')
    })
  })

  describe('Relationships match Verbs Pattern', () => {
    /**
     * digital-objects defines Verbs as action definitions with:
     * - name: string (e.g., 'create', 'publish')
     * - action: string (imperative)
     * - act: string (3rd person)
     * - activity: string (gerund)
     * - event: string (past participle)
     * - inverse?: string (reverse verb)
     *
     * Actions in digital-objects serve as both:
     * - Events (something happened)
     * - Relationships (graph edges)
     *
     * @dotdo/db Relationships should:
     * - Use predicate to reference the verb name
     * - Support subject -> predicate -> object triples
     * - Enable graph traversal similar to digital-objects actions
     */

    let doProvider: DigitalObjectsProvider
    let dbRelationships: RelationshipsStore

    beforeEach(async () => {
      doProvider = createMemoryProvider()
      dbRelationships = createRelationshipsStore()

      // Define verbs in digital-objects
      await doProvider.defineVerb({
        name: 'owns',
        description: 'Ownership relationship',
      })

      await doProvider.defineVerb({
        name: 'follows',
        description: 'Social following relationship',
      })

      await doProvider.defineVerb({
        name: 'created',
        description: 'Creation relationship',
        inverse: 'deleted',
      })

      // Define nouns for things
      await doProvider.defineNoun({ name: 'User' })
      await doProvider.defineNoun({ name: 'Order' })
      await doProvider.defineNoun({ name: 'Post' })
    })

    it('should map predicate to verb name', async () => {
      // Create things first
      const user = await doProvider.create('User', { name: 'Alice' })
      const order = await doProvider.create('Order', { total: 100 })

      // digital-objects: action.verb = 'owns'
      const doAction = await doProvider.perform('owns', user.id, order.id)
      expect(doAction.verb).toBe('owns')

      // @dotdo/db: relationship.predicate = 'owns'
      const dbRel = await dbRelationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'order-1',
      })
      expect(dbRel.predicate).toBe('owns')

      // Both use equivalent verb reference
      expect(doAction.verb).toBe(dbRel.predicate)
    })

    it('should map subject/object to thing IDs', async () => {
      // Create digital-objects things
      const user = await doProvider.create('User', { name: 'Bob' })
      const post = await doProvider.create('Post', { title: 'Hello' })

      // digital-objects: action.subject, action.object
      const doAction = await doProvider.perform('created', user.id, post.id)
      expect(doAction.subject).toBe(user.id)
      expect(doAction.object).toBe(post.id)

      // @dotdo/db: relationship.subject, relationship.object
      const dbRel = await dbRelationships.add({
        subject: 'user-bob',
        predicate: 'created',
        object: 'post-hello',
      })
      expect(dbRel.subject).toBe('user-bob')
      expect(dbRel.object).toBe('post-hello')
    })

    it('should support graph traversal like digital-objects related()', async () => {
      // Create digital-objects graph
      const user = await doProvider.create('User', { name: 'Charlie' })
      const order1 = await doProvider.create('Order', { total: 100 })
      const order2 = await doProvider.create('Order', { total: 200 })

      await doProvider.perform('owns', user.id, order1.id)
      await doProvider.perform('owns', user.id, order2.id)

      // digital-objects: related() returns things
      const doRelated = await doProvider.related(user.id, 'owns', 'out')
      expect(doRelated.length).toBe(2)

      // @dotdo/db: getRelated() returns IDs
      await dbRelationships.add({ subject: 'user-charlie', predicate: 'owns', object: 'order-1' })
      await dbRelationships.add({ subject: 'user-charlie', predicate: 'owns', object: 'order-2' })

      const dbRelatedIds = await dbRelationships.getRelated('user-charlie', 'owns')
      expect(dbRelatedIds.length).toBe(2)
      expect(dbRelatedIds).toContain('order-1')
      expect(dbRelatedIds).toContain('order-2')
    })

    it('should support reverse lookup like digital-objects related() with in direction', async () => {
      // Create digital-objects graph
      const user1 = await doProvider.create('User', { name: 'Diana' })
      const user2 = await doProvider.create('User', { name: 'Eve' })
      const post = await doProvider.create('Post', { title: 'Shared Post' })

      await doProvider.perform('follows', user1.id, post.id)
      await doProvider.perform('follows', user2.id, post.id)

      // digital-objects: related() with direction='in'
      const doIncoming = await doProvider.related(post.id, 'follows', 'in')
      expect(doIncoming.length).toBe(2)

      // @dotdo/db: getRelatedTo() for reverse lookup
      await dbRelationships.add({ subject: 'user-diana', predicate: 'follows', object: 'post-shared' })
      await dbRelationships.add({ subject: 'user-eve', predicate: 'follows', object: 'post-shared' })

      const dbIncoming = await dbRelationships.getRelatedTo('post-shared', 'follows')
      expect(dbIncoming.length).toBe(2)
      expect(dbIncoming).toContain('user-diana')
      expect(dbIncoming).toContain('user-eve')
    })

    it('should support edges() equivalent via find()', async () => {
      // Create digital-objects edges
      const user = await doProvider.create('User', { name: 'Frank' })
      const order1 = await doProvider.create('Order', { total: 100 })
      const order2 = await doProvider.create('Order', { total: 200 })

      await doProvider.perform('owns', user.id, order1.id, { note: 'first order' })
      await doProvider.perform('owns', user.id, order2.id, { note: 'second order' })

      // digital-objects: edges() returns actions with metadata
      const doEdges = await doProvider.edges(user.id, 'owns', 'out')
      expect(doEdges.length).toBe(2)
      expect(doEdges[0].data).toBeDefined()

      // @dotdo/db: find() returns relationships with metadata
      await dbRelationships.add({ subject: 'user-frank', predicate: 'owns', object: 'order-1', note: 'first order' } as any)
      await dbRelationships.add({ subject: 'user-frank', predicate: 'owns', object: 'order-2', note: 'second order' } as any)

      const dbEdges = await dbRelationships.find({ subject: 'user-frank', predicate: 'owns' })
      expect(dbEdges.length).toBe(2)
    })

    it('should reject duplicate relationships like digital-objects unique actions', async () => {
      // @dotdo/db: duplicate relationships throw
      await dbRelationships.add({ subject: 'a', predicate: 'b', object: 'c' })
      await expect(
        dbRelationships.add({ subject: 'a', predicate: 'b', object: 'c' })
      ).rejects.toThrow('Relationship already exists')
    })
  })

  describe('Events match Actions Pattern', () => {
    /**
     * digital-objects Actions serve as:
     * - Events (something happened)
     * - Relationships (graph edges)
     * - Audit records (who did what when)
     *
     * Action has:
     * - id: string
     * - verb: string
     * - subject?: string (actor/from)
     * - object?: string (target/to)
     * - data?: T (payload/metadata)
     * - status: ActionStatusType
     * - createdAt: Date
     * - completedAt?: Date
     *
     * @dotdo/db Events should:
     * - Use type to represent the action/verb
     * - Support source (like subject) and correlationId for tracing
     * - Provide payload for event data
     * - Record timestamps
     */

    let doProvider: DigitalObjectsProvider
    let dbEvents: EventsStore

    beforeEach(async () => {
      doProvider = createMemoryProvider()
      dbEvents = createEventsStore()

      // Define verbs in digital-objects
      await doProvider.defineVerb({ name: 'signup' })
      await doProvider.defineVerb({ name: 'purchase' })
      await doProvider.defineVerb({ name: 'update' })

      // Define nouns
      await doProvider.defineNoun({ name: 'Customer' })
    })

    it('should map type to verb name for event-style actions', async () => {
      // digital-objects: action as event (no subject/object)
      const doAction = await doProvider.perform('signup', undefined, undefined, { email: 'alice@example.com' })
      expect(doAction.verb).toBe('signup')

      // @dotdo/db: event with type
      const dbEvent = await dbEvents.emit({
        type: 'signup',
        payload: { email: 'alice@example.com' },
      })
      expect(dbEvent.type).toBe('signup')

      // Both use equivalent verb/type reference
      expect(doAction.verb).toBe(dbEvent.type)
    })

    it('should map id to $id', async () => {
      // digital-objects: action.id
      const doAction = await doProvider.perform('signup', undefined, undefined, { email: 'bob@example.com' })
      expect(doAction.id).toBeDefined()
      expect(typeof doAction.id).toBe('string')

      // @dotdo/db: event.$id
      const dbEvent = await dbEvents.emit({
        type: 'signup',
        payload: { email: 'bob@example.com' },
      })
      expect(dbEvent.$id).toBeDefined()
      expect(typeof dbEvent.$id).toBe('string')
    })

    it('should map subject to source', async () => {
      // Create a customer
      const customer = await doProvider.create('Customer', { name: 'Charlie' })

      // digital-objects: action.subject = actor ID
      const doAction = await doProvider.perform('purchase', customer.id, undefined, { item: 'Widget' })
      expect(doAction.subject).toBe(customer.id)

      // @dotdo/db: event.source = actor ID
      const dbEvent = await dbEvents.emit({
        type: 'purchase',
        payload: { item: 'Widget' },
        source: 'customer-charlie',
      })
      expect(dbEvent.source).toBe('customer-charlie')
    })

    it('should map data to payload', async () => {
      // digital-objects: action.data
      const doAction = await doProvider.perform('purchase', undefined, undefined, {
        item: 'Widget',
        quantity: 2,
        price: 29.99,
      })
      expect(doAction.data).toEqual({
        item: 'Widget',
        quantity: 2,
        price: 29.99,
      })

      // @dotdo/db: event.payload
      const dbEvent = await dbEvents.emit({
        type: 'purchase',
        payload: {
          item: 'Widget',
          quantity: 2,
          price: 29.99,
        },
      })
      expect(dbEvent.payload).toEqual({
        item: 'Widget',
        quantity: 2,
        price: 29.99,
      })
    })

    it('should map createdAt to $timestamp', async () => {
      // digital-objects: action.createdAt (Date)
      const doAction = await doProvider.perform('signup')
      expect(doAction.createdAt).toBeInstanceOf(Date)

      // @dotdo/db: event.$timestamp (number)
      const dbEvent = await dbEvents.emit({ type: 'signup', payload: {} })
      expect(typeof dbEvent.$timestamp).toBe('number')

      // Both represent event time
      expect(doAction.createdAt.getTime()).toBeLessThanOrEqual(Date.now())
      expect(dbEvent.$timestamp).toBeLessThanOrEqual(Date.now())
    })

    it('should support equivalent query operations', async () => {
      // digital-objects: listActions with verb filter
      await doProvider.perform('signup', undefined, undefined, { user: 'user1' })
      await doProvider.perform('signup', undefined, undefined, { user: 'user2' })
      await doProvider.perform('purchase', undefined, undefined, { item: 'Widget' })

      const doSignups = await doProvider.listActions({ verb: 'signup' })
      expect(doSignups.length).toBe(2)

      // @dotdo/db: query with type filter
      await dbEvents.emit({ type: 'signup', payload: { user: 'user1' } })
      await dbEvents.emit({ type: 'signup', payload: { user: 'user2' } })
      await dbEvents.emit({ type: 'purchase', payload: { item: 'Widget' } })

      const dbSignups = await dbEvents.query({ type: 'signup' })
      expect(dbSignups.length).toBe(2)
    })

    it('should support correlationId for event tracing', async () => {
      // @dotdo/db: correlationId links related events
      const txId = 'tx-' + Date.now()

      await dbEvents.emit({
        type: 'order.created',
        payload: { orderId: '123' },
        correlationId: txId,
      })

      await dbEvents.emit({
        type: 'payment.processed',
        payload: { amount: 100 },
        correlationId: txId,
      })

      await dbEvents.emit({
        type: 'order.shipped',
        payload: { trackingNumber: 'ABC123' },
        correlationId: txId,
      })

      const related = await dbEvents.query({ correlationId: txId })
      expect(related.length).toBe(3)
    })

    it('should support Noun.verb event type pattern', async () => {
      // digital-objects pattern: Noun.verb = 'Customer.signup'
      // This is the canonical event naming convention

      // @dotdo/db supports this pattern
      const signupEvent = await dbEvents.emit({
        type: 'Customer.signup',
        payload: { email: 'diana@example.com' },
      })
      expect(signupEvent.type).toBe('Customer.signup')

      const purchaseEvent = await dbEvents.emit({
        type: 'Customer.purchase',
        payload: { item: 'Widget' },
      })
      expect(purchaseEvent.type).toBe('Customer.purchase')

      // Query by Noun.verb pattern
      const customerEvents = await dbEvents.query({})
      const signups = customerEvents.filter(e => e.type === 'Customer.signup')
      expect(signups.length).toBe(1)
    })

    it('should support event subscriptions (real-time pattern)', async () => {
      // @dotdo/db events support subscriptions
      const received: Event[] = []

      const unsubscribe = dbEvents.subscribe((event) => {
        received.push(event)
      })

      await dbEvents.emit({ type: 'test.event', payload: { value: 1 } })
      await dbEvents.emit({ type: 'test.event', payload: { value: 2 } })

      expect(received.length).toBe(2)

      unsubscribe()

      await dbEvents.emit({ type: 'test.event', payload: { value: 3 } })
      expect(received.length).toBe(2) // No new events after unsubscribe
    })

    it('should support immutable event log (events cannot be updated)', async () => {
      // Events are immutable - no update method exists
      const event = await dbEvents.emit({ type: 'important', payload: { data: 'original' } })

      // Verify event was created
      const retrieved = await dbEvents.get(event.$id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.payload).toEqual({ data: 'original' })

      // EventsStore interface has no update method - events are append-only
      expect((dbEvents as any).update).toBeUndefined()
    })
  })

  describe('Cross-Pattern Integration', () => {
    /**
     * In digital-objects, Actions unify events and relationships.
     * In @dotdo/db, Events and Relationships are separate stores.
     *
     * This section tests patterns that span both systems.
     */

    let dbThings: ThingsStore
    let dbRelationships: RelationshipsStore
    let dbEvents: EventsStore

    beforeEach(() => {
      dbThings = createThingsStore()
      dbRelationships = createRelationshipsStore()
      dbEvents = createEventsStore()
    })

    it('should support event sourcing pattern with Things and Events', async () => {
      // Create a thing
      const customer = await dbThings.create({
        $type: 'Customer',
        name: 'Alice',
        status: 'active',
      })

      // Emit creation event
      const createEvent = await dbEvents.emit({
        type: 'Customer.created',
        payload: {
          customerId: customer.$id,
          name: 'Alice',
          status: 'active',
        },
        source: 'system',
      })

      // Update the thing
      await dbThings.update(customer.$id, { status: 'premium' })

      // Emit update event
      const updateEvent = await dbEvents.emit({
        type: 'Customer.updated',
        payload: {
          customerId: customer.$id,
          changes: { status: 'premium' },
        },
        source: 'admin',
        correlationId: createEvent.$id,
      })

      // Query event history for this customer
      const customerEvents = await dbEvents.query({})
      const relevantEvents = customerEvents.filter(
        e => e.payload && (e.payload as any).customerId === customer.$id
      )
      expect(relevantEvents.length).toBe(2)
    })

    it('should support relationship with event audit trail', async () => {
      // Create things
      const user = await dbThings.create({ $type: 'User', name: 'Bob' })
      const order = await dbThings.create({ $type: 'Order', total: 150 })

      // Create relationship
      await dbRelationships.add({
        subject: user.$id,
        predicate: 'owns',
        object: order.$id,
      })

      // Emit event for the relationship
      await dbEvents.emit({
        type: 'User.owns.Order',
        payload: {
          userId: user.$id,
          orderId: order.$id,
        },
        source: user.$id,
      })

      // Both relationship and event exist
      const relationships = await dbRelationships.find({ subject: user.$id })
      expect(relationships.length).toBe(1)

      const events = await dbEvents.query({ type: 'User.owns.Order' })
      expect(events.length).toBe(1)
    })

    it('should support graph + event pattern for social features', async () => {
      // Create users
      const alice = await dbThings.create({ $type: 'User', name: 'Alice' })
      const bob = await dbThings.create({ $type: 'User', name: 'Bob' })

      // Alice follows Bob
      await dbRelationships.add({
        subject: alice.$id,
        predicate: 'follows',
        object: bob.$id,
      })

      // Emit follow event
      await dbEvents.emit({
        type: 'User.followed',
        payload: {
          followerId: alice.$id,
          followedId: bob.$id,
        },
        source: alice.$id,
      })

      // Query followers via relationships
      const followers = await dbRelationships.getRelatedTo(bob.$id, 'follows')
      expect(followers).toContain(alice.$id)

      // Query follow events
      const followEvents = await dbEvents.query({ type: 'User.followed' })
      expect(followEvents.length).toBe(1)
    })
  })
})
