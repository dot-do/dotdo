/**
 * SemanticLayer + QueryEngine Integration Tests - TDD RED Phase
 *
 * Tests for integrating SemanticLayer with the QueryEngine primitive,
 * providing unified query planning across raw and semantic queries.
 *
 * Architecture:
 * ```
 * SemanticQuery -> SemanticLayer -> SQL AST -> QueryEngine -> Execution
 * ```
 *
 * @see dotdo-pozph
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SemanticLayer,
  type SemanticQuery,
  type CubeDefinition,
  type QueryResult,
} from '../index'
import {
  QueryPlanner,
  ExecutionEngine,
  SQLWhereParser,
  PredicateCompiler,
  MongoQueryParser,
  type QueryPlan,
  type ExecutionContext,
  type TypedColumnStore,
  type QueryNode,
} from '../../query-engine'
import {
  createPipeline,
  PipelineBuilder,
  createGroupStage,
  type Pipeline,
} from '../../aggregation-pipeline'
import {
  SemanticQueryEngine,
  type SemanticQueryEngineConfig,
  type SemanticQueryPlan,
  type SemanticExecutionResult,
  type QueryExplain,
  type QueryAnalysis,
  SemanticQueryError,
  InvalidSemanticQueryError,
} from '../query-engine-integration'

// =============================================================================
// TEST FIXTURES
// =============================================================================

const ordersCubeDefinition: CubeDefinition = {
  name: 'orders',
  sql: 'SELECT * FROM orders',
  measures: {
    count: { type: 'count' },
    totalRevenue: { type: 'sum', sql: 'amount' },
    avgOrderValue: { type: 'avg', sql: 'amount' },
    uniqueCustomers: { type: 'countDistinct', sql: 'customer_id' },
  },
  dimensions: {
    status: { type: 'string', sql: 'status' },
    createdAt: { type: 'time', sql: 'created_at' },
    customerId: { type: 'string', sql: 'customer_id' },
    region: { type: 'string', sql: 'region' },
    amount: { type: 'number', sql: 'amount' },
  },
  joins: [
    {
      name: 'customers',
      relationship: 'belongsTo',
      sql: '${orders}.customer_id = ${customers}.id',
    },
  ],
}

const customersCubeDefinition: CubeDefinition = {
  name: 'customers',
  sql: 'SELECT * FROM customers',
  measures: {
    count: { type: 'count' },
    avgLifetimeValue: { type: 'avg', sql: 'lifetime_value' },
  },
  dimensions: {
    id: { type: 'string', sql: 'id' },
    name: { type: 'string', sql: 'name' },
    country: { type: 'string', sql: 'country' },
    tier: { type: 'string', sql: 'tier' },
    createdAt: { type: 'time', sql: 'created_at' },
  },
}

// =============================================================================
// SEMANTIC QUERY ENGINE INTEGRATION TESTS
// =============================================================================

describe('SemanticQueryEngine', () => {
  let semanticLayer: SemanticLayer
  let queryEngine: SemanticQueryEngine
  let mockColumnStore: TypedColumnStore

  beforeEach(() => {
    // Create semantic layer with cubes
    semanticLayer = new SemanticLayer({ sqlDialect: 'postgres' })
    semanticLayer.defineCube(ordersCubeDefinition)
    semanticLayer.defineCube(customersCubeDefinition)

    // Mock column store for execution
    mockColumnStore = {
      filter: vi.fn().mockReturnValue({
        columns: new Map([
          ['status', ['completed', 'completed', 'pending']],
          ['amount', [100, 200, 150]],
        ]),
        rowCount: 3,
      }),
      project: vi.fn().mockReturnValue({
        columns: new Map([
          ['status', ['completed', 'pending']],
          ['totalRevenue', [300, 150]],
          ['count', [2, 1]],
        ]),
        rowCount: 2,
      }),
      aggregate: vi.fn().mockReturnValue(450),
      bloomFilter: vi.fn(),
      minMax: vi.fn(),
    } as unknown as TypedColumnStore

    // Create integrated query engine
    queryEngine = new SemanticQueryEngine({
      semanticLayer,
      columnStore: mockColumnStore,
    })
  })

  describe('Registration and Configuration', () => {
    it('should register semantic layer as query source', () => {
      expect(queryEngine.getSemanticLayer()).toBe(semanticLayer)
    })

    it('should list available cubes as query sources', () => {
      const sources = queryEngine.getQuerySources()

      expect(sources).toContain('orders')
      expect(sources).toContain('customers')
    })

    it('should accept configuration options', () => {
      const config: SemanticQueryEngineConfig = {
        semanticLayer,
        columnStore: mockColumnStore,
        enableCaching: true,
        cacheConfig: { ttl: 60000, maxEntries: 1000 },
        enableExplain: true,
      }

      const engine = new SemanticQueryEngine(config)
      expect(engine).toBeInstanceOf(SemanticQueryEngine)
    })

    it('should support multiple column stores for different cubes', () => {
      const ordersStore = { ...mockColumnStore } as TypedColumnStore
      const customersStore = { ...mockColumnStore } as TypedColumnStore

      const engine = new SemanticQueryEngine({
        semanticLayer,
        columnStores: {
          orders: ordersStore,
          customers: customersStore,
        },
      })

      expect(engine).toBeInstanceOf(SemanticQueryEngine)
    })
  })

  describe('Semantic to SQL AST Conversion', () => {
    it('should convert semantic query to QueryEngine AST', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
      }

      const ast = queryEngine.toQueryAST(semanticQuery)

      expect(ast).toBeDefined()
      expect(ast.type).toBe('semantic')
      expect(ast.measures).toHaveLength(1)
      expect(ast.dimensions).toHaveLength(1)
    })

    it('should convert filters to predicate nodes', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
        ],
      }

      const ast = queryEngine.toQueryAST(semanticQuery)

      expect(ast.filter).toBeDefined()
      expect(ast.filter.type).toBe('predicate')
      expect(ast.filter.column).toBe('status')
      expect(ast.filter.op).toBe('=')
    })

    it('should convert multiple filters to logical AND node', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
          { dimension: 'orders.amount', operator: 'gte', values: ['100'] },
        ],
      }

      const ast = queryEngine.toQueryAST(semanticQuery)

      expect(ast.filter.type).toBe('logical')
      expect(ast.filter.op).toBe('AND')
      expect(ast.filter.children).toHaveLength(2)
    })

    it('should convert time dimensions with granularity', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
          },
        ],
      }

      const ast = queryEngine.toQueryAST(semanticQuery)

      expect(ast.timeDimensions).toHaveLength(1)
      expect(ast.timeDimensions[0].granularity).toBe('day')
    })

    it('should convert order to sort nodes', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
        order: [{ id: 'orders.totalRevenue', desc: true }],
      }

      const ast = queryEngine.toQueryAST(semanticQuery)

      expect(ast.sort).toBeDefined()
      expect(ast.sort.columns[0].direction).toBe('DESC')
    })
  })

  describe('SQL Parser Integration', () => {
    it('should use SQL parser for generated SQL validation', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
      }

      const { sql, isValid, errors } = await queryEngine.validateQuery(semanticQuery)

      expect(sql).toBeDefined()
      expect(isValid).toBe(true)
      expect(errors).toHaveLength(0)
    })

    it('should detect SQL syntax errors in generated queries', async () => {
      // Create a semantic layer with a cube containing invalid SQL
      const invalidCube: CubeDefinition = {
        name: 'invalid',
        sql: 'SELECT * FROM', // Invalid SQL
        measures: { count: { type: 'count' } },
        dimensions: {},
      }

      const layer = new SemanticLayer()
      layer.defineCube(invalidCube)

      const engine = new SemanticQueryEngine({
        semanticLayer: layer,
        columnStore: mockColumnStore,
      })

      const result = await engine.validateQuery({
        measures: ['invalid.count'],
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should validate custom SQL in measures', async () => {
      const cubeWithCustomSQL: CubeDefinition = {
        name: 'custom',
        sql: 'SELECT * FROM sales',
        measures: {
          customMetric: {
            type: 'custom',
            sql: 'SUM(amount) / COUNT(DISTINCT customer_id)',
          },
        },
        dimensions: {
          category: { type: 'string', sql: 'category' },
        },
      }

      const layer = new SemanticLayer()
      layer.defineCube(cubeWithCustomSQL)

      const engine = new SemanticQueryEngine({
        semanticLayer: layer,
        columnStore: mockColumnStore,
      })

      const result = await engine.validateQuery({
        measures: ['custom.customMetric'],
      })

      expect(result.isValid).toBe(true)
    })

    it('should parse semantic query from SQL string', async () => {
      const sql = `
        SELECT orders.status, SUM(orders.amount) as totalRevenue
        FROM orders
        WHERE orders.status = 'completed'
        GROUP BY orders.status
      `

      const semanticQuery = queryEngine.parseSQL(sql)

      expect(semanticQuery.measures).toContain('orders.totalRevenue')
      expect(semanticQuery.dimensions).toContain('orders.status')
      expect(semanticQuery.filters).toHaveLength(1)
    })
  })

  describe('Query Execution Engine Integration', () => {
    it('should execute semantic query through QueryEngine', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue', 'orders.count'],
        dimensions: ['orders.status'],
      }

      const result = await queryEngine.execute(semanticQuery)

      expect(result.data).toBeDefined()
      expect(result.sql).toBeDefined()
      expect(result.executionStats).toBeDefined()
    })

    it('should use predicate pushdown for filters', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
        ],
      }

      await queryEngine.execute(semanticQuery)

      // Verify filter was pushed to column store
      expect(mockColumnStore.filter).toHaveBeenCalled()
    })

    it('should leverage bloom filters when available', async () => {
      const mockBloom = { mightContain: vi.fn().mockReturnValue(true) }
      mockColumnStore.bloomFilter = vi.fn().mockReturnValue(mockBloom)

      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.customerId', operator: 'equals', values: ['cust-123'] },
        ],
      }

      await queryEngine.execute(semanticQuery)

      expect(mockColumnStore.bloomFilter).toHaveBeenCalledWith('customer_id')
    })

    it('should skip scan when bloom filter returns false', async () => {
      const mockBloom = { mightContain: vi.fn().mockReturnValue(false) }
      mockColumnStore.bloomFilter = vi.fn().mockReturnValue(mockBloom)
      mockColumnStore.filter = vi.fn()

      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.customerId', operator: 'equals', values: ['nonexistent'] },
        ],
      }

      const result = await queryEngine.execute(semanticQuery)

      expect(result.data).toHaveLength(0)
      expect(mockColumnStore.filter).not.toHaveBeenCalled()
    })

    it('should use min/max for partition pruning', async () => {
      mockColumnStore.minMax = vi.fn().mockReturnValue({ min: 0, max: 500 })

      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.amount', operator: 'gt', values: ['1000'] },
        ],
      }

      const result = await queryEngine.execute(semanticQuery)

      expect(mockColumnStore.minMax).toHaveBeenCalledWith('amount')
      // Should prune since max (500) < filter value (1000)
      expect(result.data).toHaveLength(0)
    })

    it('should return execution statistics', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
      }

      const result = await queryEngine.execute(semanticQuery)

      expect(result.executionStats).toBeDefined()
      expect(result.executionStats.rowsScanned).toBeGreaterThanOrEqual(0)
      expect(result.executionStats.executionTimeMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Query Planning', () => {
    it('should generate unified query plan', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
        filters: [
          { dimension: 'orders.createdAt', operator: 'gte', values: ['2024-01-01'] },
        ],
      }

      const plan = await queryEngine.plan(semanticQuery)

      expect(plan).toBeDefined()
      expect(plan.type).toBeDefined()
      expect(plan.estimatedCost).toBeGreaterThan(0)
      expect(plan.estimatedRows).toBeGreaterThan(0)
    })

    it('should select optimal index based on predicates', async () => {
      // Register indexes
      queryEngine.registerIndex('orders', {
        name: 'idx_status',
        type: 'bloom',
        columns: ['status'],
      })
      queryEngine.registerIndex('orders', {
        name: 'idx_created_at',
        type: 'minmax',
        columns: ['created_at'],
      })

      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.createdAt', operator: 'gte', values: ['2024-01-01'] },
        ],
      }

      const plan = await queryEngine.plan(semanticQuery)

      expect(plan.indexHint).toBeDefined()
      expect(plan.indexHint?.name).toBe('idx_created_at')
    })

    it('should plan joins across cubes', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status', 'customers.country'],
      }

      const plan = await queryEngine.plan(semanticQuery)

      expect(plan.join).toBeDefined()
      expect(plan.join.type).toBe('hash_join')
    })

    it('should estimate selectivity based on column statistics', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
        ],
      }

      const plan = await queryEngine.plan(semanticQuery)

      // With status having ~5 distinct values, selectivity should be ~0.2
      expect(plan.estimatedSelectivity).toBeGreaterThan(0)
      expect(plan.estimatedSelectivity).toBeLessThanOrEqual(1)
    })

    it('should choose between hash and nested loop join', async () => {
      // Small customers table - should prefer hash join building on right
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['customers.country'],
      }

      const plan = await queryEngine.plan(semanticQuery)

      expect(plan.join?.buildSide).toBe('right')
    })
  })

  describe('AggregationPipeline Integration', () => {
    it('should use AggregationPipeline for rollup computation', async () => {
      // Define pre-aggregation with rollup
      semanticLayer.definePreAggregation('orders', {
        name: 'daily_status_rollup',
        measures: ['totalRevenue', 'count'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
      })

      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue', 'orders.count'],
        dimensions: ['orders.status'],
        timeDimensions: [
          { dimension: 'orders.createdAt', granularity: 'day' },
        ],
      }

      const plan = await queryEngine.plan(semanticQuery)

      expect(plan.usesPreAggregation).toBe(true)
      expect(plan.preAggregationName).toBe('daily_status_rollup')
    })

    it('should generate aggregation pipeline for complex rollups', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status', 'orders.region'],
        timeDimensions: [
          { dimension: 'orders.createdAt', granularity: 'month' },
        ],
      }

      const pipeline = queryEngine.toAggregationPipeline(semanticQuery)

      expect(pipeline).toBeDefined()
      expect(pipeline.stages.length).toBeGreaterThan(0)
    })

    it('should support CUBE operations for multi-dimensional analysis', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status', 'orders.region'],
      }

      const pipeline = queryEngine.toAggregationPipeline(semanticQuery, {
        useCube: true,
      })

      // CUBE should generate all possible grouping combinations
      expect(pipeline.stages.some((s) => s.name === '$cube')).toBe(true)
    })

    it('should support ROLLUP operations for hierarchical aggregation', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.region', 'orders.status'],
      }

      const pipeline = queryEngine.toAggregationPipeline(semanticQuery, {
        useRollup: true,
      })

      expect(pipeline.stages.some((s) => s.name === '$rollup')).toBe(true)
    })

    it('should integrate with streaming pipeline for incremental aggregation', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'hour',
            dateRange: ['2024-01-01', '2024-01-02'],
          },
        ],
      }

      const streamingPipeline = queryEngine.toStreamingPipeline(semanticQuery)

      expect(streamingPipeline).toBeDefined()
      expect(streamingPipeline.windowConfig).toBeDefined()
    })
  })

  describe('Query Explain/Analyze', () => {
    it('should provide explain output for semantic queries', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
      }

      const explain = await queryEngine.explain(semanticQuery)

      expect(explain.sql).toBeDefined()
      expect(explain.plan).toBeDefined()
      expect(explain.estimatedCost).toBeGreaterThan(0)
    })

    it('should show step-by-step query transformation', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
        filters: [
          { dimension: 'orders.amount', operator: 'gte', values: ['100'] },
        ],
      }

      const explain = await queryEngine.explain(semanticQuery)

      expect(explain.steps).toBeDefined()
      expect(explain.steps.length).toBeGreaterThan(0)
      expect(explain.steps).toContainEqual(
        expect.objectContaining({ name: expect.stringMatching(/semantic|ast|plan|filter/i) })
      )
    })

    it('should show index usage recommendations', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.createdAt', operator: 'gte', values: ['2024-01-01'] },
          { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
        ],
      }

      const explain = await queryEngine.explain(semanticQuery)

      expect(explain.indexRecommendations).toBeDefined()
    })

    it('should analyze actual vs estimated rows', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        dimensions: ['orders.status'],
      }

      const analysis = await queryEngine.analyze(semanticQuery)

      expect(analysis.estimatedRows).toBeDefined()
      expect(analysis.actualRows).toBeDefined()
      expect(analysis.executionTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should identify slow operations', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status', 'customers.country'],
        filters: [
          { dimension: 'orders.createdAt', operator: 'gte', values: ['2024-01-01'] },
        ],
      }

      const analysis = await queryEngine.analyze(semanticQuery)

      expect(analysis.operationBreakdown).toBeDefined()
      expect(analysis.operationBreakdown.length).toBeGreaterThan(0)
    })

    it('should provide optimization suggestions', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
      }

      const explain = await queryEngine.explain(semanticQuery)

      expect(explain.optimizationSuggestions).toBeDefined()
    })

    it('should show pre-aggregation usage', async () => {
      semanticLayer.definePreAggregation('orders', {
        name: 'daily_revenue',
        measures: ['totalRevenue', 'count'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
      })

      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
        timeDimensions: [
          { dimension: 'orders.createdAt', granularity: 'day' },
        ],
      }

      const explain = await queryEngine.explain(semanticQuery)

      expect(explain.usesPreAggregation).toBe(true)
      expect(explain.preAggregationName).toBe('daily_revenue')
    })
  })

  describe('Error Handling', () => {
    it('should throw SemanticQueryError for invalid cube references', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['nonexistent.count'],
      }

      await expect(queryEngine.execute(semanticQuery)).rejects.toThrow(
        SemanticQueryError
      )
    })

    it('should throw InvalidSemanticQueryError for invalid measure references', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.nonexistent'],
      }

      await expect(queryEngine.execute(semanticQuery)).rejects.toThrow(
        InvalidSemanticQueryError
      )
    })

    it('should provide detailed error context', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        filters: [
          { dimension: 'orders.invalid', operator: 'equals', values: ['test'] },
        ],
      }

      try {
        await queryEngine.execute(semanticQuery)
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as SemanticQueryError).context).toBeDefined()
        expect((e as SemanticQueryError).context.query).toEqual(semanticQuery)
      }
    })

    it('should handle execution timeouts', async () => {
      const engine = new SemanticQueryEngine({
        semanticLayer,
        columnStore: mockColumnStore,
        timeout: 1, // 1ms timeout
      })

      // Mock slow execution
      mockColumnStore.project = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return { columns: new Map(), rowCount: 0 }
      })

      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
      }

      await expect(engine.execute(semanticQuery)).rejects.toThrow(/timeout/i)
    })
  })

  describe('Performance', () => {
    it('should plan queries in under 10ms', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue', 'orders.count'],
        dimensions: ['orders.status', 'orders.region'],
        filters: [
          { dimension: 'orders.createdAt', operator: 'gte', values: ['2024-01-01'] },
        ],
      }

      const start = performance.now()
      await queryEngine.plan(semanticQuery)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(10)
    })

    it('should cache query plans for repeated queries', async () => {
      const engine = new SemanticQueryEngine({
        semanticLayer,
        columnStore: mockColumnStore,
        enableCaching: true,
      })

      const semanticQuery: SemanticQuery = {
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
      }

      // First call - should plan
      const plan1 = await engine.plan(semanticQuery)

      // Second call - should use cache
      const start = performance.now()
      const plan2 = await engine.plan(semanticQuery)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(1)
      expect(plan1).toEqual(plan2)
    })

    it('should execute simple queries in under 50ms', async () => {
      const semanticQuery: SemanticQuery = {
        measures: ['orders.count'],
        dimensions: ['orders.status'],
      }

      const start = performance.now()
      await queryEngine.execute(semanticQuery)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(50)
    })
  })
})

// =============================================================================
// UNIFIED QUERY TESTS
// =============================================================================

describe('Unified Query Planning', () => {
  let queryEngine: SemanticQueryEngine
  let mockColumnStore: TypedColumnStore

  beforeEach(() => {
    const semanticLayer = new SemanticLayer({ sqlDialect: 'postgres' })
    semanticLayer.defineCube(ordersCubeDefinition)
    semanticLayer.defineCube(customersCubeDefinition)

    mockColumnStore = {
      filter: vi.fn(),
      project: vi.fn().mockReturnValue({
        columns: new Map(),
        rowCount: 0,
      }),
      aggregate: vi.fn(),
    } as unknown as TypedColumnStore

    queryEngine = new SemanticQueryEngine({
      semanticLayer,
      columnStore: mockColumnStore,
    })
  })

  it('should support both semantic and raw SQL queries', async () => {
    // Semantic query
    const semanticResult = await queryEngine.execute({
      measures: ['orders.count'],
    })

    // Raw SQL query (through the same engine)
    const rawResult = await queryEngine.executeSQL('SELECT COUNT(*) FROM orders')

    expect(semanticResult).toBeDefined()
    expect(rawResult).toBeDefined()
  })

  it('should optimize mixed semantic and raw queries', async () => {
    // Query that combines semantic metrics with raw SQL filter
    const result = await queryEngine.execute({
      measures: ['orders.totalRevenue'],
      rawFilter: "status IN ('completed', 'shipped')",
    })

    expect(result).toBeDefined()
  })

  it('should generate comparable plans for equivalent queries', async () => {
    // Semantic query
    const semanticPlan = await queryEngine.plan({
      measures: ['orders.count'],
      filters: [
        { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
      ],
    })

    // Equivalent raw SQL
    const rawPlan = await queryEngine.planSQL(
      "SELECT COUNT(*) FROM orders WHERE status = 'completed'"
    )

    // Plans should have similar cost estimates
    expect(Math.abs(semanticPlan.estimatedCost - rawPlan.estimatedCost)).toBeLessThan(
      semanticPlan.estimatedCost * 0.1 // Within 10%
    )
  })
})
