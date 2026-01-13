/**
 * Graph Test Utilities and Factories
 *
 * Centralized test utilities for graph module testing. Provides factory
 * functions for creating test fixtures, seed functions for common scenarios,
 * and assertion helpers for verifying graph state.
 *
 * @see dotdo-wmtan - [RED] Create graph test utilities and factories
 *
 * Design:
 * - Factory functions create isolated test fixtures
 * - Seed functions populate common test scenarios
 * - Assertion helpers provide clear error messages
 * - Uses real SQLite (NO MOCKS) per project testing philosophy
 *
 * @example
 * ```typescript
 * import {
 *   createTestGraphStore,
 *   createTestThing,
 *   createTestRelationship,
 *   seedTestGraph,
 *   assertThingExists,
 *   assertRelationshipExists,
 * } from './utils/graph-test-helpers'
 *
 * // Create a fresh graph store for testing
 * const store = await createTestGraphStore()
 *
 * // Create test fixtures
 * const customer = await createTestThing(store, { typeName: 'Customer', data: { name: 'Alice' } })
 * const product = await createTestThing(store, { typeName: 'Product', data: { name: 'Widget' } })
 *
 * // Create a relationship
 * await createTestRelationship(store, {
 *   verb: 'purchased',
 *   from: `do://tenant/customers/${customer.id}`,
 *   to: `do://tenant/products/${product.id}`,
 * })
 *
 * // Seed a common test graph
 * const graph = await seedTestGraph(store, 'ecommerce')
 *
 * // Assertions
 * await assertThingExists(store, customer.id)
 * await assertRelationshipExists(store, {
 *   from: `do://tenant/customers/${customer.id}`,
 *   verb: 'purchased'
 * })
 * ```
 *
 * @module db/graph/tests/utils/graph-test-helpers
 */

import { expect } from 'vitest'
import type { GraphStore, GraphThing, GraphRelationship } from '../../types'
import { SQLiteGraphStore } from '../../stores/sqlite'
import { NOUN_REGISTRY } from '../../nouns'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for creating a test Thing.
 */
export interface CreateTestThingOptions {
  /** Optional ID (auto-generated if not provided) */
  id?: string
  /** Type ID (uses NOUN_REGISTRY lookup if typeName is provided) */
  typeId?: number
  /** Type name (defaults to 'Customer') */
  typeName?: string
  /** Data payload */
  data?: Record<string, unknown> | null
}

/**
 * Options for creating a test Relationship.
 */
export interface CreateTestRelationshipOptions {
  /** Optional ID (auto-generated if not provided) */
  id?: string
  /** Verb (predicate) for the relationship */
  verb: string
  /** Source URL */
  from: string
  /** Target URL */
  to: string
  /** Optional data payload */
  data?: Record<string, unknown>
}

/**
 * Predefined test graph scenarios.
 */
export type TestGraphScenario =
  | 'empty'
  | 'ecommerce'
  | 'social'
  | 'organization'
  | 'workflow'
  | 'file-tree'

/**
 * Seeded graph with references to created Things and Relationships.
 */
export interface SeededGraph {
  /** All Things created */
  things: GraphThing[]
  /** All Relationships created */
  relationships: GraphRelationship[]
  /** Named references for easy access */
  refs: Record<string, GraphThing>
  /** Named relationship references */
  rels: Record<string, GraphRelationship>
}

/**
 * Options for asserting a relationship exists.
 */
export interface AssertRelationshipExistsOptions {
  /** Source URL to check from */
  from?: string
  /** Target URL to check to */
  to?: string
  /** Verb to check */
  verb?: string
  /** ID to check */
  id?: string
}

// ============================================================================
// COUNTERS
// ============================================================================

let thingCounter = 0
let relationshipCounter = 0

/**
 * Reset counters (useful between test runs).
 */
export function resetCounters(): void {
  thingCounter = 0
  relationshipCounter = 0
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a fresh GraphStore for testing.
 *
 * Creates an in-memory SQLite-backed GraphStore that is fully isolated.
 * Call `cleanup()` when done to close the database connection.
 *
 * @returns Object with store and cleanup function
 *
 * @example
 * ```typescript
 * const { store, cleanup } = await createTestGraphStore()
 * try {
 *   // Use store for testing
 *   const thing = await store.createThing({ ... })
 * } finally {
 *   await cleanup()
 * }
 * ```
 */
export async function createTestGraphStore(): Promise<{
  store: SQLiteGraphStore
  cleanup: () => Promise<void>
}> {
  const store = new SQLiteGraphStore(':memory:')
  await store.initialize()

  return {
    store,
    cleanup: async () => {
      await store.close()
    },
  }
}

/**
 * Generate a unique test ID with optional prefix.
 *
 * @param prefix - Optional prefix (defaults to 'test')
 * @returns A unique ID like 'test-thing-42'
 */
export function generateTestId(prefix = 'test'): string {
  thingCounter++
  return `${prefix}-${Date.now()}-${thingCounter}`
}

/**
 * Create a test Thing with sensible defaults.
 *
 * Auto-generates ID if not provided. Looks up typeId from typeName if only
 * typeName is provided.
 *
 * @param store - GraphStore instance
 * @param options - Thing creation options
 * @returns The created Thing
 *
 * @example
 * ```typescript
 * // Minimal - creates a Customer with auto-generated ID
 * const customer = await createTestThing(store)
 *
 * // With custom data
 * const alice = await createTestThing(store, {
 *   typeName: 'Customer',
 *   data: { name: 'Alice', email: 'alice@example.com' }
 * })
 *
 * // With specific ID
 * const product = await createTestThing(store, {
 *   id: 'product-widget',
 *   typeName: 'Product',
 *   data: { name: 'Widget', price: 29.99 }
 * })
 * ```
 */
export async function createTestThing(
  store: GraphStore,
  options: CreateTestThingOptions = {}
): Promise<GraphThing> {
  const typeName = options.typeName ?? 'Customer'
  const typeId = options.typeId ?? NOUN_REGISTRY[typeName]?.rowid ?? 500 // 500 = Customer
  const id = options.id ?? generateTestId(typeName.toLowerCase())

  return store.createThing({
    id,
    typeId,
    typeName,
    data: options.data ?? { name: `Test ${typeName} ${thingCounter}` },
  })
}

/**
 * Create multiple test Things at once.
 *
 * @param store - GraphStore instance
 * @param count - Number of Things to create
 * @param options - Options applied to all Things (ID will be auto-generated)
 * @returns Array of created Things
 *
 * @example
 * ```typescript
 * const customers = await createTestThings(store, 5, { typeName: 'Customer' })
 * // Creates 5 customers with auto-generated IDs and names
 * ```
 */
export async function createTestThings(
  store: GraphStore,
  count: number,
  options: Omit<CreateTestThingOptions, 'id'> = {}
): Promise<GraphThing[]> {
  const things: GraphThing[] = []
  for (let i = 0; i < count; i++) {
    things.push(await createTestThing(store, options))
  }
  return things
}

/**
 * Create a test Relationship with sensible defaults.
 *
 * Auto-generates ID if not provided.
 *
 * @param store - GraphStore instance
 * @param options - Relationship creation options
 * @returns The created Relationship
 *
 * @example
 * ```typescript
 * // Create relationship between two Things
 * const rel = await createTestRelationship(store, {
 *   verb: 'owns',
 *   from: 'do://tenant/users/alice',
 *   to: 'do://tenant/products/widget'
 * })
 *
 * // With custom ID and data
 * const purchase = await createTestRelationship(store, {
 *   id: 'purchase-001',
 *   verb: 'purchased',
 *   from: customerUrl,
 *   to: productUrl,
 *   data: { quantity: 2, price: 29.99 }
 * })
 * ```
 */
export async function createTestRelationship(
  store: GraphStore,
  options: CreateTestRelationshipOptions
): Promise<GraphRelationship> {
  relationshipCounter++
  const id = options.id ?? `rel-${Date.now()}-${relationshipCounter}`

  return store.createRelationship({
    id,
    verb: options.verb,
    from: options.from,
    to: options.to,
    data: options.data,
  })
}

/**
 * Create a pair of connected test Things with a relationship.
 *
 * Convenience function for the common pattern of creating two Things
 * and connecting them.
 *
 * @param store - GraphStore instance
 * @param options - Options for the connection
 * @returns Created Things and Relationship
 *
 * @example
 * ```typescript
 * const { from, to, relationship } = await createConnectedThings(store, {
 *   fromType: 'Customer',
 *   fromData: { name: 'Alice' },
 *   toType: 'Product',
 *   toData: { name: 'Widget' },
 *   verb: 'purchased'
 * })
 * ```
 */
export async function createConnectedThings(
  store: GraphStore,
  options: {
    fromType?: string
    fromData?: Record<string, unknown>
    toType?: string
    toData?: Record<string, unknown>
    verb: string
    relationshipData?: Record<string, unknown>
  }
): Promise<{
  from: GraphThing
  to: GraphThing
  relationship: GraphRelationship
}> {
  const fromThing = await createTestThing(store, {
    typeName: options.fromType ?? 'Customer',
    data: options.fromData,
  })

  const toThing = await createTestThing(store, {
    typeName: options.toType ?? 'Product',
    data: options.toData,
  })

  const relationship = await createTestRelationship(store, {
    verb: options.verb,
    from: `do://tenant/${(options.fromType ?? 'Customer').toLowerCase()}s/${fromThing.id}`,
    to: `do://tenant/${(options.toType ?? 'Product').toLowerCase()}s/${toThing.id}`,
    data: options.relationshipData,
  })

  return { from: fromThing, to: toThing, relationship }
}

// ============================================================================
// SEED FUNCTIONS
// ============================================================================

/**
 * Seed a test graph with a predefined scenario.
 *
 * Available scenarios:
 * - `empty`: No data (just returns empty references)
 * - `ecommerce`: Customers, Products, Orders with purchase relationships
 * - `social`: Users with follows/friends relationships
 * - `organization`: Orgs, Teams, Members with membership relationships
 * - `workflow`: Workflows, Instances, Steps with execution relationships
 * - `file-tree`: Directories and Files with contains relationships
 *
 * @param store - GraphStore instance
 * @param scenario - The scenario to seed
 * @returns References to all created entities
 *
 * @example
 * ```typescript
 * const { refs, rels } = await seedTestGraph(store, 'ecommerce')
 *
 * // Access seeded entities by name
 * const alice = refs.alice
 * const bob = refs.bob
 * const widget = refs.widget
 *
 * // Access seeded relationships
 * const alicePurchase = rels.alicePurchasesWidget
 * ```
 */
export async function seedTestGraph(
  store: GraphStore,
  scenario: TestGraphScenario
): Promise<SeededGraph> {
  switch (scenario) {
    case 'empty':
      return { things: [], relationships: [], refs: {}, rels: {} }

    case 'ecommerce':
      return seedEcommerceGraph(store)

    case 'social':
      return seedSocialGraph(store)

    case 'organization':
      return seedOrganizationGraph(store)

    case 'workflow':
      return seedWorkflowGraph(store)

    case 'file-tree':
      return seedFileTreeGraph(store)

    default:
      throw new Error(`Unknown test graph scenario: ${scenario}`)
  }
}

/**
 * Seed an e-commerce graph with customers, products, and orders.
 */
async function seedEcommerceGraph(store: GraphStore): Promise<SeededGraph> {
  const things: GraphThing[] = []
  const relationships: GraphRelationship[] = []
  const refs: Record<string, GraphThing> = {}
  const rels: Record<string, GraphRelationship> = {}

  // Create customers
  const alice = await createTestThing(store, {
    id: 'customer-alice',
    typeName: 'Customer',
    data: { name: 'Alice', email: 'alice@example.com', tier: 'premium' },
  })
  refs.alice = alice
  things.push(alice)

  const bob = await createTestThing(store, {
    id: 'customer-bob',
    typeName: 'Customer',
    data: { name: 'Bob', email: 'bob@example.com', tier: 'basic' },
  })
  refs.bob = bob
  things.push(bob)

  const charlie = await createTestThing(store, {
    id: 'customer-charlie',
    typeName: 'Customer',
    data: { name: 'Charlie', email: 'charlie@example.com', tier: 'premium' },
  })
  refs.charlie = charlie
  things.push(charlie)

  // Create products (using Customer typeId 500 which is valid in NOUN_REGISTRY)
  // Note: Product would need to be added to NOUN_REGISTRY for production use
  const widget = await createTestThing(store, {
    id: 'product-widget',
    typeName: 'Customer', // Using Customer as it's in registry; in real code add Product to registry
    data: { name: 'Widget', price: 29.99, category: 'electronics', _type: 'product' },
  })
  refs.widget = widget
  things.push(widget)

  const gadget = await createTestThing(store, {
    id: 'product-gadget',
    typeName: 'Customer',
    data: { name: 'Gadget', price: 49.99, category: 'electronics', _type: 'product' },
  })
  refs.gadget = gadget
  things.push(gadget)

  const gizmo = await createTestThing(store, {
    id: 'product-gizmo',
    typeName: 'Customer',
    data: { name: 'Gizmo', price: 19.99, category: 'accessories', _type: 'product' },
  })
  refs.gizmo = gizmo
  things.push(gizmo)

  // Create relationships: purchases
  const alicePurchasesWidget = await createTestRelationship(store, {
    id: 'rel-alice-widget',
    verb: 'purchased',
    from: 'do://tenant/customers/customer-alice',
    to: 'do://tenant/products/product-widget',
    data: { quantity: 2, date: '2024-01-15' },
  })
  rels.alicePurchasesWidget = alicePurchasesWidget
  relationships.push(alicePurchasesWidget)

  const alicePurchasesGadget = await createTestRelationship(store, {
    id: 'rel-alice-gadget',
    verb: 'purchased',
    from: 'do://tenant/customers/customer-alice',
    to: 'do://tenant/products/product-gadget',
    data: { quantity: 1, date: '2024-01-20' },
  })
  rels.alicePurchasesGadget = alicePurchasesGadget
  relationships.push(alicePurchasesGadget)

  const bobPurchasesWidget = await createTestRelationship(store, {
    id: 'rel-bob-widget',
    verb: 'purchased',
    from: 'do://tenant/customers/customer-bob',
    to: 'do://tenant/products/product-widget',
    data: { quantity: 1, date: '2024-02-01' },
  })
  rels.bobPurchasesWidget = bobPurchasesWidget
  relationships.push(bobPurchasesWidget)

  // Wishlist relationships
  const charlieWishesGizmo = await createTestRelationship(store, {
    id: 'rel-charlie-wishes-gizmo',
    verb: 'wishlisted',
    from: 'do://tenant/customers/customer-charlie',
    to: 'do://tenant/products/product-gizmo',
  })
  rels.charlieWishesGizmo = charlieWishesGizmo
  relationships.push(charlieWishesGizmo)

  return { things, relationships, refs, rels }
}

/**
 * Seed a social graph with users and follow relationships.
 */
async function seedSocialGraph(store: GraphStore): Promise<SeededGraph> {
  const things: GraphThing[] = []
  const relationships: GraphRelationship[] = []
  const refs: Record<string, GraphThing> = {}
  const rels: Record<string, GraphRelationship> = {}

  // Create users
  const users = ['alice', 'bob', 'charlie', 'diana', 'eve']
  for (const name of users) {
    const user = await createTestThing(store, {
      id: `user-${name}`,
      typeId: 10, // HumanUser
      typeName: 'HumanUser',
      data: { name: name.charAt(0).toUpperCase() + name.slice(1), username: `@${name}` },
    })
    refs[name] = user
    things.push(user)
  }

  // Create follow relationships (social network)
  // Alice follows Bob, Charlie, Diana
  for (const target of ['bob', 'charlie', 'diana']) {
    const rel = await createTestRelationship(store, {
      verb: 'follows',
      from: 'do://tenant/users/user-alice',
      to: `do://tenant/users/user-${target}`,
    })
    rels[`aliceFollows${target.charAt(0).toUpperCase() + target.slice(1)}`] = rel
    relationships.push(rel)
  }

  // Bob follows Alice (mutual)
  const bobFollowsAlice = await createTestRelationship(store, {
    verb: 'follows',
    from: 'do://tenant/users/user-bob',
    to: 'do://tenant/users/user-alice',
  })
  rels.bobFollowsAlice = bobFollowsAlice
  relationships.push(bobFollowsAlice)

  // Charlie follows everyone
  for (const target of ['alice', 'bob', 'diana', 'eve']) {
    const rel = await createTestRelationship(store, {
      verb: 'follows',
      from: 'do://tenant/users/user-charlie',
      to: `do://tenant/users/user-${target}`,
    })
    rels[`charlieFollows${target.charAt(0).toUpperCase() + target.slice(1)}`] = rel
    relationships.push(rel)
  }

  return { things, relationships, refs, rels }
}

/**
 * Seed an organization graph with orgs, teams, and members.
 */
async function seedOrganizationGraph(store: GraphStore): Promise<SeededGraph> {
  const things: GraphThing[] = []
  const relationships: GraphRelationship[] = []
  const refs: Record<string, GraphThing> = {}
  const rels: Record<string, GraphRelationship> = {}

  // Create organization
  const acme = await createTestThing(store, {
    id: 'org-acme',
    typeId: 11, // HumanOrganization
    typeName: 'HumanOrganization',
    data: { name: 'Acme Corp', plan: 'enterprise' },
  })
  refs.acme = acme
  things.push(acme)

  // Create teams
  const engineering = await createTestThing(store, {
    id: 'team-engineering',
    typeId: 17, // Team
    typeName: 'Team',
    data: { name: 'Engineering', department: 'Technology' },
  })
  refs.engineering = engineering
  things.push(engineering)

  const sales = await createTestThing(store, {
    id: 'team-sales',
    typeId: 17,
    typeName: 'Team',
    data: { name: 'Sales', department: 'Revenue' },
  })
  refs.sales = sales
  things.push(sales)

  // Create members
  const nathan = await createTestThing(store, {
    id: 'user-nathan',
    typeId: 10,
    typeName: 'HumanUser',
    data: { name: 'Nathan', role: 'CEO' },
  })
  refs.nathan = nathan
  things.push(nathan)

  const priya = await createTestThing(store, {
    id: 'user-priya',
    typeId: 10,
    typeName: 'HumanUser',
    data: { name: 'Priya', role: 'CTO' },
  })
  refs.priya = priya
  things.push(priya)

  const ralph = await createTestThing(store, {
    id: 'user-ralph',
    typeId: 10,
    typeName: 'HumanUser',
    data: { name: 'Ralph', role: 'Engineer' },
  })
  refs.ralph = ralph
  things.push(ralph)

  // Org membership relationships
  for (const member of ['nathan', 'priya', 'ralph']) {
    const rel = await createTestRelationship(store, {
      verb: 'memberOf',
      from: `do://tenant/users/user-${member}`,
      to: 'do://tenant/orgs/org-acme',
    })
    rels[`${member}MemberOfAcme`] = rel
    relationships.push(rel)
  }

  // Team membership
  const priyaInEngineering = await createTestRelationship(store, {
    verb: 'memberOf',
    from: 'do://tenant/users/user-priya',
    to: 'do://tenant/teams/team-engineering',
    data: { role: 'lead' },
  })
  rels.priyaInEngineering = priyaInEngineering
  relationships.push(priyaInEngineering)

  const ralphInEngineering = await createTestRelationship(store, {
    verb: 'memberOf',
    from: 'do://tenant/users/user-ralph',
    to: 'do://tenant/teams/team-engineering',
    data: { role: 'member' },
  })
  rels.ralphInEngineering = ralphInEngineering
  relationships.push(ralphInEngineering)

  // Team belongs to org
  const engineeringInAcme = await createTestRelationship(store, {
    verb: 'belongsTo',
    from: 'do://tenant/teams/team-engineering',
    to: 'do://tenant/orgs/org-acme',
  })
  rels.engineeringInAcme = engineeringInAcme
  relationships.push(engineeringInAcme)

  const salesInAcme = await createTestRelationship(store, {
    verb: 'belongsTo',
    from: 'do://tenant/teams/team-sales',
    to: 'do://tenant/orgs/org-acme',
  })
  rels.salesInAcme = salesInAcme
  relationships.push(salesInAcme)

  return { things, relationships, refs, rels }
}

/**
 * Seed a workflow graph with workflows, instances, and steps.
 */
async function seedWorkflowGraph(store: GraphStore): Promise<SeededGraph> {
  const things: GraphThing[] = []
  const relationships: GraphRelationship[] = []
  const refs: Record<string, GraphThing> = {}
  const rels: Record<string, GraphRelationship> = {}

  // Create workflow definition
  const onboardingWorkflow = await createTestThing(store, {
    id: 'workflow-onboarding',
    typeId: 100, // Workflow
    typeName: 'Workflow',
    data: {
      name: 'Customer Onboarding',
      version: '1.0.0',
      steps: ['sendWelcome', 'setupAccount', 'assignRep'],
    },
  })
  refs.onboardingWorkflow = onboardingWorkflow
  things.push(onboardingWorkflow)

  // Create workflow instances
  const instance1 = await createTestThing(store, {
    id: 'instance-001',
    typeId: 400, // WorkflowInstance
    typeName: 'WorkflowInstance',
    data: { status: 'running', currentStep: 'setupAccount', startedAt: Date.now() - 3600000 },
  })
  refs.instance1 = instance1
  things.push(instance1)

  const instance2 = await createTestThing(store, {
    id: 'instance-002',
    typeId: 400,
    typeName: 'WorkflowInstance',
    data: { status: 'completed', currentStep: null, startedAt: Date.now() - 86400000 },
  })
  refs.instance2 = instance2
  things.push(instance2)

  // Instance relationships
  const instance1OfWorkflow = await createTestRelationship(store, {
    verb: 'instanceOf',
    from: 'do://tenant/instances/instance-001',
    to: 'do://tenant/workflows/workflow-onboarding',
  })
  rels.instance1OfWorkflow = instance1OfWorkflow
  relationships.push(instance1OfWorkflow)

  const instance2OfWorkflow = await createTestRelationship(store, {
    verb: 'instanceOf',
    from: 'do://tenant/instances/instance-002',
    to: 'do://tenant/workflows/workflow-onboarding',
  })
  rels.instance2OfWorkflow = instance2OfWorkflow
  relationships.push(instance2OfWorkflow)

  return { things, relationships, refs, rels }
}

/**
 * Seed a file tree graph with directories and files.
 * Uses Blob (typeId 52) from Git types as a stand-in for Files.
 */
async function seedFileTreeGraph(store: GraphStore): Promise<SeededGraph> {
  const things: GraphThing[] = []
  const relationships: GraphRelationship[] = []
  const refs: Record<string, GraphThing> = {}
  const rels: Record<string, GraphRelationship> = {}

  // Using Tree (51) for directories and Blob (52) for files from Git types
  // Create root directory
  const root = await createTestThing(store, {
    id: 'dir-root',
    typeId: 51, // Tree from Git types
    typeName: 'Tree',
    data: { name: '/', path: '/', _type: 'directory' },
  })
  refs.root = root
  things.push(root)

  // Create subdirectories
  const src = await createTestThing(store, {
    id: 'dir-src',
    typeId: 51,
    typeName: 'Tree',
    data: { name: 'src', path: '/src', _type: 'directory' },
  })
  refs.src = src
  things.push(src)

  const tests = await createTestThing(store, {
    id: 'dir-tests',
    typeId: 51,
    typeName: 'Tree',
    data: { name: 'tests', path: '/tests', _type: 'directory' },
  })
  refs.tests = tests
  things.push(tests)

  // Create files
  const indexTs = await createTestThing(store, {
    id: 'file-index',
    typeId: 52, // Blob from Git types
    typeName: 'Blob',
    data: { name: 'index.ts', path: '/src/index.ts', size: 1024, _type: 'file' },
  })
  refs.indexTs = indexTs
  things.push(indexTs)

  const testTs = await createTestThing(store, {
    id: 'file-test',
    typeId: 52,
    typeName: 'Blob',
    data: { name: 'index.test.ts', path: '/tests/index.test.ts', size: 512, _type: 'file' },
  })
  refs.testTs = testTs
  things.push(testTs)

  // Directory structure relationships
  const srcInRoot = await createTestRelationship(store, {
    verb: 'contains',
    from: 'do://tenant/dirs/dir-root',
    to: 'do://tenant/dirs/dir-src',
  })
  rels.srcInRoot = srcInRoot
  relationships.push(srcInRoot)

  const testsInRoot = await createTestRelationship(store, {
    verb: 'contains',
    from: 'do://tenant/dirs/dir-root',
    to: 'do://tenant/dirs/dir-tests',
  })
  rels.testsInRoot = testsInRoot
  relationships.push(testsInRoot)

  const indexInSrc = await createTestRelationship(store, {
    verb: 'contains',
    from: 'do://tenant/dirs/dir-src',
    to: 'do://tenant/files/file-index',
  })
  rels.indexInSrc = indexInSrc
  relationships.push(indexInSrc)

  const testInTests = await createTestRelationship(store, {
    verb: 'contains',
    from: 'do://tenant/dirs/dir-tests',
    to: 'do://tenant/files/file-test',
  })
  rels.testInTests = testInTests
  relationships.push(testInTests)

  return { things, relationships, refs, rels }
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Assert that a Thing with the given ID exists in the store.
 *
 * @param store - GraphStore instance
 * @param id - Thing ID to check
 * @param message - Optional custom error message
 * @throws AssertionError if Thing does not exist
 *
 * @example
 * ```typescript
 * await assertThingExists(store, 'customer-alice')
 * await assertThingExists(store, 'product-widget', 'Widget product should exist')
 * ```
 */
export async function assertThingExists(
  store: GraphStore,
  id: string,
  message?: string
): Promise<void> {
  const thing = await store.getThing(id)
  expect(thing, message ?? `Expected Thing with ID '${id}' to exist`).not.toBeNull()
}

/**
 * Assert that a Thing with the given ID does NOT exist in the store.
 *
 * @param store - GraphStore instance
 * @param id - Thing ID to check
 * @param message - Optional custom error message
 * @throws AssertionError if Thing exists
 *
 * @example
 * ```typescript
 * await assertThingNotExists(store, 'deleted-thing')
 * ```
 */
export async function assertThingNotExists(
  store: GraphStore,
  id: string,
  message?: string
): Promise<void> {
  const thing = await store.getThing(id)
  expect(thing, message ?? `Expected Thing with ID '${id}' to NOT exist`).toBeNull()
}

/**
 * Assert that a Thing has specific data properties.
 *
 * @param store - GraphStore instance
 * @param id - Thing ID to check
 * @param expectedData - Partial data to match (subset matching)
 * @throws AssertionError if Thing doesn't exist or data doesn't match
 *
 * @example
 * ```typescript
 * await assertThingHasData(store, 'customer-alice', { name: 'Alice', tier: 'premium' })
 * ```
 */
export async function assertThingHasData(
  store: GraphStore,
  id: string,
  expectedData: Record<string, unknown>
): Promise<void> {
  const thing = await store.getThing(id)
  expect(thing, `Expected Thing with ID '${id}' to exist`).not.toBeNull()
  expect(thing!.data).toMatchObject(expectedData)
}

/**
 * Assert that a Relationship exists matching the given criteria.
 *
 * At least one of `from`, `to`, `verb`, or `id` must be provided.
 *
 * @param store - GraphStore instance
 * @param options - Criteria to match
 * @throws AssertionError if no matching relationship found
 *
 * @example
 * ```typescript
 * // Check by from and verb
 * await assertRelationshipExists(store, {
 *   from: 'do://tenant/customers/alice',
 *   verb: 'purchased'
 * })
 *
 * // Check by to
 * await assertRelationshipExists(store, {
 *   to: 'do://tenant/products/widget'
 * })
 * ```
 */
export async function assertRelationshipExists(
  store: GraphStore,
  options: AssertRelationshipExistsOptions
): Promise<void> {
  if (!options.from && !options.to && !options.verb && !options.id) {
    throw new Error('assertRelationshipExists requires at least one of: from, to, verb, or id')
  }

  let relationships: GraphRelationship[] = []

  if (options.from) {
    relationships = await store.queryRelationshipsFrom(
      options.from,
      options.verb ? { verb: options.verb } : undefined
    )
  } else if (options.to) {
    relationships = await store.queryRelationshipsTo(
      options.to,
      options.verb ? { verb: options.verb } : undefined
    )
  } else if (options.verb) {
    relationships = await store.queryRelationshipsByVerb(options.verb)
  }

  // Filter by additional criteria
  if (options.id) {
    relationships = relationships.filter((r) => r.id === options.id)
  }
  if (options.from && !relationships.every((r) => r.from === options.from)) {
    relationships = relationships.filter((r) => r.from === options.from)
  }
  if (options.to) {
    relationships = relationships.filter((r) => r.to === options.to)
  }

  expect(
    relationships.length,
    `Expected at least one relationship matching ${JSON.stringify(options)}`
  ).toBeGreaterThan(0)
}

/**
 * Assert that NO Relationship exists matching the given criteria.
 *
 * @param store - GraphStore instance
 * @param options - Criteria that should NOT match
 * @throws AssertionError if a matching relationship is found
 *
 * @example
 * ```typescript
 * await assertRelationshipNotExists(store, {
 *   from: 'do://tenant/customers/alice',
 *   verb: 'purchased',
 *   to: 'do://tenant/products/deleted-product'
 * })
 * ```
 */
export async function assertRelationshipNotExists(
  store: GraphStore,
  options: AssertRelationshipExistsOptions
): Promise<void> {
  if (!options.from && !options.to && !options.verb && !options.id) {
    throw new Error('assertRelationshipNotExists requires at least one of: from, to, verb, or id')
  }

  let relationships: GraphRelationship[] = []

  if (options.from) {
    relationships = await store.queryRelationshipsFrom(
      options.from,
      options.verb ? { verb: options.verb } : undefined
    )
  } else if (options.to) {
    relationships = await store.queryRelationshipsTo(
      options.to,
      options.verb ? { verb: options.verb } : undefined
    )
  } else if (options.verb) {
    relationships = await store.queryRelationshipsByVerb(options.verb)
  }

  // Filter by additional criteria
  if (options.id) {
    relationships = relationships.filter((r) => r.id === options.id)
  }
  if (options.to) {
    relationships = relationships.filter((r) => r.to === options.to)
  }

  expect(
    relationships.length,
    `Expected no relationships matching ${JSON.stringify(options)}, but found ${relationships.length}`
  ).toBe(0)
}

/**
 * Assert the count of Things of a given type.
 *
 * @param store - GraphStore instance
 * @param typeName - Type name to count
 * @param expectedCount - Expected count
 *
 * @example
 * ```typescript
 * await assertThingCount(store, 'Customer', 3)
 * ```
 */
export async function assertThingCount(
  store: GraphStore,
  typeName: string,
  expectedCount: number
): Promise<void> {
  const things = await store.getThingsByType({ typeName })
  expect(things.length, `Expected ${expectedCount} Things of type '${typeName}'`).toBe(expectedCount)
}

/**
 * Assert the count of Relationships with a given verb.
 *
 * @param store - GraphStore instance
 * @param verb - Verb to count
 * @param expectedCount - Expected count
 *
 * @example
 * ```typescript
 * await assertRelationshipCount(store, 'purchased', 3)
 * ```
 */
export async function assertRelationshipCount(
  store: GraphStore,
  verb: string,
  expectedCount: number
): Promise<void> {
  const relationships = await store.queryRelationshipsByVerb(verb)
  expect(
    relationships.length,
    `Expected ${expectedCount} relationships with verb '${verb}'`
  ).toBe(expectedCount)
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Build a DO URL from components.
 *
 * @param tenant - Tenant name
 * @param collection - Collection/type name
 * @param id - Entity ID
 * @returns Formatted DO URL
 *
 * @example
 * ```typescript
 * const url = buildDoUrl('acme', 'customers', 'alice')
 * // => 'do://acme/customers/alice'
 * ```
 */
export function buildDoUrl(tenant: string, collection: string, id: string): string {
  return `do://${tenant}/${collection}/${id}`
}

/**
 * Parse a DO URL into components.
 *
 * @param url - DO URL to parse
 * @returns Parsed components
 *
 * @example
 * ```typescript
 * const { tenant, collection, id } = parseDoUrl('do://acme/customers/alice')
 * // => { tenant: 'acme', collection: 'customers', id: 'alice' }
 * ```
 */
export function parseDoUrl(url: string): { tenant: string; collection: string; id: string } {
  const match = url.match(/^do:\/\/([^/]+)\/([^/]+)\/(.+)$/)
  if (!match) {
    throw new Error(`Invalid DO URL: ${url}`)
  }
  return { tenant: match[1], collection: match[2], id: match[3] }
}

/**
 * Wait for a condition to be true (useful for async graph operations).
 *
 * @param predicate - Async function that returns true when condition is met
 * @param options - Options for timeout and polling interval
 * @returns True if condition was met, false if timed out
 *
 * @example
 * ```typescript
 * const found = await waitFor(
 *   async () => (await store.getThing('async-thing')) !== null,
 *   { timeout: 1000, interval: 100 }
 * )
 * ```
 */
export async function waitFor(
  predicate: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<boolean> {
  const timeout = options.timeout ?? 5000
  const interval = options.interval ?? 100
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  return false
}
