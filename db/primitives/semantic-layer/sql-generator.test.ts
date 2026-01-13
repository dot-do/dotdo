/**
 * SQL Generator Tests - TDD RED Phase
 *
 * Tests for SQL generation from semantic layer queries with:
 * - Dialect-specific SQL (Postgres, ClickHouse, DuckDB, SQLite)
 * - Measure aggregations
 * - Dimension grouping
 * - JOIN clauses for multi-cube queries
 * - Filter pushdown optimization
 *
 * @see dotdo-yilsq
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SQLGenerator,
  type SQLDialect,
  type SemanticQuery,
  type CubeDefinition,
} from './sql-generator'

// =============================================================================
// TEST FIXTURES
// =============================================================================

const ordersCube: CubeDefinition = {
  name: 'Orders',
  sql: 'SELECT * FROM orders',
  sqlAlias: 'orders',
  measures: {
    count: { type: 'count' },
    revenue: { type: 'sum', sql: 'amount' },
    avgOrderValue: { type: 'avg', sql: 'amount' },
    uniqueCustomers: { type: 'countDistinct', sql: 'customer_id' },
    maxAmount: { type: 'max', sql: 'amount' },
    minAmount: { type: 'min', sql: 'amount' },
    customMetric: { type: 'number', sql: 'SUM(amount) / COUNT(DISTINCT customer_id)' },
  },
  dimensions: {
    id: { type: 'number', sql: 'id', primaryKey: true },
    status: { type: 'string', sql: 'status' },
    createdAt: { type: 'time', sql: 'created_at' },
    customerId: { type: 'number', sql: 'customer_id' },
    region: { type: 'string', sql: 'region' },
    amount: { type: 'number', sql: 'amount' },
  },
  joins: {
    Products: {
      relationship: 'belongsTo',
      sql: '${Orders}.product_id = ${Products}.id',
    },
    Customers: {
      relationship: 'belongsTo',
      sql: '${Orders}.customer_id = ${Customers}.id',
    },
  },
}

const productsCube: CubeDefinition = {
  name: 'Products',
  sql: 'SELECT * FROM products',
  sqlAlias: 'products',
  measures: {
    count: { type: 'count' },
    avgPrice: { type: 'avg', sql: 'price' },
  },
  dimensions: {
    id: { type: 'number', sql: 'id', primaryKey: true },
    name: { type: 'string', sql: 'name' },
    category: { type: 'string', sql: 'category' },
    price: { type: 'number', sql: 'price' },
  },
}

const customersCube: CubeDefinition = {
  name: 'Customers',
  sql: 'SELECT * FROM customers',
  sqlAlias: 'customers',
  measures: {
    count: { type: 'count' },
    totalSpent: { type: 'sum', sql: 'total_spent' },
  },
  dimensions: {
    id: { type: 'number', sql: 'id', primaryKey: true },
    name: { type: 'string', sql: 'name' },
    country: { type: 'string', sql: 'country' },
    tier: { type: 'string', sql: 'tier' },
    createdAt: { type: 'time', sql: 'created_at' },
  },
}

// =============================================================================
// SQL GENERATOR TESTS
// =============================================================================

describe('SQLGenerator', () => {
  let generator: SQLGenerator
  let cubes: Map<string, CubeDefinition>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['Products', productsCube],
      ['Customers', customersCube],
    ])
    generator = new SQLGenerator({ cubes, dialect: 'postgres' })
  })

  describe('Basic Query Generation', () => {
    it('should generate SQL for simple measure query', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('SELECT')
      expect(sql).toContain('COUNT(*)')
      expect(sql).toContain('FROM')
      expect(sql).toContain('orders')
    })

    it('should generate SQL with multiple measures', () => {
      const query: SemanticQuery = {
        measures: ['Orders.revenue', 'Orders.count'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('SUM(orders.amount)')
      expect(sql).toContain('COUNT(*)')
    })

    it('should generate SQL with measures and dimensions', () => {
      const query: SemanticQuery = {
        measures: ['Orders.revenue'],
        dimensions: ['Orders.status'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('SUM(orders.amount)')
      expect(sql).toContain('orders.status')
      expect(sql).toContain('GROUP BY')
    })

    it('should generate SQL with multiple dimensions', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.status', 'Orders.region'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('orders.status')
      expect(sql).toContain('orders.region')
      expect(sql).toContain('GROUP BY')
    })
  })

  describe('Measure Aggregations', () => {
    it('should generate COUNT(*) for count type', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('COUNT(*)')
    })

    it('should generate SUM for sum type', () => {
      const query: SemanticQuery = {
        measures: ['Orders.revenue'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('SUM(orders.amount)')
    })

    it('should generate AVG for avg type', () => {
      const query: SemanticQuery = {
        measures: ['Orders.avgOrderValue'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('AVG(orders.amount)')
    })

    it('should generate COUNT(DISTINCT) for countDistinct type', () => {
      const query: SemanticQuery = {
        measures: ['Orders.uniqueCustomers'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('COUNT(DISTINCT orders.customer_id)')
    })

    it('should generate MAX for max type', () => {
      const query: SemanticQuery = {
        measures: ['Orders.maxAmount'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('MAX(orders.amount)')
    })

    it('should generate MIN for min type', () => {
      const query: SemanticQuery = {
        measures: ['Orders.minAmount'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('MIN(orders.amount)')
    })

    it('should use raw SQL for number type', () => {
      const query: SemanticQuery = {
        measures: ['Orders.customMetric'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('SUM(amount) / COUNT(DISTINCT customer_id)')
    })
  })

  describe('Time Dimension Granularity', () => {
    it('should handle day granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.day'],
      }

      const sql = generator.generate(query)

      expect(sql).toMatch(/date_trunc\s*\(\s*'day'/i)
    })

    it('should handle month granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.month'],
      }

      const sql = generator.generate(query)

      expect(sql).toMatch(/date_trunc\s*\(\s*'month'/i)
    })

    it('should handle year granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.year'],
      }

      const sql = generator.generate(query)

      expect(sql).toMatch(/date_trunc\s*\(\s*'year'/i)
    })

    it('should handle week granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.week'],
      }

      const sql = generator.generate(query)

      expect(sql).toMatch(/date_trunc\s*\(\s*'week'/i)
    })

    it('should handle hour granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.hour'],
      }

      const sql = generator.generate(query)

      expect(sql).toMatch(/date_trunc\s*\(\s*'hour'/i)
    })

    it('should handle minute granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.minute'],
      }

      const sql = generator.generate(query)

      expect(sql).toMatch(/date_trunc\s*\(\s*'minute'/i)
    })
  })

  describe('Filter Generation', () => {
    it('should generate equals filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.status', operator: 'equals', values: ['completed'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toMatch(/orders\.status\s*=\s*'completed'/i)
    })

    it('should generate notEquals filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.status', operator: 'notEquals', values: ['cancelled'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toMatch(/orders\.status\s*(!=|<>)\s*'cancelled'/i)
    })

    it('should generate gt filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.amount', operator: 'gt', values: ['100'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toMatch(/orders\.amount\s*>\s*100/i)
    })

    it('should generate gte filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.amount', operator: 'gte', values: ['100'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toMatch(/orders\.amount\s*>=\s*100/i)
    })

    it('should generate lt filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.amount', operator: 'lt', values: ['50'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toMatch(/orders\.amount\s*<\s*50/i)
    })

    it('should generate lte filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.amount', operator: 'lte', values: ['50'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toMatch(/orders\.amount\s*<=\s*50/i)
    })

    it('should generate IN filter with multiple values', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.status', operator: 'in', values: ['completed', 'pending'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toContain('IN')
      expect(sql).toContain("'completed'")
      expect(sql).toContain("'pending'")
    })

    it('should generate NOT IN filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.status', operator: 'notIn', values: ['cancelled', 'failed'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toContain('NOT IN')
    })

    it('should generate BETWEEN filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.amount', operator: 'between', values: ['100', '500'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toContain('BETWEEN')
      expect(sql).toContain('100')
      expect(sql).toContain('500')
    })

    it('should generate LIKE filter for contains', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.status', operator: 'contains', values: ['complete'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toContain('LIKE')
      expect(sql).toContain('%complete%')
    })

    it('should generate LIKE filter for startsWith', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.status', operator: 'startsWith', values: ['comp'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toContain('LIKE')
      expect(sql).toContain("'comp%'")
    })

    it('should generate LIKE filter for endsWith', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.status', operator: 'endsWith', values: ['ed'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toContain('LIKE')
      expect(sql).toContain("'%ed'")
    })

    it('should generate IS NULL filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.customerId', operator: 'notSet', values: [] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toContain('IS NULL')
    })

    it('should generate IS NOT NULL filter', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.customerId', operator: 'set', values: [] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toContain('IS NOT NULL')
    })

    it('should combine multiple filters with AND', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.status', operator: 'equals', values: ['completed'] },
          { member: 'Orders.amount', operator: 'gte', values: ['100'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('WHERE')
      expect(sql).toContain('AND')
    })
  })

  describe('ORDER BY and LIMIT', () => {
    it('should generate ORDER BY with desc', () => {
      const query: SemanticQuery = {
        measures: ['Orders.revenue'],
        dimensions: ['Orders.status'],
        order: [['Orders.revenue', 'desc']],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('ORDER BY')
      expect(sql).toContain('DESC')
    })

    it('should generate ORDER BY with asc', () => {
      const query: SemanticQuery = {
        measures: ['Orders.revenue'],
        dimensions: ['Orders.status'],
        order: [['Orders.status', 'asc']],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('ORDER BY')
      expect(sql).toContain('ASC')
    })

    it('should generate multiple ORDER BY columns', () => {
      const query: SemanticQuery = {
        measures: ['Orders.revenue', 'Orders.count'],
        dimensions: ['Orders.status'],
        order: [
          ['Orders.revenue', 'desc'],
          ['Orders.count', 'asc'],
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('ORDER BY')
      expect(sql).toContain('DESC')
      expect(sql).toContain('ASC')
    })

    it('should generate LIMIT', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.status'],
        limit: 100,
      }

      const sql = generator.generate(query)

      expect(sql).toContain('LIMIT')
      expect(sql).toContain('100')
    })

    it('should generate OFFSET', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.status'],
        limit: 100,
        offset: 50,
      }

      const sql = generator.generate(query)

      expect(sql).toContain('LIMIT')
      expect(sql).toContain('OFFSET')
      expect(sql).toContain('50')
    })
  })

  describe('JOIN Clause Generation', () => {
    it('should generate JOIN for cross-cube dimensions', () => {
      const query: SemanticQuery = {
        measures: ['Orders.revenue'],
        dimensions: ['Orders.status', 'Products.category'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('JOIN')
      expect(sql).toContain('products')
    })

    it('should generate correct JOIN condition', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Customers.country'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('JOIN')
      expect(sql).toContain('customer_id')
    })

    it('should handle filters on joined dimensions', () => {
      const query: SemanticQuery = {
        measures: ['Orders.revenue'],
        dimensions: ['Orders.status'],
        filters: [
          { member: 'Customers.country', operator: 'equals', values: ['USA'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('JOIN')
      expect(sql).toContain('customers')
      expect(sql).toContain('WHERE')
      expect(sql).toContain("'USA'")
    })

    it('should handle multiple JOINs', () => {
      const query: SemanticQuery = {
        measures: ['Orders.revenue'],
        dimensions: ['Products.category', 'Customers.country'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('products')
      expect(sql).toContain('customers')
      // Should have two JOINs
      const joinCount = (sql.match(/JOIN/g) || []).length
      expect(joinCount).toBe(2)
    })
  })
})

// =============================================================================
// DIALECT-SPECIFIC TESTS
// =============================================================================

describe('SQL Dialects', () => {
  let cubes: Map<string, CubeDefinition>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['Products', productsCube],
      ['Customers', customersCube],
    ])
  })

  describe('PostgreSQL Dialect', () => {
    let generator: SQLGenerator

    beforeEach(() => {
      generator = new SQLGenerator({ cubes, dialect: 'postgres' })
    })

    it('should use date_trunc for time granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.day'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('date_trunc')
      expect(sql).toContain("'day'")
    })

    it('should use standard SQL operators', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        filters: [
          { member: 'Orders.status', operator: 'notEquals', values: ['cancelled'] },
        ],
      }

      const sql = generator.generate(query)

      expect(sql).toMatch(/<>|!=/)
    })
  })

  describe('ClickHouse Dialect', () => {
    let generator: SQLGenerator

    beforeEach(() => {
      generator = new SQLGenerator({ cubes, dialect: 'clickhouse' })
    })

    it('should use toStartOfDay for day granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.day'],
      }

      const sql = generator.generate(query)

      expect(sql).toMatch(/toStartOfDay|toDate/)
    })

    it('should use toStartOfMonth for month granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.month'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('toStartOfMonth')
    })

    it('should use toStartOfYear for year granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.year'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('toStartOfYear')
    })

    it('should use toStartOfWeek for week granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.week'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('toStartOfWeek')
    })

    it('should use toStartOfHour for hour granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.hour'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('toStartOfHour')
    })

    it('should use toStartOfMinute for minute granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.minute'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('toStartOfMinute')
    })
  })

  describe('DuckDB Dialect', () => {
    let generator: SQLGenerator

    beforeEach(() => {
      generator = new SQLGenerator({ cubes, dialect: 'duckdb' })
    })

    it('should use date_trunc for time granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.day'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('date_trunc')
    })

    it('should handle date_trunc for month', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.month'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('date_trunc')
      expect(sql).toContain("'month'")
    })
  })

  describe('SQLite Dialect', () => {
    let generator: SQLGenerator

    beforeEach(() => {
      generator = new SQLGenerator({ cubes, dialect: 'sqlite' })
    })

    it('should use strftime or date for day granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.day'],
      }

      const sql = generator.generate(query)

      expect(sql).toMatch(/strftime|date/)
    })

    it('should use strftime for month granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.month'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('strftime')
      expect(sql).toContain('%Y-%m')
    })

    it('should use strftime for year granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.year'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('strftime')
      expect(sql).toContain('%Y')
    })

    it('should use strftime for hour granularity', () => {
      const query: SemanticQuery = {
        measures: ['Orders.count'],
        dimensions: ['Orders.createdAt.hour'],
      }

      const sql = generator.generate(query)

      expect(sql).toContain('strftime')
      expect(sql).toContain('%H')
    })
  })
})

// =============================================================================
// FILTER PUSHDOWN OPTIMIZATION TESTS
// =============================================================================

describe('Filter Pushdown Optimization', () => {
  let generator: SQLGenerator
  let cubes: Map<string, CubeDefinition>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['Products', productsCube],
      ['Customers', customersCube],
    ])
    generator = new SQLGenerator({ cubes, dialect: 'postgres', enableFilterPushdown: true })
  })

  it('should push filters to subqueries when applicable', () => {
    const query: SemanticQuery = {
      measures: ['Orders.revenue'],
      dimensions: ['Orders.status'],
      filters: [
        { member: 'Orders.createdAt', operator: 'gte', values: ['2024-01-01'] },
      ],
    }

    const sql = generator.generate(query)

    // Filter should be in WHERE clause
    expect(sql).toContain('WHERE')
    expect(sql).toContain('2024-01-01')
  })

  it('should not push measure filters to subqueries (HAVING instead)', () => {
    const query: SemanticQuery = {
      measures: ['Orders.revenue'],
      dimensions: ['Orders.status'],
      filters: [
        { member: 'Orders.revenue', operator: 'gt', values: ['1000'] },
      ],
    }

    const sql = generator.generate(query)

    // Measure filters should use HAVING, not WHERE
    expect(sql).toContain('HAVING')
  })

  it('should place dimension filters in WHERE clause', () => {
    const query: SemanticQuery = {
      measures: ['Orders.count'],
      dimensions: ['Orders.status'],
      filters: [
        { member: 'Orders.status', operator: 'equals', values: ['completed'] },
      ],
    }

    const sql = generator.generate(query)

    expect(sql).toContain('WHERE')
    expect(sql).toContain("orders.status = 'completed'")
  })

  it('should push join filters to correct tables', () => {
    const query: SemanticQuery = {
      measures: ['Orders.revenue'],
      dimensions: ['Orders.status', 'Customers.country'],
      filters: [
        { member: 'Customers.tier', operator: 'equals', values: ['gold'] },
      ],
    }

    const sql = generator.generate(query)

    // Filter on Customers should still be in WHERE, applied after JOIN
    expect(sql).toContain('WHERE')
    expect(sql).toContain("'gold'")
  })
})

// =============================================================================
// COMPLEX QUERY TESTS
// =============================================================================

describe('Complex Queries', () => {
  let generator: SQLGenerator
  let cubes: Map<string, CubeDefinition>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['Products', productsCube],
      ['Customers', customersCube],
    ])
    generator = new SQLGenerator({ cubes, dialect: 'postgres' })
  })

  it('should generate SQL for full-featured query', () => {
    const query: SemanticQuery = {
      measures: ['Orders.revenue', 'Orders.count', 'Orders.avgOrderValue'],
      dimensions: ['Orders.status', 'Customers.country'],
      filters: [
        { member: 'Orders.createdAt', operator: 'gte', values: ['2024-01-01'] },
        { member: 'Customers.tier', operator: 'in', values: ['gold', 'platinum'] },
      ],
      order: [['Orders.revenue', 'desc']],
      limit: 100,
    }

    const sql = generator.generate(query)

    // Verify all components are present
    expect(sql).toContain('SELECT')
    expect(sql).toContain('SUM')
    expect(sql).toContain('COUNT')
    expect(sql).toContain('AVG')
    expect(sql).toContain('JOIN')
    expect(sql).toContain('WHERE')
    expect(sql).toContain('GROUP BY')
    expect(sql).toContain('ORDER BY')
    expect(sql).toContain('LIMIT')
  })

  it('should properly alias columns in SELECT', () => {
    const query: SemanticQuery = {
      measures: ['Orders.revenue', 'Orders.count'],
      dimensions: ['Orders.status'],
    }

    const sql = generator.generate(query)

    // Should have aliases for measures
    expect(sql).toMatch(/AS\s+"?Orders\.revenue"?/i)
    expect(sql).toMatch(/AS\s+"?Orders\.count"?/i)
  })

  it('should use table alias throughout query', () => {
    const query: SemanticQuery = {
      measures: ['Orders.revenue'],
      dimensions: ['Orders.status'],
      filters: [
        { member: 'Orders.status', operator: 'equals', values: ['completed'] },
      ],
    }

    const sql = generator.generate(query)

    // Should use table alias 'orders' consistently
    expect(sql).toContain('orders.status')
    expect(sql).toContain('orders.amount')
  })

  it('should handle query with only dimensions (no measures)', () => {
    const query: SemanticQuery = {
      dimensions: ['Orders.status', 'Orders.region'],
    }

    const sql = generator.generate(query)

    expect(sql).toContain('SELECT')
    expect(sql).toContain('orders.status')
    expect(sql).toContain('orders.region')
    // Should not have GROUP BY without aggregations
    expect(sql).not.toContain('GROUP BY')
  })
})

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  let generator: SQLGenerator
  let cubes: Map<string, CubeDefinition>

  beforeEach(() => {
    cubes = new Map([
      ['Orders', ordersCube],
      ['Products', productsCube],
    ])
    generator = new SQLGenerator({ cubes, dialect: 'postgres' })
  })

  it('should throw error for unknown cube', () => {
    const query: SemanticQuery = {
      measures: ['UnknownCube.count'],
    }

    expect(() => generator.generate(query)).toThrow(/unknown cube/i)
  })

  it('should throw error for unknown measure', () => {
    const query: SemanticQuery = {
      measures: ['Orders.unknownMeasure'],
    }

    expect(() => generator.generate(query)).toThrow(/unknown measure/i)
  })

  it('should throw error for unknown dimension', () => {
    const query: SemanticQuery = {
      measures: ['Orders.count'],
      dimensions: ['Orders.unknownDimension'],
    }

    expect(() => generator.generate(query)).toThrow(/unknown dimension/i)
  })

  it('should throw error for unknown filter member', () => {
    const query: SemanticQuery = {
      measures: ['Orders.count'],
      filters: [
        { member: 'Orders.unknownField', operator: 'equals', values: ['test'] },
      ],
    }

    expect(() => generator.generate(query)).toThrow(/unknown member/i)
  })

  it('should throw error for empty query', () => {
    const query: SemanticQuery = {}

    expect(() => generator.generate(query)).toThrow(/empty query/i)
  })

  it('should throw error for invalid filter operator', () => {
    const query: SemanticQuery = {
      measures: ['Orders.count'],
      filters: [
        { member: 'Orders.status', operator: 'invalidOp' as any, values: ['test'] },
      ],
    }

    expect(() => generator.generate(query)).toThrow(/invalid.*operator/i)
  })
})
