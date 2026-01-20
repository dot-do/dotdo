/**
 * ai-database Integration Tests for @dotdo/db
 *
 * TDD tests verifying @dotdo/db integrates with ai-database for AI-powered operations.
 * These tests define the expected integration points and behaviors.
 *
 * Key integration areas:
 * 1. DB Factory - Using ai-database's DB() factory with @dotdo/db storage
 * 2. Schema-First Definition - ai-database schema compatible with @dotdo/db Things
 * 3. Natural Language Queries - db.Entity`query` syntax
 * 4. AI Generation - Cascade generation and draft/resolve patterns
 * 5. Events/Actions/Artifacts APIs - Event sourcing integration
 * 6. Promise Pipelining - Lazy evaluation with batch loading
 * 7. Semantic Search - Vector-based similarity search
 *
 * NOTE: These are TDD tests - they define the expected integration API.
 * Tests are expected to FAIL until the integration is implemented.
 *
 * @module db/tests/ai-database-integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import from ai-database package (primitives submodule)
// These use relative paths matching the existing digital-objects.test.ts pattern
import {
  DB,
  createDigitalObjectsProvider,
  setNLQueryGenerator,
  configureAIGeneration,
  setValueGenerator,
  MemoryProvider,
  createMemoryProvider as createAIMemoryProvider,
  type DatabaseSchema,
  type NLQueryGenerator,
} from '../../primitives/packages/ai-database/src/index.js'

// Import ValueGenerator type from the value-generators module
import type { ValueGenerator } from '../../primitives/packages/ai-database/src/schema/value-generators/types.js'

// Import @dotdo/db components
import { createThingsStore, type ThingsStore, type Thing } from '../things'
import { createDigitalObjectsAdapter, type DigitalObjectsThingsStore } from '../digital-objects'

// Import from digital-objects package (primitives submodule)
import { createMemoryProvider } from '../../primitives/packages/digital-objects/src/memory-provider.js'
import type { DigitalObjectsProvider } from '../../primitives/packages/digital-objects/src/types.js'

/**
 * Test Schema Definition
 * Matches both ai-database DatabaseSchema and can map to @dotdo/db Things
 */
const TestSchema = {
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
} satisfies DatabaseSchema

describe('ai-database Integration', () => {
  describe('DB Factory with @dotdo/db Storage', () => {
    it('should create a typed DB using digital-objects provider', async () => {
      // ai-database's createDigitalObjectsProvider creates a DBProvider
      // backed by digital-objects storage
      const provider = createDigitalObjectsProvider()

      const { db } = DB(TestSchema, { provider })

      expect(db).toBeDefined()
      expect(db.Customer).toBeDefined()
      expect(db.Company).toBeDefined()
      expect(db.Lead).toBeDefined()
    })

    it('should expose $schema with parsed entity information', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      expect(db.$schema).toBeDefined()
      expect(db.$schema.entities).toBeDefined()
      expect(db.$schema.entities.has('Customer')).toBe(true)
      expect(db.$schema.entities.has('Company')).toBe(true)
    })

    it('should support both db.Entity access patterns', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // Direct property access
      expect(typeof db.Customer).toBe('function') // Callable for NL queries

      // Method access
      expect(typeof db.Customer.get).toBe('function')
      expect(typeof db.Customer.list).toBe('function')
      expect(typeof db.Customer.create).toBe('function')
    })
  })

  describe('CRUD Operations Bridge', () => {
    it('should create entities with ai-database and retrieve via @dotdo/db pattern', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // Create via ai-database
      const customer = await db.Customer.create({
        name: 'Alice Smith',
        email: 'alice@example.com',
      })

      expect(customer.$id).toBeDefined()
      expect(customer.$type).toBe('Customer')
      expect(customer.name).toBe('Alice Smith')

      // Retrieve
      const retrieved = await db.Customer.get(customer.$id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.name).toBe('Alice Smith')
    })

    it('should list entities with filtering', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      await db.Customer.create({ name: 'Alice' })
      await db.Customer.create({ name: 'Bob' })
      await db.Customer.create({ name: 'Charlie' })

      const all = await db.Customer.list()
      expect(all.length).toBe(3)

      const filtered = await db.Customer.find({ name: 'Bob' })
      expect(filtered.length).toBe(1)
      expect(filtered[0].name).toBe('Bob')
    })

    it('should update entities', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      const customer = await db.Customer.create({ name: 'Alice' })
      const updated = await db.Customer.update(customer.$id, { name: 'Alicia' })

      expect(updated.name).toBe('Alicia')
    })

    it('should delete entities', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      const customer = await db.Customer.create({ name: 'Alice' })
      await db.Customer.delete(customer.$id)

      const retrieved = await db.Customer.get(customer.$id)
      expect(retrieved).toBeNull()
    })

    it('should handle upsert operations', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // First upsert creates
      const created = await db.Customer.upsert('customer-1', { name: 'Alice' })
      expect(created.name).toBe('Alice')

      // Second upsert updates
      const updated = await db.Customer.upsert('customer-1', { name: 'Alicia', email: 'a@x.com' })
      expect(updated.name).toBe('Alicia')
      expect(updated.email).toBe('a@x.com')
    })
  })

  describe('Relationship Handling', () => {
    it('should resolve forward relationships (Company.customers -> Customer[])', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      const company = await db.Company.create({ name: 'Acme Corp' })
      await db.Customer.create({ name: 'Alice', company: company.$id })
      await db.Customer.create({ name: 'Bob', company: company.$id })

      // Get company with customers resolved
      const companyWithCustomers = await db.Company.get(company.$id)
      expect(companyWithCustomers).toBeDefined()

      // List customers for this company via related()
      const customers = await provider.related('Customer', company.$id, 'company')
      expect(customers.length).toBe(2)
    })

    it('should create related entities using cascade option', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // Mock value generator for cascade
      const mockGenerator: ValueGenerator = {
        generate: vi.fn().mockResolvedValue('Generated Name'),
        generateSync: vi.fn().mockReturnValue('Generated Name'),
      }
      setValueGenerator(mockGenerator)

      const company = await db.Company.create({ name: 'Acme Corp' })

      // Create customer with cascade to generate related entities
      const customer = await db.Customer.create(
        { name: 'Alice', company: company.$id },
        { cascade: true, maxDepth: 2 }
      )

      expect(customer.company).toBe(company.$id)
    })
  })

  describe('Natural Language Queries', () => {
    it('should support tagged template literal queries', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      await db.Customer.create({ name: 'Alice Smith', email: 'alice@acme.com' })
      await db.Customer.create({ name: 'Bob Jones', email: 'bob@acme.com' })

      // NL query via tagged template literal
      const result = await db.Customer`show all customers`

      expect(result).toBeDefined()
      expect(result.results).toBeDefined()
      expect(result.interpretation).toBeDefined()
    })

    it('should support NL queries with interpolated values', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      await db.Customer.create({ name: 'Alice Smith' })

      const searchName = 'Alice'
      const result = await db.Customer`find customers named ${searchName}`

      expect(result.results).toBeDefined()
    })

    it('should use configured NL query generator', async () => {
      const mockGenerator: NLQueryGenerator = vi.fn().mockResolvedValue({
        types: ['Customer'],
        filters: { name: { $contains: 'Alice' } },
        interpretation: 'Finding customers named Alice',
        confidence: 0.9,
      })

      setNLQueryGenerator(mockGenerator)

      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      await db.Customer.create({ name: 'Alice Smith' })

      const result = await db.Customer`find Alice`

      expect(mockGenerator).toHaveBeenCalled()
      expect(result.interpretation).toBe('Finding customers named Alice')
      expect(result.confidence).toBe(0.9)
    })

    it('should support global db.ask() for cross-entity queries', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      await db.Customer.create({ name: 'Alice' })
      await db.Company.create({ name: 'Acme Corp' })

      const result = await db.ask`show everything`

      expect(result.results).toBeDefined()
      // Should include both customers and companies
    })
  })

  describe('AI Generation (Draft/Resolve)', () => {
    it('should create draft entities with unresolved references', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // Draft with natural language reference
      const draft = await db.Lead.draft({
        name: 'John Doe',
        customer: 'the CEO of Acme Corp',
      })

      expect(draft.$phase).toBe('draft')
      expect(draft.$refs).toBeDefined()
      expect(draft.$refs?.customer).toBe('the CEO of Acme Corp')
    })

    it('should resolve draft references to entity IDs', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // Create target entity first
      const company = await db.Company.create({ name: 'Acme Corp' })
      const customer = await db.Customer.create({
        name: 'Alice CEO',
        company: company.$id,
      })

      // Create draft with reference
      const draft = await db.Lead.draft({
        name: 'John Doe',
        customer: 'Alice at Acme',
      })

      // Resolve draft
      const resolved = await db.Lead.resolve(draft)

      expect(resolved.$phase).toBe('resolved')
      // customer should now be an actual ID (if fuzzy matching worked)
    })

    it('should generate AI-powered field values using prompt fields', async () => {
      const mockGenerator: ValueGenerator = {
        generate: vi.fn().mockResolvedValue('AI generated summary of the lead'),
        generateSync: vi.fn().mockReturnValue('Sync generated summary'),
      }
      setValueGenerator(mockGenerator)

      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // Create lead - 'notes' field has a prompt definition
      const lead = await db.Lead.create({
        name: 'Enterprise Prospect',
        score: 85,
      })

      // The notes field should have been generated
      expect(mockGenerator.generate).toHaveBeenCalled()
      expect(lead.notes).toBeDefined()
    })

    it('should support cascade generation of related entities', async () => {
      const mockGenerator: ValueGenerator = {
        generate: vi.fn().mockResolvedValue('Generated Value'),
        generateSync: vi.fn().mockReturnValue('Generated Value'),
      }
      setValueGenerator(mockGenerator)

      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // Create blog post with cascade - should generate author if not provided
      const post = await db.BlogPost.create(
        {
          title: 'Getting Started with AI',
          content: '# Introduction\n\nThis is a guide...',
        },
        { cascade: true, maxDepth: 2 }
      )

      expect(post.title).toBe('Getting Started with AI')
      // Author may have been auto-generated via cascade
    })
  })

  describe('Events API Integration', () => {
    it('should emit events on entity creation', async () => {
      const provider = createDigitalObjectsProvider()
      const { db, events } = DB(TestSchema, { provider })

      const eventHandler = vi.fn()
      events.on('Customer.created', eventHandler)

      await db.Customer.create({ name: 'Alice' })

      // Event should have been emitted
      expect(eventHandler).toHaveBeenCalled()
    })

    it('should support custom event emission', async () => {
      const provider = createDigitalObjectsProvider()
      const { events } = DB(TestSchema, { provider })

      const event = await events.emit({
        actor: 'user:123',
        event: 'Customer.signup',
        object: 'customer:456',
        objectData: { plan: 'enterprise' },
      })

      expect(event.id).toBeDefined()
      expect(event.event).toBe('Customer.signup')
    })

    it('should list events with filtering', async () => {
      const provider = createDigitalObjectsProvider()
      const { events } = DB(TestSchema, { provider })

      await events.emit('test.event1', { data: 1 })
      await events.emit('test.event2', { data: 2 })

      const allEvents = await events.list({})
      expect(allEvents.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Actions API Integration', () => {
    it('should create durable actions for long-running operations', async () => {
      const provider = createDigitalObjectsProvider()
      const { actions } = DB(TestSchema, { provider })

      const action = await actions.create({
        type: 'import-customers',
        data: { source: 'csv', file: 'customers.csv' },
        total: 100,
      })

      expect(action.id).toBeDefined()
      expect(action.status).toBe('pending')
    })

    it('should track action progress', async () => {
      const provider = createDigitalObjectsProvider()
      const { actions } = DB(TestSchema, { provider })

      const action = await actions.create({
        type: 'batch-update',
        data: {},
        total: 50,
      })

      await actions.update(action.id, { status: 'running', progress: 25 })

      const updated = await actions.get(action.id)
      expect(updated?.status).toBe('running')
      expect(updated?.progress).toBe(25)
    })

    it('should support action retry and cancellation', async () => {
      const provider = createDigitalObjectsProvider()
      const { actions } = DB(TestSchema, { provider })

      const action = await actions.create({
        type: 'sync-data',
        data: {},
      })

      // Simulate failure
      await actions.update(action.id, { status: 'failed', error: 'Connection timeout' })

      // Retry
      const retried = await actions.retry(action.id)
      expect(retried.status).toBe('pending')

      // Or cancel
      await actions.cancel(retried.id)
      const cancelled = await actions.get(retried.id)
      expect(cancelled?.status).toBe('cancelled')
    })
  })

  describe('Promise Pipelining', () => {
    it('should support lazy evaluation with .then() chaining', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      await db.Customer.create({ name: 'Alice' })
      await db.Customer.create({ name: 'Bob' })

      // Chain operations without immediate await
      const pipeline = db.Customer.list()
        .filter((c: { name: string }) => c.name.startsWith('A'))
        .map((c: { name: string }) => c.name)

      // Only executes when awaited
      const names = await pipeline
      expect(names).toEqual(['Alice'])
    })

    it('should batch relationship loading', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      const company = await db.Company.create({ name: 'Acme' })
      await db.Customer.create({ name: 'Alice', company: company.$id })
      await db.Customer.create({ name: 'Bob', company: company.$id })

      // Accessing .company on multiple customers should batch load
      const customers = await db.Customer.list()

      // Company references should be resolvable
      expect(customers[0].company).toBe(company.$id)
    })

    it('should support forEach with concurrency control', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      await db.Customer.create({ name: 'Alice' })
      await db.Customer.create({ name: 'Bob' })
      await db.Customer.create({ name: 'Charlie' })

      const processed: string[] = []

      await db.Customer.forEach(
        (customer) => {
          processed.push(customer.name)
        },
        { concurrency: 2 }
      )

      expect(processed).toHaveLength(3)
    })
  })

  describe('Semantic Search Integration', () => {
    it('should support semantic search when embeddings are configured', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, {
        provider,
        embeddings: {
          fields: ['content', 'title'],
          dimensions: 1536,
        },
      })

      await db.BlogPost.create({
        title: 'Introduction to Machine Learning',
        content: 'This article covers the basics of ML...',
        tags: ['ai', 'tutorial'],
      })

      await db.BlogPost.create({
        title: 'Cooking Italian Pasta',
        content: 'A guide to making authentic pasta...',
        tags: ['cooking', 'recipe'],
      })

      // Semantic search should find related content
      const results = await db.BlogPost.semanticSearch('artificial intelligence concepts')

      expect(results).toBeDefined()
      // ML article should rank higher than cooking article
      if (results.length > 0) {
        expect(results[0].$score).toBeDefined()
      }
    })

    it('should support hybrid search combining FTS and semantic', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, {
        provider,
        embeddings: {
          fields: ['content'],
          dimensions: 1536,
        },
      })

      await db.BlogPost.create({
        title: 'React Best Practices',
        content: 'Advanced patterns for React development...',
        tags: ['react', 'frontend'],
      })

      const results = await db.BlogPost.hybridSearch('react patterns', {
        semanticWeight: 0.7,
        ftsWeight: 0.3,
      })

      expect(results).toBeDefined()
      if (results.length > 0) {
        expect(results[0].$rrfScore).toBeDefined()
      }
    })
  })

  describe('Nouns and Verbs API', () => {
    it('should expose noun definitions from schema', async () => {
      const provider = createDigitalObjectsProvider()
      const { nouns } = DB(TestSchema, { provider })

      const customerNoun = await nouns.get('Customer')

      expect(customerNoun).toBeDefined()
      expect(customerNoun?.singular).toBe('customer')
      expect(customerNoun?.plural).toBe('customers')
    })

    it('should list all nouns', async () => {
      const provider = createDigitalObjectsProvider()
      const { nouns } = DB(TestSchema, { provider })

      const allNouns = await nouns.list()

      expect(allNouns.length).toBeGreaterThanOrEqual(4) // Customer, Company, Lead, BlogPost
      expect(allNouns.some((n) => n.singular === 'customer')).toBe(true)
    })

    it('should support verb conjugation', async () => {
      const provider = createDigitalObjectsProvider()
      const { verbs } = DB(TestSchema, { provider })

      const result = verbs.conjugate('create')

      expect(result).toBeDefined()
      expect(result.present).toBe('create')
      expect(result.past).toBe('created')
      expect(result.progressive).toBe('creating')
    })
  })

  describe('@dotdo/db ThingsStore Adapter', () => {
    it('should adapt ai-database operations to ThingsStore interface', async () => {
      // Create digital-objects provider
      const doProvider = createMemoryProvider()

      // Define nouns
      await doProvider.defineNoun({
        name: 'Customer',
        description: 'A customer entity',
        schema: {
          name: { type: 'string', required: true },
          email: 'string?',
        },
      })

      // Create adapter
      const store: DigitalObjectsThingsStore = createDigitalObjectsAdapter(doProvider)

      // Should behave like ThingsStore
      const customer = await store.create({ $type: 'Customer', name: 'Alice' })

      expect(customer.$id).toBeDefined()
      expect(customer.$type).toBe('Customer')
      expect(customer.name).toBe('Alice')

      // Get
      const retrieved = await store.get(customer.$id)
      expect(retrieved?.name).toBe('Alice')

      // List
      const list = await store.list({ type: 'Customer' })
      expect(list.length).toBe(1)
    })

    it('should expose noun definitions via adapter', async () => {
      const doProvider = createMemoryProvider()

      await doProvider.defineNoun({
        name: 'Order',
        description: 'An order',
        schema: { total: 'number' },
      })

      const store = createDigitalObjectsAdapter(doProvider)

      const noun = await store.getNoun('Order')
      expect(noun).toBeDefined()
      expect(noun?.name).toBe('Order')

      const allNouns = await store.listNouns()
      expect(allNouns.some((n) => n.name === 'Order')).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should throw EntityNotFoundError for missing entities', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      await expect(db.Customer.update('non-existent', { name: 'Test' })).rejects.toThrow()
    })

    it('should handle validation errors from ai-database schema', async () => {
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // Lead.score should be a number
      await expect(
        db.Lead.create({
          name: 'Test Lead',
          score: 'not-a-number' as unknown as number,
        })
      ).rejects.toThrow()
    })

    it('should propagate AI generation errors', async () => {
      const failingGenerator: ValueGenerator = {
        generate: vi.fn().mockRejectedValue(new Error('AI service unavailable')),
        generateSync: vi.fn().mockImplementation(() => {
          throw new Error('AI service unavailable')
        }),
      }
      setValueGenerator(failingGenerator)

      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      // Should handle the error gracefully or propagate it
      await expect(
        db.Lead.create({ name: 'Test' }, { cascade: true })
      ).rejects.toThrow('AI service unavailable')
    })
  })

  describe('Configuration Integration', () => {
    it('should support AI generation configuration', () => {
      configureAIGeneration({
        model: 'gpt-4',
        enabled: true,
      })

      // Configuration should persist
      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider })

      expect(db).toBeDefined()
    })

    it('should support custom value generator injection', async () => {
      const customGenerator: ValueGenerator = {
        generate: vi.fn().mockResolvedValue('Custom generated value'),
        generateSync: vi.fn().mockReturnValue('Custom sync value'),
      }

      setValueGenerator(customGenerator)

      const provider = createDigitalObjectsProvider()
      const { db } = DB(TestSchema, { provider, valueGenerator: customGenerator })

      expect(db).toBeDefined()
    })
  })
})
