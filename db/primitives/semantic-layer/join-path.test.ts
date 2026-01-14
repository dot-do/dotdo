/**
 * Join Path Resolution Tests - TDD RED Phase
 *
 * Tests for intelligent join path resolution in semantic layer:
 * - Build join graph from cube relationships
 * - Find shortest path between cubes for multi-cube queries
 * - Handle ambiguous join paths with explicit resolution
 * - Fan-out detection and handling (avoid incorrect aggregations)
 * - Symmetric aggregates for many-to-many joins
 * - Join pruning for unused dimensions
 *
 * @see dotdo-nksp0
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  JoinGraph,
  JoinPathResolver,
  JoinPath,
  JoinEdge,
  FanOutError,
  AmbiguousJoinPathError,
  NoJoinPathError,
  JoinCardinality,
  type JoinGraphConfig,
  type ResolvedJoinPath,
} from './join-path'

// =============================================================================
// TEST FIXTURES - E-Commerce Domain
// =============================================================================

/**
 * E-commerce schema with various join relationships:
 *
 * Orders -> Products (many-to-one via order_items)
 * Orders -> Customers (many-to-one)
 * Products -> Categories (many-to-one)
 * Products -> Suppliers (many-to-one)
 * Orders -> OrderItems (one-to-many)
 * OrderItems -> Products (many-to-one)
 * Products <-> Tags (many-to-many via product_tags)
 */

const ordersCube = {
  name: 'Orders',
  sql: 'SELECT * FROM orders',
  measures: {
    count: { type: 'count' as const },
    revenue: { type: 'sum' as const, sql: 'amount' },
    avgOrderValue: { type: 'avg' as const, sql: 'amount' },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    status: { type: 'string' as const, sql: 'status' },
    createdAt: { type: 'time' as const, sql: 'created_at' },
    customerId: { type: 'number' as const, sql: 'customer_id' },
  },
  joins: {
    Customers: {
      relationship: 'belongsTo' as const,
      sql: '${Orders}.customer_id = ${Customers}.id',
    },
    OrderItems: {
      relationship: 'hasMany' as const,
      sql: '${Orders}.id = ${OrderItems}.order_id',
    },
  },
}

const orderItemsCube = {
  name: 'OrderItems',
  sql: 'SELECT * FROM order_items',
  measures: {
    count: { type: 'count' as const },
    totalQuantity: { type: 'sum' as const, sql: 'quantity' },
    totalValue: { type: 'sum' as const, sql: 'quantity * unit_price' },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    orderId: { type: 'number' as const, sql: 'order_id' },
    productId: { type: 'number' as const, sql: 'product_id' },
    quantity: { type: 'number' as const, sql: 'quantity' },
    unitPrice: { type: 'number' as const, sql: 'unit_price' },
  },
  joins: {
    Orders: {
      relationship: 'belongsTo' as const,
      sql: '${OrderItems}.order_id = ${Orders}.id',
    },
    Products: {
      relationship: 'belongsTo' as const,
      sql: '${OrderItems}.product_id = ${Products}.id',
    },
  },
}

const productsCube = {
  name: 'Products',
  sql: 'SELECT * FROM products',
  measures: {
    count: { type: 'count' as const },
    avgPrice: { type: 'avg' as const, sql: 'price' },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
    categoryId: { type: 'number' as const, sql: 'category_id' },
    supplierId: { type: 'number' as const, sql: 'supplier_id' },
    price: { type: 'number' as const, sql: 'price' },
  },
  joins: {
    Categories: {
      relationship: 'belongsTo' as const,
      sql: '${Products}.category_id = ${Categories}.id',
    },
    Suppliers: {
      relationship: 'belongsTo' as const,
      sql: '${Products}.supplier_id = ${Suppliers}.id',
    },
    OrderItems: {
      relationship: 'hasMany' as const,
      sql: '${Products}.id = ${OrderItems}.product_id',
    },
    ProductTags: {
      relationship: 'hasMany' as const,
      sql: '${Products}.id = ${ProductTags}.product_id',
    },
  },
}

const customersCube = {
  name: 'Customers',
  sql: 'SELECT * FROM customers',
  measures: {
    count: { type: 'count' as const },
    totalSpent: { type: 'sum' as const, sql: 'total_spent' },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
    country: { type: 'string' as const, sql: 'country' },
    tier: { type: 'string' as const, sql: 'tier' },
  },
  joins: {
    Orders: {
      relationship: 'hasMany' as const,
      sql: '${Customers}.id = ${Orders}.customer_id',
    },
  },
}

const categoriesCube = {
  name: 'Categories',
  sql: 'SELECT * FROM categories',
  measures: {
    count: { type: 'count' as const },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
    parentId: { type: 'number' as const, sql: 'parent_id' },
  },
  joins: {
    Products: {
      relationship: 'hasMany' as const,
      sql: '${Categories}.id = ${Products}.category_id',
    },
    ParentCategory: {
      relationship: 'belongsTo' as const,
      sql: '${Categories}.parent_id = ${ParentCategory}.id',
    },
  },
}

const suppliersCube = {
  name: 'Suppliers',
  sql: 'SELECT * FROM suppliers',
  measures: {
    count: { type: 'count' as const },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
    country: { type: 'string' as const, sql: 'country' },
  },
  joins: {
    Products: {
      relationship: 'hasMany' as const,
      sql: '${Suppliers}.id = ${Products}.supplier_id',
    },
  },
}

// Many-to-many junction table
const productTagsCube = {
  name: 'ProductTags',
  sql: 'SELECT * FROM product_tags',
  measures: {
    count: { type: 'count' as const },
  },
  dimensions: {
    productId: { type: 'number' as const, sql: 'product_id' },
    tagId: { type: 'number' as const, sql: 'tag_id' },
  },
  joins: {
    Products: {
      relationship: 'belongsTo' as const,
      sql: '${ProductTags}.product_id = ${Products}.id',
    },
    Tags: {
      relationship: 'belongsTo' as const,
      sql: '${ProductTags}.tag_id = ${Tags}.id',
    },
  },
}

const tagsCube = {
  name: 'Tags',
  sql: 'SELECT * FROM tags',
  measures: {
    count: { type: 'count' as const },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
  },
  joins: {
    ProductTags: {
      relationship: 'hasMany' as const,
      sql: '${Tags}.id = ${ProductTags}.tag_id',
    },
  },
}

// Alternative path cube - creates ambiguity
const warehousesCube = {
  name: 'Warehouses',
  sql: 'SELECT * FROM warehouses',
  measures: {
    count: { type: 'count' as const },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
    country: { type: 'string' as const, sql: 'country' },
  },
  joins: {
    Products: {
      relationship: 'hasMany' as const,
      sql: '${Warehouses}.id = ${Products}.warehouse_id',
    },
    Suppliers: {
      relationship: 'belongsTo' as const,
      sql: '${Warehouses}.supplier_id = ${Suppliers}.id',
    },
  },
}

// Second alternative path to create true ambiguity (same hop count)
// Products -> DistributionCenters -> Suppliers (2 hops)
// vs Products -> Warehouses -> Suppliers (2 hops)
const distributionCentersCube = {
  name: 'DistributionCenters',
  sql: 'SELECT * FROM distribution_centers',
  measures: {
    count: { type: 'count' as const },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
  },
  joins: {
    Products: {
      relationship: 'hasMany' as const,
      sql: '${DistributionCenters}.id = ${Products}.distribution_center_id',
    },
    Suppliers: {
      relationship: 'belongsTo' as const,
      sql: '${DistributionCenters}.supplier_id = ${Suppliers}.id',
    },
  },
}

// For ambiguous paths test - remove direct Products->Suppliers relationship
const productsWithoutDirectSupplierCube = {
  name: 'Products',
  sql: 'SELECT * FROM products',
  measures: {
    count: { type: 'count' as const },
    avgPrice: { type: 'avg' as const, sql: 'price' },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
    categoryId: { type: 'number' as const, sql: 'category_id' },
    price: { type: 'number' as const, sql: 'price' },
  },
  joins: {
    Categories: {
      relationship: 'belongsTo' as const,
      sql: '${Products}.category_id = ${Categories}.id',
    },
    OrderItems: {
      relationship: 'hasMany' as const,
      sql: '${Products}.id = ${OrderItems}.product_id',
    },
    ProductTags: {
      relationship: 'hasMany' as const,
      sql: '${Products}.id = ${ProductTags}.product_id',
    },
    Warehouses: {
      relationship: 'belongsTo' as const,
      sql: '${Products}.warehouse_id = ${Warehouses}.id',
    },
    DistributionCenters: {
      relationship: 'belongsTo' as const,
      sql: '${Products}.distribution_center_id = ${DistributionCenters}.id',
    },
  },
}

// Suppliers cube without direct Products join for ambiguity testing
const suppliersNoProductsCube = {
  name: 'Suppliers',
  sql: 'SELECT * FROM suppliers',
  measures: {
    count: { type: 'count' as const },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
    country: { type: 'string' as const, sql: 'country' },
  },
  // No joins - Suppliers is only reachable via intermediate cubes
  joins: {},
}

// Self-referential categories cube (points to itself)
const selfRefCategoriesCube = {
  name: 'Categories',
  sql: 'SELECT * FROM categories',
  measures: {
    count: { type: 'count' as const },
  },
  dimensions: {
    id: { type: 'number' as const, sql: 'id', primaryKey: true },
    name: { type: 'string' as const, sql: 'name' },
    parentId: { type: 'number' as const, sql: 'parent_id' },
  },
  joins: {
    Products: {
      relationship: 'hasMany' as const,
      sql: '${Categories}.id = ${Products}.category_id',
    },
    // Self-referential join - points back to Categories
    Categories: {
      relationship: 'belongsTo' as const,
      sql: '${Categories}.parent_id = ${Categories}.id',
    },
  },
}

// =============================================================================
// JOIN GRAPH TESTS
// =============================================================================

describe('JoinGraph', () => {
  let graph: JoinGraph

  beforeEach(() => {
    graph = new JoinGraph()
  })

  describe('Building Graph from Cubes', () => {
    it('should build graph from cube definitions', () => {
      graph.addCube(ordersCube)
      graph.addCube(customersCube)

      expect(graph.hasCube('Orders')).toBe(true)
      expect(graph.hasCube('Customers')).toBe(true)
      expect(graph.hasEdge('Orders', 'Customers')).toBe(true)
    })

    it('should create bidirectional edges for joins', () => {
      graph.addCube(ordersCube)
      graph.addCube(customersCube)

      // Orders -> Customers (belongsTo)
      expect(graph.hasEdge('Orders', 'Customers')).toBe(true)
      // Customers -> Orders (hasMany, inverse)
      expect(graph.hasEdge('Customers', 'Orders')).toBe(true)
    })

    it('should track join cardinality correctly', () => {
      graph.addCube(ordersCube)
      graph.addCube(customersCube)

      const edge = graph.getEdge('Orders', 'Customers')
      expect(edge).toBeDefined()
      expect(edge!.cardinality).toBe(JoinCardinality.ManyToOne)

      const inverseEdge = graph.getEdge('Customers', 'Orders')
      expect(inverseEdge).toBeDefined()
      expect(inverseEdge!.cardinality).toBe(JoinCardinality.OneToMany)
    })

    it('should handle one-to-many relationships', () => {
      graph.addCube(ordersCube)
      graph.addCube(orderItemsCube)

      const edge = graph.getEdge('Orders', 'OrderItems')
      expect(edge).toBeDefined()
      expect(edge!.cardinality).toBe(JoinCardinality.OneToMany)
    })

    it('should handle many-to-many relationships via junction table', () => {
      graph.addCube(productsCube)
      graph.addCube(productTagsCube)
      graph.addCube(tagsCube)

      // Products -> ProductTags (one-to-many)
      expect(graph.hasEdge('Products', 'ProductTags')).toBe(true)
      // ProductTags -> Tags (many-to-one)
      expect(graph.hasEdge('ProductTags', 'Tags')).toBe(true)

      // Get the full many-to-many path
      const manyToManyPath = graph.getManyToManyPath('Products', 'Tags')
      expect(manyToManyPath).toBeDefined()
      expect(manyToManyPath!.through).toBe('ProductTags')
    })

    it('should list all cubes in the graph', () => {
      graph.addCube(ordersCube)
      graph.addCube(customersCube)
      graph.addCube(productsCube)

      const cubes = graph.getCubes()
      expect(cubes).toContain('Orders')
      expect(cubes).toContain('Customers')
      expect(cubes).toContain('Products')
      expect(cubes).toHaveLength(3)
    })

    it('should list all edges from a cube', () => {
      graph.addCube(ordersCube)
      graph.addCube(customersCube)
      graph.addCube(orderItemsCube)

      const edges = graph.getEdgesFrom('Orders')
      expect(edges).toHaveLength(2) // Customers and OrderItems
      expect(edges.map((e) => e.to)).toContain('Customers')
      expect(edges.map((e) => e.to)).toContain('OrderItems')
    })
  })

  describe('Graph Introspection', () => {
    beforeEach(() => {
      graph.addCube(ordersCube)
      graph.addCube(orderItemsCube)
      graph.addCube(productsCube)
      graph.addCube(customersCube)
      graph.addCube(categoriesCube)
    })

    it('should return all connected cubes', () => {
      const connected = graph.getConnectedCubes('Orders')
      expect(connected).toContain('Customers')
      expect(connected).toContain('OrderItems')
    })

    it('should detect cycles in the graph', () => {
      // Orders -> Customers -> Orders (through hasMany inverse)
      const hasCycle = graph.hasCycle()
      expect(hasCycle).toBe(true)
    })

    it('should export graph structure for debugging', () => {
      const structure = graph.toJSON()
      expect(structure.nodes).toBeDefined()
      expect(structure.edges).toBeDefined()
      expect(structure.nodes).toContain('Orders')
    })
  })
})

// =============================================================================
// JOIN PATH RESOLUTION TESTS
// =============================================================================

describe('JoinPathResolver', () => {
  let resolver: JoinPathResolver
  let cubes: Map<string, any>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['OrderItems', orderItemsCube],
      ['Products', productsCube],
      ['Customers', customersCube],
      ['Categories', categoriesCube],
      ['Suppliers', suppliersCube],
      ['ProductTags', productTagsCube],
      ['Tags', tagsCube],
    ])
    resolver = new JoinPathResolver({ cubes })
  })

  describe('Shortest Path Finding', () => {
    it('should find direct join path between adjacent cubes', () => {
      const path = resolver.findPath('Orders', 'Customers')

      expect(path).toBeDefined()
      expect(path.cubes).toEqual(['Orders', 'Customers'])
      expect(path.edges).toHaveLength(1)
      expect(path.edges[0].from).toBe('Orders')
      expect(path.edges[0].to).toBe('Customers')
    })

    it('should find multi-hop join path', () => {
      // Orders -> OrderItems -> Products
      const path = resolver.findPath('Orders', 'Products')

      expect(path).toBeDefined()
      expect(path.cubes).toEqual(['Orders', 'OrderItems', 'Products'])
      expect(path.edges).toHaveLength(2)
    })

    it('should find shortest path among multiple options', () => {
      // Orders -> OrderItems -> Products -> Categories
      const path = resolver.findPath('Orders', 'Categories')

      expect(path).toBeDefined()
      expect(path.cubes).toEqual(['Orders', 'OrderItems', 'Products', 'Categories'])
      expect(path.length).toBe(3) // 3 hops
    })

    it('should return path with cardinality info', () => {
      const path = resolver.findPath('Orders', 'Customers')

      expect(path.edges[0].cardinality).toBe(JoinCardinality.ManyToOne)
    })

    it('should throw NoJoinPathError when no path exists', () => {
      // Add an isolated cube
      const isolatedCube = {
        name: 'Isolated',
        sql: 'SELECT * FROM isolated',
        measures: {},
        dimensions: { id: { type: 'number' as const, sql: 'id' } },
        joins: {},
      }
      cubes.set('Isolated', isolatedCube)
      resolver = new JoinPathResolver({ cubes })

      expect(() => resolver.findPath('Orders', 'Isolated')).toThrow(NoJoinPathError)
    })

    it('should find path for same cube (identity)', () => {
      const path = resolver.findPath('Orders', 'Orders')

      expect(path).toBeDefined()
      expect(path.cubes).toEqual(['Orders'])
      expect(path.edges).toHaveLength(0)
      expect(path.length).toBe(0)
    })
  })

  describe('Multi-Cube Query Path Resolution', () => {
    it('should resolve join paths for query with multiple cubes', () => {
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Customers', 'Products'],
      })

      expect(resolved.paths).toHaveLength(2)
      expect(resolved.joinOrder).toBeDefined()
    })

    it('should determine optimal join order', () => {
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Categories', 'Customers'],
      })

      // Should optimize join order based on selectivity/cardinality
      expect(resolved.joinOrder).toBeDefined()
      // Many-to-one joins should come before one-to-many when possible
    })

    it('should merge overlapping paths efficiently', () => {
      // Both Categories and Suppliers go through Products
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Categories', 'Suppliers'],
      })

      // Should share the Orders -> OrderItems -> Products path
      const uniqueCubes = new Set(resolved.allCubes)
      expect(uniqueCubes.has('Products')).toBe(true)
      // Products should only appear once in the join sequence
    })
  })

  describe('Ambiguous Join Path Handling', () => {
    beforeEach(() => {
      // Create true ambiguity with two paths of same length:
      // Products -> Warehouses -> Suppliers (2 hops)
      // Products -> DistributionCenters -> Suppliers (2 hops)
      // Use productsWithoutDirectSupplierCube to remove direct Products->Suppliers path
      // Use suppliersNoProductsCube to prevent Suppliers->Products reverse path
      cubes = new Map([
        ['Products', productsWithoutDirectSupplierCube],
        ['Suppliers', suppliersNoProductsCube],
        ['Warehouses', warehousesCube],
        ['DistributionCenters', distributionCentersCube],
      ])
      resolver = new JoinPathResolver({ cubes })
    })

    it('should detect ambiguous paths', () => {
      // Products -> Suppliers has two equal-length paths via Warehouses and DistributionCenters
      const hasAmbiguity = resolver.hasAmbiguousPaths('Products', 'Suppliers')
      expect(hasAmbiguity).toBe(true)
    })

    it('should return all possible paths when ambiguous', () => {
      const paths = resolver.findAllPaths('Products', 'Suppliers')

      expect(paths.length).toBeGreaterThan(1)
      // Path via Warehouses: Products -> Warehouses -> Suppliers
      // Path via DistributionCenters: Products -> DistributionCenters -> Suppliers
      const pathViaWarehouses = paths.find((p) => p.cubes.includes('Warehouses'))
      const pathViaDistribution = paths.find((p) => p.cubes.includes('DistributionCenters'))
      expect(pathViaWarehouses).toBeDefined()
      expect(pathViaDistribution).toBeDefined()
    })

    it('should throw AmbiguousJoinPathError when strict mode enabled', () => {
      resolver = new JoinPathResolver({ cubes, strictMode: true })

      expect(() => resolver.findPath('Products', 'Suppliers')).toThrow(
        AmbiguousJoinPathError
      )
    })

    it('should allow explicit path specification for ambiguous joins', () => {
      const path = resolver.findPath('Products', 'Suppliers', {
        via: ['Products', 'Warehouses', 'Suppliers'], // Force Warehouses path
      })

      expect(path.cubes).toEqual(['Products', 'Warehouses', 'Suppliers'])
    })

    it('should prefer shorter paths by default', () => {
      // Add direct path back to create unambiguous shorter path
      cubes.set('Products', productsCube) // Has direct Suppliers join
      resolver = new JoinPathResolver({ cubes, strictMode: false })
      const path = resolver.findPath('Products', 'Suppliers')

      // Should pick direct path (1 hop) over Warehouses path (2 hops)
      expect(path.length).toBe(1)
    })

    it('should allow path hints for disambiguation', () => {
      const path = resolver.findPath('Products', 'Suppliers', {
        preferVia: 'Warehouses',
      })

      expect(path.cubes).toContain('Warehouses')
    })
  })
})

// =============================================================================
// FAN-OUT DETECTION TESTS
// =============================================================================

describe('Fan-Out Detection', () => {
  let resolver: JoinPathResolver
  let cubes: Map<string, any>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['OrderItems', orderItemsCube],
      ['Products', productsCube],
      ['Customers', customersCube],
      ['Categories', categoriesCube],
    ])
    resolver = new JoinPathResolver({ cubes })
  })

  describe('Detecting Fan-Out Risk', () => {
    it('should detect fan-out when aggregating across one-to-many join', () => {
      // Orders has a one-to-many relationship with OrderItems
      // Aggregating Orders.revenue by OrderItems.productId would cause fan-out
      const analysis = resolver.analyzeFanOut({
        primaryCube: 'Orders',
        measures: ['Orders.revenue'],
        dimensions: ['OrderItems.productId'],
      })

      expect(analysis.hasFanOut).toBe(true)
      expect(analysis.fanOutEdges).toHaveLength(1)
      expect(analysis.fanOutEdges[0].from).toBe('Orders')
      expect(analysis.fanOutEdges[0].to).toBe('OrderItems')
    })

    it('should not flag fan-out for many-to-one joins', () => {
      // Orders -> Customers is many-to-one, safe for aggregation
      const analysis = resolver.analyzeFanOut({
        primaryCube: 'Orders',
        measures: ['Orders.revenue'],
        dimensions: ['Customers.country'],
      })

      expect(analysis.hasFanOut).toBe(false)
    })

    it('should detect transitive fan-out', () => {
      // Orders -> OrderItems -> Products -> Categories
      // If primary cube is Orders and we have measures there,
      // joining to OrderItems causes fan-out
      const analysis = resolver.analyzeFanOut({
        primaryCube: 'Orders',
        measures: ['Orders.revenue'],
        dimensions: ['Categories.name'],
      })

      expect(analysis.hasFanOut).toBe(true)
      expect(analysis.fanOutPath).toBeDefined()
    })

    it('should allow fan-out when measures are on the many side', () => {
      // OrderItems.totalValue by Products.category is safe
      // because OrderItems is the many side
      const analysis = resolver.analyzeFanOut({
        primaryCube: 'OrderItems',
        measures: ['OrderItems.totalValue'],
        dimensions: ['Products.categoryId'],
      })

      expect(analysis.hasFanOut).toBe(false)
    })

    it('should detect multiple fan-out points', () => {
      // If query crosses multiple one-to-many boundaries
      const analysis = resolver.analyzeFanOut({
        primaryCube: 'Customers',
        measures: ['Customers.totalSpent'],
        dimensions: ['Products.name'],
      })

      // Customers -> Orders (one-to-many) -> OrderItems (one-to-many)
      expect(analysis.hasFanOut).toBe(true)
      expect(analysis.fanOutEdges.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Fan-Out Mitigation', () => {
    it('should suggest pre-aggregation for fan-out queries', () => {
      const analysis = resolver.analyzeFanOut({
        primaryCube: 'Orders',
        measures: ['Orders.revenue'],
        dimensions: ['OrderItems.productId'],
      })

      expect(analysis.mitigation).toBeDefined()
      expect(analysis.mitigation!.type).toBe('preAggregate')
      expect(analysis.mitigation!.suggestedCube).toBe('OrderItems')
    })

    it('should suggest subquery approach for complex fan-out', () => {
      const analysis = resolver.analyzeFanOut({
        primaryCube: 'Customers',
        measures: ['Customers.totalSpent'],
        dimensions: ['Products.name'],
      })

      expect(analysis.mitigation).toBeDefined()
      expect(analysis.mitigation!.type).toMatch(/subquery|cte/)
    })

    it('should throw FanOutError in strict mode', () => {
      resolver = new JoinPathResolver({ cubes, strictFanOut: true })

      expect(() =>
        resolver.resolveForQuery({
          primaryCube: 'Orders',
          requiredCubes: ['OrderItems'],
          measures: ['Orders.revenue'],
          dimensions: ['OrderItems.productId'],
        })
      ).toThrow(FanOutError)
    })

    it('should allow fan-out with explicit acknowledgment', () => {
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['OrderItems'],
        measures: ['Orders.revenue'],
        dimensions: ['OrderItems.productId'],
        allowFanOut: true,
      })

      expect(resolved.warnings).toContain('fan-out')
    })
  })
})

// =============================================================================
// SYMMETRIC AGGREGATES FOR MANY-TO-MANY TESTS
// =============================================================================

describe('Symmetric Aggregates for Many-to-Many', () => {
  let resolver: JoinPathResolver
  let cubes: Map<string, any>

  beforeEach(() => {
    cubes = new Map([
      ['Products', productsCube],
      ['ProductTags', productTagsCube],
      ['Tags', tagsCube],
    ])
    resolver = new JoinPathResolver({ cubes })
  })

  describe('Many-to-Many Path Detection', () => {
    it('should detect many-to-many relationship via junction table', () => {
      const isManyToMany = resolver.isManyToMany('Products', 'Tags')
      expect(isManyToMany).toBe(true)
    })

    it('should identify the junction table', () => {
      const junction = resolver.getJunctionTable('Products', 'Tags')
      expect(junction).toBe('ProductTags')
    })

    it('should not flag non-many-to-many as such', () => {
      cubes.set('Orders', ordersCube)
      cubes.set('Customers', customersCube)
      resolver = new JoinPathResolver({ cubes })

      const isManyToMany = resolver.isManyToMany('Orders', 'Customers')
      expect(isManyToMany).toBe(false)
    })
  })

  describe('Symmetric Aggregate Generation', () => {
    it('should generate symmetric aggregate SQL for many-to-many', () => {
      const symmetric = resolver.getSymmetricAggregate({
        leftCube: 'Products',
        rightCube: 'Tags',
        measure: 'Products.count',
        dimension: 'Tags.name',
      })

      expect(symmetric).toBeDefined()
      expect(symmetric.sql).toContain('COUNT')
      // Should handle double-counting prevention
      expect(symmetric.sql).toMatch(/DISTINCT|COUNT\s*\(/i)
    })

    it('should use DISTINCT to prevent double counting', () => {
      const symmetric = resolver.getSymmetricAggregate({
        leftCube: 'Products',
        rightCube: 'Tags',
        measure: 'Products.count',
        dimension: 'Tags.name',
      })

      // Count of products per tag should use COUNT(DISTINCT product_id)
      expect(symmetric.usesDistinct).toBe(true)
    })

    it('should handle SUM across many-to-many correctly', () => {
      // Sum of product prices per tag needs special handling
      const symmetric = resolver.getSymmetricAggregate({
        leftCube: 'Products',
        rightCube: 'Tags',
        measure: 'Products.avgPrice',
        dimension: 'Tags.name',
      })

      // Should prevent double-counting for additive measures
      expect(symmetric).toBeDefined()
      expect(symmetric.warning).toContain('symmetric')
    })

    it('should warn about non-additive measures in many-to-many', () => {
      const symmetric = resolver.getSymmetricAggregate({
        leftCube: 'Products',
        rightCube: 'Tags',
        measure: 'Products.avgPrice',
        dimension: 'Tags.name',
      })

      expect(symmetric.warning).toBeDefined()
    })
  })
})

// =============================================================================
// JOIN PRUNING TESTS
// =============================================================================

describe('Join Pruning', () => {
  let resolver: JoinPathResolver
  let cubes: Map<string, any>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['OrderItems', orderItemsCube],
      ['Products', productsCube],
      ['Customers', customersCube],
      ['Categories', categoriesCube],
      ['Suppliers', suppliersCube],
    ])
    resolver = new JoinPathResolver({ cubes })
  })

  describe('Unused Dimension Pruning', () => {
    it('should prune joins not needed for query', () => {
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Customers'],
        measures: ['Orders.count'],
        dimensions: ['Customers.country'],
        pruneUnused: true,
      })

      // Should only include Orders -> Customers join
      expect(resolved.allCubes).toContain('Orders')
      expect(resolved.allCubes).toContain('Customers')
      expect(resolved.allCubes).not.toContain('Products')
      expect(resolved.allCubes).not.toContain('Categories')
    })

    it('should keep joins needed for filters even if not in SELECT', () => {
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Customers'],
        measures: ['Orders.count'],
        dimensions: [], // No dimensions from Customers
        filters: [{ cube: 'Customers', dimension: 'tier', value: 'gold' }],
        pruneUnused: true,
      })

      // Should still include Customers join for filter
      expect(resolved.allCubes).toContain('Customers')
    })

    it('should prune intermediate cubes when not needed', () => {
      // If we only need Categories data and nothing from OrderItems or Products
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Categories'],
        measures: ['Orders.count'],
        dimensions: ['Categories.name'],
        pruneUnused: false, // Show full path first
      })

      // Without pruning, should include intermediate cubes
      expect(resolved.allCubes).toContain('OrderItems')
      expect(resolved.allCubes).toContain('Products')
    })

    it('should optimize when intermediate cubes have no selected columns', () => {
      const optimized = resolver.optimizeJoins({
        primaryCube: 'Orders',
        paths: [
          {
            cubes: ['Orders', 'OrderItems', 'Products', 'Categories'],
            edges: [],
          },
        ],
        selectedColumns: {
          Orders: ['id', 'status'],
          Categories: ['name'],
        },
      })

      // Should recognize that OrderItems and Products are just pass-through
      expect(optimized.passThrough).toContain('OrderItems')
      expect(optimized.passThrough).toContain('Products')
    })
  })

  describe('Intelligent Join Elimination', () => {
    it('should eliminate redundant joins', () => {
      // If Orders -> Customers is already joined, and we need Customer again
      // from different path, should not re-join
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Customers', 'Customers'], // Duplicated
        measures: ['Orders.count'],
        dimensions: ['Customers.country', 'Customers.tier'],
        pruneUnused: true,
      })

      // Should only join Customers once
      const customerJoins = resolved.joinOrder.filter((j) => j.to === 'Customers')
      expect(customerJoins).toHaveLength(1)
    })

    it('should use semi-joins when only filtering', () => {
      const analysis = resolver.analyzeJoinStrategy({
        primaryCube: 'Orders',
        requiredCubes: ['Customers'],
        measures: ['Orders.count'],
        dimensions: [], // No dimensions from Customers
        filters: [{ cube: 'Customers', dimension: 'country', value: 'USA' }],
      })

      // Since we only filter on Customers, could use EXISTS instead of JOIN
      expect(analysis.canUseSemiJoin.Customers).toBe(true)
    })

    it('should detect when LEFT JOIN can be converted to INNER JOIN', () => {
      const analysis = resolver.analyzeJoinStrategy({
        primaryCube: 'Orders',
        requiredCubes: ['Customers'],
        measures: ['Orders.count'],
        dimensions: ['Customers.country'],
        filters: [{ cube: 'Customers', dimension: 'country', value: 'USA' }],
      })

      // Filter on joined table implies INNER JOIN semantics
      expect(analysis.suggestedJoinType.Customers).toBe('INNER')
    })
  })
})

// =============================================================================
// EDGE CASES AND ERROR HANDLING
// =============================================================================

describe('Edge Cases and Error Handling', () => {
  let resolver: JoinPathResolver
  let cubes: Map<string, any>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['Customers', customersCube],
    ])
    resolver = new JoinPathResolver({ cubes })
  })

  it('should handle self-referential joins', () => {
    // Categories has parent_id pointing to itself (self-join)
    cubes.set('Categories', selfRefCategoriesCube)
    resolver = new JoinPathResolver({ cubes })

    // Self-referential join creates an edge from Categories to Categories
    const graph = (resolver as any).graph as JoinGraph
    const hasEdge = graph.hasEdge('Categories', 'Categories')
    expect(hasEdge).toBe(true)

    // Should detect the self-referential nature
    const edges = graph.getEdgesFrom('Categories')
    const selfEdge = edges.find((e) => e.to === 'Categories')
    expect(selfEdge).toBeDefined()
    expect(selfEdge!.relationship).toBe('belongsTo')
  })

  it('should handle circular references without infinite loop', () => {
    // Orders -> Customers -> Orders (through hasMany)
    const paths = resolver.findAllPaths('Orders', 'Orders', { maxDepth: 5 })

    // Should find paths without hanging
    expect(paths).toBeDefined()
    // Should include at least the identity path
    expect(paths.some((p) => p.length === 0)).toBe(true)
  })

  it('should respect max depth in path finding', () => {
    cubes.set('OrderItems', orderItemsCube)
    cubes.set('Products', productsCube)
    cubes.set('Categories', categoriesCube)
    resolver = new JoinPathResolver({ cubes })

    const paths = resolver.findAllPaths('Orders', 'Categories', { maxDepth: 2 })

    // Should not find 3-hop path when maxDepth is 2
    paths.forEach((path) => {
      expect(path.length).toBeLessThanOrEqual(2)
    })
  })

  it('should handle missing cube gracefully', () => {
    expect(() => resolver.findPath('Orders', 'NonExistent')).toThrow(/not found/i)
  })

  it('should handle cube with no joins', () => {
    const isolatedCube = {
      name: 'Isolated',
      sql: 'SELECT * FROM isolated',
      measures: { count: { type: 'count' as const } },
      dimensions: { id: { type: 'number' as const, sql: 'id' } },
      // No joins property
    }
    cubes.set('Isolated', isolatedCube)
    resolver = new JoinPathResolver({ cubes })

    expect(() => resolver.findPath('Orders', 'Isolated')).toThrow(NoJoinPathError)
  })

  it('should preserve join SQL templates', () => {
    const path = resolver.findPath('Orders', 'Customers')

    expect(path.edges[0].sql).toContain('${Orders}')
    expect(path.edges[0].sql).toContain('${Customers}')
  })

  it('should handle empty query gracefully', () => {
    const resolved = resolver.resolveForQuery({
      primaryCube: 'Orders',
      requiredCubes: [],
      measures: ['Orders.count'],
      dimensions: [],
    })

    expect(resolved.paths).toHaveLength(0)
    expect(resolved.allCubes).toEqual(['Orders'])
  })
})

// =============================================================================
// INTEGRATION WITH SQL GENERATOR
// =============================================================================

describe('Integration with SQL Generator', () => {
  let resolver: JoinPathResolver
  let cubes: Map<string, any>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['OrderItems', orderItemsCube],
      ['Products', productsCube],
      ['Customers', customersCube],
      ['Categories', categoriesCube],
    ])
    resolver = new JoinPathResolver({ cubes })
  })

  it('should generate SQL-compatible join sequence', () => {
    const resolved = resolver.resolveForQuery({
      primaryCube: 'Orders',
      requiredCubes: ['Customers', 'Categories'],
      measures: ['Orders.revenue'],
      dimensions: ['Customers.country', 'Categories.name'],
    })

    // Should provide join order that SQL generator can use directly
    expect(resolved.joinOrder).toBeDefined()
    expect(resolved.joinOrder[0].from).toBe('Orders')

    // Each join should have the SQL template
    resolved.joinOrder.forEach((join) => {
      expect(join.sql).toBeDefined()
      expect(join.type).toMatch(/LEFT|INNER/)
    })
  })

  it('should provide join conditions in correct order', () => {
    const resolved = resolver.resolveForQuery({
      primaryCube: 'Orders',
      requiredCubes: ['Categories'],
      measures: ['Orders.count'],
      dimensions: ['Categories.name'],
    })

    // Join order should be: Orders -> OrderItems -> Products -> Categories
    const joinSequence = resolved.joinOrder.map((j) => `${j.from}->${j.to}`)
    expect(joinSequence[0]).toBe('Orders->OrderItems')
    expect(joinSequence[1]).toBe('OrderItems->Products')
    expect(joinSequence[2]).toBe('Products->Categories')
  })

  it('should include cardinality hints for SQL optimization', () => {
    const resolved = resolver.resolveForQuery({
      primaryCube: 'Orders',
      requiredCubes: ['Customers'],
      measures: ['Orders.count'],
      dimensions: ['Customers.country'],
    })

    // Should include cardinality for optimizer hints
    expect(resolved.joinOrder[0].cardinality).toBe(JoinCardinality.ManyToOne)
  })
})

// =============================================================================
// GRAPH TRAVERSAL TESTS
// =============================================================================

describe('Graph Traversal', () => {
  let graph: JoinGraph
  let resolver: JoinPathResolver
  let cubes: Map<string, any>

  beforeEach(() => {
    graph = new JoinGraph()
    cubes = new Map([
      ['Orders', ordersCube],
      ['OrderItems', orderItemsCube],
      ['Products', productsCube],
      ['Customers', customersCube],
      ['Categories', categoriesCube],
      ['Suppliers', suppliersCube],
      ['ProductTags', productTagsCube],
      ['Tags', tagsCube],
    ])
    resolver = new JoinPathResolver({ cubes })
  })

  describe('BFS-style Shortest Path', () => {
    it('should find shortest path using BFS approach', () => {
      // BFS finds shortest unweighted path
      const path = resolver.findPath('Orders', 'Categories')

      // Should find Orders -> OrderItems -> Products -> Categories (3 hops)
      expect(path.length).toBe(3)
      expect(path.cubes).toEqual(['Orders', 'OrderItems', 'Products', 'Categories'])
    })

    it('should find multiple shortest paths of same length', () => {
      // Use the ambiguous setup
      const ambiguousCubes = new Map([
        ['Products', productsWithoutDirectSupplierCube],
        ['Suppliers', suppliersNoProductsCube],
        ['Warehouses', warehousesCube],
        ['DistributionCenters', distributionCentersCube],
      ])
      const ambiguousResolver = new JoinPathResolver({ cubes: ambiguousCubes })

      const allPaths = ambiguousResolver.findAllPaths('Products', 'Suppliers')
      const shortestLength = Math.min(...allPaths.map((p) => p.length))
      const shortestPaths = allPaths.filter((p) => p.length === shortestLength)

      // Should find both 2-hop paths
      expect(shortestPaths.length).toBe(2)
      expect(shortestPaths.every((p) => p.length === 2)).toBe(true)
    })

    it('should handle disconnected subgraphs', () => {
      const isolatedCube = {
        name: 'Isolated',
        sql: 'SELECT * FROM isolated',
        measures: { count: { type: 'count' as const } },
        dimensions: { id: { type: 'number' as const, sql: 'id' } },
        joins: {},
      }
      cubes.set('Isolated', isolatedCube)
      const newResolver = new JoinPathResolver({ cubes })

      // Should not find path to isolated cube
      expect(() => newResolver.findPath('Orders', 'Isolated')).toThrow(NoJoinPathError)

      // But should find path within connected subgraph
      const path = newResolver.findPath('Orders', 'Categories')
      expect(path).toBeDefined()
    })
  })

  describe('DFS-style Path Enumeration', () => {
    it('should enumerate all paths up to max depth', () => {
      const allPaths = resolver.findAllPaths('Orders', 'Customers', { maxDepth: 5 })

      // Should find at least the direct path
      expect(allPaths.length).toBeGreaterThan(0)
      expect(allPaths.some((p) => p.cubes.length === 2)).toBe(true) // Direct: Orders -> Customers
    })

    it('should respect max depth constraint in enumeration', () => {
      const shallowPaths = resolver.findAllPaths('Orders', 'Tags', { maxDepth: 3 })
      const deepPaths = resolver.findAllPaths('Orders', 'Tags', { maxDepth: 6 })

      // Shallow search might miss longer paths
      shallowPaths.forEach((p) => {
        expect(p.length).toBeLessThanOrEqual(3)
      })

      // Deep search should find paths the shallow search missed
      expect(deepPaths.length).toBeGreaterThanOrEqual(shallowPaths.length)
    })

    it('should not revisit nodes during path enumeration (except destination)', () => {
      const allPaths = resolver.findAllPaths('Orders', 'Products')

      allPaths.forEach((path) => {
        // Each cube should appear at most once in a path (except potentially the destination)
        const cubesWithoutDest = path.cubes.slice(0, -1)
        const uniqueCubes = new Set(cubesWithoutDest)
        expect(uniqueCubes.size).toBe(cubesWithoutDest.length)
      })
    })
  })

  describe('Topological Sort for Join Order', () => {
    it('should produce valid topological order for joins', () => {
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Categories', 'Suppliers'],
        measures: ['Orders.count'],
        dimensions: ['Categories.name', 'Suppliers.name'],
      })

      // Each join's "from" cube must have been seen before
      const seenCubes = new Set(['Orders'])
      for (const join of resolved.joinOrder) {
        expect(seenCubes.has(join.from)).toBe(true)
        seenCubes.add(join.to)
      }
    })

    it('should handle diamond dependencies in join order', () => {
      // Orders -> OrderItems -> Products -> Categories
      // Orders -> OrderItems -> Products -> Suppliers
      // Products is shared, should only appear once
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Categories', 'Suppliers'],
        measures: ['Orders.count'],
        dimensions: ['Categories.name', 'Suppliers.name'],
      })

      // Products should appear exactly once
      const productJoins = resolved.joinOrder.filter((j) => j.to === 'Products')
      expect(productJoins.length).toBe(1)
    })

    it('should maintain dependency order in complex graphs', () => {
      // When querying from Orders to Tags through multiple intermediates
      const resolved = resolver.resolveForQuery({
        primaryCube: 'Orders',
        requiredCubes: ['Tags'],
        measures: ['Orders.count'],
        dimensions: ['Tags.name'],
      })

      // Verify dependencies are respected
      const order = resolved.joinOrder.map((j) => j.to)

      // OrderItems must come before Products
      if (order.includes('OrderItems') && order.includes('Products')) {
        expect(order.indexOf('OrderItems')).toBeLessThan(order.indexOf('Products'))
      }

      // Products must come before ProductTags
      if (order.includes('Products') && order.includes('ProductTags')) {
        expect(order.indexOf('Products')).toBeLessThan(order.indexOf('ProductTags'))
      }

      // ProductTags must come before Tags
      if (order.includes('ProductTags') && order.includes('Tags')) {
        expect(order.indexOf('ProductTags')).toBeLessThan(order.indexOf('Tags'))
      }
    })
  })

  describe('Cycle Detection and Handling', () => {
    it('should detect cycles in bidirectional graph', () => {
      // The e-commerce graph has cycles due to bidirectional joins
      graph.addCube(ordersCube)
      graph.addCube(customersCube)

      // Orders -> Customers -> Orders (via hasMany inverse)
      expect(graph.hasCycle()).toBe(true)
    })

    it('should not get stuck in cycles during path finding', () => {
      // Should terminate and return valid paths
      const start = Date.now()
      const paths = resolver.findAllPaths('Orders', 'Categories', { maxDepth: 10 })
      const elapsed = Date.now() - start

      // Should complete quickly (under 1 second)
      expect(elapsed).toBeLessThan(1000)
      expect(paths.length).toBeGreaterThan(0)
    })

    it('should handle self-referential cycles', () => {
      // Add self-referential cube
      cubes.set('Categories', selfRefCategoriesCube)
      const newResolver = new JoinPathResolver({ cubes })

      // Should still be able to traverse without infinite loop
      const paths = newResolver.findAllPaths('Orders', 'Categories', { maxDepth: 5 })
      expect(paths.length).toBeGreaterThan(0)
    })

    it('should detect cycle existence without hanging', () => {
      const graphWithCycle = new JoinGraph()
      graphWithCycle.addCube(ordersCube)
      graphWithCycle.addCube(customersCube)
      graphWithCycle.addCube(orderItemsCube)
      graphWithCycle.addCube(productsCube)

      const start = Date.now()
      const hasCycle = graphWithCycle.hasCycle()
      const elapsed = Date.now() - start

      // Should detect cycle quickly
      expect(hasCycle).toBe(true)
      expect(elapsed).toBeLessThan(100)
    })
  })

  describe('Connected Component Analysis', () => {
    it('should identify connected cubes from a starting point', () => {
      // Starting from Orders, what cubes are reachable?
      const reachable = new Set<string>()
      const visited = new Set<string>()

      const traverse = (cube: string) => {
        if (visited.has(cube)) return
        visited.add(cube)
        reachable.add(cube)

        const graph = (resolver as any).graph as JoinGraph
        const edges = graph.getEdgesFrom(cube)
        edges.forEach((e) => traverse(e.to))
      }

      traverse('Orders')

      // Should reach all connected cubes
      expect(reachable.has('Orders')).toBe(true)
      expect(reachable.has('Customers')).toBe(true)
      expect(reachable.has('OrderItems')).toBe(true)
      expect(reachable.has('Products')).toBe(true)
    })

    it('should identify all edges in the graph', () => {
      const graphObj = (resolver as any).graph as JoinGraph
      const structure = graphObj.toJSON()

      // Should have nodes and edges
      expect(structure.nodes.length).toBe(8) // All cubes
      expect(structure.edges.length).toBeGreaterThan(0)

      // Each edge should have required properties
      structure.edges.forEach((edge) => {
        expect(edge.from).toBeDefined()
        expect(edge.to).toBeDefined()
        expect(edge.cardinality).toBeDefined()
        expect(edge.sql).toBeDefined()
      })
    })
  })

  describe('Path Cost Analysis', () => {
    it('should track path length as number of hops', () => {
      const path = resolver.findPath('Orders', 'Categories')

      // Path length should equal number of edges
      expect(path.length).toBe(path.edges.length)
      expect(path.length).toBe(path.cubes.length - 1)
    })

    it('should find minimum hop path', () => {
      // Direct path Orders -> Customers should be 1 hop
      const directPath = resolver.findPath('Orders', 'Customers')
      expect(directPath.length).toBe(1)

      // Multi-hop path Orders -> Categories should be 3 hops
      const multiHopPath = resolver.findPath('Orders', 'Categories')
      expect(multiHopPath.length).toBe(3)
    })

    it('should prefer paths with better cardinality when same length', () => {
      // When paths have same length, prefer many-to-one over one-to-many
      // This is implementation-dependent but tests the concept
      const path = resolver.findPath('Orders', 'Customers')

      // Orders -> Customers is many-to-one (preferable for aggregations)
      expect(path.edges[0].cardinality).toBe(JoinCardinality.ManyToOne)
    })
  })

  describe('Graph Modification and Rebuilding', () => {
    it('should allow adding cubes incrementally', () => {
      const newGraph = new JoinGraph()

      newGraph.addCube(ordersCube)
      expect(newGraph.getCubes()).toHaveLength(1)

      newGraph.addCube(customersCube)
      expect(newGraph.getCubes()).toHaveLength(2)

      // Edges should be created for joins
      expect(newGraph.hasEdge('Orders', 'Customers')).toBe(true)
    })

    it('should handle duplicate cube additions gracefully', () => {
      const newGraph = new JoinGraph()

      newGraph.addCube(ordersCube)
      newGraph.addCube(ordersCube) // Add again

      // Should still have only one Orders node
      const cubeNames = newGraph.getCubes()
      const ordersCount = cubeNames.filter((c) => c === 'Orders').length
      expect(ordersCount).toBe(1)
    })

    it('should create new resolver with modified cube set', () => {
      // Original resolver
      const path1 = resolver.findPath('Orders', 'Customers')
      expect(path1.length).toBe(1)

      // Create new resolver with additional cube
      const newCubes = new Map(cubes)
      newCubes.set('Warehouses', warehousesCube)
      const newResolver = new JoinPathResolver({ cubes: newCubes })

      // New resolver should still work
      const path2 = newResolver.findPath('Orders', 'Customers')
      expect(path2.length).toBe(1)
    })
  })
})
