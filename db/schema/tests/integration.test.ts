import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Integration Tests for Cascade Generation Flow
 *
 * These tests verify the end-to-end cascade generation system works correctly.
 * The schema IS the workflow - relationships define generation flow without
 * explicit orchestration code.
 *
 * This is RED phase TDD - tests should FAIL until the schema system is
 * fully implemented in db/schema/index.ts
 *
 * Key concepts tested:
 * - DB() factory creates parseable schema
 * - GenerationEngine orchestrates cascade resolution
 * - Relationships are created in the database
 * - Forward and backward references work bidirectionally
 * - Fuzzy search finds existing entities before generating
 *
 * Four Cascade Operators:
 * | Operator | Direction | Method | Behavior |
 * |----------|-----------|--------|----------|
 * | `->`     | Forward   | Insert | Generate NEW, link TO it |
 * | `~>`     | Forward   | Search | Semantic search, generate if not found |
 * | `<-`     | Backward  | Insert | Generate NEW, link FROM it |
 * | `<~`     | Backward  | Search | Semantic search, link FROM found |
 */

// ============================================================================
// Imports from non-existent module - WILL FAIL until implemented
// ============================================================================

// @ts-expect-error - Module not yet implemented
import {
  DB,
  GenerationEngine,
  type ParsedSchema,
  type Entity,
  type GenerationOptions,
  type CascadeResult,
} from '../index'

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

interface StartupEntity {
  $id: string
  $type: 'Startup'
  name: string
  idea: IdeaEntity
  customer: ICPEntity
  founders: FounderEntity[]
  model: LeanCanvasEntity
}

interface IdeaEntity {
  $id: string
  $type: 'Idea'
  description: string
  problem: string
  solution: string
}

interface ICPEntity {
  $id: string
  $type: 'ICP'
  segment: string
  painPoints: string[]
  demographics: Record<string, unknown>
}

interface FounderEntity {
  $id: string
  $type: 'Founder'
  name: string
  role: string
  expertise: string[]
}

interface LeanCanvasEntity {
  $id: string
  $type: 'LeanCanvas'
  problem: string
  solution: string
  uniqueValueProp: string
  channels: string[]
  revenueStreams: string[]
  costStructure: string[]
}

// ============================================================================
// 1. Simple Cascade Tests
// ============================================================================

describe('Simple Cascade Generation', () => {
  describe('Startup -> LeanCanvas Chain', () => {
    it('DB() creates a valid schema with cascade operators', () => {
      const schema = DB({
        Startup: {
          name: 'string',
          model: '->LeanCanvas',
        },
        LeanCanvas: {
          problem: 'string',
          solution: 'string',
        },
      })

      expect(schema).toBeDefined()
      expect(schema.Startup).toBeDefined()
      expect(schema.LeanCanvas).toBeDefined()
    })

    it('generates child entity when parent is created', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          model: '->LeanCanvas',
        },
        LeanCanvas: {
          problem: 'string',
          solution: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Acme Corp',
      })

      // Child entity should be generated automatically
      expect(startup.model).toBeDefined()
      expect(startup.model.$type).toBe('LeanCanvas')
      expect(startup.model.$id).toBeDefined()
    })

    it('creates relationship between parent and child', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          model: '->LeanCanvas',
        },
        LeanCanvas: {
          problem: 'string',
          solution: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const result = await engine.generate<StartupEntity>('Startup', {
        name: 'Acme Corp',
      })

      // Should have relationship metadata
      const relationships = await engine.getRelationships(result.$id)
      expect(relationships).toContainEqual(
        expect.objectContaining({
          from: result.$id,
          to: result.model.$id,
          verb: 'model',
        })
      )
    })

    it('generates deeply nested cascade chain', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          model: '->LeanCanvas',
        },
        LeanCanvas: {
          problem: '->ProblemStatement',
          solution: 'string',
        },
        ProblemStatement: {
          description: 'string',
          severity: 'number',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Deep Chain Inc',
      })

      // Full chain should be generated
      expect(startup.model).toBeDefined()
      expect((startup.model as any).problem).toBeDefined()
      expect((startup.model as any).problem.$type).toBe('ProblemStatement')
    })
  })

  describe('Array Cascades', () => {
    it('generates array of child entities', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          founders: ['->Founder'],
        },
        Founder: {
          name: 'string',
          role: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Founders Inc',
      })

      expect(Array.isArray(startup.founders)).toBe(true)
      expect(startup.founders.length).toBeGreaterThan(0)
      startup.founders.forEach((founder) => {
        expect(founder.$type).toBe('Founder')
        expect(founder.$id).toBeDefined()
      })
    })

    it('respects array size hints', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          founders: ['->Founder', { minItems: 2, maxItems: 5 }],
        },
        Founder: {
          name: 'string',
          role: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Sized Array Inc',
      })

      expect(startup.founders.length).toBeGreaterThanOrEqual(2)
      expect(startup.founders.length).toBeLessThanOrEqual(5)
    })

    it('creates relationships for each array element', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          founders: ['->Founder'],
        },
        Founder: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Array Rel Inc',
      })

      const relationships = await engine.getRelationships(startup.$id)
      const founderRels = relationships.filter((r) => r.verb === 'founders')

      expect(founderRels.length).toBe(startup.founders.length)
      startup.founders.forEach((founder) => {
        expect(founderRels).toContainEqual(
          expect.objectContaining({
            from: startup.$id,
            to: founder.$id,
          })
        )
      })
    })
  })

  describe('All Entities Generated', () => {
    it('generates all referenced entity types', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          idea: '<-Idea',
          customer: '~>ICP',
          founders: ['->Founder'],
          model: '->LeanCanvas',
        },
        Idea: {
          description: 'string',
        },
        ICP: {
          segment: 'string',
        },
        Founder: {
          name: 'string',
        },
        LeanCanvas: {
          problem: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Full Entity Inc',
      })

      // All cascade fields should be populated
      expect(startup.idea).toBeDefined()
      expect(startup.customer).toBeDefined()
      expect(startup.founders).toBeDefined()
      expect(startup.model).toBeDefined()

      // All should have correct types
      expect(startup.idea.$type).toBe('Idea')
      expect(startup.customer.$type).toBe('ICP')
      expect(startup.founders[0].$type).toBe('Founder')
      expect(startup.model.$type).toBe('LeanCanvas')
    })

    it('tracks all generated entities in result', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          model: '->LeanCanvas',
        },
        LeanCanvas: {
          problem: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const result: CascadeResult<StartupEntity> = await engine.generateWithMetadata('Startup', {
        name: 'Tracking Inc',
      })

      expect(result.entity).toBeDefined()
      expect(result.generated).toBeDefined()
      expect(result.generated.length).toBeGreaterThanOrEqual(2) // At least Startup + LeanCanvas
      expect(result.generated.map((e) => e.$type)).toContain('Startup')
      expect(result.generated.map((e) => e.$type)).toContain('LeanCanvas')
    })
  })
})

// ============================================================================
// 2. Fuzzy Resolution Tests
// ============================================================================

describe('Fuzzy Resolution (~>)', () => {
  describe('Find Existing Entity', () => {
    it('~> finds existing entity by semantic match', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          customer: '~>ICP',
        },
        ICP: {
          segment: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // Pre-create an ICP entity
      const existingICP = await engine.generate<ICPEntity>('ICP', {
        segment: 'Enterprise SaaS Buyers',
      })

      // Now generate startup - should find the existing ICP
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'B2B SaaS Company',
        $context: 'We sell to enterprise software buyers',
      })

      // Should link to existing rather than create new
      expect(startup.customer.$id).toBe(existingICP.$id)
    })

    it('~> uses semantic search to find best match', async () => {
      const schema = DB({
        Product: {
          name: 'string',
          category: '~>Category',
        },
        Category: {
          name: 'string',
          description: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // Create multiple categories
      await engine.generate('Category', { name: 'Electronics', description: 'Electronic devices and gadgets' })
      await engine.generate('Category', { name: 'Clothing', description: 'Apparel and fashion items' })
      const software = await engine.generate('Category', { name: 'Software', description: 'Computer programs and apps' })

      // Product about software should match Software category
      const product = await engine.generate('Product', {
        name: 'Task Manager App',
        $context: 'A productivity application for managing tasks',
      })

      expect(product.category.$id).toBe(software.$id)
    })
  })

  describe('Link Without Regeneration', () => {
    it('does not regenerate existing entity', async () => {
      const schema = DB({
        Startup: {
          customer: '~>ICP',
        },
        ICP: {
          segment: 'string',
          generatedAt: 'date',
        },
      })

      const engine = new GenerationEngine(schema)

      const originalICP = await engine.generate<ICPEntity>('ICP', {
        segment: 'Small Business Owners',
      })
      const originalTimestamp = (originalICP as any).generatedAt

      const startup = await engine.generate<StartupEntity>('Startup', {
        $context: 'Targeting small business owners',
      })

      // Should be same entity, not regenerated
      expect(startup.customer.$id).toBe(originalICP.$id)
      expect((startup.customer as any).generatedAt).toBe(originalTimestamp)
    })

    it('preserves existing entity data when linking', async () => {
      const schema = DB({
        Startup: {
          customer: '~>ICP',
        },
        ICP: {
          segment: 'string',
          customData: 'any',
        },
      })

      const engine = new GenerationEngine(schema)

      await engine.generate('ICP', {
        segment: 'Developers',
        customData: { important: 'preserved value' },
      })

      const startup = await engine.generate<StartupEntity>('Startup', {
        $context: 'A tool for developers',
      })

      expect((startup.customer as any).customData).toEqual({ important: 'preserved value' })
    })
  })

  describe('Fallback to Generation', () => {
    it('generates new entity when no match found', async () => {
      const schema = DB({
        Startup: {
          customer: '~>ICP',
        },
        ICP: {
          segment: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // No pre-existing ICPs - should generate new one
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Novel Market Startup',
        $context: 'Targeting a completely new market segment',
      })

      expect(startup.customer).toBeDefined()
      expect(startup.customer.$type).toBe('ICP')
      expect(startup.customer.$id).toBeDefined()
    })

    it('generates when similarity threshold not met', async () => {
      const schema = DB({
        Startup: {
          customer: '~>ICP',
        },
        ICP: {
          segment: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        fuzzyThreshold: 0.9, // High threshold
      })

      // Create an ICP that won't match well
      await engine.generate('ICP', {
        segment: 'Healthcare Professionals',
      })

      // Very different context - should not match and generate new
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Gaming Platform',
        $context: 'For hardcore video game players',
      })

      // Should have generated a new ICP, not linked to Healthcare
      const allICPs = await engine.query('ICP')
      expect(allICPs.length).toBe(2)
    })

    it('reports whether entity was found or generated', async () => {
      const schema = DB({
        Startup: {
          customer: '~>ICP',
        },
        ICP: {
          segment: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      const result = await engine.generateWithMetadata<StartupEntity>('Startup', {
        name: 'New Company',
      })

      // Should track resolution method
      const customerResolution = result.resolutions.find((r) => r.field === 'customer')
      expect(customerResolution).toBeDefined()
      expect(customerResolution?.method).toBeOneOf(['found', 'generated'])
    })
  })

  describe('Fuzzy with Union Types', () => {
    it('~>Type|Alternative searches multiple types', async () => {
      const schema = DB({
        Employee: {
          role: '~>JobTitle|Occupation|Role',
        },
        JobTitle: { title: 'string' },
        Occupation: { name: 'string' },
        Role: { name: 'string' },
      })

      const engine = new GenerationEngine(schema)

      await engine.generate('Occupation', { name: 'Software Developer' })

      const employee = await engine.generate('Employee', {
        $context: 'A software developer role',
      })

      // Should find the Occupation since it matches
      expect(employee.role.$type).toBeOneOf(['JobTitle', 'Occupation', 'Role'])
    })
  })
})

// ============================================================================
// 3. Backward References Tests
// ============================================================================

describe('Backward References (<-)', () => {
  describe('Create Reverse Links', () => {
    it('<- creates relationship from target TO this', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          idea: '<-Idea', // Idea links TO Startup
        },
        Idea: {
          description: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Backward Ref Inc',
      })

      // Relationship should be FROM idea TO startup
      const relationships = await engine.getRelationships(startup.idea.$id)
      expect(relationships).toContainEqual(
        expect.objectContaining({
          from: startup.idea.$id,
          to: startup.$id,
          verb: 'inspiredStartup', // Derived reverse verb
        })
      )
    })

    it('<- generates entity that points to current entity', async () => {
      const schema = DB({
        Company: {
          name: 'string',
          founder: '<-Person', // Person links TO Company
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const company = await engine.generate('Company', {
        name: 'Acme Corp',
      })

      // The Person should have a reference pointing to Company
      const founder = company.founder
      const founderRelationships = await engine.getRelationshipsFrom(founder.$id)

      expect(founderRelationships).toContainEqual(
        expect.objectContaining({
          to: company.$id,
        })
      )
    })

    it('<- with array creates multiple reverse links', async () => {
      const schema = DB({
        Project: {
          name: 'string',
          contributors: ['<-Person'], // Multiple People link TO Project
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const project = await engine.generate('Project', {
        name: 'Open Source Project',
      })

      // Each contributor should have relationship TO project
      for (const contributor of project.contributors) {
        const rels = await engine.getRelationshipsFrom(contributor.$id)
        expect(rels).toContainEqual(
          expect.objectContaining({
            to: project.$id,
          })
        )
      }
    })
  })

  describe('Query Entities Pointing Here', () => {
    it('can query all entities pointing to a target', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          investors: ['<-Investor'],
        },
        Investor: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Funded Startup',
      })

      // Query entities pointing TO this startup
      const pointingHere = await engine.getEntitiesPointingTo(startup.$id)

      expect(pointingHere.length).toBeGreaterThan(0)
      pointingHere.forEach((entity) => {
        expect(entity.$type).toBe('Investor')
      })
    })

    it('filters pointing entities by verb', async () => {
      const schema = DB({
        Startup: {
          investors: ['<-Investor'],
          advisors: ['<-Advisor'],
        },
        Investor: { name: 'string' },
        Advisor: { name: 'string' },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Multi Link Startup',
      })

      const investors = await engine.getEntitiesPointingTo(startup.$id, { verb: 'invested' })
      const advisors = await engine.getEntitiesPointingTo(startup.$id, { verb: 'advises' })

      expect(investors.every((e) => e.$type === 'Investor')).toBe(true)
      expect(advisors.every((e) => e.$type === 'Advisor')).toBe(true)
    })
  })

  describe('Bidirectional Navigation', () => {
    it('can navigate forward and backward through relationships', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          model: '->LeanCanvas',
          founder: '<-Founder',
        },
        LeanCanvas: {
          problem: 'string',
        },
        Founder: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate<StartupEntity>('Startup', {
        name: 'Bidirectional Inc',
      })

      // Forward navigation: startup -> model
      const model = await engine.navigate(startup, 'model')
      expect(model.$id).toBe(startup.model.$id)

      // Backward navigation: startup <- founder
      const founder = await engine.navigate(startup, 'founder')
      expect(founder.$id).toBe(startup.founder.$id)

      // Reverse navigation: from model back to startup
      const startupFromModel = await engine.navigateBack(model, 'startup')
      expect(startupFromModel.$id).toBe(startup.$id)

      // Reverse navigation: from founder to startup
      const startupFromFounder = await engine.navigateForward(startup.founder, 'startup')
      expect(startupFromFounder.$id).toBe(startup.$id)
    })

    it('supports chained navigation', async () => {
      const schema = DB({
        Company: {
          department: '->Department',
        },
        Department: {
          manager: '->Employee',
        },
        Employee: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const company = await engine.generate('Company', {})

      // Chain navigation: company -> department -> manager
      const manager = await engine.navigateChain(company, ['department', 'manager'])
      expect(manager.$type).toBe('Employee')
    })
  })

  describe('Backward Search (<~)', () => {
    it('<~ finds existing entities pointing here', async () => {
      const schema = DB({
        Team: {
          members: ['<~Person'], // Find existing People pointing to Team
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // Pre-create people
      const alice = await engine.generate('Person', { name: 'Alice' })
      const bob = await engine.generate('Person', { name: 'Bob' })

      // Create relationships manually
      await engine.createRelationship(alice.$id, 'member_of', 'team-1')
      await engine.createRelationship(bob.$id, 'member_of', 'team-1')

      // Now resolve team - should find existing members
      const team = await engine.resolve('Team', 'team-1')

      expect(team.members).toContainEqual(expect.objectContaining({ $id: alice.$id }))
      expect(team.members).toContainEqual(expect.objectContaining({ $id: bob.$id }))
    })

    it('<~ returns empty array when no entities point here', async () => {
      const schema = DB({
        Team: {
          members: ['<~Person'],
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const team = await engine.generate('Team', {})

      // No pre-existing relationships - should be empty
      expect(team.members).toEqual([])
    })
  })
})

// ============================================================================
// 4. Full Schema Example Tests
// ============================================================================

describe('Full Schema Example', () => {
  const fullSchema = () =>
    DB({
      Startup: {
        name: 'string',
        idea: '<-Idea', // Backward: Idea links TO Startup
        customer: '~>ICP', // Fuzzy: Find or create ICP
        founders: ['->Founder'], // Forward array: Generate Founders
        model: '->LeanCanvas', // Forward: Generate LeanCanvas
      },
      Idea: {
        description: 'string',
        problem: 'string',
        solution: 'string',
      },
      ICP: {
        segment: 'string',
        painPoints: ['string'],
        demographics: 'object',
      },
      Founder: {
        name: 'string',
        role: 'string',
        expertise: ['string'],
      },
      LeanCanvas: {
        problem: 'string',
        solution: 'string',
        uniqueValueProp: 'string',
        channels: ['string'],
        revenueStreams: ['string'],
        costStructure: ['string'],
      },
    })

  it('creates schema with all four cascade operators', () => {
    const schema = fullSchema()

    expect(schema.Startup).toBeDefined()
    expect(schema.Idea).toBeDefined()
    expect(schema.ICP).toBeDefined()
    expect(schema.Founder).toBeDefined()
    expect(schema.LeanCanvas).toBeDefined()
  })

  it('generates complete startup with all relationships', async () => {
    const schema = fullSchema()
    const engine = new GenerationEngine(schema)

    const startup = await engine.generate<StartupEntity>('Startup', {
      name: 'Full Example Startup',
    })

    // All cascade fields populated
    expect(startup.$id).toBeDefined()
    expect(startup.$type).toBe('Startup')
    expect(startup.name).toBe('Full Example Startup')

    // Backward reference
    expect(startup.idea).toBeDefined()
    expect(startup.idea.$type).toBe('Idea')
    expect(startup.idea.description).toBeDefined()

    // Fuzzy reference
    expect(startup.customer).toBeDefined()
    expect(startup.customer.$type).toBe('ICP')
    expect(startup.customer.segment).toBeDefined()

    // Forward array
    expect(Array.isArray(startup.founders)).toBe(true)
    expect(startup.founders.length).toBeGreaterThan(0)
    startup.founders.forEach((f) => {
      expect(f.$type).toBe('Founder')
      expect(f.name).toBeDefined()
    })

    // Forward single
    expect(startup.model).toBeDefined()
    expect(startup.model.$type).toBe('LeanCanvas')
    expect(startup.model.problem).toBeDefined()
  })

  it('all relationships are recorded in database', async () => {
    const schema = fullSchema()
    const engine = new GenerationEngine(schema)

    const startup = await engine.generate<StartupEntity>('Startup', {
      name: 'Relationship Tracking',
    })

    const allRelationships = await engine.getAllRelationships()

    // Forward relationships (startup -> model, startup -> founders)
    expect(allRelationships).toContainEqual(
      expect.objectContaining({
        from: startup.$id,
        to: startup.model.$id,
        verb: 'model',
      })
    )

    startup.founders.forEach((founder) => {
      expect(allRelationships).toContainEqual(
        expect.objectContaining({
          from: startup.$id,
          to: founder.$id,
          verb: 'founders',
        })
      )
    })

    // Backward relationship (idea -> startup)
    expect(allRelationships).toContainEqual(
      expect.objectContaining({
        from: startup.idea.$id,
        to: startup.$id,
      })
    )
  })

  it('supports seed data for generation', async () => {
    const schema = fullSchema()
    const engine = new GenerationEngine(schema)

    const startup = await engine.generate<StartupEntity>('Startup', {
      name: 'Seeded Startup',
      $seed: {
        idea: { problem: 'Manual data entry is slow' },
        model: { uniqueValueProp: 'AI-powered automation' },
      },
    })

    expect(startup.idea.problem).toBe('Manual data entry is slow')
    expect(startup.model.uniqueValueProp).toBe('AI-powered automation')
  })

  it('respects field-level generation prompts', async () => {
    const schema = DB({
      Startup: {
        name: 'string',
        pitch: 'A compelling 30-second elevator pitch',
        model: '->LeanCanvas',
      },
      LeanCanvas: {
        problem: 'The #1 problem customers face',
        solution: 'string',
      },
    })

    const engine = new GenerationEngine(schema)
    const startup = await engine.generate<StartupEntity>('Startup', {
      name: 'Prompted Generation',
    })

    // Field prompts should guide generation
    expect(typeof startup.pitch).toBe('string')
    expect(startup.pitch.length).toBeGreaterThan(10)
  })
})

// ============================================================================
// 5. Relationship Integrity Tests
// ============================================================================

describe('Relationship Integrity', () => {
  it('relationships have correct verb derived from field name', async () => {
    const schema = DB({
      Startup: {
        businessModel: '->LeanCanvas',
        targetCustomer: '~>ICP',
        foundingIdea: '<-Idea',
      },
      LeanCanvas: { problem: 'string' },
      ICP: { segment: 'string' },
      Idea: { description: 'string' },
    })

    const engine = new GenerationEngine(schema)
    const startup = await engine.generate<StartupEntity>('Startup', {})

    const relationships = await engine.getRelationships(startup.$id)

    expect(relationships).toContainEqual(expect.objectContaining({ verb: 'businessModel' }))
    expect(relationships).toContainEqual(expect.objectContaining({ verb: 'targetCustomer' }))

    // Backward relationship should have reverse verb
    const ideaRels = await engine.getRelationships(startup.foundingIdea.$id)
    expect(ideaRels).toContainEqual(expect.objectContaining({ verb: 'inspiredStartup' }))
  })

  it('relationships store metadata about resolution method', async () => {
    const schema = DB({
      Startup: {
        generated: '->LeanCanvas',
        found: '~>ICP',
      },
      LeanCanvas: { problem: 'string' },
      ICP: { segment: 'string' },
    })

    const engine = new GenerationEngine(schema)

    // Pre-create ICP so fuzzy finds it
    await engine.generate('ICP', { segment: 'Developers' })

    const startup = await engine.generate<StartupEntity>('Startup', {
      $context: 'For developers',
    })

    const relationships = await engine.getRelationships(startup.$id)

    const generatedRel = relationships.find((r) => r.verb === 'generated')
    const foundRel = relationships.find((r) => r.verb === 'found')

    expect(generatedRel?.data?.resolution).toBe('generated')
    expect(foundRel?.data?.resolution).toBe('found')
  })

  it('maintains referential integrity', async () => {
    const schema = DB({
      Parent: {
        child: '->Child',
      },
      Child: {
        name: 'string',
      },
    })

    const engine = new GenerationEngine(schema)
    const parent = await engine.generate('Parent', {})

    // Child should exist
    const child = await engine.get('Child', parent.child.$id)
    expect(child).toBeDefined()

    // Relationship should be valid
    const rel = await engine.getRelationship(parent.$id, parent.child.$id)
    expect(rel).toBeDefined()
  })
})

// ============================================================================
// 6. Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('throws on undefined type reference', async () => {
    const schema = DB({
      Startup: {
        unknown: '->NonExistentType',
      },
    })

    const engine = new GenerationEngine(schema)

    await expect(engine.generate('Startup', {})).rejects.toThrow(/NonExistentType.*not defined/)
  })

  it('detects circular dependencies', async () => {
    const schema = DB({
      A: {
        b: '->B',
      },
      B: {
        a: '->A', // Circular!
      },
    })

    const engine = new GenerationEngine(schema)

    await expect(engine.generate('A', {})).rejects.toThrow(/circular/i)
  })

  it('handles generation failures gracefully', async () => {
    const schema = DB({
      Startup: {
        model: '->LeanCanvas',
      },
      LeanCanvas: {
        problem: 'string',
      },
    })

    const engine = new GenerationEngine(schema, {
      onGenerationError: vi.fn(),
    })

    // Simulate generation failure
    vi.spyOn(engine, 'generateEntity').mockRejectedValueOnce(new Error('AI unavailable'))

    await expect(engine.generate('Startup', {})).rejects.toThrow('AI unavailable')
    expect(engine.options.onGenerationError).toHaveBeenCalled()
  })

  it('validates seed data matches schema', async () => {
    const schema = DB({
      Startup: {
        name: 'string',
        revenue: 'number',
      },
    })

    const engine = new GenerationEngine(schema)

    await expect(
      engine.generate('Startup', {
        name: 'Valid',
        revenue: 'not a number', // Type mismatch
      })
    ).rejects.toThrow(/type mismatch/i)
  })
})

// ============================================================================
// 7. Context and Prompt Tests
// ============================================================================

describe('Context and Prompts', () => {
  it('parent entity data is available as context for children', async () => {
    const schema = DB({
      Startup: {
        name: 'string',
        industry: 'string',
        model: '->LeanCanvas',
      },
      LeanCanvas: {
        problem: 'string',
        solution: 'string',
      },
    })

    const engine = new GenerationEngine(schema)
    const startup = await engine.generate<StartupEntity>('Startup', {
      name: 'Healthcare AI',
      industry: 'Healthcare Technology',
    })

    // LeanCanvas should be generated with awareness of parent's industry
    // (verified by content relevance)
    expect(startup.model.problem.toLowerCase()).toMatch(/health|patient|medical|care/i)
  })

  it('$context field provides generation guidance', async () => {
    const schema = DB({
      Startup: {
        name: 'string',
        description: 'string',
      },
    })

    const engine = new GenerationEngine(schema)
    const startup = await engine.generate<StartupEntity>('Startup', {
      name: 'GreenTech',
      $context: 'Focus on environmental sustainability and renewable energy',
    })

    expect(startup.description.toLowerCase()).toMatch(/sustain|green|renew|environment|energy/i)
  })

  it('schema-level $context applies to all generations', async () => {
    const schema = DB({
      $context: 'All entities should relate to B2B enterprise software',
      Startup: {
        name: 'string',
        customer: '~>ICP',
      },
      ICP: {
        segment: 'string',
      },
    })

    const engine = new GenerationEngine(schema)
    const startup = await engine.generate<StartupEntity>('Startup', {
      name: 'Enterprise Tool',
    })

    expect(startup.customer.segment.toLowerCase()).toMatch(/enterprise|b2b|business|corporate/i)
  })
})

// ============================================================================
// 8. Query and Resolution Tests
// ============================================================================

describe('Query and Resolution', () => {
  it('can query entities by type', async () => {
    const schema = DB({
      Startup: { name: 'string' },
      Founder: { name: 'string' },
    })

    const engine = new GenerationEngine(schema)

    await engine.generate('Startup', { name: 'Startup 1' })
    await engine.generate('Startup', { name: 'Startup 2' })
    await engine.generate('Founder', { name: 'Founder 1' })

    const startups = await engine.query('Startup')
    const founders = await engine.query('Founder')

    expect(startups.length).toBe(2)
    expect(founders.length).toBe(1)
  })

  it('can get entity by ID', async () => {
    const schema = DB({
      Startup: { name: 'string' },
    })

    const engine = new GenerationEngine(schema)
    const created = await engine.generate<StartupEntity>('Startup', {
      name: 'Specific Startup',
    })

    const retrieved = await engine.get('Startup', created.$id)

    expect(retrieved).toBeDefined()
    expect(retrieved?.$id).toBe(created.$id)
    expect(retrieved?.name).toBe('Specific Startup')
  })

  it('resolves entity with populated relationships', async () => {
    const schema = DB({
      Startup: {
        name: 'string',
        model: '->LeanCanvas',
      },
      LeanCanvas: {
        problem: 'string',
      },
    })

    const engine = new GenerationEngine(schema)
    const startup = await engine.generate<StartupEntity>('Startup', {
      name: 'Resolvable',
    })

    // Resolve should populate relationships
    const resolved = await engine.resolve<StartupEntity>('Startup', startup.$id)

    expect(resolved.model).toBeDefined()
    expect(resolved.model.$id).toBe(startup.model.$id)
    expect(resolved.model.problem).toBeDefined()
  })
})
