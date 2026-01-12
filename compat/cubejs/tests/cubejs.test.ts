/**
 * @dotdo/cubejs - Cube.js Compatibility Layer Tests
 *
 * Tests for the Cube.js semantic layer compatibility including:
 * - Cube schema definitions (measures, dimensions, joins)
 * - Query API (dimensions, measures, filters, timeDimensions)
 * - Pre-aggregations for performance
 * - SQL generation from cube queries
 * - Multi-tenancy support
 * - REST API compatibility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Schema
  cube,
  CubeSchema,
  Measure,
  Dimension,
  Join,
  PreAggregation,

  // Query
  CubeQuery,
  QueryBuilder,
  Filter,
  TimeDimension,

  // Client
  CubeClient,
  CubeClientOptions,

  // Cache
  PreAggregationCache,

  // API
  CubeAPI,
  createCubeAPI,

  // Errors
  CubeError,
  ValidationError,
  QueryError,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

const ordersSchema: CubeSchema = {
  name: 'Orders',
  sql: 'SELECT * FROM orders',

  measures: {
    count: {
      type: 'count',
    },
    totalAmount: {
      sql: 'amount',
      type: 'sum',
    },
    avgAmount: {
      sql: 'amount',
      type: 'avg',
    },
    totalRevenue: {
      sql: 'price * quantity',
      type: 'sum',
    },
    runningTotal: {
      sql: 'amount',
      type: 'runningTotal',
    },
    uniqueCustomers: {
      sql: 'customer_id',
      type: 'countDistinct',
    },
  },

  dimensions: {
    id: {
      sql: 'id',
      type: 'number',
      primaryKey: true,
    },
    status: {
      sql: 'status',
      type: 'string',
    },
    createdAt: {
      sql: 'created_at',
      type: 'time',
    },
    customerId: {
      sql: 'customer_id',
      type: 'number',
    },
    amount: {
      sql: 'amount',
      type: 'number',
    },
  },

  joins: {
    Customers: {
      relationship: 'belongsTo',
      sql: '${CUBE}.customer_id = ${Customers}.id',
    },
  },

  preAggregations: {
    ordersDaily: {
      type: 'rollup',
      measureReferences: ['count', 'totalAmount'],
      dimensionReferences: ['status'],
      timeDimensionReference: 'createdAt',
      granularity: 'day',
    },
  },
}

const customersSchema: CubeSchema = {
  name: 'Customers',
  sql: 'SELECT * FROM customers',

  measures: {
    count: {
      type: 'count',
    },
    totalSpent: {
      sql: 'total_spent',
      type: 'sum',
    },
  },

  dimensions: {
    id: {
      sql: 'id',
      type: 'number',
      primaryKey: true,
    },
    name: {
      sql: 'name',
      type: 'string',
    },
    email: {
      sql: 'email',
      type: 'string',
    },
    tier: {
      sql: 'tier',
      type: 'string',
    },
    createdAt: {
      sql: 'created_at',
      type: 'time',
    },
  },
}

const productsSchema: CubeSchema = {
  name: 'Products',
  sql: 'SELECT * FROM products',

  measures: {
    count: {
      type: 'count',
    },
    avgPrice: {
      sql: 'price',
      type: 'avg',
    },
  },

  dimensions: {
    id: {
      sql: 'id',
      type: 'number',
      primaryKey: true,
    },
    name: {
      sql: 'name',
      type: 'string',
    },
    category: {
      sql: 'category',
      type: 'string',
    },
    price: {
      sql: 'price',
      type: 'number',
    },
  },
}

// =============================================================================
// Cube Schema Tests
// =============================================================================

describe('@dotdo/cubejs - Schema', () => {
  describe('cube()', () => {
    it('should create a cube schema', () => {
      const schema = cube('Orders', ordersSchema)

      expect(schema.name).toBe('Orders')
      expect(schema.measures).toBeDefined()
      expect(schema.dimensions).toBeDefined()
      expect(schema.measures.count).toBeDefined()
      expect(schema.dimensions.status).toBeDefined()
    })

    it('should validate measure types', () => {
      expect(() => cube('Invalid', {
        name: 'Invalid',
        sql: 'SELECT * FROM t',
        measures: {
          bad: {
            type: 'invalid' as any,
          },
        },
        dimensions: {},
      })).toThrow(ValidationError)
    })

    it('should validate dimension types', () => {
      expect(() => cube('Invalid', {
        name: 'Invalid',
        sql: 'SELECT * FROM t',
        measures: {},
        dimensions: {
          bad: {
            sql: 'x',
            type: 'invalid' as any,
          },
        },
      })).toThrow(ValidationError)
    })

    it('should support computed measures', () => {
      const schema = cube('Orders', {
        ...ordersSchema,
        measures: {
          ...ordersSchema.measures,
          avgOrderValue: {
            sql: '${totalAmount} / ${count}',
            type: 'number',
          },
        },
      })

      expect(schema.measures.avgOrderValue).toBeDefined()
      expect(schema.measures.avgOrderValue.type).toBe('number')
    })

    it('should support dimension hierarchies', () => {
      const schema = cube('Location', {
        name: 'Location',
        sql: 'SELECT * FROM locations',
        measures: { count: { type: 'count' } },
        dimensions: {
          country: { sql: 'country', type: 'string' },
          state: { sql: 'state', type: 'string' },
          city: { sql: 'city', type: 'string' },
          fullLocation: {
            sql: "CONCAT(${country}, ' - ', ${state}, ' - ', ${city})",
            type: 'string',
          },
        },
      })

      expect(schema.dimensions.fullLocation).toBeDefined()
    })
  })

  describe('Joins', () => {
    it('should define belongsTo relationships', () => {
      const schema = cube('Orders', ordersSchema)

      expect(schema.joins).toBeDefined()
      expect(schema.joins!.Customers).toBeDefined()
      expect(schema.joins!.Customers.relationship).toBe('belongsTo')
    })

    it('should define hasMany relationships', () => {
      const schema = cube('Customers', {
        ...customersSchema,
        joins: {
          Orders: {
            relationship: 'hasMany',
            sql: '${CUBE}.id = ${Orders}.customer_id',
          },
        },
      })

      expect(schema.joins!.Orders.relationship).toBe('hasMany')
    })

    it('should define hasOne relationships', () => {
      const schema = cube('Users', {
        name: 'Users',
        sql: 'SELECT * FROM users',
        measures: { count: { type: 'count' } },
        dimensions: {
          id: { sql: 'id', type: 'number', primaryKey: true },
        },
        joins: {
          Profile: {
            relationship: 'hasOne',
            sql: '${CUBE}.id = ${Profile}.user_id',
          },
        },
      })

      expect(schema.joins!.Profile.relationship).toBe('hasOne')
    })
  })

  describe('Pre-aggregations', () => {
    it('should define rollup pre-aggregations', () => {
      const schema = cube('Orders', ordersSchema)

      expect(schema.preAggregations).toBeDefined()
      expect(schema.preAggregations!.ordersDaily).toBeDefined()
      expect(schema.preAggregations!.ordersDaily.type).toBe('rollup')
    })

    it('should define original SQL pre-aggregations', () => {
      const schema = cube('Orders', {
        ...ordersSchema,
        preAggregations: {
          ...ordersSchema.preAggregations,
          ordersRaw: {
            type: 'originalSql',
            refreshKey: {
              every: '1 hour',
            },
          },
        },
      })

      expect(schema.preAggregations!.ordersRaw.type).toBe('originalSql')
    })

    it('should support partition granularity', () => {
      const schema = cube('Orders', {
        ...ordersSchema,
        preAggregations: {
          ordersMonthly: {
            type: 'rollup',
            measureReferences: ['count'],
            timeDimensionReference: 'createdAt',
            granularity: 'month',
            partitionGranularity: 'month',
          },
        },
      })

      expect(schema.preAggregations!.ordersMonthly.partitionGranularity).toBe('month')
    })
  })
})

// =============================================================================
// Query Builder Tests
// =============================================================================

describe('@dotdo/cubejs - Query Builder', () => {
  describe('QueryBuilder', () => {
    it('should build a simple query', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .build()

      expect(query.measures).toContain('Orders.count')
    })

    it('should build a query with multiple measures', () => {
      const query = new QueryBuilder()
        .select('Orders.count', 'Orders.totalAmount')
        .build()

      expect(query.measures).toHaveLength(2)
      expect(query.measures).toContain('Orders.count')
      expect(query.measures).toContain('Orders.totalAmount')
    })

    it('should add dimensions', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .dimensions('Orders.status')
        .build()

      expect(query.dimensions).toContain('Orders.status')
    })

    it('should add filters', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.status', 'equals', 'completed')
        .build()

      expect(query.filters).toHaveLength(1)
      expect(query.filters![0].member).toBe('Orders.status')
      expect(query.filters![0].operator).toBe('equals')
      expect(query.filters![0].values).toEqual(['completed'])
    })

    it('should add multiple filters', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.status', 'equals', 'completed')
        .where('Orders.amount', 'gt', 100)
        .build()

      expect(query.filters).toHaveLength(2)
    })

    it('should add time dimensions', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .timeDimension('Orders.createdAt', 'day')
        .build()

      expect(query.timeDimensions).toHaveLength(1)
      expect(query.timeDimensions![0].dimension).toBe('Orders.createdAt')
      expect(query.timeDimensions![0].granularity).toBe('day')
    })

    it('should add time dimension with date range', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .timeDimension('Orders.createdAt', 'day', ['2024-01-01', '2024-12-31'])
        .build()

      expect(query.timeDimensions![0].dateRange).toEqual(['2024-01-01', '2024-12-31'])
    })

    it('should add ordering', () => {
      const query = new QueryBuilder()
        .select('Orders.count', 'Orders.totalAmount')
        .dimensions('Orders.status')
        .orderBy('Orders.totalAmount', 'desc')
        .build()

      expect(query.order).toBeDefined()
      expect(query.order!['Orders.totalAmount']).toBe('desc')
    })

    it('should add limit and offset', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .limit(10)
        .offset(20)
        .build()

      expect(query.limit).toBe(10)
      expect(query.offset).toBe(20)
    })

    it('should support segments', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .segments('Orders.completedOrders')
        .build()

      expect(query.segments).toContain('Orders.completedOrders')
    })

    it('should support renewQuery', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .renewQuery()
        .build()

      expect(query.renewQuery).toBe(true)
    })

    it('should support ungrouped queries', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .ungrouped()
        .build()

      expect(query.ungrouped).toBe(true)
    })
  })

  describe('Filter Operators', () => {
    it('should support equals operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.status', 'equals', 'completed')
        .build()

      expect(query.filters![0].operator).toBe('equals')
    })

    it('should support notEquals operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.status', 'notEquals', 'cancelled')
        .build()

      expect(query.filters![0].operator).toBe('notEquals')
    })

    it('should support gt operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.amount', 'gt', 100)
        .build()

      expect(query.filters![0].operator).toBe('gt')
    })

    it('should support gte operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.amount', 'gte', 100)
        .build()

      expect(query.filters![0].operator).toBe('gte')
    })

    it('should support lt operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.amount', 'lt', 50)
        .build()

      expect(query.filters![0].operator).toBe('lt')
    })

    it('should support lte operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.amount', 'lte', 50)
        .build()

      expect(query.filters![0].operator).toBe('lte')
    })

    it('should support contains operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Customers.name', 'contains', 'john')
        .build()

      expect(query.filters![0].operator).toBe('contains')
    })

    it('should support notContains operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Customers.name', 'notContains', 'test')
        .build()

      expect(query.filters![0].operator).toBe('notContains')
    })

    it('should support set operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.customerId', 'set')
        .build()

      expect(query.filters![0].operator).toBe('set')
    })

    it('should support notSet operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.customerId', 'notSet')
        .build()

      expect(query.filters![0].operator).toBe('notSet')
    })

    it('should support inDateRange operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.createdAt', 'inDateRange', ['2024-01-01', '2024-12-31'])
        .build()

      expect(query.filters![0].operator).toBe('inDateRange')
      expect(query.filters![0].values).toEqual(['2024-01-01', '2024-12-31'])
    })

    it('should support beforeDate operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.createdAt', 'beforeDate', '2024-01-01')
        .build()

      expect(query.filters![0].operator).toBe('beforeDate')
    })

    it('should support afterDate operator', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .where('Orders.createdAt', 'afterDate', '2024-01-01')
        .build()

      expect(query.filters![0].operator).toBe('afterDate')
    })
  })

  describe('Time Dimension Granularity', () => {
    const granularities = ['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']

    granularities.forEach((granularity) => {
      it(`should support ${granularity} granularity`, () => {
        const query = new QueryBuilder()
          .select('Orders.count')
          .timeDimension('Orders.createdAt', granularity as any)
          .build()

        expect(query.timeDimensions![0].granularity).toBe(granularity)
      })
    })

    it('should support relative date ranges', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .timeDimension('Orders.createdAt', 'day', 'last 7 days')
        .build()

      expect(query.timeDimensions![0].dateRange).toBe('last 7 days')
    })

    it('should support compareDateRange', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .timeDimension('Orders.createdAt', 'day', ['2024-01-01', '2024-01-31'])
        .compareDateRange(['2023-01-01', '2023-01-31'])
        .build()

      expect(query.timeDimensions![0].compareDateRange).toEqual(['2023-01-01', '2023-01-31'])
    })
  })
})

// =============================================================================
// CubeClient Tests
// =============================================================================

describe('@dotdo/cubejs - Client', () => {
  describe('CubeClient', () => {
    it('should initialize with API token', () => {
      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
      })

      expect(client).toBeDefined()
    })

    it('should throw error without API token', () => {
      expect(() => new CubeClient({
        apiToken: '',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
      })).toThrow('API token is required')
    })

    it('should register cube schemas', () => {
      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
      })

      client.registerCube(ordersSchema)
      client.registerCube(customersSchema)

      expect(client.getCube('Orders')).toBeDefined()
      expect(client.getCube('Customers')).toBeDefined()
    })

    it('should execute a query', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { 'Orders.count': 100, 'Orders.status': 'completed' },
            { 'Orders.count': 50, 'Orders.status': 'pending' },
          ],
          annotation: {
            measures: { 'Orders.count': { title: 'Orders Count', shortTitle: 'Count', type: 'number' } },
            dimensions: { 'Orders.status': { title: 'Orders Status', shortTitle: 'Status', type: 'string' } },
          },
        }),
      })

      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
        fetch: mockFetch,
      })

      const result = await client.load({
        measures: ['Orders.count'],
        dimensions: ['Orders.status'],
      })

      expect(result.data).toHaveLength(2)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should use QueryBuilder with client', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ 'Orders.count': 100 }],
          annotation: {
            measures: { 'Orders.count': { title: 'Orders Count', shortTitle: 'Count', type: 'number' } },
            dimensions: {},
          },
        }),
      })

      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
        fetch: mockFetch,
      })

      const query = new QueryBuilder()
        .select('Orders.count')
        .build()

      const result = await client.load(query)

      expect(result.data).toHaveLength(1)
    })

    it('should handle API errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Invalid query: Unknown measure Orders.unknown',
        }),
      })

      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
        fetch: mockFetch,
      })

      await expect(client.load({
        measures: ['Orders.unknown'],
      })).rejects.toThrow(QueryError)
    })

    it('should support multi-tenancy with security context', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ 'Orders.count': 25 }],
          annotation: { measures: {}, dimensions: {} },
        }),
      })

      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
        fetch: mockFetch,
      })

      await client.load({
        measures: ['Orders.count'],
      }, {
        securityContext: { tenantId: 'acme' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-security-context': expect.any(String),
          }),
        })
      )
    })

    it('should support subscribe for real-time updates', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ 'Orders.count': 100 }],
          annotation: { measures: {}, dimensions: {} },
        }),
      })

      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
        fetch: mockFetch,
      })

      const updates: any[] = []
      const unsubscribe = client.subscribe(
        { measures: ['Orders.count'] },
        (result) => updates.push(result)
      )

      // Wait for initial load
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(updates.length).toBeGreaterThanOrEqual(1)

      unsubscribe()
    })

    it('should support dry run for query validation', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          normalizedQueries: [{ measures: ['Orders.count'] }],
          queryType: 'regularQuery',
          pivotQuery: {},
        }),
      })

      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
        fetch: mockFetch,
      })

      const result = await client.dryRun({
        measures: ['Orders.count'],
      })

      expect(result.normalizedQueries).toBeDefined()
    })

    it('should get meta information', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          cubes: [
            {
              name: 'Orders',
              measures: [{ name: 'count', type: 'count' }],
              dimensions: [{ name: 'status', type: 'string' }],
            },
          ],
        }),
      })

      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
        fetch: mockFetch,
      })

      const meta = await client.meta()

      expect(meta.cubes).toHaveLength(1)
      expect(meta.cubes[0].name).toBe('Orders')
    })
  })
})

// =============================================================================
// SQL Generation Tests
// =============================================================================

describe('@dotdo/cubejs - SQL Generation', () => {
  let client: CubeClient

  beforeEach(() => {
    client = new CubeClient({
      apiToken: 'test_token',
      apiUrl: 'https://cube.example.com/cubejs-api/v1',
    })
    client.registerCube(ordersSchema)
    client.registerCube(customersSchema)
    client.registerCube(productsSchema)
  })

  describe('toSQL()', () => {
    it('should generate SQL for simple query', () => {
      const sql = client.toSQL({
        measures: ['Orders.count'],
      })

      expect(sql).toContain('SELECT')
      expect(sql).toContain('COUNT')
      expect(sql).toContain('orders')
    })

    it('should generate SQL with dimensions', () => {
      const sql = client.toSQL({
        measures: ['Orders.count'],
        dimensions: ['Orders.status'],
      })

      expect(sql).toContain('status')
      expect(sql).toContain('GROUP BY')
    })

    it('should generate SQL with filters', () => {
      const sql = client.toSQL({
        measures: ['Orders.count'],
        filters: [{
          member: 'Orders.status',
          operator: 'equals',
          values: ['completed'],
        }],
      })

      expect(sql).toContain('WHERE')
      expect(sql).toContain("'completed'")
    })

    it('should generate SQL with time dimensions', () => {
      const sql = client.toSQL({
        measures: ['Orders.count'],
        timeDimensions: [{
          dimension: 'Orders.createdAt',
          granularity: 'day',
          dateRange: ['2024-01-01', '2024-12-31'],
        }],
      })

      expect(sql).toContain('created_at')
      expect(sql).toContain('2024-01-01')
      expect(sql).toContain('2024-12-31')
    })

    it('should generate SQL with joins', () => {
      const sql = client.toSQL({
        measures: ['Orders.count'],
        dimensions: ['Customers.name'],
      })

      expect(sql).toContain('JOIN')
      expect(sql).toContain('customers')
    })

    it('should generate SQL with order and limit', () => {
      const sql = client.toSQL({
        measures: ['Orders.count'],
        dimensions: ['Orders.status'],
        order: { 'Orders.count': 'desc' },
        limit: 10,
        offset: 5,
      })

      expect(sql).toContain('ORDER BY')
      expect(sql).toContain('DESC')
      expect(sql).toContain('LIMIT 10')
      expect(sql).toContain('OFFSET 5')
    })

    it('should generate SQL for sum measure', () => {
      const sql = client.toSQL({
        measures: ['Orders.totalAmount'],
      })

      expect(sql).toContain('SUM')
      expect(sql).toContain('amount')
    })

    it('should generate SQL for avg measure', () => {
      const sql = client.toSQL({
        measures: ['Orders.avgAmount'],
      })

      expect(sql).toContain('AVG')
      expect(sql).toContain('amount')
    })

    it('should generate SQL for countDistinct measure', () => {
      const sql = client.toSQL({
        measures: ['Orders.uniqueCustomers'],
      })

      expect(sql).toContain('COUNT')
      expect(sql).toContain('DISTINCT')
      expect(sql).toContain('customer_id')
    })

    it('should generate SQL for computed measure', () => {
      const sql = client.toSQL({
        measures: ['Orders.totalRevenue'],
      })

      expect(sql).toContain('SUM')
      expect(sql).toContain('price')
      expect(sql).toContain('quantity')
    })
  })
})

// =============================================================================
// Pre-aggregation Cache Tests
// =============================================================================

describe('@dotdo/cubejs - Pre-aggregation Cache', () => {
  describe('PreAggregationCache', () => {
    it('should create a cache instance', () => {
      const cache = new PreAggregationCache()

      expect(cache).toBeDefined()
    })

    it('should store pre-aggregation results', async () => {
      const cache = new PreAggregationCache()

      const key = 'Orders.ordersDaily.2024-01-01.2024-01-31'
      const data = [
        { date: '2024-01-01', count: 10, totalAmount: 1000 },
        { date: '2024-01-02', count: 15, totalAmount: 1500 },
      ]

      await cache.set(key, data)
      const result = await cache.get(key)

      expect(result).toEqual(data)
    })

    it('should return undefined for missing keys', async () => {
      const cache = new PreAggregationCache()

      const result = await cache.get('nonexistent')

      expect(result).toBeUndefined()
    })

    it('should invalidate cache entries', async () => {
      const cache = new PreAggregationCache()

      const key = 'Orders.ordersDaily.2024-01-01.2024-01-31'
      await cache.set(key, [{ count: 10 }])

      await cache.invalidate(key)
      const result = await cache.get(key)

      expect(result).toBeUndefined()
    })

    it('should support TTL expiration', async () => {
      const cache = new PreAggregationCache({ ttl: 100 }) // 100ms TTL

      const key = 'Orders.ordersDaily.2024-01-01.2024-01-31'
      await cache.set(key, [{ count: 10 }])

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150))

      const result = await cache.get(key)

      expect(result).toBeUndefined()
    })

    it('should check if query can use pre-aggregation', () => {
      const cache = new PreAggregationCache()

      cache.registerPreAggregation('Orders', 'ordersDaily', {
        type: 'rollup',
        measureReferences: ['count', 'totalAmount'],
        dimensionReferences: ['status'],
        timeDimensionReference: 'createdAt',
        granularity: 'day',
      })

      const canUse = cache.canUsePreAggregation({
        measures: ['Orders.count'],
        dimensions: ['Orders.status'],
        timeDimensions: [{
          dimension: 'Orders.createdAt',
          granularity: 'day',
        }],
      })

      expect(canUse).toBe(true)
    })

    it('should return false when query cannot use pre-aggregation', () => {
      const cache = new PreAggregationCache()

      cache.registerPreAggregation('Orders', 'ordersDaily', {
        type: 'rollup',
        measureReferences: ['count'],
        dimensionReferences: ['status'],
        timeDimensionReference: 'createdAt',
        granularity: 'day',
      })

      const canUse = cache.canUsePreAggregation({
        measures: ['Orders.avgAmount'], // Not in pre-aggregation
        dimensions: ['Orders.status'],
      })

      expect(canUse).toBe(false)
    })

    it('should aggregate from cache when possible', async () => {
      const cache = new PreAggregationCache()

      cache.registerPreAggregation('Orders', 'ordersDaily', {
        type: 'rollup',
        measureReferences: ['count', 'totalAmount'],
        dimensionReferences: ['status'],
        timeDimensionReference: 'createdAt',
        granularity: 'day',
      })

      // Store daily data with the expected key format for month query
      const cacheKey = 'Orders.ordersDaily.2024-01-01.2024-01-31.month'
      await cache.set(cacheKey, [
        { createdAt: '2024-01-01', status: 'completed', count: 10, totalAmount: 1000 },
        { createdAt: '2024-01-02', status: 'completed', count: 15, totalAmount: 1500 },
        { createdAt: '2024-01-01', status: 'pending', count: 5, totalAmount: 500 },
      ])

      // Query for monthly aggregation - matches the pre-aggregation
      const result = await cache.aggregate({
        measures: ['Orders.count', 'Orders.totalAmount'],
        dimensions: ['Orders.status'],
        timeDimensions: [{
          dimension: 'Orders.createdAt',
          granularity: 'month',
          dateRange: ['2024-01-01', '2024-01-31'],
        }],
      })

      expect(result).toBeDefined()
      // After rollup to month, we should have 2 rows: completed and pending
      expect(result!.length).toBeGreaterThan(0)
    })

    it('should support partitioned pre-aggregations', async () => {
      const cache = new PreAggregationCache()

      cache.registerPreAggregation('Orders', 'ordersMonthly', {
        type: 'rollup',
        measureReferences: ['count'],
        timeDimensionReference: 'createdAt',
        granularity: 'month',
        partitionGranularity: 'month',
      })

      // Store partitioned data
      await cache.setPartition('Orders.ordersMonthly', '2024-01', [
        { month: '2024-01', count: 100 },
      ])
      await cache.setPartition('Orders.ordersMonthly', '2024-02', [
        { month: '2024-02', count: 150 },
      ])

      const jan = await cache.getPartition('Orders.ordersMonthly', '2024-01')
      const feb = await cache.getPartition('Orders.ordersMonthly', '2024-02')

      expect(jan).toEqual([{ month: '2024-01', count: 100 }])
      expect(feb).toEqual([{ month: '2024-02', count: 150 }])
    })
  })
})

// =============================================================================
// REST API Tests
// =============================================================================

describe('@dotdo/cubejs - REST API', () => {
  describe('createCubeAPI()', () => {
    it('should create an API handler', () => {
      const api = createCubeAPI({
        cubes: [ordersSchema, customersSchema],
        apiToken: 'test_token',
      })

      expect(api).toBeDefined()
      expect(api.fetch).toBeDefined()
    })

    it('should handle /v1/load endpoint', async () => {
      const api = createCubeAPI({
        cubes: [ordersSchema],
        apiToken: 'test_token',
        dataSource: async (query) => {
          return [{ 'Orders.count': 100 }]
        },
      })

      const request = new Request('http://localhost/cubejs-api/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test_token',
        },
        body: JSON.stringify({
          query: {
            measures: ['Orders.count'],
          },
        }),
      })

      const response = await api.fetch(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data).toBeDefined()
    })

    it('should handle /v1/sql endpoint', async () => {
      const api = createCubeAPI({
        cubes: [ordersSchema],
        apiToken: 'test_token',
      })

      const request = new Request('http://localhost/cubejs-api/v1/sql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test_token',
        },
        body: JSON.stringify({
          query: {
            measures: ['Orders.count'],
          },
        }),
      })

      const response = await api.fetch(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.sql).toBeDefined()
    })

    it('should handle /v1/meta endpoint', async () => {
      const api = createCubeAPI({
        cubes: [ordersSchema, customersSchema],
        apiToken: 'test_token',
      })

      const request = new Request('http://localhost/cubejs-api/v1/meta', {
        method: 'GET',
        headers: {
          'Authorization': 'test_token',
        },
      })

      const response = await api.fetch(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.cubes).toBeDefined()
      expect(data.cubes).toHaveLength(2)
    })

    it('should handle /v1/dry-run endpoint', async () => {
      const api = createCubeAPI({
        cubes: [ordersSchema],
        apiToken: 'test_token',
      })

      const request = new Request('http://localhost/cubejs-api/v1/dry-run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test_token',
        },
        body: JSON.stringify({
          query: {
            measures: ['Orders.count'],
          },
        }),
      })

      const response = await api.fetch(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.normalizedQueries).toBeDefined()
    })

    it('should reject unauthorized requests', async () => {
      const api = createCubeAPI({
        cubes: [ordersSchema],
        apiToken: 'test_token',
      })

      const request = new Request('http://localhost/cubejs-api/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'wrong_token',
        },
        body: JSON.stringify({
          query: { measures: ['Orders.count'] },
        }),
      })

      const response = await api.fetch(request)

      expect(response.status).toBe(401)
    })

    it('should validate queries', async () => {
      const api = createCubeAPI({
        cubes: [ordersSchema],
        apiToken: 'test_token',
      })

      const request = new Request('http://localhost/cubejs-api/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test_token',
        },
        body: JSON.stringify({
          query: {
            measures: ['Orders.unknown'],
          },
        }),
      })

      const response = await api.fetch(request)

      expect(response.status).toBe(400)
    })

    it('should support security context in requests', async () => {
      let capturedContext: any = null

      const api = createCubeAPI({
        cubes: [ordersSchema],
        apiToken: 'test_token',
        checkAuth: (req, securityContext) => {
          capturedContext = securityContext
          return true
        },
        dataSource: async (query) => [],
      })

      const request = new Request('http://localhost/cubejs-api/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test_token',
          'x-security-context': Buffer.from(JSON.stringify({ tenantId: 'acme' })).toString('base64'),
        },
        body: JSON.stringify({
          query: { measures: ['Orders.count'] },
        }),
      })

      await api.fetch(request)

      expect(capturedContext).toEqual({ tenantId: 'acme' })
    })

    it('should support query transformation', async () => {
      const api = createCubeAPI({
        cubes: [ordersSchema],
        apiToken: 'test_token',
        queryTransformer: (query, context) => {
          // Add tenant filter
          return {
            ...query,
            filters: [
              ...(query.filters || []),
              { member: 'Orders.customerId', operator: 'equals', values: ['tenant-123'] },
            ],
          }
        },
        dataSource: async (query) => {
          expect(query.filters).toHaveLength(1)
          return []
        },
      })

      const request = new Request('http://localhost/cubejs-api/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test_token',
        },
        body: JSON.stringify({
          query: { measures: ['Orders.count'] },
        }),
      })

      await api.fetch(request)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('@dotdo/cubejs - Errors', () => {
  describe('ValidationError', () => {
    it('should create validation error with message', () => {
      const error = new ValidationError('Invalid measure type')

      expect(error.message).toBe('Invalid measure type')
      expect(error.name).toBe('ValidationError')
      expect(error instanceof CubeError).toBe(true)
    })
  })

  describe('QueryError', () => {
    it('should create query error with details', () => {
      const error = new QueryError('Unknown measure: Orders.unknown', {
        query: { measures: ['Orders.unknown'] },
        statusCode: 400,
      })

      expect(error.message).toBe('Unknown measure: Orders.unknown')
      expect(error.name).toBe('QueryError')
      expect(error.query).toEqual({ measures: ['Orders.unknown'] })
      expect(error.statusCode).toBe(400)
    })
  })
})

// =============================================================================
// Advanced Query Features Tests
// =============================================================================

describe('@dotdo/cubejs - Advanced Features', () => {
  describe('Pivoting', () => {
    it('should support pivot configuration', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .dimensions('Orders.status')
        .timeDimension('Orders.createdAt', 'month')
        .pivot({
          x: ['Orders.status'],
          y: ['Orders.createdAt.month'],
          fillMissingDates: true,
        })
        .build()

      expect(query.pivotConfig).toBeDefined()
      expect(query.pivotConfig!.x).toContain('Orders.status')
    })
  })

  describe('Timezone', () => {
    it('should support timezone in queries', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .timeDimension('Orders.createdAt', 'day')
        .timezone('America/New_York')
        .build()

      expect(query.timezone).toBe('America/New_York')
    })
  })

  describe('Total', () => {
    it('should request totals', () => {
      const query = new QueryBuilder()
        .select('Orders.count')
        .dimensions('Orders.status')
        .withTotal()
        .build()

      expect(query.total).toBe(true)
    })
  })

  describe('Row Limit Warning', () => {
    it('should configure row limit warning', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [],
          annotation: { measures: {}, dimensions: {} },
          rowLimitWarning: true,
        }),
      })

      const client = new CubeClient({
        apiToken: 'test_token',
        apiUrl: 'https://cube.example.com/cubejs-api/v1',
        fetch: mockFetch,
      })

      const result = await client.load({
        measures: ['Orders.count'],
      })

      expect(result.rowLimitWarning).toBe(true)
    })
  })
})
