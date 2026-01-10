import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * End-to-End Cascade Generation Tests
 *
 * These tests focus on the performance characteristics of cascade generation:
 * - Parallel generation where entity dependencies allow
 * - Caching of resolved entities to prevent duplicate work
 * - Batch relationship creation for efficiency
 * - Real-world schema scenarios with complex dependencies
 *
 * This is RED phase TDD - tests should FAIL until the full cascade
 * system is implemented in db/schema/index.ts
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
  type GenerationMetrics,
  type CascadeResult,
  type BatchOperation,
} from '../index'

// ============================================================================
// 1. Parallel Generation Tests
// ============================================================================

describe('Parallel Generation', () => {
  describe('Independent Sibling Generation', () => {
    it('generates independent siblings in parallel', async () => {
      const schema = DB({
        Startup: {
          ceo: '->Executive',
          cto: '->Executive',
          cfo: '->Executive',
        },
        Executive: {
          name: 'string',
          title: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startTime = performance.now()

      const startup = await engine.generate('Startup', {})

      const endTime = performance.now()
      const duration = endTime - startTime

      // All executives should be generated
      expect(startup.ceo).toBeDefined()
      expect(startup.cto).toBeDefined()
      expect(startup.cfo).toBeDefined()

      // Parallel generation should be faster than sequential
      // (In implementation, track if parallelism was actually used)
      const metrics = engine.getLastGenerationMetrics()
      expect(metrics.parallelBatches).toBeGreaterThanOrEqual(1)
    })

    it('tracks parallel vs sequential operations', async () => {
      const schema = DB({
        Company: {
          // These can be parallel (no dependencies between them)
          marketing: '->Department',
          engineering: '->Department',
          sales: '->Department',
        },
        Department: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const result = await engine.generateWithMetadata('Company', {})

      // Should report parallel generation opportunity
      expect(result.metrics.parallelizableFields).toContain('marketing')
      expect(result.metrics.parallelizableFields).toContain('engineering')
      expect(result.metrics.parallelizableFields).toContain('sales')
    })

    it('respects dependency order for sequential fields', async () => {
      const schema = DB({
        Startup: {
          // These have a dependency chain: model depends on idea
          idea: '<-Idea',
          model: '->LeanCanvas', // Should use idea context
        },
        Idea: {
          description: 'string',
        },
        LeanCanvas: {
          problem: '$parent.idea.description', // References parent's idea
          solution: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const result = await engine.generateWithMetadata('Startup', {})

      // model should be generated after idea (sequential)
      const generationOrder = result.metrics.generationOrder
      const ideaIndex = generationOrder.findIndex((e: string) => e.includes('Idea'))
      const modelIndex = generationOrder.findIndex((e: string) => e.includes('LeanCanvas'))

      expect(ideaIndex).toBeLessThan(modelIndex)
    })
  })

  describe('Parallel Array Generation', () => {
    it('generates array elements in parallel', async () => {
      const schema = DB({
        Team: {
          members: ['->Person', { minItems: 5 }],
        },
        Person: {
          name: 'string',
          bio: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const team = await engine.generate('Team', {})

      // All members should be generated
      expect(team.members.length).toBeGreaterThanOrEqual(5)

      // Array elements should be generated in parallel
      const metrics = engine.getLastGenerationMetrics()
      expect(metrics.arrayParallelGeneration).toBe(true)
    })

    it('limits parallel array generation to max concurrency', async () => {
      const schema = DB({
        Company: {
          employees: ['->Employee', { minItems: 100 }],
        },
        Employee: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        maxConcurrency: 10,
      })

      const company = await engine.generate('Company', {})

      // Should respect concurrency limit
      const metrics = engine.getLastGenerationMetrics()
      expect(metrics.maxConcurrentOperations).toBeLessThanOrEqual(10)
      expect(company.employees.length).toBeGreaterThanOrEqual(100)
    })
  })

  describe('Dependency Graph Analysis', () => {
    it('builds correct dependency graph for cascade', async () => {
      const schema = DB({
        A: {
          b: '->B',
          c: '->C',
        },
        B: {
          d: '->D',
        },
        C: {
          d: '~>D', // Might share D with B
        },
        D: {
          value: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const graph = engine.analyzeDependencies('A')

      expect(graph.nodes).toContain('A')
      expect(graph.nodes).toContain('B')
      expect(graph.nodes).toContain('C')
      expect(graph.nodes).toContain('D')

      expect(graph.edges).toContainEqual({ from: 'A', to: 'B' })
      expect(graph.edges).toContainEqual({ from: 'A', to: 'C' })
      expect(graph.edges).toContainEqual({ from: 'B', to: 'D' })
      expect(graph.edges).toContainEqual({ from: 'C', to: 'D' })

      // B and C can be parallel (both depend on A, not each other)
      expect(graph.parallelGroups).toContainEqual(['B', 'C'])
    })

    it('identifies topological generation order', async () => {
      const schema = DB({
        Root: {
          child1: '->Level1',
          child2: '->Level1',
        },
        Level1: {
          child: '->Level2',
        },
        Level2: {
          value: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const order = engine.getTopologicalOrder('Root')

      // Level2 must come before Level1, Level1 before Root
      const level2Index = order.indexOf('Level2')
      const level1Index = order.indexOf('Level1')
      const rootIndex = order.indexOf('Root')

      expect(level2Index).toBeLessThan(level1Index)
      expect(level1Index).toBeLessThan(rootIndex)
    })
  })
})

// ============================================================================
// 2. Entity Caching Tests
// ============================================================================

describe('Caching of Resolved Entities', () => {
  describe('Fuzzy Resolution Cache', () => {
    it('caches fuzzy-resolved entities within same generation', async () => {
      const schema = DB({
        Order: {
          customer: '~>Customer',
          billingAddress: '~>Customer', // Same customer
        },
        Customer: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // Pre-create customer
      const customer = await engine.generate('Customer', {
        name: 'Shared Customer',
      })

      // Both fields should resolve to same customer
      const order = await engine.generate('Order', {
        $context: 'Order for Shared Customer',
      })

      expect(order.customer.$id).toBe(order.billingAddress.$id)
      expect(order.customer.$id).toBe(customer.$id)

      // Should only have one fuzzy search (cached)
      const metrics = engine.getLastGenerationMetrics()
      expect(metrics.fuzzySearchCount).toBe(1)
    })

    it('uses session cache for repeated fuzzy searches', async () => {
      const schema = DB({
        Order: {
          customer: '~>Customer',
        },
        Customer: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Customer', { name: 'Cached Customer' })

      // Generate multiple orders for same customer
      await engine.generate('Order', { $context: 'For Cached Customer' })
      await engine.generate('Order', { $context: 'Another for Cached Customer' })
      await engine.generate('Order', { $context: 'Third for Cached Customer' })

      // Cache should prevent repeated searches
      const metrics = engine.getSessionMetrics()
      expect(metrics.totalFuzzySearches).toBeLessThanOrEqual(3)
      expect(metrics.cacheHits).toBeGreaterThan(0)
    })

    it('invalidates cache when new entities are created', async () => {
      const schema = DB({
        Order: {
          product: '~>Product',
        },
        Product: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // First search finds nothing, generates
      const order1 = await engine.generate('Order', {
        $context: 'Order for Widget',
      })
      const product1Id = order1.product.$id

      // Create a new, better matching product
      await engine.generate('Product', {
        name: 'Super Widget',
        $context: 'The perfect widget product',
      })

      // Clear cache
      engine.clearCache()

      // Next search should find new product
      const order2 = await engine.generate('Order', {
        $context: 'Order for Widget',
      })

      // Might find different product now (or same, depending on semantic similarity)
      // Key point: cache was invalidated
      expect(engine.getLastGenerationMetrics().cacheHits).toBe(0)
    })
  })

  describe('Entity Reference Cache', () => {
    it('caches generated entities for reuse', async () => {
      const schema = DB({
        Project: {
          lead: '->Person',
          reviewer: '->Person', // Different Person
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const project = await engine.generate('Project', {})

      // Each should be unique (no caching for forward generation)
      expect(project.lead.$id).not.toBe(project.reviewer.$id)
    })

    it('shares entities across cascade when using ~>', async () => {
      const schema = DB({
        Invoice: {
          customer: '~>Customer',
          shippingContact: '~>Customer', // Might be same
        },
        Customer: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const customer = await engine.generate('Customer', { name: 'Acme Corp' })

      const invoice = await engine.generate('Invoice', {
        $context: 'Invoice for Acme Corp shipping to Acme Corp',
      })

      // Both should resolve to same customer
      expect(invoice.customer.$id).toBe(customer.$id)
      expect(invoice.shippingContact.$id).toBe(customer.$id)
    })

    it('provides cache statistics', async () => {
      const schema = DB({
        Parent: {
          child1: '~>Child',
          child2: '~>Child',
          child3: '~>Child',
        },
        Child: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Child', { name: 'Shared Child' })
      await engine.generate('Parent', { $context: 'Parent with Shared Child' })

      const stats = engine.getCacheStats()

      expect(stats.entries).toBeGreaterThan(0)
      expect(stats.hits).toBeGreaterThan(0)
      expect(stats.hitRate).toBeGreaterThan(0)
    })
  })

  describe('Cross-Session Cache', () => {
    it('optionally persists cache across sessions', async () => {
      const schema = DB({
        Order: {
          customer: '~>Customer',
        },
        Customer: {
          name: 'string',
        },
      })

      const engine1 = new GenerationEngine(schema, {
        persistCache: true,
        cacheKey: 'test-cache',
      })

      await engine1.generate('Customer', { name: 'Persistent Customer' })
      await engine1.generate('Order', { $context: 'For Persistent Customer' })

      // New engine instance with same cache key
      const engine2 = new GenerationEngine(schema, {
        persistCache: true,
        cacheKey: 'test-cache',
      })

      const order = await engine2.generate('Order', {
        $context: 'Another for Persistent Customer',
      })

      // Should find customer from previous session
      const metrics = engine2.getLastGenerationMetrics()
      expect(metrics.cacheHits).toBeGreaterThan(0)
    })

    it('clears persistent cache on demand', async () => {
      const schema = DB({
        Item: { name: 'string' },
      })

      const engine = new GenerationEngine(schema, {
        persistCache: true,
        cacheKey: 'clearable-cache',
      })

      await engine.generate('Item', { name: 'Cached Item' })
      expect(engine.getCacheStats().entries).toBeGreaterThan(0)

      await engine.clearPersistentCache()

      expect(engine.getCacheStats().entries).toBe(0)
    })
  })
})

// ============================================================================
// 3. Batch Relationship Creation Tests
// ============================================================================

describe('Batch Relationship Creation', () => {
  describe('Batch Insert Operations', () => {
    it('batches relationship inserts for efficiency', async () => {
      const schema = DB({
        Team: {
          members: ['->Person', { minItems: 10 }],
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const team = await engine.generate('Team', {})

      // Relationships should be created in batch
      const metrics = engine.getLastGenerationMetrics()
      expect(metrics.relationshipBatches).toBeLessThan(metrics.relationshipsCreated)
      expect(metrics.relationshipsCreated).toBeGreaterThanOrEqual(10)
    })

    it('configures batch size', async () => {
      const schema = DB({
        Container: {
          items: ['->Item', { minItems: 100 }],
        },
        Item: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        relationshipBatchSize: 25,
      })

      await engine.generate('Container', {})

      const metrics = engine.getLastGenerationMetrics()
      // 100 items / 25 batch size = 4 batches minimum
      expect(metrics.relationshipBatches).toBeGreaterThanOrEqual(4)
    })

    it('handles batch failures gracefully', async () => {
      const schema = DB({
        Parent: {
          children: ['->Child', { minItems: 5 }],
        },
        Child: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // Simulate partial batch failure
      const originalBatchInsert = engine.batchInsertRelationships.bind(engine)
      let callCount = 0
      vi.spyOn(engine, 'batchInsertRelationships').mockImplementation(async (rels) => {
        callCount++
        if (callCount === 2) {
          throw new Error('Batch insert failed')
        }
        return originalBatchInsert(rels)
      })

      // Should retry failed batch
      const parent = await engine.generate('Parent', {})

      expect(parent.children.length).toBeGreaterThanOrEqual(5)
    })
  })

  describe('Transaction Handling', () => {
    it('wraps cascade in transaction', async () => {
      const schema = DB({
        Startup: {
          model: '->LeanCanvas',
          founder: '->Person',
        },
        LeanCanvas: { problem: 'string' },
        Person: { name: 'string' },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate('Startup', {})

      // All entities and relationships created atomically
      const metrics = engine.getLastGenerationMetrics()
      expect(metrics.transactionCount).toBe(1)
    })

    it('rolls back on failure', async () => {
      const schema = DB({
        Parent: {
          child1: '->Child',
          child2: '->FailingChild', // Will fail
        },
        Child: { name: 'string' },
        FailingChild: { value: 'string' },
      })

      const engine = new GenerationEngine(schema)

      // Make FailingChild generation fail
      vi.spyOn(engine, 'generateEntity').mockImplementation(async (type, seed) => {
        if (type === 'FailingChild') {
          throw new Error('Generation failed')
        }
        return { $id: 'test-id', $type: type, ...seed }
      })

      await expect(engine.generate('Parent', {})).rejects.toThrow()

      // Child1 should be rolled back
      const children = await engine.query('Child')
      expect(children.length).toBe(0)
    })

    it('supports nested transactions for complex cascades', async () => {
      const schema = DB({
        Company: {
          departments: ['->Department', { minItems: 3 }],
        },
        Department: {
          employees: ['->Employee', { minItems: 5 }],
        },
        Employee: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const company = await engine.generate('Company', {})

      // Nested transactions: Company -> Departments -> Employees
      const metrics = engine.getLastGenerationMetrics()
      expect(metrics.nestedTransactions).toBeGreaterThan(0)
    })
  })

  describe('Relationship Deduplication', () => {
    it('deduplicates identical relationships', async () => {
      const schema = DB({
        Document: {
          author: '~>Person',
          editor: '~>Person', // Might be same person
          reviewer: '~>Person', // Might be same person
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Person', { name: 'Multitasker' })

      const doc = await engine.generate('Document', {
        $context: 'Authored, edited, and reviewed by Multitasker',
      })

      // If all resolve to same person, relationships should be deduplicated
      if (
        doc.author.$id === doc.editor.$id &&
        doc.editor.$id === doc.reviewer.$id
      ) {
        const relationships = await engine.getRelationships(doc.$id)
        const personRels = relationships.filter((r) => r.to === doc.author.$id)
        // Should have 3 relationships with different verbs
        expect(personRels.length).toBe(3)
        const verbs = personRels.map((r) => r.verb)
        expect(verbs).toContain('author')
        expect(verbs).toContain('editor')
        expect(verbs).toContain('reviewer')
      }
    })
  })
})

// ============================================================================
// 4. Performance Metrics Tests
// ============================================================================

describe('Performance Metrics', () => {
  describe('Generation Timing', () => {
    it('tracks total generation time', async () => {
      const schema = DB({
        Startup: {
          model: '->LeanCanvas',
        },
        LeanCanvas: {
          problem: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Startup', {})

      const metrics = engine.getLastGenerationMetrics()

      expect(metrics.totalTimeMs).toBeGreaterThan(0)
      expect(metrics.startTime).toBeDefined()
      expect(metrics.endTime).toBeDefined()
    })

    it('tracks time per entity type', async () => {
      const schema = DB({
        Parent: {
          child1: '->Child1',
          child2: '->Child2',
        },
        Child1: { name: 'string' },
        Child2: { name: 'string' },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Parent', {})

      const metrics = engine.getLastGenerationMetrics()

      expect(metrics.timeByType.Parent).toBeGreaterThan(0)
      expect(metrics.timeByType.Child1).toBeGreaterThan(0)
      expect(metrics.timeByType.Child2).toBeGreaterThan(0)
    })

    it('tracks AI generation time separately', async () => {
      const schema = DB({
        Entity: {
          generatedField: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Entity', {})

      const metrics = engine.getLastGenerationMetrics()

      expect(metrics.aiGenerationTimeMs).toBeGreaterThan(0)
      expect(metrics.aiGenerationTimeMs).toBeLessThanOrEqual(metrics.totalTimeMs)
    })
  })

  describe('Entity and Relationship Counts', () => {
    it('counts generated entities', async () => {
      const schema = DB({
        Team: {
          lead: '->Person',
          members: ['->Person', { minItems: 5 }],
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Team', {})

      const metrics = engine.getLastGenerationMetrics()

      expect(metrics.entitiesGenerated).toBeGreaterThanOrEqual(7) // 1 Team + 1 Lead + 5 Members
      expect(metrics.entitiesByType.Team).toBe(1)
      expect(metrics.entitiesByType.Person).toBeGreaterThanOrEqual(6)
    })

    it('counts created relationships', async () => {
      const schema = DB({
        Startup: {
          model: '->LeanCanvas',
          founders: ['->Person', { minItems: 3 }],
        },
        LeanCanvas: { problem: 'string' },
        Person: { name: 'string' },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Startup', {})

      const metrics = engine.getLastGenerationMetrics()

      expect(metrics.relationshipsCreated).toBeGreaterThanOrEqual(4) // 1 model + 3 founders
    })
  })

  describe('Memory Usage', () => {
    it('tracks memory usage during generation', async () => {
      const schema = DB({
        Container: {
          items: ['->Item', { minItems: 100 }],
        },
        Item: {
          data: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Container', {})

      const metrics = engine.getLastGenerationMetrics()

      expect(metrics.memoryUsage).toBeDefined()
      expect(metrics.memoryUsage.heapUsed).toBeGreaterThan(0)
      expect(metrics.memoryUsage.peak).toBeGreaterThanOrEqual(metrics.memoryUsage.heapUsed)
    })

    it('warns on high memory usage', async () => {
      const schema = DB({
        Huge: {
          items: ['->LargeItem', { minItems: 1000 }],
        },
        LargeItem: {
          data: 'string',
          moreData: 'object',
        },
      })

      const onWarning = vi.fn()
      const engine = new GenerationEngine(schema, {
        onWarning,
        memoryWarningThresholdMb: 100,
      })

      await engine.generate('Huge', {})

      // Should have warned if memory exceeded threshold
      // (May or may not trigger depending on actual memory usage)
    })
  })
})

// ============================================================================
// 5. Real-World Scenario Tests
// ============================================================================

describe('Real-World Scenarios', () => {
  describe('Complete Startup Schema', () => {
    it('generates full startup ecosystem', async () => {
      const schema = DB({
        Startup: {
          name: 'string',
          pitch: 'A 30-second elevator pitch',
          idea: '<-Idea',
          customer: '~>ICP',
          founders: ['->Founder', { minItems: 1, maxItems: 4 }],
          model: '->LeanCanvas',
          roadmap: '->Roadmap',
        },
        Idea: {
          problem: 'The core problem being solved',
          solution: 'The proposed solution',
          uniqueInsight: 'What makes this unique',
        },
        ICP: {
          segment: 'string',
          painPoints: ['string'],
          goals: ['string'],
          demographics: 'object',
        },
        Founder: {
          name: 'string',
          role: 'CEO|CTO|COO|CFO|CPO',
          background: 'string',
          expertise: ['string'],
        },
        LeanCanvas: {
          problem: ['string', { minItems: 3 }],
          solution: ['string', { minItems: 3 }],
          uniqueValueProp: 'string',
          unfairAdvantage: 'string',
          customerSegments: ['string'],
          channels: ['string'],
          revenueStreams: ['string'],
          costStructure: ['string'],
          keyMetrics: ['string'],
        },
        Roadmap: {
          phases: ['->Phase', { minItems: 3 }],
        },
        Phase: {
          name: 'string',
          duration: 'string',
          goals: ['string'],
          milestones: ['->Milestone'],
        },
        Milestone: {
          title: 'string',
          criteria: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startup = await engine.generate('Startup', {
        name: 'AI-Powered Analytics',
        $context: 'B2B SaaS platform for data analytics',
      })

      // Verify complete generation
      expect(startup.name).toBe('AI-Powered Analytics')
      expect(startup.pitch).toBeDefined()
      expect(startup.idea).toBeDefined()
      expect(startup.customer).toBeDefined()
      expect(startup.founders.length).toBeGreaterThanOrEqual(1)
      expect(startup.model).toBeDefined()
      expect(startup.roadmap).toBeDefined()
      expect(startup.roadmap.phases.length).toBeGreaterThanOrEqual(3)

      // Verify deep nesting
      startup.roadmap.phases.forEach((phase: any) => {
        expect(phase.milestones).toBeDefined()
        expect(phase.milestones.length).toBeGreaterThan(0)
      })
    })

    it('tracks all entities in generation result', async () => {
      const schema = DB({
        Startup: {
          model: '->LeanCanvas',
          team: ['->Person', { minItems: 3 }],
        },
        LeanCanvas: { problem: 'string' },
        Person: { name: 'string' },
      })

      const engine = new GenerationEngine(schema)
      const result = await engine.generateWithMetadata('Startup', {
        name: 'Tracking Test',
      })

      // All generated entities accessible
      expect(result.generated.length).toBeGreaterThanOrEqual(5) // 1 Startup + 1 LeanCanvas + 3 Persons
      expect(result.relationships.length).toBeGreaterThanOrEqual(4) // 1 model + 3 team members
    })
  })

  describe('E-commerce Product Catalog', () => {
    it('generates product with variants and categories', async () => {
      const schema = DB({
        Product: {
          name: 'string',
          description: 'string',
          category: '~>Category',
          variants: ['->Variant', { minItems: 2 }],
          images: ['->ProductImage'],
        },
        Category: {
          name: 'string',
          parent: '~>Category?', // Optional parent
        },
        Variant: {
          sku: 'string',
          price: 'number',
          attributes: 'object',
        },
        ProductImage: {
          url: 'string',
          alt: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // Pre-create category hierarchy
      const electronics = await engine.generate('Category', { name: 'Electronics' })
      await engine.generate('Category', { name: 'Phones', parent: electronics })

      const product = await engine.generate('Product', {
        name: 'Smartphone X',
        $context: 'A high-end smartphone in the phones category',
      })

      expect(product.category).toBeDefined()
      expect(product.variants.length).toBeGreaterThanOrEqual(2)
      expect(product.images).toBeDefined()
    })
  })

  describe('Content Management System', () => {
    it('generates article with authors and tags', async () => {
      const schema = DB({
        Article: {
          title: 'string',
          content: 'string',
          author: '~>Author',
          coAuthors: ['~>Author'],
          tags: ['~>Tag'],
          comments: ['<-Comment'], // Comments link TO article
        },
        Author: {
          name: 'string',
          bio: 'string',
        },
        Tag: {
          name: 'string',
        },
        Comment: {
          text: 'string',
          author: '~>Author',
        },
      })

      const engine = new GenerationEngine(schema)

      // Create some reusable entities
      await engine.generate('Author', { name: 'Jane Doe' })
      await engine.generate('Tag', { name: 'Technology' })
      await engine.generate('Tag', { name: 'AI' })

      const article = await engine.generate('Article', {
        title: 'The Future of AI',
        $context: 'Article about AI technology by Jane Doe',
      })

      expect(article.author).toBeDefined()
      expect(article.tags.length).toBeGreaterThan(0)
    })
  })

  describe('Organizational Hierarchy', () => {
    it('generates company with departments and employees', async () => {
      const schema = DB({
        Company: {
          name: 'string',
          ceo: '->Executive',
          departments: ['->Department', { minItems: 3 }],
        },
        Executive: {
          name: 'string',
          title: 'string',
        },
        Department: {
          name: 'string',
          head: '->Employee',
          employees: ['->Employee', { minItems: 5 }],
        },
        Employee: {
          name: 'string',
          role: 'string',
          email: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const company = await engine.generate('Company', {
        name: 'Tech Corp',
      })

      expect(company.ceo).toBeDefined()
      expect(company.departments.length).toBeGreaterThanOrEqual(3)

      company.departments.forEach((dept: any) => {
        expect(dept.head).toBeDefined()
        expect(dept.employees.length).toBeGreaterThanOrEqual(5)
      })

      // Count total employees
      const metrics = engine.getLastGenerationMetrics()
      expect(metrics.entitiesByType.Employee).toBeGreaterThanOrEqual(18) // 3 heads + 15 employees
    })
  })
})

// ============================================================================
// 6. Edge Cases and Stress Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Empty and Optional Fields', () => {
    it('handles optional cascade fields', async () => {
      const schema = DB({
        Entity: {
          required: '->Child',
          optional: '->Child?', // Optional
        },
        Child: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const entity = await engine.generate('Entity', {})

      expect(entity.required).toBeDefined()
      // Optional might or might not be generated
      expect(entity.optional === undefined || entity.optional.$type === 'Child').toBe(true)
    })

    it('handles empty array cascades', async () => {
      const schema = DB({
        Container: {
          items: ['->Item', { minItems: 0 }],
        },
        Item: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const container = await engine.generate('Container', {
        $context: 'Empty container with no items',
      })

      // Could be empty or have items
      expect(Array.isArray(container.items)).toBe(true)
    })
  })

  describe('Deep Nesting', () => {
    it('handles deeply nested cascades', async () => {
      const schema = DB({
        Level1: { child: '->Level2' },
        Level2: { child: '->Level3' },
        Level3: { child: '->Level4' },
        Level4: { child: '->Level5' },
        Level5: { value: 'string' },
      })

      const engine = new GenerationEngine(schema)
      const result = await engine.generate('Level1', {})

      expect(result.child.child.child.child.value).toBeDefined()
    })

    it('respects max depth limit', async () => {
      const schema = DB({
        Node: {
          child: '->Node', // Self-referential
          value: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        maxDepth: 3,
      })

      const result = await engine.generate('Node', {})

      // Should stop at depth 3
      let depth = 0
      let current = result
      while (current.child) {
        depth++
        current = current.child
      }
      expect(depth).toBeLessThanOrEqual(3)
    })
  })

  describe('Large Cascades', () => {
    it('handles large array generation', async () => {
      const schema = DB({
        Container: {
          items: ['->Item', { minItems: 500 }],
        },
        Item: {
          id: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        maxConcurrency: 50,
      })

      const container = await engine.generate('Container', {})

      expect(container.items.length).toBeGreaterThanOrEqual(500)
    }, 60000) // 60 second timeout

    it('handles wide cascades efficiently', async () => {
      const schema = DB({
        Root: {
          a: '->Child',
          b: '->Child',
          c: '->Child',
          d: '->Child',
          e: '->Child',
          f: '->Child',
          g: '->Child',
          h: '->Child',
          i: '->Child',
          j: '->Child',
        },
        Child: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const startTime = performance.now()
      const result = await engine.generate('Root', {})
      const duration = performance.now() - startTime

      // All fields populated
      expect(result.a).toBeDefined()
      expect(result.j).toBeDefined()

      // Should be reasonably fast with parallel generation
      expect(duration).toBeLessThan(30000) // 30 seconds max
    })
  })
})

// ============================================================================
// 7. Configuration and Options Tests
// ============================================================================

describe('Engine Configuration', () => {
  it('accepts generation options', async () => {
    const schema = DB({
      Entity: { name: 'string' },
    })

    const engine = new GenerationEngine(schema, {
      maxConcurrency: 5,
      batchSize: 10,
      timeout: 30000,
      retryCount: 3,
      model: 'claude-3-sonnet',
    })

    expect(engine.options.maxConcurrency).toBe(5)
    expect(engine.options.batchSize).toBe(10)
    expect(engine.options.timeout).toBe(30000)
  })

  it('supports per-generation options', async () => {
    const schema = DB({
      Entity: { name: 'string' },
    })

    const engine = new GenerationEngine(schema)
    const result = await engine.generate('Entity', {}, {
      model: 'claude-3-opus',
      temperature: 0.7,
    })

    expect(result).toBeDefined()
  })

  it('supports custom ID generator', async () => {
    const schema = DB({
      Entity: { name: 'string' },
    })

    let idCounter = 0
    const engine = new GenerationEngine(schema, {
      generateId: (type) => `${type.toLowerCase()}-${++idCounter}`,
    })

    const e1 = await engine.generate('Entity', {})
    const e2 = await engine.generate('Entity', {})

    expect(e1.$id).toBe('entity-1')
    expect(e2.$id).toBe('entity-2')
  })

  it('supports custom relationship verb generator', async () => {
    const schema = DB({
      Parent: {
        myChild: '->Child',
      },
      Child: {
        name: 'string',
      },
    })

    const engine = new GenerationEngine(schema, {
      generateVerb: (field, direction) => {
        if (direction === 'forward') return `has_${field}`
        return `belongs_to_${field}`
      },
    })

    const parent = await engine.generate('Parent', {})
    const relationships = await engine.getRelationships(parent.$id)

    expect(relationships[0].verb).toBe('has_myChild')
  })
})
