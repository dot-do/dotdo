/**
 * Measure Definitions Tests - TDD RED Phase
 *
 * Tests for core Measure type with support for:
 * - Built-in aggregations: sum, count, count_distinct, avg, min, max
 * - Percentile aggregations: p50, p90, p95, p99
 * - Custom SQL expressions for complex measures
 * - Composite measures (derived from other measures)
 * - Measure formatting (currency, percentage, number)
 * - Null handling strategies
 *
 * @see dotdo-3y0jx
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  Measure,
  MeasureDefinition,
  AggregationType,
  MeasureFormat,
  NullHandling,
  CompositeMeasure,
  createMeasure,
  MeasureError,
} from './measure'

// =============================================================================
// TEST DATA FIXTURES
// =============================================================================

const basicSumMeasure: MeasureDefinition = {
  name: 'totalRevenue',
  type: 'sum',
  sql: 'amount',
  description: 'Total revenue from all orders',
}

const basicCountMeasure: MeasureDefinition = {
  name: 'orderCount',
  type: 'count',
  description: 'Number of orders',
}

const avgMeasure: MeasureDefinition = {
  name: 'avgOrderValue',
  type: 'avg',
  sql: 'amount',
  description: 'Average order value',
}

// =============================================================================
// BUILT-IN AGGREGATIONS
// =============================================================================

describe('Measure - Built-in Aggregations', () => {
  describe('sum aggregation', () => {
    it('creates a sum measure with sql reference', () => {
      const measure = createMeasure({
        name: 'totalRevenue',
        type: 'sum',
        sql: 'amount',
      })

      expect(measure.name).toBe('totalRevenue')
      expect(measure.type).toBe('sum')
      expect(measure.sql).toBe('amount')
    })

    it('generates correct SQL for sum', () => {
      const measure = createMeasure({
        name: 'totalRevenue',
        type: 'sum',
        sql: 'amount',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('SUM')
      expect(sql).toContain('orders.amount')
      expect(sql).toContain('AS totalRevenue')
    })

    it('requires sql field for sum measure', () => {
      expect(() =>
        createMeasure({
          name: 'badSum',
          type: 'sum',
        })
      ).toThrow(MeasureError)
    })
  })

  describe('count aggregation', () => {
    it('creates a count measure without sql reference', () => {
      const measure = createMeasure({
        name: 'orderCount',
        type: 'count',
      })

      expect(measure.name).toBe('orderCount')
      expect(measure.type).toBe('count')
    })

    it('generates COUNT(*) SQL', () => {
      const measure = createMeasure({
        name: 'orderCount',
        type: 'count',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('COUNT(*)')
      expect(sql).toContain('AS orderCount')
    })

    it('optionally accepts sql for filtered count', () => {
      const measure = createMeasure({
        name: 'completedCount',
        type: 'count',
        sql: 'CASE WHEN status = \'completed\' THEN 1 END',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('COUNT')
    })
  })

  describe('count_distinct aggregation', () => {
    it('creates a count_distinct measure', () => {
      const measure = createMeasure({
        name: 'uniqueCustomers',
        type: 'count_distinct',
        sql: 'customer_id',
      })

      expect(measure.name).toBe('uniqueCustomers')
      expect(measure.type).toBe('count_distinct')
    })

    it('generates COUNT(DISTINCT ...) SQL', () => {
      const measure = createMeasure({
        name: 'uniqueCustomers',
        type: 'count_distinct',
        sql: 'customer_id',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('COUNT(DISTINCT')
      expect(sql).toContain('orders.customer_id')
    })

    it('requires sql for count_distinct', () => {
      expect(() =>
        createMeasure({
          name: 'badCountDistinct',
          type: 'count_distinct',
        })
      ).toThrow(MeasureError)
    })
  })

  describe('avg aggregation', () => {
    it('creates an avg measure', () => {
      const measure = createMeasure({
        name: 'avgOrderValue',
        type: 'avg',
        sql: 'amount',
      })

      expect(measure.name).toBe('avgOrderValue')
      expect(measure.type).toBe('avg')
    })

    it('generates AVG SQL', () => {
      const measure = createMeasure({
        name: 'avgOrderValue',
        type: 'avg',
        sql: 'amount',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('AVG')
      expect(sql).toContain('orders.amount')
    })

    it('requires sql for avg', () => {
      expect(() =>
        createMeasure({
          name: 'badAvg',
          type: 'avg',
        })
      ).toThrow(MeasureError)
    })
  })

  describe('min aggregation', () => {
    it('creates a min measure', () => {
      const measure = createMeasure({
        name: 'minOrderValue',
        type: 'min',
        sql: 'amount',
      })

      expect(measure.name).toBe('minOrderValue')
      expect(measure.type).toBe('min')
    })

    it('generates MIN SQL', () => {
      const measure = createMeasure({
        name: 'minOrderValue',
        type: 'min',
        sql: 'amount',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('MIN')
      expect(sql).toContain('orders.amount')
    })
  })

  describe('max aggregation', () => {
    it('creates a max measure', () => {
      const measure = createMeasure({
        name: 'maxOrderValue',
        type: 'max',
        sql: 'amount',
      })

      expect(measure.name).toBe('maxOrderValue')
      expect(measure.type).toBe('max')
    })

    it('generates MAX SQL', () => {
      const measure = createMeasure({
        name: 'maxOrderValue',
        type: 'max',
        sql: 'amount',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('MAX')
      expect(sql).toContain('orders.amount')
    })
  })
})

// =============================================================================
// PERCENTILE AGGREGATIONS
// =============================================================================

describe('Measure - Percentile Aggregations', () => {
  describe('p50 (median)', () => {
    it('creates a p50 measure', () => {
      const measure = createMeasure({
        name: 'medianLatency',
        type: 'percentile',
        percentile: 50,
        sql: 'response_time',
      })

      expect(measure.name).toBe('medianLatency')
      expect(measure.type).toBe('percentile')
      expect(measure.percentile).toBe(50)
    })

    it('generates percentile SQL for postgres', () => {
      const measure = createMeasure({
        name: 'medianLatency',
        type: 'percentile',
        percentile: 50,
        sql: 'response_time',
      })

      const sql = measure.toSQL('requests', { dialect: 'postgres' })
      expect(sql).toMatch(/PERCENTILE_CONT|percentile_cont/)
      expect(sql).toContain('0.5')
    })

    it('provides shorthand for p50', () => {
      const measure = createMeasure({
        name: 'medianLatency',
        type: 'p50',
        sql: 'response_time',
      })

      expect(measure.percentile).toBe(50)
    })
  })

  describe('p90', () => {
    it('creates a p90 measure', () => {
      const measure = createMeasure({
        name: 'p90Latency',
        type: 'percentile',
        percentile: 90,
        sql: 'response_time',
      })

      expect(measure.percentile).toBe(90)
    })

    it('provides shorthand for p90', () => {
      const measure = createMeasure({
        name: 'p90Latency',
        type: 'p90',
        sql: 'response_time',
      })

      expect(measure.percentile).toBe(90)
    })

    it('generates correct percentile value in SQL', () => {
      const measure = createMeasure({
        name: 'p90Latency',
        type: 'p90',
        sql: 'response_time',
      })

      const sql = measure.toSQL('requests', { dialect: 'postgres' })
      expect(sql).toContain('0.9')
    })
  })

  describe('p95', () => {
    it('creates a p95 measure', () => {
      const measure = createMeasure({
        name: 'p95Latency',
        type: 'p95',
        sql: 'response_time',
      })

      expect(measure.percentile).toBe(95)
    })

    it('generates correct percentile value in SQL', () => {
      const measure = createMeasure({
        name: 'p95Latency',
        type: 'p95',
        sql: 'response_time',
      })

      const sql = measure.toSQL('requests', { dialect: 'postgres' })
      expect(sql).toContain('0.95')
    })
  })

  describe('p99', () => {
    it('creates a p99 measure', () => {
      const measure = createMeasure({
        name: 'p99Latency',
        type: 'p99',
        sql: 'response_time',
      })

      expect(measure.percentile).toBe(99)
    })

    it('generates correct percentile value in SQL', () => {
      const measure = createMeasure({
        name: 'p99Latency',
        type: 'p99',
        sql: 'response_time',
      })

      const sql = measure.toSQL('requests', { dialect: 'postgres' })
      expect(sql).toContain('0.99')
    })
  })

  describe('custom percentile', () => {
    it('accepts any percentile value 0-100', () => {
      const measure = createMeasure({
        name: 'p75Latency',
        type: 'percentile',
        percentile: 75,
        sql: 'response_time',
      })

      expect(measure.percentile).toBe(75)
    })

    it('validates percentile is within range', () => {
      expect(() =>
        createMeasure({
          name: 'badPercentile',
          type: 'percentile',
          percentile: -1,
          sql: 'response_time',
        })
      ).toThrow(MeasureError)

      expect(() =>
        createMeasure({
          name: 'badPercentile',
          type: 'percentile',
          percentile: 101,
          sql: 'response_time',
        })
      ).toThrow(MeasureError)
    })

    it('requires sql for percentile measures', () => {
      expect(() =>
        createMeasure({
          name: 'badPercentile',
          type: 'p99',
        })
      ).toThrow(MeasureError)
    })
  })

  describe('SQL dialect support', () => {
    const measure = createMeasure({
      name: 'p95Latency',
      type: 'p95',
      sql: 'response_time',
    })

    it('generates PostgreSQL percentile syntax', () => {
      const sql = measure.toSQL('requests', { dialect: 'postgres' })
      expect(sql).toMatch(/PERCENTILE_CONT|percentile_cont/)
      expect(sql).toMatch(/WITHIN GROUP|within group/)
      expect(sql).toMatch(/ORDER BY|order by/)
    })

    it('generates ClickHouse percentile syntax', () => {
      const sql = measure.toSQL('requests', { dialect: 'clickhouse' })
      expect(sql).toMatch(/quantile|quantileExact/)
    })

    it('generates DuckDB percentile syntax', () => {
      const sql = measure.toSQL('requests', { dialect: 'duckdb' })
      expect(sql).toMatch(/PERCENTILE_CONT|percentile_cont/)
    })

    it('generates SQLite approximate percentile', () => {
      const sql = measure.toSQL('requests', { dialect: 'sqlite' })
      // SQLite doesn't have native percentile - should use subquery approach
      expect(sql).toBeDefined()
    })
  })
})

// =============================================================================
// CUSTOM SQL EXPRESSIONS
// =============================================================================

describe('Measure - Custom SQL Expressions', () => {
  describe('custom type measures', () => {
    it('creates a custom SQL measure', () => {
      const measure = createMeasure({
        name: 'revenuePerCustomer',
        type: 'custom',
        sql: 'SUM(amount) / COUNT(DISTINCT customer_id)',
      })

      expect(measure.name).toBe('revenuePerCustomer')
      expect(measure.type).toBe('custom')
    })

    it('uses custom SQL verbatim', () => {
      const measure = createMeasure({
        name: 'weightedAvg',
        type: 'custom',
        sql: 'SUM(value * weight) / SUM(weight)',
      })

      const sql = measure.toSQL('data')
      expect(sql).toContain('SUM(value * weight) / SUM(weight)')
      expect(sql).toContain('AS weightedAvg')
    })

    it('supports table reference substitution', () => {
      const measure = createMeasure({
        name: 'customCalc',
        type: 'custom',
        sql: 'SUM(${TABLE}.amount) / COUNT(${TABLE}.id)',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('orders.amount')
      expect(sql).toContain('orders.id')
      expect(sql).not.toContain('${TABLE}')
    })

    it('requires sql for custom measures', () => {
      expect(() =>
        createMeasure({
          name: 'badCustom',
          type: 'custom',
        })
      ).toThrow(MeasureError)
    })
  })

  describe('complex expressions', () => {
    it('supports CASE expressions', () => {
      const measure = createMeasure({
        name: 'completedRevenue',
        type: 'custom',
        sql: 'SUM(CASE WHEN status = \'completed\' THEN amount ELSE 0 END)',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('CASE WHEN')
      expect(sql).toContain('completed')
    })

    it('supports window functions reference', () => {
      const measure = createMeasure({
        name: 'runningTotal',
        type: 'custom',
        sql: 'SUM(amount) OVER (ORDER BY created_at)',
        isWindowFunction: true,
      })

      expect(measure.isWindowFunction).toBe(true)
    })

    it('supports subqueries', () => {
      const measure = createMeasure({
        name: 'percentOfTotal',
        type: 'custom',
        sql: 'SUM(amount) * 100.0 / (SELECT SUM(amount) FROM orders)',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('SELECT SUM(amount) FROM orders')
    })

    it('supports COALESCE for null handling', () => {
      const measure = createMeasure({
        name: 'safeSum',
        type: 'custom',
        sql: 'COALESCE(SUM(amount), 0)',
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('COALESCE')
    })
  })
})

// =============================================================================
// COMPOSITE MEASURES (DERIVED)
// =============================================================================

describe('Measure - Composite Measures', () => {
  describe('basic composition', () => {
    it('creates a composite measure from two measures', () => {
      const totalRevenue = createMeasure({
        name: 'totalRevenue',
        type: 'sum',
        sql: 'amount',
      })

      const orderCount = createMeasure({
        name: 'orderCount',
        type: 'count',
      })

      const avgOrderValue = createMeasure({
        name: 'avgOrderValue',
        type: 'composite',
        expression: '{totalRevenue} / {orderCount}',
        measures: { totalRevenue, orderCount },
      })

      expect(avgOrderValue.type).toBe('composite')
      expect(avgOrderValue.composedOf).toContain('totalRevenue')
      expect(avgOrderValue.composedOf).toContain('orderCount')
    })

    it('generates SQL referencing composed measures', () => {
      const totalRevenue = createMeasure({
        name: 'totalRevenue',
        type: 'sum',
        sql: 'amount',
      })

      const orderCount = createMeasure({
        name: 'orderCount',
        type: 'count',
      })

      const avgOrderValue = createMeasure({
        name: 'avgOrderValue',
        type: 'composite',
        expression: '{totalRevenue} / {orderCount}',
        measures: { totalRevenue, orderCount },
      })

      const sql = avgOrderValue.toSQL('orders')
      expect(sql).toContain('SUM')
      expect(sql).toContain('COUNT')
      expect(sql).toContain('/')
    })
  })

  describe('complex compositions', () => {
    it('supports mathematical operations', () => {
      const measure = createMeasure({
        name: 'profitMargin',
        type: 'composite',
        expression: '({revenue} - {cost}) / {revenue} * 100',
        measures: {
          revenue: createMeasure({ name: 'revenue', type: 'sum', sql: 'revenue' }),
          cost: createMeasure({ name: 'cost', type: 'sum', sql: 'cost' }),
        },
      })

      const sql = measure.toSQL('orders')
      expect(sql).toContain('-')
      expect(sql).toContain('/')
      expect(sql).toContain('* 100')
    })

    it('supports nested composite measures', () => {
      const totalRevenue = createMeasure({
        name: 'totalRevenue',
        type: 'sum',
        sql: 'amount',
      })

      const uniqueCustomers = createMeasure({
        name: 'uniqueCustomers',
        type: 'count_distinct',
        sql: 'customer_id',
      })

      const revenuePerCustomer = createMeasure({
        name: 'revenuePerCustomer',
        type: 'composite',
        expression: '{totalRevenue} / {uniqueCustomers}',
        measures: { totalRevenue, uniqueCustomers },
      })

      const avgOrderCount = createMeasure({
        name: 'avgOrderCount',
        type: 'composite',
        expression: '{orderCount} / {uniqueCustomers}',
        measures: {
          orderCount: createMeasure({ name: 'orderCount', type: 'count' }),
          uniqueCustomers,
        },
      })

      // Nested: uses revenuePerCustomer which itself is composite
      const customerValue = createMeasure({
        name: 'customerValue',
        type: 'composite',
        expression: '{revenuePerCustomer} * {avgOrderCount}',
        measures: { revenuePerCustomer, avgOrderCount },
      })

      expect(customerValue.composedOf).toContain('revenuePerCustomer')
      expect(customerValue.composedOf).toContain('avgOrderCount')
    })

    it('validates all referenced measures exist', () => {
      const revenue = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
      })

      expect(() =>
        createMeasure({
          name: 'badComposite',
          type: 'composite',
          expression: '{revenue} / {missingMeasure}',
          measures: { revenue },
        })
      ).toThrow(MeasureError)
    })

    it('prevents circular references', () => {
      // This should be caught and throw
      expect(() => {
        const measureA: any = createMeasure({
          name: 'measureA',
          type: 'composite',
          expression: '{measureB}',
          measures: {},
        })

        const measureB = createMeasure({
          name: 'measureB',
          type: 'composite',
          expression: '{measureA}',
          measures: { measureA },
        })

        // Try to add circular reference
        measureA.measures.measureB = measureB
        measureA.validate()
      }).toThrow()
    })
  })

  describe('composite with formatting', () => {
    it('applies format to composite result', () => {
      const measure = createMeasure({
        name: 'profitMargin',
        type: 'composite',
        expression: '({revenue} - {cost}) / {revenue}',
        measures: {
          revenue: createMeasure({ name: 'revenue', type: 'sum', sql: 'revenue' }),
          cost: createMeasure({ name: 'cost', type: 'sum', sql: 'cost' }),
        },
        format: {
          type: 'percentage',
          decimals: 2,
        },
      })

      expect(measure.format?.type).toBe('percentage')
    })
  })
})

// =============================================================================
// MEASURE FORMATTING
// =============================================================================

describe('Measure - Formatting', () => {
  describe('currency format', () => {
    it('creates measure with currency format', () => {
      const measure = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
        format: {
          type: 'currency',
          currency: 'USD',
        },
      })

      expect(measure.format?.type).toBe('currency')
      expect(measure.format?.currency).toBe('USD')
    })

    it('formats value as currency', () => {
      const measure = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
        format: {
          type: 'currency',
          currency: 'USD',
          decimals: 2,
        },
      })

      const formatted = measure.formatValue(1234.56)
      expect(formatted).toMatch(/\$1,234\.56|\$1234\.56/)
    })

    it('supports different currencies', () => {
      const measureEUR = createMeasure({
        name: 'revenueEUR',
        type: 'sum',
        sql: 'amount',
        format: {
          type: 'currency',
          currency: 'EUR',
        },
      })

      const formatted = measureEUR.formatValue(1234.56)
      expect(formatted).toMatch(/EUR|1\.234,56|1,234\.56/)
    })

    it('handles locale-specific formatting', () => {
      const measure = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
        format: {
          type: 'currency',
          currency: 'USD',
          locale: 'en-US',
        },
      })

      const formatted = measure.formatValue(1234567.89)
      expect(formatted).toContain('$')
    })
  })

  describe('percentage format', () => {
    it('creates measure with percentage format', () => {
      const measure = createMeasure({
        name: 'conversionRate',
        type: 'custom',
        sql: 'SUM(conversions) * 1.0 / SUM(visits)',
        format: {
          type: 'percentage',
          decimals: 2,
        },
      })

      expect(measure.format?.type).toBe('percentage')
    })

    it('formats value as percentage', () => {
      const measure = createMeasure({
        name: 'rate',
        type: 'custom',
        sql: 'ratio',
        format: {
          type: 'percentage',
          decimals: 1,
        },
      })

      // 0.156 should become 15.6%
      const formatted = measure.formatValue(0.156)
      expect(formatted).toMatch(/15\.6\s*%/)
    })

    it('handles multiplier option', () => {
      const measure = createMeasure({
        name: 'rate',
        type: 'custom',
        sql: 'percentage_value',
        format: {
          type: 'percentage',
          decimals: 0,
          multiplier: 1, // Already in percentage form
        },
      })

      const formatted = measure.formatValue(15.6)
      expect(formatted).toMatch(/16\s*%|15\.6\s*%/)
    })
  })

  describe('number format', () => {
    it('creates measure with number format', () => {
      const measure = createMeasure({
        name: 'orderCount',
        type: 'count',
        format: {
          type: 'number',
          decimals: 0,
          thousandsSeparator: true,
        },
      })

      expect(measure.format?.type).toBe('number')
    })

    it('formats with thousands separator', () => {
      const measure = createMeasure({
        name: 'count',
        type: 'count',
        format: {
          type: 'number',
          thousandsSeparator: true,
        },
      })

      const formatted = measure.formatValue(1234567)
      expect(formatted).toMatch(/1,234,567|1\.234\.567/)
    })

    it('formats with specified decimals', () => {
      const measure = createMeasure({
        name: 'avg',
        type: 'avg',
        sql: 'value',
        format: {
          type: 'number',
          decimals: 3,
        },
      })

      const formatted = measure.formatValue(3.14159)
      expect(formatted).toContain('3.142')
    })

    it('supports compact notation', () => {
      const measure = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
        format: {
          type: 'number',
          notation: 'compact',
        },
      })

      const formatted = measure.formatValue(1500000)
      expect(formatted).toMatch(/1\.5M|1,500K|1\.5\s*M/)
    })

    it('supports scientific notation', () => {
      const measure = createMeasure({
        name: 'bigNumber',
        type: 'sum',
        sql: 'value',
        format: {
          type: 'number',
          notation: 'scientific',
        },
      })

      const formatted = measure.formatValue(1.5e10)
      expect(formatted).toMatch(/1\.5e\+?10|1\.5E\+?10/)
    })
  })

  describe('custom format', () => {
    it('supports custom format function', () => {
      const measure = createMeasure({
        name: 'duration',
        type: 'sum',
        sql: 'duration_seconds',
        format: {
          type: 'custom',
          formatter: (value: number) => {
            const hours = Math.floor(value / 3600)
            const minutes = Math.floor((value % 3600) / 60)
            return `${hours}h ${minutes}m`
          },
        },
      })

      const formatted = measure.formatValue(3725)
      expect(formatted).toBe('1h 2m')
    })

    it('supports format template string', () => {
      const measure = createMeasure({
        name: 'temperature',
        type: 'avg',
        sql: 'temp',
        format: {
          type: 'custom',
          template: '{value}°C',
        },
      })

      const formatted = measure.formatValue(23.5)
      expect(formatted).toBe('23.5°C')
    })
  })

  describe('format inheritance', () => {
    it('uses default format when none specified', () => {
      const measure = createMeasure({
        name: 'value',
        type: 'sum',
        sql: 'amount',
      })

      // Should return reasonable default formatting
      const formatted = measure.formatValue(1234.5)
      expect(formatted).toBeDefined()
      expect(typeof formatted).toBe('string')
    })

    it('returns raw value when format.type is none', () => {
      const measure = createMeasure({
        name: 'rawValue',
        type: 'sum',
        sql: 'amount',
        format: {
          type: 'none',
        },
      })

      const formatted = measure.formatValue(1234.5678)
      expect(formatted).toBe('1234.5678')
    })
  })
})

// =============================================================================
// NULL HANDLING
// =============================================================================

describe('Measure - Null Handling', () => {
  describe('null handling strategies', () => {
    it('supports ignoreNulls strategy (default)', () => {
      const measure = createMeasure({
        name: 'avgValue',
        type: 'avg',
        sql: 'value',
        nullHandling: 'ignore',
      })

      const sql = measure.toSQL('data')
      // Standard AVG ignores nulls by default
      expect(sql).toContain('AVG')
    })

    it('supports treatNullAsZero strategy', () => {
      const measure = createMeasure({
        name: 'sumValue',
        type: 'sum',
        sql: 'value',
        nullHandling: 'zero',
      })

      const sql = measure.toSQL('data')
      expect(sql).toContain('COALESCE')
      expect(sql).toContain('0')
    })

    it('supports excludeNulls strategy', () => {
      const measure = createMeasure({
        name: 'countNonNull',
        type: 'count',
        sql: 'value',
        nullHandling: 'exclude',
      })

      const sql = measure.toSQL('data')
      expect(sql).toMatch(/WHERE.*IS NOT NULL|FILTER.*IS NOT NULL|COUNT\([^*]/)
    })

    it('supports replaceWithValue strategy', () => {
      const measure = createMeasure({
        name: 'avgWithDefault',
        type: 'avg',
        sql: 'value',
        nullHandling: {
          strategy: 'replace',
          value: -1,
        },
      })

      const sql = measure.toSQL('data')
      expect(sql).toContain('COALESCE')
      expect(sql).toContain('-1')
    })
  })

  describe('null in composite measures', () => {
    it('propagates null handling to composed measures', () => {
      const revenue = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
        nullHandling: 'zero',
      })

      const count = createMeasure({
        name: 'count',
        type: 'count',
      })

      const avgRevenue = createMeasure({
        name: 'avgRevenue',
        type: 'composite',
        expression: '{revenue} / {count}',
        measures: { revenue, count },
      })

      const sql = avgRevenue.toSQL('orders')
      // Should include null handling from revenue measure
      expect(sql).toContain('COALESCE')
    })
  })

  describe('null in aggregation results', () => {
    it('formats null as specified string', () => {
      const measure = createMeasure({
        name: 'value',
        type: 'sum',
        sql: 'amount',
        format: {
          type: 'number',
          nullDisplay: 'N/A',
        },
      })

      const formatted = measure.formatValue(null)
      expect(formatted).toBe('N/A')
    })

    it('formats null as empty string by default', () => {
      const measure = createMeasure({
        name: 'value',
        type: 'sum',
        sql: 'amount',
        format: {
          type: 'number',
        },
      })

      const formatted = measure.formatValue(null)
      expect(formatted).toBe('')
    })

    it('supports custom null formatter', () => {
      const measure = createMeasure({
        name: 'value',
        type: 'sum',
        sql: 'amount',
        format: {
          type: 'number',
          nullFormatter: () => '-',
        },
      })

      const formatted = measure.formatValue(null)
      expect(formatted).toBe('-')
    })
  })
})

// =============================================================================
// VALIDATION AND EDGE CASES
// =============================================================================

describe('Measure - Validation', () => {
  describe('name validation', () => {
    it('requires non-empty name', () => {
      expect(() =>
        createMeasure({
          name: '',
          type: 'count',
        })
      ).toThrow(MeasureError)
    })

    it('validates name is a valid identifier', () => {
      expect(() =>
        createMeasure({
          name: '123invalid',
          type: 'count',
        })
      ).toThrow(MeasureError)
    })

    it('allows underscores and numbers in name', () => {
      const measure = createMeasure({
        name: 'total_revenue_2024',
        type: 'sum',
        sql: 'amount',
      })

      expect(measure.name).toBe('total_revenue_2024')
    })
  })

  describe('type validation', () => {
    it('validates aggregation type', () => {
      expect(() =>
        createMeasure({
          name: 'bad',
          type: 'invalid' as any,
        })
      ).toThrow(MeasureError)
    })

    it('accepts all valid aggregation types', () => {
      const types: AggregationType[] = [
        'sum',
        'count',
        'count_distinct',
        'avg',
        'min',
        'max',
        'percentile',
        'p50',
        'p90',
        'p95',
        'p99',
        'custom',
        'composite',
      ]

      for (const type of types) {
        if (type === 'count') {
          expect(() => createMeasure({ name: `test_${type}`, type })).not.toThrow()
        } else if (type === 'composite') {
          expect(() =>
            createMeasure({
              name: `test_${type}`,
              type,
              expression: '1',
              measures: {},
            })
          ).not.toThrow()
        } else {
          expect(() =>
            createMeasure({
              name: `test_${type}`,
              type,
              sql: 'value',
              percentile: type.startsWith('p') ? parseInt(type.slice(1)) || 50 : undefined,
            })
          ).not.toThrow()
        }
      }
    })
  })

  describe('sql validation', () => {
    it('prevents SQL injection patterns', () => {
      expect(() =>
        createMeasure({
          name: 'dangerous',
          type: 'custom',
          sql: 'SELECT * FROM users; DROP TABLE users;--',
        })
      ).toThrow(MeasureError)
    })

    it('allows safe SQL expressions', () => {
      const measure = createMeasure({
        name: 'safe',
        type: 'custom',
        sql: 'SUM(CASE WHEN status = \'active\' THEN amount ELSE 0 END)',
      })

      expect(measure.sql).toContain('CASE WHEN')
    })
  })
})

// =============================================================================
// METADATA AND INTROSPECTION
// =============================================================================

describe('Measure - Metadata', () => {
  describe('description and documentation', () => {
    it('stores description', () => {
      const measure = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
        description: 'Total revenue from completed orders',
      })

      expect(measure.description).toBe('Total revenue from completed orders')
    })

    it('stores meta information', () => {
      const measure = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
        meta: {
          owner: 'finance-team',
          tags: ['financial', 'core-kpi'],
          lastUpdated: '2026-01-01',
        },
      })

      expect(measure.meta?.owner).toBe('finance-team')
      expect(measure.meta?.tags).toContain('core-kpi')
    })
  })

  describe('introspection', () => {
    it('exposes measure definition', () => {
      const measure = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
      })

      const def = measure.getDefinition()
      expect(def.name).toBe('revenue')
      expect(def.type).toBe('sum')
      expect(def.sql).toBe('amount')
    })

    it('lists all aggregation dependencies', () => {
      const revenue = createMeasure({
        name: 'revenue',
        type: 'sum',
        sql: 'amount',
      })

      const count = createMeasure({
        name: 'count',
        type: 'count',
      })

      const composite = createMeasure({
        name: 'avgRevenue',
        type: 'composite',
        expression: '{revenue} / {count}',
        measures: { revenue, count },
      })

      const deps = composite.getDependencies()
      expect(deps).toContain('revenue')
      expect(deps).toContain('count')
    })
  })
})

// =============================================================================
// INTEGRATION WITH SEMANTIC LAYER
// =============================================================================

describe('Measure - Semantic Layer Integration', () => {
  it('creates measure compatible with SemanticLayer.defineCube', () => {
    const measure = createMeasure({
      name: 'totalRevenue',
      type: 'sum',
      sql: 'amount',
    })

    // Should be usable as MetricDefinition in cube
    const cubeDefinition = {
      name: 'orders',
      sql: 'SELECT * FROM orders',
      measures: {
        totalRevenue: measure.toMetricDefinition(),
      },
      dimensions: {},
    }

    expect(cubeDefinition.measures.totalRevenue.type).toBe('sum')
    expect(cubeDefinition.measures.totalRevenue.sql).toBe('amount')
  })

  it('converts to MetricDefinition format', () => {
    const measure = createMeasure({
      name: 'p99Latency',
      type: 'p99',
      sql: 'response_time',
      description: '99th percentile latency',
    })

    const metricDef = measure.toMetricDefinition()
    expect(metricDef.type).toBeDefined()
    expect(metricDef.sql).toBe('response_time')
    expect(metricDef.description).toBe('99th percentile latency')
  })
})
