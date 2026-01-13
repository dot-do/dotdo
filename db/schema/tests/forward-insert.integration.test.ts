/**
 * Forward Insert (->) Integration Tests with Real SQLite
 *
 * TDD RED Phase: Failing tests for the Forward Insert cascade operator.
 *
 * This operator generates NEW target entities and links TO them:
 * - from = this (source entity)
 * - to = target (generated entity)
 *
 * These tests use REAL SQLite (better-sqlite3), NO MOCKS per epic requirements.
 *
 * @see dotdo-j2t7u - [RED] Forward Insert (->) operator tests with real SQLite
 * @see dotdo-7qva7 - Cascade Relationships: -> ~> <~ <- Operators
 *
 * Schema example:
 * ```typescript
 * const schema = DB({
 *   Startup: {
 *     idea: 'What is the startup idea?',
 *     businessModel: '->LeanCanvas',        // Generate new LeanCanvas, link TO it
 *     founders: ['->Founder'],              // Generate array of new Founders
 *   },
 * })
 * ```
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Test Setup: Real SQLite Database
// ============================================================================

/**
 * These imports will succeed - they're existing modules.
 */
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { graphRelationships, RelationshipsStore, type GraphRelationship } from '../../graph/relationships'
import { graphThings, type GraphThing, type NewGraphThing } from '../../graph/things'

/**
 * This import will FAIL - the resolver integration is not yet implemented.
 * The test expects a new export that connects to real SQLite stores.
 */
import {
  ForwardInsertResolver,
  type ForwardInsertOptions,
  type ResolveForwardInsertInput,
  type ResolveForwardInsertResult,
} from '../resolvers/forward-insert'

// ============================================================================
// Test Helper Types
// ============================================================================

interface TestEntity {
  $id: string
  $type: string
  [key: string]: unknown
}

interface TestContext {
  db: BetterSQLite3Database
  sqlite: Database.Database
  relationshipsStore: RelationshipsStore
  resolver: ForwardInsertResolver
}

// ============================================================================
// Test Setup Functions
// ============================================================================

/**
 * Create test database with required schema.
 * Uses real SQLite in-memory database.
 */
function createTestDatabase(): { sqlite: Database.Database; db: BetterSQLite3Database } {
  const sqlite = new Database(':memory:')

  // Create graph_things table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS graph_things (
      id TEXT PRIMARY KEY NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      data TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `)

  // Create relationships table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY NOT NULL,
      verb TEXT NOT NULL,
      "from" TEXT NOT NULL,
      "to" TEXT NOT NULL,
      data TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(verb, "from", "to")
    )
  `)

  // Create indexes
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS graph_things_type_id_idx ON graph_things(type_id);
    CREATE INDEX IF NOT EXISTS graph_things_type_name_idx ON graph_things(type_name);
    CREATE INDEX IF NOT EXISTS rel_from_idx ON relationships("from");
    CREATE INDEX IF NOT EXISTS rel_to_idx ON relationships("to");
    CREATE INDEX IF NOT EXISTS rel_verb_idx ON relationships(verb);
  `)

  const db = drizzle(sqlite)

  return { sqlite, db }
}

/**
 * Seed a source entity for testing.
 */
function seedSourceEntity(sqlite: Database.Database, entity: TestEntity): void {
  const now = Date.now()
  sqlite.prepare(`
    INSERT INTO graph_things (id, type_id, type_name, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entity.$id,
    1, // typeId
    entity.$type,
    JSON.stringify(entity),
    now,
    now
  )
}

/**
 * Query all things from the database.
 */
function queryThings(sqlite: Database.Database): GraphThing[] {
  const rows = sqlite.prepare('SELECT * FROM graph_things').all() as {
    id: string
    type_id: number
    type_name: string
    data: string | null
    created_at: number
    updated_at: number
    deleted_at: number | null
  }[]

  return rows.map((row) => ({
    id: row.id,
    typeId: row.type_id,
    typeName: row.type_name,
    data: row.data ? JSON.parse(row.data) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }))
}

/**
 * Query all relationships from the database.
 */
function queryRelationships(sqlite: Database.Database): GraphRelationship[] {
  const rows = sqlite.prepare('SELECT * FROM relationships').all() as {
    id: string
    verb: string
    from: string
    to: string
    data: string | null
    created_at: number
  }[]

  return rows.map((row) => ({
    id: row.id,
    verb: row.verb,
    from: row.from,
    to: row.to,
    data: row.data ? JSON.parse(row.data) : null,
    createdAt: new Date(row.created_at),
  }))
}

// ============================================================================
// 1. SINGLE ENTITY GENERATION TESTS
// ============================================================================

describe('Forward Insert (->) with Real SQLite', () => {
  let ctx: TestContext

  beforeEach(() => {
    const { sqlite, db } = createTestDatabase()
    const relationshipsStore = new RelationshipsStore(db)

    // Create resolver with real SQLite stores
    // This will FAIL until ForwardInsertResolver is implemented
    const resolver = new ForwardInsertResolver({
      db,
      relationshipsStore,
      thingsTable: graphThings,
      // Generator function stub - will be called for entity generation
      generate: async (opts) => ({
        $id: `${opts.type.toLowerCase()}-${Date.now()}`,
        $type: opts.type,
        generatedFrom: opts.context.parentEntity.$type,
      }),
    })

    ctx = { db, sqlite, relationshipsStore, resolver }
  })

  afterEach(() => {
    ctx.sqlite.close()
  })

  describe('Single Entity Generation', () => {
    it('generates a new entity and persists to graph_things table', async () => {
      // Seed source entity
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-001',
        $type: 'Startup',
        idea: 'AI-powered code review platform',
      })

      // Resolve forward insert
      const result = await ctx.resolver.resolve({
        sourceId: 'startup-001',
        fieldName: 'businessModel',
        targetType: 'LeanCanvas',
        prompt: 'Generate a lean canvas for this startup',
      })

      // Verify entity was returned
      expect(result).toBeDefined()
      expect(result.entity.$type).toBe('LeanCanvas')
      expect(result.entity.$id).toBeDefined()
      expect(typeof result.entity.$id).toBe('string')

      // Verify entity was persisted to SQLite
      const things = queryThings(ctx.sqlite)
      const generatedThing = things.find((t) => t.typeName === 'LeanCanvas')

      expect(generatedThing).toBeDefined()
      expect(generatedThing!.id).toBe(result.entity.$id)
    })

    it('creates relationship with correct from/to direction in relationships table', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-002',
        $type: 'Startup',
        idea: 'Developer productivity tools',
      })

      const result = await ctx.resolver.resolve({
        sourceId: 'startup-002',
        fieldName: 'businessModel',
        targetType: 'LeanCanvas',
        prompt: 'Generate a lean canvas',
      })

      // Verify relationship was persisted
      const relationships = queryRelationships(ctx.sqlite)

      expect(relationships).toHaveLength(1)
      expect(relationships[0]).toMatchObject({
        from: 'startup-002',
        to: result.entity.$id,
        verb: 'businessModel',
      })
    })

    it('generates unique $id for each new entity', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-003',
        $type: 'Startup',
        idea: 'AI assistants',
      })

      // Generate two entities
      const result1 = await ctx.resolver.resolve({
        sourceId: 'startup-003',
        fieldName: 'founder1',
        targetType: 'Founder',
        prompt: 'Generate first founder',
      })

      const result2 = await ctx.resolver.resolve({
        sourceId: 'startup-003',
        fieldName: 'founder2',
        targetType: 'Founder',
        prompt: 'Generate second founder',
      })

      // Verify unique IDs
      expect(result1.entity.$id).not.toBe(result2.entity.$id)

      // Verify both persisted
      const things = queryThings(ctx.sqlite)
      const founders = things.filter((t) => t.typeName === 'Founder')

      expect(founders).toHaveLength(2)
    })

    it('passes parent entity context to generation function', async () => {
      const parentData = {
        $id: 'startup-004',
        $type: 'Startup',
        idea: 'AI code review',
        industry: 'Developer Tools',
        targetAudience: 'Software teams',
      }
      seedSourceEntity(ctx.sqlite, parentData)

      let capturedContext: unknown

      // Create resolver with context-capturing generator
      const resolver = new ForwardInsertResolver({
        db: ctx.db,
        relationshipsStore: ctx.relationshipsStore,
        thingsTable: graphThings,
        generate: async (opts) => {
          capturedContext = opts.context
          return {
            $id: `generated-${Date.now()}`,
            $type: opts.type,
          }
        },
      })

      await resolver.resolve({
        sourceId: 'startup-004',
        fieldName: 'marketingPlan',
        targetType: 'MarketingPlan',
        prompt: 'Generate marketing plan',
      })

      // Verify context was passed
      expect(capturedContext).toBeDefined()
      expect((capturedContext as any).parentEntity.$id).toBe('startup-004')
      expect((capturedContext as any).parentEntity.industry).toBe('Developer Tools')
    })

    it('uses field prompt to guide AI generation', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-005',
        $type: 'Startup',
        idea: 'Enterprise SaaS',
      })

      let capturedPrompt: string | undefined

      const resolver = new ForwardInsertResolver({
        db: ctx.db,
        relationshipsStore: ctx.relationshipsStore,
        thingsTable: graphThings,
        generate: async (opts) => {
          capturedPrompt = opts.prompt
          return {
            $id: `generated-${Date.now()}`,
            $type: opts.type,
          }
        },
      })

      const customPrompt = 'Generate a comprehensive lean canvas with focus on B2B market'

      await resolver.resolve({
        sourceId: 'startup-005',
        fieldName: 'businessModel',
        targetType: 'LeanCanvas',
        prompt: customPrompt,
      })

      expect(capturedPrompt).toBe(customPrompt)
    })
  })

  // ============================================================================
  // 2. ARRAY GENERATION TESTS
  // ============================================================================

  describe('Array Reference Generation (["->Type"])', () => {
    it('generates multiple entities for array reference', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-array-001',
        $type: 'Startup',
        idea: 'Team collaboration',
      })

      const results = await ctx.resolver.resolveArray({
        sourceId: 'startup-array-001',
        fieldName: 'founders',
        targetType: 'Founder',
        prompt: 'Generate founder profiles',
        count: 3,
      })

      // Verify correct count returned
      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result.entity.$type).toBe('Founder')
        expect(result.entity.$id).toBeDefined()
      })

      // Verify all persisted to SQLite
      const things = queryThings(ctx.sqlite)
      const founders = things.filter((t) => t.typeName === 'Founder')

      expect(founders).toHaveLength(3)
    })

    it('creates separate relationship for each entity in array', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-array-002',
        $type: 'Startup',
        idea: 'Multi-founder startup',
      })

      await ctx.resolver.resolveArray({
        sourceId: 'startup-array-002',
        fieldName: 'founders',
        targetType: 'Founder',
        prompt: 'Generate founders',
        count: 2,
      })

      // Verify relationships created
      const relationships = queryRelationships(ctx.sqlite)
      const founderRels = relationships.filter((r) => r.verb === 'founders')

      expect(founderRels).toHaveLength(2)
      founderRels.forEach((rel) => {
        expect(rel.from).toBe('startup-array-002')
        expect(rel.verb).toBe('founders')
      })
    })

    it('each array entity has unique $id', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-array-003',
        $type: 'Startup',
        idea: 'Feature-rich product',
      })

      const results = await ctx.resolver.resolveArray({
        sourceId: 'startup-array-003',
        fieldName: 'features',
        targetType: 'Feature',
        prompt: 'Generate features',
        count: 5,
      })

      // Verify all IDs are unique
      const ids = results.map((r) => r.entity.$id)
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(5)
    })

    it('passes previous array items as context for subsequent generations', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-array-004',
        $type: 'Startup',
        idea: 'Complementary founders',
      })

      const capturedContexts: unknown[] = []

      const resolver = new ForwardInsertResolver({
        db: ctx.db,
        relationshipsStore: ctx.relationshipsStore,
        thingsTable: graphThings,
        generate: async (opts) => {
          capturedContexts.push({ ...opts.context })
          return {
            $id: `founder-${Date.now()}-${capturedContexts.length}`,
            $type: opts.type,
            name: `Founder ${capturedContexts.length}`,
          }
        },
      })

      await resolver.resolveArray({
        sourceId: 'startup-array-004',
        fieldName: 'founders',
        targetType: 'Founder',
        prompt: 'Generate complementary founders',
        count: 3,
      })

      // First call should have no previous items
      expect((capturedContexts[0] as any).previousInArray).toEqual([])

      // Second call should have first founder
      expect((capturedContexts[1] as any).previousInArray).toHaveLength(1)
      expect((capturedContexts[1] as any).previousInArray[0].$type).toBe('Founder')

      // Third call should have first two founders
      expect((capturedContexts[2] as any).previousInArray).toHaveLength(2)
    })
  })

  // ============================================================================
  // 3. ENTITY PERSISTENCE VERIFICATION
  // ============================================================================

  describe('Entity Persistence Verification', () => {
    it('persisted entity contains all generated fields', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-persist-001',
        $type: 'Startup',
        idea: 'B2B SaaS',
      })

      const resolver = new ForwardInsertResolver({
        db: ctx.db,
        relationshipsStore: ctx.relationshipsStore,
        thingsTable: graphThings,
        generate: async (opts) => ({
          $id: `leancanvas-${Date.now()}`,
          $type: opts.type,
          problem: 'Manual code review is slow',
          solution: 'AI-powered automated reviews',
          keyMetrics: ['Time saved', 'Bugs caught'],
          uniqueValue: 'Real-time feedback during PR',
        }),
      })

      const result = await resolver.resolve({
        sourceId: 'startup-persist-001',
        fieldName: 'businessModel',
        targetType: 'LeanCanvas',
        prompt: 'Generate lean canvas',
      })

      // Query persisted entity
      const things = queryThings(ctx.sqlite)
      const canvas = things.find((t) => t.id === result.entity.$id)

      expect(canvas).toBeDefined()
      expect(canvas!.data).toMatchObject({
        problem: 'Manual code review is slow',
        solution: 'AI-powered automated reviews',
        keyMetrics: ['Time saved', 'Bugs caught'],
        uniqueValue: 'Real-time feedback during PR',
      })
    })

    it('relationship data field contains cascade metadata', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-meta-001',
        $type: 'Startup',
        idea: 'Metadata test',
      })

      // Enable metadata in resolver options
      const resolver = new ForwardInsertResolver({
        db: ctx.db,
        relationshipsStore: ctx.relationshipsStore,
        thingsTable: graphThings,
        includeMetadata: true,
        generate: async (opts) => ({
          $id: `generated-${Date.now()}`,
          $type: opts.type,
        }),
      })

      await resolver.resolve({
        sourceId: 'startup-meta-001',
        fieldName: 'plan',
        targetType: 'Plan',
        prompt: 'Generate plan',
      })

      const relationships = queryRelationships(ctx.sqlite)

      expect(relationships[0].data).toMatchObject({
        cascadeOperator: '->',
        generatedAt: expect.any(Number),
      })
    })

    it('entity createdAt timestamp is set correctly', async () => {
      const beforeCreate = Date.now()

      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-time-001',
        $type: 'Startup',
        idea: 'Timestamp test',
      })

      await ctx.resolver.resolve({
        sourceId: 'startup-time-001',
        fieldName: 'model',
        targetType: 'Model',
        prompt: 'Generate model',
      })

      const afterCreate = Date.now()

      const things = queryThings(ctx.sqlite)
      const model = things.find((t) => t.typeName === 'Model')

      expect(model!.createdAt).toBeGreaterThanOrEqual(beforeCreate)
      expect(model!.createdAt).toBeLessThanOrEqual(afterCreate)
    })
  })

  // ============================================================================
  // 4. RELATIONSHIP DIRECTION VERIFICATION
  // ============================================================================

  describe('Relationship Direction (from=source, to=generated)', () => {
    it('forward insert creates from=source, to=target relationship', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'order-001',
        $type: 'Order',
        total: 150.00,
      })

      const result = await ctx.resolver.resolve({
        sourceId: 'order-001',
        fieldName: 'invoice',
        targetType: 'Invoice',
        prompt: 'Generate invoice',
      })

      const relationships = queryRelationships(ctx.sqlite)

      expect(relationships[0].from).toBe('order-001') // Source
      expect(relationships[0].to).toBe(result.entity.$id) // Generated target
    })

    it('verb is derived from field name', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'package-001',
        $type: 'Package',
        weight: 2.5,
      })

      await ctx.resolver.resolve({
        sourceId: 'package-001',
        fieldName: 'shippingLabel',
        targetType: 'ShippingLabel',
        prompt: 'Generate shipping label',
      })

      const relationships = queryRelationships(ctx.sqlite)

      expect(relationships[0].verb).toBe('shippingLabel')
    })

    it('supports custom verb mapping', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'order-002',
        $type: 'Order',
        address: '123 Main St',
      })

      const resolver = new ForwardInsertResolver({
        db: ctx.db,
        relationshipsStore: ctx.relationshipsStore,
        thingsTable: graphThings,
        verbMapping: {
          shippingAddress: 'ships_to',
          billingAddress: 'bills_to',
        },
        generate: async (opts) => ({
          $id: `address-${Date.now()}`,
          $type: opts.type,
        }),
      })

      await resolver.resolve({
        sourceId: 'order-002',
        fieldName: 'shippingAddress',
        targetType: 'Address',
        prompt: 'Generate address',
      })

      const relationships = queryRelationships(ctx.sqlite)

      expect(relationships[0].verb).toBe('ships_to')
    })
  })

  // ============================================================================
  // 5. ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('throws error when source entity does not exist', async () => {
      await expect(
        ctx.resolver.resolve({
          sourceId: 'non-existent-id',
          fieldName: 'field',
          targetType: 'Type',
          prompt: 'Generate',
        })
      ).rejects.toThrow(/source entity not found/i)
    })

    it('throws error for required field when generation fails', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-error-001',
        $type: 'Startup',
        idea: 'Error test',
      })

      const resolver = new ForwardInsertResolver({
        db: ctx.db,
        relationshipsStore: ctx.relationshipsStore,
        thingsTable: graphThings,
        generate: async () => {
          throw new Error('AI generation failed')
        },
      })

      await expect(
        resolver.resolve({
          sourceId: 'startup-error-001',
          fieldName: 'required',
          targetType: 'Required',
          prompt: 'Generate required',
          optional: false,
        })
      ).rejects.toThrow('AI generation failed')
    })

    it('returns null for optional field when generation fails', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-error-002',
        $type: 'Startup',
        idea: 'Optional error test',
      })

      const resolver = new ForwardInsertResolver({
        db: ctx.db,
        relationshipsStore: ctx.relationshipsStore,
        thingsTable: graphThings,
        generate: async () => {
          throw new Error('AI generation failed')
        },
      })

      const result = await resolver.resolve({
        sourceId: 'startup-error-002',
        fieldName: 'optional',
        targetType: 'Optional',
        prompt: 'Generate optional',
        optional: true,
      })

      expect(result).toBeNull()

      // No relationship should be created
      const relationships = queryRelationships(ctx.sqlite)
      expect(relationships).toHaveLength(0)
    })
  })

  // ============================================================================
  // 6. ID GENERATION FORMAT
  // ============================================================================

  describe('ID Generation', () => {
    it('generates $id in format: type-randomid', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'startup-id-001',
        $type: 'Startup',
        idea: 'ID format test',
      })

      const result = await ctx.resolver.resolve({
        sourceId: 'startup-id-001',
        fieldName: 'competitor',
        targetType: 'Competitor',
        prompt: 'Generate competitor',
      })

      // ID should match pattern: lowercase-type-alphanumeric
      expect(result.entity.$id).toMatch(/^competitor-[a-z0-9]+$/)
    })

    it('$id is stable and used for persistence', async () => {
      seedSourceEntity(ctx.sqlite, {
        $id: 'project-001',
        $type: 'Project',
        name: 'Test Project',
      })

      const result = await ctx.resolver.resolve({
        sourceId: 'project-001',
        fieldName: 'milestone',
        targetType: 'Milestone',
        prompt: 'Generate milestone',
      })

      // Query database directly to verify the stored ID matches returned ID
      const things = queryThings(ctx.sqlite)
      const milestone = things.find((t) => t.typeName === 'Milestone')

      expect(milestone!.id).toBe(result.entity.$id)

      // Also verify in relationships
      const relationships = queryRelationships(ctx.sqlite)
      expect(relationships[0].to).toBe(result.entity.$id)
    })
  })
})

// ============================================================================
// 7. FULL INTEGRATION SCENARIO
// ============================================================================

describe('Full Integration: Startup -> LeanCanvas cascade', () => {
  let sqlite: Database.Database
  let db: BetterSQLite3Database

  beforeEach(() => {
    const setup = createTestDatabase()
    sqlite = setup.sqlite
    db = setup.db
  })

  afterEach(() => {
    sqlite.close()
  })

  it('complete flow: create startup, generate canvas, verify persistence', async () => {
    const relationshipsStore = new RelationshipsStore(db)

    // Resolver with realistic generation
    const resolver = new ForwardInsertResolver({
      db,
      relationshipsStore,
      thingsTable: graphThings,
      includeMetadata: true,
      generate: async (opts) => {
        const parent = opts.context.parentEntity
        return {
          $id: `leancanvas-${Date.now()}`,
          $type: 'LeanCanvas',
          problem: `Problem for ${parent.idea}`,
          solution: `Solution using AI`,
          customerSegments: ['Developers', 'Tech Companies'],
          generatedAt: Date.now(),
        }
      },
    })

    // 1. Seed the startup
    const startupId = 'startup-integration-001'
    seedSourceEntity(sqlite, {
      $id: startupId,
      $type: 'Startup',
      idea: 'AI-powered code review',
      industry: 'Developer Tools',
    })

    // 2. Generate lean canvas via forward insert
    const result = await resolver.resolve({
      sourceId: startupId,
      fieldName: 'businessModel',
      targetType: 'LeanCanvas',
      prompt: 'Generate a lean canvas based on the startup idea',
    })

    // 3. Verify all data is in SQLite
    const things = queryThings(sqlite)
    const relationships = queryRelationships(sqlite)

    // Should have 2 things: Startup + LeanCanvas
    expect(things).toHaveLength(2)

    const canvas = things.find((t) => t.typeName === 'LeanCanvas')
    expect(canvas).toBeDefined()
    expect(canvas!.data).toMatchObject({
      problem: expect.stringContaining('AI-powered code review'),
      solution: expect.stringContaining('AI'),
      customerSegments: expect.arrayContaining(['Developers']),
    })

    // Should have 1 relationship
    expect(relationships).toHaveLength(1)
    expect(relationships[0]).toMatchObject({
      from: startupId,
      to: result.entity.$id,
      verb: 'businessModel',
    })
    expect(relationships[0].data).toMatchObject({
      cascadeOperator: '->',
    })
  })
})
