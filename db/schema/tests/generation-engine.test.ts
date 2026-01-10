/**
 * Generation Engine Tests
 *
 * RED TDD: These tests should FAIL because the GenerationEngine doesn't exist yet.
 *
 * The generation engine orchestrates schema-driven entity generation using:
 * 1. Two-phase generation (parse schema, then generate with cascade)
 * 2. Dependency graph for topological ordering
 * 3. CascadeExecutor for code->gen->agentic->human fallback
 * 4. Context accumulation across generations
 *
 * This file tests:
 * 1. Two-phase generation (parse + generate)
 * 2. Dependency graph building
 * 3. Topological ordering
 * 4. AI integration via CascadeExecutor
 * 5. Entity ID generation with sqids
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  GenerationEngine,
  type GenerationOptions,
  type GenerationResult,
  type DependencyGraph,
  type DependencyNode,
  type TopologicalOrder,
  CircularDependencyError,
  GenerationFailedError,
  SchemaParseError,
} from '../engine/index'

import type { ParsedSchema, ParsedField, Entity } from '../types'

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-generation-engine-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    waitUntil: () => {},
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {
    AI: {
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({ name: 'Generated Entity', value: 42 }),
      }),
      complete: vi.fn().mockResolvedValue({ text: 'Completed', stopReason: 'end_turn' }),
    },
    AGENT_RUNNER: {
      run: vi.fn().mockResolvedValue({ result: 'Agent completed' }),
    },
    EVENTS: {
      emit: vi.fn(),
    },
    DB: {
      get: vi.fn(),
      put: vi.fn(),
      list: vi.fn().mockResolvedValue(new Map()),
    },
  }
}

// ============================================================================
// TESTS: TWO-PHASE GENERATION
// ============================================================================

describe('GenerationEngine', () => {
  let engine: InstanceType<typeof GenerationEngine>
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    engine = new GenerationEngine({
      state: mockState,
      env: mockEnv,
      namespace: 'test.ns',
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. TWO-PHASE GENERATION
  // ==========================================================================

  describe('Two-Phase Generation', () => {
    describe('Phase 1: Parse schema and build dependency graph', () => {
      it('parses schema into structured representation', async () => {
        const schema = {
          Startup: {
            name: 'string',
            idea: '<-Idea',
            model: '->LeanCanvas',
          },
        }

        const result = await engine.generate(schema, 'Startup')

        // Should have parsed the schema
        expect(result.parsedSchema).toBeDefined()
        expect(result.parsedSchema.types).toHaveProperty('Startup')
      })

      it('extracts field types from schema definitions', async () => {
        const schema = {
          Product: {
            name: 'string',
            price: 'number',
            active: 'boolean',
            tags: ['string'],
          },
        }

        const result = await engine.generate(schema, 'Product')

        expect(result.parsedSchema.types.Product.fields).toMatchObject({
          name: expect.objectContaining({ type: 'string' }),
          price: expect.objectContaining({ type: 'number' }),
          active: expect.objectContaining({ type: 'boolean' }),
          tags: expect.objectContaining({ type: 'array', elementType: 'string' }),
        })
      })

      it('identifies reference operators in field definitions', async () => {
        const schema = {
          Company: {
            ceo: '->Person',
            investors: ['~>Investor'],
            foundedBy: '<-Founder',
            mentions: '<~Article',
          },
        }

        const result = await engine.generate(schema, 'Company')

        expect(result.parsedSchema.types.Company.fields).toMatchObject({
          ceo: expect.objectContaining({ operator: '->', target: 'Person' }),
          investors: expect.objectContaining({ operator: '~>', target: 'Investor', isArray: true }),
          foundedBy: expect.objectContaining({ operator: '<-', target: 'Founder' }),
          mentions: expect.objectContaining({ operator: '<~', target: 'Article' }),
        })
      })

      it('builds dependency graph from schema relationships', async () => {
        const schema = {
          Startup: {
            model: '->LeanCanvas',
            founders: ['->Founder'],
          },
          LeanCanvas: {
            problem: 'string',
          },
          Founder: {
            name: 'string',
          },
        }

        const result = await engine.generate(schema, 'Startup')

        expect(result.dependencyGraph).toBeDefined()
        expect(result.dependencyGraph.nodes).toHaveProperty('Startup')
        expect(result.dependencyGraph.nodes.Startup.dependsOn).toContain('LeanCanvas')
        expect(result.dependencyGraph.nodes.Startup.dependsOn).toContain('Founder')
      })

      it('handles schemas with no dependencies', async () => {
        const schema = {
          SimpleEntity: {
            name: 'string',
            count: 'number',
          },
        }

        const result = await engine.generate(schema, 'SimpleEntity')

        expect(result.dependencyGraph.nodes.SimpleEntity.dependsOn).toHaveLength(0)
      })
    })

    describe('Phase 2: Generate entities with cascade resolution', () => {
      it('generates entity from schema type', async () => {
        const schema = {
          Customer: {
            name: 'Who is the customer?',
            email: 'email',
          },
        }

        const result = await engine.generate(schema, 'Customer')

        expect(result.entity).toBeDefined()
        expect(result.entity.$type).toBe('Customer')
        expect(result.entity).toHaveProperty('name')
        expect(result.entity).toHaveProperty('email')
      })

      it('uses CascadeExecutor for entity generation', async () => {
        const schema = {
          Task: {
            title: 'string',
            description: 'Describe the task in detail',
          },
        }

        const cascadeExecuteSpy = vi.spyOn(engine, 'executeWithCascade' as keyof typeof engine)

        await engine.generate(schema, 'Task')

        expect(cascadeExecuteSpy).toHaveBeenCalled()
      })

      it('generates dependent entities before dependents', async () => {
        const generationOrder: string[] = []

        const schema = {
          Order: {
            customer: '->Customer',
            items: ['->OrderItem'],
          },
          Customer: {
            name: 'string',
          },
          OrderItem: {
            product: 'string',
            quantity: 'number',
          },
        }

        engine.on('entityGenerated', (event: { type: string }) => {
          generationOrder.push(event.type)
        })

        await engine.generate(schema, 'Order')

        // Dependencies should be generated before Order
        const orderIndex = generationOrder.indexOf('Order')
        const customerIndex = generationOrder.indexOf('Customer')
        const itemIndex = generationOrder.indexOf('OrderItem')

        expect(customerIndex).toBeLessThan(orderIndex)
        expect(itemIndex).toBeLessThan(orderIndex)
      })

      it('creates relationships between generated entities', async () => {
        const schema = {
          Project: {
            name: 'string',
            owner: '->User',
          },
          User: {
            name: 'string',
          },
        }

        const result = await engine.generate(schema, 'Project')

        expect(result.entity.owner).toBeDefined()
        expect(result.entity.owner.$type).toBe('User')
        expect(result.relationships).toContainEqual(
          expect.objectContaining({
            from: result.entity.$id,
            to: result.entity.owner.$id,
            verb: 'owner',
          })
        )
      })
    })

    describe('Topological ordering for dependencies', () => {
      it('computes topological order for generation', async () => {
        const schema = {
          A: { b: '->B' },
          B: { c: '->C' },
          C: { value: 'string' },
        }

        const result = await engine.generate(schema, 'A')

        expect(result.generationOrder).toEqual(['C', 'B', 'A'])
      })

      it('handles diamond dependencies', async () => {
        // A depends on B and C, both depend on D
        const schema = {
          A: { b: '->B', c: '->C' },
          B: { d: '->D' },
          C: { d: '->D' },
          D: { value: 'string' },
        }

        const result = await engine.generate(schema, 'A')

        // D should appear only once and before B and C
        const order = result.generationOrder
        expect(order.filter((t) => t === 'D')).toHaveLength(1)
        expect(order.indexOf('D')).toBeLessThan(order.indexOf('B'))
        expect(order.indexOf('D')).toBeLessThan(order.indexOf('C'))
      })

      it('throws CircularDependencyError for circular dependencies', async () => {
        const schema = {
          A: { b: '->B' },
          B: { c: '->C' },
          C: { a: '->A' }, // Circular!
        }

        await expect(engine.generate(schema, 'A')).rejects.toThrow(CircularDependencyError)
      })

      it('includes cycle path in CircularDependencyError', async () => {
        const schema = {
          X: { y: '->Y' },
          Y: { z: '->Z' },
          Z: { x: '->X' },
        }

        try {
          await engine.generate(schema, 'X')
          expect.fail('Should have thrown CircularDependencyError')
        } catch (error) {
          expect(error).toBeInstanceOf(CircularDependencyError)
          const cycleError = error as CircularDependencyError
          expect(cycleError.cyclePath).toEqual(['X', 'Y', 'Z', 'X'])
        }
      })

      it('handles self-referential types without error when optional', async () => {
        const schema = {
          TreeNode: {
            value: 'string',
            children: ['->TreeNode?'], // Optional self-reference
          },
        }

        // Should not throw - optional references break the cycle
        const result = await engine.generate(schema, 'TreeNode', { depth: 1 })
        expect(result.entity.$type).toBe('TreeNode')
      })
    })
  })

  // ==========================================================================
  // 2. DEPENDENCY GRAPH
  // ==========================================================================

  describe('Dependency Graph Building', () => {
    it('creates nodes for all types in schema', async () => {
      const schema = {
        Alpha: { value: 'string' },
        Beta: { value: 'number' },
        Gamma: { value: 'boolean' },
      }

      const graph = engine.buildDependencyGraph(schema)

      expect(Object.keys(graph.nodes)).toHaveLength(3)
      expect(graph.nodes).toHaveProperty('Alpha')
      expect(graph.nodes).toHaveProperty('Beta')
      expect(graph.nodes).toHaveProperty('Gamma')
    })

    it('tracks forward dependencies (->)', async () => {
      const schema = {
        Parent: { child: '->Child' },
        Child: { value: 'string' },
      }

      const graph = engine.buildDependencyGraph(schema)

      expect(graph.nodes.Parent.dependsOn).toContain('Child')
      expect(graph.nodes.Child.dependedOnBy).toContain('Parent')
    })

    it('tracks backward dependencies (<-)', async () => {
      const schema = {
        Manager: { reports: '<-Employee' },
        Employee: { name: 'string' },
      }

      const graph = engine.buildDependencyGraph(schema)

      // Backward reference: Employee is generated, links TO Manager
      expect(graph.nodes.Manager.dependsOn).toContain('Employee')
    })

    it('handles fuzzy search references (~>)', async () => {
      const schema = {
        Article: { author: '~>Author' },
        Author: { name: 'string' },
      }

      const graph = engine.buildDependencyGraph(schema)

      // Fuzzy search creates a soft dependency
      expect(graph.nodes.Article.softDependsOn).toContain('Author')
    })

    it('marks array references correctly', async () => {
      const schema = {
        Team: { members: ['->Person'] },
        Person: { name: 'string' },
      }

      const graph = engine.buildDependencyGraph(schema)

      expect(graph.nodes.Team.dependsOn).toContain('Person')
      expect(graph.edges.find((e) => e.from === 'Team' && e.to === 'Person')).toMatchObject({
        isArray: true,
      })
    })

    it('excludes primitive types from dependencies', async () => {
      const schema = {
        Record: {
          name: 'string',
          count: 'number',
          active: 'boolean',
          created: 'date',
        },
      }

      const graph = engine.buildDependencyGraph(schema)

      expect(graph.nodes.Record.dependsOn).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 3. AI INTEGRATION
  // ==========================================================================

  describe('AI Integration', () => {
    describe('Uses CascadeExecutor for generation', () => {
      it('tries code generation first', async () => {
        const schema = {
          Counter: {
            value: 'number',
          },
        }

        engine.registerCodeGenerator('Counter', (schema, seed) => ({
          value: seed?.value ?? 0,
        }))

        const result = await engine.generate(schema, 'Counter')

        expect(result.method).toBe('code')
        expect(result.entity.value).toBe(0)
      })

      it('falls back to generative when code fails', async () => {
        const schema = {
          Story: {
            title: 'A compelling title for the story',
            content: 'The full story content',
          },
        }

        // No code generator registered - should use AI

        const result = await engine.generate(schema, 'Story')

        expect(result.method).toBe('generative')
        expect(mockEnv.AI.generate).toHaveBeenCalled()
      })

      it('passes field prompts to AI as instructions', async () => {
        const schema = {
          BlogPost: {
            title: 'Write a catchy SEO-optimized title about technology',
            summary: 'A 2-3 sentence summary for social media sharing',
          },
        }

        await engine.generate(schema, 'BlogPost')

        expect(mockEnv.AI.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: expect.stringContaining('catchy SEO-optimized title'),
          })
        )
      })

      it('includes context from previous generations', async () => {
        const schema = {
          Invoice: {
            customer: '->Customer',
            items: ['->LineItem'],
            total: 'Calculate the total from items',
          },
          Customer: {
            name: 'string',
          },
          LineItem: {
            amount: 'number',
          },
        }

        await engine.generate(schema, 'Invoice')

        // When generating Invoice, Customer and LineItems should be in context
        const lastCall = mockEnv.AI.generate.mock.calls.slice(-1)[0]
        expect(lastCall[0].context).toContain('Customer')
        expect(lastCall[0].context).toContain('LineItem')
      })
    })

    describe('Model selection per type', () => {
      it('allows specifying model per entity type', async () => {
        const schema = {
          Essay: {
            $model: 'claude-3-opus',
            content: 'Write a thoughtful essay about AI ethics',
          },
        }

        await engine.generate(schema, 'Essay')

        expect(mockEnv.AI.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'claude-3-opus',
          })
        )
      })

      it('uses default model when not specified', async () => {
        const schema = {
          Note: {
            content: 'string',
          },
        }

        engine = new GenerationEngine({
          state: mockState,
          env: mockEnv,
          namespace: 'test.ns',
          defaultModel: 'claude-3-haiku',
        })

        await engine.generate(schema, 'Note')

        expect(mockEnv.AI.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'claude-3-haiku',
          })
        )
      })

      it('respects field-level model overrides', async () => {
        const schema = {
          Analysis: {
            quickSummary: { $model: 'claude-3-haiku', prompt: 'Brief summary' },
            deepAnalysis: { $model: 'claude-3-opus', prompt: 'Detailed analysis' },
          },
        }

        await engine.generate(schema, 'Analysis')

        const calls = mockEnv.AI.generate.mock.calls
        expect(calls.some((c) => c[0].model === 'claude-3-haiku')).toBe(true)
        expect(calls.some((c) => c[0].model === 'claude-3-opus')).toBe(true)
      })
    })

    describe('Token budget management', () => {
      it('respects maxTokens option', async () => {
        const schema = {
          Summary: {
            content: 'string',
          },
        }

        await engine.generate(schema, 'Summary', { maxTokens: 100 })

        expect(mockEnv.AI.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            maxTokens: 100,
          })
        )
      })

      it('allows type-level token budgets', async () => {
        const schema = {
          Tweet: {
            $maxTokens: 50,
            content: 'A tweet-sized message',
          },
        }

        await engine.generate(schema, 'Tweet')

        expect(mockEnv.AI.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            maxTokens: 50,
          })
        )
      })

      it('distributes budget across array generations', async () => {
        const schema = {
          Thread: {
            $maxTokens: 300,
            tweets: ['->Tweet', 5], // Generate 5 tweets
          },
          Tweet: {
            content: 'string',
          },
        }

        await engine.generate(schema, 'Thread')

        // Each tweet should get ~60 tokens (300 / 5)
        const tweetCalls = mockEnv.AI.generate.mock.calls.filter((c) =>
          c[0].type?.includes('Tweet')
        )
        expect(tweetCalls.every((c) => c[0].maxTokens <= 60)).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 4. ENTITY ID GENERATION
  // ==========================================================================

  describe('Entity ID Generation', () => {
    describe('Auto-generated if not specified', () => {
      it('generates $id for new entities', async () => {
        const schema = {
          Widget: {
            name: 'string',
          },
        }

        const result = await engine.generate(schema, 'Widget')

        expect(result.entity.$id).toBeDefined()
        expect(typeof result.entity.$id).toBe('string')
        expect(result.entity.$id.length).toBeGreaterThan(0)
      })

      it('preserves provided $id in seed', async () => {
        const schema = {
          Widget: {
            name: 'string',
          },
        }

        const result = await engine.generate(schema, 'Widget', {
          seed: { $id: 'widget-custom-123' },
        })

        expect(result.entity.$id).toBe('widget-custom-123')
      })

      it('generates unique IDs for each entity', async () => {
        const schema = {
          Item: {
            value: 'number',
          },
        }

        const result1 = await engine.generate(schema, 'Item')
        const result2 = await engine.generate(schema, 'Item')
        const result3 = await engine.generate(schema, 'Item')

        expect(result1.entity.$id).not.toBe(result2.entity.$id)
        expect(result2.entity.$id).not.toBe(result3.entity.$id)
        expect(result1.entity.$id).not.toBe(result3.entity.$id)
      })
    })

    describe('sqid format for readability', () => {
      it('generates sqid-formatted IDs', async () => {
        const schema = {
          Record: {
            data: 'string',
          },
        }

        const result = await engine.generate(schema, 'Record')

        // sqids are URL-safe alphanumeric strings
        expect(result.entity.$id).toMatch(/^[a-zA-Z0-9]+$/)
      })

      it('encodes entity metadata in sqid', async () => {
        const schema = {
          Document: {
            title: 'string',
          },
        }

        const result = await engine.generate(schema, 'Document')

        // Should be decodable to retrieve type and sequence info
        const decoded = engine.decodeId(result.entity.$id)
        expect(decoded).toHaveProperty('TYPE')
        expect(decoded).toHaveProperty('THING')
      })
    })

    describe('Namespace prefixing', () => {
      it('includes namespace in entity ID when configured', async () => {
        engine = new GenerationEngine({
          state: mockState,
          env: mockEnv,
          namespace: 'acme.widgets',
          prefixIds: true,
        })

        const schema = {
          Part: {
            name: 'string',
          },
        }

        const result = await engine.generate(schema, 'Part')

        expect(result.entity.$id).toMatch(/^acme\.widgets:/)
      })

      it('uses type prefix for human readability', async () => {
        engine = new GenerationEngine({
          state: mockState,
          env: mockEnv,
          namespace: 'test',
          useTypePrefix: true,
        })

        const schema = {
          Customer: {
            name: 'string',
          },
        }

        const result = await engine.generate(schema, 'Customer')

        expect(result.entity.$id).toMatch(/^cust_/)
      })

      it('allows custom ID prefix per type', async () => {
        const schema = {
          Invoice: {
            $prefix: 'inv',
            amount: 'number',
          },
        }

        const result = await engine.generate(schema, 'Invoice')

        expect(result.entity.$id).toMatch(/^inv_/)
      })
    })
  })

  // ==========================================================================
  // 5. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('throws SchemaParseError for invalid schema', async () => {
      const schema = {
        Invalid: {
          field: { nested: { tooDeep: 'invalid structure' } },
        },
      }

      await expect(engine.generate(schema, 'Invalid')).rejects.toThrow(SchemaParseError)
    })

    it('throws GenerationFailedError when all cascade methods fail', async () => {
      const schema = {
        Impossible: {
          value: 'Generate something that will fail',
        },
      }

      mockEnv.AI.generate.mockRejectedValue(new Error('AI unavailable'))

      await expect(engine.generate(schema, 'Impossible')).rejects.toThrow(GenerationFailedError)
    })

    it('includes partial results in GenerationFailedError', async () => {
      const schema = {
        Container: {
          first: '->First',
          second: '->Second',
        },
        First: { value: 'string' },
        Second: { value: 'string' },
      }

      // First succeeds, Second fails
      mockEnv.AI.generate
        .mockResolvedValueOnce({ text: JSON.stringify({ value: 'first' }) })
        .mockRejectedValueOnce(new Error('Generation failed'))

      try {
        await engine.generate(schema, 'Container')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(GenerationFailedError)
        const genError = error as GenerationFailedError
        expect(genError.partialResults).toHaveProperty('First')
      }
    })

    it('cleans up partial state on failure', async () => {
      const schema = {
        Parent: {
          child: '->Child',
        },
        Child: {
          value: 'string',
        },
      }

      mockEnv.AI.generate.mockRejectedValue(new Error('Fail'))

      await engine.generate(schema, 'Parent').catch(() => {})

      // Should not have orphaned entities in storage
      const stored = await mockState.storage.list({ prefix: 'entity:' })
      expect(stored.size).toBe(0)
    })
  })

  // ==========================================================================
  // 6. GENERATION OPTIONS
  // ==========================================================================

  describe('Generation Options', () => {
    it('respects seed values for entity fields', async () => {
      const schema = {
        User: {
          name: 'string',
          age: 'number',
        },
      }

      const result = await engine.generate(schema, 'User', {
        seed: { name: 'Alice', age: 30 },
      })

      expect(result.entity.name).toBe('Alice')
      expect(result.entity.age).toBe(30)
    })

    it('only generates missing fields when seed provided', async () => {
      const schema = {
        Profile: {
          username: 'string',
          bio: 'A creative bio about the user',
        },
      }

      const result = await engine.generate(schema, 'Profile', {
        seed: { username: 'alice123' },
      })

      expect(result.entity.username).toBe('alice123')
      expect(result.entity.bio).toBeDefined()
      expect(mockEnv.AI.generate).toHaveBeenCalledTimes(1) // Only for bio
    })

    it('supports dry-run mode', async () => {
      const schema = {
        Expensive: {
          content: 'Generate expensive content',
        },
      }

      const result = await engine.generate(schema, 'Expensive', { dryRun: true })

      expect(result.dryRun).toBe(true)
      expect(result.entity).toBeUndefined()
      expect(result.plan).toBeDefined()
      expect(result.plan.typesToGenerate).toContain('Expensive')
      expect(mockEnv.AI.generate).not.toHaveBeenCalled()
    })

    it('supports validation-only mode', async () => {
      const schema = {
        Validated: {
          email: 'email',
          url: 'url',
        },
      }

      const result = await engine.generate(schema, 'Validated', {
        validateOnly: true,
        seed: { email: 'not-an-email', url: 'not-a-url' },
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'email', type: 'format' })
      )
      expect(result.errors).toContainEqual(expect.objectContaining({ field: 'url', type: 'format' }))
    })
  })
})
