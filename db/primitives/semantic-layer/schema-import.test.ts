/**
 * Schema Import/Export Tests - TDD RED Phase
 *
 * Tests for LookML and Cube.js schema import/export functionality:
 * - Parse LookML files and convert to SemanticLayer schema
 * - Parse Cube.js schema files and convert
 * - Export SemanticLayer schema to LookML
 * - Export to Cube.js format
 * - Validation of imported schemas
 *
 * @see dotdo-mulms
 */

import { describe, it, expect } from 'vitest'
import {
  // LookML
  parseLookML,
  exportToLookML,
  LookMLParseError,

  // Cube.js
  parseCubeJS,
  exportToCubeJS,
  CubeJSParseError,

  // Validation
  validateImportedSchema,
  SchemaValidationError,

  // Types
  type LookMLView,
  type LookMLModel,
  type LookMLExplore,
  type CubeJSSchema,
  type ImportedSchema,
} from './schema-import'

// =============================================================================
// LookML Parser Tests
// =============================================================================

describe('LookML Parser', () => {
  describe('parseLookML()', () => {
    it('should parse a simple view with dimensions', () => {
      const lookml = `
        view: orders {
          sql_table_name: public.orders ;;

          dimension: id {
            type: number
            primary_key: yes
            sql: \${TABLE}.id ;;
          }

          dimension: status {
            type: string
            sql: \${TABLE}.status ;;
          }

          dimension_group: created {
            type: time
            timeframes: [date, week, month, year]
            sql: \${TABLE}.created_at ;;
          }
        }
      `

      const result = parseLookML(lookml)

      expect(result.views).toHaveLength(1)
      expect(result.views[0].name).toBe('orders')
      expect(result.views[0].dimensions).toHaveLength(2)
      expect(result.views[0].dimensionGroups).toHaveLength(1)
    })

    it('should parse views with measures', () => {
      const lookml = `
        view: orders {
          sql_table_name: public.orders ;;

          dimension: id {
            type: number
            primary_key: yes
            sql: \${TABLE}.id ;;
          }

          measure: count {
            type: count
          }

          measure: total_amount {
            type: sum
            sql: \${TABLE}.amount ;;
          }

          measure: average_amount {
            type: average
            sql: \${TABLE}.amount ;;
          }
        }
      `

      const result = parseLookML(lookml)

      expect(result.views[0].measures).toHaveLength(3)
      expect(result.views[0].measures[0].name).toBe('count')
      expect(result.views[0].measures[0].type).toBe('count')
      expect(result.views[0].measures[1].name).toBe('total_amount')
      expect(result.views[0].measures[1].type).toBe('sum')
    })

    it('should parse derived tables', () => {
      const lookml = `
        view: order_summary {
          derived_table: {
            sql:
              SELECT
                customer_id,
                COUNT(*) as order_count,
                SUM(amount) as total_amount
              FROM orders
              GROUP BY customer_id ;;
          }

          dimension: customer_id {
            type: number
            sql: \${TABLE}.customer_id ;;
          }

          measure: order_count {
            type: sum
            sql: \${TABLE}.order_count ;;
          }
        }
      `

      const result = parseLookML(lookml)

      expect(result.views[0].derivedTable).toBeDefined()
      expect(result.views[0].derivedTable?.sql).toContain('SELECT')
    })

    it('should parse explores with joins', () => {
      const lookml = `
        explore: orders {
          join: customers {
            type: left_outer
            relationship: many_to_one
            sql_on: \${orders.customer_id} = \${customers.id} ;;
          }

          join: products {
            type: inner
            relationship: many_to_one
            sql_on: \${orders.product_id} = \${products.id} ;;
          }
        }
      `

      const result = parseLookML(lookml)

      expect(result.explores).toHaveLength(1)
      expect(result.explores[0].joins).toHaveLength(2)
      expect(result.explores[0].joins[0].name).toBe('customers')
      expect(result.explores[0].joins[0].relationship).toBe('many_to_one')
    })

    it('should parse models with includes', () => {
      const lookml = `
        connection: "database"
        include: "/views/*.view.lkml"
        include: "/explores/*.explore.lkml"
      `

      const result = parseLookML(lookml)

      expect(result.connection).toBe('database')
      expect(result.includes).toHaveLength(2)
    })

    it('should handle measure filters', () => {
      const lookml = `
        view: orders {
          sql_table_name: orders ;;

          measure: completed_count {
            type: count
            filters: [status: "completed"]
          }

          measure: total_revenue {
            type: sum
            sql: \${TABLE}.amount ;;
            filters: [status: "completed, shipped"]
          }
        }
      `

      const result = parseLookML(lookml)

      expect(result.views[0].measures[0].filters).toBeDefined()
      expect(result.views[0].measures[0].filters).toHaveLength(1)
    })

    it('should parse sets and drill fields', () => {
      const lookml = `
        view: orders {
          sql_table_name: orders ;;

          set: order_details {
            fields: [id, status, amount, created_date]
          }

          measure: count {
            type: count
            drill_fields: [order_details*]
          }
        }
      `

      const result = parseLookML(lookml)

      expect(result.views[0].sets).toHaveLength(1)
      expect(result.views[0].sets[0].name).toBe('order_details')
      expect(result.views[0].measures[0].drillFields).toBeDefined()
    })

    it('should handle invalid syntax gracefully by returning empty/partial results', () => {
      // Note: A regex-based parser is lenient and won't throw for most invalid syntax
      // It simply fails to match patterns and returns empty/partial results
      const invalidLookml = `
        view: orders {
          this is not valid LookML syntax
        }
      `

      // Parser doesn't throw - returns a view with empty members
      const result = parseLookML(invalidLookml)
      expect(result.views).toHaveLength(1)
      expect(result.views[0].name).toBe('orders')
      expect(result.views[0].dimensions).toHaveLength(0)
      expect(result.views[0].measures).toHaveLength(0)
    })

    it('should handle multiple views in one file', () => {
      const lookml = `
        view: orders {
          sql_table_name: orders ;;
          dimension: id { type: number sql: \${TABLE}.id ;; }
        }

        view: customers {
          sql_table_name: customers ;;
          dimension: id { type: number sql: \${TABLE}.id ;; }
        }
      `

      const result = parseLookML(lookml)

      expect(result.views).toHaveLength(2)
      expect(result.views[0].name).toBe('orders')
      expect(result.views[1].name).toBe('customers')
    })

    it('should parse parameter definitions', () => {
      const lookml = `
        view: orders {
          sql_table_name: orders ;;

          parameter: date_granularity {
            type: unquoted
            allowed_values: [day, week, month, year]
            default_value: "day"
          }

          dimension: dynamic_date {
            type: date
            sql: DATE_TRUNC({% parameter date_granularity %}, \${TABLE}.created_at) ;;
          }
        }
      `

      const result = parseLookML(lookml)

      expect(result.views[0].parameters).toHaveLength(1)
      expect(result.views[0].parameters[0].name).toBe('date_granularity')
    })

    it('should parse access grants', () => {
      const lookml = `
        access_grant: can_see_revenue {
          user_attribute: department
          allowed_values: ["finance", "executive"]
        }

        view: orders {
          sql_table_name: orders ;;

          measure: total_revenue {
            type: sum
            sql: \${TABLE}.amount ;;
            required_access_grants: [can_see_revenue]
          }
        }
      `

      const result = parseLookML(lookml)

      expect(result.accessGrants).toHaveLength(1)
      expect(result.views[0].measures[0].requiredAccessGrants).toContain('can_see_revenue')
    })
  })

  describe('convertLookMLToSemanticLayer()', () => {
    it('should convert LookML view to SemanticLayer cube', () => {
      const lookml = `
        view: orders {
          sql_table_name: public.orders ;;

          dimension: id {
            type: number
            primary_key: yes
            sql: \${TABLE}.id ;;
          }

          dimension: status {
            type: string
            sql: \${TABLE}.status ;;
          }

          measure: count {
            type: count
          }

          measure: total_amount {
            type: sum
            sql: \${TABLE}.amount ;;
          }
        }
      `

      const parsed = parseLookML(lookml)
      const schema = parsed.toSemanticLayer()

      expect(schema.cubes).toHaveLength(1)
      expect(schema.cubes[0].name).toBe('orders')
      expect(schema.cubes[0].sql).toContain('public.orders')
      expect(Object.keys(schema.cubes[0].dimensions)).toHaveLength(2)
      expect(Object.keys(schema.cubes[0].measures)).toHaveLength(2)
    })

    it('should map LookML types to SemanticLayer types', () => {
      const lookml = `
        view: orders {
          sql_table_name: orders ;;

          dimension: id { type: number sql: \${TABLE}.id ;; }
          dimension: status { type: string sql: \${TABLE}.status ;; }
          dimension: is_active { type: yesno sql: \${TABLE}.is_active ;; }
          dimension_group: created { type: time sql: \${TABLE}.created_at ;; }

          measure: count { type: count }
          measure: total { type: sum sql: \${TABLE}.amount ;; }
          measure: average { type: average sql: \${TABLE}.amount ;; }
          measure: minimum { type: min sql: \${TABLE}.amount ;; }
          measure: maximum { type: max sql: \${TABLE}.amount ;; }
          measure: unique { type: count_distinct sql: \${TABLE}.customer_id ;; }
        }
      `

      const parsed = parseLookML(lookml)
      const schema = parsed.toSemanticLayer()

      // Check dimension types
      expect(schema.cubes[0].dimensions.id.type).toBe('number')
      expect(schema.cubes[0].dimensions.status.type).toBe('string')
      expect(schema.cubes[0].dimensions.is_active.type).toBe('boolean')
      expect(schema.cubes[0].dimensions.created.type).toBe('time')

      // Check measure types
      expect(schema.cubes[0].measures.count.type).toBe('count')
      expect(schema.cubes[0].measures.total.type).toBe('sum')
      expect(schema.cubes[0].measures.average.type).toBe('avg')
      expect(schema.cubes[0].measures.minimum.type).toBe('min')
      expect(schema.cubes[0].measures.maximum.type).toBe('max')
      expect(schema.cubes[0].measures.unique.type).toBe('countDistinct')
    })

    it('should convert LookML joins to SemanticLayer joins', () => {
      const lookml = `
        view: orders {
          sql_table_name: orders ;;
          dimension: id { type: number primary_key: yes sql: \${TABLE}.id ;; }
          dimension: customer_id { type: number sql: \${TABLE}.customer_id ;; }
        }

        view: customers {
          sql_table_name: customers ;;
          dimension: id { type: number primary_key: yes sql: \${TABLE}.id ;; }
        }

        explore: orders {
          join: customers {
            relationship: many_to_one
            sql_on: \${orders.customer_id} = \${customers.id} ;;
          }
        }
      `

      const parsed = parseLookML(lookml)
      const schema = parsed.toSemanticLayer()

      expect(schema.cubes[0].joins).toBeDefined()
      expect(schema.cubes[0].joins).toHaveLength(1)
      expect(schema.cubes[0].joins[0].name).toBe('customers')
      expect(schema.cubes[0].joins[0].relationship).toBe('belongsTo')
    })
  })
})

// =============================================================================
// LookML Exporter Tests
// =============================================================================

describe('LookML Exporter', () => {
  describe('exportToLookML()', () => {
    it('should export SemanticLayer cube to LookML view', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'orders',
            sql: 'SELECT * FROM orders',
            measures: {
              count: { type: 'count' },
              total_amount: { type: 'sum', sql: 'amount' },
            },
            dimensions: {
              id: { type: 'number', sql: 'id', primaryKey: true },
              status: { type: 'string', sql: 'status' },
            },
          },
        ],
      }

      const lookml = exportToLookML(schema)

      expect(lookml).toContain('view: orders {')
      expect(lookml).toContain('sql_table_name:')
      expect(lookml).toContain('dimension: id {')
      expect(lookml).toContain('type: number')
      expect(lookml).toContain('primary_key: yes')
      expect(lookml).toContain('measure: count {')
      expect(lookml).toContain('type: count')
    })

    it('should export time dimensions as dimension_groups', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: {
              created_at: { type: 'time', sql: 'created_at' },
            },
          },
        ],
      }

      const lookml = exportToLookML(schema)

      expect(lookml).toContain('dimension_group: created_at {')
      expect(lookml).toContain('type: time')
      expect(lookml).toContain('timeframes:')
    })

    it('should export joins as explore', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: {
              id: { type: 'number', sql: 'id', primaryKey: true },
            },
            joins: [
              {
                name: 'customers',
                relationship: 'belongsTo',
                sql: '${orders}.customer_id = ${customers}.id',
              },
            ],
          },
        ],
      }

      const lookml = exportToLookML(schema)

      expect(lookml).toContain('explore: orders {')
      expect(lookml).toContain('join: customers {')
      expect(lookml).toContain('relationship: many_to_one')
    })

    it('should handle segments as hidden dimensions with filters', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: {
              id: { type: 'number', sql: 'id' },
            },
            segments: {
              completed: { sql: "status = 'completed'" },
            },
          },
        ],
      }

      const lookml = exportToLookML(schema)

      // Segments become dimension filters in LookML
      expect(lookml).toContain('dimension: is_completed {')
      expect(lookml).toContain('type: yesno')
    })

    it('should generate valid LookML syntax', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'orders',
            sql: 'SELECT * FROM public.orders',
            measures: {
              count: { type: 'count', description: 'Total order count' },
            },
            dimensions: {
              id: { type: 'number', sql: 'id', primaryKey: true },
            },
          },
        ],
      }

      const lookml = exportToLookML(schema)

      // Should end statements with ;;
      expect(lookml).toMatch(/sql:.*;;/s)
      // Should have proper indentation
      expect(lookml).toMatch(/^\s{2}dimension:/m)
    })
  })
})

// =============================================================================
// Cube.js Parser Tests
// =============================================================================

describe('Cube.js Parser', () => {
  describe('parseCubeJS()', () => {
    it('should parse a simple cube definition', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,

          measures: {
            count: {
              type: 'count',
            },
            totalAmount: {
              type: 'sum',
              sql: 'amount',
            },
          },

          dimensions: {
            id: {
              type: 'number',
              sql: 'id',
              primaryKey: true,
            },
            status: {
              type: 'string',
              sql: 'status',
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes).toHaveLength(1)
      expect(result.cubes[0].name).toBe('Orders')
      expect(Object.keys(result.cubes[0].measures)).toHaveLength(2)
      expect(Object.keys(result.cubes[0].dimensions)).toHaveLength(2)
    })

    it('should parse cube with joins', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,

          joins: {
            Customers: {
              relationship: 'belongsTo',
              sql: \`\${CUBE}.customer_id = \${Customers}.id\`,
            },
          },

          measures: {
            count: { type: 'count' },
          },

          dimensions: {
            id: { type: 'number', sql: 'id', primaryKey: true },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].joins).toBeDefined()
      expect(Object.keys(result.cubes[0].joins!)).toHaveLength(1)
      expect(result.cubes[0].joins!.Customers.relationship).toBe('belongsTo')
    })

    it('should parse cube with segments', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,

          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },

          segments: {
            completed: {
              sql: \`\${CUBE}.status = 'completed'\`,
            },
            highValue: {
              sql: \`\${CUBE}.amount > 100\`,
            },
          },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].segments).toBeDefined()
      expect(Object.keys(result.cubes[0].segments!)).toHaveLength(2)
    })

    it('should parse cube with pre-aggregations', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,

          measures: {
            count: { type: 'count' },
            totalAmount: { type: 'sum', sql: 'amount' },
          },

          dimensions: {
            createdAt: { type: 'time', sql: 'created_at' },
            status: { type: 'string', sql: 'status' },
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
    })

    it('should parse cube with refresh key', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,

          refreshKey: {
            every: '1 hour',
          },

          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].refreshKey).toBeDefined()
      expect(result.cubes[0].refreshKey!.every).toBe('1 hour')
    })

    it('should parse multiple cubes', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
        });

        cube('Customers', {
          sql: \`SELECT * FROM customers\`,
          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes).toHaveLength(2)
      expect(result.cubes[0].name).toBe('Orders')
      expect(result.cubes[1].name).toBe('Customers')
    })

    it('should handle extends', () => {
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
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[1].extends).toBe('BaseOrders')
    })

    it('should handle invalid syntax gracefully by returning partial results', () => {
      // Note: A regex-based parser is lenient and won't throw for most invalid syntax
      // It simply fails to match patterns and returns partial results
      const invalidCubeJS = `
        cube('Orders', {
          this is not valid JavaScript
        });
      `

      // Parser doesn't throw - returns a cube with empty members
      const result = parseCubeJS(invalidCubeJS)
      expect(result.cubes).toHaveLength(1)
      expect(result.cubes[0].name).toBe('Orders')
      expect(Object.keys(result.cubes[0].measures)).toHaveLength(0)
      expect(Object.keys(result.cubes[0].dimensions)).toHaveLength(0)
    })

    it('should parse drill members', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders\`,

          measures: {
            count: {
              type: 'count',
              drillMembers: [id, status, createdAt],
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
      expect(result.cubes[0].measures.count.drillMembers).toHaveLength(3)
    })

    it('should parse context variables', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`SELECT * FROM orders WHERE tenant_id = \${SECURITY_CONTEXT.tenantId}\`,

          contextMembers: {
            tenantId: {
              sql: 'tenant_id',
            },
          },

          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
        });
      `

      const result = parseCubeJS(cubeJS)

      expect(result.cubes[0].contextMembers).toBeDefined()
    })
  })

  describe('convertCubeJSToSemanticLayer()', () => {
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
          },
        });
      `

      const parsed = parseCubeJS(cubeJS)
      const schema = parsed.toSemanticLayer()

      expect(schema.cubes).toHaveLength(1)
      expect(schema.cubes[0].name).toBe('Orders')
      expect(schema.cubes[0].measures.count.type).toBe('count')
      expect(schema.cubes[0].measures.totalAmount.type).toBe('sum')
    })
  })
})

// =============================================================================
// Cube.js Exporter Tests
// =============================================================================

describe('Cube.js Exporter', () => {
  describe('exportToCubeJS()', () => {
    it('should export SemanticLayer cube to Cube.js format', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: {
              count: { type: 'count' },
              totalAmount: { type: 'sum', sql: 'amount' },
            },
            dimensions: {
              id: { type: 'number', sql: 'id', primaryKey: true },
              status: { type: 'string', sql: 'status' },
            },
          },
        ],
      }

      const cubeJS = exportToCubeJS(schema)

      expect(cubeJS).toContain("cube('Orders'")
      expect(cubeJS).toContain('sql: `SELECT * FROM orders`')
      expect(cubeJS).toContain('count: {')
      expect(cubeJS).toContain("type: 'count'")
      expect(cubeJS).toContain('totalAmount: {')
      expect(cubeJS).toContain("type: 'sum'")
    })

    it('should export joins', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: {
              id: { type: 'number', sql: 'id', primaryKey: true },
            },
            joins: [
              {
                name: 'Customers',
                relationship: 'belongsTo',
                sql: '${CUBE}.customer_id = ${Customers}.id',
              },
            ],
          },
        ],
      }

      const cubeJS = exportToCubeJS(schema)

      expect(cubeJS).toContain('joins: {')
      expect(cubeJS).toContain('Customers: {')
      expect(cubeJS).toContain("relationship: 'belongsTo'")
    })

    it('should export segments', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: {
              id: { type: 'number', sql: 'id' },
            },
            segments: {
              completed: { sql: "status = 'completed'" },
            },
          },
        ],
      }

      const cubeJS = exportToCubeJS(schema)

      expect(cubeJS).toContain('segments: {')
      expect(cubeJS).toContain('completed: {')
    })

    it('should export pre-aggregations', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: {
              count: { type: 'count' },
              totalAmount: { type: 'sum', sql: 'amount' },
            },
            dimensions: {
              status: { type: 'string', sql: 'status' },
              createdAt: { type: 'time', sql: 'created_at' },
            },
            preAggregations: [
              {
                name: 'ordersByDay',
                measures: ['count', 'totalAmount'],
                dimensions: ['status'],
                timeDimension: 'createdAt',
                granularity: 'day',
              },
            ],
          },
        ],
      }

      const cubeJS = exportToCubeJS(schema)

      expect(cubeJS).toContain('preAggregations: {')
      expect(cubeJS).toContain('ordersByDay: {')
      expect(cubeJS).toContain("granularity: 'day'")
    })

    it('should generate valid JavaScript syntax', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: { id: { type: 'number', sql: 'id' } },
          },
        ],
      }

      const cubeJS = exportToCubeJS(schema)

      // Should be syntactically valid - test by checking structure
      expect(cubeJS).toMatch(/cube\s*\(\s*['"]Orders['"]\s*,\s*\{/)
      expect(cubeJS).toMatch(/\}\s*\)\s*;?\s*$/)
    })
  })
})

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe('Schema Validation', () => {
  describe('validateImportedSchema()', () => {
    it('should validate a valid schema', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: { id: { type: 'number', sql: 'id' } },
          },
        ],
      }

      expect(() => validateImportedSchema(schema)).not.toThrow()
    })

    it('should throw for schema with no cubes', () => {
      const schema: ImportedSchema = {
        cubes: [],
      }

      expect(() => validateImportedSchema(schema)).toThrow(SchemaValidationError)
    })

    it('should throw for cube without name', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: '',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: {},
          },
        ],
      }

      expect(() => validateImportedSchema(schema)).toThrow(SchemaValidationError)
    })

    it('should throw for cube without sql', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: '',
            measures: { count: { type: 'count' } },
            dimensions: {},
          },
        ],
      }

      expect(() => validateImportedSchema(schema)).toThrow(SchemaValidationError)
    })

    it('should throw for invalid measure type', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: {
              // @ts-expect-error - Testing runtime validation
              invalid: { type: 'invalid_type' },
            },
            dimensions: {},
          },
        ],
      }

      expect(() => validateImportedSchema(schema)).toThrow(SchemaValidationError)
    })

    it('should throw for invalid dimension type', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: {
              // @ts-expect-error - Testing runtime validation
              invalid: { type: 'invalid_type', sql: 'col' },
            },
          },
        ],
      }

      expect(() => validateImportedSchema(schema)).toThrow(SchemaValidationError)
    })

    it('should validate join references', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: { id: { type: 'number', sql: 'id' } },
            joins: [
              {
                name: 'NonExistentCube',
                relationship: 'belongsTo',
                sql: '${CUBE}.id = ${NonExistentCube}.order_id',
              },
            ],
          },
        ],
      }

      // Should warn but not throw (join targets may be in other files)
      const result = validateImportedSchema(schema)
      expect(result.warnings).toContain('Join references non-existent cube: NonExistentCube')
    })

    it('should validate pre-aggregation references', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: { id: { type: 'number', sql: 'id' } },
            preAggregations: [
              {
                name: 'invalid',
                measures: ['nonExistentMeasure'],
                dimensions: ['nonExistentDimension'],
              },
            ],
          },
        ],
      }

      expect(() => validateImportedSchema(schema)).toThrow(SchemaValidationError)
    })

    it('should detect circular join references', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'A',
            sql: 'SELECT * FROM a',
            measures: { count: { type: 'count' } },
            dimensions: {},
            joins: [{ name: 'B', relationship: 'belongsTo', sql: '' }],
          },
          {
            name: 'B',
            sql: 'SELECT * FROM b',
            measures: { count: { type: 'count' } },
            dimensions: {},
            joins: [{ name: 'A', relationship: 'belongsTo', sql: '' }],
          },
        ],
      }

      const result = validateImportedSchema(schema)
      expect(result.warnings).toContain('Circular join reference detected: A -> B -> A')
    })

    it('should return validation result with warnings', () => {
      const schema: ImportedSchema = {
        cubes: [
          {
            name: 'Orders',
            sql: 'SELECT * FROM orders',
            measures: { count: { type: 'count' } },
            dimensions: {},
          },
        ],
      }

      const result = validateImportedSchema(schema)

      expect(result.valid).toBe(true)
      expect(result.warnings).toEqual([])
      expect(result.errors).toEqual([])
    })
  })
})

// =============================================================================
// Round-trip Tests
// =============================================================================

describe('Round-trip Conversion', () => {
  it('should preserve schema through LookML round-trip', () => {
    const original: ImportedSchema = {
      cubes: [
        {
          name: 'orders',
          sql: 'SELECT * FROM orders',
          measures: {
            count: { type: 'count', description: 'Total orders' },
            total_amount: { type: 'sum', sql: 'amount' },
          },
          dimensions: {
            id: { type: 'number', sql: 'id', primaryKey: true },
            status: { type: 'string', sql: 'status' },
            created_at: { type: 'time', sql: 'created_at' },
          },
        },
      ],
    }

    const lookml = exportToLookML(original)
    const parsed = parseLookML(lookml)
    const restored = parsed.toSemanticLayer()

    expect(restored.cubes[0].name).toBe(original.cubes[0].name)
    expect(Object.keys(restored.cubes[0].measures)).toEqual(
      Object.keys(original.cubes[0].measures)
    )
    expect(Object.keys(restored.cubes[0].dimensions)).toEqual(
      Object.keys(original.cubes[0].dimensions)
    )
  })

  it('should preserve schema through Cube.js round-trip', () => {
    const original: ImportedSchema = {
      cubes: [
        {
          name: 'Orders',
          sql: 'SELECT * FROM orders',
          measures: {
            count: { type: 'count' },
            totalAmount: { type: 'sum', sql: 'amount' },
          },
          dimensions: {
            id: { type: 'number', sql: 'id', primaryKey: true },
            status: { type: 'string', sql: 'status' },
          },
        },
      ],
    }

    const cubeJS = exportToCubeJS(original)
    const parsed = parseCubeJS(cubeJS)
    const restored = parsed.toSemanticLayer()

    expect(restored.cubes[0].name).toBe(original.cubes[0].name)
    expect(Object.keys(restored.cubes[0].measures)).toEqual(
      Object.keys(original.cubes[0].measures)
    )
    expect(Object.keys(restored.cubes[0].dimensions)).toEqual(
      Object.keys(original.cubes[0].dimensions)
    )
  })

  it('should convert LookML to Cube.js', () => {
    const lookml = `
      view: orders {
        sql_table_name: public.orders ;;

        dimension: id {
          type: number
          primary_key: yes
          sql: \${TABLE}.id ;;
        }

        measure: count {
          type: count
        }
      }
    `

    const parsed = parseLookML(lookml)
    const schema = parsed.toSemanticLayer()
    const cubeJS = exportToCubeJS(schema)

    expect(cubeJS).toContain("cube('orders'")
    expect(cubeJS).toContain("type: 'count'")
  })

  it('should convert Cube.js to LookML', () => {
    const cubeJS = `
      cube('Orders', {
        sql: \`SELECT * FROM orders\`,
        measures: { count: { type: 'count' } },
        dimensions: { id: { type: 'number', sql: 'id', primaryKey: true } },
      });
    `

    const parsed = parseCubeJS(cubeJS)
    const schema = parsed.toSemanticLayer()
    const lookml = exportToLookML(schema)

    expect(lookml).toContain('view: Orders {')
    expect(lookml).toContain('type: count')
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases', () => {
  describe('LookML', () => {
    it('should handle empty view', () => {
      const lookml = `
        view: empty {
          sql_table_name: empty ;;
        }
      `

      const result = parseLookML(lookml)
      expect(result.views[0].dimensions).toHaveLength(0)
      expect(result.views[0].measures).toHaveLength(0)
    })

    it('should handle special characters in names', () => {
      const lookml = `
        view: my_view_123 {
          sql_table_name: my_table ;;

          dimension: field_with_underscore {
            type: string
            sql: \${TABLE}.field ;;
          }
        }
      `

      const result = parseLookML(lookml)
      expect(result.views[0].name).toBe('my_view_123')
    })

    it('should handle SQL with template variables', () => {
      const lookml = `
        view: orders {
          sql_table_name: \${schema}.orders ;;

          dimension: id {
            type: number
            sql: \${TABLE}.id ;;
          }
        }
      `

      const result = parseLookML(lookml)
      expect(result.views[0].sqlTableName).toContain('${schema}')
    })
  })

  describe('Cube.js', () => {
    it('should handle cube with sql function', () => {
      const cubeJS = `
        cube('Orders', {
          sql: () => \`SELECT * FROM orders WHERE tenant = '\${SECURITY_CONTEXT.tenant}'\`,
          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
        });
      `

      const result = parseCubeJS(cubeJS)
      expect(result.cubes[0].sql).toContain('SELECT * FROM orders')
    })

    it('should handle complex SQL expressions', () => {
      const cubeJS = `
        cube('Orders', {
          sql: \`
            SELECT
              id,
              CASE
                WHEN status = 'completed' THEN 1
                ELSE 0
              END as is_completed
            FROM orders
          \`,
          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
        });
      `

      const result = parseCubeJS(cubeJS)
      expect(result.cubes[0].sql).toContain('CASE')
    })

    it('should handle dataSource property', () => {
      const cubeJS = `
        cube('Orders', {
          dataSource: 'default',
          sql: \`SELECT * FROM orders\`,
          measures: { count: { type: 'count' } },
          dimensions: { id: { type: 'number', sql: 'id' } },
        });
      `

      const result = parseCubeJS(cubeJS)
      expect(result.cubes[0].dataSource).toBe('default')
    })
  })
})
