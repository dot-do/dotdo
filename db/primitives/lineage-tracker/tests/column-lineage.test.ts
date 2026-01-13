/**
 * Column Lineage Extraction Tests
 *
 * Tests for extracting fine-grained column-level lineage from SQL transformations.
 * Following TDD approach as specified in dotdo-cpit6.
 *
 * @see dotdo-cpit6
 * @module db/primitives/lineage-tracker/tests/column-lineage
 */
import { describe, it, expect } from 'vitest'
import {
  extractColumnLineage,
  type ColumnMapping,
  type Column,
  type Schema,
  type MappingType,
} from '../column-lineage'

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a simple schema for testing
 */
function createTestSchema(): Schema {
  return {
    tables: {
      users: {
        columns: ['id', 'name', 'email', 'age', 'created_at', 'status'],
      },
      orders: {
        columns: ['id', 'user_id', 'amount', 'quantity', 'price', 'created_at', 'status'],
      },
      products: {
        columns: ['id', 'name', 'price', 'category'],
      },
      customers: {
        columns: ['id', 'name', 'email', 'total_spent'],
      },
    },
  }
}

// =============================================================================
// SIMPLE SELECT COLUMN MAPPING TESTS
// =============================================================================

describe('Column Lineage - Simple SELECT', () => {
  const schema = createTestSchema()

  it('should extract direct column mapping', () => {
    const sql = 'SELECT id, name, email FROM users'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(3)

    const idMapping = mappings.find((m) => m.target.column === 'id')
    expect(idMapping).toBeDefined()
    expect(idMapping!.sources).toHaveLength(1)
    expect(idMapping!.sources[0].table).toBe('users')
    expect(idMapping!.sources[0].column).toBe('id')
    expect(idMapping!.mappingType).toBe('direct')

    const nameMapping = mappings.find((m) => m.target.column === 'name')
    expect(nameMapping).toBeDefined()
    expect(nameMapping!.sources[0].column).toBe('name')
  })

  it('should handle column aliases', () => {
    const sql = 'SELECT id AS user_id, name AS user_name FROM users'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(2)

    const userIdMapping = mappings.find((m) => m.target.column === 'user_id')
    expect(userIdMapping).toBeDefined()
    expect(userIdMapping!.sources[0].column).toBe('id')
    expect(userIdMapping!.mappingType).toBe('direct')

    const userNameMapping = mappings.find((m) => m.target.column === 'user_name')
    expect(userNameMapping).toBeDefined()
    expect(userNameMapping!.sources[0].column).toBe('name')
  })

  it('should handle table-qualified columns', () => {
    const sql = 'SELECT users.id, users.name FROM users'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(2)

    const idMapping = mappings.find((m) => m.target.column === 'id')
    expect(idMapping).toBeDefined()
    expect(idMapping!.sources[0].table).toBe('users')
    expect(idMapping!.sources[0].column).toBe('id')
  })

  it('should handle SELECT * expansion', () => {
    const sql = 'SELECT * FROM users'
    const mappings = extractColumnLineage(sql, schema)

    // Should expand to all columns in users table
    expect(mappings).toHaveLength(6)

    const columns = mappings.map((m) => m.target.column).sort()
    expect(columns).toEqual(['age', 'created_at', 'email', 'id', 'name', 'status'])

    // All should be direct mappings
    for (const mapping of mappings) {
      expect(mapping.mappingType).toBe('direct')
      expect(mapping.sources[0].table).toBe('users')
    }
  })

  it('should handle table.* expansion', () => {
    const sql = 'SELECT users.* FROM users'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(6)

    for (const mapping of mappings) {
      expect(mapping.sources[0].table).toBe('users')
    }
  })
})

// =============================================================================
// EXPRESSION PARSING TESTS
// =============================================================================

describe('Column Lineage - Expressions', () => {
  const schema = createTestSchema()

  it('should extract derived column from arithmetic expression', () => {
    const sql = 'SELECT price * quantity AS total FROM orders'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)

    const totalMapping = mappings[0]
    expect(totalMapping.target.column).toBe('total')
    expect(totalMapping.mappingType).toBe('derived')
    expect(totalMapping.sources).toHaveLength(2)

    const sourceColumns = totalMapping.sources.map((s) => s.column).sort()
    expect(sourceColumns).toEqual(['price', 'quantity'])
    expect(totalMapping.expression).toContain('*')
  })

  it('should extract derived column from concatenation', () => {
    const sql = "SELECT name || ' <' || email || '>' AS full_contact FROM users"
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)

    const contactMapping = mappings[0]
    expect(contactMapping.target.column).toBe('full_contact')
    expect(contactMapping.mappingType).toBe('derived')

    const sourceColumns = contactMapping.sources.map((s) => s.column).sort()
    expect(sourceColumns).toEqual(['email', 'name'])
  })

  it('should handle function calls', () => {
    const sql = 'SELECT UPPER(name) AS upper_name, LOWER(email) AS lower_email FROM users'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(2)

    const upperMapping = mappings.find((m) => m.target.column === 'upper_name')
    expect(upperMapping).toBeDefined()
    expect(upperMapping!.mappingType).toBe('derived')
    expect(upperMapping!.sources[0].column).toBe('name')

    const lowerMapping = mappings.find((m) => m.target.column === 'lower_email')
    expect(lowerMapping).toBeDefined()
    expect(lowerMapping!.sources[0].column).toBe('email')
  })

  it('should handle COALESCE', () => {
    const sql = "SELECT COALESCE(name, email, 'unknown') AS display_name FROM users"
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)

    const displayMapping = mappings[0]
    expect(displayMapping.target.column).toBe('display_name')
    expect(displayMapping.mappingType).toBe('derived')

    const sourceColumns = displayMapping.sources.map((s) => s.column).sort()
    expect(sourceColumns).toEqual(['email', 'name'])
  })

  it('should handle nested functions', () => {
    const sql = 'SELECT TRIM(UPPER(name)) AS clean_name FROM users'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)

    const cleanMapping = mappings[0]
    expect(cleanMapping.target.column).toBe('clean_name')
    expect(cleanMapping.sources[0].column).toBe('name')
  })
})

// =============================================================================
// AGGREGATE FUNCTION TESTS
// =============================================================================

describe('Column Lineage - Aggregates', () => {
  const schema = createTestSchema()

  it('should extract aggregate function lineage', () => {
    const sql = 'SELECT SUM(amount) AS total_amount, COUNT(*) AS order_count FROM orders'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(2)

    const sumMapping = mappings.find((m) => m.target.column === 'total_amount')
    expect(sumMapping).toBeDefined()
    expect(sumMapping!.mappingType).toBe('aggregated')
    expect(sumMapping!.sources).toHaveLength(1)
    expect(sumMapping!.sources[0].column).toBe('amount')

    const countMapping = mappings.find((m) => m.target.column === 'order_count')
    expect(countMapping).toBeDefined()
    expect(countMapping!.mappingType).toBe('aggregated')
    // COUNT(*) has no specific source column
    expect(countMapping!.sources).toHaveLength(0)
  })

  it('should handle AVG, MIN, MAX', () => {
    const sql = 'SELECT AVG(price) AS avg_price, MIN(price) AS min_price, MAX(price) AS max_price FROM orders'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(3)

    for (const mapping of mappings) {
      expect(mapping.mappingType).toBe('aggregated')
      expect(mapping.sources[0].column).toBe('price')
    }
  })

  it('should handle COUNT with column', () => {
    const sql = 'SELECT COUNT(user_id) AS user_count FROM orders'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)

    const countMapping = mappings[0]
    expect(countMapping.mappingType).toBe('aggregated')
    expect(countMapping.sources).toHaveLength(1)
    expect(countMapping.sources[0].column).toBe('user_id')
  })

  it('should handle aggregate with arithmetic', () => {
    const sql = 'SELECT SUM(price * quantity) AS total_value FROM orders'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)

    const totalMapping = mappings[0]
    expect(totalMapping.target.column).toBe('total_value')
    expect(totalMapping.mappingType).toBe('aggregated')

    const sourceColumns = totalMapping.sources.map((s) => s.column).sort()
    expect(sourceColumns).toEqual(['price', 'quantity'])
  })
})

// =============================================================================
// CONDITIONAL EXPRESSION TESTS
// =============================================================================

describe('Column Lineage - CASE Expressions', () => {
  const schema = createTestSchema()

  it('should extract CASE expression lineage', () => {
    const sql = `
      SELECT
        CASE
          WHEN status = 'active' THEN 'Active User'
          WHEN status = 'pending' THEN 'Pending'
          ELSE 'Unknown'
        END AS user_status
      FROM users
    `
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)

    const statusMapping = mappings[0]
    expect(statusMapping.target.column).toBe('user_status')
    expect(statusMapping.mappingType).toBe('conditional')
    expect(statusMapping.sources).toHaveLength(1)
    expect(statusMapping.sources[0].column).toBe('status')
  })

  it('should handle CASE with multiple source columns', () => {
    const sql = `
      SELECT
        CASE
          WHEN age >= 18 AND status = 'active' THEN 'Valid'
          ELSE 'Invalid'
        END AS validation_status
      FROM users
    `
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)

    const validMapping = mappings[0]
    expect(validMapping.mappingType).toBe('conditional')

    const sourceColumns = validMapping.sources.map((s) => s.column).sort()
    expect(sourceColumns).toEqual(['age', 'status'])
  })

  it('should handle simple CASE', () => {
    const sql = `
      SELECT
        CASE status
          WHEN 'active' THEN 1
          WHEN 'pending' THEN 2
          ELSE 0
        END AS status_code
      FROM users
    `
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)
    expect(mappings[0].sources[0].column).toBe('status')
  })
})

// =============================================================================
// JOIN COLUMN RESOLUTION TESTS
// =============================================================================

describe('Column Lineage - JOINs', () => {
  const schema = createTestSchema()

  it('should resolve columns from multiple tables in JOIN', () => {
    const sql = `
      SELECT u.name AS user_name, o.amount AS order_amount
      FROM users u
      JOIN orders o ON u.id = o.user_id
    `
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(2)

    const userNameMapping = mappings.find((m) => m.target.column === 'user_name')
    expect(userNameMapping).toBeDefined()
    expect(userNameMapping!.sources[0].table).toBe('users')
    expect(userNameMapping!.sources[0].column).toBe('name')

    const orderAmountMapping = mappings.find((m) => m.target.column === 'order_amount')
    expect(orderAmountMapping).toBeDefined()
    expect(orderAmountMapping!.sources[0].table).toBe('orders')
    expect(orderAmountMapping!.sources[0].column).toBe('amount')
  })

  it('should handle SELECT * from JOINed tables', () => {
    const sql = `
      SELECT *
      FROM users u
      JOIN orders o ON u.id = o.user_id
    `
    const mappings = extractColumnLineage(sql, schema)

    // Should include columns from both tables
    // users: 6 columns, orders: 7 columns = 13 total
    expect(mappings.length).toBe(13)

    const tables = [...new Set(mappings.map((m) => m.sources[0].table))]
    expect(tables.sort()).toEqual(['orders', 'users'])
  })

  it('should handle derived columns from multiple tables', () => {
    const sql = `
      SELECT u.name || ' - ' || o.amount AS user_order
      FROM users u
      JOIN orders o ON u.id = o.user_id
    `
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(1)

    const userOrderMapping = mappings[0]
    expect(userOrderMapping.mappingType).toBe('derived')
    expect(userOrderMapping.sources).toHaveLength(2)

    const sources = userOrderMapping.sources
    expect(sources.some((s) => s.table === 'users' && s.column === 'name')).toBe(true)
    expect(sources.some((s) => s.table === 'orders' && s.column === 'amount')).toBe(true)
  })
})

// =============================================================================
// COMPLEX QUERIES TESTS
// =============================================================================

describe('Column Lineage - Complex Queries', () => {
  const schema = createTestSchema()

  it('should handle GROUP BY with aggregates', () => {
    const sql = `
      SELECT user_id, SUM(amount) AS total_spent, COUNT(*) AS order_count
      FROM orders
      GROUP BY user_id
    `
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(3)

    const userIdMapping = mappings.find((m) => m.target.column === 'user_id')
    expect(userIdMapping).toBeDefined()
    expect(userIdMapping!.mappingType).toBe('direct')

    const totalMapping = mappings.find((m) => m.target.column === 'total_spent')
    expect(totalMapping).toBeDefined()
    expect(totalMapping!.mappingType).toBe('aggregated')
  })

  it('should handle subqueries in FROM clause', () => {
    const sql = `
      SELECT sq.user_id, sq.total
      FROM (
        SELECT user_id, SUM(amount) AS total
        FROM orders
        GROUP BY user_id
      ) AS sq
    `
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(2)

    // Should extract columns from the subquery alias
    const userIdMapping = mappings.find((m) => m.target.column === 'user_id')
    expect(userIdMapping).toBeDefined()
    // Source is from the subquery alias 'sq'
    expect(userIdMapping!.sources[0].column).toBe('user_id')

    const totalMapping = mappings.find((m) => m.target.column === 'total')
    expect(totalMapping).toBeDefined()
    // At the outer query level, the source is 'total' from subquery
    // Full lineage tracing through subqueries to original columns
    // requires recursive analysis which is a more advanced feature
    expect(totalMapping!.sources[0].column).toBe('total')
  })

  it('should handle mixed direct, derived, and aggregated columns', () => {
    const sql = `
      SELECT
        user_id,
        price * quantity AS line_total,
        SUM(amount) AS total_amount,
        CASE WHEN status = 'active' THEN 'A' ELSE 'I' END AS status_code
      FROM orders
      GROUP BY user_id, price, quantity, status
    `
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(4)

    const types = mappings.map((m) => m.mappingType).sort()
    expect(types).toEqual(['aggregated', 'conditional', 'derived', 'direct'])
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Column Lineage - Edge Cases', () => {
  const schema = createTestSchema()

  it('should handle literal values only', () => {
    const sql = "SELECT 1 AS one, 'hello' AS greeting"
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(2)

    // Literal values have no source columns
    for (const mapping of mappings) {
      expect(mapping.sources).toHaveLength(0)
      expect(mapping.mappingType).toBe('literal')
    }
  })

  it('should handle unknown table gracefully', () => {
    const sql = 'SELECT id, name FROM unknown_table'
    const mappings = extractColumnLineage(sql, schema)

    // Should still extract what it can
    expect(mappings).toHaveLength(2)

    const idMapping = mappings.find((m) => m.target.column === 'id')
    expect(idMapping).toBeDefined()
    expect(idMapping!.sources[0].table).toBe('unknown_table')
  })

  it('should handle empty SELECT list', () => {
    const sql = 'SELECT FROM users'
    // Should handle gracefully (might return empty or throw)
    expect(() => extractColumnLineage(sql, schema)).not.toThrow()
  })

  it('should handle DISTINCT correctly', () => {
    const sql = 'SELECT DISTINCT name, email FROM users'
    const mappings = extractColumnLineage(sql, schema)

    expect(mappings).toHaveLength(2)

    // DISTINCT shouldn't affect column mappings
    for (const mapping of mappings) {
      expect(mapping.mappingType).toBe('direct')
    }
  })
})
