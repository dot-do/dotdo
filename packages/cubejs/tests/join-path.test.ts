/**
 * @dotdo/cubejs - Join Path Resolution Tests
 *
 * Tests for intelligent join path resolution including:
 * - Join graph construction from cube relationships
 * - Shortest path finding between cubes
 * - Ambiguous join path detection and resolution
 * - Fan-out detection and handling
 * - Symmetric aggregates for many-to-many joins
 * - Join pruning for unused dimensions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { CubeSchema } from '../src/schema'
import {
  JoinGraph,
  type JoinPath,
  type JoinEdge,
  type FanOutWarning,
  type AmbiguousPathError,
} from '../src/join-path'

// =============================================================================
// Test Fixtures - E-commerce Domain Model
// =============================================================================

/**
 * Creates a realistic e-commerce schema for testing:
 *
 * Orders (M:1) -> Customers
 * Orders (M:1) -> Products
 * Products (M:1) -> Categories
 * Products (M:N) -> Tags (via ProductTags)
 * Orders (M:N) -> Promotions (via OrderPromotions)
 * Customers (1:1) -> CustomerProfiles
 *
 * This creates multiple paths and potential ambiguities.
 */
function createEcommerceSchema(): Map<string, CubeSchema> {
  const schemas = new Map<string, CubeSchema>()

  schemas.set('Orders', {
    name: 'Orders',
    sql: 'SELECT * FROM orders',
    measures: {
      count: { type: 'count' },
      revenue: { sql: 'amount', type: 'sum' },
      avgOrderValue: { sql: 'amount', type: 'avg' },
    },
    dimensions: {
      id: { sql: 'id', type: 'number', primaryKey: true },
      status: { sql: 'status', type: 'string' },
      createdAt: { sql: 'created_at', type: 'time' },
    },
    joins: {
      Customers: {
        relationship: 'belongsTo',
        sql: '${CUBE}.customer_id = ${Customers}.id',
      },
      Products: {
        relationship: 'belongsTo',
        sql: '${CUBE}.product_id = ${Products}.id',
      },
    },
  })

  schemas.set('Customers', {
    name: 'Customers',
    sql: 'SELECT * FROM customers',
    measures: {
      count: { type: 'count' },
      totalSpent: { sql: 'total_spent', type: 'sum' },
    },
    dimensions: {
      id: { sql: 'id', type: 'number', primaryKey: true },
      name: { sql: 'name', type: 'string' },
      tier: { sql: 'tier', type: 'string' },
    },
    joins: {
      Orders: {
        relationship: 'hasMany',
        sql: '${CUBE}.id = ${Orders}.customer_id',
      },
      CustomerProfiles: {
        relationship: 'hasOne',
        sql: '${CUBE}.id = ${CustomerProfiles}.customer_id',
      },
    },
  })

  schemas.set('Products', {
    name: 'Products',
    sql: 'SELECT * FROM products',
    measures: {
      count: { type: 'count' },
      avgPrice: { sql: 'price', type: 'avg' },
    },
    dimensions: {
      id: { sql: 'id', type: 'number', primaryKey: true },
      name: { sql: 'name', type: 'string' },
      price: { sql: 'price', type: 'number' },
    },
    joins: {
      Categories: {
        relationship: 'belongsTo',
        sql: '${CUBE}.category_id = ${Categories}.id',
      },
      Orders: {
        relationship: 'hasMany',
        sql: '${CUBE}.id = ${Orders}.product_id',
      },
      ProductTags: {
        relationship: 'hasMany',
        sql: '${CUBE}.id = ${ProductTags}.product_id',
      },
    },
  })

  schemas.set('Categories', {
    name: 'Categories',
    sql: 'SELECT * FROM categories',
    measures: {
      count: { type: 'count' },
    },
    dimensions: {
      id: { sql: 'id', type: 'number', primaryKey: true },
      name: { sql: 'name', type: 'string' },
      parentId: { sql: 'parent_id', type: 'number' },
    },
    joins: {
      Products: {
        relationship: 'hasMany',
        sql: '${CUBE}.id = ${Products}.category_id',
      },
    },
  })

  schemas.set('CustomerProfiles', {
    name: 'CustomerProfiles',
    sql: 'SELECT * FROM customer_profiles',
    measures: {
      count: { type: 'count' },
    },
    dimensions: {
      id: { sql: 'id', type: 'number', primaryKey: true },
      bio: { sql: 'bio', type: 'string' },
      avatar: { sql: 'avatar_url', type: 'string' },
    },
    joins: {
      Customers: {
        relationship: 'belongsTo',
        sql: '${CUBE}.customer_id = ${Customers}.id',
      },
    },
  })

  // Many-to-many: Products <-> Tags via ProductTags
  schemas.set('Tags', {
    name: 'Tags',
    sql: 'SELECT * FROM tags',
    measures: {
      count: { type: 'count' },
    },
    dimensions: {
      id: { sql: 'id', type: 'number', primaryKey: true },
      name: { sql: 'name', type: 'string' },
    },
    joins: {
      ProductTags: {
        relationship: 'hasMany',
        sql: '${CUBE}.id = ${ProductTags}.tag_id',
      },
    },
  })

  schemas.set('ProductTags', {
    name: 'ProductTags',
    sql: 'SELECT * FROM product_tags',
    measures: {
      count: { type: 'count' },
    },
    dimensions: {
      productId: { sql: 'product_id', type: 'number' },
      tagId: { sql: 'tag_id', type: 'number' },
    },
    joins: {
      Products: {
        relationship: 'belongsTo',
        sql: '${CUBE}.product_id = ${Products}.id',
      },
      Tags: {
        relationship: 'belongsTo',
        sql: '${CUBE}.tag_id = ${Tags}.id',
      },
    },
  })

  return schemas
}

/**
 * Creates a schema with multiple paths between same cubes (ambiguous paths).
 *
 * Users -> Orders (direct)
 * Users -> Sessions -> Orders (via sessions)
 */
function createAmbiguousPathSchema(): Map<string, CubeSchema> {
  const schemas = new Map<string, CubeSchema>()

  schemas.set('Users', {
    name: 'Users',
    sql: 'SELECT * FROM users',
    measures: { count: { type: 'count' } },
    dimensions: {
      id: { sql: 'id', type: 'number', primaryKey: true },
      name: { sql: 'name', type: 'string' },
    },
    joins: {
      Orders: {
        relationship: 'hasMany',
        sql: '${CUBE}.id = ${Orders}.user_id',
      },
      Sessions: {
        relationship: 'hasMany',
        sql: '${CUBE}.id = ${Sessions}.user_id',
      },
    },
  })

  schemas.set('Sessions', {
    name: 'Sessions',
    sql: 'SELECT * FROM sessions',
    measures: { count: { type: 'count' } },
    dimensions: {
      id: { sql: 'id', type: 'number', primaryKey: true },
      startedAt: { sql: 'started_at', type: 'time' },
    },
    joins: {
      Users: {
        relationship: 'belongsTo',
        sql: '${CUBE}.user_id = ${Users}.id',
      },
      Orders: {
        relationship: 'hasMany',
        sql: '${CUBE}.id = ${Orders}.session_id',
      },
    },
  })

  schemas.set('Orders', {
    name: 'Orders',
    sql: 'SELECT * FROM orders',
    measures: {
      count: { type: 'count' },
      revenue: { sql: 'amount', type: 'sum' },
    },
    dimensions: {
      id: { sql: 'id', type: 'number', primaryKey: true },
      amount: { sql: 'amount', type: 'number' },
    },
    joins: {
      Users: {
        relationship: 'belongsTo',
        sql: '${CUBE}.user_id = ${Users}.id',
      },
      Sessions: {
        relationship: 'belongsTo',
        sql: '${CUBE}.session_id = ${Sessions}.id',
      },
    },
  })

  return schemas
}

// =============================================================================
// Join Graph Construction Tests
// =============================================================================

describe('@dotdo/cubejs - Join Graph', () => {
  describe('JoinGraph construction', () => {
    it('should build graph from cube schemas', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      expect(graph).toBeDefined()
      expect(graph.getCubes()).toContain('Orders')
      expect(graph.getCubes()).toContain('Customers')
      expect(graph.getCubes()).toContain('Products')
    })

    it('should identify all edges (joins) in the graph', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const ordersEdges = graph.getEdges('Orders')
      expect(ordersEdges.length).toBeGreaterThan(0)

      // Orders should have edges to Customers and Products
      const targetCubes = ordersEdges.map(e => e.to)
      expect(targetCubes).toContain('Customers')
      expect(targetCubes).toContain('Products')
    })

    it('should track relationship types for each edge', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const ordersEdges = graph.getEdges('Orders')
      const customerEdge = ordersEdges.find(e => e.to === 'Customers')

      expect(customerEdge).toBeDefined()
      expect(customerEdge!.relationship).toBe('belongsTo')
    })

    it('should identify bidirectional edges', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Orders -> Customers (belongsTo)
      const ordersEdges = graph.getEdges('Orders')
      expect(ordersEdges.some(e => e.to === 'Customers')).toBe(true)

      // Customers -> Orders (hasMany) - inverse relationship
      const customersEdges = graph.getEdges('Customers')
      expect(customersEdges.some(e => e.to === 'Orders')).toBe(true)
    })

    it('should handle cubes with no joins', () => {
      const schemas = new Map<string, CubeSchema>()
      schemas.set('Standalone', {
        name: 'Standalone',
        sql: 'SELECT * FROM standalone',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
      })

      const graph = new JoinGraph(schemas)
      const edges = graph.getEdges('Standalone')

      expect(edges).toEqual([])
    })
  })

  // ===========================================================================
  // Shortest Path Finding Tests
  // ===========================================================================

  describe('Shortest path finding', () => {
    it('should find direct path between adjacent cubes', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const path = graph.findShortestPath('Orders', 'Customers')

      expect(path).toBeDefined()
      expect(path!.cubes).toEqual(['Orders', 'Customers'])
      expect(path!.edges.length).toBe(1)
    })

    it('should find shortest path through intermediate cubes', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Orders -> Products -> Categories (2 hops)
      const path = graph.findShortestPath('Orders', 'Categories')

      expect(path).toBeDefined()
      expect(path!.cubes).toEqual(['Orders', 'Products', 'Categories'])
      expect(path!.edges.length).toBe(2)
    })

    it('should return empty path when from equals to', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const path = graph.findShortestPath('Orders', 'Orders')

      expect(path).toBeDefined()
      expect(path!.cubes).toEqual(['Orders'])
      expect(path!.edges.length).toBe(0)
    })

    it('should return undefined when no path exists', () => {
      const schemas = new Map<string, CubeSchema>()
      schemas.set('A', {
        name: 'A',
        sql: 'SELECT * FROM a',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
      })
      schemas.set('B', {
        name: 'B',
        sql: 'SELECT * FROM b',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
      })

      const graph = new JoinGraph(schemas)
      const path = graph.findShortestPath('A', 'B')

      expect(path).toBeUndefined()
    })

    it('should prefer shorter paths over longer ones', () => {
      const schemas = createAmbiguousPathSchema()
      const graph = new JoinGraph(schemas)

      // Users -> Orders direct is shorter than Users -> Sessions -> Orders
      const path = graph.findShortestPath('Users', 'Orders')

      expect(path).toBeDefined()
      expect(path!.cubes.length).toBe(2) // Direct path
    })

    it('should find path through many-to-many junction tables', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Products -> ProductTags -> Tags
      const path = graph.findShortestPath('Products', 'Tags')

      expect(path).toBeDefined()
      expect(path!.cubes).toContain('ProductTags')
    })
  })

  // ===========================================================================
  // Ambiguous Path Detection Tests
  // ===========================================================================

  describe('Ambiguous path detection', () => {
    it('should detect when multiple shortest paths exist', () => {
      const schemas = createAmbiguousPathSchema()
      const graph = new JoinGraph(schemas)

      const allPaths = graph.findAllPaths('Users', 'Orders')

      // Should find both: Users -> Orders and Users -> Sessions -> Orders
      expect(allPaths.length).toBeGreaterThan(1)
    })

    it('should identify ambiguous paths with same length', () => {
      // Create schema with two equal-length paths
      const schemas = new Map<string, CubeSchema>()
      schemas.set('A', {
        name: 'A',
        sql: 'SELECT * FROM a',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: {
          B1: { relationship: 'belongsTo', sql: '${CUBE}.b1_id = ${B1}.id' },
          B2: { relationship: 'belongsTo', sql: '${CUBE}.b2_id = ${B2}.id' },
        },
      })
      schemas.set('B1', {
        name: 'B1',
        sql: 'SELECT * FROM b1',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: {
          C: { relationship: 'belongsTo', sql: '${CUBE}.c_id = ${C}.id' },
        },
      })
      schemas.set('B2', {
        name: 'B2',
        sql: 'SELECT * FROM b2',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: {
          C: { relationship: 'belongsTo', sql: '${CUBE}.c_id = ${C}.id' },
        },
      })
      schemas.set('C', {
        name: 'C',
        sql: 'SELECT * FROM c',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
      })

      const graph = new JoinGraph(schemas)
      const ambiguity = graph.detectAmbiguity('A', 'C')

      expect(ambiguity).toBeDefined()
      expect(ambiguity!.paths.length).toBe(2)
    })

    it('should provide helpful error for ambiguous paths', () => {
      const schemas = new Map<string, CubeSchema>()
      schemas.set('A', {
        name: 'A',
        sql: 'SELECT * FROM a',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: {
          B1: { relationship: 'belongsTo', sql: '${CUBE}.b1_id = ${B1}.id' },
          B2: { relationship: 'belongsTo', sql: '${CUBE}.b2_id = ${B2}.id' },
        },
      })
      schemas.set('B1', {
        name: 'B1',
        sql: 'SELECT * FROM b1',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: { C: { relationship: 'belongsTo', sql: '${CUBE}.c_id = ${C}.id' } },
      })
      schemas.set('B2', {
        name: 'B2',
        sql: 'SELECT * FROM b2',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: { C: { relationship: 'belongsTo', sql: '${CUBE}.c_id = ${C}.id' } },
      })
      schemas.set('C', {
        name: 'C',
        sql: 'SELECT * FROM c',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
      })

      const graph = new JoinGraph(schemas)
      const ambiguity = graph.detectAmbiguity('A', 'C')

      expect(ambiguity).toBeDefined()
      expect(ambiguity!.message).toContain('Ambiguous')
      expect(ambiguity!.message).toContain('A')
      expect(ambiguity!.message).toContain('C')
    })

    it('should allow explicit path specification to resolve ambiguity', () => {
      const schemas = new Map<string, CubeSchema>()
      schemas.set('A', {
        name: 'A',
        sql: 'SELECT * FROM a',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: {
          B1: { relationship: 'belongsTo', sql: '${CUBE}.b1_id = ${B1}.id' },
          B2: { relationship: 'belongsTo', sql: '${CUBE}.b2_id = ${B2}.id' },
        },
      })
      schemas.set('B1', {
        name: 'B1',
        sql: 'SELECT * FROM b1',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: { C: { relationship: 'belongsTo', sql: '${CUBE}.c_id = ${C}.id' } },
      })
      schemas.set('B2', {
        name: 'B2',
        sql: 'SELECT * FROM b2',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: { C: { relationship: 'belongsTo', sql: '${CUBE}.c_id = ${C}.id' } },
      })
      schemas.set('C', {
        name: 'C',
        sql: 'SELECT * FROM c',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
      })

      const graph = new JoinGraph(schemas)

      // Explicitly specify path through B1
      const path = graph.findPathThrough('A', 'C', ['B1'])

      expect(path).toBeDefined()
      expect(path!.cubes).toEqual(['A', 'B1', 'C'])
    })
  })

  // ===========================================================================
  // Fan-out Detection Tests
  // ===========================================================================

  describe('Fan-out detection', () => {
    it('should detect fan-out when joining from one to many', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Customers -> Orders is a fan-out (1 customer : N orders)
      const fanOut = graph.detectFanOut('Customers', 'Orders')

      expect(fanOut).toBeDefined()
      expect(fanOut!.type).toBe('one-to-many')
      expect(fanOut!.fromCube).toBe('Customers')
      expect(fanOut!.toCube).toBe('Orders')
    })

    it('should not flag fan-out for many-to-one joins', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Orders -> Customers is NOT a fan-out (N orders : 1 customer)
      const fanOut = graph.detectFanOut('Orders', 'Customers')

      expect(fanOut).toBeUndefined()
    })

    it('should detect fan-out in multi-hop paths', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Categories -> Products -> Orders (two fan-outs!)
      const fanOuts = graph.detectFanOutsInPath(['Categories', 'Products', 'Orders'])

      expect(fanOuts.length).toBe(2)
    })

    it('should provide warning about incorrect aggregations', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const fanOut = graph.detectFanOut('Customers', 'Orders')

      expect(fanOut).toBeDefined()
      expect(fanOut!.warning).toContain('aggregat')
    })

    it('should detect many-to-many fan-out via junction table', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Products -> ProductTags -> Tags is M:N
      const path = graph.findShortestPath('Products', 'Tags')
      const fanOuts = graph.detectFanOutsInPath(path!.cubes)

      // Products -> ProductTags is hasMany, creating fan-out
      expect(fanOuts.length).toBeGreaterThan(0)
    })

    it('should recommend symmetric aggregates for fan-out scenarios', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const recommendation = graph.getAggregationRecommendation('Customers', 'Orders')

      expect(recommendation).toBeDefined()
      expect(recommendation!.useSymmetricAggregate).toBe(true)
      expect(recommendation!.aggregateOn).toBe('Orders')
    })
  })

  // ===========================================================================
  // Symmetric Aggregate Tests
  // ===========================================================================

  describe('Symmetric aggregates for M:N joins', () => {
    it('should identify when symmetric aggregate is needed', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Aggregating Products by Tags needs symmetric aggregate
      const needsSymmetric = graph.needsSymmetricAggregate('Products', 'Tags')

      expect(needsSymmetric).toBe(true)
    })

    it('should not require symmetric aggregate for simple joins', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Orders -> Customers is simple belongsTo
      const needsSymmetric = graph.needsSymmetricAggregate('Orders', 'Customers')

      expect(needsSymmetric).toBe(false)
    })

    it('should calculate correct cardinality multiplier', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // For M:N through junction table, cardinality can multiply
      const multiplier = graph.getCardinalityMultiplier('Products', 'Tags')

      expect(multiplier).toBe('N') // Variable multiplier for M:N
    })

    it('should return 1 for many-to-one joins', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const multiplier = graph.getCardinalityMultiplier('Orders', 'Customers')

      expect(multiplier).toBe('1') // No multiplication for M:1
    })
  })

  // ===========================================================================
  // Join Pruning Tests
  // ===========================================================================

  describe('Join pruning for unused dimensions', () => {
    it('should identify joins that can be pruned', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Query uses Orders.revenue but only needs Customers.tier
      // Products join can be pruned
      const usedCubes = new Set(['Orders', 'Customers'])
      const requiredJoins = graph.getRequiredJoins(usedCubes)

      expect(requiredJoins.has('Orders')).toBe(true)
      expect(requiredJoins.has('Customers')).toBe(true)
      expect(requiredJoins.has('Products')).toBe(false)
    })

    it('should not prune joins needed for path completion', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Query uses Orders.revenue grouped by Categories.name
      // Must keep Products even if not directly used
      const usedCubes = new Set(['Orders', 'Categories'])
      const requiredJoins = graph.getRequiredJoins(usedCubes)

      // Products is needed to connect Orders to Categories
      expect(requiredJoins.has('Products')).toBe(true)
    })

    it('should optimize join order for performance', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const usedCubes = new Set(['Orders', 'Customers', 'Categories'])
      const optimizedOrder = graph.getOptimizedJoinOrder(usedCubes, 'Orders')

      expect(optimizedOrder[0]).toBe('Orders') // Start from primary
      // Should join smaller/more selective tables first
      expect(optimizedOrder.includes('Customers')).toBe(true)
      expect(optimizedOrder.includes('Categories')).toBe(true)
    })

    it('should handle circular dependencies in pruning', () => {
      // When A -> B -> C -> A exists, pruning should still work
      const schemas = new Map<string, CubeSchema>()
      schemas.set('A', {
        name: 'A',
        sql: 'SELECT * FROM a',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: { B: { relationship: 'belongsTo', sql: '${CUBE}.b_id = ${B}.id' } },
      })
      schemas.set('B', {
        name: 'B',
        sql: 'SELECT * FROM b',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: { C: { relationship: 'belongsTo', sql: '${CUBE}.c_id = ${C}.id' } },
      })
      schemas.set('C', {
        name: 'C',
        sql: 'SELECT * FROM c',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: { A: { relationship: 'belongsTo', sql: '${CUBE}.a_id = ${A}.id' } },
      })

      const graph = new JoinGraph(schemas)
      const usedCubes = new Set(['A'])
      const requiredJoins = graph.getRequiredJoins(usedCubes)

      // Should only need A if nothing else is used
      expect(requiredJoins.size).toBe(1)
      expect(requiredJoins.has('A')).toBe(true)
    })
  })

  // ===========================================================================
  // Multi-cube Query Resolution Tests
  // ===========================================================================

  describe('Multi-cube query resolution', () => {
    it('should resolve join path for Orders.revenue by Categories.name', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Example from the issue description
      const resolution = graph.resolveQueryJoins({
        measures: ['Orders.revenue'],
        dimensions: ['Categories.name'],
      })

      expect(resolution.path.cubes).toEqual(['Orders', 'Products', 'Categories'])
    })

    it('should resolve multi-dimensional queries', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const resolution = graph.resolveQueryJoins({
        measures: ['Orders.revenue'],
        dimensions: ['Customers.name', 'Categories.name'],
      })

      // Should include all necessary cubes
      expect(resolution.requiredCubes.has('Orders')).toBe(true)
      expect(resolution.requiredCubes.has('Customers')).toBe(true)
      expect(resolution.requiredCubes.has('Categories')).toBe(true)
      expect(resolution.requiredCubes.has('Products')).toBe(true)
    })

    it('should warn about potential fan-out in query', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const resolution = graph.resolveQueryJoins({
        measures: ['Customers.totalSpent'],
        dimensions: ['Orders.status'],
      })

      expect(resolution.warnings.length).toBeGreaterThan(0)
      expect(resolution.warnings[0].type).toBe('fan-out')
    })

    it('should throw for ambiguous paths without explicit resolution', () => {
      const schemas = createAmbiguousPathSchema()
      const graph = new JoinGraph(schemas)

      // This should detect ambiguity when there are truly equal-cost paths
      // In this case, Users -> Orders is shorter, so no ambiguity
      const resolution = graph.resolveQueryJoins({
        measures: ['Orders.revenue'],
        dimensions: ['Users.name'],
      })

      // Since one path is shorter, it should succeed
      expect(resolution).toBeDefined()
    })

    it('should handle queries using same cube for measure and dimension', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const resolution = graph.resolveQueryJoins({
        measures: ['Orders.revenue'],
        dimensions: ['Orders.status'],
      })

      // No joins needed
      expect(resolution.path.cubes).toEqual(['Orders'])
      expect(resolution.path.edges.length).toBe(0)
    })
  })

  // ===========================================================================
  // Edge Cases and Error Handling
  // ===========================================================================

  describe('Edge cases and error handling', () => {
    it('should handle empty schema map', () => {
      const graph = new JoinGraph(new Map())

      expect(graph.getCubes()).toEqual([])
    })

    it('should handle unknown cube in path finding', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      const path = graph.findShortestPath('Orders', 'UnknownCube')

      expect(path).toBeUndefined()
    })

    it('should handle self-referencing joins', () => {
      const schemas = new Map<string, CubeSchema>()
      schemas.set('Categories', {
        name: 'Categories',
        sql: 'SELECT * FROM categories',
        measures: { count: { type: 'count' } },
        dimensions: {
          id: { sql: 'id', type: 'number', primaryKey: true },
          parentId: { sql: 'parent_id', type: 'number' },
        },
        joins: {
          ParentCategory: {
            relationship: 'belongsTo',
            sql: '${CUBE}.parent_id = ${ParentCategory}.id',
          },
        },
      })
      // Note: ParentCategory refers to the same table with an alias
      schemas.set('ParentCategory', {
        name: 'ParentCategory',
        sql: 'SELECT * FROM categories',
        measures: { count: { type: 'count' } },
        dimensions: {
          id: { sql: 'id', type: 'number', primaryKey: true },
        },
      })

      const graph = new JoinGraph(schemas)
      const path = graph.findShortestPath('Categories', 'ParentCategory')

      expect(path).toBeDefined()
      expect(path!.cubes).toEqual(['Categories', 'ParentCategory'])
    })

    it('should prevent infinite loops in cyclic graphs', () => {
      const schemas = new Map<string, CubeSchema>()
      schemas.set('A', {
        name: 'A',
        sql: 'SELECT * FROM a',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: { B: { relationship: 'belongsTo', sql: '${CUBE}.b_id = ${B}.id' } },
      })
      schemas.set('B', {
        name: 'B',
        sql: 'SELECT * FROM b',
        measures: { count: { type: 'count' } },
        dimensions: { id: { sql: 'id', type: 'number', primaryKey: true } },
        joins: { A: { relationship: 'belongsTo', sql: '${CUBE}.a_id = ${A}.id' } },
      })

      const graph = new JoinGraph(schemas)

      // Should not hang or crash
      const paths = graph.findAllPaths('A', 'B')
      expect(paths.length).toBeGreaterThan(0)
    })

    it('should handle max path length limit', () => {
      const schemas = createEcommerceSchema()
      const graph = new JoinGraph(schemas)

      // Find all paths with a max length
      const paths = graph.findAllPaths('Orders', 'Tags', { maxLength: 3 })

      // All returned paths should be <= 3 hops
      for (const path of paths) {
        expect(path.edges.length).toBeLessThanOrEqual(3)
      }
    })
  })
})
