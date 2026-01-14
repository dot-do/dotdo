/**
 * Test Fixtures - Reusable test data and setup utilities
 *
 * Provides fixtures for common testing scenarios including Things, Events,
 * Users, and API data. Fixtures can be composed and customized for specific
 * test requirements.
 *
 * @example
 * ```typescript
 * import { fixtures, createFixtureFactory, withTestContext } from 'testing/fixtures'
 *
 * // Use pre-built fixtures
 * const user = fixtures.user({ name: 'Alice' })
 * const things = fixtures.things(10, { $type: 'Customer' })
 *
 * // Create custom fixture factories
 * const createOrder = createFixtureFactory<Order>({
 *   defaults: { status: 'pending', total: 0 },
 *   generate: (index) => ({ id: `order-${index}` }),
 * })
 * ```
 *
 * @module testing/fixtures
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Thing fixture matching the dotdo Thing schema
 */
export interface ThingFixture {
  $id: string
  $type: string
  $ns?: string
  $branch?: string
  $version?: number
  $createdAt?: string
  $updatedAt?: string
  $deleted?: boolean
  data: Record<string, unknown>
}

/**
 * User fixture for auth testing
 */
export interface UserFixture {
  id: string
  email: string
  name: string
  role?: string
  orgId?: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

/**
 * Event fixture for pipeline testing
 */
export interface EventFixture {
  id: string
  type: string
  source: string
  timestamp: string
  correlationId?: string
  payload: Record<string, unknown>
  metadata?: {
    version?: number
    sequence?: number
    branch?: string
  }
}

/**
 * API Request fixture
 */
export interface RequestFixture {
  method: string
  path: string
  headers: Record<string, string>
  body?: unknown
  query?: Record<string, string>
}

/**
 * Relationship fixture for graph testing
 */
export interface RelationshipFixture {
  id: string
  source: { $type: string; $id: string }
  target: { $type: string; $id: string }
  relation: string
  properties?: Record<string, unknown>
  createdAt?: string
}

/**
 * Factory configuration for custom fixtures
 */
export interface FixtureFactoryConfig<T> {
  /** Default values for all fixtures */
  defaults?: Partial<T>
  /** Generate indexed values (called with index 0, 1, 2, ...) */
  generate?: (index: number) => Partial<T>
  /** Post-process the fixture after creation */
  transform?: (fixture: T, index: number) => T
}

/**
 * Options for test context fixtures
 */
export interface TestContextOptions {
  /** Namespace URL for the test DO */
  ns?: string
  /** Initial Things to populate */
  things?: ThingFixture[]
  /** Initial Relationships to populate */
  relationships?: RelationshipFixture[]
  /** Branch name (default: 'main') */
  branch?: string
  /** Environment bindings to include */
  env?: Record<string, unknown>
}

/**
 * Test context fixture for DO testing
 */
export interface TestContextFixture {
  ns: string
  branch: string
  things: Map<string, ThingFixture>
  relationships: RelationshipFixture[]
  events: EventFixture[]
  env: Record<string, unknown>
}

// ============================================================================
// ID GENERATION
// ============================================================================

let idCounter = 0

/**
 * Generate a unique test ID with optional prefix
 */
export function generateTestId(prefix: string = 'test'): string {
  const timestamp = Date.now().toString(36)
  const counter = (idCounter++).toString(36).padStart(4, '0')
  const random = Math.random().toString(36).slice(2, 6)
  return `${prefix}-${timestamp}-${counter}-${random}`
}

/**
 * Reset the ID counter (useful between test files)
 */
export function resetIdCounter(): void {
  idCounter = 0
}

/**
 * Generate a deterministic ID from a seed (for reproducible tests)
 */
export function seedId(seed: string, prefix: string = 'test'): string {
  // Simple hash function
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`
}

// ============================================================================
// THING FIXTURES
// ============================================================================

/**
 * Create a single Thing fixture
 */
export function createThing(overrides: Partial<ThingFixture> = {}): ThingFixture {
  const now = new Date().toISOString()
  return {
    $id: overrides.$id ?? generateTestId('thing'),
    $type: overrides.$type ?? 'TestThing',
    $ns: overrides.$ns,
    $branch: overrides.$branch ?? 'main',
    $version: overrides.$version ?? 1,
    $createdAt: overrides.$createdAt ?? now,
    $updatedAt: overrides.$updatedAt ?? now,
    $deleted: overrides.$deleted ?? false,
    data: overrides.data ?? {},
  }
}

/**
 * Create multiple Thing fixtures
 */
export function createThings(
  count: number,
  overrides: Partial<ThingFixture> | ((index: number) => Partial<ThingFixture>) = {}
): ThingFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const override = typeof overrides === 'function' ? overrides(index) : overrides
    return createThing({
      ...override,
      $id: override.$id ?? generateTestId(`thing-${index}`),
      data: {
        index,
        ...(override.data ?? {}),
      },
    })
  })
}

/**
 * Thing type factories for common types
 */
export const thingTypes = {
  customer: (overrides: Partial<ThingFixture> = {}): ThingFixture =>
    createThing({
      $type: 'Customer',
      data: {
        name: `Customer ${generateTestId('name').slice(-4)}`,
        email: `customer-${generateTestId('email').slice(-4)}@test.com`,
        status: 'active',
        ...overrides.data,
      },
      ...overrides,
    }),

  order: (overrides: Partial<ThingFixture> = {}): ThingFixture =>
    createThing({
      $type: 'Order',
      data: {
        customerId: generateTestId('customer'),
        status: 'pending',
        total: Math.floor(Math.random() * 10000) / 100,
        items: [],
        ...overrides.data,
      },
      ...overrides,
    }),

  product: (overrides: Partial<ThingFixture> = {}): ThingFixture =>
    createThing({
      $type: 'Product',
      data: {
        name: `Product ${generateTestId('name').slice(-4)}`,
        sku: generateTestId('sku').toUpperCase().slice(-8),
        price: Math.floor(Math.random() * 10000) / 100,
        inventory: Math.floor(Math.random() * 100),
        ...overrides.data,
      },
      ...overrides,
    }),

  document: (overrides: Partial<ThingFixture> = {}): ThingFixture =>
    createThing({
      $type: 'Document',
      data: {
        title: `Document ${generateTestId('title').slice(-4)}`,
        content: 'Test document content',
        mimeType: 'text/plain',
        size: 1024,
        ...overrides.data,
      },
      ...overrides,
    }),

  task: (overrides: Partial<ThingFixture> = {}): ThingFixture =>
    createThing({
      $type: 'Task',
      data: {
        title: `Task ${generateTestId('title').slice(-4)}`,
        status: 'todo',
        priority: 'medium',
        assignee: null,
        dueDate: null,
        ...overrides.data,
      },
      ...overrides,
    }),
}

// ============================================================================
// USER FIXTURES
// ============================================================================

/**
 * Create a single User fixture
 */
export function createUser(overrides: Partial<UserFixture> = {}): UserFixture {
  const id = overrides.id ?? generateTestId('user')
  const now = new Date().toISOString()
  return {
    id,
    email: overrides.email ?? `${id}@test.example.com`,
    name: overrides.name ?? `Test User ${id.slice(-4)}`,
    role: overrides.role ?? 'user',
    orgId: overrides.orgId,
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  }
}

/**
 * Create multiple User fixtures
 */
export function createUsers(
  count: number,
  overrides: Partial<UserFixture> | ((index: number) => Partial<UserFixture>) = {}
): UserFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const override = typeof overrides === 'function' ? overrides(index) : overrides
    return createUser({
      ...override,
      id: override.id ?? generateTestId(`user-${index}`),
    })
  })
}

/**
 * User role factories
 */
export const userRoles = {
  admin: (overrides: Partial<UserFixture> = {}): UserFixture =>
    createUser({ role: 'admin', ...overrides }),

  member: (overrides: Partial<UserFixture> = {}): UserFixture =>
    createUser({ role: 'member', ...overrides }),

  viewer: (overrides: Partial<UserFixture> = {}): UserFixture =>
    createUser({ role: 'viewer', ...overrides }),

  guest: (overrides: Partial<UserFixture> = {}): UserFixture =>
    createUser({ role: 'guest', ...overrides }),
}

// ============================================================================
// EVENT FIXTURES
// ============================================================================

/**
 * Create a single Event fixture
 */
export function createEvent(overrides: Partial<EventFixture> = {}): EventFixture {
  return {
    id: overrides.id ?? generateTestId('event'),
    type: overrides.type ?? 'test.event',
    source: overrides.source ?? 'test.do',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    correlationId: overrides.correlationId ?? generateTestId('corr'),
    payload: overrides.payload ?? {},
    metadata: overrides.metadata ?? { version: 1, sequence: 1 },
  }
}

/**
 * Create multiple Event fixtures
 */
export function createEvents(
  count: number,
  overrides: Partial<EventFixture> | ((index: number) => Partial<EventFixture>) = {}
): EventFixture[] {
  const correlationId = generateTestId('batch')
  return Array.from({ length: count }, (_, index) => {
    const override = typeof overrides === 'function' ? overrides(index) : overrides
    return createEvent({
      ...override,
      id: override.id ?? generateTestId(`event-${index}`),
      correlationId: override.correlationId ?? correlationId,
      metadata: {
        version: 1,
        sequence: index + 1,
        ...(override.metadata ?? {}),
      },
    })
  })
}

/**
 * Event type factories for common events
 */
export const eventTypes = {
  thingCreated: (thingId: string, thingType: string, overrides: Partial<EventFixture> = {}): EventFixture =>
    createEvent({
      type: 'thing.created',
      payload: { thingId, thingType, action: 'create', ...overrides.payload },
      ...overrides,
    }),

  thingUpdated: (thingId: string, thingType: string, changes: Record<string, unknown>, overrides: Partial<EventFixture> = {}): EventFixture =>
    createEvent({
      type: 'thing.updated',
      payload: { thingId, thingType, changes, action: 'update', ...overrides.payload },
      ...overrides,
    }),

  thingDeleted: (thingId: string, thingType: string, overrides: Partial<EventFixture> = {}): EventFixture =>
    createEvent({
      type: 'thing.deleted',
      payload: { thingId, thingType, action: 'delete', ...overrides.payload },
      ...overrides,
    }),

  lifecycle: (operation: 'fork' | 'clone' | 'move' | 'compact', details: Record<string, unknown> = {}, overrides: Partial<EventFixture> = {}): EventFixture =>
    createEvent({
      type: `lifecycle.${operation}`,
      payload: { operation, ...details, ...overrides.payload },
      ...overrides,
    }),
}

// ============================================================================
// REQUEST FIXTURES
// ============================================================================

/**
 * Create an API Request fixture
 */
export function createRequest(overrides: Partial<RequestFixture> = {}): RequestFixture {
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/health',
    headers: {
      'Content-Type': 'application/json',
      ...(overrides.headers ?? {}),
    },
    body: overrides.body,
    query: overrides.query,
  }
}

/**
 * Request factories for common patterns
 */
export const requestTypes = {
  get: (path: string, overrides: Partial<RequestFixture> = {}): RequestFixture =>
    createRequest({ method: 'GET', path, ...overrides }),

  post: (path: string, body: unknown, overrides: Partial<RequestFixture> = {}): RequestFixture =>
    createRequest({ method: 'POST', path, body, ...overrides }),

  put: (path: string, body: unknown, overrides: Partial<RequestFixture> = {}): RequestFixture =>
    createRequest({ method: 'PUT', path, body, ...overrides }),

  patch: (path: string, body: unknown, overrides: Partial<RequestFixture> = {}): RequestFixture =>
    createRequest({ method: 'PATCH', path, body, ...overrides }),

  delete: (path: string, overrides: Partial<RequestFixture> = {}): RequestFixture =>
    createRequest({ method: 'DELETE', path, ...overrides }),

  authenticated: (request: RequestFixture, token: string = 'test-token'): RequestFixture => ({
    ...request,
    headers: {
      ...request.headers,
      Authorization: `Bearer ${token}`,
    },
  }),
}

// ============================================================================
// RELATIONSHIP FIXTURES
// ============================================================================

/**
 * Create a Relationship fixture
 */
export function createRelationship(overrides: Partial<RelationshipFixture> = {}): RelationshipFixture {
  return {
    id: overrides.id ?? generateTestId('rel'),
    source: overrides.source ?? { $type: 'Thing', $id: generateTestId('source') },
    target: overrides.target ?? { $type: 'Thing', $id: generateTestId('target') },
    relation: overrides.relation ?? 'related',
    properties: overrides.properties ?? {},
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  }
}

/**
 * Relationship factories for common patterns
 */
export const relationshipTypes = {
  owns: (ownerId: string, ownerType: string, ownedId: string, ownedType: string): RelationshipFixture =>
    createRelationship({
      source: { $type: ownerType, $id: ownerId },
      target: { $type: ownedType, $id: ownedId },
      relation: 'owns',
    }),

  belongsTo: (childId: string, childType: string, parentId: string, parentType: string): RelationshipFixture =>
    createRelationship({
      source: { $type: childType, $id: childId },
      target: { $type: parentType, $id: parentId },
      relation: 'belongsTo',
    }),

  references: (sourceId: string, sourceType: string, targetId: string, targetType: string): RelationshipFixture =>
    createRelationship({
      source: { $type: sourceType, $id: sourceId },
      target: { $type: targetType, $id: targetId },
      relation: 'references',
    }),
}

// ============================================================================
// FIXTURE FACTORY
// ============================================================================

/**
 * Create a custom fixture factory for your own types
 *
 * @example
 * ```typescript
 * interface Invoice {
 *   id: string
 *   customerId: string
 *   amount: number
 *   status: 'draft' | 'sent' | 'paid'
 * }
 *
 * const createInvoice = createFixtureFactory<Invoice>({
 *   defaults: { status: 'draft', amount: 0 },
 *   generate: (index) => ({
 *     id: `invoice-${index}`,
 *     amount: (index + 1) * 100,
 *   }),
 * })
 *
 * const invoice = createInvoice({ customerId: 'cust-123' })
 * const invoices = createInvoice.many(5, { status: 'sent' })
 * ```
 */
export function createFixtureFactory<T extends Record<string, unknown>>(
  config: FixtureFactoryConfig<T>
): {
  (overrides?: Partial<T>): T
  many(count: number, overrides?: Partial<T> | ((index: number) => Partial<T>)): T[]
} {
  let instanceCounter = 0

  const factory = (overrides: Partial<T> = {}): T => {
    const index = instanceCounter++
    const generated = config.generate?.(index) ?? ({} as Partial<T>)
    const fixture = {
      ...(config.defaults ?? {}),
      ...generated,
      ...overrides,
    } as T

    return config.transform ? config.transform(fixture, index) : fixture
  }

  factory.many = (count: number, overrides: Partial<T> | ((index: number) => Partial<T>) = {}): T[] => {
    return Array.from({ length: count }, (_, index) => {
      const override = typeof overrides === 'function' ? overrides(index) : overrides
      return factory(override)
    })
  }

  return factory
}

// ============================================================================
// TEST CONTEXT FIXTURES
// ============================================================================

/**
 * Create a test context fixture for DO testing
 */
export function createTestContext(options: TestContextOptions = {}): TestContextFixture {
  const things = new Map<string, ThingFixture>()

  // Add provided things
  if (options.things) {
    for (const thing of options.things) {
      things.set(thing.$id, thing)
    }
  }

  return {
    ns: options.ns ?? `https://test-${generateTestId('do')}.do`,
    branch: options.branch ?? 'main',
    things,
    relationships: options.relationships ?? [],
    events: [],
    env: options.env ?? {},
  }
}

/**
 * Higher-order function to wrap tests with a clean context
 */
export function withTestContext(
  options: TestContextOptions = {}
): (testFn: (ctx: TestContextFixture) => void | Promise<void>) => () => Promise<void> {
  return (testFn) => async () => {
    const ctx = createTestContext(options)
    try {
      await testFn(ctx)
    } finally {
      // Cleanup if needed
      ctx.things.clear()
      ctx.relationships.length = 0
      ctx.events.length = 0
    }
  }
}

// ============================================================================
// PRE-BUILT FIXTURE COLLECTIONS
// ============================================================================

/**
 * Standard fixture collections for common test scenarios
 */
export const fixtures = {
  // Single instance factories
  thing: createThing,
  user: createUser,
  event: createEvent,
  request: createRequest,
  relationship: createRelationship,

  // Bulk factories
  things: createThings,
  users: createUsers,
  events: createEvents,

  // Type-specific factories
  thingTypes,
  userRoles,
  eventTypes,
  requestTypes,
  relationshipTypes,

  // Context
  context: createTestContext,
  withContext: withTestContext,

  // Custom factory builder
  factory: createFixtureFactory,

  // ID utilities
  id: generateTestId,
  seedId,
  resetIds: resetIdCounter,
}

export default fixtures
