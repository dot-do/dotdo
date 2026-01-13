/**
 * ACID Test Fixtures - Phase 1: Core Lifecycle Operations
 *
 * Provides comprehensive test data fixtures for Phase 1 ACID testing.
 * These fixtures cover all Phase 1 operations: fork, branch, checkout,
 * merge, compact, move, clone, promote, and demote.
 *
 * ## Fixture Categories
 *
 * - **thingsWithVersions**: Multiple versions of things for history testing
 * - **thingsMultipleBranches**: Things distributed across branches
 * - **branches**: Pre-configured branch hierarchy
 * - **conflictScenario**: Data for merge conflict testing
 * - **emptyState**: Clean slate for edge case testing
 * - **promotionScenario**: Data for promote/demote testing
 * - **largeDataset**: Stress testing fixtures
 *
 * @example Using Phase 1 fixtures
 * ```ts
 * import { PHASE1_FIXTURES } from 'dotdo/testing/acid/fixtures/phase1'
 *
 * describe('fork operation', () => {
 *   beforeEach(() => {
 *     result = createMockDO(DO, {
 *       sqlData: new Map([
 *         ['things', PHASE1_FIXTURES.thingsWithVersions],
 *         ['branches', PHASE1_FIXTURES.branches.standard],
 *       ]),
 *     })
 *   })
 * })
 * ```
 *
 * @module testing/acid/fixtures/phase1
 */

import type {
  ThingFixture,
  BranchFixture,
  RelationshipFixture,
  ActionFixture,
  EventFixture,
} from '../fixtures'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a timestamp string offset by the given number of days from now.
 */
function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

/**
 * Generate a Date object offset by the given number of hours from now.
 */
function hoursAgo(hours: number): Date {
  const date = new Date()
  date.setHours(date.getHours() - hours)
  return date
}

// ============================================================================
// THINGS WITH VERSION HISTORY
// ============================================================================

/**
 * Things with multiple versions for version history testing.
 * Used for testing: fork(), compact(), checkout(@v), merge()
 *
 * Contains:
 * - customer-001: 5 versions showing evolution
 * - order-001: 3 versions
 * - product-001: 2 versions
 */
export const thingsWithVersions: readonly ThingFixture[] = [
  // Customer with 5 versions - full version history
  {
    id: 'customer-001',
    type: 1,
    branch: null,
    name: 'Customer v1 - Initial',
    data: { email: 'alice@example.com', status: 'prospect' },
    deleted: false,
    rowid: 1,
    visibility: 'user',
  },
  {
    id: 'customer-001',
    type: 1,
    branch: null,
    name: 'Customer v2 - Verified',
    data: { email: 'alice@example.com', status: 'verified', verifiedAt: daysAgo(4) },
    deleted: false,
    rowid: 2,
    visibility: 'user',
  },
  {
    id: 'customer-001',
    type: 1,
    branch: null,
    name: 'Customer v3 - Active',
    data: { email: 'alice@example.com', status: 'active', plan: 'starter' },
    deleted: false,
    rowid: 3,
    visibility: 'user',
  },
  {
    id: 'customer-001',
    type: 1,
    branch: null,
    name: 'Customer v4 - Upgraded',
    data: { email: 'alice@example.com', status: 'active', plan: 'pro', seats: 5 },
    deleted: false,
    rowid: 4,
    visibility: 'user',
  },
  {
    id: 'customer-001',
    type: 1,
    branch: null,
    name: 'Customer v5 - Enterprise',
    data: { email: 'alice@corp.example.com', status: 'active', plan: 'enterprise', seats: 50 },
    deleted: false,
    rowid: 5,
    visibility: 'user',
  },
  // Order with 3 versions
  {
    id: 'order-001',
    type: 2,
    branch: null,
    name: 'Order v1 - Created',
    data: { customerId: 'customer-001', status: 'pending', total: 99.00 },
    deleted: false,
    rowid: 6,
    visibility: 'user',
  },
  {
    id: 'order-001',
    type: 2,
    branch: null,
    name: 'Order v2 - Paid',
    data: { customerId: 'customer-001', status: 'paid', total: 99.00, paidAt: daysAgo(2) },
    deleted: false,
    rowid: 7,
    visibility: 'user',
  },
  {
    id: 'order-001',
    type: 2,
    branch: null,
    name: 'Order v3 - Shipped',
    data: { customerId: 'customer-001', status: 'shipped', total: 99.00, shippedAt: daysAgo(1) },
    deleted: false,
    rowid: 8,
    visibility: 'user',
  },
  // Product with 2 versions
  {
    id: 'product-001',
    type: 3,
    branch: null,
    name: 'Product v1 - Draft',
    data: { sku: 'SKU-001', price: 29.99, stock: 100 },
    deleted: false,
    rowid: 9,
    visibility: 'user',
  },
  {
    id: 'product-001',
    type: 3,
    branch: null,
    name: 'Product v2 - Published',
    data: { sku: 'SKU-001', price: 24.99, stock: 85, published: true },
    deleted: false,
    rowid: 10,
    visibility: 'public',
  },
] as const

// ============================================================================
// THINGS ACROSS MULTIPLE BRANCHES
// ============================================================================

/**
 * Things distributed across different branches.
 * Used for testing: branch(), checkout(), merge(), fork({ branch })
 *
 * Structure:
 * - main: Standard customer and order data
 * - feature-pricing: Modified pricing data
 * - feature-ui: UI-related changes
 * - experiment: Experimental changes (forked from feature-pricing)
 */
export const thingsMultipleBranches = {
  /**
   * Main branch things - the production baseline
   */
  main: [
    {
      id: 'customer-001',
      type: 1,
      branch: null,
      name: 'Customer ABC Corp',
      data: { email: 'contact@abccorp.com', plan: 'pro', status: 'active' },
      deleted: false,
      rowid: 1,
      visibility: 'user',
    },
    {
      id: 'pricing-001',
      type: 4,
      branch: null,
      name: 'Standard Pricing',
      data: { starter: 29, pro: 99, enterprise: 299 },
      deleted: false,
      rowid: 2,
      visibility: 'user',
    },
    {
      id: 'config-001',
      type: 5,
      branch: null,
      name: 'App Config',
      data: { theme: 'light', locale: 'en-US', features: { darkMode: false } },
      deleted: false,
      rowid: 3,
      visibility: 'user',
    },
  ] as const satisfies readonly ThingFixture[],

  /**
   * Feature branch: pricing changes
   */
  featurePricing: [
    {
      id: 'pricing-001',
      type: 4,
      branch: 'feature-pricing',
      name: 'New Pricing Model',
      data: { starter: 19, pro: 79, enterprise: 249, team: 149 },
      deleted: false,
      rowid: 10,
      visibility: 'user',
    },
    {
      id: 'pricing-002',
      type: 4,
      branch: 'feature-pricing',
      name: 'Volume Discounts',
      data: { threshold: 10, discountPercent: 15 },
      deleted: false,
      rowid: 11,
      visibility: 'user',
    },
  ] as const satisfies readonly ThingFixture[],

  /**
   * Feature branch: UI/UX changes
   */
  featureUi: [
    {
      id: 'config-001',
      type: 5,
      branch: 'feature-ui',
      name: 'New App Config',
      data: { theme: 'auto', locale: 'en-US', features: { darkMode: true, newDashboard: true } },
      deleted: false,
      rowid: 20,
      visibility: 'user',
    },
    {
      id: 'layout-001',
      type: 6,
      branch: 'feature-ui',
      name: 'Dashboard Layout',
      data: { columns: 3, widgets: ['stats', 'chart', 'activity'] },
      deleted: false,
      rowid: 21,
      visibility: 'user',
    },
  ] as const satisfies readonly ThingFixture[],

  /**
   * Experiment branch: forked from feature-pricing
   */
  experiment: [
    {
      id: 'pricing-001',
      type: 4,
      branch: 'experiment',
      name: 'Experimental Pricing',
      data: { starter: 9, pro: 49, enterprise: 199, team: 99, custom: true },
      deleted: false,
      rowid: 30,
      visibility: 'user',
    },
  ] as const satisfies readonly ThingFixture[],

  /**
   * Combined array of all branched things
   */
  all: [] as ThingFixture[], // Populated below
} as const

// Populate the 'all' array
;(thingsMultipleBranches as { all: ThingFixture[] }).all = [
  ...thingsMultipleBranches.main,
  ...thingsMultipleBranches.featurePricing,
  ...thingsMultipleBranches.featureUi,
  ...thingsMultipleBranches.experiment,
]

// ============================================================================
// BRANCH CONFIGURATIONS
// ============================================================================

/**
 * Pre-configured branch hierarchies for testing.
 * Matches the thingsMultipleBranches data structure.
 */
export const branches = {
  /**
   * Standard branch setup with main and two feature branches
   */
  standard: [
    { name: 'main', head: 10, forkedFrom: null, createdAt: daysAgo(30) },
    { name: 'feature-pricing', head: 11, forkedFrom: 'main', createdAt: daysAgo(7) },
    { name: 'feature-ui', head: 21, forkedFrom: 'main', createdAt: daysAgo(5) },
  ] as const satisfies readonly BranchFixture[],

  /**
   * Extended branch setup including nested branches
   */
  extended: [
    { name: 'main', head: 10, forkedFrom: null, createdAt: daysAgo(30) },
    { name: 'feature-pricing', head: 11, forkedFrom: 'main', createdAt: daysAgo(7) },
    { name: 'feature-ui', head: 21, forkedFrom: 'main', createdAt: daysAgo(5) },
    { name: 'experiment', head: 30, forkedFrom: 'feature-pricing', createdAt: daysAgo(2) },
  ] as const satisfies readonly BranchFixture[],

  /**
   * Simple main-only branch for basic tests
   */
  mainOnly: [
    { name: 'main', head: 5, forkedFrom: null, createdAt: daysAgo(30) },
  ] as const satisfies readonly BranchFixture[],

  /**
   * Deep nesting for stress testing branch operations
   */
  deepNesting: [
    { name: 'main', head: 100, forkedFrom: null, createdAt: daysAgo(60) },
    { name: 'develop', head: 90, forkedFrom: 'main', createdAt: daysAgo(50) },
    { name: 'feature-a', head: 80, forkedFrom: 'develop', createdAt: daysAgo(40) },
    { name: 'feature-a-1', head: 70, forkedFrom: 'feature-a', createdAt: daysAgo(30) },
    { name: 'feature-a-1-x', head: 60, forkedFrom: 'feature-a-1', createdAt: daysAgo(20) },
  ] as const satisfies readonly BranchFixture[],
} as const

// ============================================================================
// MERGE CONFLICT SCENARIOS
// ============================================================================

/**
 * Data specifically designed to produce merge conflicts.
 * Used for testing: merge() conflict detection and resolution
 */
export const conflictScenario = {
  /**
   * Base version (common ancestor)
   */
  base: {
    id: 'config-conflict',
    type: 5,
    branch: null,
    name: 'Config - Base',
    data: {
      theme: 'light',
      language: 'en',
      notifications: { email: true, push: false },
      limits: { maxUsers: 10, maxProjects: 5 },
    },
    deleted: false,
    rowid: 1,
    visibility: 'user',
  } as const satisfies ThingFixture,

  /**
   * Main branch changes (modify theme and notifications.push)
   */
  main: {
    id: 'config-conflict',
    type: 5,
    branch: null,
    name: 'Config - Main Update',
    data: {
      theme: 'dark', // Changed from 'light'
      language: 'en',
      notifications: { email: true, push: true }, // push changed
      limits: { maxUsers: 10, maxProjects: 5 },
    },
    deleted: false,
    rowid: 2,
    visibility: 'user',
  } as const satisfies ThingFixture,

  /**
   * Feature branch changes (modify theme and language - conflict on theme!)
   */
  feature: {
    id: 'config-conflict',
    type: 5,
    branch: 'feature-intl',
    name: 'Config - Feature Update',
    data: {
      theme: 'auto', // Conflict! Main says 'dark', feature says 'auto'
      language: 'es', // Changed from 'en' - no conflict
      notifications: { email: true, push: false },
      limits: { maxUsers: 10, maxProjects: 5 },
    },
    deleted: false,
    rowid: 10,
    visibility: 'user',
  } as const satisfies ThingFixture,

  /**
   * Branch configuration for conflict scenario
   */
  branches: [
    { name: 'main', head: 2, forkedFrom: null, createdAt: daysAgo(10) },
    { name: 'feature-intl', head: 10, forkedFrom: 'main', createdAt: daysAgo(5) },
  ] as const satisfies readonly BranchFixture[],

  /**
   * Non-conflicting changes on both branches (different fields)
   */
  nonConflicting: {
    main: {
      id: 'settings-001',
      type: 5,
      branch: null,
      name: 'Settings - Main',
      data: { apiUrl: 'https://api-v2.example.com', timeout: 30 },
      deleted: false,
      rowid: 3,
      visibility: 'user',
    } as const satisfies ThingFixture,
    feature: {
      id: 'settings-001',
      type: 5,
      branch: 'feature-intl',
      name: 'Settings - Feature',
      data: { apiUrl: 'https://api.example.com', retries: 3 },
      deleted: false,
      rowid: 11,
      visibility: 'user',
    } as const satisfies ThingFixture,
  },
} as const

// ============================================================================
// EMPTY STATE
// ============================================================================

/**
 * Empty state configurations for edge case testing.
 * Used for testing: error handling when operations require data
 */
export const emptyState = {
  /**
   * Completely empty - no things, basic branch structure
   */
  empty: {
    things: [] as readonly ThingFixture[],
    branches: [
      { name: 'main', head: 0, forkedFrom: null, createdAt: daysAgo(1) },
    ] as const satisfies readonly BranchFixture[],
    actions: [] as readonly ActionFixture[],
    events: [] as readonly EventFixture[],
    relationships: [] as readonly RelationshipFixture[],
  },

  /**
   * Only deleted things (logically empty)
   */
  onlyDeleted: {
    things: [
      {
        id: 'deleted-001',
        type: 1,
        branch: null,
        name: 'Deleted Thing',
        data: { wasDeleted: true },
        deleted: true,
        rowid: 1,
        visibility: 'user',
      },
      {
        id: 'deleted-002',
        type: 1,
        branch: null,
        name: 'Another Deleted Thing',
        data: { wasDeleted: true },
        deleted: true,
        rowid: 2,
        visibility: 'user',
      },
    ] as const satisfies readonly ThingFixture[],
    branches: [
      { name: 'main', head: 2, forkedFrom: null, createdAt: daysAgo(1) },
    ] as const satisfies readonly BranchFixture[],
  },
} as const

// ============================================================================
// PROMOTION/DEMOTION SCENARIOS
// ============================================================================

/**
 * Data for testing promote() and demote() operations.
 * Contains parent DO with child things that can be promoted.
 */
export const promotionScenario = {
  /**
   * Parent DO things - the context where promotion happens
   */
  parentThings: [
    {
      id: 'customer-promotable',
      type: 1,
      branch: null,
      name: 'Customer Ready for Promotion',
      data: {
        email: 'enterprise@big.corp',
        status: 'active',
        plan: 'enterprise',
        employees: 10000,
        readyForPromotion: true,
      },
      deleted: false,
      rowid: 1,
      visibility: 'user',
    },
    {
      id: 'customer-not-ready',
      type: 1,
      branch: null,
      name: 'Small Customer',
      data: { email: 'small@startup.io', status: 'active', plan: 'starter' },
      deleted: false,
      rowid: 2,
      visibility: 'user',
    },
    {
      id: 'order-linked',
      type: 2,
      branch: null,
      name: 'Order Linked to Promotable',
      data: { customerId: 'customer-promotable', total: 50000 },
      deleted: false,
      rowid: 3,
      visibility: 'user',
    },
  ] as const satisfies readonly ThingFixture[],

  /**
   * Actions associated with promotable thing
   */
  parentActions: [
    {
      id: 'action-promote-1',
      verb: 'create',
      actor: 'system',
      target: 'Thing/customer-promotable',
      input: null,
      output: { id: 'customer-promotable' },
      options: null,
      durability: 'try',
      status: 'completed',
      error: null,
      requestId: null,
      sessionId: null,
      workflowId: null,
      startedAt: hoursAgo(48),
      completedAt: hoursAgo(48),
      duration: 15,
      createdAt: hoursAgo(48),
    },
    {
      id: 'action-promote-2',
      verb: 'update',
      actor: 'user-admin',
      target: 'Thing/customer-promotable',
      input: { plan: 'enterprise' },
      output: { plan: 'enterprise' },
      options: null,
      durability: 'try',
      status: 'completed',
      error: null,
      requestId: null,
      sessionId: null,
      workflowId: null,
      startedAt: hoursAgo(24),
      completedAt: hoursAgo(24),
      duration: 20,
      createdAt: hoursAgo(24),
    },
  ] as const satisfies readonly ActionFixture[],

  /**
   * Events associated with promotable thing
   */
  parentEvents: [
    {
      id: 'event-promote-1',
      verb: 'thing.created',
      source: 'https://parent.test.do/Thing/customer-promotable',
      data: { type: 'Customer' },
      actionId: 'action-promote-1',
      sequence: 1,
      streamed: true,
      streamedAt: hoursAgo(48),
      createdAt: hoursAgo(48),
    },
    {
      id: 'event-promote-2',
      verb: 'thing.updated',
      source: 'https://parent.test.do/Thing/customer-promotable',
      data: { field: 'plan', newValue: 'enterprise' },
      actionId: 'action-promote-2',
      sequence: 2,
      streamed: true,
      streamedAt: hoursAgo(24),
      createdAt: hoursAgo(24),
    },
  ] as const satisfies readonly EventFixture[],

  /**
   * Relationships for the promotable thing
   */
  parentRelationships: [
    {
      id: 'rel-promote-1',
      verb: 'hasOrder',
      from: 'customer-promotable',
      to: 'order-linked',
      data: { primary: true },
      createdAt: daysAgo(2),
    },
  ] as const satisfies readonly RelationshipFixture[],

  /**
   * Branch setup for promotion scenario
   */
  branches: [
    { name: 'main', head: 3, forkedFrom: null, createdAt: daysAgo(7) },
  ] as const satisfies readonly BranchFixture[],
} as const

// ============================================================================
// LARGE DATASET FOR STRESS TESTING
// ============================================================================

/**
 * Large dataset for performance and stress testing.
 * Use with caution - generates substantial test data.
 */
export const largeDataset = {
  /**
   * Generate N things with sequential IDs
   */
  generateThings(count: number, prefix: string = 'thing'): ThingFixture[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${String(i).padStart(6, '0')}`,
      type: 1,
      branch: null,
      name: `${prefix} #${i}`,
      data: { index: i, timestamp: Date.now(), random: Math.random() },
      deleted: false,
      rowid: i + 1,
      visibility: 'user' as const,
    }))
  },

  /**
   * Generate versioned things (each thing has N versions)
   */
  generateVersionedThings(
    thingCount: number,
    versionsPerThing: number,
    prefix: string = 'versioned'
  ): ThingFixture[] {
    const things: ThingFixture[] = []
    let rowid = 1

    for (let t = 0; t < thingCount; t++) {
      for (let v = 0; v < versionsPerThing; v++) {
        things.push({
          id: `${prefix}-${String(t).padStart(4, '0')}`,
          type: 1,
          branch: null,
          name: `${prefix} #${t} v${v + 1}`,
          data: { thingIndex: t, version: v + 1, timestamp: Date.now() - (versionsPerThing - v) * 1000 },
          deleted: false,
          rowid: rowid++,
          visibility: 'user',
        })
      }
    }

    return things
  },

  /**
   * Pre-generated sets for common test sizes
   */
  preset: {
    small: null as ThingFixture[] | null, // 100 things
    medium: null as ThingFixture[] | null, // 1000 things
    large: null as ThingFixture[] | null, // 10000 things
  },
}

// Lazily populate presets to avoid startup cost
Object.defineProperty(largeDataset.preset, 'small', {
  get: function () {
    if (!(this as typeof largeDataset.preset)._small) {
      ;(this as typeof largeDataset.preset & { _small: ThingFixture[] })._small = largeDataset.generateThings(100)
    }
    return (this as typeof largeDataset.preset & { _small: ThingFixture[] })._small
  },
  enumerable: true,
})

Object.defineProperty(largeDataset.preset, 'medium', {
  get: function () {
    if (!(this as typeof largeDataset.preset)._medium) {
      ;(this as typeof largeDataset.preset & { _medium: ThingFixture[] })._medium = largeDataset.generateThings(1000)
    }
    return (this as typeof largeDataset.preset & { _medium: ThingFixture[] })._medium
  },
  enumerable: true,
})

Object.defineProperty(largeDataset.preset, 'large', {
  get: function () {
    if (!(this as typeof largeDataset.preset)._large) {
      ;(this as typeof largeDataset.preset & { _large: ThingFixture[] })._large = largeDataset.generateThings(10000)
    }
    return (this as typeof largeDataset.preset & { _large: ThingFixture[] })._large
  },
  enumerable: true,
})

// ============================================================================
// SPECIAL CHARACTERS AND EDGE CASES
// ============================================================================

/**
 * Edge case data for testing special character handling, unicode, etc.
 */
export const edgeCases = {
  /**
   * Thing with unicode and special characters
   */
  unicode: {
    id: 'unicode-thing',
    type: 1,
    branch: null,
    name: 'Unicode Thing',
    data: {
      greeting: 'Hello World!',
      chinese: 'Example in Chinese',
      arabic: 'Example in Arabic',
      emoji: 'Example with emoji',
      special: '<script>alert("xss")</script>',
      newlines: 'line1\nline2\r\nline3',
      tabs: 'col1\tcol2\tcol3',
      quotes: 'He said "hello" and \'goodbye\'',
      backslashes: 'C:\\Users\\test\\path',
      nullChar: 'before\0after',
    },
    deleted: false,
    rowid: 1,
    visibility: 'user',
  } as const satisfies ThingFixture,

  /**
   * Thing with extremely long values
   */
  longValues: {
    id: 'long-value-thing',
    type: 1,
    branch: null,
    name: 'A'.repeat(1000),
    data: {
      longString: 'x'.repeat(10000),
      deepNesting: (() => {
        let obj: Record<string, unknown> = { value: 'deep' }
        for (let i = 0; i < 20; i++) {
          obj = { level: i, child: obj }
        }
        return obj
      })(),
      largeArray: Array.from({ length: 1000 }, (_, i) => i),
    },
    deleted: false,
    rowid: 2,
    visibility: 'user',
  } as const satisfies ThingFixture,

  /**
   * Thing IDs with special but valid characters
   */
  specialIds: [
    {
      id: 'thing-with-dash',
      type: 1,
      branch: null,
      name: 'Dash ID',
      data: {},
      deleted: false,
      rowid: 10,
      visibility: 'user',
    },
    {
      id: 'thing_with_underscore',
      type: 1,
      branch: null,
      name: 'Underscore ID',
      data: {},
      deleted: false,
      rowid: 11,
      visibility: 'user',
    },
    {
      id: 'thing.with.dots',
      type: 1,
      branch: null,
      name: 'Dotted ID',
      data: {},
      deleted: false,
      rowid: 12,
      visibility: 'user',
    },
    {
      id: 'thing:with:colons',
      type: 1,
      branch: null,
      name: 'Colon ID',
      data: {},
      deleted: false,
      rowid: 13,
      visibility: 'user',
    },
  ] as const satisfies readonly ThingFixture[],
} as const

// ============================================================================
// MAIN EXPORTS
// ============================================================================

/**
 * All Phase 1 fixtures consolidated into a single export.
 *
 * @example
 * ```ts
 * import { PHASE1_FIXTURES } from 'dotdo/testing/acid/fixtures/phase1'
 *
 * // Use versioned things
 * result.sqlData.set('things', [...PHASE1_FIXTURES.thingsWithVersions])
 *
 * // Use branch setup
 * result.sqlData.set('branches', PHASE1_FIXTURES.branches.standard)
 *
 * // Use conflict scenario for merge testing
 * const { base, main, feature } = PHASE1_FIXTURES.conflictScenario
 * ```
 */
export const PHASE1_FIXTURES = {
  /**
   * Things with version history (5 versions of customer, 3 of order, 2 of product)
   */
  thingsWithVersions,

  /**
   * Things distributed across multiple branches
   */
  thingsMultipleBranches,

  /**
   * Pre-configured branch hierarchies
   */
  branches,

  /**
   * Data for merge conflict testing
   */
  conflictScenario,

  /**
   * Empty state configurations for edge case testing
   */
  emptyState,

  /**
   * Data for promote/demote testing
   */
  promotionScenario,

  /**
   * Large dataset generators for stress testing
   */
  largeDataset,

  /**
   * Edge case data (unicode, long values, special IDs)
   */
  edgeCases,
} as const

export default PHASE1_FIXTURES
