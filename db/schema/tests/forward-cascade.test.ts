import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Forward Cascade Resolution Tests (RED Phase)
 *
 * Forward cascade operators:
 * - `->` (Forward Insert): Generate NEW target entity, link TO it
 * - `~>` (Forward Search): Semantic search first, generate if not found, link TO result
 *
 * Schema example:
 * ```typescript
 * const schema = DB({
 *   Startup: {
 *     idea: 'What is the startup idea?',
 *     businessModel: '->LeanCanvas',        // Generate new LeanCanvas, link TO it
 *     customer: '~>IdealCustomerProfile',   // Search for existing ICP, generate if not found
 *     founders: ['->Founder'],              // Generate array of new Founders
 *   },
 * })
 * ```
 *
 * These tests are TDD RED phase - they should FAIL until the resolver is implemented.
 * The imports reference a non-existent module to ensure tests fail.
 */

// ============================================================================
// Imports from non-existent module (will cause test failures)
// ============================================================================

import type { ParsedReference, GenerationContext, Entity } from '../resolvers/forward'
import { ForwardCascadeResolver, resolveForwardInsert, resolveForwardSearch } from '../resolvers/forward'

// ============================================================================
// Mock Types for Testing
// ============================================================================

interface MockEntity {
  $id: string
  $type: string
  [key: string]: unknown
}

interface MockRelationship {
  id: string
  from: string
  to: string
  verb: string
  data: Record<string, unknown> | null
  createdAt: Date
}

// ============================================================================
// 1. Forward Insert (->) Tests
// ============================================================================

describe('Forward Insert (->)', () => {
  describe('generates new target entity', () => {
    it('generates a new entity when resolving -> reference', async () => {
      const resolver = new ForwardCascadeResolver()

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'LeanCanvas',
        fieldName: 'businessModel',
        prompt: 'Generate a lean canvas for this startup',
        optional: false,
      }

      const context: GenerationContext = {
        entity: {
          $id: 'startup-001',
          $type: 'Startup',
          idea: 'AI-powered code review platform',
        },
        previousGenerations: [],
        db: {} as any, // Mock DB
        ai: {} as any, // Mock AI provider
      }

      const result = await resolver.resolve(ref, context)

      expect(result).toBeDefined()
      expect(result.$type).toBe('LeanCanvas')
      expect(result.$id).toBeDefined()
      expect(typeof result.$id).toBe('string')
    })

    it('uses field prompt to guide generation', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'canvas-001',
        $type: 'LeanCanvas',
        problem: 'Manual code review is slow',
        solution: 'AI-powered automated reviews',
      })

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'LeanCanvas',
        fieldName: 'businessModel',
        prompt: 'Generate a lean canvas for this startup',
        optional: false,
      }

      const context: GenerationContext = {
        entity: {
          $id: 'startup-001',
          $type: 'Startup',
          idea: 'AI code review',
        },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LeanCanvas',
          prompt: 'Generate a lean canvas for this startup',
          context: expect.objectContaining({
            parentEntity: context.entity,
          }),
        })
      )
    })

    it('generates unique $id for each new entity', async () => {
      const resolver = new ForwardCascadeResolver()

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Founder',
        fieldName: 'founders',
        prompt: 'Generate a founder profile',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result1 = await resolver.resolve(ref, context)
      const result2 = await resolver.resolve(ref, context)

      expect(result1.$id).toBeDefined()
      expect(result2.$id).toBeDefined()
      expect(result1.$id).not.toBe(result2.$id)
    })
  })

  describe('creates relationship linking TO target', () => {
    it('creates relationship with correct from/to direction', async () => {
      const createdRelationships: MockRelationship[] = []
      const mockCreateRelationship = vi.fn().mockImplementation((rel) => {
        createdRelationships.push(rel)
        return Promise.resolve(rel)
      })

      const resolver = new ForwardCascadeResolver({
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'LeanCanvas',
        fieldName: 'businessModel',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result = await resolver.resolve(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'startup-001',
          to: result.$id,
          verb: 'businessModel',
        })
      )
    })

    it('uses field name as the relationship verb', async () => {
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'IdealCustomerProfile',
        fieldName: 'targetCustomer',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: 'targetCustomer',
        })
      )
    })
  })

  describe('handles array references (multiple entities)', () => {
    it('generates multiple entities for array reference', async () => {
      const resolver = new ForwardCascadeResolver()

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Founder',
        fieldName: 'founders',
        prompt: 'Generate founder profiles',
        optional: false,
        isArray: true,
        count: 3,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const results = await resolver.resolveArray(ref, context)

      expect(results).toHaveLength(3)
      results.forEach((entity) => {
        expect(entity.$type).toBe('Founder')
        expect(entity.$id).toBeDefined()
      })
    })

    it('creates relationships for each entity in array', async () => {
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Founder',
        fieldName: 'founders',
        prompt: '',
        optional: false,
        isArray: true,
        count: 2,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolveArray(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledTimes(2)
    })

    it('each array entity has unique $id', async () => {
      const resolver = new ForwardCascadeResolver()

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Feature',
        fieldName: 'features',
        prompt: 'Generate feature list',
        optional: false,
        isArray: true,
        count: 5,
      }

      const context: GenerationContext = {
        entity: { $id: 'product-001', $type: 'Product' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const results = await resolver.resolveArray(ref, context)

      const ids = results.map((r) => r.$id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(5)
    })

    it('passes previous array items as context for subsequent generations', async () => {
      const mockGenerate = vi.fn().mockImplementation((opts) => {
        return Promise.resolve({
          $id: `founder-${Date.now()}`,
          $type: 'Founder',
          name: 'Generated Founder',
        })
      })

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Founder',
        fieldName: 'founders',
        prompt: 'Generate complementary founders',
        optional: false,
        isArray: true,
        count: 3,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolveArray(ref, context)

      // Second call should include first generated founder in context
      expect(mockGenerate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          context: expect.objectContaining({
            previousInArray: expect.arrayContaining([
              expect.objectContaining({ $type: 'Founder' }),
            ]),
          }),
        })
      )

      // Third call should include first two founders
      expect(mockGenerate).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          context: expect.objectContaining({
            previousInArray: expect.arrayContaining([
              expect.objectContaining({ $type: 'Founder' }),
              expect.objectContaining({ $type: 'Founder' }),
            ]),
          }),
        })
      )
    })
  })

  describe('sets target.$id automatically', () => {
    it('assigns $id to generated entity', async () => {
      const resolver = new ForwardCascadeResolver()

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Competitor',
        fieldName: 'mainCompetitor',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result = await resolver.resolve(ref, context)

      expect(result.$id).toBeDefined()
      expect(result.$id).toMatch(/^[a-z]+-[a-z0-9]+$/) // Expected format: type-id
    })

    it('$id is stable and persistent after generation', async () => {
      const mockStore = vi.fn()

      const resolver = new ForwardCascadeResolver({
        store: mockStore,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Milestone',
        fieldName: 'nextMilestone',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'project-001', $type: 'Project' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result = await resolver.resolve(ref, context)

      expect(mockStore).toHaveBeenCalledWith(
        expect.objectContaining({
          $id: result.$id,
          $type: 'Milestone',
        })
      )
    })
  })
})

// ============================================================================
// 2. Forward Search (~>) Tests
// ============================================================================

describe('Forward Search (~>)', () => {
  describe('performs semantic search first', () => {
    it('calls semantic search before generation', async () => {
      const mockSemanticSearch = vi.fn().mockResolvedValue([])

      const resolver = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'IdealCustomerProfile',
        fieldName: 'customer',
        prompt: 'Find or generate ideal customer profile',
        optional: false,
      }

      const context: GenerationContext = {
        entity: {
          $id: 'startup-001',
          $type: 'Startup',
          idea: 'Developer tools for AI',
        },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockSemanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'IdealCustomerProfile',
          query: expect.stringContaining('Developer tools'),
        })
      )
    })

    it('uses parent entity context for search query', async () => {
      const mockSemanticSearch = vi.fn().mockResolvedValue([])

      const resolver = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'Industry',
        fieldName: 'industry',
        prompt: 'Find the relevant industry',
        optional: false,
      }

      const context: GenerationContext = {
        entity: {
          $id: 'company-001',
          $type: 'Company',
          name: 'TechCorp',
          description: 'Enterprise SaaS for healthcare',
        },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockSemanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            parentEntity: context.entity,
          }),
        })
      )
    })
  })

  describe('returns existing if similarity > threshold', () => {
    it('returns existing entity when similarity exceeds threshold', async () => {
      const existingProfile = {
        $id: 'icp-existing',
        $type: 'IdealCustomerProfile',
        persona: 'Senior Developer',
        needs: ['Code review', 'Documentation'],
      }

      const mockSemanticSearch = vi.fn().mockResolvedValue([
        { entity: existingProfile, similarity: 0.92 },
      ])

      const resolver = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
        similarityThreshold: 0.85,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'IdealCustomerProfile',
        fieldName: 'customer',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result = await resolver.resolve(ref, context)

      expect(result.$id).toBe('icp-existing')
      expect(result).toEqual(existingProfile)
    })

    it('does not generate new entity when match found', async () => {
      const mockSemanticSearch = vi.fn().mockResolvedValue([
        {
          entity: { $id: 'existing-001', $type: 'Role' },
          similarity: 0.95,
        },
      ])
      const mockGenerate = vi.fn()

      const resolver = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
        generate: mockGenerate,
        similarityThreshold: 0.80,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'Role',
        fieldName: 'role',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'person-001', $type: 'Person' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockGenerate).not.toHaveBeenCalled()
    })

    it('uses configurable similarity threshold', async () => {
      const existingEntity = { $id: 'dept-001', $type: 'Department' }

      const mockSemanticSearch = vi.fn().mockResolvedValue([
        { entity: existingEntity, similarity: 0.75 },
      ])
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'dept-new',
        $type: 'Department',
      })

      // With threshold 0.70, should return existing
      const resolverLowThreshold = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
        generate: mockGenerate,
        similarityThreshold: 0.70,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'Department',
        fieldName: 'department',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'emp-001', $type: 'Employee' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result1 = await resolverLowThreshold.resolve(ref, context)
      expect(result1.$id).toBe('dept-001')

      // With threshold 0.80, should generate new
      const resolverHighThreshold = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
        generate: mockGenerate,
        similarityThreshold: 0.80,
      })

      const result2 = await resolverHighThreshold.resolve(ref, context)
      expect(result2.$id).toBe('dept-new')
    })
  })

  describe('generates new if no match found', () => {
    it('generates new entity when no search results', async () => {
      const mockSemanticSearch = vi.fn().mockResolvedValue([])
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'market-new',
        $type: 'MarketSegment',
        name: 'Enterprise AI',
      })

      const resolver = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
        generate: mockGenerate,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'MarketSegment',
        fieldName: 'targetMarket',
        prompt: 'Find or generate target market segment',
        optional: false,
      }

      const context: GenerationContext = {
        entity: {
          $id: 'startup-001',
          $type: 'Startup',
          idea: 'AI for enterprise workflows',
        },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result = await resolver.resolve(ref, context)

      expect(mockGenerate).toHaveBeenCalled()
      expect(result.$id).toBe('market-new')
      expect(result.$type).toBe('MarketSegment')
    })

    it('generates new entity when all results below threshold', async () => {
      const mockSemanticSearch = vi.fn().mockResolvedValue([
        { entity: { $id: 'low-001', $type: 'Tech' }, similarity: 0.45 },
        { entity: { $id: 'low-002', $type: 'Tech' }, similarity: 0.38 },
      ])
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'tech-new',
        $type: 'Technology',
      })

      const resolver = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
        generate: mockGenerate,
        similarityThreshold: 0.75,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'Technology',
        fieldName: 'techStack',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'project-001', $type: 'Project' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result = await resolver.resolve(ref, context)

      expect(mockGenerate).toHaveBeenCalled()
      expect(result.$id).toBe('tech-new')
    })
  })

  describe('links to found or generated entity', () => {
    it('creates relationship to found entity', async () => {
      const existingEntity = { $id: 'skill-existing', $type: 'Skill' }
      const mockSemanticSearch = vi.fn().mockResolvedValue([
        { entity: existingEntity, similarity: 0.90 },
      ])
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
        createRelationship: mockCreateRelationship,
        similarityThreshold: 0.80,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'Skill',
        fieldName: 'requiredSkill',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'job-001', $type: 'JobPosting' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'job-001',
          to: 'skill-existing',
          verb: 'requiredSkill',
        })
      )
    })

    it('creates relationship to newly generated entity', async () => {
      const mockSemanticSearch = vi.fn().mockResolvedValue([])
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'cert-new',
        $type: 'Certification',
      })
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        semanticSearch: mockSemanticSearch,
        generate: mockGenerate,
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'fuzzy',
        operator: '~>',
        target: 'Certification',
        fieldName: 'certification',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'candidate-001', $type: 'Candidate' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'candidate-001',
          to: 'cert-new',
          verb: 'certification',
        })
      )
    })
  })
})

// ============================================================================
// 3. Resolution Context Tests
// ============================================================================

describe('Resolution Context', () => {
  describe('parent entity provides context', () => {
    it('passes parent entity data to generation', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'plan-001',
        $type: 'MarketingPlan',
      })

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
      })

      const parentEntity = {
        $id: 'startup-001',
        $type: 'Startup',
        name: 'TechStartup',
        industry: 'SaaS',
        targetAudience: 'Developers',
      }

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'MarketingPlan',
        fieldName: 'marketingPlan',
        prompt: 'Generate a marketing plan',
        optional: false,
      }

      const context: GenerationContext = {
        entity: parentEntity,
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            parentEntity: expect.objectContaining({
              name: 'TechStartup',
              industry: 'SaaS',
              targetAudience: 'Developers',
            }),
          }),
        })
      )
    })

    it('includes parent $id and $type in context', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'budget-001',
        $type: 'Budget',
      })

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Budget',
        fieldName: 'annualBudget',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: {
          $id: 'dept-finance',
          $type: 'Department',
        },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            parentEntity: expect.objectContaining({
              $id: 'dept-finance',
              $type: 'Department',
            }),
          }),
        })
      )
    })
  })

  describe('prompt from field definition used', () => {
    it('uses field prompt as primary instruction', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'analysis-001',
        $type: 'CompetitorAnalysis',
      })

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
      })

      const fieldPrompt = 'Analyze the top 5 competitors in this market segment, including their strengths and weaknesses'

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'CompetitorAnalysis',
        fieldName: 'competitorAnalysis',
        prompt: fieldPrompt,
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: fieldPrompt,
        })
      )
    })

    it('combines field prompt with type schema', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'roadmap-001',
        $type: 'ProductRoadmap',
      })

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
        typeSchemas: {
          ProductRoadmap: {
            fields: {
              milestones: { type: 'array', description: 'Key milestones' },
              timeline: { type: 'string', description: 'Overall timeline' },
            },
          },
        },
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'ProductRoadmap',
        fieldName: 'roadmap',
        prompt: 'Create a 12-month product roadmap',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'product-001', $type: 'Product' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Create a 12-month product roadmap',
          schema: expect.objectContaining({
            fields: expect.objectContaining({
              milestones: expect.any(Object),
              timeline: expect.any(Object),
            }),
          }),
        })
      )
    })
  })

  describe('previous generations in context', () => {
    it('includes previously generated entities', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'strategy-001',
        $type: 'GoToMarketStrategy',
      })

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
      })

      const previousGenerations = [
        { $id: 'canvas-001', $type: 'LeanCanvas', problem: 'X', solution: 'Y' },
        { $id: 'icp-001', $type: 'IdealCustomerProfile', persona: 'Developer' },
      ]

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'GoToMarketStrategy',
        fieldName: 'gtmStrategy',
        prompt: 'Generate GTM strategy based on lean canvas and ICP',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations,
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            previousGenerations: expect.arrayContaining([
              expect.objectContaining({ $type: 'LeanCanvas' }),
              expect.objectContaining({ $type: 'IdealCustomerProfile' }),
            ]),
          }),
        })
      )
    })

    it('orders previous generations chronologically', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'final-001',
        $type: 'FinalReport',
      })

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
      })

      const previousGenerations = [
        { $id: 'step-1', $type: 'Step1', _generatedAt: 1000 },
        { $id: 'step-3', $type: 'Step3', _generatedAt: 3000 },
        { $id: 'step-2', $type: 'Step2', _generatedAt: 2000 },
      ]

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'FinalReport',
        fieldName: 'report',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'process-001', $type: 'Process' },
        previousGenerations,
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      // Should be ordered by _generatedAt
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            previousGenerations: [
              expect.objectContaining({ $type: 'Step1' }),
              expect.objectContaining({ $type: 'Step2' }),
              expect.objectContaining({ $type: 'Step3' }),
            ],
          }),
        })
      )
    })

    it('filters previous generations by relevance', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'pricing-001',
        $type: 'PricingStrategy',
      })

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
        contextFilter: (prev, target) => {
          // Only include relevant types for pricing
          const relevantTypes = ['MarketAnalysis', 'CompetitorAnalysis', 'CostStructure']
          return prev.filter((p) => relevantTypes.includes(p.$type as string))
        },
      })

      const previousGenerations = [
        { $id: 'market-001', $type: 'MarketAnalysis' },
        { $id: 'logo-001', $type: 'Logo' }, // Irrelevant
        { $id: 'competitor-001', $type: 'CompetitorAnalysis' },
        { $id: 'color-001', $type: 'ColorPalette' }, // Irrelevant
      ]

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'PricingStrategy',
        fieldName: 'pricing',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'startup-001', $type: 'Startup' },
        previousGenerations,
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            previousGenerations: expect.arrayContaining([
              expect.objectContaining({ $type: 'MarketAnalysis' }),
              expect.objectContaining({ $type: 'CompetitorAnalysis' }),
            ]),
          }),
        })
      )

      // Should not include Logo or ColorPalette
      const callContext = mockGenerate.mock.calls[0][0].context
      expect(callContext.previousGenerations).not.toContainEqual(
        expect.objectContaining({ $type: 'Logo' })
      )
    })
  })
})

// ============================================================================
// 4. Relationship Creation Tests
// ============================================================================

describe('Relationship Creation', () => {
  describe('stores in relationships table', () => {
    it('persists relationship to database', async () => {
      const storedRelationships: MockRelationship[] = []
      const mockDb = {
        insert: vi.fn().mockImplementation((table) => ({
          values: vi.fn().mockImplementation((data) => {
            storedRelationships.push(data)
            return { returning: vi.fn().mockResolvedValue([data]) }
          }),
        })),
      }

      const resolver = new ForwardCascadeResolver({
        db: mockDb as any,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Contract',
        fieldName: 'contract',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'deal-001', $type: 'Deal' },
        previousGenerations: [],
        db: mockDb as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(storedRelationships).toHaveLength(1)
      expect(storedRelationships[0]).toMatchObject({
        from: 'deal-001',
        verb: 'contract',
      })
    })

    it('generates unique relationship id', async () => {
      const storedRelationships: MockRelationship[] = []
      let relIdCounter = 0
      const mockCreateRelationship = vi.fn().mockImplementation((rel) => {
        relIdCounter++
        storedRelationships.push({ ...rel, id: `rel-${relIdCounter}` })
        return Promise.resolve(storedRelationships[storedRelationships.length - 1])
      })

      const resolver = new ForwardCascadeResolver({
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Task',
        fieldName: 'tasks',
        prompt: '',
        optional: false,
        isArray: true,
        count: 3,
      }

      const context: GenerationContext = {
        entity: { $id: 'project-001', $type: 'Project' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolveArray(ref, context)

      const ids = storedRelationships.map((r) => r.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(3)
    })
  })

  describe('correct from/to/verb', () => {
    it('sets from as source entity $id', async () => {
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Invoice',
        fieldName: 'invoice',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'order-abc-123', $type: 'Order' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'order-abc-123',
        })
      )
    })

    it('sets to as generated entity $id', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'receipt-xyz-789',
        $type: 'Receipt',
      })
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Receipt',
        fieldName: 'receipt',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'payment-001', $type: 'Payment' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'receipt-xyz-789',
        })
      )
    })

    it('uses field name as verb', async () => {
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'ShippingLabel',
        fieldName: 'shippingLabel',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'package-001', $type: 'Package' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: 'shippingLabel',
        })
      )
    })

    it('supports custom verb mapping', async () => {
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        createRelationship: mockCreateRelationship,
        verbMapping: {
          shippingAddress: 'ships_to',
          billingAddress: 'bills_to',
        },
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Address',
        fieldName: 'shippingAddress',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'order-001', $type: 'Order' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          verb: 'ships_to',
        })
      )
    })
  })

  describe('handles optional (no relationship if skipped)', () => {
    it('skips relationship creation for optional field when null', async () => {
      const mockGenerate = vi.fn().mockResolvedValue(null) // AI decides to skip
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Warranty',
        fieldName: 'warranty',
        prompt: 'Generate warranty if applicable',
        optional: true,
      }

      const context: GenerationContext = {
        entity: { $id: 'product-001', $type: 'Product' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result = await resolver.resolve(ref, context)

      expect(result).toBeNull()
      expect(mockCreateRelationship).not.toHaveBeenCalled()
    })

    it('creates relationship for optional field when generated', async () => {
      const mockGenerate = vi.fn().mockResolvedValue({
        $id: 'warranty-001',
        $type: 'Warranty',
        duration: '2 years',
      })
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Warranty',
        fieldName: 'warranty',
        prompt: 'Generate warranty if applicable',
        optional: true,
      }

      const context: GenerationContext = {
        entity: { $id: 'product-001', $type: 'Product' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      const result = await resolver.resolve(ref, context)

      expect(result).not.toBeNull()
      expect(mockCreateRelationship).toHaveBeenCalled()
    })

    it('distinguishes required vs optional in error handling', async () => {
      const mockGenerate = vi.fn().mockRejectedValue(new Error('Generation failed'))

      const resolver = new ForwardCascadeResolver({
        generate: mockGenerate,
      })

      const requiredRef: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Compliance',
        fieldName: 'compliance',
        prompt: '',
        optional: false,
      }

      const optionalRef: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'BonusFeature',
        fieldName: 'bonusFeature',
        prompt: '',
        optional: true,
      }

      const context: GenerationContext = {
        entity: { $id: 'product-001', $type: 'Product' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      // Required field should throw
      await expect(resolver.resolve(requiredRef, context)).rejects.toThrow('Generation failed')

      // Optional field should return null
      const optionalResult = await resolver.resolve(optionalRef, context)
      expect(optionalResult).toBeNull()
    })
  })

  describe('relationship data handling', () => {
    it('includes metadata in relationship data field', async () => {
      const mockCreateRelationship = vi.fn()

      const resolver = new ForwardCascadeResolver({
        createRelationship: mockCreateRelationship,
        includeMetadata: true,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Attachment',
        fieldName: 'attachment',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'email-001', $type: 'Email' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cascadeOperator: '->',
            generatedAt: expect.any(Number),
          }),
        })
      )
    })

    it('sets createdAt timestamp', async () => {
      const mockCreateRelationship = vi.fn()
      const beforeTime = Date.now()

      const resolver = new ForwardCascadeResolver({
        createRelationship: mockCreateRelationship,
      })

      const ref: ParsedReference = {
        direction: 'forward',
        mode: 'insert',
        operator: '->',
        target: 'Log',
        fieldName: 'activityLog',
        prompt: '',
        optional: false,
      }

      const context: GenerationContext = {
        entity: { $id: 'action-001', $type: 'Action' },
        previousGenerations: [],
        db: {} as any,
        ai: {} as any,
      }

      await resolver.resolve(ref, context)

      const afterTime = Date.now()

      expect(mockCreateRelationship).toHaveBeenCalledWith(
        expect.objectContaining({
          createdAt: expect.any(Date),
        })
      )

      const createdAt = mockCreateRelationship.mock.calls[0][0].createdAt
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeTime)
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterTime)
    })
  })
})

// ============================================================================
// Helper function exports tests
// ============================================================================

describe('Helper Functions', () => {
  it('exports resolveForwardInsert function', () => {
    expect(resolveForwardInsert).toBeDefined()
    expect(typeof resolveForwardInsert).toBe('function')
  })

  it('exports resolveForwardSearch function', () => {
    expect(resolveForwardSearch).toBeDefined()
    expect(typeof resolveForwardSearch).toBe('function')
  })

  it('resolveForwardInsert is a shorthand for insert mode', async () => {
    const mockResolver = {
      resolve: vi.fn().mockResolvedValue({ $id: 'test-001', $type: 'Test' }),
    }

    const result = await resolveForwardInsert(
      {
        target: 'Test',
        fieldName: 'test',
        prompt: '',
      },
      { entity: { $id: 'parent-001', $type: 'Parent' } } as any,
      mockResolver as any
    )

    expect(result.$id).toBe('test-001')
  })

  it('resolveForwardSearch is a shorthand for fuzzy mode', async () => {
    const mockResolver = {
      resolve: vi.fn().mockResolvedValue({ $id: 'found-001', $type: 'Found' }),
    }

    const result = await resolveForwardSearch(
      {
        target: 'Found',
        fieldName: 'found',
        prompt: '',
      },
      { entity: { $id: 'parent-001', $type: 'Parent' } } as any,
      mockResolver as any
    )

    expect(result.$id).toBe('found-001')
  })
})
