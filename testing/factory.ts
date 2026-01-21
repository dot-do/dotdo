/**
 * Test Data Factory
 *
 * Factory functions for generating test fixtures with:
 * - Type-safe factory functions for Things, Relationships, Users, Sessions, and Events
 * - Support for overrides to customize generated data
 * - Sequence generators for unique IDs
 * - Faker-like helpers for random data generation
 *
 * @module testing/factory
 *
 * @example
 * ```typescript
 * import { Factory, Fake } from '@/testing/factory'
 *
 * // Create a user with default values
 * const user = Factory.user()
 *
 * // Create a user with custom name
 * const customUser = Factory.user({ name: 'Custom Name' })
 *
 * // Create a thing with specific type
 * const thing = Factory.thing({ type: 'document' })
 *
 * // Generate random data
 * const email = Fake.email()
 * const uuid = Fake.uuid()
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * GraphThing - represents a node in the graph.
 * Based on db/graph/things.ts
 */
export interface GraphThing {
  id: string
  typeId: number
  typeName: string
  data: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * GraphRelationship - represents an edge in the graph.
 * Based on db/graph/relationships.ts
 */
export interface GraphRelationship {
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: Date
}

/**
 * User - represents an authenticated user.
 * Based on primitives/types/auth and auth/session.ts
 */
export interface User {
  id: string
  email: string
  name: string
  status: 'active' | 'inactive' | 'suspended' | 'pending_verification' | 'deleted'
  emailVerified: boolean
  createdAt: Date
  updatedAt: Date
  metadata?: Record<string, unknown>
}

/**
 * Session - represents an active user session.
 * Based on auth/session.ts
 */
export interface Session {
  id: string
  userId: string
  data: Record<string, unknown>
  createdAt: number
  expiresAt: number
  lastAccessedAt: number
  metadata?: SessionMetadata
}

export interface SessionMetadata {
  ip?: string
  userAgent?: string
  device?: string
  [key: string]: unknown
}

/**
 * Event - represents an emitted event.
 * Based on db/events.ts
 */
export interface Event {
  $id: string
  type: string
  payload: unknown
  $timestamp: number
  source?: string
  correlationId?: string
}

// ============================================================================
// SEQUENCE GENERATOR
// ============================================================================

/**
 * Sequence generator for creating unique sequential IDs.
 * Maintains separate counters per sequence name.
 */
class SequenceGenerator {
  private counters: Map<string, number> = new Map()

  /**
   * Get the next value in a sequence.
   * @param name - The sequence name (defaults to 'default')
   * @returns The next sequential number
   */
  next(name: string = 'default'): number {
    const current = this.counters.get(name) ?? 0
    const next = current + 1
    this.counters.set(name, next)
    return next
  }

  /**
   * Reset a sequence to start from 0.
   * @param name - The sequence name to reset (or 'all' to reset all)
   */
  reset(name: string = 'default'): void {
    if (name === 'all') {
      this.counters.clear()
    } else {
      this.counters.delete(name)
    }
  }

  /**
   * Get current value without incrementing.
   * @param name - The sequence name
   */
  current(name: string = 'default'): number {
    return this.counters.get(name) ?? 0
  }
}

export const Sequence = new SequenceGenerator()

// ============================================================================
// FAKER-LIKE HELPERS
// ============================================================================

/**
 * Simple seeded random number generator for reproducible tests.
 * Uses Mulberry32 algorithm.
 */
function createRng(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Global RNG instance, can be reseeded for reproducibility
let globalRng = createRng(Date.now())

/**
 * Faker-like helpers for generating random test data.
 */
export const Fake = {
  /**
   * Set a seed for reproducible random data.
   * @param seed - The seed value
   */
  seed(seed: number): void {
    globalRng = createRng(seed)
  },

  /**
   * Reset to use current time as seed (non-reproducible).
   */
  resetSeed(): void {
    globalRng = createRng(Date.now())
  },

  /**
   * Generate a random float between 0 and 1.
   */
  random(): number {
    return globalRng()
  },

  /**
   * Generate a random integer in range [min, max].
   */
  int(min: number = 0, max: number = Number.MAX_SAFE_INTEGER): number {
    return Math.floor(globalRng() * (max - min + 1)) + min
  },

  /**
   * Generate a random float in range [min, max).
   */
  float(min: number = 0, max: number = 1): number {
    return globalRng() * (max - min) + min
  },

  /**
   * Generate a random boolean.
   */
  boolean(): boolean {
    return globalRng() >= 0.5
  },

  /**
   * Pick a random element from an array.
   */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(globalRng() * arr.length)]!
  },

  /**
   * Pick multiple random elements from an array.
   */
  pickMany<T>(arr: readonly T[], count: number): T[] {
    const shuffled = [...arr].sort(() => globalRng() - 0.5)
    return shuffled.slice(0, Math.min(count, arr.length))
  },

  /**
   * Generate a random string of specified length.
   */
  string(length: number = 10, charset: string = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
    let result = ''
    for (let i = 0; i < length; i++) {
      result += charset[Math.floor(globalRng() * charset.length)]
    }
    return result
  },

  /**
   * Generate a random alphanumeric string.
   */
  alphanumeric(length: number = 10): string {
    return Fake.string(length, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')
  },

  /**
   * Generate a UUID v4.
   */
  uuid(): string {
    const hex = '0123456789abcdef'
    let uuid = ''
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        uuid += '-'
      } else if (i === 14) {
        uuid += '4'
      } else if (i === 19) {
        uuid += hex[Math.floor(globalRng() * 4) + 8]
      } else {
        uuid += hex[Math.floor(globalRng() * 16)]
      }
    }
    return uuid
  },

  /**
   * Generate a random email address.
   */
  email(domain?: string): string {
    const user = Fake.string(8, 'abcdefghijklmnopqrstuvwxyz')
    const domains = ['example.com', 'test.com', 'fake.org', 'mock.io']
    return `${user}@${domain ?? Fake.pick(domains)}`
  },

  /**
   * Generate a random name.
   */
  name(): string {
    const firstNames = [
      'Alice',
      'Bob',
      'Charlie',
      'Diana',
      'Edward',
      'Fiona',
      'George',
      'Hannah',
      'Ivan',
      'Julia',
      'Kevin',
      'Laura',
      'Michael',
      'Nina',
      'Oscar',
      'Patricia',
      'Quinn',
      'Rachel',
      'Samuel',
      'Teresa',
    ]
    const lastNames = [
      'Smith',
      'Johnson',
      'Williams',
      'Brown',
      'Jones',
      'Garcia',
      'Miller',
      'Davis',
      'Rodriguez',
      'Martinez',
      'Hernandez',
      'Lopez',
      'Gonzalez',
      'Wilson',
      'Anderson',
      'Thomas',
      'Taylor',
      'Moore',
      'Jackson',
      'Martin',
    ]
    return `${Fake.pick(firstNames)} ${Fake.pick(lastNames)}`
  },

  /**
   * Generate a random first name.
   */
  firstName(): string {
    const names = [
      'Alice',
      'Bob',
      'Charlie',
      'Diana',
      'Edward',
      'Fiona',
      'George',
      'Hannah',
      'Ivan',
      'Julia',
    ]
    return Fake.pick(names)
  },

  /**
   * Generate a random last name.
   */
  lastName(): string {
    const names = [
      'Smith',
      'Johnson',
      'Williams',
      'Brown',
      'Jones',
      'Garcia',
      'Miller',
      'Davis',
      'Rodriguez',
      'Martinez',
    ]
    return Fake.pick(names)
  },

  /**
   * Generate a random URL.
   */
  url(protocol: string = 'https'): string {
    const domains = ['example.com', 'test.org', 'mock.io', 'fake.dev']
    const paths = ['', '/home', '/about', '/api', '/users', '/things']
    return `${protocol}://${Fake.pick(domains)}${Fake.pick(paths)}`
  },

  /**
   * Generate a random DO URL.
   */
  doUrl(tenant?: string, type?: string, id?: string): string {
    const t = tenant ?? Fake.string(8)
    const ty = type ?? Fake.pick(['users', 'products', 'orders', 'things'])
    const i = id ?? Fake.uuid()
    return `do://${t}/${ty}/${i}`
  },

  /**
   * Generate a random IP address.
   */
  ip(): string {
    return `${Fake.int(1, 255)}.${Fake.int(0, 255)}.${Fake.int(0, 255)}.${Fake.int(1, 254)}`
  },

  /**
   * Generate a random user agent string.
   */
  userAgent(): string {
    const browsers = ['Chrome/120.0', 'Firefox/121.0', 'Safari/17.0', 'Edge/120.0']
    const os = ['Windows NT 10.0', 'Macintosh', 'Linux x86_64']
    return `Mozilla/5.0 (${Fake.pick(os)}) AppleWebKit/537.36 (KHTML, like Gecko) ${Fake.pick(browsers)}`
  },

  /**
   * Generate a random date within a range.
   */
  date(start?: Date, end?: Date): Date {
    const s = start ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) // 1 year ago
    const e = end ?? new Date()
    const timestamp = Fake.int(s.getTime(), e.getTime())
    return new Date(timestamp)
  },

  /**
   * Generate a random timestamp (Unix ms).
   */
  timestamp(start?: number, end?: number): number {
    const s = start ?? Date.now() - 365 * 24 * 60 * 60 * 1000
    const e = end ?? Date.now()
    return Fake.int(s, e)
  },

  /**
   * Generate a random word.
   */
  word(): string {
    const words = [
      'apple',
      'banana',
      'cherry',
      'date',
      'elderberry',
      'fig',
      'grape',
      'honeydew',
      'kiwi',
      'lemon',
      'mango',
      'nectarine',
      'orange',
      'papaya',
      'quince',
      'raspberry',
      'strawberry',
      'tangerine',
      'watermelon',
      'zucchini',
    ]
    return Fake.pick(words)
  },

  /**
   * Generate random words.
   */
  words(count: number = 3): string {
    return Array.from({ length: count }, () => Fake.word()).join(' ')
  },

  /**
   * Generate a random sentence.
   */
  sentence(wordCount: number = 8): string {
    const words = Fake.words(wordCount)
    return words.charAt(0).toUpperCase() + words.slice(1) + '.'
  },

  /**
   * Generate a random paragraph.
   */
  paragraph(sentenceCount: number = 4): string {
    return Array.from({ length: sentenceCount }, () => Fake.sentence(Fake.int(6, 12))).join(' ')
  },

  /**
   * Generate a random verb (for relationships).
   */
  verb(): string {
    const verbs = [
      'created',
      'updated',
      'deleted',
      'owns',
      'belongs_to',
      'purchased',
      'viewed',
      'liked',
      'commented_on',
      'follows',
      'manages',
      'works_for',
      'contains',
      'references',
      'links_to',
    ]
    return Fake.pick(verbs)
  },

  /**
   * Generate a random thing type name.
   */
  thingType(): string {
    const types = [
      'Customer',
      'Product',
      'Order',
      'Document',
      'User',
      'Organization',
      'Project',
      'Task',
      'Comment',
      'Asset',
    ]
    return Fake.pick(types)
  },

  /**
   * Generate a random event type.
   */
  eventType(): string {
    const types = [
      'user.created',
      'user.updated',
      'user.deleted',
      'order.placed',
      'order.completed',
      'payment.received',
      'document.uploaded',
      'session.started',
      'session.ended',
      'thing.created',
    ]
    return Fake.pick(types)
  },
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

type PartialDeep<T> = T extends object
  ? {
      [P in keyof T]?: PartialDeep<T[P]>
    }
  : T

/**
 * Factory for creating test data objects with sensible defaults
 * and support for custom overrides.
 */
export const Factory = {
  /**
   * Create a GraphThing with defaults.
   * @param overrides - Optional values to override defaults
   */
  thing(overrides: Partial<GraphThing> = {}): GraphThing {
    const seq = Sequence.next('thing')
    const now = Date.now()
    const typeName = overrides.typeName ?? Fake.thingType()

    return {
      id: overrides.id ?? `thing-${seq}`,
      typeId: overrides.typeId ?? seq,
      typeName,
      data: overrides.data ?? { name: Fake.word(), description: Fake.sentence() },
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
      deletedAt: overrides.deletedAt ?? null,
    }
  },

  /**
   * Create multiple GraphThings.
   * @param count - Number of things to create
   * @param overrides - Optional values to override defaults (applied to all)
   */
  things(count: number, overrides: Partial<GraphThing> = {}): GraphThing[] {
    return Array.from({ length: count }, () => Factory.thing(overrides))
  },

  /**
   * Create a GraphRelationship with defaults.
   * @param overrides - Optional values to override defaults
   */
  relationship(overrides: Partial<GraphRelationship> = {}): GraphRelationship {
    const seq = Sequence.next('relationship')

    return {
      id: overrides.id ?? `rel-${seq}`,
      verb: overrides.verb ?? Fake.verb(),
      from: overrides.from ?? Fake.doUrl(),
      to: overrides.to ?? Fake.doUrl(),
      data: overrides.data ?? null,
      createdAt: overrides.createdAt ?? new Date(),
    }
  },

  /**
   * Create multiple GraphRelationships.
   * @param count - Number of relationships to create
   * @param overrides - Optional values to override defaults
   */
  relationships(count: number, overrides: Partial<GraphRelationship> = {}): GraphRelationship[] {
    return Array.from({ length: count }, () => Factory.relationship(overrides))
  },

  /**
   * Create a User with defaults.
   * @param overrides - Optional values to override defaults
   */
  user(overrides: Partial<User> = {}): User {
    const seq = Sequence.next('user')
    const now = new Date()
    const name = overrides.name ?? Fake.name()
    const email = overrides.email ?? Fake.email()

    const user: User = {
      id: overrides.id ?? `user-${seq}`,
      email,
      name,
      status: overrides.status ?? 'active',
      emailVerified: overrides.emailVerified ?? true,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    }
    if (overrides.metadata !== undefined) {
      user.metadata = overrides.metadata
    }
    return user
  },

  /**
   * Create multiple Users.
   * @param count - Number of users to create
   * @param overrides - Optional values to override defaults
   */
  users(count: number, overrides: Partial<User> = {}): User[] {
    return Array.from({ length: count }, () => Factory.user(overrides))
  },

  /**
   * Create a Session with defaults.
   * @param overrides - Optional values to override defaults
   */
  session(overrides: Partial<Session> = {}): Session {
    const seq = Sequence.next('session')
    const now = Date.now()
    const oneHour = 60 * 60 * 1000

    return {
      id: overrides.id ?? `session-${seq}`,
      userId: overrides.userId ?? `user-${Sequence.current('user') || Sequence.next('user')}`,
      data: overrides.data ?? {},
      createdAt: overrides.createdAt ?? now,
      expiresAt: overrides.expiresAt ?? now + oneHour,
      lastAccessedAt: overrides.lastAccessedAt ?? now,
      metadata: overrides.metadata ?? {
        ip: Fake.ip(),
        userAgent: Fake.userAgent(),
      },
    }
  },

  /**
   * Create multiple Sessions.
   * @param count - Number of sessions to create
   * @param overrides - Optional values to override defaults
   */
  sessions(count: number, overrides: Partial<Session> = {}): Session[] {
    return Array.from({ length: count }, () => Factory.session(overrides))
  },

  /**
   * Create an Event with defaults.
   * @param overrides - Optional values to override defaults
   */
  event(overrides: Partial<Event> = {}): Event {
    const seq = Sequence.next('event')
    const now = Date.now()

    const event: Event = {
      $id: overrides.$id ?? `evt-${seq}`,
      type: overrides.type ?? Fake.eventType(),
      payload: overrides.payload ?? { action: Fake.verb(), target: Fake.uuid() },
      $timestamp: overrides.$timestamp ?? now,
    }
    if (overrides.source !== undefined) {
      event.source = overrides.source
    }
    if (overrides.correlationId !== undefined) {
      event.correlationId = overrides.correlationId
    }
    return event
  },

  /**
   * Create multiple Events.
   * @param count - Number of events to create
   * @param overrides - Optional values to override defaults
   */
  events(count: number, overrides: Partial<Event> = {}): Event[] {
    return Array.from({ length: count }, () => Factory.event(overrides))
  },

  /**
   * Create a connected graph of things with relationships.
   * @param nodeCount - Number of things to create
   * @param edgeCount - Number of relationships to create
   */
  graph(nodeCount: number, edgeCount: number): { things: GraphThing[]; relationships: GraphRelationship[] } {
    const things = Factory.things(nodeCount)
    const relationships: GraphRelationship[] = []

    for (let i = 0; i < edgeCount; i++) {
      const fromThing = Fake.pick(things)
      const toThing = Fake.pick(things)

      relationships.push(
        Factory.relationship({
          from: `do://test/things/${fromThing.id}`,
          to: `do://test/things/${toThing.id}`,
        })
      )
    }

    return { things, relationships }
  },

  /**
   * Create a user with a session.
   */
  userWithSession(
    userOverrides: Partial<User> = {},
    sessionOverrides: Partial<Session> = {}
  ): { user: User; session: Session } {
    const user = Factory.user(userOverrides)
    const session = Factory.session({
      ...sessionOverrides,
      userId: user.id,
    })
    return { user, session }
  },

  /**
   * Reset all sequences.
   * Call this in beforeEach to ensure consistent IDs across tests.
   */
  reset(): void {
    Sequence.reset('all')
  },
}

// ============================================================================
// BUILD PATTERN SUPPORT
// ============================================================================

/**
 * Builder pattern for creating complex test objects.
 * Provides a fluent interface for setting properties.
 */
export class FactoryBuilder<T extends object> {
  private overrides: Partial<T> = {}
  private factory: (overrides: Partial<T>) => T

  constructor(factory: (overrides: Partial<T>) => T) {
    this.factory = factory
  }

  /**
   * Set a property value.
   */
  with<K extends keyof T>(key: K, value: T[K]): this {
    this.overrides[key] = value
    return this
  }

  /**
   * Set multiple property values.
   */
  withAll(overrides: Partial<T>): this {
    this.overrides = { ...this.overrides, ...overrides }
    return this
  }

  /**
   * Build the final object.
   */
  build(): T {
    return this.factory(this.overrides)
  }

  /**
   * Build multiple objects.
   */
  buildMany(count: number): T[] {
    return Array.from({ length: count }, () => this.factory(this.overrides))
  }
}

/**
 * Create a builder for a Thing.
 */
export function buildThing(): FactoryBuilder<GraphThing> {
  return new FactoryBuilder(Factory.thing)
}

/**
 * Create a builder for a Relationship.
 */
export function buildRelationship(): FactoryBuilder<GraphRelationship> {
  return new FactoryBuilder(Factory.relationship)
}

/**
 * Create a builder for a User.
 */
export function buildUser(): FactoryBuilder<User> {
  return new FactoryBuilder(Factory.user)
}

/**
 * Create a builder for a Session.
 */
export function buildSession(): FactoryBuilder<Session> {
  return new FactoryBuilder(Factory.session)
}

/**
 * Create a builder for an Event.
 */
export function buildEvent(): FactoryBuilder<Event> {
  return new FactoryBuilder(Factory.event)
}

// ============================================================================
// DB-COMPATIBLE FACTORIES (for @dotdo/db types)
// ============================================================================

/**
 * DbThing - represents a Thing entity compatible with @dotdo/db.
 * Uses $-prefixed system fields as per db/things.ts
 */
export interface DbThing {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

/**
 * DbRelationship - represents a Relationship compatible with @dotdo/db.
 * Uses subject-predicate-object pattern as per db/relationships.ts
 */
export interface DbRelationship {
  subject: string
  predicate: string
  object: string
  $createdAt: number
  [key: string]: unknown
}

/**
 * DbEvent - represents an Event compatible with @dotdo/db.
 * Uses $-prefixed system fields as per db/events.ts
 */
export interface DbEvent {
  $id: string
  type: string
  payload: unknown
  $timestamp: number
  source?: string
  correlationId?: string
}

/**
 * ApiKey - represents an API key for auth testing.
 * Compatible with @dotdo/auth/apikey.ts
 */
export interface ApiKey {
  id: string
  name: string
  hashedKey: string
  prefix: string
  scopes: string[]
  active: boolean
  createdAt: Date
  expiresAt?: Date | undefined
  revokedAt?: Date | undefined
  lastUsedAt?: Date | undefined
  metadata?: Record<string, unknown> | undefined
  rateLimit?: {
    maxRequests: number
    windowMs: number
  } | undefined
}

/**
 * Token payload for JWT testing
 */
export interface TokenPayload {
  sub: string
  iss?: string
  aud?: string
  exp?: number
  iat?: number
  email?: string
  roles?: string[]
  scopes?: string[]
  [key: string]: unknown
}

/**
 * DB-compatible factory functions that create entities matching @dotdo/db types.
 * These are designed to work directly with ThingsStore, EventsStore, and RelationshipsStore.
 */
export const DbFactory = {
  /**
   * Create a DbThing compatible with @dotdo/db/things.
   * @param overrides - Optional values to override defaults
   */
  thing(overrides: Partial<DbThing> & { $type?: string } = {}): DbThing {
    const seq = Sequence.next('dbThing')
    const now = Date.now()

    return {
      $id: overrides.$id ?? `thing-${Fake.alphanumeric(8)}`,
      $type: overrides.$type ?? Fake.thingType(),
      $createdAt: overrides.$createdAt ?? now,
      $updatedAt: overrides.$updatedAt ?? now,
      ...Object.fromEntries(
        Object.entries(overrides).filter(([k]) => !k.startsWith('$'))
      ),
    }
  },

  /**
   * Create multiple DbThings.
   * @param count - Number of things to create
   * @param overrides - Optional values to override defaults (applied to all)
   */
  things(count: number, overrides: Partial<DbThing> & { $type?: string } = {}): DbThing[] {
    return Array.from({ length: count }, () => DbFactory.thing(overrides))
  },

  /**
   * Create input data for ThingsStore.create() (without $id, $createdAt, $updatedAt).
   * @param overrides - Optional values including required $type
   */
  thingInput(overrides: { $type: string } & Record<string, unknown>): { $type: string } & Record<string, unknown> {
    const { $type, ...rest } = overrides
    return {
      $type,
      name: rest.name ?? Fake.word(),
      ...rest,
    }
  },

  /**
   * Create a DbRelationship compatible with @dotdo/db/relationships.
   * @param overrides - Optional values to override defaults
   */
  relationship(overrides: Partial<DbRelationship> = {}): DbRelationship {
    const now = Date.now()

    return {
      subject: overrides.subject ?? `thing-${Fake.alphanumeric(8)}`,
      predicate: overrides.predicate ?? Fake.verb(),
      object: overrides.object ?? `thing-${Fake.alphanumeric(8)}`,
      $createdAt: overrides.$createdAt ?? now,
      ...Object.fromEntries(
        Object.entries(overrides).filter(([k]) => !['subject', 'predicate', 'object', '$createdAt'].includes(k))
      ),
    }
  },

  /**
   * Create multiple DbRelationships.
   * @param count - Number of relationships to create
   * @param overrides - Optional values to override defaults
   */
  relationships(count: number, overrides: Partial<DbRelationship> = {}): DbRelationship[] {
    return Array.from({ length: count }, () => DbFactory.relationship(overrides))
  },

  /**
   * Create input data for RelationshipsStore.add() (without $createdAt).
   * @param overrides - Required subject, predicate, object
   */
  relationshipInput(overrides: { subject: string; predicate: string; object: string } & Record<string, unknown>): { subject: string; predicate: string; object: string } & Record<string, unknown> {
    return {
      subject: overrides.subject,
      predicate: overrides.predicate,
      object: overrides.object,
      ...Object.fromEntries(
        Object.entries(overrides).filter(([k]) => !['subject', 'predicate', 'object'].includes(k))
      ),
    }
  },

  /**
   * Create a DbEvent compatible with @dotdo/db/events.
   * @param overrides - Optional values to override defaults
   */
  event(overrides: Partial<DbEvent> = {}): DbEvent {
    const seq = Sequence.next('dbEvent')
    const now = Date.now()

    const event: DbEvent = {
      $id: overrides.$id ?? `evt-${Fake.alphanumeric(8)}`,
      type: overrides.type ?? Fake.eventType(),
      payload: overrides.payload ?? { action: Fake.verb(), target: Fake.uuid() },
      $timestamp: overrides.$timestamp ?? now,
    }

    if (overrides.source !== undefined) {
      event.source = overrides.source
    }
    if (overrides.correlationId !== undefined) {
      event.correlationId = overrides.correlationId
    }

    return event
  },

  /**
   * Create multiple DbEvents.
   * @param count - Number of events to create
   * @param overrides - Optional values to override defaults
   */
  events(count: number, overrides: Partial<DbEvent> = {}): DbEvent[] {
    return Array.from({ length: count }, () => DbFactory.event(overrides))
  },

  /**
   * Create input data for EventsStore.emit() (without $id, $timestamp).
   * @param overrides - Required type and payload
   */
  eventInput(overrides: { type: string; payload: unknown } & Partial<Pick<DbEvent, 'source' | 'correlationId'>>): { type: string; payload: unknown; source?: string; correlationId?: string } {
    const input: { type: string; payload: unknown; source?: string; correlationId?: string } = {
      type: overrides.type,
      payload: overrides.payload,
    }
    if (overrides.source !== undefined) {
      input.source = overrides.source
    }
    if (overrides.correlationId !== undefined) {
      input.correlationId = overrides.correlationId
    }
    return input
  },

  /**
   * Create an API key for auth testing.
   * @param overrides - Optional values to override defaults
   */
  apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
    const seq = Sequence.next('apiKey')
    const now = new Date()
    const prefix = overrides.prefix ?? `dotdo_${Fake.alphanumeric(6)}`

    return {
      id: overrides.id ?? `key-${seq}`,
      name: overrides.name ?? `API Key ${seq}`,
      hashedKey: overrides.hashedKey ?? Fake.alphanumeric(64),
      prefix,
      scopes: overrides.scopes ?? ['*'],
      active: overrides.active ?? true,
      createdAt: overrides.createdAt ?? now,
      expiresAt: overrides.expiresAt,
      revokedAt: overrides.revokedAt,
      lastUsedAt: overrides.lastUsedAt,
      metadata: overrides.metadata,
      rateLimit: overrides.rateLimit,
    }
  },

  /**
   * Create multiple API keys.
   * @param count - Number of API keys to create
   * @param overrides - Optional values to override defaults
   */
  apiKeys(count: number, overrides: Partial<ApiKey> = {}): ApiKey[] {
    return Array.from({ length: count }, () => DbFactory.apiKey(overrides))
  },

  /**
   * Create a JWT token payload for auth testing.
   * @param overrides - Optional values to override defaults
   */
  tokenPayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
    const seq = Sequence.next('token')
    const now = Math.floor(Date.now() / 1000)

    return {
      sub: overrides.sub ?? `user-${seq}`,
      iss: overrides.iss ?? 'id.org.ai',
      aud: overrides.aud ?? 'dotdo.api',
      iat: overrides.iat ?? now,
      exp: overrides.exp ?? now + 3600, // 1 hour
      email: overrides.email ?? Fake.email(),
      roles: overrides.roles ?? ['user'],
      scopes: overrides.scopes ?? [],
      ...Object.fromEntries(
        Object.entries(overrides).filter(([k]) => !['sub', 'iss', 'aud', 'iat', 'exp', 'email', 'roles', 'scopes'].includes(k))
      ),
    }
  },

  /**
   * Reset all DB factory sequences.
   */
  reset(): void {
    Sequence.reset('dbThing')
    Sequence.reset('dbEvent')
    Sequence.reset('apiKey')
    Sequence.reset('token')
  },
}

// ============================================================================
// DB FACTORY BUILDERS
// ============================================================================

/**
 * Create a builder for a DbThing.
 */
export function buildDbThing(): FactoryBuilder<DbThing> {
  return new FactoryBuilder(DbFactory.thing)
}

/**
 * Create a builder for a DbRelationship.
 */
export function buildDbRelationship(): FactoryBuilder<DbRelationship> {
  return new FactoryBuilder(DbFactory.relationship)
}

/**
 * Create a builder for a DbEvent.
 */
export function buildDbEvent(): FactoryBuilder<DbEvent> {
  return new FactoryBuilder(DbFactory.event)
}

/**
 * Create a builder for an ApiKey.
 */
export function buildApiKey(): FactoryBuilder<ApiKey> {
  return new FactoryBuilder(DbFactory.apiKey)
}

// ============================================================================
// COMMON TEST FIXTURES
// ============================================================================

/**
 * Pre-built test fixtures for common testing scenarios.
 * These provide consistent, reusable test data.
 */
export const Fixtures = {
  /**
   * Customer entity fixture
   */
  customer(overrides: Record<string, unknown> = {}): DbThing {
    return DbFactory.thing({
      $type: 'Customer',
      name: overrides.name ?? Fake.name(),
      email: overrides.email ?? Fake.email(),
      status: overrides.status ?? 'active',
      ...overrides,
    })
  },

  /**
   * Order entity fixture
   */
  order(overrides: Record<string, unknown> = {}): DbThing {
    return DbFactory.thing({
      $type: 'Order',
      total: overrides.total ?? Fake.float(10, 1000),
      status: overrides.status ?? 'pending',
      items: overrides.items ?? [],
      ...overrides,
    })
  },

  /**
   * Product entity fixture
   */
  product(overrides: Record<string, unknown> = {}): DbThing {
    return DbFactory.thing({
      $type: 'Product',
      name: overrides.name ?? Fake.word(),
      price: overrides.price ?? Fake.float(1, 100),
      sku: overrides.sku ?? Fake.alphanumeric(8).toUpperCase(),
      ...overrides,
    })
  },

  /**
   * User signup event fixture
   */
  userSignupEvent(overrides: Partial<DbEvent> = {}): DbEvent {
    return DbFactory.event({
      type: 'user.signup',
      payload: {
        email: Fake.email(),
        name: Fake.name(),
        ...((overrides.payload as Record<string, unknown>) ?? {}),
      },
      ...overrides,
    })
  },

  /**
   * Order placed event fixture
   */
  orderPlacedEvent(overrides: Partial<DbEvent> = {}): DbEvent {
    return DbFactory.event({
      type: 'order.placed',
      payload: {
        orderId: Fake.uuid(),
        total: Fake.float(10, 1000),
        ...((overrides.payload as Record<string, unknown>) ?? {}),
      },
      ...overrides,
    })
  },

  /**
   * Ownership relationship fixture (user owns order)
   */
  ownershipRelationship(userId: string, orderId: string, overrides: Record<string, unknown> = {}): DbRelationship {
    return DbFactory.relationship({
      subject: userId,
      predicate: 'owns',
      object: orderId,
      ...overrides,
    })
  },

  /**
   * Admin user with full permissions
   */
  adminUser(): User {
    return Factory.user({
      status: 'active',
      emailVerified: true,
      metadata: { role: 'admin', permissions: ['*'] },
    })
  },

  /**
   * Admin API key with all scopes
   */
  adminApiKey(): ApiKey {
    return DbFactory.apiKey({
      name: 'Admin API Key',
      scopes: ['*'],
      active: true,
    })
  },

  /**
   * Readonly API key
   */
  readonlyApiKey(): ApiKey {
    return DbFactory.apiKey({
      name: 'Readonly API Key',
      scopes: ['read:*'],
      active: true,
    })
  },

  /**
   * Expired API key for testing expiration handling
   */
  expiredApiKey(): ApiKey {
    const now = new Date()
    const expired = new Date(now.getTime() - 24 * 60 * 60 * 1000) // 1 day ago
    return DbFactory.apiKey({
      name: 'Expired API Key',
      expiresAt: expired,
      active: true,
    })
  },

  /**
   * Revoked API key for testing revocation handling
   */
  revokedApiKey(): ApiKey {
    return DbFactory.apiKey({
      name: 'Revoked API Key',
      active: false,
      revokedAt: new Date(),
    })
  },
}

// ============================================================================
// EXPORTS
// ============================================================================

export default Factory
