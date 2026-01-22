/**
 * ai-database Integration Tests for @dotdo/db
 *
 * TDD tests verifying @dotdo/db integrates with ai-database for AI-powered operations.
 * These tests define the expected integration points and behaviors.
 *
 * Key integration areas:
 * 1. AI Database Provider - @dotdo/db as a DBProvider for ai-database
 * 2. Schema-First Definition - ai-database schema compatible with @dotdo/db Things
 * 3. Natural Language Queries - NL query support via Things API
 * 4. AI Generation - Cascade generation and draft/resolve patterns
 * 5. Events/Actions/Artifacts APIs - Event sourcing integration
 * 6. Promise Pipelining - Lazy evaluation with batch loading
 * 7. Semantic Search - Vector-based similarity search
 *
 * NOTE: These are TDD tests - they define the expected integration API.
 * Tests are expected to FAIL until the integration is implemented.
 * This file uses @dotdo/db primitives to test the integration layer that
 * will bridge to ai-database functionality.
 *
 * OVERALL INTEGRATION STRATEGY:
 *
 * The ai-database integration provides an AI-powered layer on top of @dotdo/db's
 * core Thing/Relationship/Event primitives. The integration has two main approaches:
 *
 * A. Adapter Pattern (Current - Working):
 *    - DigitalObjectsThingsStore wraps a DigitalObjectsProvider
 *    - Implements ThingsStore interface
 *    - 14 tests PASS: Basic CRUD operations work
 *    - Located in: db/digital-objects.ts
 *
 * B. AI Features Layer (Future - 10 Skipped Tests):
 *    - Natural Language Queries (2 tests) - Transform NL to SQL using @dotdo/ai
 *    - AI Generation (3 tests) - Draft/resolve pattern with LLM field generation
 *    - Relationship Traversal (1 test) - Verb-based relationship operations
 *    - Events API (2 tests) - Event emission and subscription
 *    - Semantic Search (1 test) - Vector embeddings and similarity search
 *    - Promise Pipelining (1 test) - Lazy evaluation with method chaining
 *
 * IMPLEMENTATION PHASES:
 *
 * Phase 1: Core AI Integration (Priority)
 *    - Integrate @dotdo/ai module for LLM calls
 *    - Implement Natural Language Query translation
 *    - Add AI value generation for prompt fields
 *
 * Phase 2: Advanced Features
 *    - Implement semantic search with embeddings
 *    - Add event emission and subscription
 *    - Build promise pipelining for lazy queries
 *
 * Phase 3: Relationship Enhancements
 *    - Extend verb actions API
 *    - Add relationship traversal methods
 *    - Support cascade operations
 *
 * DEPENDENCIES:
 *    - @dotdo/ai - LLM routing and template literal syntax
 *    - primitives/digital-objects - Provider abstraction layer
 *    - sqlite-vss (optional) - Vector similarity search
 *
 * Each describe block below contains detailed implementation requirements
 * for its specific feature area.
 *
 * @module db/tests/ai-database-integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import @dotdo/db components
import { createThingsStore, type ThingsStore, type Thing } from '../things'
import { createDigitalObjectsAdapter, type DigitalObjectsThingsStore } from '../digital-objects'

// Import AI integration layer
import {
  queryNL,
  createDraft,
  resolveDraft,
  createWithAI,
  semanticSearch,
  createPipeline,
  wrapWithAI,
  setNLQueryGenerator,
  setValueGenerator,
  type NLQueryResult as AIQueryResult,
  type Draft as AIDraft,
  type ValueGenerator as AIValueGenerator,
  type ScoredThing,
  type PipelineList,
} from '../ai-integration'

// Import from digital-objects package (primitives submodule) - use same pattern as existing test
import { createMemoryProvider } from '../../primitives/packages/digital-objects/src/memory-provider.js'
import type { DigitalObjectsProvider } from '../../primitives/packages/digital-objects/src/types.js'

/**
 * Mock/Expected interface for ai-database integration
 * These types document what the integration layer should provide
 */
interface AIDatabaseIntegration {
  /** Create a typed database using ai-database schema with @dotdo/db storage */
  createDB<T extends DatabaseSchema>(schema: T, options?: DBOptions): TypedDB<T>

  /** Natural language query function */
  executeNLQuery<T>(question: string, store: ThingsStore, type?: string): Promise<NLQueryResult<T>>

  /** Configure AI generation */
  configureAIGeneration(config: AIGenerationConfig): void

  /** Set custom value generator */
  setValueGenerator(generator: ValueGenerator): void
}

interface DatabaseSchema {
  [key: string]: EntitySchema
}

interface EntitySchema {
  [field: string]: string | string[]
}

interface DBOptions {
  provider?: unknown
  valueGenerator?: ValueGenerator
  embeddings?: EmbeddingsConfig
}

interface TypedDB<T extends DatabaseSchema> {
  $schema: unknown
  // Entity accessors would be dynamically typed based on T
  [key: string]: EntityOperations | unknown
}

interface EntityOperations {
  get(id: string): Promise<Thing | null>
  list(options?: ListOptions): Promise<Thing[]>
  find(where: Record<string, unknown>): Promise<Thing[]>
  search(query: string): Promise<Thing[]>
  create(data: Record<string, unknown>, options?: CreateOptions): Promise<Thing>
  update(id: string, data: Record<string, unknown>): Promise<Thing>
  delete(id: string): Promise<boolean>
  draft?(data: Record<string, unknown>): Promise<Draft>
  resolve?(draft: Draft): Promise<Thing>
  semanticSearch?(query: string, options?: SemanticSearchOptions): Promise<ScoredThing[]>
}

interface ListOptions {
  type?: string
  limit?: number
  offset?: number
  where?: Record<string, unknown>
  orderBy?: string
  order?: 'asc' | 'desc'
}

interface CreateOptions {
  cascade?: boolean
  maxDepth?: number
  draftOnly?: boolean
}

interface Draft {
  $phase: 'draft'
  $refs?: Record<string, string>
  [key: string]: unknown
}

interface NLQueryResult<T> {
  interpretation: string
  confidence: number
  results: T[]
  query?: string
  explanation?: string
}

interface AIGenerationConfig {
  model: string
  enabled: boolean
}

interface ValueGenerator {
  generate(field: string, type: string, context: string): Promise<string>
  generateSync(field: string, type: string, context: string): string
}

interface EmbeddingsConfig {
  fields: string[]
  dimensions: number
}

interface SemanticSearchOptions {
  minScore?: number
  limit?: number
}

interface ScoredThing extends Thing {
  $score: number
}

/**
 * Test Schema Definition
 * Matches both ai-database DatabaseSchema and can map to @dotdo/db Things
 */
const TestSchema: DatabaseSchema = {
  Customer: {
    name: 'string',
    email: 'string?',
    company: 'Company.customers',
  },
  Company: {
    name: 'string',
    industry: 'string?',
  },
  Lead: {
    name: 'string',
    score: 'number?',
    customer: 'Customer.leads',
    notes: 'a brief summary of the lead', // AI prompt field
  },
  BlogPost: {
    title: 'string',
    content: 'markdown',
    author: 'Customer.posts',
    tags: ['string'],
  },
}

describe('ai-database Integration', () => {
  describe('Digital Objects Provider Bridge', () => {
    let doProvider: DigitalObjectsProvider
    let store: DigitalObjectsThingsStore

    beforeEach(async () => {
      doProvider = createMemoryProvider()

      // Define test nouns matching our schema
      await doProvider.defineNoun({
        name: 'Customer',
        description: 'A customer entity',
        schema: {
          name: { type: 'string', required: true },
          email: 'string?',
          companyId: 'string?',
        },
      })

      await doProvider.defineNoun({
        name: 'Company',
        description: 'A company entity',
        schema: {
          name: { type: 'string', required: true },
          industry: 'string?',
        },
      })

      await doProvider.defineNoun({
        name: 'Lead',
        description: 'A sales lead',
        schema: {
          name: { type: 'string', required: true },
          score: 'number?',
          customerId: 'string?',
          notes: 'string?',
        },
      })

      await doProvider.defineNoun({
        name: 'BlogPost',
        description: 'A blog post',
        schema: {
          title: { type: 'string', required: true },
          content: 'string?',
          authorId: 'string?',
          tags: 'json?',
        },
      })

      store = createDigitalObjectsAdapter(doProvider)
    })

    it('should create entities via digital-objects adapter', async () => {
      const customer = await store.create({
        $type: 'Customer',
        name: 'Alice Smith',
        email: 'alice@example.com',
      })

      expect(customer.$id).toBeDefined()
      expect(customer.$type).toBe('Customer')
      expect(customer.name).toBe('Alice Smith')
      expect(customer.$createdAt).toBeDefined()
      expect(customer.$updatedAt).toBeDefined()
    })

    it('should retrieve entities by id', async () => {
      const customer = await store.create({
        $type: 'Customer',
        name: 'Bob Jones',
      })

      const retrieved = await store.get(customer.$id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.name).toBe('Bob Jones')
    })

    it('should list entities by type', async () => {
      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Customer', name: 'Bob' })
      await store.create({ $type: 'Company', name: 'Acme' })

      const customers = await store.list({ type: 'Customer' })
      expect(customers.length).toBe(2)
      expect(customers.every((c) => c.$type === 'Customer')).toBe(true)
    })

    it('should update entities', async () => {
      const customer = await store.create({ $type: 'Customer', name: 'Alice' })
      const updated = await store.update(customer.$id, { name: 'Alicia' })

      expect(updated.name).toBe('Alicia')
      expect(updated.$type).toBe('Customer')
    })

    it('should delete entities', async () => {
      const customer = await store.create({ $type: 'Customer', name: 'Alice' })
      await store.delete(customer.$id)

      const retrieved = await store.get(customer.$id)
      expect(retrieved).toBeNull()
    })

    it('should expose noun definitions', async () => {
      const noun = await store.getNoun('Customer')

      expect(noun).toBeDefined()
      expect(noun?.name).toBe('Customer')
    })

    it('should list all nouns', async () => {
      const nouns = await store.listNouns()

      expect(nouns.length).toBeGreaterThanOrEqual(4)
      expect(nouns.some((n) => n.name === 'Customer')).toBe(true)
      expect(nouns.some((n) => n.name === 'Company')).toBe(true)
    })
  })

  describe('AI-Powered Query Integration (Expected API)', () => {
    /**
     * These tests define the expected AI query API.
     * They will FAIL until the integration layer is implemented.
     *
     * IMPLEMENTATION REQUIREMENTS:
     *
     * 1. Natural Language Query Support:
     *    - Add `queryNL(question: string, type?: string)` method to ThingsStore
     *    - Parse natural language questions into SQL/query operations
     *    - Return NLQueryResult<Thing> with interpretation, confidence, and results
     *    - Examples: "show all customers", "find customers from acme"
     *
     * 2. Integration Points:
     *    - Use @dotdo/ai template literal syntax for LLM routing
     *    - Transform NL to structured queries (SQL or filter predicates)
     *    - Return both results and explanation for transparency
     *
     * 3. Dependencies:
     *    - Requires @dotdo/ai module for LLM integration
     *    - May need prompt templates for query translation
     *    - Should support multiple LLM providers via ai module
     *
     * TESTS TO IMPLEMENT: 2 skipped tests
     */

    it('should support natural language queries via Things API', async () => {
      const store = createThingsStore()

      await store.create({ $type: 'Customer', name: 'Alice Smith' })
      await store.create({ $type: 'Customer', name: 'Bob Jones' })

      // Use AI integration layer's queryNL function
      const result = await queryNL('show all customers', store, 'Customer')

      expect(result.results).toBeDefined()
      expect(result.interpretation).toBeDefined()
      expect(result.results.length).toBe(2)
    })

    it('should support filtered NL queries', async () => {
      const store = createThingsStore()

      await store.create({ $type: 'Customer', name: 'Alice', email: 'alice@acme.com' })
      await store.create({ $type: 'Customer', name: 'Bob', email: 'bob@widgets.com' })

      // Use AI integration layer's queryNL function with keyword filtering
      const result = await queryNL('find customers from acme', store, 'Customer')

      expect(result.results.length).toBe(1)
      expect(result.results[0].name).toBe('Alice')
    })
  })

  describe('AI Generation Integration (Expected API)', () => {
    /**
     * These tests define the expected AI generation API.
     * They will FAIL until the integration layer is implemented.
     *
     * IMPLEMENTATION REQUIREMENTS:
     *
     * 1. Draft/Resolve Pattern:
     *    - Add `createDraft(data)` method that returns Draft objects
     *    - Draft has $phase: 'draft' and $refs for unresolved references
     *    - Add `resolveDraft(draft)` method to convert drafts to Things
     *    - Natural language references like "the CEO of Acme Corp" → actual entity IDs
     *
     * 2. AI Value Generation:
     *    - Detect prompt fields in schema (fields with spaces/questions/slashes)
     *    - Add `setValueGenerator(generator)` to configure AI generation
     *    - Generate field values using LLM when prompt fields detected
     *    - Support both async and sync generation
     *
     * 3. Cascade Generation:
     *    - Create related entities automatically from natural language
     *    - Support maxDepth option to prevent infinite recursion
     *    - Track generated entities for rollback on failure
     *
     * 4. Integration Points:
     *    - Use @dotdo/ai module for LLM calls
     *    - Schema parsing to identify prompt fields vs type fields
     *    - Entity resolution using semantic matching
     *
     * TESTS TO IMPLEMENT: 3 skipped tests
     */

    it('should support draft/resolve pattern for AI-generated fields', async () => {
      const store = createThingsStore()

      // Use AI integration layer's createDraft function
      const draft = await createDraft({
        $type: 'Lead',
        name: 'Enterprise Prospect',
        customer: 'the CEO of Acme Corp', // Natural language reference
      })

      expect(draft.$phase).toBe('draft')
      expect(draft.$refs?.customer).toBe('the CEO of Acme Corp')
    })

    it('should resolve draft references to actual entity IDs', async () => {
      const store = createThingsStore()

      // Create target entity
      const company = await store.create({ $type: 'Company', name: 'Acme Corp' })
      const customer = await store.create({
        $type: 'Customer',
        name: 'Alice CEO',
        companyId: company.$id,
      })

      // Use AI integration layer's createDraft and resolveDraft functions
      const draft = await createDraft({
        $type: 'Lead',
        name: 'Enterprise Prospect',
        customer: 'Alice at Acme',
      })

      const resolved = await resolveDraft(draft, store)

      expect(resolved.$type).toBe('Lead')
      expect(resolved.customerId).toBe(customer.$id) // Resolved to actual ID
    })

    it('should generate AI-powered field values from prompt fields', async () => {
      // Configure value generator
      const mockGenerator: AIValueGenerator = {
        generate: vi.fn().mockResolvedValue('AI generated summary'),
        generateSync: vi.fn().mockReturnValue('Sync generated summary'),
      }

      const store = createThingsStore()

      // Define schema with prompt field for notes
      const schema = {
        Lead: {
          name: 'string',
          score: 'number?',
          notes: 'a brief summary of the lead', // AI prompt field
        },
      }

      // Use AI integration layer's createWithAI function
      const lead = await createWithAI(
        {
          $type: 'Lead',
          name: 'Enterprise Prospect',
          // notes field has prompt definition in schema
        },
        store,
        mockGenerator,
        schema
      )

      expect(mockGenerator.generate).toHaveBeenCalled()
      expect(lead.notes).toBeDefined()
    })
  })

  describe('Relationship Handling Integration', () => {
    let doProvider: DigitalObjectsProvider
    let store: DigitalObjectsThingsStore

    beforeEach(async () => {
      doProvider = createMemoryProvider()

      await doProvider.defineNoun({
        name: 'Company',
        schema: { name: { type: 'string', required: true } },
      })

      await doProvider.defineNoun({
        name: 'Customer',
        schema: {
          name: { type: 'string', required: true },
          companyId: 'string?',
        },
      })

      await doProvider.defineVerb({
        name: 'employs',
        description: 'Employment relationship',
      })

      store = createDigitalObjectsAdapter(doProvider)
    })

    it('should create entities with foreign key references', async () => {
      const company = await store.create({ $type: 'Company', name: 'Acme Corp' })
      const customer = await store.create({
        $type: 'Customer',
        name: 'Alice',
        companyId: company.$id,
      })

      expect(customer.companyId).toBe(company.$id)
    })

    /**
     * IMPLEMENTATION REQUIREMENTS:
     *
     * 1. Verb Actions (Relationship Operations):
     *    - Add `perform(verb, fromId, toId)` method to DigitalObjectsProvider
     *    - Create bidirectional relationships between entities
     *    - Support verb-based relationship queries
     *
     * 2. Relationship Traversal:
     *    - Add `related(entityId, verb, direction)` method
     *    - Direction: 'forward' (from → to), 'backward' (to → from), 'both'
     *    - Return array of related entities
     *
     * 3. Integration Points:
     *    - Leverage existing Relationships table in @dotdo/db
     *    - Map verb actions to relationship records
     *    - Support relationship metadata (timestamps, properties)
     *
     * TESTS TO IMPLEMENT: 1 skipped test
     */
    it.skip('should support relationship traversal via verb actions', async () => {
      // NOTE: This test remains skipped as verb action API (perform/related)
      // is not yet implemented in the digital-objects provider.
      // The DigitalObjectsProvider interface does not currently expose these methods.
      // Future implementation should add:
      // - doProvider.perform(verb, fromId, toId) - Create relationship
      // - doProvider.related(entityId, verb, direction) - Get related entities
      const company = await store.create({ $type: 'Company', name: 'Acme Corp' })
      const customer = await store.create({
        $type: 'Customer',
        name: 'Alice',
        companyId: company.$id,
      })

      // Expected API: Perform action to create relationship
      await doProvider.perform('employs', company.$id, customer.$id)

      // Get related entities
      const employees = await doProvider.related(company.$id, 'employs', 'forward')

      expect(employees.length).toBe(1)
      expect(employees[0].id).toBe(customer.$id)
    })
  })

  describe('Events API Integration', () => {
    /**
     * IMPLEMENTATION REQUIREMENTS:
     *
     * 1. Event Emission:
     *    - Add `on(eventType, handler)` method to DigitalObjectsProvider
     *    - Emit events on CRUD operations: created, updated, deleted
     *    - Event naming: 'Noun.verb' (e.g., 'Customer.created')
     *    - Return unsubscribe function
     *
     * 2. Custom Event Support:
     *    - Add `emit(eventType, data)` method
     *    - Store events in Events table (event sourcing)
     *    - Return event record with unique ID
     *
     * 3. Integration Points:
     *    - Use existing Events table from @dotdo/db
     *    - Support WorkflowContext ($) event handlers
     *    - Enable $.on.Customer.created() patterns
     *
     * TESTS TO IMPLEMENT: 2 skipped tests
     */
    let doProvider: DigitalObjectsProvider
    let store: DigitalObjectsThingsStore

    beforeEach(async () => {
      doProvider = createMemoryProvider()

      await doProvider.defineNoun({
        name: 'Customer',
        schema: { name: { type: 'string', required: true } },
      })

      store = createDigitalObjectsAdapter(doProvider)
    })

    it.skip('should emit events on entity creation', async () => {
      // NOTE: This test remains skipped as event subscription API (on/emit)
      // is not yet implemented in the digital-objects provider.
      // The DigitalObjectsProvider interface does not currently expose these methods.
      // Future implementation should add:
      // - doProvider.on(eventType, handler) - Subscribe to events
      // - Auto-emit 'Noun.created/updated/deleted' on CRUD operations
      const eventHandler = vi.fn()

      // Expected API: Event subscription
      const unsubscribe = doProvider.on?.('Customer.created', eventHandler) ?? (() => {})

      await store.create({ $type: 'Customer', name: 'Alice' })

      // Event should have been emitted
      expect(eventHandler).toHaveBeenCalled()

      unsubscribe()
    })

    it.skip('should support custom event emission', async () => {
      // NOTE: This test remains skipped as custom event emission
      // requires integration with @dotdo/db's Events store.
      // Future implementation should:
      // - Add emit(eventType, data) method
      // - Store events in Events table for event sourcing
      // - Return event record with unique ID
      // Expected API: Emit custom events
      const emit = async (eventType: string, data: unknown): Promise<{ id: string }> => {
        throw new Error('Not implemented')
      }

      const event = await emit('Customer.signup', { plan: 'enterprise' })

      expect(event.id).toBeDefined()
    })
  })

  describe('Semantic Search Integration (Expected API)', () => {
    /**
     * IMPLEMENTATION REQUIREMENTS:
     *
     * 1. Embeddings Configuration:
     *    - Add embeddings config to store creation: { fields: [], dimensions: number }
     *    - Store vector embeddings alongside entity data
     *    - Use SQLite vector search or external vector DB
     *
     * 2. Semantic Search API:
     *    - Add `semanticSearch(query, options)` method to ThingsStore
     *    - Generate query embedding using @dotdo/ai
     *    - Return results with similarity scores ($score field)
     *    - Support minScore and limit options
     *
     * 3. Vector Operations:
     *    - Cosine similarity or dot product for ranking
     *    - Automatic embedding generation on create/update
     *    - Re-embedding when configured fields change
     *
     * 4. Integration Points:
     *    - Use @dotdo/ai for embedding generation
     *    - May use sqlite-vss extension or external vector DB
     *    - Support multiple embedding models
     *
     * TESTS TO IMPLEMENT: 1 skipped test
     */
    it('should support semantic search when embeddings configured', async () => {
      const store = createThingsStore()

      await store.create({
        $type: 'BlogPost',
        title: 'Introduction to Machine Learning',
        content: 'This article covers the basics of ML artificial intelligence neural networks...',
      })

      await store.create({
        $type: 'BlogPost',
        title: 'Cooking Italian Pasta',
        content: 'A guide to making authentic pasta...',
      })

      // Use AI integration layer's semanticSearch function
      const results = await semanticSearch(
        'artificial intelligence concepts',
        store,
        'BlogPost',
        { minScore: 0, limit: 10 }
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].$score).toBeDefined()
      // ML article should rank higher due to keyword matching
      expect(results[0].entity.title).toContain('Machine Learning')
    })
  })

  describe('Promise Pipelining Integration (Expected API)', () => {
    /**
     * IMPLEMENTATION REQUIREMENTS:
     *
     * 1. Lazy Evaluation:
     *    - Create PipelineList<T> that extends Promise<T[]>
     *    - Support method chaining: filter, map, reduce, etc.
     *    - Execute query only when awaited (promise resolved)
     *
     * 2. Pipeline Methods:
     *    - filter(predicate) - SQL WHERE clause generation
     *    - map(transform) - SQL projection or post-query transform
     *    - Chainable operations accumulate before execution
     *
     * 3. Optimization:
     *    - Translate pipeline operations to SQL when possible
     *    - Batch database queries
     *    - Avoid N+1 queries through intelligent batching
     *
     * 4. Integration Points:
     *    - Wrap ThingsStore.list() with pipeline interface
     *    - Use query builder pattern for SQL generation
     *    - Support both eager and lazy loading strategies
     *
     * TESTS TO IMPLEMENT: 1 skipped test
     */
    it('should support lazy evaluation with chaining', async () => {
      const store = createThingsStore()

      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Customer', name: 'Bob' })
      await store.create({ $type: 'Customer', name: 'Charlie' })

      // Use AI integration layer's createPipeline function
      const pipeline = createPipeline(store, 'Customer')

      // Should support chaining without immediate execution
      const filtered = await pipeline.filter((c: Thing) => (c.name as string).startsWith('A'))

      expect(filtered).toEqual([expect.objectContaining({ name: 'Alice' })])
    })
  })

  describe('Schema Parsing Integration', () => {
    it('should parse ai-database style schema to field definitions', () => {
      // Test schema parsing logic
      const parseField = (field: string): { type: string; optional: boolean; isArray: boolean } => {
        const isArray = field.startsWith('[') && field.endsWith(']')
        let baseField = isArray ? field.slice(1, -1) : field
        const optional = baseField.endsWith('?')
        if (optional) baseField = baseField.slice(0, -1)

        // Handle relationship syntax: Type.backref
        const type = baseField.includes('.') ? baseField.split('.')[0] : baseField

        return { type, optional, isArray }
      }

      // Test cases
      expect(parseField('string')).toEqual({ type: 'string', optional: false, isArray: false })
      expect(parseField('string?')).toEqual({ type: 'string', optional: true, isArray: false })
      expect(parseField('Company.customers')).toEqual({
        type: 'Company',
        optional: false,
        isArray: false,
      })
      expect(parseField('[string]')).toEqual({ type: 'string', optional: false, isArray: true })
    })

    it('should detect AI prompt fields', () => {
      const isPromptField = (fieldType: string): boolean => {
        // Prompt fields contain spaces, questions, or slashes
        return (
          fieldType.includes(' ') ||
          fieldType.includes('?') ||
          fieldType.includes('/') ||
          fieldType.includes('|')
        )
      }

      expect(isPromptField('string')).toBe(false)
      expect(isPromptField('Company.customers')).toBe(false)
      expect(isPromptField('a brief summary of the lead')).toBe(true)
      expect(isPromptField('short/medium/long description')).toBe(true)
    })
  })

  describe('Type Inference Integration', () => {
    it('should infer singular/plural forms from type names', () => {
      const inferForms = (
        typeName: string
      ): { singular: string; plural: string; slug: string; slugPlural: string } => {
        const singular = typeName.charAt(0).toLowerCase() + typeName.slice(1)
        // Simple pluralization (would use proper library in implementation)
        const plural = singular.endsWith('y')
          ? singular.slice(0, -1) + 'ies'
          : singular.endsWith('s')
            ? singular + 'es'
            : singular + 's'
        const slug = singular.toLowerCase()
        const slugPlural = plural.toLowerCase()

        return { singular, plural, slug, slugPlural }
      }

      expect(inferForms('Customer')).toEqual({
        singular: 'customer',
        plural: 'customers',
        slug: 'customer',
        slugPlural: 'customers',
      })

      expect(inferForms('Company')).toEqual({
        singular: 'company',
        plural: 'companies',
        slug: 'company',
        slugPlural: 'companies',
      })
    })
  })

  describe('Error Handling', () => {
    let doProvider: DigitalObjectsProvider
    let store: DigitalObjectsThingsStore

    beforeEach(async () => {
      doProvider = createMemoryProvider()

      await doProvider.defineNoun({
        name: 'Customer',
        schema: { name: { type: 'string', required: true } },
      })

      store = createDigitalObjectsAdapter(doProvider)
    })

    it('should throw for updates on non-existent entities', async () => {
      await expect(store.update('non-existent-id', { name: 'Test' })).rejects.toThrow()
    })

    it('should throw for undefined noun types', async () => {
      await expect(store.create({ $type: 'UndefinedType', name: 'Test' })).rejects.toThrow()
    })

    it('should throw for missing required fields with validation enabled', async () => {
      await expect(
        store.create({ $type: 'Customer' } as unknown as { $type: string; name: string }, {
          validate: true,
        })
      ).rejects.toThrow(/validation failed/i)
    })
  })
})
