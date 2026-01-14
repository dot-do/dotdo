/**
 * ACID Test Fixtures and Factory Functions
 *
 * Provides reusable test data fixtures and factory functions for ACID testing.
 * All fixtures match the schema defined in db/things.ts:
 * - id: text (local path identifier)
 * - type: integer (FK to nouns.rowid)
 * - branch: text | null (null = main branch)
 * - name: text | null
 * - data: json | null
 * - deleted: boolean (default false)
 * - visibility: 'public' | 'unlisted' | 'org' | 'user' (default 'user')
 *
 * @example Using fixtures in tests
 * ```ts
 * import { FIXTURES, createTestDOWithFixtures } from 'dotdo/testing/acid'
 *
 * describe('version history', () => {
 *   it('should track all versions', async () => {
 *     const { do: instance, storage } = await createTestDOWithFixtures(DO, 'versionedThings')
 *     const history = await instance.getHistory('versioned-1')
 *     expect(history).toHaveLength(3)
 *   })
 * })
 * ```
 *
 * @module testing/acid/fixtures
 */

import type { MockDOResult, MockEnv, MockDurableObjectStorage } from '../../tests/harness/do'
import { createMockDO } from '../../tests/harness/do'

// ============================================================================
// THING TYPE DEFINITIONS (matching db/things.ts schema)
// ============================================================================

/**
 * Thing record type matching the database schema.
 * Schema column order: id, type, branch, name, data, deleted, visibility
 */
export interface ThingFixture {
  /** Local path identifier (e.g., 'user-123', 'config') */
  id: string
  /** Type ID (FK to nouns.rowid) */
  type: number
  /** Branch name (null = main branch) */
  branch: string | null
  /** Display name */
  name: string
  /** JSON data payload */
  data: Record<string, unknown>
  /** Soft delete marker */
  deleted: boolean
  /** Optional rowid for version tests */
  rowid?: number
  /** Visibility level */
  visibility?: 'public' | 'unlisted' | 'org' | 'user'
}

/**
 * Relationship record type for dependency tests
 */
export interface RelationshipFixture {
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: string
}

/**
 * Branch record type for branching tests
 */
export interface BranchFixture {
  name: string
  head: number
  forkedFrom: string | null
  createdAt: string
}

/**
 * Action record type for history tests
 */
export interface ActionFixture {
  id: string
  verb: string
  actor: string
  target: string
  input: unknown
  output: unknown
  options: unknown
  durability: string
  status: string
  error: string | null
  requestId: string | null
  sessionId: string | null
  workflowId: string | null
  startedAt: Date
  completedAt: Date
  duration: number
  createdAt: Date
}

/**
 * Event record type for history tests
 */
export interface EventFixture {
  id: string
  verb: string
  source: string
  data: Record<string, unknown>
  actionId: string | null
  sequence: number
  streamed: boolean
  streamedAt: Date | null
  createdAt: Date
}

// ============================================================================
// STANDARD TEST FIXTURES
// ============================================================================

/**
 * Standard test data fixtures for ACID tests.
 *
 * All fixtures follow the things table schema with appropriate test data
 * for different testing scenarios.
 *
 * ## Available Fixtures
 *
 * - **simpleThing**: Basic thing for simple CRUD tests
 * - **versionedThings**: Multiple versions of same thing for history tests
 * - **branchedThings**: Main and feature branch versions for merge tests
 * - **conflictingThings**: Base, main, and feature versions for conflict resolution tests
 * - **deletedThing**: Soft-deleted thing for deletion tests
 * - **publicThing**: Public visibility thing for access control tests
 * - **relationships**: Sample relationships for graph tests
 * - **branches**: Branch metadata for branching tests
 *
 * @example
 * ```ts
 * import { FIXTURES } from 'dotdo/testing/acid'
 *
 * // Use simple thing fixture
 * result.sqlData.set('things', [FIXTURES.simpleThing])
 *
 * // Use versioned things for history testing
 * result.sqlData.set('things', FIXTURES.versionedThings)
 * ```
 */
export const FIXTURES = {
  // ==========================================================================
  // SIMPLE THING - Basic test data
  // ==========================================================================

  /**
   * Simple thing for basic tests.
   * Use this when you need a single, valid thing record.
   */
  simpleThing: {
    id: 'test-thing-1',
    type: 1,
    branch: null,
    name: 'Test Thing',
    data: { value: 'test' },
    deleted: false,
    visibility: 'user',
  } as const satisfies ThingFixture,

  // ==========================================================================
  // VERSIONED THINGS - History/version tests
  // ==========================================================================

  /**
   * Multiple versions of the same thing for history tests.
   * Each record represents a different version (by rowid).
   *
   * @example Testing version history
   * ```ts
   * const history = await instance.getHistory('versioned-1')
   * expect(history[0].data.v).toBe(1)
   * expect(history[2].data.v).toBe(3)
   * ```
   */
  versionedThings: [
    { id: 'versioned-1', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false, rowid: 1, visibility: 'user' },
    { id: 'versioned-1', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false, rowid: 2, visibility: 'user' },
    { id: 'versioned-1', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false, rowid: 3, visibility: 'user' },
  ] as const satisfies readonly ThingFixture[],

  // ==========================================================================
  // BRANCHED THINGS - Branch merge tests
  // ==========================================================================

  /**
   * Branched data for merge tests.
   * Contains main branch and feature branch versions of the same thing.
   *
   * @example Testing branch operations
   * ```ts
   * const main = await instance.get('branch-test') // main branch
   * const feature = await instance.get('branch-test', 'feature') // feature branch
   * expect(main.data.source).toBe('main')
   * expect(feature.data.source).toBe('feature')
   * ```
   */
  branchedThings: {
    main: { id: 'branch-test', type: 1, branch: null, name: 'main', data: { source: 'main' }, deleted: false, visibility: 'user' },
    feature: { id: 'branch-test', type: 1, branch: 'feature', name: 'feature', data: { source: 'feature' }, deleted: false, visibility: 'user' },
  } as const satisfies { main: ThingFixture; feature: ThingFixture },

  // ==========================================================================
  // CONFLICTING THINGS - Conflict resolution tests
  // ==========================================================================

  /**
   * Conflict scenarios for merge conflict resolution tests.
   * Contains base version, main branch update, and feature branch update.
   *
   * The base version provides the common ancestor for three-way merge.
   * Both main and feature have modified the same field with different values.
   *
   * @example Testing conflict detection
   * ```ts
   * const conflict = detectConflict(
   *   FIXTURES.conflictingThings.base,
   *   FIXTURES.conflictingThings.main,
   *   FIXTURES.conflictingThings.feature
   * )
   * expect(conflict.field).toBe('field')
   * expect(conflict.mainValue).toBe('main-value')
   * expect(conflict.featureValue).toBe('feature-value')
   * ```
   */
  conflictingThings: {
    base: { id: 'conflict-test', type: 1, branch: null, name: 'base', data: { field: 'original' }, deleted: false, rowid: 1, visibility: 'user' },
    main: { id: 'conflict-test', type: 1, branch: null, name: 'main', data: { field: 'main-value' }, deleted: false, rowid: 2, visibility: 'user' },
    feature: { id: 'conflict-test', type: 1, branch: 'feature', name: 'feature', data: { field: 'feature-value' }, deleted: false, rowid: 3, visibility: 'user' },
  } as const satisfies { base: ThingFixture; main: ThingFixture; feature: ThingFixture },

  // ==========================================================================
  // DELETED THING - Soft delete tests
  // ==========================================================================

  /**
   * Soft-deleted thing for deletion/restoration tests.
   */
  deletedThing: {
    id: 'deleted-thing-1',
    type: 1,
    branch: null,
    name: 'Deleted Thing',
    data: { wasDeleted: true },
    deleted: true,
    visibility: 'user',
  } as const satisfies ThingFixture,

  // ==========================================================================
  // VISIBILITY THINGS - Access control tests
  // ==========================================================================

  /**
   * Public visibility thing for access control tests.
   */
  publicThing: {
    id: 'public-thing-1',
    type: 1,
    branch: null,
    name: 'Public Thing',
    data: { access: 'everyone' },
    deleted: false,
    visibility: 'public',
  } as const satisfies ThingFixture,

  /**
   * Org visibility thing for access control tests.
   */
  orgThing: {
    id: 'org-thing-1',
    type: 1,
    branch: null,
    name: 'Org Thing',
    data: { access: 'org-only' },
    deleted: false,
    visibility: 'org',
  } as const satisfies ThingFixture,

  // ==========================================================================
  // RELATIONSHIPS - Graph tests
  // ==========================================================================

  /**
   * Sample relationships for graph/relationship tests.
   */
  relationships: [
    { id: 'rel-1', verb: 'relatedTo', from: 'thing-a', to: 'thing-b', data: { order: 1 }, createdAt: new Date().toISOString() },
    { id: 'rel-2', verb: 'contains', from: 'thing-a', to: 'thing-c', data: { order: 2 }, createdAt: new Date().toISOString() },
    { id: 'rel-3', verb: 'references', from: 'thing-b', to: 'thing-c', data: null, createdAt: new Date().toISOString() },
  ] as const satisfies readonly RelationshipFixture[],

  // ==========================================================================
  // BRANCHES - Branch metadata
  // ==========================================================================

  /**
   * Branch metadata for branching tests.
   */
  branches: [
    { name: 'main', head: 10, forkedFrom: null, createdAt: new Date().toISOString() },
    { name: 'feature', head: 5, forkedFrom: 'main', createdAt: new Date().toISOString() },
    { name: 'experiment', head: 3, forkedFrom: 'main', createdAt: new Date().toISOString() },
  ] as const satisfies readonly BranchFixture[],

  // ==========================================================================
  // COMPLEX DATA - Edge case tests
  // ==========================================================================

  /**
   * Thing with complex nested data for serialization tests.
   */
  complexDataThing: {
    id: 'complex-data-1',
    type: 1,
    branch: null,
    name: 'Complex Data Thing',
    data: {
      string: 'value',
      number: 42,
      boolean: true,
      null: null,
      array: [1, 2, { nested: true }],
      object: {
        level1: {
          level2: {
            level3: 'deep',
          },
        },
      },
      emptyArray: [],
      emptyObject: {},
    },
    deleted: false,
    visibility: 'user',
  } as const satisfies ThingFixture,

  /**
   * Thing with unicode data for internationalization tests.
   */
  unicodeThing: {
    id: 'unicode-1',
    type: 1,
    branch: null,
    name: 'Unicode Thing',
    data: {
      emoji: 'Hello World!',
      chinese: 'Example Text',
      arabic: 'Sample',
      special: '<script>alert("xss")</script>',
      newlines: 'line1\nline2\nline3',
    },
    deleted: false,
    visibility: 'user',
  } as const satisfies ThingFixture,
} as const

/**
 * Type helper to get fixture names
 */
export type FixtureName = keyof typeof FIXTURES

/**
 * Type helper to get the type of a specific fixture
 */
export type FixtureType<K extends FixtureName> = (typeof FIXTURES)[K]

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Options for createTestDOWithFixtures
 */
export interface CreateTestDOOptions {
  /** Namespace URL for the DO */
  ns?: string
  /** Additional storage data */
  storage?: Map<string, unknown> | Record<string, unknown>
  /** Additional SQL data beyond fixtures */
  additionalSqlData?: Map<string, unknown[]>
}

/**
 * Result from createTestDOWithFixtures
 */
export interface TestDOWithFixturesResult<T> {
  /** The DO instance */
  do: T
  /** Mock storage for assertions */
  storage: MockDurableObjectStorage
  /** SQL data tables */
  sqlData: Map<string, unknown[]>
  /** Full mock result for advanced usage */
  mockResult: MockDOResult<T, MockEnv>
}

/**
 * Factory for creating test DOs with pre-loaded fixtures.
 *
 * This function simplifies test setup by automatically loading the specified
 * fixtures into the mock DO's SQL storage. It handles all the boilerplate
 * of creating mock state, storage, and environment.
 *
 * @param DOClass - The Durable Object class to instantiate
 * @param fixture - Name of the fixture to load, or 'none' for empty state
 * @param options - Additional configuration options
 * @returns Object containing the DO instance, storage, and SQL data
 *
 * @example Basic usage
 * ```ts
 * const { do: instance, storage } = await createTestDOWithFixtures(DO, 'simpleThing')
 * const thing = await instance.get('test-thing-1')
 * expect(thing.name).toBe('Test Thing')
 * ```
 *
 * @example With versioned data
 * ```ts
 * const { do: instance } = await createTestDOWithFixtures(DO, 'versionedThings')
 * const history = await instance.getHistory('versioned-1')
 * expect(history).toHaveLength(3)
 * ```
 *
 * @example With custom namespace
 * ```ts
 * const { do: instance } = await createTestDOWithFixtures(DO, 'branchedThings', {
 *   ns: 'https://test.example.do',
 * })
 * ```
 */
export async function createTestDOWithFixtures<
  T extends new (...args: unknown[]) => InstanceType<T>,
>(
  DOClass: T,
  fixture: FixtureName | 'none',
  options: CreateTestDOOptions = {},
): Promise<TestDOWithFixturesResult<InstanceType<T>>> {
  // Build SQL data from fixtures
  const sqlData = new Map<string, unknown[]>()

  // Initialize with empty tables
  sqlData.set('things', [])
  sqlData.set('relationships', [])
  sqlData.set('branches', [{ name: 'main', head: 1, forkedFrom: null, createdAt: new Date().toISOString() }])
  sqlData.set('actions', [])
  sqlData.set('events', [])
  sqlData.set('objects', [])

  // Load fixture data
  if (fixture !== 'none') {
    const fixtureData = FIXTURES[fixture]

    if (fixture === 'simpleThing') {
      sqlData.set('things', [fixtureData])
    } else if (fixture === 'versionedThings') {
      sqlData.set('things', [...(fixtureData as readonly ThingFixture[])])
    } else if (fixture === 'branchedThings') {
      const branched = fixtureData as { main: ThingFixture; feature: ThingFixture }
      sqlData.set('things', [branched.main, branched.feature])
      sqlData.set('branches', [
        { name: 'main', head: 1, forkedFrom: null, createdAt: new Date().toISOString() },
        { name: 'feature', head: 2, forkedFrom: 'main', createdAt: new Date().toISOString() },
      ])
    } else if (fixture === 'conflictingThings') {
      const conflicting = fixtureData as { base: ThingFixture; main: ThingFixture; feature: ThingFixture }
      sqlData.set('things', [conflicting.base, conflicting.main, conflicting.feature])
      sqlData.set('branches', [
        { name: 'main', head: 2, forkedFrom: null, createdAt: new Date().toISOString() },
        { name: 'feature', head: 3, forkedFrom: 'main', createdAt: new Date().toISOString() },
      ])
    } else if (fixture === 'deletedThing') {
      sqlData.set('things', [fixtureData])
    } else if (fixture === 'publicThing') {
      sqlData.set('things', [fixtureData])
    } else if (fixture === 'orgThing') {
      sqlData.set('things', [fixtureData])
    } else if (fixture === 'relationships') {
      sqlData.set('relationships', [...(fixtureData as readonly RelationshipFixture[])])
    } else if (fixture === 'branches') {
      sqlData.set('branches', [...(fixtureData as readonly BranchFixture[])])
    } else if (fixture === 'complexDataThing') {
      sqlData.set('things', [fixtureData])
    } else if (fixture === 'unicodeThing') {
      sqlData.set('things', [fixtureData])
    }
  }

  // Merge additional SQL data
  if (options.additionalSqlData) {
    options.additionalSqlData.forEach((data, table) => {
      const existing = sqlData.get(table) || []
      sqlData.set(table, [...existing, ...data])
    })
  }

  // Create the mock DO
  const mockResult = createMockDO(DOClass, {
    ns: options.ns ?? 'https://test.acid.do',
    storage: options.storage,
    sqlData,
  })

  return {
    do: mockResult.instance,
    storage: mockResult.storage,
    sqlData: mockResult.sqlData,
    mockResult,
  }
}

/**
 * Create a thing fixture with custom overrides.
 *
 * Utility function for creating thing fixtures with sensible defaults
 * while allowing specific field overrides.
 *
 * @param overrides - Fields to override from defaults
 * @returns Complete thing fixture
 *
 * @example Create custom thing
 * ```ts
 * const customThing = createThingFixture({
 *   id: 'custom-1',
 *   name: 'Custom Thing',
 *   data: { custom: true },
 * })
 * ```
 */
export function createThingFixture(overrides: Partial<ThingFixture> = {}): ThingFixture {
  return {
    id: overrides.id ?? `thing-${Date.now()}`,
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? {},
    deleted: overrides.deleted ?? false,
    visibility: overrides.visibility ?? 'user',
    ...overrides,
  }
}

/**
 * Create multiple thing fixtures with sequential IDs.
 *
 * Useful for creating bulk test data with consistent patterns.
 *
 * @param count - Number of things to create
 * @param template - Template for each thing (id will be overridden)
 * @returns Array of thing fixtures
 *
 * @example Create 100 test things
 * ```ts
 * const things = createThingFixtures(100, {
 *   type: 2,
 *   data: { bulk: true },
 * })
 * result.sqlData.set('things', things)
 * ```
 */
export function createThingFixtures(
  count: number,
  template: Partial<ThingFixture> = {},
): ThingFixture[] {
  return Array.from({ length: count }, (_, i) =>
    createThingFixture({
      ...template,
      id: `${template.id ?? 'thing'}-${i}`,
      name: template.name ? `${template.name} ${i}` : `Thing ${i}`,
      data: { ...template.data, index: i },
      rowid: i + 1,
    }),
  )
}

/**
 * Create versioned thing fixtures for history tests.
 *
 * Creates multiple versions of the same thing with incrementing rowids.
 *
 * @param id - The thing ID
 * @param versions - Number of versions to create
 * @param baseData - Base data that will be extended with version number
 * @returns Array of thing fixtures representing versions
 *
 * @example Create 5 versions
 * ```ts
 * const versions = createVersionedThingFixtures('doc-1', 5, { content: 'initial' })
 * // versions[0].data.version === 1
 * // versions[4].data.version === 5
 * ```
 */
export function createVersionedThingFixtures(
  id: string,
  versions: number,
  baseData: Record<string, unknown> = {},
): ThingFixture[] {
  return Array.from({ length: versions }, (_, i) => ({
    id,
    type: 1,
    branch: null,
    name: `${id} v${i + 1}`,
    data: { ...baseData, version: i + 1 },
    deleted: false,
    rowid: i + 1,
    visibility: 'user' as const,
  }))
}

/**
 * Create relationship fixtures between things.
 *
 * @param fromId - Source thing ID
 * @param toIds - Array of target thing IDs
 * @param verb - Relationship type (default: 'relatedTo')
 * @returns Array of relationship fixtures
 *
 * @example Create relationships
 * ```ts
 * const rels = createRelationshipFixtures('parent', ['child-1', 'child-2'], 'contains')
 * result.sqlData.set('relationships', rels)
 * ```
 */
export function createRelationshipFixtures(
  fromId: string,
  toIds: string[],
  verb: string = 'relatedTo',
): RelationshipFixture[] {
  const now = new Date().toISOString()
  return toIds.map((toId, i) => ({
    id: `rel-${fromId}-${toId}`,
    verb,
    from: fromId,
    to: toId,
    data: { order: i },
    createdAt: now,
  }))
}

/**
 * Create action fixtures for history tests.
 *
 * @param count - Number of actions to create
 * @param thingId - Target thing ID
 * @returns Array of action fixtures
 */
export function createActionFixtures(count: number, thingId: string): ActionFixture[] {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `action-${i}`,
    verb: i === 0 ? 'create' : 'update',
    actor: 'system',
    target: thingId,
    input: i === 0 ? null : i,
    output: i + 1,
    options: null,
    durability: 'try',
    status: 'completed',
    error: null,
    requestId: null,
    sessionId: null,
    workflowId: null,
    startedAt: now,
    completedAt: now,
    duration: 10 + i,
    createdAt: now,
  }))
}

/**
 * Create event fixtures for history tests.
 *
 * @param count - Number of events to create
 * @param source - Source namespace URL
 * @returns Array of event fixtures
 */
export function createEventFixtures(count: number, source: string): EventFixture[] {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `event-${i}`,
    verb: i === 0 ? 'thing.created' : 'thing.updated',
    source,
    data: { sequence: i + 1 },
    actionId: `action-${i}`,
    sequence: i + 1,
    streamed: false,
    streamedAt: null,
    createdAt: now,
  }))
}
