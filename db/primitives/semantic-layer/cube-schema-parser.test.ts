/**
 * Cube.js Schema Parser Tests - TDD RED Phase
 *
 * Comprehensive tests for parsing Cube.js schema files including:
 * - Basic cube definitions with sql, measures, dimensions
 * - Advanced measure types (runningTotal, rollingWindow, calculated)
 * - Dimension subtypes (time with granularity, geo coordinates)
 * - Joins with all relationship types
 * - Segments and pre-aggregations
 * - Schema-level features (dataSource, extends, public)
 * - SQL template expressions and CUBE references
 * - Error handling and validation
 *
 * This test file focuses specifically on the Cube.js schema parsing
 * functionality to ensure comprehensive coverage of the Cube.js format.
 *
 * @see dotdo-849it
 */

import { describe, it, expect } from 'vitest'
import {
  parseCubeJS,
  CubeJSParseError,
  validateImportedSchema,
  type CubeJSSchema,
  type ImportedSchema,
} from './schema-import'

// =============================================================================
// Basic Cube Definition Parsing
// =============================================================================

describe('Cube.js Schema Parser', () => {
  describe('Basic cube definition parsing', () => {
    it('should parse cube with simple SQL string', () => {
      const cubeJS = `
        cube('Orders', {
          sql: 'SELECT * FROM public.orders',
          measures: {
            count: { type: 'count' },
          },
          dimensions: {
            id: { type: 'number', sql: 'id' },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes).toHaveLength(1)
      expect(result.cubes[0].name).toBe('Orders')
      expect(result.cubes[0].sql).toBe('SELECT * FROM public.orders')
    })

    it('should parse cube with template literal SQL', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`
            SELECT *
            FROM orders
            WHERE deleted_at IS NULL
          \`,
          measures: {
            count: { type: 'count' },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].sql).toContain('SELECT *')
      expect(result.cubes[0].sql).toContain('FROM orders')
      expect(result.cubes[0].sql).toContain('deleted_at IS NULL')
    })

    it('should parse cube with arrow function SQL', () => {
      const cubeJS = `
        cube('Orders', {
          sql: () => \`SELECT * FROM \${CUBE.schema}.orders\`,
          measures: {
            count: { type: 'count' },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].sql).toContain('SELECT * FROM')
    })

    it('should parse cube with double-quoted name', () => {
      const cubeJS = `
        cube("Orders", {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].name).toBe('Orders')
    })

    it('should parse cube with table shorthand', () => {
      // This tests the sqlTable property which is an alternative to sql
      const cubeJS = `
        cube('Orders', {
          sqlTable: \`public.orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      // Should convert sqlTable to sql: SELECT * FROM ...
      expect(result.cubes[0].sql).toContain('orders')
    })
  })

  // =============================================================================
  // Measure Type Parsing
  // =============================================================================

  describe('Measure type parsing', () => {
    it('should parse all basic measure types', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            count: { type: 'count' },
            totalAmount: { type: 'sum', sql: 'amount' },
            avgAmount: { type: 'avg', sql: 'amount' },
            minAmount: { type: 'min', sql: 'amount' },
            maxAmount: { type: 'max', sql: 'amount' },
            uniqueCustomers: { type: 'countDistinct', sql: 'customer_id' },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures.count.type).toBe('count')
      expect(result.cubes[0].measures.totalAmount.type).toBe('sum')
      expect(result.cubes[0].measures.avgAmount.type).toBe('avg')
      expect(result.cubes[0].measures.minAmount.type).toBe('min')
      expect(result.cubes[0].measures.maxAmount.type).toBe('max')
      expect(result.cubes[0].measures.uniqueCustomers.type).toBe('countDistinct')
    })

    it('should parse countDistinctApprox measure type', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            approxCustomers: {
              type: 'countDistinctApprox',
              sql: 'customer_id',
            },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures.approxCustomers.type).toBe('countDistinctApprox')
    })

    it('should parse runningTotal measure type', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            runningRevenue: {
              type: 'runningTotal',
              sql: 'amount',
            },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures.runningRevenue.type).toBe('runningTotal')
    })

    it('should parse number measure type (calculated field)', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            count: { type: 'count' },
            totalAmount: { type: 'sum', sql: 'amount' },
            avgOrderValue: {
              type: 'number',
              sql: \`\${totalAmount} / NULLIF(\${count}, 0)\`,
            },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures.avgOrderValue.type).toBe('number')
      expect(result.cubes[0].measures.avgOrderValue.sql).toContain('totalAmount')
    })

    it('should parse measure with format option', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            revenue: {
              type: 'sum',
              sql: 'amount',
              format: 'currency',
            },
            conversionRate: {
              type: 'number',
              sql: '0.15',
              format: 'percent',
            },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures.revenue.format).toBe('currency')
      expect(result.cubes[0].measures.conversionRate.format).toBe('percent')
    })

    it('should parse measure with drillMembers', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            count: {
              type: 'count',
              drillMembers: [id, status, createdAt, customer.name],
            },
          },
          dimensions: {
            id: { type: 'number', sql: 'id' },
            status: { type: 'string', sql: 'status' },
            createdAt: { type: 'time', sql: 'created_at' },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures.count.drillMembers).toBeDefined()
      expect(result.cubes[0].measures.count.drillMembers).toContain('id')
      expect(result.cubes[0].measures.count.drillMembers).toContain('status')
    })

    it('should parse measure with filters', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            completedCount: {
              type: 'count',
              filters: [
                { sql: \`\${CUBE}.status = 'completed'\` },
              ],
            },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures.completedCount.filters).toBeDefined()
      expect(result.cubes[0].measures.completedCount.filters).toHaveLength(1)
    })

    it('should parse measure with rollingWindow', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            rollingCount: {
              type: 'count',
              rollingWindow: {
                trailing: '7 day',
                offset: 'start',
              },
            },
          },
          dimensions: {
            createdAt: { type: 'time', sql: 'created_at' },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      // Rolling window should be parsed and stored
      expect(result.cubes[0].measures.rollingCount).toBeDefined()
    })

    it('should parse measure with title and description', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            revenue: {
              type: 'sum',
              sql: 'amount',
              title: 'Total Revenue',
              description: 'Sum of all order amounts in USD',
            },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures.revenue.description).toBe('Sum of all order amounts in USD')
    })

    it('should parse measure with shown property', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            internalCount: {
              type: 'count',
              shown: false,
            },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      // The shown property should be preserved
      expect(result.cubes[0].measures.internalCount).toBeDefined()
    })
  })

  // =============================================================================
  // Dimension Type Parsing
  // =============================================================================

  describe('Dimension type parsing', () => {
    it('should parse all dimension types', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            id: { type: 'number', sql: 'id', primaryKey: true },
            status: { type: 'string', sql: 'status' },
            createdAt: { type: 'time', sql: 'created_at' },
            isActive: { type: 'boolean', sql: 'is_active' },
            location: { type: 'geo', sql: 'location' },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].dimensions.id.type).toBe('number')
      expect(result.cubes[0].dimensions.id.primaryKey).toBe(true)
      expect(result.cubes[0].dimensions.status.type).toBe('string')
      expect(result.cubes[0].dimensions.createdAt.type).toBe('time')
      expect(result.cubes[0].dimensions.isActive.type).toBe('boolean')
      expect(result.cubes[0].dimensions.location.type).toBe('geo')
    })

    it('should parse dimension with title and description', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            status: {
              type: 'string',
              sql: 'status',
              title: 'Order Status',
              description: 'Current status of the order',
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].dimensions.status.description).toBe('Current status of the order')
    })

    it('should parse dimension with case property', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            statusLabel: {
              type: 'string',
              case: {
                when: [
                  { sql: \`\${CUBE}.status = 'pending'\`, label: 'Pending' },
                  { sql: \`\${CUBE}.status = 'completed'\`, label: 'Completed' },
                ],
                else: { label: 'Unknown' },
              },
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      // Case dimensions should be parsed into appropriate SQL
      expect(result.cubes[0].dimensions.statusLabel).toBeDefined()
    })

    it('should parse dimension with subQuery', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            latestOrderDate: {
              type: 'time',
              sql: \`\${Customer.latestOrderDate}\`,
              subQuery: true,
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      // subQuery dimensions should be parsed
      expect(result.cubes[0].dimensions.latestOrderDate).toBeDefined()
    })

    it('should parse dimension with propagateFiltersToSubQuery', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            customerLifetimeValue: {
              type: 'number',
              sql: \`\${Customer.lifetimeValue}\`,
              subQuery: true,
              propagateFiltersToSubQuery: true,
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].dimensions.customerLifetimeValue).toBeDefined()
    })

    it('should parse dimension with meta object', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            region: {
              type: 'string',
              sql: 'region',
              meta: {
                filterType: 'multiSelect',
                values: ['US', 'EU', 'APAC'],
              },
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      // Meta should be preserved
      expect(result.cubes[0].dimensions.region).toBeDefined()
    })
  })

  // =============================================================================
  // Join Parsing
  // =============================================================================

  describe('Join parsing', () => {
    it('should parse belongsTo join', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          joins: {
            Customer: {
              relationship: 'belongsTo',
              sql: \`\${CUBE}.customer_id = \${Customer}.id\`,
            },
          },
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].joins).toBeDefined()
      expect(result.cubes[0].joins!.Customer).toBeDefined()
      expect(result.cubes[0].joins!.Customer.relationship).toBe('belongsTo')
    })

    it('should parse hasMany join', () => {
      const cubeJS = `
        cube('Customer', {
          sql: \`SELECT * FROM customers\`,
          joins: {
            Orders: {
              relationship: 'hasMany',
              sql: \`\${CUBE}.id = \${Orders}.customer_id\`,
            },
          },
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].joins!.Orders.relationship).toBe('hasMany')
    })

    it('should parse hasOne join', () => {
      const cubeJS = `
        cube('User', {
          sql: \`SELECT * FROM users\`,
          joins: {
            Profile: {
              relationship: 'hasOne',
              sql: \`\${CUBE}.id = \${Profile}.user_id\`,
            },
          },
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].joins!.Profile.relationship).toBe('hasOne')
    })

    it('should parse multiple joins', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          joins: {
            Customer: {
              relationship: 'belongsTo',
              sql: \`\${CUBE}.customer_id = \${Customer}.id\`,
            },
            Product: {
              relationship: 'belongsTo',
              sql: \`\${CUBE}.product_id = \${Product}.id\`,
            },
            Payments: {
              relationship: 'hasMany',
              sql: \`\${CUBE}.id = \${Payments}.order_id\`,
            },
          },
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(Object.keys(result.cubes[0].joins!)).toHaveLength(3)
    })
  })

  // =============================================================================
  // Segment Parsing
  // =============================================================================

  describe('Segment parsing', () => {
    it('should parse single segment', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
          segments: {
            completed: {
              sql: \`\${CUBE}.status = 'completed'\`,
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].segments).toBeDefined()
      expect(result.cubes[0].segments!.completed).toBeDefined()
      expect(result.cubes[0].segments!.completed.sql).toContain('completed')
    })

    it('should parse multiple segments', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
          segments: {
            completed: {
              sql: \`\${CUBE}.status = 'completed'\`,
            },
            pending: {
              sql: \`\${CUBE}.status = 'pending'\`,
            },
            highValue: {
              sql: \`\${CUBE}.amount > 1000\`,
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(Object.keys(result.cubes[0].segments!)).toHaveLength(3)
    })

    it('should parse segment with complex SQL', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
          segments: {
            recentHighValue: {
              sql: \`\${CUBE}.amount > 1000 AND \${CUBE}.created_at > CURRENT_DATE - INTERVAL '30 days'\`,
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].segments!.recentHighValue.sql).toContain('1000')
      expect(result.cubes[0].segments!.recentHighValue.sql).toContain('30 days')
    })
  })

  // =============================================================================
  // Pre-aggregation Parsing
  // =============================================================================

  describe('Pre-aggregation parsing', () => {
    it('should parse basic pre-aggregation', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            count: { type: 'count' },
            totalAmount: { type: 'sum', sql: 'amount' },
          },
          dimensions: {
            status: { type: 'string', sql: 'status' },
            createdAt: { type: 'time', sql: 'created_at' },
          },
          preAggregations: {
            ordersByDay: {
              measures: [count, totalAmount],
              dimensions: [status],
              timeDimension: createdAt,
              granularity: 'day',
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].preAggregations).toBeDefined()
      expect(result.cubes[0].preAggregations!.ordersByDay).toBeDefined()
      expect(result.cubes[0].preAggregations!.ordersByDay.granularity).toBe('day')
    })

    it('should parse pre-aggregation with refreshKey', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: { createdAt: { type: 'time', sql: 'created_at' } },
          preAggregations: {
            ordersByDay: {
              measures: [count],
              timeDimension: createdAt,
              granularity: 'day',
              refreshKey: {
                every: '1 hour',
              },
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].preAggregations!.ordersByDay.refreshKey).toBeDefined()
    })

    it('should parse pre-aggregation with partitionGranularity', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: { createdAt: { type: 'time', sql: 'created_at' } },
          preAggregations: {
            ordersByDay: {
              measures: [count],
              timeDimension: createdAt,
              granularity: 'day',
              partitionGranularity: 'month',
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      // partitionGranularity should be parsed
      expect(result.cubes[0].preAggregations!.ordersByDay).toBeDefined()
    })

    it('should parse pre-aggregation with indexes', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            status: { type: 'string', sql: 'status' },
            createdAt: { type: 'time', sql: 'created_at' },
          },
          preAggregations: {
            ordersByDay: {
              measures: [count],
              dimensions: [status],
              timeDimension: createdAt,
              granularity: 'day',
              indexes: {
                statusIndex: {
                  columns: [status],
                },
              },
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      // indexes should be parsed
      expect(result.cubes[0].preAggregations!.ordersByDay).toBeDefined()
    })

    it('should parse multiple pre-aggregations', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            status: { type: 'string', sql: 'status' },
            createdAt: { type: 'time', sql: 'created_at' },
          },
          preAggregations: {
            ordersByDay: {
              measures: [count],
              timeDimension: createdAt,
              granularity: 'day',
            },
            ordersByMonth: {
              measures: [count],
              timeDimension: createdAt,
              granularity: 'month',
            },
            ordersByStatus: {
              measures: [count],
              dimensions: [status],
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(Object.keys(result.cubes[0].preAggregations!)).toHaveLength(3)
    })
  })

  // =============================================================================
  // Schema-level Features
  // =============================================================================

  describe('Schema-level features', () => {
    it('should parse cube with dataSource', () => {
      const cubeJS = `
        cube('Orders', {
          dataSource: 'analytics_db',
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].dataSource).toBe('analytics_db')
    })

    it('should parse cube with extends', () => {
      const cubeJS = `
        cube('BaseOrders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
        });

        cube('ExtendedOrders', {
          extends: BaseOrders,
          measures: {
            totalAmount: { type: 'sum', sql: 'amount' },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[1].extends).toBe('BaseOrders')
    })

    it('should parse cube with public property', () => {
      const cubeJS = `
        cube('InternalOrders', {
          public: false,
          sql: \`SELECT * FROM internal_orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      // public property should be parsed
      expect(result.cubes[0]).toBeDefined()
    })

    it('should parse cube with refreshKey at cube level', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          refreshKey: {
            every: '5 minutes',
          },
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].refreshKey).toBeDefined()
      expect(result.cubes[0].refreshKey!.every).toBe('5 minutes')
    })

    it('should parse cube with refreshKey SQL', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          refreshKey: {
            sql: \`SELECT MAX(updated_at) FROM orders\`,
          },
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].refreshKey).toBeDefined()
    })

    it('should parse cube with sqlAlias', () => {
      const cubeJS = `
        cube('OrdersWithLongName', {
          sql: \`SELECT * FROM orders\`,
          sqlAlias: 'orders',
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      // sqlAlias should be parsed
      expect(result.cubes[0]).toBeDefined()
    })

    it('should parse cube with title and description', () => {
      const cubeJS = `
        cube('Orders', {
          title: 'Order Analytics',
          description: 'Cube for analyzing order data',
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      // title and description should be parsed
      expect(result.cubes[0]).toBeDefined()
    })
  })

  // =============================================================================
  // SQL Template Expressions
  // =============================================================================

  describe('SQL template expressions', () => {
    it('should parse CUBE reference in SQL', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            amount: {
              type: 'number',
              sql: \`\${CUBE}.amount\`,
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].dimensions.amount.sql).toContain('CUBE')
    })

    it('should parse cross-cube references', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          joins: {
            Customer: {
              relationship: 'belongsTo',
              sql: \`\${CUBE}.customer_id = \${Customer.id}\`,
            },
          },
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].joins!.Customer.sql).toContain('Customer')
    })

    it('should parse SECURITY_CONTEXT in SQL', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders WHERE tenant_id = \${SECURITY_CONTEXT.tenantId}\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].sql).toContain('SECURITY_CONTEXT')
    })

    it('should parse FILTER_PARAMS in SQL', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`
            SELECT * FROM orders
            WHERE 1=1
            \${FILTER_PARAMS.Orders.status.filter('status')}
          \`,
          measures: { count: { type: 'count' } },
          dimensions: {
            status: { type: 'string', sql: 'status' },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].sql).toContain('FILTER_PARAMS')
    })

    it('should parse USER_CONTEXT in SQL', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders WHERE created_by = \${USER_CONTEXT.userId}\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].sql).toContain('USER_CONTEXT')
    })

    it('should parse SQL_UTILS helpers', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {
            createdAt: {
              type: 'time',
              sql: \`\${SQL_UTILS.convertTz('created_at')}\`,
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].dimensions.createdAt.sql).toContain('SQL_UTILS')
    })
  })

  // =============================================================================
  // Context Members
  // =============================================================================

  describe('Context members', () => {
    it('should parse contextMembers', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders WHERE tenant_id = \${SECURITY_CONTEXT.tenantId}\`,
          contextMembers: {
            tenantId: {
              sql: 'tenant_id',
            },
          },
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].contextMembers).toBeDefined()
      expect(result.cubes[0].contextMembers!.tenantId).toBeDefined()
    })
  })

  // =============================================================================
  // Error Handling
  // =============================================================================

  describe('Error handling', () => {
    it('should throw CubeJSParseError for missing cube definitions', () => {
      const cubeJS = `
        // Just a comment, no cube
        const something = 'not a cube';
      `

      expect(() => parseCubeJS(cubeJS)).toThrow(CubeJSParseError)
    })

    it('should throw CubeJSParseError for malformed cube definition', () => {
      const cubeJS = `
        cube('Orders', {
          // Missing closing brace
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
      `

      expect(() => parseCubeJS(cubeJS)).toThrow(CubeJSParseError)
    })

    it('should throw for empty cube name', () => {
      const cubeJS = `
        cube('', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      expect(() => parseCubeJS(cubeJS)).toThrow()
    })

    it('should handle syntax errors gracefully', () => {
      const cubeJS = `
        cube('Orders', {
          sql: SELECT * FROM orders, // missing backticks
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      expect(() => parseCubeJS(cubeJS)).toThrow(CubeJSParseError)
    })
  })

  // =============================================================================
  // Schema Conversion
  // =============================================================================

  describe('Schema conversion', () => {
    it('should convert Cube.js schema to SemanticLayer format', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            count: { type: 'count' },
            totalAmount: { type: 'sum', sql: 'amount' },
          },
          dimensions: {
            id: { type: 'number', sql: 'id', primaryKey: true },
            status: { type: 'string', sql: 'status' },
            createdAt: { type: 'time', sql: 'created_at' },
          },
        });
      `

      const parsed = parseCubeJS(cubeJS)
      const schema = parsed.toSemanticLayer()

      expect(schema.cubes).toHaveLength(1)
      expect(schema.cubes[0].name).toBe('Orders')

      // Check measures are converted
      expect(schema.cubes[0].measures.count.type).toBe('count')
      expect(schema.cubes[0].measures.totalAmount.type).toBe('sum')

      // Check dimensions are converted
      expect(schema.cubes[0].dimensions.id.type).toBe('number')
      expect(schema.cubes[0].dimensions.id.primaryKey).toBe(true)
      expect(schema.cubes[0].dimensions.status.type).toBe('string')
      expect(schema.cubes[0].dimensions.createdAt.type).toBe('time')
    })

    it('should convert joins properly', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          joins: {
            Customer: {
              relationship: 'belongsTo',
              sql: \`\${CUBE}.customer_id = \${Customer}.id\`,
            },
          },
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const parsed = parseCubeJS(cubeJS)
      const schema = parsed.toSemanticLayer()

      expect(schema.cubes[0].joins).toBeDefined()
      expect(schema.cubes[0].joins).toHaveLength(1)
      expect(schema.cubes[0].joins![0].name).toBe('Customer')
      expect(schema.cubes[0].joins![0].relationship).toBe('belongsTo')
    })

    it('should convert segments properly', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
          segments: {
            completed: { sql: \`\${CUBE}.status = 'completed'\` },
          },
        });
      `

      const parsed = parseCubeJS(cubeJS)
      const schema = parsed.toSemanticLayer()

      expect(schema.cubes[0].segments).toBeDefined()
      expect(schema.cubes[0].segments!.completed).toBeDefined()
    })

    it('should convert pre-aggregations properly', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: { createdAt: { type: 'time', sql: 'created_at' } },
          preAggregations: {
            ordersByDay: {
              measures: [count],
              timeDimension: createdAt,
              granularity: 'day',
            },
          },
        });
      `

      const parsed = parseCubeJS(cubeJS)
      const schema = parsed.toSemanticLayer()

      expect(schema.cubes[0].preAggregations).toBeDefined()
      expect(schema.cubes[0].preAggregations).toHaveLength(1)
      expect(schema.cubes[0].preAggregations![0].name).toBe('ordersByDay')
      expect(schema.cubes[0].preAggregations![0].granularity).toBe('day')
    })
  })

  // =============================================================================
  // Validation
  // =============================================================================

  describe('Schema validation', () => {
    it('should validate converted schema', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
        });
      `

      const parsed = parseCubeJS(cubeJS)
      const schema = parsed.toSemanticLayer()

      expect(() => validateImportedSchema(schema)).not.toThrow()
    })

    it('should validate measure references in pre-aggregations', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
          preAggregations: {
            ordersByDay: {
              measures: [count, nonExistentMeasure],
              granularity: 'day',
            },
          },
        });
      `

      const parsed = parseCubeJS(cubeJS)
      const schema = parsed.toSemanticLayer()

      // Validation should catch the non-existent measure reference
      expect(() => validateImportedSchema(schema)).toThrow()
    })
  })

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('Edge cases', () => {
    it('should handle cube with no measures', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {},
          dimensions: { id: { type: 'number', sql: 'id' } },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures).toEqual({})
    })

    it('should handle cube with no dimensions', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].dimensions).toEqual({})
    })

    it('should handle deeply nested SQL expressions', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`
            SELECT *
            FROM (
              SELECT *
              FROM (
                SELECT * FROM orders
              ) AS inner_orders
            ) AS outer_orders
          \`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].sql).toContain('inner_orders')
      expect(result.cubes[0].sql).toContain('outer_orders')
    })

    it('should handle special characters in cube names', () => {
      const cubeJS = `
        cube('Orders_v2', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].name).toBe('Orders_v2')
    })

    it('should handle unicode in strings', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: {
            count: {
              type: 'count',
              description: 'Order count - numero de pedidos',
            },
          },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].measures.count.description).toContain('numero')
    })

    it('should handle empty preAggregations object', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: {},
          preAggregations: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].preAggregations).toBeDefined()
    })

    it('should handle comments in cube definition', () => {
      const cubeJS = `
        cube('Orders', {
          // This is a comment
          sql: \`SELECT * FROM orders\`,
          /* Multi-line
             comment */
          measures: { count: { type: 'count' } },
          dimensions: {},
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].name).toBe('Orders')
    })
  })
})
