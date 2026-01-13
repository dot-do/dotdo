import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * [RED] E2E Cascade Integration Tests: Startup -> Million Entities
 *
 * These tests demonstrate the massive scale-out cascade generation that is
 * the core value proposition of dotdo's architecture. The schema IS the workflow.
 *
 * The Startup Builder cascade pattern:
 * Task -> Problem -> Solution -> HeadlessSaaS -> ICP -> Startup -> Ad -> BlindTest -> Experiment
 *
 * Scale targets from epic design:
 * - ~20 industries x ~1,000 occupations x ~20,000 tasks = 400,000,000 task instances
 * - 3 problems x 2 solutions = 240,000 product ideas
 * - 3 ICPs x 5 startups = 3,600,000 testable hypotheses
 *
 * This is RED phase TDD - tests should FAIL until the full cascade
 * system is implemented. The imports reference types that don't exist yet.
 *
 * Test coverage:
 * - Full Startup Builder cascade (sb pattern)
 * - Parallel generation across DOs
 * - Dependency graph analysis
 * - Performance metrics tracking
 * - Cache effectiveness at scale
 */

// ============================================================================
// Imports from non-existent module - WILL FAIL until implemented
// ============================================================================

// @ts-expect-error - Module not yet implemented
import {
  DB,
  GenerationEngine,
  CascadeOrchestrator,
  type ParsedSchema,
  type Entity,
  type CascadeMetrics,
  type CascadeResult,
  type DependencyGraph,
  type ParallelBatch,
  type ScaleOutConfig,
} from '../index'

// ============================================================================
// Type Definitions (Expected Schema Entities)
// ============================================================================

interface IndustryEntity {
  $id: string
  $type: 'Industry'
  name: string
  sector: string
  description: string
  occupations: OccupationEntity[]
}

interface OccupationEntity {
  $id: string
  $type: 'Occupation'
  title: string
  description: string
  skills: string[]
  tasks: TaskEntity[]
}

interface TaskEntity {
  $id: string
  $type: 'Task'
  name: string
  description: string
  frequency: string
  painLevel: number
  problems: ProblemEntity[]
}

interface ProblemEntity {
  $id: string
  $type: 'Problem'
  statement: string
  severity: number
  frequency: string
  currentSolutions: string[]
  solutions: SolutionEntity[]
}

interface SolutionEntity {
  $id: string
  $type: 'Solution'
  description: string
  approach: string
  differentiator: string
  headlessSaaS: HeadlessSaaSEntity
}

interface HeadlessSaaSEntity {
  $id: string
  $type: 'HeadlessSaaS'
  name: string
  api: string
  features: string[]
  icps: ICPEntity[]
}

interface ICPEntity {
  $id: string
  $type: 'ICP'
  segment: string
  painPoints: string[]
  demographics: Record<string, unknown>
  budget: string
  startups: StartupEntity[]
}

interface StartupEntity {
  $id: string
  $type: 'Startup'
  name: string
  pitch: string
  model: LeanCanvasEntity
  ads: AdEntity[]
}

interface LeanCanvasEntity {
  $id: string
  $type: 'LeanCanvas'
  problem: string[]
  solution: string[]
  uniqueValueProp: string
  channels: string[]
  revenueStreams: string[]
}

interface AdEntity {
  $id: string
  $type: 'Ad'
  headline: string
  copy: string
  cta: string
  targetAudience: string
  blindTests: BlindTestEntity[]
}

interface BlindTestEntity {
  $id: string
  $type: 'BlindTest'
  variants: string[]
  metrics: string[]
  experiments: ExperimentEntity[]
}

interface ExperimentEntity {
  $id: string
  $type: 'Experiment'
  hypothesis: string
  methodology: string
  successCriteria: string
  status: 'pending' | 'running' | 'completed'
}

// ============================================================================
// Cascade Metrics Interface
// ============================================================================

interface ScaleCascadeMetrics extends CascadeMetrics {
  totalEntitiesGenerated: number
  entitiesByType: Record<string, number>
  totalRelationshipsCreated: number
  parallelBatchCount: number
  cacheHits: number
  cacheMisses: number
  averageEntityGenerationMs: number
  averageRelationshipCreationMs: number
  peakConcurrency: number
  memoryUsageMb: number
  totalDurationMs: number
}

// ============================================================================
// 1. Full Startup Builder Schema Definition
// ============================================================================

describe('Startup Builder Cascade Schema', () => {
  describe('Schema Definition', () => {
    it('defines the full cascade schema from Industry to Experiment', () => {
      const schema = DB({
        Industry: {
          name: 'string',
          sector: 'string',
          description: 'A brief description of this industry',
          occupations: ['->Occupation', { minItems: 3, maxItems: 10 }],
        },
        Occupation: {
          title: 'string',
          description: 'What this occupation does',
          skills: ['string', { minItems: 3 }],
          tasks: ['->Task', { minItems: 5, maxItems: 20 }],
        },
        Task: {
          name: 'string',
          description: 'The task description',
          frequency: 'daily|weekly|monthly|quarterly|yearly',
          painLevel: 'number', // 1-10
          problems: ['->Problem', { minItems: 1, maxItems: 3 }],
        },
        Problem: {
          statement: 'A clear problem statement',
          severity: 'number', // 1-10
          frequency: 'string',
          currentSolutions: ['string'],
          solutions: ['->Solution', { minItems: 1, maxItems: 2 }],
        },
        Solution: {
          description: 'string',
          approach: 'string',
          differentiator: 'What makes this unique',
          headlessSaaS: '->HeadlessSaaS',
        },
        HeadlessSaaS: {
          name: 'string',
          api: 'string',
          features: ['string', { minItems: 3 }],
          icps: ['->ICP', { minItems: 1, maxItems: 3 }],
        },
        ICP: {
          segment: 'string',
          painPoints: ['string', { minItems: 3 }],
          demographics: 'object',
          budget: 'string',
          startups: ['->Startup', { minItems: 1, maxItems: 5 }],
        },
        Startup: {
          name: 'string',
          pitch: 'A 30-second elevator pitch',
          model: '->LeanCanvas',
          ads: ['->Ad', { minItems: 1, maxItems: 3 }],
        },
        LeanCanvas: {
          problem: ['string', { minItems: 3 }],
          solution: ['string', { minItems: 3 }],
          uniqueValueProp: 'string',
          channels: ['string'],
          revenueStreams: ['string'],
        },
        Ad: {
          headline: 'string',
          copy: 'string',
          cta: 'string',
          targetAudience: 'string',
          blindTests: ['->BlindTest', { minItems: 1, maxItems: 2 }],
        },
        BlindTest: {
          variants: ['string', { minItems: 2 }],
          metrics: ['string', { minItems: 2 }],
          experiments: ['->Experiment', { minItems: 1, maxItems: 3 }],
        },
        Experiment: {
          hypothesis: 'string',
          methodology: 'string',
          successCriteria: 'string',
          status: 'pending|running|completed',
        },
      })

      expect(schema).toBeDefined()
      expect(schema.Industry).toBeDefined()
      expect(schema.Experiment).toBeDefined()

      // Verify cascade chain length (10 entity types)
      const entityTypes = Object.keys(schema)
      expect(entityTypes).toHaveLength(12) // Including LeanCanvas
      expect(entityTypes).toContain('Industry')
      expect(entityTypes).toContain('Occupation')
      expect(entityTypes).toContain('Task')
      expect(entityTypes).toContain('Problem')
      expect(entityTypes).toContain('Solution')
      expect(entityTypes).toContain('HeadlessSaaS')
      expect(entityTypes).toContain('ICP')
      expect(entityTypes).toContain('Startup')
      expect(entityTypes).toContain('LeanCanvas')
      expect(entityTypes).toContain('Ad')
      expect(entityTypes).toContain('BlindTest')
      expect(entityTypes).toContain('Experiment')
    })

    it('analyzes cascade depth correctly', () => {
      const schema = DB({
        Industry: {
          occupations: ['->Occupation'],
        },
        Occupation: {
          tasks: ['->Task'],
        },
        Task: {
          problems: ['->Problem'],
        },
        Problem: {
          solutions: ['->Solution'],
        },
        Solution: {
          headlessSaaS: '->HeadlessSaaS',
        },
        HeadlessSaaS: {
          icps: ['->ICP'],
        },
        ICP: {
          startups: ['->Startup'],
        },
        Startup: {
          ads: ['->Ad'],
        },
        Ad: {
          blindTests: ['->BlindTest'],
        },
        BlindTest: {
          experiments: ['->Experiment'],
        },
        Experiment: {
          status: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const graph = engine.analyzeDependencies('Industry')

      // Cascade depth should be 10 (Industry -> ... -> Experiment)
      expect(graph.maxDepth).toBe(10)
      expect(graph.nodes).toContain('Industry')
      expect(graph.nodes).toContain('Experiment')
    })
  })
})

// ============================================================================
// 2. Mini Cascade Tests (Scaled Down for Unit Tests)
// ============================================================================

describe('Mini Cascade Generation', () => {
  describe('2 Industries x 3 Occupations x 5 Tasks', () => {
    it('generates mini cascade with correct entity counts', async () => {
      const schema = DB({
        Industry: {
          name: 'string',
          occupations: ['->Occupation', { minItems: 3, maxItems: 3 }],
        },
        Occupation: {
          title: 'string',
          tasks: ['->Task', { minItems: 5, maxItems: 5 }],
        },
        Task: {
          name: 'string',
          problems: ['->Problem', { minItems: 1, maxItems: 1 }],
        },
        Problem: {
          statement: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        maxConcurrency: 10,
      })

      // Generate 2 industries
      const industry1 = await engine.generate<IndustryEntity>('Industry', { name: 'Technology' })
      const industry2 = await engine.generate<IndustryEntity>('Industry', { name: 'Healthcare' })

      // Verify counts: 2 industries x 3 occupations x 5 tasks x 1 problem
      expect(industry1.occupations).toHaveLength(3)
      expect(industry2.occupations).toHaveLength(3)

      industry1.occupations.forEach((occupation) => {
        expect(occupation.tasks).toHaveLength(5)
        occupation.tasks.forEach((task) => {
          expect(task.problems).toHaveLength(1)
        })
      })

      // Total entities: 2 industries + 6 occupations + 30 tasks + 30 problems = 68
      const metrics = engine.getSessionMetrics()
      expect(metrics.totalEntitiesGenerated).toBe(68)
    })

    it('tracks metrics during mini cascade', async () => {
      const schema = DB({
        Industry: {
          name: 'string',
          occupations: ['->Occupation', { minItems: 2, maxItems: 2 }],
        },
        Occupation: {
          title: 'string',
          tasks: ['->Task', { minItems: 3, maxItems: 3 }],
        },
        Task: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const result = await engine.generateWithMetadata<IndustryEntity>('Industry', { name: 'Test' })

      // 1 Industry + 2 Occupations + 6 Tasks = 9 entities
      expect(result.metrics.totalEntitiesGenerated).toBe(9)
      expect(result.metrics.entitiesByType.Industry).toBe(1)
      expect(result.metrics.entitiesByType.Occupation).toBe(2)
      expect(result.metrics.entitiesByType.Task).toBe(6)

      // Should have relationships
      expect(result.metrics.totalRelationshipsCreated).toBeGreaterThanOrEqual(8)
    })

    it('respects generation depth limits', async () => {
      const schema = DB({
        A: { b: '->B' },
        B: { c: '->C' },
        C: { d: '->D' },
        D: { e: '->E' },
        E: { f: '->F' },
        F: { value: 'string' },
      })

      const engine = new GenerationEngine(schema, {
        maxDepth: 3, // Stop at D
      })

      const result = await engine.generate('A', {})

      expect(result.b).toBeDefined()
      expect(result.b.c).toBeDefined()
      expect(result.b.c.d).toBeDefined()
      expect(result.b.c.d.e).toBeUndefined() // Should stop at depth 3
    })
  })
})

// ============================================================================
// 3. Parallel Generation at Scale
// ============================================================================

describe('Parallel Generation at Scale', () => {
  describe('Parallel Batch Generation', () => {
    it('generates multiple entities concurrently within limits', async () => {
      const schema = DB({
        Container: {
          items: ['->Item', { minItems: 50 }],
        },
        Item: {
          name: 'string',
          data: 'object',
        },
      })

      const engine = new GenerationEngine(schema, {
        maxConcurrency: 10,
      })

      const startTime = performance.now()
      const container = await engine.generate('Container', {})
      const endTime = performance.now()

      expect(container.items).toHaveLength(50)

      const metrics = engine.getLastGenerationMetrics()
      expect(metrics.peakConcurrency).toBeLessThanOrEqual(10)
      expect(metrics.parallelBatchCount).toBeGreaterThan(0)

      // With concurrency 10, 50 items should complete in ~5 batches
      // Parallel should be faster than sequential
      expect(endTime - startTime).toBeLessThan(30000) // 30 second limit
    })

    it('identifies independent subtrees for parallel generation', async () => {
      const schema = DB({
        Root: {
          branchA: '->BranchA',
          branchB: '->BranchB',
          branchC: '->BranchC',
        },
        BranchA: {
          leaves: ['->Leaf', { minItems: 10 }],
        },
        BranchB: {
          leaves: ['->Leaf', { minItems: 10 }],
        },
        BranchC: {
          leaves: ['->Leaf', { minItems: 10 }],
        },
        Leaf: {
          value: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const graph = engine.analyzeDependencies('Root')

      // BranchA, BranchB, BranchC should be in same parallel group
      expect(graph.parallelGroups).toContainEqual(
        expect.arrayContaining(['BranchA', 'BranchB', 'BranchC'])
      )
    })

    it('batches relationship creation for efficiency', async () => {
      const schema = DB({
        Team: {
          members: ['->Person', { minItems: 100 }],
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        relationshipBatchSize: 25,
      })

      await engine.generate('Team', {})

      const metrics = engine.getLastGenerationMetrics()

      // 100 relationships / 25 batch size = 4 batches minimum
      expect(metrics.relationshipBatches).toBeGreaterThanOrEqual(4)
      expect(metrics.totalRelationshipsCreated).toBe(100)
    })
  })
})

// ============================================================================
// 4. Performance Metrics Tracking
// ============================================================================

describe('Performance Metrics at Scale', () => {
  describe('Entity Generation Tracking', () => {
    it('tracks entities per second', async () => {
      const schema = DB({
        Container: {
          items: ['->Item', { minItems: 100 }],
        },
        Item: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        maxConcurrency: 20,
      })

      await engine.generate('Container', {})

      const metrics = engine.getLastGenerationMetrics() as ScaleCascadeMetrics

      // Should track generation rate
      expect(metrics.totalEntitiesGenerated).toBe(101) // 1 Container + 100 Items
      expect(metrics.totalDurationMs).toBeGreaterThan(0)

      const entitiesPerSecond = metrics.totalEntitiesGenerated / (metrics.totalDurationMs / 1000)
      expect(entitiesPerSecond).toBeGreaterThan(0)
    })

    it('tracks relationships per second', async () => {
      const schema = DB({
        Graph: {
          nodes: ['->Node', { minItems: 50 }],
        },
        Node: {
          connections: ['~>Node', { minItems: 2, maxItems: 5 }],
        },
      })

      const engine = new GenerationEngine(schema)
      await engine.generate('Graph', {})

      const metrics = engine.getLastGenerationMetrics() as ScaleCascadeMetrics

      expect(metrics.totalRelationshipsCreated).toBeGreaterThan(50)

      const relationshipsPerSecond =
        metrics.totalRelationshipsCreated / (metrics.totalDurationMs / 1000)
      expect(relationshipsPerSecond).toBeGreaterThan(0)
    })

    it('tracks memory usage during generation', async () => {
      const schema = DB({
        Large: {
          items: ['->LargeItem', { minItems: 200 }],
        },
        LargeItem: {
          data: 'object',
          blob: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        trackMemory: true,
      })

      await engine.generate('Large', {})

      const metrics = engine.getLastGenerationMetrics() as ScaleCascadeMetrics

      expect(metrics.memoryUsageMb).toBeDefined()
      expect(metrics.memoryUsageMb).toBeGreaterThan(0)
    })

    it('provides breakdown by entity type', async () => {
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
      await engine.generate('Company', {})

      const metrics = engine.getLastGenerationMetrics() as ScaleCascadeMetrics

      expect(metrics.entitiesByType.Company).toBe(1)
      expect(metrics.entitiesByType.Department).toBe(3)
      expect(metrics.entitiesByType.Employee).toBe(15) // 3 depts x 5 employees
    })
  })
})

// ============================================================================
// 5. Cache Effectiveness at Scale
// ============================================================================

describe('Cache Effectiveness at Scale', () => {
  describe('Fuzzy Search Caching', () => {
    it('caches fuzzy search results within session', async () => {
      const schema = DB({
        Order: {
          customer: '~>Customer',
        },
        Customer: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // Create a customer
      await engine.generate('Customer', { name: 'Acme Corp' })

      // Generate multiple orders - should cache fuzzy search for "Acme"
      await engine.generate('Order', { $context: 'Order for Acme Corp' })
      await engine.generate('Order', { $context: 'Another order for Acme Corp' })
      await engine.generate('Order', { $context: 'Third order for Acme Corp' })

      const metrics = engine.getSessionMetrics() as ScaleCascadeMetrics

      // Should have more cache hits than misses for repeated searches
      expect(metrics.cacheHits).toBeGreaterThan(0)
      expect(metrics.cacheHits).toBeGreaterThanOrEqual(2) // At least 2 of 3 orders cached
    })

    it('reduces redundant generation with effective caching', async () => {
      const schema = DB({
        Article: {
          category: '~>Category',
          tags: ['~>Tag', { minItems: 3 }],
        },
        Category: {
          name: 'string',
        },
        Tag: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // Pre-populate categories and tags
      await engine.generate('Category', { name: 'Technology' })
      await engine.generate('Category', { name: 'Business' })
      await engine.generate('Tag', { name: 'AI' })
      await engine.generate('Tag', { name: 'Machine Learning' })
      await engine.generate('Tag', { name: 'Software' })

      // Generate articles that should find existing categories/tags
      await engine.generate('Article', { $context: 'AI Technology article' })
      await engine.generate('Article', { $context: 'Machine Learning software' })
      await engine.generate('Article', { $context: 'Business AI trends' })

      const metrics = engine.getSessionMetrics() as ScaleCascadeMetrics

      // Cache should prevent regenerating categories and tags
      // 5 pre-created + 3 articles = 8 entities, not 3 articles + 3 categories + 9 tags = 15
      expect(metrics.totalEntitiesGenerated).toBeLessThan(15)
      expect(metrics.cacheHits).toBeGreaterThan(0)
    })

    it('tracks cache hit rate', async () => {
      const schema = DB({
        Product: {
          vendor: '~>Vendor',
        },
        Vendor: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      await engine.generate('Vendor', { name: 'Supplier X' })

      // Multiple products from same vendor
      for (let i = 0; i < 10; i++) {
        await engine.generate('Product', { $context: `Product from Supplier X #${i}` })
      }

      const stats = engine.getCacheStats()

      expect(stats.hitRate).toBeGreaterThan(0.5) // At least 50% hit rate
      expect(stats.entries).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// 6. DO Scale-Out Architecture
// ============================================================================

describe('DO Scale-Out Architecture', () => {
  describe('Distributed Cascade Execution', () => {
    it('routes entity types to dedicated DOs', async () => {
      const schema = DB({
        Startup: {
          model: '->LeanCanvas',
          customer: '~>ICP',
        },
        LeanCanvas: {
          problem: 'string',
        },
        ICP: {
          segment: 'string',
        },
      })

      const orchestrator = new CascadeOrchestrator(schema, {
        routing: {
          Startup: 'startups',
          LeanCanvas: 'canvases',
          ICP: 'customers',
        },
      })

      const result = await orchestrator.generate('Startup', { name: 'Test Startup' })

      // Each entity should be stored in its designated DO
      expect(result.routing.Startup).toBe('startups')
      expect(result.routing.LeanCanvas).toBe('canvases')
      expect(result.routing.ICP).toBe('customers')
    })

    it('aggregates results from multiple DOs', async () => {
      const schema = DB({
        Portfolio: {
          startups: ['->Startup', { minItems: 5 }],
        },
        Startup: {
          name: 'string',
          model: '->LeanCanvas',
        },
        LeanCanvas: {
          problem: 'string',
        },
      })

      const orchestrator = new CascadeOrchestrator(schema, {
        routing: {
          Portfolio: 'portfolios',
          Startup: 'startups',
          LeanCanvas: 'canvases',
        },
      })

      const result = await orchestrator.generate('Portfolio', {})

      // Should aggregate 1 Portfolio + 5 Startups + 5 LeanCanvases = 11 entities
      expect(result.aggregated.totalEntities).toBe(11)
      expect(result.aggregated.byDO.portfolios).toBe(1)
      expect(result.aggregated.byDO.startups).toBe(5)
      expect(result.aggregated.byDO.canvases).toBe(5)
    })

    it('handles cross-DO relationships', async () => {
      const schema = DB({
        Startup: {
          customer: '~>ICP', // ICP might exist in different DO
        },
        ICP: {
          segment: 'string',
        },
      })

      const orchestrator = new CascadeOrchestrator(schema, {
        routing: {
          Startup: 'startups',
          ICP: 'customers',
        },
      })

      // Pre-create ICP in customers DO
      await orchestrator.generateInDO('ICP', 'customers', { segment: 'Enterprise' })

      // Startup should find and link to existing ICP
      const startup = await orchestrator.generate('Startup', {
        $context: 'Enterprise SaaS startup',
      })

      expect(startup.customer).toBeDefined()
      expect(startup.crossDORelationships).toContainEqual(
        expect.objectContaining({
          from: { do: 'startups', id: startup.$id },
          to: { do: 'customers', id: startup.customer.$id },
        })
      )
    })
  })

  describe('$.do() Durability Integration', () => {
    it('uses $.do() for durable cascade steps', async () => {
      const schema = DB({
        Startup: {
          model: '->LeanCanvas',
        },
        LeanCanvas: {
          problem: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        durability: 'durable', // Use $.do() for retries
      })

      const result = await engine.generateWithMetadata('Startup', {})

      // Each generation step should be wrapped in $.do()
      expect(result.execution.mode).toBe('durable')
      expect(result.execution.steps).toBeGreaterThan(0)
      expect(result.execution.retries).toBeDefined()
    })

    it('recovers from partial cascade failures', async () => {
      const schema = DB({
        Startup: {
          model: '->LeanCanvas',
          team: ['->Person', { minItems: 3 }],
        },
        LeanCanvas: {
          problem: 'string',
        },
        Person: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema, {
        durability: 'durable',
        maxRetries: 3,
      })

      // Simulate transient failure on first Person generation
      let personAttempts = 0
      engine.onGenerate('Person', async (context) => {
        personAttempts++
        if (personAttempts === 1) {
          throw new Error('Transient failure')
        }
        return { name: `Person ${personAttempts}` }
      })

      const result = await engine.generate('Startup', {})

      // Should have recovered and completed
      expect(result.team).toHaveLength(3)
      expect(personAttempts).toBeGreaterThan(3) // At least one retry occurred
    })
  })
})

// ============================================================================
// 7. Scale Projection Tests
// ============================================================================

describe('Scale Projection', () => {
  describe('Entity Count Projections', () => {
    it('calculates expected entity counts for full cascade', () => {
      const schema = DB({
        Industry: {
          occupations: ['->Occupation', { minItems: 10, maxItems: 10 }],
        },
        Occupation: {
          tasks: ['->Task', { minItems: 20, maxItems: 20 }],
        },
        Task: {
          problems: ['->Problem', { minItems: 3, maxItems: 3 }],
        },
        Problem: {
          solutions: ['->Solution', { minItems: 2, maxItems: 2 }],
        },
        Solution: {
          headlessSaaS: '->HeadlessSaaS',
        },
        HeadlessSaaS: {
          icps: ['->ICP', { minItems: 3, maxItems: 3 }],
        },
        ICP: {
          startups: ['->Startup', { minItems: 5, maxItems: 5 }],
        },
        Startup: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const projection = engine.projectEntityCounts('Industry', 20) // 20 industries

      // 20 industries x 10 occupations = 200 occupations
      expect(projection.Occupation).toBe(200)

      // 200 occupations x 20 tasks = 4,000 tasks
      expect(projection.Task).toBe(4000)

      // 4,000 tasks x 3 problems = 12,000 problems
      expect(projection.Problem).toBe(12000)

      // 12,000 problems x 2 solutions = 24,000 solutions
      expect(projection.Solution).toBe(24000)

      // 24,000 solutions x 1 HeadlessSaaS = 24,000 HeadlessSaaS
      expect(projection.HeadlessSaaS).toBe(24000)

      // 24,000 HeadlessSaaS x 3 ICPs = 72,000 ICPs
      expect(projection.ICP).toBe(72000)

      // 72,000 ICPs x 5 startups = 360,000 startups
      expect(projection.Startup).toBe(360000)

      // Total: 20 + 200 + 4000 + 12000 + 24000 + 24000 + 72000 + 360000 = 496,220
      expect(projection.total).toBe(496220)
    })

    it('estimates generation time based on metrics', async () => {
      const schema = DB({
        Simple: {
          children: ['->Child', { minItems: 10 }],
        },
        Child: {
          name: 'string',
        },
      })

      const engine = new GenerationEngine(schema)

      // Benchmark with small cascade
      await engine.generate('Simple', {})
      const benchmarkMetrics = engine.getLastGenerationMetrics()

      // Estimate for larger cascade
      const estimate = engine.estimateGenerationTime({
        rootType: 'Simple',
        multiplier: 100, // 100x the benchmark
      })

      expect(estimate.estimatedDurationMs).toBeGreaterThan(benchmarkMetrics.totalDurationMs)
      expect(estimate.confidence).toBeDefined() // low|medium|high
    })
  })

  describe('Relationship Count Projections', () => {
    it('calculates expected relationship counts', () => {
      const schema = DB({
        Parent: {
          children: ['->Child', { minItems: 5 }],
        },
        Child: {
          grandchildren: ['->Grandchild', { minItems: 3 }],
        },
        Grandchild: {
          value: 'string',
        },
      })

      const engine = new GenerationEngine(schema)
      const projection = engine.projectRelationshipCounts('Parent', 10)

      // 10 Parents -> 5 Children each = 50 relationships
      expect(projection.parentToChild).toBe(50)

      // 50 Children -> 3 Grandchildren each = 150 relationships
      expect(projection.childToGrandchild).toBe(150)

      // Total: 200 relationships
      expect(projection.total).toBe(200)
    })
  })
})

// ============================================================================
// 8. Full Cascade Integration Test (Scaled Down)
// ============================================================================

describe('Full Cascade Integration (Scaled Down)', () => {
  it('generates complete cascade from Industry to Experiment', async () => {
    const schema = DB({
      Industry: {
        name: 'string',
        occupations: ['->Occupation', { minItems: 1, maxItems: 1 }],
      },
      Occupation: {
        title: 'string',
        tasks: ['->Task', { minItems: 1, maxItems: 1 }],
      },
      Task: {
        name: 'string',
        problems: ['->Problem', { minItems: 1, maxItems: 1 }],
      },
      Problem: {
        statement: 'string',
        solutions: ['->Solution', { minItems: 1, maxItems: 1 }],
      },
      Solution: {
        description: 'string',
        headlessSaaS: '->HeadlessSaaS',
      },
      HeadlessSaaS: {
        name: 'string',
        icps: ['->ICP', { minItems: 1, maxItems: 1 }],
      },
      ICP: {
        segment: 'string',
        startups: ['->Startup', { minItems: 1, maxItems: 1 }],
      },
      Startup: {
        name: 'string',
        model: '->LeanCanvas',
        ads: ['->Ad', { minItems: 1, maxItems: 1 }],
      },
      LeanCanvas: {
        problem: ['string', { minItems: 1 }],
        solution: ['string', { minItems: 1 }],
      },
      Ad: {
        headline: 'string',
        blindTests: ['->BlindTest', { minItems: 1, maxItems: 1 }],
      },
      BlindTest: {
        variants: ['string', { minItems: 2 }],
        experiments: ['->Experiment', { minItems: 1, maxItems: 1 }],
      },
      Experiment: {
        hypothesis: 'string',
        status: 'pending|running|completed',
      },
    })

    const engine = new GenerationEngine(schema, {
      maxConcurrency: 5,
    })

    const industry = await engine.generate<IndustryEntity>('Industry', {
      name: 'Software Development',
    })

    // Verify complete cascade chain
    expect(industry.name).toBe('Software Development')
    expect(industry.occupations).toHaveLength(1)

    const occupation = industry.occupations[0]
    expect(occupation.tasks).toHaveLength(1)

    const task = occupation.tasks[0]
    expect(task.problems).toHaveLength(1)

    const problem = task.problems[0]
    expect(problem.solutions).toHaveLength(1)

    const solution = problem.solutions[0]
    expect(solution.headlessSaaS).toBeDefined()

    const saas = solution.headlessSaaS
    expect(saas.icps).toHaveLength(1)

    const icp = saas.icps[0]
    expect(icp.startups).toHaveLength(1)

    const startup = icp.startups[0]
    expect(startup.model).toBeDefined()
    expect(startup.ads).toHaveLength(1)

    const ad = startup.ads[0]
    expect(ad.blindTests).toHaveLength(1)

    const blindTest = ad.blindTests[0]
    expect(blindTest.experiments).toHaveLength(1)

    const experiment = blindTest.experiments[0]
    expect(experiment.hypothesis).toBeDefined()
    expect(['pending', 'running', 'completed']).toContain(experiment.status)

    // Verify metrics
    const metrics = engine.getLastGenerationMetrics() as ScaleCascadeMetrics

    // Should have generated: Industry(1) + Occupation(1) + Task(1) + Problem(1) +
    // Solution(1) + HeadlessSaaS(1) + ICP(1) + Startup(1) + LeanCanvas(1) +
    // Ad(1) + BlindTest(1) + Experiment(1) = 12 entities
    expect(metrics.totalEntitiesGenerated).toBe(12)
    expect(metrics.totalRelationshipsCreated).toBeGreaterThanOrEqual(11)
  }, 60000) // 60 second timeout for full cascade

  it('verifies all relationships are created correctly', async () => {
    const schema = DB({
      Industry: {
        name: 'string',
        occupations: ['->Occupation', { minItems: 2 }],
      },
      Occupation: {
        title: 'string',
        tasks: ['->Task', { minItems: 2 }],
      },
      Task: {
        name: 'string',
      },
    })

    const engine = new GenerationEngine(schema)
    const industry = await engine.generate<IndustryEntity>('Industry', { name: 'Test' })

    // Verify Industry -> Occupation relationships
    const industryRels = await engine.getRelationships(industry.$id)
    expect(industryRels.filter((r) => r.verb === 'occupations')).toHaveLength(2)

    // Verify Occupation -> Task relationships
    for (const occupation of industry.occupations) {
      const occRels = await engine.getRelationships(occupation.$id)
      expect(occRels.filter((r) => r.verb === 'tasks')).toHaveLength(2)
    }
  })
})

// ============================================================================
// 9. Stress Tests (Larger Scale, Skip in CI)
// ============================================================================

describe.skip('Stress Tests (Large Scale)', () => {
  it('handles 1000+ entity generation', async () => {
    const schema = DB({
      Container: {
        items: ['->Item', { minItems: 1000 }],
      },
      Item: {
        name: 'string',
        data: 'object',
      },
    })

    const engine = new GenerationEngine(schema, {
      maxConcurrency: 50,
    })

    const startTime = performance.now()
    const container = await engine.generate('Container', {})
    const duration = performance.now() - startTime

    expect(container.items).toHaveLength(1000)

    const metrics = engine.getLastGenerationMetrics() as ScaleCascadeMetrics

    // Performance assertions
    expect(metrics.totalEntitiesGenerated).toBe(1001)
    expect(duration).toBeLessThan(120000) // 2 minute max

    console.log(`Generated 1001 entities in ${duration.toFixed(0)}ms`)
    console.log(`Rate: ${(1001 / (duration / 1000)).toFixed(1)} entities/sec`)
  }, 180000) // 3 minute timeout

  it('handles deep cascade (10+ levels)', async () => {
    // Build a 10-level deep schema
    const schemaObj: Record<string, Record<string, unknown>> = {}
    for (let i = 1; i <= 10; i++) {
      schemaObj[`Level${i}`] = {
        name: 'string',
        ...(i < 10 ? { next: `->Level${i + 1}` } : {}),
      }
    }

    const schema = DB(schemaObj)
    const engine = new GenerationEngine(schema, {
      maxDepth: 15, // Allow full depth
    })

    const result = await engine.generate('Level1', { name: 'Start' })

    // Verify full depth
    let current: any = result
    for (let i = 1; i <= 10; i++) {
      expect(current).toBeDefined()
      expect(current.name).toBeDefined()
      if (i < 10) {
        current = current.next
      }
    }
  }, 60000)
})
