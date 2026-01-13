/**
 * SQL Lineage Parser Tests
 *
 * Tests for SQL query lineage extraction including:
 * - Basic SELECT parsing
 * - JOIN lineage extraction
 * - CTE and subquery handling
 * - INSERT/UPDATE/MERGE parsing
 *
 * @see dotdo-wztr9
 */

import { describe, it, expect } from 'vitest'
import {
  parseSqlLineage,
  SqlLineageParser,
  createSqlLineageParser,
  type SqlLineage,
  type TableRef,
  type ColumnMapping,
} from '../sql-lineage-parser'

describe('SqlLineageParser', () => {
  // ===========================================================================
  // BASIC SELECT PARSING
  // ===========================================================================

  describe('basic SELECT parsing', () => {
    it('should parse simple SELECT with single table', () => {
      const sql = 'SELECT id, name, email FROM users'
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('SELECT')
      expect(lineage.sources).toHaveLength(1)
      expect(lineage.sources[0]).toEqual({ name: 'users' })
      expect(lineage.targets).toHaveLength(0)
      expect(lineage.columns).toHaveLength(3)

      // Check column mappings
      expect(lineage.columns[0]?.target.name).toBe('id')
      expect(lineage.columns[1]?.target.name).toBe('name')
      expect(lineage.columns[2]?.target.name).toBe('email')
    })

    it('should parse SELECT * (wildcard)', () => {
      const sql = 'SELECT * FROM orders'
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('SELECT')
      expect(lineage.sources).toHaveLength(1)
      expect(lineage.sources[0]?.name).toBe('orders')
      expect(lineage.columns).toHaveLength(1)
      expect(lineage.columns[0]?.transformationType).toBe('wildcard')
      expect(lineage.columns[0]?.target.name).toBe('*')
    })

    it('should parse SELECT with table alias', () => {
      const sql = 'SELECT u.id, u.name FROM users u'
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources).toHaveLength(1)
      expect(lineage.sources[0]).toEqual({ name: 'users', alias: 'u' })

      // Column sources should be resolved to actual table name
      expect(lineage.columns[0]?.sources[0]?.table).toBe('users')
    })

    it('should parse SELECT with column aliases', () => {
      const sql = 'SELECT id AS user_id, name AS full_name FROM users'
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns[0]?.target.name).toBe('user_id')
      expect(lineage.columns[0]?.target.alias).toBe('user_id')
      expect(lineage.columns[1]?.target.name).toBe('full_name')
      expect(lineage.columns[1]?.target.alias).toBe('full_name')
    })

    it('should parse SELECT DISTINCT', () => {
      const sql = 'SELECT DISTINCT status FROM orders'
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('SELECT')
      expect(lineage.sources[0]?.name).toBe('orders')
      expect(lineage.columns[0]?.target.name).toBe('status')
    })

    it('should parse qualified column names', () => {
      const sql = 'SELECT users.id, users.name FROM users'
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns[0]?.sources[0]?.table).toBe('users')
      expect(lineage.columns[0]?.sources[0]?.name).toBe('id')
    })

    it('should parse schema-qualified table names', () => {
      const sql = 'SELECT id FROM public.users'
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources[0]?.name).toBe('users')
      expect(lineage.sources[0]?.schema).toBe('public')
    })

    it('should handle empty SQL', () => {
      const lineage = parseSqlLineage('')
      expect(lineage.statementType).toBe('UNKNOWN')
      expect(lineage.sources).toHaveLength(0)
    })
  })

  // ===========================================================================
  // JOIN LINEAGE EXTRACTION
  // ===========================================================================

  describe('JOIN lineage extraction', () => {
    it('should parse INNER JOIN', () => {
      const sql = `
        SELECT u.name, o.total
        FROM users u
        INNER JOIN orders o ON o.user_id = u.id
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources).toHaveLength(2)
      expect(lineage.sources[0]).toEqual({ name: 'users', alias: 'u' })
      expect(lineage.sources[1]).toEqual({ name: 'orders', alias: 'o' })
    })

    it('should parse LEFT JOIN', () => {
      const sql = `
        SELECT c.name, COUNT(o.id) as order_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id
        GROUP BY c.name
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources).toHaveLength(2)
      expect(lineage.sources.find(s => s.name === 'customers')).toBeDefined()
      expect(lineage.sources.find(s => s.name === 'orders')).toBeDefined()
    })

    it('should parse RIGHT JOIN', () => {
      const sql = `
        SELECT p.name, c.name as category
        FROM products p
        RIGHT JOIN categories c ON p.category_id = c.id
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources).toHaveLength(2)
      expect(lineage.sources.find(s => s.name === 'products')).toBeDefined()
      expect(lineage.sources.find(s => s.name === 'categories')).toBeDefined()
    })

    it('should parse multiple JOINs', () => {
      const sql = `
        SELECT u.name, o.total, p.name as product
        FROM users u
        JOIN orders o ON o.user_id = u.id
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources).toHaveLength(4)
      const tableNames = lineage.sources.map(s => s.name)
      expect(tableNames).toContain('users')
      expect(tableNames).toContain('orders')
      expect(tableNames).toContain('order_items')
      expect(tableNames).toContain('products')
    })

    it('should parse CROSS JOIN', () => {
      const sql = 'SELECT a.x, b.y FROM table_a a CROSS JOIN table_b b'
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources).toHaveLength(2)
      expect(lineage.sources[0]).toEqual({ name: 'table_a', alias: 'a' })
      expect(lineage.sources[1]).toEqual({ name: 'table_b', alias: 'b' })
    })

    it('should parse comma-separated tables (implicit cross join)', () => {
      const sql = 'SELECT a.x, b.y FROM table_a a, table_b b WHERE a.id = b.id'
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources).toHaveLength(2)
    })
  })

  // ===========================================================================
  // CTE AND SUBQUERY HANDLING
  // ===========================================================================

  describe('CTE and subquery handling', () => {
    it('should parse simple CTE', () => {
      const sql = `WITH active_users AS (SELECT id, name FROM users WHERE status = 'active') SELECT * FROM active_users`
      const lineage = parseSqlLineage(sql)

      expect(lineage.ctes).toHaveLength(1)
      expect(lineage.ctes[0]?.name).toBe('active_users')
      expect(lineage.ctes[0]?.lineage.sources[0]?.name).toBe('users')
    })

    it('should parse multiple CTEs', () => {
      const sql = `
        WITH
          active_users AS (
            SELECT id FROM users WHERE status = 'active'
          ),
          recent_orders AS (
            SELECT user_id, total FROM orders WHERE created_at > '2024-01-01'
          )
        SELECT au.id, ro.total
        FROM active_users au
        JOIN recent_orders ro ON ro.user_id = au.id
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.ctes).toHaveLength(2)
      expect(lineage.ctes[0]?.name).toBe('active_users')
      expect(lineage.ctes[1]?.name).toBe('recent_orders')
    })

    it('should parse recursive CTE', () => {
      const sql = `
        WITH RECURSIVE org_chart AS (
          SELECT id, name, manager_id, 1 as level
          FROM employees
          WHERE manager_id IS NULL
          UNION ALL
          SELECT e.id, e.name, e.manager_id, oc.level + 1
          FROM employees e
          JOIN org_chart oc ON e.manager_id = oc.id
        )
        SELECT * FROM org_chart
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.ctes).toHaveLength(1)
      expect(lineage.ctes[0]?.name).toBe('org_chart')
    })

    it('should handle subquery in FROM clause', () => {
      const sql = `
        SELECT sub.id, sub.total
        FROM (SELECT id, SUM(amount) as total FROM orders GROUP BY id) sub
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources).toHaveLength(1)
      expect(lineage.sources[0]?.name).toBe('(subquery)')
      expect(lineage.sources[0]?.alias).toBe('sub')
    })
  })

  // ===========================================================================
  // AGGREGATE FUNCTIONS
  // ===========================================================================

  describe('aggregate function parsing', () => {
    it('should identify COUNT as aggregate', () => {
      const sql = 'SELECT COUNT(*) as total FROM users'
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns[0]?.transformationType).toBe('aggregate')
      expect(lineage.columns[0]?.target.name).toBe('total')
    })

    it('should identify SUM, AVG, MIN, MAX', () => {
      const sql = `
        SELECT
          SUM(amount) as total_amount,
          AVG(amount) as avg_amount,
          MIN(amount) as min_amount,
          MAX(amount) as max_amount
        FROM orders
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns).toHaveLength(4)
      lineage.columns.forEach(col => {
        expect(col.transformationType).toBe('aggregate')
      })
    })

    it('should parse COUNT(DISTINCT)', () => {
      const sql = 'SELECT COUNT(DISTINCT user_id) as unique_users FROM orders'
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns[0]?.transformationType).toBe('aggregate')
    })

    it('should extract column sources from aggregates', () => {
      const sql = 'SELECT SUM(quantity * price) as revenue FROM order_items'
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns[0]?.transformationType).toBe('aggregate')
      const sources = lineage.columns[0]?.sources
      expect(sources?.some(s => s.name === 'quantity')).toBe(true)
      expect(sources?.some(s => s.name === 'price')).toBe(true)
    })
  })

  // ===========================================================================
  // INSERT PARSING
  // ===========================================================================

  describe('INSERT parsing', () => {
    it('should parse INSERT INTO ... SELECT', () => {
      const sql = `
        INSERT INTO summary_table (user_id, total)
        SELECT user_id, SUM(amount)
        FROM orders
        GROUP BY user_id
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('INSERT')
      expect(lineage.targets).toHaveLength(1)
      expect(lineage.targets[0]?.name).toBe('summary_table')
      expect(lineage.sources).toHaveLength(1)
      expect(lineage.sources[0]?.name).toBe('orders')
    })

    it('should map columns from INSERT to SELECT', () => {
      const sql = `
        INSERT INTO target (col_a, col_b)
        SELECT x, y FROM source
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns).toHaveLength(2)
      expect(lineage.columns[0]?.target.name).toBe('col_a')
      expect(lineage.columns[1]?.target.name).toBe('col_b')
    })

    it('should handle INSERT VALUES (no source lineage)', () => {
      const sql = "INSERT INTO users (name, email) VALUES ('John', 'john@example.com')"
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('INSERT')
      expect(lineage.targets[0]?.name).toBe('users')
      expect(lineage.sources).toHaveLength(0)
    })
  })

  // ===========================================================================
  // UPDATE PARSING
  // ===========================================================================

  describe('UPDATE parsing', () => {
    it('should parse simple UPDATE', () => {
      const sql = "UPDATE users SET status = 'active' WHERE id = 1"
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('UPDATE')
      expect(lineage.targets).toHaveLength(1)
      expect(lineage.targets[0]?.name).toBe('users')
      // UPDATE reads from the target table
      expect(lineage.sources).toHaveLength(1)
      expect(lineage.sources[0]?.name).toBe('users')
    })

    it('should parse UPDATE with column references', () => {
      const sql = 'UPDATE orders SET total = subtotal * (1 + tax_rate) WHERE id = 1'
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns).toHaveLength(1)
      expect(lineage.columns[0]?.target.name).toBe('total')
      expect(lineage.columns[0]?.transformationType).toBe('computed')
      expect(lineage.columns[0]?.sources.some(s => s.name === 'subtotal')).toBe(true)
      expect(lineage.columns[0]?.sources.some(s => s.name === 'tax_rate')).toBe(true)
    })

    it('should parse UPDATE with FROM clause (PostgreSQL style)', () => {
      const sql = `
        UPDATE orders o
        SET status = 'shipped'
        FROM shipments s
        WHERE o.id = s.order_id AND s.shipped_at IS NOT NULL
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.targets[0]?.name).toBe('orders')
      expect(lineage.sources.find(s => s.name === 'orders')).toBeDefined()
      expect(lineage.sources.find(s => s.name === 'shipments')).toBeDefined()
    })
  })

  // ===========================================================================
  // DELETE PARSING
  // ===========================================================================

  describe('DELETE parsing', () => {
    it('should parse simple DELETE', () => {
      const sql = "DELETE FROM users WHERE status = 'inactive'"
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('DELETE')
      expect(lineage.targets).toHaveLength(1)
      expect(lineage.targets[0]?.name).toBe('users')
      // DELETE also reads from the table
      expect(lineage.sources).toHaveLength(1)
      expect(lineage.sources[0]?.name).toBe('users')
    })

    it('should parse DELETE with USING clause', () => {
      const sql = `
        DELETE FROM orders o
        USING returns r
        WHERE o.id = r.order_id
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.targets[0]?.name).toBe('orders')
      expect(lineage.sources.find(s => s.name === 'orders')).toBeDefined()
      expect(lineage.sources.find(s => s.name === 'returns')).toBeDefined()
    })
  })

  // ===========================================================================
  // MERGE/UPSERT PARSING
  // ===========================================================================

  describe('MERGE/UPSERT parsing', () => {
    it('should parse MERGE statement', () => {
      const sql = `
        MERGE INTO target_table t
        USING source_table s
        ON t.id = s.id
        WHEN MATCHED THEN UPDATE SET t.value = s.value
        WHEN NOT MATCHED THEN INSERT (id, value) VALUES (s.id, s.value)
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('MERGE')
      expect(lineage.targets[0]?.name).toBe('target_table')
      expect(lineage.sources.find(s => s.name === 'target_table')).toBeDefined()
      expect(lineage.sources.find(s => s.name === 'source_table')).toBeDefined()
    })
  })

  // ===========================================================================
  // CREATE TABLE AS SELECT (CTAS)
  // ===========================================================================

  describe('CREATE TABLE AS SELECT parsing', () => {
    it('should parse CTAS', () => {
      const sql = `
        CREATE TABLE summary AS
        SELECT user_id, COUNT(*) as total
        FROM orders
        GROUP BY user_id
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('CREATE_TABLE_AS')
      expect(lineage.targets[0]?.name).toBe('summary')
      expect(lineage.sources[0]?.name).toBe('orders')
    })

    it('should parse CREATE TABLE IF NOT EXISTS AS', () => {
      const sql = `
        CREATE TABLE IF NOT EXISTS archive AS
        SELECT * FROM orders WHERE created_at < '2023-01-01'
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('CREATE_TABLE_AS')
      expect(lineage.targets[0]?.name).toBe('archive')
    })

    it('should parse CREATE VIEW AS', () => {
      const sql = `
        CREATE VIEW active_users AS
        SELECT * FROM users WHERE status = 'active'
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('CREATE_TABLE_AS')
      expect(lineage.targets[0]?.name).toBe('active_users')
      expect(lineage.sources[0]?.name).toBe('users')
    })

    it('should parse CREATE MATERIALIZED VIEW', () => {
      const sql = `
        CREATE MATERIALIZED VIEW daily_stats AS
        SELECT date, SUM(amount) as total
        FROM transactions
        GROUP BY date
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('CREATE_TABLE_AS')
      expect(lineage.targets[0]?.name).toBe('daily_stats')
    })
  })

  // ===========================================================================
  // COMPUTED EXPRESSIONS
  // ===========================================================================

  describe('computed expression parsing', () => {
    it('should identify arithmetic expressions as computed', () => {
      const sql = 'SELECT price * quantity as line_total FROM order_items'
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns[0]?.transformationType).toBe('computed')
      expect(lineage.columns[0]?.sources).toHaveLength(2)
    })

    it('should parse CASE expressions', () => {
      const sql = `
        SELECT
          CASE
            WHEN status = 'active' THEN 'Active'
            WHEN status = 'pending' THEN 'Pending'
            ELSE 'Unknown'
          END as status_label
        FROM users
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns[0]?.transformationType).toBe('computed')
      expect(lineage.columns[0]?.sources.some(s => s.name === 'status')).toBe(true)
    })

    it('should parse arithmetic expressions with multiple columns', () => {
      const sql = "SELECT quantity * unit_price + tax as total FROM order_items"
      const lineage = parseSqlLineage(sql)

      // Should extract column references from expression
      const sources = lineage.columns[0]?.sources || []
      expect(sources.some(s => s.name === 'quantity')).toBe(true)
      expect(sources.some(s => s.name === 'unit_price')).toBe(true)
      expect(sources.some(s => s.name === 'tax')).toBe(true)
      expect(lineage.columns[0]?.transformationType).toBe('computed')
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle quoted identifiers', () => {
      const sql = 'SELECT "user-id", "full name" FROM "user-table"'
      const lineage = parseSqlLineage(sql)

      expect(lineage.sources[0]?.name).toBe('user-table')
    })

    it('should handle multiple dialects (case insensitive keywords)', () => {
      const sql = 'select ID, NAME from USERS where STATUS = 1'
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('SELECT')
      expect(lineage.sources[0]?.name).toBe('USERS')
    })

    it('should handle table.* wildcard', () => {
      const sql = 'SELECT u.*, o.total FROM users u JOIN orders o ON o.user_id = u.id'
      const lineage = parseSqlLineage(sql)

      // First column should be wildcard for users table
      // The table is resolved from alias 'u' to 'users'
      expect(lineage.columns[0]?.sources[0]?.name).toBe('*')
      expect(lineage.columns[0]?.sources[0]?.table).toBe('users')
    })

    it('should handle window functions', () => {
      const sql = `
        SELECT
          id,
          ROW_NUMBER() OVER (PARTITION BY category ORDER BY created_at) as row_num
        FROM products
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.columns[1]?.transformationType).toBe('aggregate')
    })

    it('should create parser instance for repeated use', () => {
      const parser = createSqlLineageParser()

      const lineage1 = parser.parse('SELECT a FROM t1')
      const lineage2 = parser.parse('SELECT b FROM t2')

      expect(lineage1.sources[0]?.name).toBe('t1')
      expect(lineage2.sources[0]?.name).toBe('t2')
    })
  })

  // ===========================================================================
  // COMPLEX QUERIES
  // ===========================================================================

  describe('complex real-world queries', () => {
    it('should parse complex analytics query', () => {
      const sql = `
        WITH monthly_sales AS (
          SELECT
            DATE_TRUNC('month', created_at) as month,
            product_id,
            SUM(quantity) as total_qty,
            SUM(amount) as total_amount
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.status = 'completed'
          GROUP BY 1, 2
        ),
        product_info AS (
          SELECT id, name, category_id FROM products
        )
        SELECT
          ms.month,
          pi.name as product_name,
          c.name as category_name,
          ms.total_qty,
          ms.total_amount
        FROM monthly_sales ms
        JOIN product_info pi ON pi.id = ms.product_id
        JOIN categories c ON c.id = pi.category_id
        ORDER BY ms.month DESC, ms.total_amount DESC
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.ctes).toHaveLength(2)
      expect(lineage.ctes[0]?.name).toBe('monthly_sales')
      expect(lineage.ctes[1]?.name).toBe('product_info')

      // Main query sources
      expect(lineage.sources.find(s => s.name === 'monthly_sales')).toBeDefined()
      expect(lineage.sources.find(s => s.name === 'product_info')).toBeDefined()
      expect(lineage.sources.find(s => s.name === 'categories')).toBeDefined()

      // CTE sources
      expect(lineage.ctes[0]?.lineage.sources.some(s => s.name === 'order_items')).toBe(true)
      expect(lineage.ctes[0]?.lineage.sources.some(s => s.name === 'orders')).toBe(true)
      expect(lineage.ctes[1]?.lineage.sources[0]?.name).toBe('products')
    })

    it('should parse ETL-style INSERT with complex SELECT', () => {
      const sql = `
        INSERT INTO fact_sales (date_key, product_key, customer_key, quantity, amount)
        SELECT
          dd.date_key,
          dp.product_key,
          dc.customer_key,
          oi.quantity,
          oi.quantity * oi.unit_price as amount
        FROM staging_order_items oi
        JOIN staging_orders o ON o.id = oi.order_id
        JOIN dim_date dd ON dd.full_date = DATE(o.created_at)
        JOIN dim_product dp ON dp.product_id = oi.product_id
        JOIN dim_customer dc ON dc.customer_id = o.customer_id
      `
      const lineage = parseSqlLineage(sql)

      expect(lineage.statementType).toBe('INSERT')
      expect(lineage.targets[0]?.name).toBe('fact_sales')

      const sourceNames = lineage.sources.map(s => s.name)
      expect(sourceNames).toContain('staging_order_items')
      expect(sourceNames).toContain('staging_orders')
      expect(sourceNames).toContain('dim_date')
      expect(sourceNames).toContain('dim_product')
      expect(sourceNames).toContain('dim_customer')
    })
  })
})
