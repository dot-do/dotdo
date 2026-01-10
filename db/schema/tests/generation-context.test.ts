/**
 * Generation Context Tests
 *
 * RED TDD: These tests should FAIL because GenerationContext doesn't exist yet.
 *
 * The generation context accumulates state across entity generations:
 * 1. Parent entity available during nested generation
 * 2. Previously generated entities accessible
 * 3. Field prompts/instructions injected into AI context
 * 4. Schema-level directives ($context, $seed, etc.)
 *
 * This file tests:
 * 1. Context accumulation during generation
 * 2. Parent entity access
 * 3. Previous generation availability
 * 4. Prompt injection from field definitions
 * 5. Schema-level instructions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  GenerationContext,
  type ContextOptions,
  type ContextSnapshot,
  type FieldInstruction,
  type SchemaDirective,
  ContextOverflowError,
  MissingContextError,
} from '../engine/index'

import type { ParsedSchema, Entity } from '../types'

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockEntity(type: string, data: Record<string, unknown> = {}): Entity {
  return {
    $id: `${type.toLowerCase()}_${Math.random().toString(36).slice(2, 10)}`,
    $type: type,
    $ns: 'test.ns',
    $created: new Date(),
    $updated: new Date(),
    ...data,
  } as Entity
}

function createMockSchema(): ParsedSchema {
  return {
    types: {
      Startup: {
        name: 'Startup',
        fields: {
          name: { type: 'string', prompt: 'Company name' },
          model: { type: 'reference', operator: '->', target: 'LeanCanvas' },
          founders: { type: 'array', elementType: 'reference', operator: '->', target: 'Founder' },
        },
        directives: {},
      },
      LeanCanvas: {
        name: 'LeanCanvas',
        fields: {
          problem: { type: 'string', prompt: 'What problem does this solve?' },
          solution: { type: 'string', prompt: 'How does it solve the problem?' },
        },
        directives: {},
      },
      Founder: {
        name: 'Founder',
        fields: {
          name: { type: 'string' },
          role: { type: 'string', prompt: 'What role does this founder play?' },
        },
        directives: {},
      },
    },
    directives: {},
  }
}

// ============================================================================
// TESTS: CONTEXT ACCUMULATION
// ============================================================================

describe('GenerationContext', () => {
  let context: InstanceType<typeof GenerationContext>
  let mockSchema: ParsedSchema

  beforeEach(() => {
    mockSchema = createMockSchema()
    context = new GenerationContext({
      schema: mockSchema,
      namespace: 'test.ns',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. PARENT ENTITY IN CONTEXT
  // ==========================================================================

  describe('Parent Entity in Context', () => {
    it('provides access to parent entity during nested generation', () => {
      const startup = createMockEntity('Startup', { name: 'TechCorp' })

      context.pushParent(startup)

      expect(context.getParent()).toBe(startup)
      expect(context.getParent()?.name).toBe('TechCorp')
    })

    it('supports nested parent hierarchy', () => {
      const startup = createMockEntity('Startup', { name: 'TechCorp' })
      const department = createMockEntity('Department', { name: 'Engineering' })
      const team = createMockEntity('Team', { name: 'Platform' })

      context.pushParent(startup)
      context.pushParent(department)
      context.pushParent(team)

      expect(context.getParent()).toBe(team)
      expect(context.getParent(1)).toBe(department)
      expect(context.getParent(2)).toBe(startup)
    })

    it('pops parent correctly', () => {
      const startup = createMockEntity('Startup', { name: 'TechCorp' })
      const department = createMockEntity('Department', { name: 'Engineering' })

      context.pushParent(startup)
      context.pushParent(department)

      const popped = context.popParent()

      expect(popped).toBe(department)
      expect(context.getParent()).toBe(startup)
    })

    it('returns undefined when no parent exists', () => {
      expect(context.getParent()).toBeUndefined()
    })

    it('provides parent chain for context building', () => {
      const startup = createMockEntity('Startup', { name: 'TechCorp' })
      const canvas = createMockEntity('LeanCanvas', { problem: 'Slow deployments' })

      context.pushParent(startup)
      context.pushParent(canvas)

      const chain = context.getParentChain()

      expect(chain).toHaveLength(2)
      expect(chain[0]).toBe(canvas)
      expect(chain[1]).toBe(startup)
    })

    it('includes parent data in generation context string', () => {
      const startup = createMockEntity('Startup', {
        name: 'TechCorp',
        industry: 'Technology',
      })

      context.pushParent(startup)

      const contextString = context.buildContextForGeneration('LeanCanvas')

      expect(contextString).toContain('TechCorp')
      expect(contextString).toContain('Technology')
      expect(contextString).toContain('parent')
    })
  })

  // ==========================================================================
  // 2. PREVIOUS GENERATIONS AVAILABLE
  // ==========================================================================

  describe('Previous Generations Available', () => {
    it('stores generated entities for later access', () => {
      const customer = createMockEntity('Customer', { name: 'Alice' })

      context.addGenerated(customer)

      expect(context.getGenerated('Customer')).toContainEqual(customer)
    })

    it('retrieves specific entity by ID', () => {
      const customer = createMockEntity('Customer', { name: 'Alice' })
      customer.$id = 'cust_alice123'

      context.addGenerated(customer)

      expect(context.getById('cust_alice123')).toBe(customer)
    })

    it('retrieves all entities of a type', () => {
      const customer1 = createMockEntity('Customer', { name: 'Alice' })
      const customer2 = createMockEntity('Customer', { name: 'Bob' })
      const order = createMockEntity('Order', { amount: 100 })

      context.addGenerated(customer1)
      context.addGenerated(customer2)
      context.addGenerated(order)

      const customers = context.getGenerated('Customer')

      expect(customers).toHaveLength(2)
      expect(customers.map((c) => c.name)).toContain('Alice')
      expect(customers.map((c) => c.name)).toContain('Bob')
    })

    it('retrieves all generated entities', () => {
      const customer = createMockEntity('Customer', { name: 'Alice' })
      const order = createMockEntity('Order', { amount: 100 })
      const product = createMockEntity('Product', { name: 'Widget' })

      context.addGenerated(customer)
      context.addGenerated(order)
      context.addGenerated(product)

      const all = context.getAllGenerated()

      expect(all).toHaveLength(3)
    })

    it('includes previous generations in context string', () => {
      const customer = createMockEntity('Customer', { name: 'Alice', tier: 'Premium' })
      const product = createMockEntity('Product', { name: 'Widget', price: 99 })

      context.addGenerated(customer)
      context.addGenerated(product)

      const contextString = context.buildContextForGeneration('Order')

      expect(contextString).toContain('Alice')
      expect(contextString).toContain('Premium')
      expect(contextString).toContain('Widget')
      expect(contextString).toContain('99')
    })

    it('limits context size to prevent overflow', () => {
      // Add many large entities
      for (let i = 0; i < 100; i++) {
        const entity = createMockEntity('LargeEntity', {
          content: 'x'.repeat(10000),
          index: i,
        })
        context.addGenerated(entity)
      }

      const contextString = context.buildContextForGeneration('Final', {
        maxTokens: 8000,
      })

      // Should be truncated but still valid
      expect(contextString.length).toBeLessThan(40000) // ~8000 tokens * 4 chars
    })

    it('prioritizes recent and relevant entities in context', () => {
      // Add old entities
      const oldEntity = createMockEntity('Product', { name: 'OldProduct', index: 1 })
      context.addGenerated(oldEntity)

      // Add many middle entities
      for (let i = 0; i < 50; i++) {
        context.addGenerated(createMockEntity('Filler', { index: i }))
      }

      // Add recent entity
      const recentEntity = createMockEntity('Product', { name: 'RecentProduct', index: 100 })
      context.addGenerated(recentEntity)

      const contextString = context.buildContextForGeneration('Order', {
        maxTokens: 1000,
        relevantTypes: ['Product'],
      })

      expect(contextString).toContain('RecentProduct')
      // Old relevant entity should still be included
      expect(contextString).toContain('OldProduct')
    })
  })

  // ==========================================================================
  // 3. PROMPT INJECTION FROM FIELD DEFINITIONS
  // ==========================================================================

  describe('Prompt Injection from Field Definitions', () => {
    it('extracts prompts from field definitions', () => {
      const instructions = context.getFieldInstructions('LeanCanvas')

      expect(instructions).toContainEqual(
        expect.objectContaining({
          field: 'problem',
          prompt: 'What problem does this solve?',
        })
      )
      expect(instructions).toContainEqual(
        expect.objectContaining({
          field: 'solution',
          prompt: 'How does it solve the problem?',
        })
      )
    })

    it('uses field name as prompt when string value is field type', () => {
      const schema: ParsedSchema = {
        types: {
          Simple: {
            name: 'Simple',
            fields: {
              title: { type: 'string' }, // No explicit prompt
              description: { type: 'string', prompt: 'Detailed description' },
            },
            directives: {},
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const instructions = ctx.getFieldInstructions('Simple')

      expect(instructions).toContainEqual(
        expect.objectContaining({
          field: 'title',
          prompt: 'title', // Uses field name
        })
      )
      expect(instructions).toContainEqual(
        expect.objectContaining({
          field: 'description',
          prompt: 'Detailed description',
        })
      )
    })

    it('includes field prompts in generation context', () => {
      const contextString = context.buildContextForGeneration('LeanCanvas')

      expect(contextString).toContain('What problem does this solve?')
      expect(contextString).toContain('How does it solve the problem?')
    })

    it('formats field prompts as structured instructions', () => {
      const contextString = context.buildContextForGeneration('LeanCanvas')

      // Should have structured format
      expect(contextString).toMatch(/problem.*:.*What problem/i)
      expect(contextString).toMatch(/solution.*:.*How does it solve/i)
    })

    it('handles complex nested prompts', () => {
      const schema: ParsedSchema = {
        types: {
          Analysis: {
            name: 'Analysis',
            fields: {
              market: {
                type: 'object',
                prompt: 'Analyze the target market',
                subfields: {
                  size: { type: 'number', prompt: 'Total addressable market in USD' },
                  growth: { type: 'number', prompt: 'Annual growth rate as percentage' },
                  segments: { type: 'array', prompt: 'List of market segments' },
                },
              },
            },
            directives: {},
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const contextString = ctx.buildContextForGeneration('Analysis')

      expect(contextString).toContain('Analyze the target market')
      expect(contextString).toContain('Total addressable market')
      expect(contextString).toContain('Annual growth rate')
    })

    it('supports conditional prompts based on context', () => {
      const schema: ParsedSchema = {
        types: {
          Response: {
            name: 'Response',
            fields: {
              message: {
                type: 'string',
                prompt: 'Reply to the customer',
                conditionalPrompts: {
                  'parent.sentiment === "negative"': 'Apologize and offer resolution',
                  'parent.sentiment === "positive"': 'Thank them and encourage referrals',
                },
              },
            },
            directives: {},
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })

      // Add parent with negative sentiment
      ctx.pushParent(createMockEntity('Ticket', { sentiment: 'negative' }))

      const contextString = ctx.buildContextForGeneration('Response')

      expect(contextString).toContain('Apologize and offer resolution')
      expect(contextString).not.toContain('encourage referrals')
    })
  })

  // ==========================================================================
  // 4. SCHEMA-LEVEL INSTRUCTIONS
  // ==========================================================================

  describe('Schema-Level Instructions', () => {
    it('applies $context directive to all generations', () => {
      const schema: ParsedSchema = {
        types: {
          Email: {
            name: 'Email',
            fields: {
              subject: { type: 'string' },
              body: { type: 'string' },
            },
            directives: {},
          },
        },
        directives: {
          $context: 'All content should be professional and concise.',
        },
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const contextString = ctx.buildContextForGeneration('Email')

      expect(contextString).toContain('professional and concise')
    })

    it('applies type-level $context directive', () => {
      const schema: ParsedSchema = {
        types: {
          TechnicalDoc: {
            name: 'TechnicalDoc',
            fields: {
              content: { type: 'string' },
            },
            directives: {
              $context: 'Use technical terminology appropriate for developers.',
            },
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const contextString = ctx.buildContextForGeneration('TechnicalDoc')

      expect(contextString).toContain('technical terminology')
      expect(contextString).toContain('developers')
    })

    it('merges schema and type-level context', () => {
      const schema: ParsedSchema = {
        types: {
          LegalDoc: {
            name: 'LegalDoc',
            fields: {
              content: { type: 'string' },
            },
            directives: {
              $context: 'Use formal legal language.',
            },
          },
        },
        directives: {
          $context: 'All documents are for a US-based company.',
        },
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const contextString = ctx.buildContextForGeneration('LegalDoc')

      expect(contextString).toContain('US-based company')
      expect(contextString).toContain('formal legal language')
    })

    it('applies $seed directive for initial values', () => {
      const schema: ParsedSchema = {
        types: {
          Config: {
            name: 'Config',
            fields: {
              version: { type: 'string' },
              enabled: { type: 'boolean' },
            },
            directives: {
              $seed: { version: '1.0.0', enabled: true },
            },
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const seedValues = ctx.getSeedValues('Config')

      expect(seedValues).toEqual({ version: '1.0.0', enabled: true })
    })

    it('applies $examples directive for few-shot learning', () => {
      const schema: ParsedSchema = {
        types: {
          ProductName: {
            name: 'ProductName',
            fields: {
              name: { type: 'string' },
            },
            directives: {
              $examples: [
                { name: 'CloudSync Pro' },
                { name: 'DataVault Enterprise' },
                { name: 'SecureFlow 360' },
              ],
            },
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const contextString = ctx.buildContextForGeneration('ProductName')

      expect(contextString).toContain('CloudSync Pro')
      expect(contextString).toContain('DataVault Enterprise')
      expect(contextString).toContain('SecureFlow 360')
    })

    it('applies $format directive for output structure', () => {
      const schema: ParsedSchema = {
        types: {
          APIResponse: {
            name: 'APIResponse',
            fields: {
              data: { type: 'object' },
            },
            directives: {
              $format: 'json',
              $jsonSchema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: { type: 'object' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const contextString = ctx.buildContextForGeneration('APIResponse')

      expect(contextString).toContain('JSON')
      expect(contextString).toMatch(/success.*boolean/i)
    })

    it('applies $constraints directive', () => {
      const schema: ParsedSchema = {
        types: {
          Username: {
            name: 'Username',
            fields: {
              value: { type: 'string' },
            },
            directives: {
              $constraints: {
                minLength: 3,
                maxLength: 20,
                pattern: '^[a-z0-9_]+$',
              },
            },
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const contextString = ctx.buildContextForGeneration('Username')

      expect(contextString).toMatch(/3.*20|min.*3|max.*20/i)
      expect(contextString).toContain('lowercase')
    })
  })

  // ==========================================================================
  // 5. CONTEXT SNAPSHOTS
  // ==========================================================================

  describe('Context Snapshots', () => {
    it('creates snapshot of current context state', () => {
      const entity1 = createMockEntity('Customer', { name: 'Alice' })
      const entity2 = createMockEntity('Order', { amount: 100 })

      context.addGenerated(entity1)
      context.pushParent(entity2)

      const snapshot = context.createSnapshot()

      expect(snapshot.generatedCount).toBe(1)
      expect(snapshot.parentDepth).toBe(1)
      expect(snapshot.timestamp).toBeInstanceOf(Date)
    })

    it('restores context from snapshot', () => {
      const entity1 = createMockEntity('Customer', { name: 'Alice' })

      context.addGenerated(entity1)
      const snapshot = context.createSnapshot()

      // Make changes
      context.addGenerated(createMockEntity('Order', { amount: 100 }))
      context.pushParent(createMockEntity('Parent', {}))

      // Restore
      context.restoreSnapshot(snapshot)

      expect(context.getAllGenerated()).toHaveLength(1)
      expect(context.getParent()).toBeUndefined()
    })

    it('allows branching context for parallel generation', () => {
      const root = createMockEntity('Root', { name: 'Main' })
      context.addGenerated(root)

      const branch1 = context.branch()
      const branch2 = context.branch()

      branch1.addGenerated(createMockEntity('Branch1Entity', {}))
      branch2.addGenerated(createMockEntity('Branch2Entity', {}))

      // Branches are independent
      expect(branch1.getAllGenerated()).toHaveLength(2)
      expect(branch2.getAllGenerated()).toHaveLength(2)

      // Original still has just root
      expect(context.getAllGenerated()).toHaveLength(1)
    })

    it('merges branch back into main context', () => {
      const root = createMockEntity('Root', { name: 'Main' })
      context.addGenerated(root)

      const branch = context.branch()
      const branchEntity = createMockEntity('BranchEntity', { value: 42 })
      branch.addGenerated(branchEntity)

      context.merge(branch)

      expect(context.getAllGenerated()).toHaveLength(2)
      expect(context.getById(branchEntity.$id)).toBe(branchEntity)
    })
  })

  // ==========================================================================
  // 6. CONTEXT TOKEN MANAGEMENT
  // ==========================================================================

  describe('Context Token Management', () => {
    it('estimates token count for context', () => {
      const entity = createMockEntity('Document', {
        content: 'This is a test document with some content.',
      })
      context.addGenerated(entity)

      const estimate = context.estimateTokens()

      expect(estimate).toBeGreaterThan(0)
      expect(typeof estimate).toBe('number')
    })

    it('throws ContextOverflowError when limit exceeded', () => {
      const ctx = new GenerationContext({
        schema: mockSchema,
        namespace: 'test',
        maxContextTokens: 100,
      })

      // Add large entity that exceeds limit
      const largeEntity = createMockEntity('Large', {
        content: 'x'.repeat(10000),
      })

      expect(() => ctx.addGenerated(largeEntity)).toThrow(ContextOverflowError)
    })

    it('provides token budget remaining', () => {
      const ctx = new GenerationContext({
        schema: mockSchema,
        namespace: 'test',
        maxContextTokens: 1000,
      })

      const entity = createMockEntity('Small', { name: 'Test' })
      ctx.addGenerated(entity)

      const remaining = ctx.getRemainingTokenBudget()

      expect(remaining).toBeLessThan(1000)
      expect(remaining).toBeGreaterThan(0)
    })

    it('compacts old context when approaching limit', () => {
      const ctx = new GenerationContext({
        schema: mockSchema,
        namespace: 'test',
        maxContextTokens: 500,
        autoCompact: true,
      })

      // Add entities until approaching limit
      for (let i = 0; i < 20; i++) {
        ctx.addGenerated(createMockEntity('Item', { content: `Content ${i}` }))
      }

      // Should have compacted old entries
      const remaining = ctx.getRemainingTokenBudget()
      expect(remaining).toBeGreaterThan(100) // Still have room
    })
  })

  // ==========================================================================
  // 7. CONTEXT SERIALIZATION
  // ==========================================================================

  describe('Context Serialization', () => {
    it('serializes context to JSON', () => {
      const entity = createMockEntity('Product', { name: 'Widget', price: 99 })
      context.addGenerated(entity)
      context.pushParent(createMockEntity('Category', { name: 'Electronics' }))

      const json = context.toJSON()
      const parsed = JSON.parse(json)

      expect(parsed.generated).toHaveLength(1)
      expect(parsed.parents).toHaveLength(1)
      expect(parsed.namespace).toBe('test.ns')
    })

    it('deserializes context from JSON', () => {
      const entity = createMockEntity('Product', { name: 'Widget' })
      context.addGenerated(entity)

      const json = context.toJSON()

      const restored = GenerationContext.fromJSON(json, mockSchema)

      expect(restored.getAllGenerated()).toHaveLength(1)
      expect(restored.getAllGenerated()[0].name).toBe('Widget')
    })

    it('preserves relationships in serialization', () => {
      const product = createMockEntity('Product', { name: 'Widget' })
      const category = createMockEntity('Category', { name: 'Electronics' })

      context.addGenerated(product)
      context.addGenerated(category)
      context.addRelationship(product.$id, category.$id, 'belongsTo')

      const json = context.toJSON()
      const restored = GenerationContext.fromJSON(json, mockSchema)

      const relationships = restored.getRelationships(product.$id)
      expect(relationships).toContainEqual(
        expect.objectContaining({
          to: category.$id,
          verb: 'belongsTo',
        })
      )
    })
  })

  // ==========================================================================
  // 8. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('throws MissingContextError when required context missing', () => {
      const schema: ParsedSchema = {
        types: {
          Reply: {
            name: 'Reply',
            fields: {
              content: {
                type: 'string',
                requiresContext: ['parent.message'],
              },
            },
            directives: {},
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })

      expect(() => ctx.buildContextForGeneration('Reply')).toThrow(MissingContextError)
    })

    it('includes missing context keys in error', () => {
      const schema: ParsedSchema = {
        types: {
          Summary: {
            name: 'Summary',
            fields: {
              text: {
                type: 'string',
                requiresContext: ['document.content', 'document.title'],
              },
            },
            directives: {},
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })

      try {
        ctx.buildContextForGeneration('Summary')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(MissingContextError)
        const contextError = error as MissingContextError
        expect(contextError.missingKeys).toContain('document.content')
        expect(contextError.missingKeys).toContain('document.title')
      }
    })

    it('validates context requirements before generation', () => {
      const schema: ParsedSchema = {
        types: {
          Dependent: {
            name: 'Dependent',
            fields: {
              value: { type: 'string' },
            },
            directives: {
              $requiresParent: true,
            },
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })

      const validation = ctx.validateForGeneration('Dependent')

      expect(validation.valid).toBe(false)
      expect(validation.errors).toContainEqual(
        expect.objectContaining({
          type: 'missing_parent',
        })
      )
    })
  })
})

// ============================================================================
// TESTS: GENERATION ORDERING
// ============================================================================

describe('Generation Ordering', () => {
  let context: InstanceType<typeof GenerationContext>

  beforeEach(() => {
    context = new GenerationContext({
      schema: createMockSchema(),
      namespace: 'test.ns',
    })
  })

  describe('Dependencies resolved before dependents', () => {
    it('tracks generation order', () => {
      const dep1 = createMockEntity('Dependency', { order: 1 })
      const dep2 = createMockEntity('Dependency', { order: 2 })
      const main = createMockEntity('Main', { order: 3 })

      context.addGenerated(dep1)
      context.addGenerated(dep2)
      context.addGenerated(main)

      const order = context.getGenerationOrder()

      expect(order[0].$id).toBe(dep1.$id)
      expect(order[1].$id).toBe(dep2.$id)
      expect(order[2].$id).toBe(main.$id)
    })

    it('provides dependencies for a type', () => {
      const schema: ParsedSchema = {
        types: {
          Invoice: {
            name: 'Invoice',
            fields: {
              customer: { type: 'reference', operator: '->', target: 'Customer' },
              items: { type: 'array', elementType: 'reference', operator: '->', target: 'LineItem' },
            },
            directives: {},
          },
          Customer: {
            name: 'Customer',
            fields: { name: { type: 'string' } },
            directives: {},
          },
          LineItem: {
            name: 'LineItem',
            fields: { amount: { type: 'number' } },
            directives: {},
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const deps = ctx.getDependencies('Invoice')

      expect(deps).toContain('Customer')
      expect(deps).toContain('LineItem')
    })
  })

  describe('Circular dependency detection', () => {
    it('detects simple circular dependency', () => {
      const schema: ParsedSchema = {
        types: {
          A: {
            name: 'A',
            fields: { b: { type: 'reference', operator: '->', target: 'B' } },
            directives: {},
          },
          B: {
            name: 'B',
            fields: { a: { type: 'reference', operator: '->', target: 'A' } },
            directives: {},
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const cycles = ctx.detectCycles()

      expect(cycles).toHaveLength(1)
      expect(cycles[0]).toEqual(['A', 'B', 'A'])
    })

    it('detects complex circular dependency', () => {
      const schema: ParsedSchema = {
        types: {
          X: {
            name: 'X',
            fields: { y: { type: 'reference', operator: '->', target: 'Y' } },
            directives: {},
          },
          Y: {
            name: 'Y',
            fields: { z: { type: 'reference', operator: '->', target: 'Z' } },
            directives: {},
          },
          Z: {
            name: 'Z',
            fields: { x: { type: 'reference', operator: '->', target: 'X' } },
            directives: {},
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const cycles = ctx.detectCycles()

      expect(cycles.length).toBeGreaterThan(0)
      expect(cycles[0]).toContain('X')
      expect(cycles[0]).toContain('Y')
      expect(cycles[0]).toContain('Z')
    })

    it('allows optional references to break cycles', () => {
      const schema: ParsedSchema = {
        types: {
          Node: {
            name: 'Node',
            fields: {
              parent: { type: 'reference', operator: '->', target: 'Node', optional: true },
            },
            directives: {},
          },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const cycles = ctx.detectCycles({ ignoreOptional: true })

      expect(cycles).toHaveLength(0)
    })
  })

  describe('Parallel generation where possible', () => {
    it('identifies parallel generation groups', () => {
      const schema: ParsedSchema = {
        types: {
          Root: {
            name: 'Root',
            fields: {
              a: { type: 'reference', operator: '->', target: 'A' },
              b: { type: 'reference', operator: '->', target: 'B' },
              c: { type: 'reference', operator: '->', target: 'C' },
            },
            directives: {},
          },
          A: { name: 'A', fields: { value: { type: 'string' } }, directives: {} },
          B: { name: 'B', fields: { value: { type: 'string' } }, directives: {} },
          C: { name: 'C', fields: { value: { type: 'string' } }, directives: {} },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const groups = ctx.getParallelGenerationGroups('Root')

      // A, B, C can be generated in parallel (first group)
      // Root comes after (second group)
      expect(groups).toHaveLength(2)
      expect(groups[0]).toContain('A')
      expect(groups[0]).toContain('B')
      expect(groups[0]).toContain('C')
      expect(groups[1]).toContain('Root')
    })

    it('respects dependencies in parallel groups', () => {
      const schema: ParsedSchema = {
        types: {
          Top: {
            name: 'Top',
            fields: {
              left: { type: 'reference', operator: '->', target: 'Left' },
              right: { type: 'reference', operator: '->', target: 'Right' },
            },
            directives: {},
          },
          Left: {
            name: 'Left',
            fields: {
              bottom: { type: 'reference', operator: '->', target: 'Bottom' },
            },
            directives: {},
          },
          Right: {
            name: 'Right',
            fields: {
              bottom: { type: 'reference', operator: '->', target: 'Bottom' },
            },
            directives: {},
          },
          Bottom: { name: 'Bottom', fields: { value: { type: 'string' } }, directives: {} },
        },
        directives: {},
      }

      const ctx = new GenerationContext({ schema, namespace: 'test' })
      const groups = ctx.getParallelGenerationGroups('Top')

      // Bottom first, then Left+Right in parallel, then Top
      expect(groups).toHaveLength(3)
      expect(groups[0]).toEqual(['Bottom'])
      expect(groups[1].sort()).toEqual(['Left', 'Right'])
      expect(groups[2]).toEqual(['Top'])
    })
  })
})
