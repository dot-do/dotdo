/**
 * Test Data Factory Tests
 *
 * Tests for the factory functions, sequence generator, and faker-like helpers.
 *
 * @module testing/factory.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  Factory,
  Fake,
  Sequence,
  buildThing,
  buildRelationship,
  buildUser,
  buildSession,
  buildEvent,
  type GraphThing,
  type GraphRelationship,
  type User,
  type Session,
  type Event,
} from './factory'

// ============================================================================
// SEQUENCE GENERATOR TESTS
// ============================================================================

describe('Sequence', () => {
  beforeEach(() => {
    Sequence.reset('all')
  })

  it('should generate sequential numbers starting from 1', () => {
    expect(Sequence.next()).toBe(1)
    expect(Sequence.next()).toBe(2)
    expect(Sequence.next()).toBe(3)
  })

  it('should maintain separate counters for different sequences', () => {
    expect(Sequence.next('users')).toBe(1)
    expect(Sequence.next('orders')).toBe(1)
    expect(Sequence.next('users')).toBe(2)
    expect(Sequence.next('orders')).toBe(2)
    expect(Sequence.next('users')).toBe(3)
  })

  it('should reset individual sequences', () => {
    Sequence.next('test')
    Sequence.next('test')
    expect(Sequence.current('test')).toBe(2)

    Sequence.reset('test')
    expect(Sequence.current('test')).toBe(0)
    expect(Sequence.next('test')).toBe(1)
  })

  it('should reset all sequences', () => {
    Sequence.next('a')
    Sequence.next('b')
    Sequence.next('c')

    Sequence.reset('all')

    expect(Sequence.current('a')).toBe(0)
    expect(Sequence.current('b')).toBe(0)
    expect(Sequence.current('c')).toBe(0)
  })

  it('should return 0 for current on uninitialized sequence', () => {
    expect(Sequence.current('nonexistent')).toBe(0)
  })
})

// ============================================================================
// FAKER HELPERS TESTS
// ============================================================================

describe('Fake', () => {
  describe('random number generation', () => {
    it('should generate random floats between 0 and 1', () => {
      for (let i = 0; i < 100; i++) {
        const value = Fake.random()
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(1)
      }
    })

    it('should generate integers in range', () => {
      for (let i = 0; i < 100; i++) {
        const value = Fake.int(10, 20)
        expect(value).toBeGreaterThanOrEqual(10)
        expect(value).toBeLessThanOrEqual(20)
        expect(Number.isInteger(value)).toBe(true)
      }
    })

    it('should generate floats in range', () => {
      for (let i = 0; i < 100; i++) {
        const value = Fake.float(5.5, 10.5)
        expect(value).toBeGreaterThanOrEqual(5.5)
        expect(value).toBeLessThan(10.5)
      }
    })
  })

  describe('seeded randomness', () => {
    it('should produce reproducible results with seed', () => {
      Fake.seed(12345)
      const values1 = [Fake.random(), Fake.random(), Fake.random()]

      Fake.seed(12345)
      const values2 = [Fake.random(), Fake.random(), Fake.random()]

      expect(values1).toEqual(values2)
    })

    it('should produce different results with different seeds', () => {
      Fake.seed(12345)
      const value1 = Fake.random()

      Fake.seed(54321)
      const value2 = Fake.random()

      expect(value1).not.toBe(value2)
    })
  })

  describe('boolean', () => {
    it('should generate true and false values', () => {
      Fake.seed(42)
      const results = Array.from({ length: 100 }, () => Fake.boolean())

      expect(results.some((v) => v === true)).toBe(true)
      expect(results.some((v) => v === false)).toBe(true)
    })
  })

  describe('pick', () => {
    it('should pick elements from array', () => {
      const arr = ['a', 'b', 'c', 'd', 'e']

      for (let i = 0; i < 50; i++) {
        const picked = Fake.pick(arr)
        expect(arr).toContain(picked)
      }
    })

    it('should pick multiple unique elements', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const picked = Fake.pickMany(arr, 3)

      expect(picked).toHaveLength(3)
      expect(new Set(picked).size).toBe(3) // All unique
      picked.forEach((p) => expect(arr).toContain(p))
    })
  })

  describe('string generation', () => {
    it('should generate strings of specified length', () => {
      const str = Fake.string(15)
      expect(str).toHaveLength(15)
    })

    it('should generate strings with custom charset', () => {
      const str = Fake.string(10, 'abc')
      expect(str).toHaveLength(10)
      expect(str.split('').every((c) => 'abc'.includes(c))).toBe(true)
    })

    it('should generate alphanumeric strings', () => {
      const str = Fake.alphanumeric(20)
      expect(str).toHaveLength(20)
      expect(str).toMatch(/^[A-Za-z0-9]+$/)
    })
  })

  describe('uuid', () => {
    it('should generate valid UUID v4 format', () => {
      const uuid = Fake.uuid()
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })

    it('should generate unique UUIDs', () => {
      const uuids = Array.from({ length: 100 }, () => Fake.uuid())
      expect(new Set(uuids).size).toBe(100)
    })
  })

  describe('email', () => {
    it('should generate valid email format', () => {
      const email = Fake.email()
      expect(email).toMatch(/^[a-z]+@[a-z]+\.[a-z]+$/)
    })

    it('should use custom domain when provided', () => {
      const email = Fake.email('custom.com')
      expect(email).toMatch(/@custom\.com$/)
    })
  })

  describe('name', () => {
    it('should generate full name', () => {
      const name = Fake.name()
      expect(name.split(' ')).toHaveLength(2)
    })

    it('should generate first name', () => {
      const firstName = Fake.firstName()
      expect(firstName).toBeTruthy()
      expect(firstName.split(' ')).toHaveLength(1)
    })

    it('should generate last name', () => {
      const lastName = Fake.lastName()
      expect(lastName).toBeTruthy()
      expect(lastName.split(' ')).toHaveLength(1)
    })
  })

  describe('url', () => {
    it('should generate valid URL format', () => {
      const url = Fake.url()
      expect(url).toMatch(/^https:\/\/[a-z]+\.[a-z]+(\/[a-z]*)?$/)
    })

    it('should use custom protocol', () => {
      const url = Fake.url('http')
      expect(url).toMatch(/^http:\/\//)
    })
  })

  describe('doUrl', () => {
    it('should generate valid DO URL format', () => {
      const url = Fake.doUrl()
      expect(url).toMatch(/^do:\/\/[a-z0-9]+\/[a-z]+\/[0-9a-f-]+$/)
    })

    it('should use custom tenant, type, and id', () => {
      const url = Fake.doUrl('mytenant', 'users', 'user-123')
      expect(url).toBe('do://mytenant/users/user-123')
    })
  })

  describe('ip', () => {
    it('should generate valid IPv4 format', () => {
      const ip = Fake.ip()
      const parts = ip.split('.')
      expect(parts).toHaveLength(4)
      parts.forEach((part) => {
        const num = parseInt(part, 10)
        expect(num).toBeGreaterThanOrEqual(0)
        expect(num).toBeLessThanOrEqual(255)
      })
    })
  })

  describe('userAgent', () => {
    it('should generate user agent string', () => {
      const ua = Fake.userAgent()
      expect(ua).toMatch(/^Mozilla\/5\.0/)
      expect(ua).toMatch(/AppleWebKit/)
    })
  })

  describe('date and timestamp', () => {
    it('should generate date within default range', () => {
      const date = Fake.date()
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
      expect(date.getTime()).toBeGreaterThanOrEqual(oneYearAgo)
      expect(date.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('should generate timestamp within range', () => {
      const start = Date.now() - 1000
      const end = Date.now()
      const ts = Fake.timestamp(start, end)
      expect(ts).toBeGreaterThanOrEqual(start)
      expect(ts).toBeLessThanOrEqual(end)
    })
  })

  describe('text generation', () => {
    it('should generate word', () => {
      const word = Fake.word()
      expect(word).toBeTruthy()
      expect(word.split(' ')).toHaveLength(1)
    })

    it('should generate multiple words', () => {
      const words = Fake.words(5)
      expect(words.split(' ')).toHaveLength(5)
    })

    it('should generate sentence', () => {
      const sentence = Fake.sentence()
      expect(sentence).toMatch(/^[A-Z]/)
      expect(sentence).toMatch(/\.$/)
    })

    it('should generate paragraph', () => {
      const paragraph = Fake.paragraph(3)
      const sentences = paragraph.split('. ')
      expect(sentences.length).toBeGreaterThanOrEqual(2) // At least 2 because last one ends with .
    })
  })

  describe('domain-specific generators', () => {
    it('should generate verb', () => {
      const verb = Fake.verb()
      expect(verb).toBeTruthy()
      expect(typeof verb).toBe('string')
    })

    it('should generate thing type', () => {
      const type = Fake.thingType()
      expect(type).toBeTruthy()
      expect(typeof type).toBe('string')
    })

    it('should generate event type', () => {
      const type = Fake.eventType()
      expect(type).toBeTruthy()
      expect(type).toContain('.')
    })
  })
})

// ============================================================================
// FACTORY TESTS - Thing
// ============================================================================

describe('Factory.thing', () => {
  beforeEach(() => {
    Factory.reset()
  })

  it('should create a thing with default values', () => {
    const thing = Factory.thing()

    expect(thing.id).toBe('thing-1')
    expect(thing.typeId).toBe(1)
    expect(thing.typeName).toBeTruthy()
    expect(thing.data).toBeDefined()
    expect(thing.createdAt).toBeGreaterThan(0)
    expect(thing.updatedAt).toBeGreaterThan(0)
    expect(thing.deletedAt).toBeNull()
  })

  it('should create things with sequential IDs', () => {
    const thing1 = Factory.thing()
    const thing2 = Factory.thing()
    const thing3 = Factory.thing()

    expect(thing1.id).toBe('thing-1')
    expect(thing2.id).toBe('thing-2')
    expect(thing3.id).toBe('thing-3')
  })

  it('should accept custom overrides', () => {
    const thing = Factory.thing({
      id: 'custom-id',
      typeName: 'Document',
      data: { title: 'Test Document' },
    })

    expect(thing.id).toBe('custom-id')
    expect(thing.typeName).toBe('Document')
    expect(thing.data).toEqual({ title: 'Test Document' })
  })

  it('should create multiple things', () => {
    const things = Factory.things(5)

    expect(things).toHaveLength(5)
    things.forEach((thing, i) => {
      expect(thing.id).toBe(`thing-${i + 1}`)
    })
  })

  it('should apply overrides to all things in batch', () => {
    const things = Factory.things(3, { typeName: 'Product' })

    things.forEach((thing) => {
      expect(thing.typeName).toBe('Product')
    })
  })
})

// ============================================================================
// FACTORY TESTS - Relationship
// ============================================================================

describe('Factory.relationship', () => {
  beforeEach(() => {
    Factory.reset()
  })

  it('should create a relationship with default values', () => {
    const rel = Factory.relationship()

    expect(rel.id).toBe('rel-1')
    expect(rel.verb).toBeTruthy()
    expect(rel.from).toMatch(/^do:\/\//)
    expect(rel.to).toMatch(/^do:\/\//)
    expect(rel.data).toBeNull()
    expect(rel.createdAt).toBeInstanceOf(Date)
  })

  it('should create relationships with sequential IDs', () => {
    const rel1 = Factory.relationship()
    const rel2 = Factory.relationship()

    expect(rel1.id).toBe('rel-1')
    expect(rel2.id).toBe('rel-2')
  })

  it('should accept custom overrides', () => {
    const rel = Factory.relationship({
      verb: 'purchased',
      from: 'do://test/users/alice',
      to: 'do://test/products/widget',
      data: { quantity: 5 },
    })

    expect(rel.verb).toBe('purchased')
    expect(rel.from).toBe('do://test/users/alice')
    expect(rel.to).toBe('do://test/products/widget')
    expect(rel.data).toEqual({ quantity: 5 })
  })

  it('should create multiple relationships', () => {
    const rels = Factory.relationships(3)

    expect(rels).toHaveLength(3)
    rels.forEach((rel, i) => {
      expect(rel.id).toBe(`rel-${i + 1}`)
    })
  })
})

// ============================================================================
// FACTORY TESTS - User
// ============================================================================

describe('Factory.user', () => {
  beforeEach(() => {
    Factory.reset()
  })

  it('should create a user with default values', () => {
    const user = Factory.user()

    expect(user.id).toBe('user-1')
    expect(user.email).toMatch(/@/)
    expect(user.name).toBeTruthy()
    expect(user.status).toBe('active')
    expect(user.emailVerified).toBe(true)
    expect(user.createdAt).toBeInstanceOf(Date)
    expect(user.updatedAt).toBeInstanceOf(Date)
  })

  it('should create users with sequential IDs', () => {
    const user1 = Factory.user()
    const user2 = Factory.user()

    expect(user1.id).toBe('user-1')
    expect(user2.id).toBe('user-2')
  })

  it('should accept custom overrides', () => {
    const user = Factory.user({
      name: 'Custom Name',
      email: 'custom@test.com',
      status: 'suspended',
      emailVerified: false,
    })

    expect(user.name).toBe('Custom Name')
    expect(user.email).toBe('custom@test.com')
    expect(user.status).toBe('suspended')
    expect(user.emailVerified).toBe(false)
  })

  it('should create multiple users', () => {
    const users = Factory.users(5)

    expect(users).toHaveLength(5)
    users.forEach((user, i) => {
      expect(user.id).toBe(`user-${i + 1}`)
    })
  })
})

// ============================================================================
// FACTORY TESTS - Session
// ============================================================================

describe('Factory.session', () => {
  beforeEach(() => {
    Factory.reset()
  })

  it('should create a session with default values', () => {
    const session = Factory.session()

    expect(session.id).toBe('session-1')
    expect(session.userId).toBeTruthy()
    expect(session.data).toEqual({})
    expect(session.createdAt).toBeGreaterThan(0)
    expect(session.expiresAt).toBeGreaterThan(session.createdAt)
    expect(session.lastAccessedAt).toBe(session.createdAt)
    expect(session.metadata?.ip).toBeTruthy()
    expect(session.metadata?.userAgent).toBeTruthy()
  })

  it('should create sessions with sequential IDs', () => {
    const session1 = Factory.session()
    const session2 = Factory.session()

    expect(session1.id).toBe('session-1')
    expect(session2.id).toBe('session-2')
  })

  it('should accept custom overrides', () => {
    const session = Factory.session({
      userId: 'custom-user',
      data: { role: 'admin' },
      metadata: { device: 'mobile' },
    })

    expect(session.userId).toBe('custom-user')
    expect(session.data).toEqual({ role: 'admin' })
    expect(session.metadata).toEqual({ device: 'mobile' })
  })

  it('should create multiple sessions', () => {
    const sessions = Factory.sessions(3)

    expect(sessions).toHaveLength(3)
    sessions.forEach((session, i) => {
      expect(session.id).toBe(`session-${i + 1}`)
    })
  })
})

// ============================================================================
// FACTORY TESTS - Event
// ============================================================================

describe('Factory.event', () => {
  beforeEach(() => {
    Factory.reset()
  })

  it('should create an event with default values', () => {
    const event = Factory.event()

    expect(event.$id).toBe('evt-1')
    expect(event.type).toBeTruthy()
    expect(event.payload).toBeDefined()
    expect(event.$timestamp).toBeGreaterThan(0)
    expect(event.source).toBeUndefined()
    expect(event.correlationId).toBeUndefined()
  })

  it('should create events with sequential IDs', () => {
    const event1 = Factory.event()
    const event2 = Factory.event()

    expect(event1.$id).toBe('evt-1')
    expect(event2.$id).toBe('evt-2')
  })

  it('should accept custom overrides', () => {
    const event = Factory.event({
      type: 'user.created',
      payload: { userId: '123' },
      source: 'api-server',
      correlationId: 'req-456',
    })

    expect(event.type).toBe('user.created')
    expect(event.payload).toEqual({ userId: '123' })
    expect(event.source).toBe('api-server')
    expect(event.correlationId).toBe('req-456')
  })

  it('should create multiple events', () => {
    const events = Factory.events(4)

    expect(events).toHaveLength(4)
    events.forEach((event, i) => {
      expect(event.$id).toBe(`evt-${i + 1}`)
    })
  })
})

// ============================================================================
// FACTORY TESTS - Composite
// ============================================================================

describe('Factory composite methods', () => {
  beforeEach(() => {
    Factory.reset()
  })

  describe('graph', () => {
    it('should create a graph with things and relationships', () => {
      const { things, relationships } = Factory.graph(5, 10)

      expect(things).toHaveLength(5)
      expect(relationships).toHaveLength(10)

      relationships.forEach((rel) => {
        expect(rel.from).toMatch(/^do:\/\/test\/things\/thing-\d+$/)
        expect(rel.to).toMatch(/^do:\/\/test\/things\/thing-\d+$/)
      })
    })
  })

  describe('userWithSession', () => {
    it('should create a user with linked session', () => {
      const { user, session } = Factory.userWithSession()

      expect(user.id).toBeTruthy()
      expect(session.userId).toBe(user.id)
    })

    it('should accept overrides for both user and session', () => {
      const { user, session } = Factory.userWithSession({ name: 'Test User' }, { data: { admin: true } })

      expect(user.name).toBe('Test User')
      expect(session.data).toEqual({ admin: true })
      expect(session.userId).toBe(user.id)
    })
  })

  describe('reset', () => {
    it('should reset all sequences', () => {
      Factory.thing()
      Factory.user()
      Factory.event()

      Factory.reset()

      expect(Factory.thing().id).toBe('thing-1')
      expect(Factory.user().id).toBe('user-1')
      expect(Factory.event().$id).toBe('evt-1')
    })
  })
})

// ============================================================================
// BUILDER PATTERN TESTS
// ============================================================================

describe('Builder pattern', () => {
  beforeEach(() => {
    Factory.reset()
  })

  describe('buildThing', () => {
    it('should build thing with fluent interface', () => {
      const thing = buildThing().with('typeName', 'Document').with('id', 'doc-1').build()

      expect(thing.typeName).toBe('Document')
      expect(thing.id).toBe('doc-1')
    })

    it('should build thing with multiple overrides', () => {
      const thing = buildThing()
        .withAll({ typeName: 'Product', data: { price: 99.99 } })
        .build()

      expect(thing.typeName).toBe('Product')
      expect(thing.data).toEqual({ price: 99.99 })
    })

    it('should build multiple things', () => {
      const things = buildThing().with('typeName', 'Task').buildMany(3)

      expect(things).toHaveLength(3)
      things.forEach((thing) => {
        expect(thing.typeName).toBe('Task')
      })
    })
  })

  describe('buildRelationship', () => {
    it('should build relationship with fluent interface', () => {
      const rel = buildRelationship()
        .with('verb', 'owns')
        .with('from', 'do://test/users/1')
        .with('to', 'do://test/items/1')
        .build()

      expect(rel.verb).toBe('owns')
      expect(rel.from).toBe('do://test/users/1')
      expect(rel.to).toBe('do://test/items/1')
    })
  })

  describe('buildUser', () => {
    it('should build user with fluent interface', () => {
      const user = buildUser().with('name', 'Alice Smith').with('email', 'alice@example.com').build()

      expect(user.name).toBe('Alice Smith')
      expect(user.email).toBe('alice@example.com')
    })
  })

  describe('buildSession', () => {
    it('should build session with fluent interface', () => {
      const session = buildSession().with('userId', 'user-42').with('data', { role: 'admin' }).build()

      expect(session.userId).toBe('user-42')
      expect(session.data).toEqual({ role: 'admin' })
    })
  })

  describe('buildEvent', () => {
    it('should build event with fluent interface', () => {
      const event = buildEvent().with('type', 'order.completed').with('source', 'payment-service').build()

      expect(event.type).toBe('order.completed')
      expect(event.source).toBe('payment-service')
    })
  })
})

// ============================================================================
// TYPE SAFETY TESTS
// ============================================================================

describe('Type safety', () => {
  it('should create properly typed things', () => {
    const thing: GraphThing = Factory.thing()
    expect(thing.id).toBeDefined()
    expect(thing.typeId).toBeDefined()
    expect(thing.typeName).toBeDefined()
  })

  it('should create properly typed relationships', () => {
    const rel: GraphRelationship = Factory.relationship()
    expect(rel.id).toBeDefined()
    expect(rel.verb).toBeDefined()
    expect(rel.from).toBeDefined()
    expect(rel.to).toBeDefined()
  })

  it('should create properly typed users', () => {
    const user: User = Factory.user()
    expect(user.id).toBeDefined()
    expect(user.email).toBeDefined()
    expect(user.name).toBeDefined()
  })

  it('should create properly typed sessions', () => {
    const session: Session = Factory.session()
    expect(session.id).toBeDefined()
    expect(session.userId).toBeDefined()
    expect(session.expiresAt).toBeDefined()
  })

  it('should create properly typed events', () => {
    const event: Event = Factory.event()
    expect(event.$id).toBeDefined()
    expect(event.type).toBeDefined()
    expect(event.$timestamp).toBeDefined()
  })
})

// ============================================================================
// DB FACTORY TESTS - DbThing
// ============================================================================

describe('DbFactory.thing', () => {
  beforeEach(() => {
    DbFactory.reset()
  })

  it('should create a DbThing with $-prefixed system fields', () => {
    const thing = DbFactory.thing({ $type: 'Customer' })

    expect(thing.$id).toBeDefined()
    expect(thing.$type).toBe('Customer')
    expect(thing.$createdAt).toBeGreaterThan(0)
    expect(thing.$updatedAt).toBeGreaterThan(0)
  })

  it('should accept custom properties', () => {
    const thing = DbFactory.thing({
      $type: 'Customer',
      name: 'Alice',
      email: 'alice@test.com',
    })

    expect(thing.$type).toBe('Customer')
    expect(thing.name).toBe('Alice')
    expect(thing.email).toBe('alice@test.com')
  })

  it('should create multiple DbThings', () => {
    const things = DbFactory.things(3, { $type: 'Product' })

    expect(things).toHaveLength(3)
    things.forEach((thing) => {
      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Product')
    })
  })

  it('should create thingInput without system fields', () => {
    const input = DbFactory.thingInput({ $type: 'Customer', name: 'Bob' })

    expect(input.$type).toBe('Customer')
    expect(input.name).toBe('Bob')
    expect((input as any).$id).toBeUndefined()
    expect((input as any).$createdAt).toBeUndefined()
  })
})

// ============================================================================
// DB FACTORY TESTS - DbRelationship
// ============================================================================

describe('DbFactory.relationship', () => {
  beforeEach(() => {
    DbFactory.reset()
  })

  it('should create a DbRelationship with required fields', () => {
    const rel = DbFactory.relationship({
      subject: 'user-1',
      predicate: 'owns',
      object: 'order-1',
    })

    expect(rel.subject).toBe('user-1')
    expect(rel.predicate).toBe('owns')
    expect(rel.object).toBe('order-1')
    expect(rel.$createdAt).toBeGreaterThan(0)
  })

  it('should generate random subject/predicate/object when not provided', () => {
    const rel = DbFactory.relationship()

    expect(rel.subject).toBeDefined()
    expect(rel.predicate).toBeDefined()
    expect(rel.object).toBeDefined()
  })

  it('should create multiple DbRelationships', () => {
    const rels = DbFactory.relationships(3, { predicate: 'follows' })

    expect(rels).toHaveLength(3)
    rels.forEach((rel) => {
      expect(rel.predicate).toBe('follows')
    })
  })

  it('should create relationshipInput without $createdAt', () => {
    const input = DbFactory.relationshipInput({
      subject: 'user-1',
      predicate: 'owns',
      object: 'order-1',
    })

    expect(input.subject).toBe('user-1')
    expect(input.predicate).toBe('owns')
    expect(input.object).toBe('order-1')
    expect((input as any).$createdAt).toBeUndefined()
  })
})

// ============================================================================
// DB FACTORY TESTS - DbEvent
// ============================================================================

describe('DbFactory.event', () => {
  beforeEach(() => {
    DbFactory.reset()
  })

  it('should create a DbEvent with $-prefixed system fields', () => {
    const event = DbFactory.event({ type: 'user.created', payload: { id: '123' } })

    expect(event.$id).toMatch(/^evt-/)
    expect(event.type).toBe('user.created')
    expect(event.payload).toEqual({ id: '123' })
    expect(event.$timestamp).toBeGreaterThan(0)
  })

  it('should include optional source and correlationId', () => {
    const event = DbFactory.event({
      type: 'order.placed',
      payload: {},
      source: 'api-server',
      correlationId: 'req-456',
    })

    expect(event.source).toBe('api-server')
    expect(event.correlationId).toBe('req-456')
  })

  it('should create multiple DbEvents', () => {
    const events = DbFactory.events(3, { type: 'test.event', payload: {} })

    expect(events).toHaveLength(3)
    events.forEach((event) => {
      expect(event.type).toBe('test.event')
    })
  })

  it('should create eventInput without system fields', () => {
    const input = DbFactory.eventInput({
      type: 'user.signup',
      payload: { email: 'test@test.com' },
      source: 'web',
    })

    expect(input.type).toBe('user.signup')
    expect(input.payload).toEqual({ email: 'test@test.com' })
    expect(input.source).toBe('web')
    expect((input as any).$id).toBeUndefined()
    expect((input as any).$timestamp).toBeUndefined()
  })
})

// ============================================================================
// DB FACTORY TESTS - ApiKey
// ============================================================================

describe('DbFactory.apiKey', () => {
  beforeEach(() => {
    DbFactory.reset()
  })

  it('should create an API key with default values', () => {
    const key = DbFactory.apiKey()

    expect(key.id).toMatch(/^key-/)
    expect(key.name).toBeTruthy()
    expect(key.hashedKey).toBeDefined()
    expect(key.prefix).toMatch(/^dotdo_/)
    expect(key.scopes).toEqual(['*'])
    expect(key.active).toBe(true)
    expect(key.createdAt).toBeInstanceOf(Date)
  })

  it('should accept custom values', () => {
    const key = DbFactory.apiKey({
      name: 'Production Key',
      scopes: ['users:read', 'posts:write'],
      active: false,
    })

    expect(key.name).toBe('Production Key')
    expect(key.scopes).toEqual(['users:read', 'posts:write'])
    expect(key.active).toBe(false)
  })

  it('should include optional fields when provided', () => {
    const expiresAt = new Date(Date.now() + 86400000)
    const key = DbFactory.apiKey({
      expiresAt,
      rateLimit: { maxRequests: 1000, windowMs: 60000 },
      metadata: { userId: '123' },
    })

    expect(key.expiresAt).toEqual(expiresAt)
    expect(key.rateLimit).toEqual({ maxRequests: 1000, windowMs: 60000 })
    expect(key.metadata).toEqual({ userId: '123' })
  })

  it('should create multiple API keys', () => {
    const keys = DbFactory.apiKeys(3)

    expect(keys).toHaveLength(3)
    keys.forEach((key) => {
      expect(key.id).toBeDefined()
      expect(key.active).toBe(true)
    })
  })
})

// ============================================================================
// DB FACTORY TESTS - TokenPayload
// ============================================================================

describe('DbFactory.tokenPayload', () => {
  beforeEach(() => {
    DbFactory.reset()
  })

  it('should create a token payload with default values', () => {
    const payload = DbFactory.tokenPayload()

    expect(payload.sub).toMatch(/^user-/)
    expect(payload.iss).toBe('id.org.ai')
    expect(payload.aud).toBe('dotdo.api')
    expect(payload.iat).toBeGreaterThan(0)
    expect(payload.exp).toBeGreaterThan(payload.iat!)
    expect(payload.roles).toEqual(['user'])
  })

  it('should accept custom values', () => {
    const payload = DbFactory.tokenPayload({
      sub: 'admin-123',
      email: 'admin@test.com',
      roles: ['admin', 'user'],
      scopes: ['*'],
    })

    expect(payload.sub).toBe('admin-123')
    expect(payload.email).toBe('admin@test.com')
    expect(payload.roles).toEqual(['admin', 'user'])
    expect(payload.scopes).toEqual(['*'])
  })
})

// ============================================================================
// FIXTURES TESTS
// ============================================================================

describe('Fixtures', () => {
  beforeEach(() => {
    Factory.reset()
    DbFactory.reset()
  })

  describe('entity fixtures', () => {
    it('should create a customer fixture', () => {
      const customer = Fixtures.customer({ name: 'Alice' })

      expect(customer.$type).toBe('Customer')
      expect(customer.name).toBe('Alice')
      expect(customer.email).toBeDefined()
      expect(customer.status).toBe('active')
    })

    it('should create an order fixture', () => {
      const order = Fixtures.order({ total: 99.99 })

      expect(order.$type).toBe('Order')
      expect(order.total).toBe(99.99)
      expect(order.status).toBe('pending')
    })

    it('should create a product fixture', () => {
      const product = Fixtures.product({ name: 'Widget' })

      expect(product.$type).toBe('Product')
      expect(product.name).toBe('Widget')
      expect(product.price).toBeDefined()
      expect(product.sku).toBeDefined()
    })
  })

  describe('event fixtures', () => {
    it('should create a user signup event fixture', () => {
      const event = Fixtures.userSignupEvent()

      expect(event.type).toBe('user.signup')
      expect((event.payload as any).email).toBeDefined()
      expect((event.payload as any).name).toBeDefined()
    })

    it('should create an order placed event fixture', () => {
      const event = Fixtures.orderPlacedEvent()

      expect(event.type).toBe('order.placed')
      expect((event.payload as any).orderId).toBeDefined()
      expect((event.payload as any).total).toBeDefined()
    })
  })

  describe('relationship fixtures', () => {
    it('should create an ownership relationship', () => {
      const rel = Fixtures.ownershipRelationship('user-1', 'order-1')

      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('order-1')
    })
  })

  describe('auth fixtures', () => {
    it('should create an admin user', () => {
      const user = Fixtures.adminUser()

      expect(user.status).toBe('active')
      expect(user.emailVerified).toBe(true)
      expect(user.metadata?.role).toBe('admin')
    })

    it('should create an admin API key', () => {
      const key = Fixtures.adminApiKey()

      expect(key.name).toBe('Admin API Key')
      expect(key.scopes).toEqual(['*'])
      expect(key.active).toBe(true)
    })

    it('should create a readonly API key', () => {
      const key = Fixtures.readonlyApiKey()

      expect(key.name).toBe('Readonly API Key')
      expect(key.scopes).toEqual(['read:*'])
    })

    it('should create an expired API key', () => {
      const key = Fixtures.expiredApiKey()

      expect(key.name).toBe('Expired API Key')
      expect(key.expiresAt).toBeDefined()
      expect(key.expiresAt!.getTime()).toBeLessThan(Date.now())
    })

    it('should create a revoked API key', () => {
      const key = Fixtures.revokedApiKey()

      expect(key.name).toBe('Revoked API Key')
      expect(key.active).toBe(false)
      expect(key.revokedAt).toBeDefined()
    })
  })
})

// ============================================================================
// DB FACTORY BUILDER TESTS
// ============================================================================

describe('DB Factory Builders', () => {
  beforeEach(() => {
    DbFactory.reset()
  })

  it('should build DbThing with fluent interface', () => {
    const thing = buildDbThing()
      .with('$type', 'Document')
      .with('name', 'Test Doc')
      .build()

    expect(thing.$type).toBe('Document')
    expect(thing.name).toBe('Test Doc')
  })

  it('should build DbRelationship with fluent interface', () => {
    const rel = buildDbRelationship()
      .with('subject', 'user-1')
      .with('predicate', 'owns')
      .with('object', 'doc-1')
      .build()

    expect(rel.subject).toBe('user-1')
    expect(rel.predicate).toBe('owns')
    expect(rel.object).toBe('doc-1')
  })

  it('should build DbEvent with fluent interface', () => {
    const event = buildDbEvent()
      .with('type', 'document.created')
      .with('payload', { docId: '123' })
      .build()

    expect(event.type).toBe('document.created')
    expect(event.payload).toEqual({ docId: '123' })
  })

  it('should build ApiKey with fluent interface', () => {
    const key = buildApiKey()
      .with('name', 'Test Key')
      .with('scopes', ['read:*'])
      .build()

    expect(key.name).toBe('Test Key')
    expect(key.scopes).toEqual(['read:*'])
  })
})
