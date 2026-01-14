/**
 * DuckDB WASM SQL Query Execution Tests
 *
 * RED phase TDD tests for SQL query execution capabilities.
 * These tests define the full SQL API contract that DuckDB WASM must support.
 *
 * Test Categories:
 * 1. DDL/DML: CREATE TABLE, INSERT, SELECT roundtrip
 * 2. Aggregations: COUNT, SUM, AVG, MIN, MAX
 * 3. GROUP BY with HAVING
 * 4. JOINs: INNER, LEFT, CROSS
 * 5. Window functions: ROW_NUMBER, RANK, PARTITION BY
 * 6. CTEs: WITH clause, recursive CTEs
 * 7. Subqueries: scalar, correlated, EXISTS
 *
 * Performance Tests:
 * - 10K row aggregation < 100ms
 * - 1M row scan with filter < 500ms
 *
 * @see https://duckdb.org/docs/sql/introduction
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { env, SELF } from 'cloudflare:test'

import {
  createDuckDB,
  type DuckDBInstance,
  type QueryResult,
} from '../index'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('DuckDB WASM SQL Execution', () => {
  let db: DuckDBInstance

  beforeAll(async () => {
    db = await createDuckDB()
  })

  afterAll(async () => {
    if (db) {
      await db.close()
    }
  })

  // ============================================================================
  // 1. DDL/DML: CREATE TABLE / INSERT / SELECT
  // ============================================================================

  describe('DDL/DML Operations', () => {
    afterEach(async () => {
      // Clean up tables after each test
      try {
        await db.query('DROP TABLE IF EXISTS users')
        await db.query('DROP TABLE IF EXISTS products')
        await db.query('DROP TABLE IF EXISTS orders')
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should CREATE TABLE with various column types', async () => {
      await db.query(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(255),
          age INTEGER,
          balance DECIMAL(10, 2),
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)

      // Verify table exists by querying it
      const result = await db.query('SELECT * FROM users')
      expect(result.rows).toHaveLength(0)
      expect(result.columns).toBeDefined()
      expect(result.columns.length).toBeGreaterThan(0)
    })

    it('should INSERT single row and SELECT it back', async () => {
      await db.query('CREATE TABLE users (id INTEGER, name VARCHAR, email VARCHAR)')
      await db.query("INSERT INTO users VALUES (1, 'Alice', 'alice@example.com.ai')")

      const result = await db.query<{ id: number; name: string; email: string }>(
        'SELECT * FROM users WHERE id = 1'
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com.ai',
      })
    })

    it('should INSERT multiple rows in single statement', async () => {
      await db.query('CREATE TABLE users (id INTEGER, name VARCHAR)')
      await db.query(`
        INSERT INTO users VALUES
          (1, 'Alice'),
          (2, 'Bob'),
          (3, 'Charlie')
      `)

      const result = await db.query<{ id: number; name: string }>(
        'SELECT * FROM users ORDER BY id'
      )

      expect(result.rows).toHaveLength(3)
      expect(result.rows.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('should INSERT with parameterized values', async () => {
      await db.query('CREATE TABLE users (id INTEGER, name VARCHAR, age INTEGER)')
      await db.query(
        'INSERT INTO users VALUES ($1, $2, $3)',
        [42, 'Douglas', 42]
      )

      const result = await db.query<{ id: number; name: string; age: number }>(
        'SELECT * FROM users WHERE name = $1',
        ['Douglas']
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].age).toBe(42)
    })

    it('should UPDATE existing rows', async () => {
      await db.query('CREATE TABLE users (id INTEGER, name VARCHAR, active BOOLEAN)')
      await db.query("INSERT INTO users VALUES (1, 'Alice', true)")
      await db.query('UPDATE users SET active = false WHERE id = 1')

      const result = await db.query<{ active: boolean }>(
        'SELECT active FROM users WHERE id = 1'
      )

      expect(result.rows[0].active).toBe(false)
    })

    it('should DELETE rows matching condition', async () => {
      await db.query('CREATE TABLE users (id INTEGER, name VARCHAR)')
      await db.query("INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie')")
      await db.query('DELETE FROM users WHERE id = 2')

      const result = await db.query<{ id: number }>(
        'SELECT id FROM users ORDER BY id'
      )

      expect(result.rows.map((r) => r.id)).toEqual([1, 3])
    })

    it('should handle INSERT ... RETURNING', async () => {
      await db.query('CREATE TABLE users (id INTEGER, name VARCHAR)')
      const result = await db.query<{ id: number; name: string }>(
        "INSERT INTO users VALUES (99, 'Zoe') RETURNING *"
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({ id: 99, name: 'Zoe' })
    })

    it('should support CREATE TABLE AS SELECT (CTAS)', async () => {
      await db.query('CREATE TABLE users (id INTEGER, name VARCHAR, dept VARCHAR)')
      await db.query(`
        INSERT INTO users VALUES
          (1, 'Alice', 'eng'),
          (2, 'Bob', 'eng'),
          (3, 'Charlie', 'sales')
      `)
      await db.query("CREATE TABLE engineers AS SELECT * FROM users WHERE dept = 'eng'")

      const result = await db.query<{ name: string }>('SELECT name FROM engineers ORDER BY id')
      expect(result.rows.map((r) => r.name)).toEqual(['Alice', 'Bob'])
    })
  })

  // ============================================================================
  // 2. AGGREGATIONS: COUNT, SUM, AVG, MIN, MAX
  // ============================================================================

  describe('Aggregation Functions', () => {
    beforeAll(async () => {
      await db.query('CREATE TABLE IF NOT EXISTS sales (id INTEGER, product VARCHAR, amount DECIMAL(10,2), quantity INTEGER)')
      await db.query(`
        INSERT INTO sales VALUES
          (1, 'Widget', 10.00, 5),
          (2, 'Widget', 15.00, 3),
          (3, 'Gadget', 25.00, 2),
          (4, 'Gadget', 30.00, 4),
          (5, 'Gizmo', 50.00, 1)
      `)
    })

    afterAll(async () => {
      await db.query('DROP TABLE IF EXISTS sales')
    })

    it('should compute COUNT(*) correctly', async () => {
      const result = await db.query<{ count: number }>('SELECT COUNT(*) as count FROM sales')
      expect(result.rows[0].count).toBe(5)
    })

    it('should compute COUNT(column) excluding NULLs', async () => {
      await db.query('INSERT INTO sales VALUES (6, NULL, 0.00, 0)')
      const result = await db.query<{ count: number }>(
        'SELECT COUNT(product) as count FROM sales'
      )
      expect(result.rows[0].count).toBe(5) // NULL is not counted
      await db.query('DELETE FROM sales WHERE id = 6')
    })

    it('should compute COUNT(DISTINCT column)', async () => {
      const result = await db.query<{ count: number }>(
        'SELECT COUNT(DISTINCT product) as count FROM sales'
      )
      expect(result.rows[0].count).toBe(3) // Widget, Gadget, Gizmo
    })

    it('should compute SUM correctly', async () => {
      const result = await db.query<{ total: number }>(
        'SELECT SUM(amount) as total FROM sales'
      )
      expect(result.rows[0].total).toBe(130.00)
    })

    it('should compute AVG correctly', async () => {
      const result = await db.query<{ avg: number }>(
        'SELECT AVG(amount) as avg FROM sales'
      )
      expect(result.rows[0].avg).toBe(26.00)
    })

    it('should compute MIN correctly', async () => {
      const result = await db.query<{ min: number }>(
        'SELECT MIN(amount) as min FROM sales'
      )
      expect(result.rows[0].min).toBe(10.00)
    })

    it('should compute MAX correctly', async () => {
      const result = await db.query<{ max: number }>(
        'SELECT MAX(amount) as max FROM sales'
      )
      expect(result.rows[0].max).toBe(50.00)
    })

    it('should compute multiple aggregations in single query', async () => {
      const result = await db.query<{
        cnt: number
        total: number
        avg: number
        min: number
        max: number
      }>(`
        SELECT
          COUNT(*) as cnt,
          SUM(amount) as total,
          AVG(amount) as avg,
          MIN(amount) as min,
          MAX(amount) as max
        FROM sales
      `)

      expect(result.rows[0]).toEqual({
        cnt: 5,
        total: 130.00,
        avg: 26.00,
        min: 10.00,
        max: 50.00,
      })
    })

    it('should handle COALESCE with aggregations', async () => {
      const result = await db.query<{ total: number }>(
        'SELECT COALESCE(SUM(amount), 0) as total FROM sales WHERE product = $1',
        ['NonExistent']
      )
      expect(result.rows[0].total).toBe(0)
    })
  })

  // ============================================================================
  // 3. GROUP BY with HAVING
  // ============================================================================

  describe('GROUP BY with HAVING', () => {
    beforeAll(async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER,
          customer_id INTEGER,
          product VARCHAR,
          amount DECIMAL(10,2),
          created_at DATE
        )
      `)
      await db.query(`
        INSERT INTO orders VALUES
          (1, 100, 'Widget', 50.00, '2024-01-01'),
          (2, 100, 'Gadget', 75.00, '2024-01-02'),
          (3, 100, 'Widget', 50.00, '2024-01-03'),
          (4, 200, 'Widget', 100.00, '2024-01-01'),
          (5, 200, 'Gizmo', 200.00, '2024-01-02'),
          (6, 300, 'Widget', 25.00, '2024-01-01')
      `)
    })

    afterAll(async () => {
      await db.query('DROP TABLE IF EXISTS orders')
    })

    it('should GROUP BY single column', async () => {
      const result = await db.query<{ customer_id: number; total: number }>(`
        SELECT customer_id, SUM(amount) as total
        FROM orders
        GROUP BY customer_id
        ORDER BY customer_id
      `)

      expect(result.rows).toEqual([
        { customer_id: 100, total: 175.00 },
        { customer_id: 200, total: 300.00 },
        { customer_id: 300, total: 25.00 },
      ])
    })

    it('should GROUP BY multiple columns', async () => {
      const result = await db.query<{
        customer_id: number
        product: string
        count: number
      }>(`
        SELECT customer_id, product, COUNT(*) as count
        FROM orders
        GROUP BY customer_id, product
        ORDER BY customer_id, product
      `)

      expect(result.rows).toContainEqual({ customer_id: 100, product: 'Widget', count: 2 })
      expect(result.rows).toContainEqual({ customer_id: 100, product: 'Gadget', count: 1 })
    })

    it('should filter groups with HAVING', async () => {
      const result = await db.query<{ customer_id: number; total: number }>(`
        SELECT customer_id, SUM(amount) as total
        FROM orders
        GROUP BY customer_id
        HAVING SUM(amount) > 100
        ORDER BY customer_id
      `)

      expect(result.rows).toEqual([
        { customer_id: 100, total: 175.00 },
        { customer_id: 200, total: 300.00 },
      ])
    })

    it('should combine WHERE and HAVING', async () => {
      const result = await db.query<{ customer_id: number; widget_count: number }>(`
        SELECT customer_id, COUNT(*) as widget_count
        FROM orders
        WHERE product = 'Widget'
        GROUP BY customer_id
        HAVING COUNT(*) > 1
      `)

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toEqual({ customer_id: 100, widget_count: 2 })
    })

    it('should support HAVING with multiple conditions', async () => {
      const result = await db.query<{ customer_id: number; total: number; cnt: number }>(`
        SELECT
          customer_id,
          SUM(amount) as total,
          COUNT(*) as cnt
        FROM orders
        GROUP BY customer_id
        HAVING SUM(amount) > 50 AND COUNT(*) >= 2
        ORDER BY total DESC
      `)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].customer_id).toBe(200)
    })

    it('should support GROUP BY with expressions', async () => {
      const result = await db.query<{ month: string; total: number }>(`
        SELECT
          strftime(created_at, '%Y-%m') as month,
          SUM(amount) as total
        FROM orders
        GROUP BY strftime(created_at, '%Y-%m')
      `)

      expect(result.rows).toHaveLength(1) // All in 2024-01
      expect(result.rows[0].month).toBe('2024-01')
    })
  })

  // ============================================================================
  // 4. JOINs: INNER, LEFT, CROSS
  // ============================================================================

  describe('JOIN Operations', () => {
    beforeAll(async () => {
      // Create and populate test tables
      await db.query(`
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY,
          name VARCHAR,
          country VARCHAR
        )
      `)
      await db.query(`
        CREATE TABLE IF NOT EXISTS customer_orders (
          id INTEGER PRIMARY KEY,
          customer_id INTEGER,
          product VARCHAR,
          amount DECIMAL(10,2)
        )
      `)
      await db.query(`
        INSERT INTO customers VALUES
          (1, 'Alice', 'USA'),
          (2, 'Bob', 'UK'),
          (3, 'Charlie', 'USA'),
          (4, 'Diana', 'France')
      `)
      await db.query(`
        INSERT INTO customer_orders VALUES
          (1, 1, 'Widget', 100.00),
          (2, 1, 'Gadget', 50.00),
          (3, 2, 'Widget', 75.00),
          (4, 5, 'Gizmo', 200.00)
      `)
    })

    afterAll(async () => {
      await db.query('DROP TABLE IF EXISTS customers')
      await db.query('DROP TABLE IF EXISTS customer_orders')
    })

    it('should perform INNER JOIN', async () => {
      const result = await db.query<{ name: string; product: string; amount: number }>(`
        SELECT c.name, o.product, o.amount
        FROM customers c
        INNER JOIN customer_orders o ON c.id = o.customer_id
        ORDER BY c.name, o.product
      `)

      expect(result.rows).toHaveLength(3) // Only matching rows
      expect(result.rows).toContainEqual({ name: 'Alice', product: 'Gadget', amount: 50.00 })
      expect(result.rows).toContainEqual({ name: 'Alice', product: 'Widget', amount: 100.00 })
      expect(result.rows).toContainEqual({ name: 'Bob', product: 'Widget', amount: 75.00 })
    })

    it('should perform LEFT JOIN', async () => {
      const result = await db.query<{ name: string; order_count: number }>(`
        SELECT c.name, COUNT(o.id) as order_count
        FROM customers c
        LEFT JOIN customer_orders o ON c.id = o.customer_id
        GROUP BY c.id, c.name
        ORDER BY c.name
      `)

      expect(result.rows).toHaveLength(4) // All customers
      expect(result.rows).toContainEqual({ name: 'Alice', order_count: 2 })
      expect(result.rows).toContainEqual({ name: 'Charlie', order_count: 0 })
      expect(result.rows).toContainEqual({ name: 'Diana', order_count: 0 })
    })

    it('should perform RIGHT JOIN', async () => {
      const result = await db.query<{ name: string | null; product: string }>(`
        SELECT c.name, o.product
        FROM customers c
        RIGHT JOIN customer_orders o ON c.id = o.customer_id
        ORDER BY o.product
      `)

      expect(result.rows).toHaveLength(4) // All orders
      // Order with customer_id=5 has no matching customer
      expect(result.rows).toContainEqual({ name: null, product: 'Gizmo' })
    })

    it('should perform FULL OUTER JOIN', async () => {
      const result = await db.query<{ name: string | null; product: string | null }>(`
        SELECT c.name, o.product
        FROM customers c
        FULL OUTER JOIN customer_orders o ON c.id = o.customer_id
        ORDER BY c.name NULLS LAST, o.product NULLS LAST
      `)

      // Should include unmatched from both sides
      expect(result.rows.length).toBeGreaterThanOrEqual(5)
    })

    it('should perform CROSS JOIN', async () => {
      await db.query('CREATE TABLE IF NOT EXISTS sizes (size VARCHAR)')
      await db.query("INSERT INTO sizes VALUES ('S'), ('M'), ('L')")
      await db.query('CREATE TABLE IF NOT EXISTS colors (color VARCHAR)')
      await db.query("INSERT INTO colors VALUES ('Red'), ('Blue')")

      const result = await db.query<{ size: string; color: string }>(`
        SELECT s.size, c.color
        FROM sizes s
        CROSS JOIN colors c
        ORDER BY s.size, c.color
      `)

      expect(result.rows).toHaveLength(6) // 3 x 2 = 6
      expect(result.rows[0]).toEqual({ size: 'L', color: 'Blue' })

      await db.query('DROP TABLE sizes')
      await db.query('DROP TABLE colors')
    })

    it('should perform self-join', async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS employees (
          id INTEGER PRIMARY KEY,
          name VARCHAR,
          manager_id INTEGER
        )
      `)
      await db.query(`
        INSERT INTO employees VALUES
          (1, 'CEO', NULL),
          (2, 'CTO', 1),
          (3, 'Engineer', 2),
          (4, 'CFO', 1)
      `)

      const result = await db.query<{ employee: string; manager: string | null }>(`
        SELECT e.name as employee, m.name as manager
        FROM employees e
        LEFT JOIN employees m ON e.manager_id = m.id
        ORDER BY e.id
      `)

      expect(result.rows).toContainEqual({ employee: 'CEO', manager: null })
      expect(result.rows).toContainEqual({ employee: 'CTO', manager: 'CEO' })
      expect(result.rows).toContainEqual({ employee: 'Engineer', manager: 'CTO' })

      await db.query('DROP TABLE employees')
    })

    it('should perform multi-table JOIN', async () => {
      await db.query('CREATE TABLE IF NOT EXISTS products (id INTEGER, name VARCHAR, category VARCHAR)')
      await db.query(`
        INSERT INTO products VALUES
          (1, 'Widget', 'Hardware'),
          (2, 'Gadget', 'Hardware')
      `)
      await db.query(`
        CREATE TABLE IF NOT EXISTS product_orders (
          order_id INTEGER,
          product_id INTEGER,
          quantity INTEGER
        )
      `)
      await db.query(`
        INSERT INTO product_orders VALUES
          (1, 1, 2),
          (2, 2, 1)
      `)

      const result = await db.query<{
        customer_name: string
        product_name: string
        category: string
      }>(`
        SELECT c.name as customer_name, p.name as product_name, p.category
        FROM customers c
        INNER JOIN customer_orders co ON c.id = co.customer_id
        INNER JOIN products p ON co.product = p.name
        ORDER BY c.name
      `)

      expect(result.rows.length).toBeGreaterThan(0)

      await db.query('DROP TABLE products')
      await db.query('DROP TABLE product_orders')
    })
  })

  // ============================================================================
  // 5. WINDOW FUNCTIONS
  // ============================================================================

  describe('Window Functions', () => {
    beforeAll(async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS employee_sales (
          id INTEGER,
          name VARCHAR,
          department VARCHAR,
          sales DECIMAL(10,2),
          sale_date DATE
        )
      `)
      await db.query(`
        INSERT INTO employee_sales VALUES
          (1, 'Alice', 'Sales', 1000.00, '2024-01-01'),
          (2, 'Bob', 'Sales', 1500.00, '2024-01-01'),
          (3, 'Charlie', 'Sales', 1200.00, '2024-01-02'),
          (4, 'Diana', 'Marketing', 800.00, '2024-01-01'),
          (5, 'Eve', 'Marketing', 950.00, '2024-01-02'),
          (6, 'Frank', 'Marketing', 800.00, '2024-01-03')
      `)
    })

    afterAll(async () => {
      await db.query('DROP TABLE IF EXISTS employee_sales')
    })

    it('should compute ROW_NUMBER()', async () => {
      const result = await db.query<{ name: string; row_num: number }>(`
        SELECT name, ROW_NUMBER() OVER (ORDER BY sales DESC) as row_num
        FROM employee_sales
        ORDER BY row_num
      `)

      expect(result.rows[0].name).toBe('Bob') // Highest sales
      expect(result.rows[0].row_num).toBe(1)
      expect(result.rows[5].row_num).toBe(6)
    })

    it('should compute ROW_NUMBER() with PARTITION BY', async () => {
      const result = await db.query<{ name: string; department: string; dept_rank: number }>(`
        SELECT
          name,
          department,
          ROW_NUMBER() OVER (PARTITION BY department ORDER BY sales DESC) as dept_rank
        FROM employee_sales
        ORDER BY department, dept_rank
      `)

      // First in Marketing department
      const marketingFirst = result.rows.find(
        (r) => r.department === 'Marketing' && r.dept_rank === 1
      )
      expect(marketingFirst?.name).toBe('Eve')

      // First in Sales department
      const salesFirst = result.rows.find(
        (r) => r.department === 'Sales' && r.dept_rank === 1
      )
      expect(salesFirst?.name).toBe('Bob')
    })

    it('should compute RANK() with ties', async () => {
      const result = await db.query<{ name: string; sales_rank: number }>(`
        SELECT name, RANK() OVER (ORDER BY sales DESC) as sales_rank
        FROM employee_sales
        ORDER BY sales_rank, name
      `)

      // Diana and Frank both have 800, should have same rank
      const diana = result.rows.find((r) => r.name === 'Diana')
      const frank = result.rows.find((r) => r.name === 'Frank')
      expect(diana?.sales_rank).toBe(frank?.sales_rank)
    })

    it('should compute DENSE_RANK()', async () => {
      const result = await db.query<{ name: string; dense_rank: number }>(`
        SELECT name, DENSE_RANK() OVER (ORDER BY sales DESC) as dense_rank
        FROM employee_sales
        ORDER BY dense_rank
      `)

      // With dense_rank, no gaps in ranking after ties
      const ranks = result.rows.map((r) => r.dense_rank)
      const maxRank = Math.max(...ranks)
      // Dense rank should have no gaps
      expect(maxRank).toBeLessThanOrEqual(result.rows.length)
    })

    it('should compute running SUM() window', async () => {
      const result = await db.query<{ name: string; sales: number; running_total: number }>(`
        SELECT
          name,
          sales,
          SUM(sales) OVER (ORDER BY sale_date, name) as running_total
        FROM employee_sales
        ORDER BY sale_date, name
      `)

      // First row's running total should equal its sales
      expect(result.rows[0].running_total).toBe(result.rows[0].sales)
      // Last row's running total should be sum of all sales
      const totalSales = 1000 + 1500 + 1200 + 800 + 950 + 800
      expect(result.rows[result.rows.length - 1].running_total).toBe(totalSales)
    })

    it('should compute moving AVG() window', async () => {
      const result = await db.query<{ name: string; moving_avg: number }>(`
        SELECT
          name,
          AVG(sales) OVER (
            ORDER BY sale_date
            ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING
          ) as moving_avg
        FROM employee_sales
        ORDER BY sale_date, name
      `)

      expect(result.rows).toHaveLength(6)
      result.rows.forEach((r) => {
        expect(typeof r.moving_avg).toBe('number')
      })
    })

    it('should compute LAG() and LEAD()', async () => {
      const result = await db.query<{
        name: string
        sales: number
        prev_sales: number | null
        next_sales: number | null
      }>(`
        SELECT
          name,
          sales,
          LAG(sales) OVER (ORDER BY sale_date, name) as prev_sales,
          LEAD(sales) OVER (ORDER BY sale_date, name) as next_sales
        FROM employee_sales
        ORDER BY sale_date, name
      `)

      // First row has no previous
      expect(result.rows[0].prev_sales).toBeNull()
      // Last row has no next
      expect(result.rows[result.rows.length - 1].next_sales).toBeNull()
    })

    it('should compute FIRST_VALUE() and LAST_VALUE()', async () => {
      const result = await db.query<{
        department: string
        name: string
        top_seller: string
      }>(`
        SELECT
          department,
          name,
          FIRST_VALUE(name) OVER (
            PARTITION BY department
            ORDER BY sales DESC
          ) as top_seller
        FROM employee_sales
        ORDER BY department, name
      `)

      // Every row in Marketing should show Eve as top seller
      const marketingRows = result.rows.filter((r) => r.department === 'Marketing')
      marketingRows.forEach((r) => {
        expect(r.top_seller).toBe('Eve')
      })
    })

    it('should compute NTH_VALUE()', async () => {
      const result = await db.query<{ department: string; second_highest: string | null }>(`
        SELECT DISTINCT
          department,
          NTH_VALUE(name, 2) OVER (
            PARTITION BY department
            ORDER BY sales DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) as second_highest
        FROM employee_sales
        ORDER BY department
      `)

      expect(result.rows).toHaveLength(2) // 2 departments
    })

    it('should compute NTILE()', async () => {
      const result = await db.query<{ name: string; quartile: number }>(`
        SELECT
          name,
          NTILE(4) OVER (ORDER BY sales DESC) as quartile
        FROM employee_sales
        ORDER BY quartile, name
      `)

      // Should divide into 4 roughly equal buckets
      const quartiles = new Set(result.rows.map((r) => r.quartile))
      expect(quartiles.size).toBeLessThanOrEqual(4)
    })
  })

  // ============================================================================
  // 6. CTEs (WITH clause)
  // ============================================================================

  describe('Common Table Expressions (CTEs)', () => {
    beforeAll(async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY,
          name VARCHAR,
          parent_id INTEGER
        )
      `)
      await db.query(`
        INSERT INTO categories VALUES
          (1, 'Electronics', NULL),
          (2, 'Computers', 1),
          (3, 'Laptops', 2),
          (4, 'Desktops', 2),
          (5, 'Phones', 1),
          (6, 'Clothing', NULL)
      `)
    })

    afterAll(async () => {
      await db.query('DROP TABLE IF EXISTS categories')
    })

    it('should execute simple CTE', async () => {
      const result = await db.query<{ name: string; total: number }>(`
        WITH active_users AS (
          SELECT * FROM customers WHERE country = 'USA'
        )
        SELECT name, COUNT(*) OVER () as total FROM active_users
      `)

      expect(result.rows.length).toBeGreaterThan(0)
    })

    it('should execute multiple CTEs', async () => {
      const result = await db.query<{ country: string; customer_count: number; order_total: number }>(`
        WITH
          country_customers AS (
            SELECT country, COUNT(*) as customer_count
            FROM customers
            GROUP BY country
          ),
          country_orders AS (
            SELECT c.country, SUM(o.amount) as order_total
            FROM customers c
            JOIN customer_orders o ON c.id = o.customer_id
            GROUP BY c.country
          )
        SELECT
          cc.country,
          cc.customer_count,
          COALESCE(co.order_total, 0) as order_total
        FROM country_customers cc
        LEFT JOIN country_orders co ON cc.country = co.country
        ORDER BY cc.country
      `)

      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows[0]).toHaveProperty('country')
      expect(result.rows[0]).toHaveProperty('customer_count')
      expect(result.rows[0]).toHaveProperty('order_total')
    })

    it('should execute recursive CTE for hierarchy', async () => {
      const result = await db.query<{ id: number; name: string; level: number; path: string }>(`
        WITH RECURSIVE category_tree AS (
          -- Base case: root categories
          SELECT id, name, 0 as level, name as path
          FROM categories
          WHERE parent_id IS NULL

          UNION ALL

          -- Recursive case: child categories
          SELECT c.id, c.name, ct.level + 1, ct.path || ' > ' || c.name
          FROM categories c
          INNER JOIN category_tree ct ON c.parent_id = ct.id
        )
        SELECT * FROM category_tree ORDER BY path
      `)

      expect(result.rows.length).toBe(6)

      // Verify hierarchy
      const laptops = result.rows.find((r) => r.name === 'Laptops')
      expect(laptops?.level).toBe(2)
      expect(laptops?.path).toContain('Electronics')
      expect(laptops?.path).toContain('Computers')
    })

    it('should execute recursive CTE with UNION vs UNION ALL', async () => {
      // UNION removes duplicates (slower but deduped)
      const result = await db.query<{ id: number }>(`
        WITH RECURSIVE numbers AS (
          SELECT 1 as id
          UNION
          SELECT id + 1 FROM numbers WHERE id < 5
        )
        SELECT * FROM numbers ORDER BY id
      `)

      expect(result.rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5])
    })

    it('should support CTE in INSERT statement', async () => {
      await db.query('CREATE TABLE IF NOT EXISTS category_summary (name VARCHAR, depth INTEGER)')

      await db.query(`
        WITH RECURSIVE tree AS (
          SELECT id, name, 0 as depth FROM categories WHERE parent_id IS NULL
          UNION ALL
          SELECT c.id, c.name, t.depth + 1 FROM categories c JOIN tree t ON c.parent_id = t.id
        )
        INSERT INTO category_summary SELECT name, depth FROM tree
      `)

      const result = await db.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM category_summary'
      )
      expect(result.rows[0].count).toBe(6)

      await db.query('DROP TABLE category_summary')
    })
  })

  // ============================================================================
  // 7. SUBQUERIES
  // ============================================================================

  describe('Subqueries', () => {
    it('should execute scalar subquery in SELECT', async () => {
      const result = await db.query<{ name: string; total_customers: number }>(`
        SELECT
          name,
          (SELECT COUNT(*) FROM customers) as total_customers
        FROM customers
        LIMIT 1
      `)

      expect(result.rows[0].total_customers).toBe(4)
    })

    it('should execute subquery in FROM clause (derived table)', async () => {
      const result = await db.query<{ country: string; cnt: number }>(`
        SELECT country, cnt
        FROM (
          SELECT country, COUNT(*) as cnt
          FROM customers
          GROUP BY country
        ) as country_counts
        WHERE cnt > 1
        ORDER BY cnt DESC
      `)

      // USA has 2 customers
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].country).toBe('USA')
    })

    it('should execute subquery in WHERE with IN', async () => {
      const result = await db.query<{ name: string }>(`
        SELECT name
        FROM customers
        WHERE id IN (
          SELECT DISTINCT customer_id
          FROM customer_orders
        )
        ORDER BY name
      `)

      // Only customers with orders
      expect(result.rows.map((r) => r.name)).toContain('Alice')
      expect(result.rows.map((r) => r.name)).toContain('Bob')
      expect(result.rows.map((r) => r.name)).not.toContain('Charlie')
    })

    it('should execute subquery in WHERE with NOT IN', async () => {
      const result = await db.query<{ name: string }>(`
        SELECT name
        FROM customers
        WHERE id NOT IN (
          SELECT customer_id
          FROM customer_orders
          WHERE customer_id IS NOT NULL
        )
        ORDER BY name
      `)

      // Customers without orders
      expect(result.rows.map((r) => r.name)).toContain('Charlie')
      expect(result.rows.map((r) => r.name)).toContain('Diana')
    })

    it('should execute EXISTS subquery', async () => {
      const result = await db.query<{ name: string }>(`
        SELECT name
        FROM customers c
        WHERE EXISTS (
          SELECT 1
          FROM customer_orders o
          WHERE o.customer_id = c.id
        )
        ORDER BY name
      `)

      expect(result.rows.map((r) => r.name)).toEqual(['Alice', 'Bob'])
    })

    it('should execute NOT EXISTS subquery', async () => {
      const result = await db.query<{ name: string }>(`
        SELECT name
        FROM customers c
        WHERE NOT EXISTS (
          SELECT 1
          FROM customer_orders o
          WHERE o.customer_id = c.id
        )
        ORDER BY name
      `)

      expect(result.rows.map((r) => r.name)).toEqual(['Charlie', 'Diana'])
    })

    it('should execute correlated subquery', async () => {
      const result = await db.query<{ name: string; order_count: number }>(`
        SELECT
          c.name,
          (SELECT COUNT(*) FROM customer_orders o WHERE o.customer_id = c.id) as order_count
        FROM customers c
        ORDER BY order_count DESC, c.name
      `)

      expect(result.rows[0].name).toBe('Alice')
      expect(result.rows[0].order_count).toBe(2)
    })

    it('should execute subquery with comparison operators', async () => {
      const result = await db.query<{ name: string; amount: number }>(`
        SELECT c.name, o.amount
        FROM customers c
        JOIN customer_orders o ON c.id = o.customer_id
        WHERE o.amount > (
          SELECT AVG(amount) FROM customer_orders
        )
        ORDER BY o.amount DESC
      `)

      // Only orders above average
      const avgAmount = (100 + 50 + 75 + 200) / 4 // 106.25
      result.rows.forEach((r) => {
        expect(r.amount).toBeGreaterThan(avgAmount)
      })
    })

    it('should execute subquery with ALL/ANY', async () => {
      const result = await db.query<{ name: string }>(`
        SELECT name
        FROM customers c
        JOIN customer_orders o ON c.id = o.customer_id
        WHERE o.amount >= ALL (
          SELECT amount FROM customer_orders WHERE product = 'Widget'
        )
      `)

      // Only orders with amount >= all Widget orders
      expect(result.rows.length).toBeGreaterThanOrEqual(1)
    })

    it('should execute nested subqueries', async () => {
      const result = await db.query<{ name: string }>(`
        SELECT name
        FROM customers
        WHERE country IN (
          SELECT country
          FROM customers
          WHERE id IN (
            SELECT customer_id
            FROM customer_orders
            WHERE amount > 100
          )
        )
        ORDER BY name
      `)

      expect(result.rows.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance Benchmarks', () => {
    it('should aggregate 10K rows in under 100ms', async () => {
      // Generate 10K rows using generate_series
      await db.query(`
        CREATE TABLE IF NOT EXISTS perf_10k AS
        SELECT
          i as id,
          'user_' || i as name,
          (random() * 1000)::INTEGER as amount,
          CASE WHEN i % 3 = 0 THEN 'A' WHEN i % 3 = 1 THEN 'B' ELSE 'C' END as category
        FROM generate_series(1, 10000) as t(i)
      `)

      const start = performance.now()

      const result = await db.query<{ category: string; total: number; cnt: number }>(`
        SELECT
          category,
          SUM(amount) as total,
          COUNT(*) as cnt
        FROM perf_10k
        GROUP BY category
        ORDER BY category
      `)

      const elapsed = performance.now() - start

      console.log(`10K row aggregation: ${elapsed.toFixed(2)}ms`)

      expect(result.rows).toHaveLength(3) // A, B, C
      expect(elapsed).toBeLessThan(100) // Must complete in under 100ms

      await db.query('DROP TABLE IF EXISTS perf_10k')
    })

    it('should scan and filter 1M rows in under 500ms', async () => {
      // Generate 1M rows
      await db.query(`
        CREATE TABLE IF NOT EXISTS perf_1m AS
        SELECT
          i as id,
          'user_' || (i % 1000) as name,
          (random() * 10000)::INTEGER as amount,
          (random() * 100)::INTEGER as score
        FROM generate_series(1, 1000000) as t(i)
      `)

      const start = performance.now()

      const result = await db.query<{ cnt: number; total: number }>(`
        SELECT
          COUNT(*) as cnt,
          SUM(amount) as total
        FROM perf_1m
        WHERE score > 50
      `)

      const elapsed = performance.now() - start

      console.log(`1M row scan with filter: ${elapsed.toFixed(2)}ms`)
      console.log(`Rows matching filter: ${result.rows[0].cnt}`)

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].cnt).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(500) // Must complete in under 500ms

      await db.query('DROP TABLE IF EXISTS perf_1m')
    })

    it('should handle complex query on 100K rows efficiently', async () => {
      // Generate test data
      await db.query(`
        CREATE TABLE IF NOT EXISTS perf_orders AS
        SELECT
          i as id,
          (i % 1000) + 1 as customer_id,
          CASE WHEN i % 5 = 0 THEN 'Widget'
               WHEN i % 5 = 1 THEN 'Gadget'
               WHEN i % 5 = 2 THEN 'Gizmo'
               WHEN i % 5 = 3 THEN 'Doohickey'
               ELSE 'Thingamajig' END as product,
          (random() * 500)::DECIMAL(10,2) as amount,
          DATE '2024-01-01' + (i % 365) as order_date
        FROM generate_series(1, 100000) as t(i)
      `)

      const start = performance.now()

      const result = await db.query<{
        product: string
        monthly_total: number
        running_total: number
        rank: number
      }>(`
        WITH monthly_sales AS (
          SELECT
            product,
            DATE_TRUNC('month', order_date) as month,
            SUM(amount) as monthly_total
          FROM perf_orders
          GROUP BY product, DATE_TRUNC('month', order_date)
        )
        SELECT
          product,
          monthly_total,
          SUM(monthly_total) OVER (PARTITION BY product ORDER BY month) as running_total,
          RANK() OVER (PARTITION BY product ORDER BY monthly_total DESC) as rank
        FROM monthly_sales
        ORDER BY product, rank
        LIMIT 50
      `)

      const elapsed = performance.now() - start

      console.log(`Complex 100K query (CTE + window functions): ${elapsed.toFixed(2)}ms`)

      expect(result.rows.length).toBeLessThanOrEqual(50)
      expect(elapsed).toBeLessThan(1000) // Should complete in under 1 second

      await db.query('DROP TABLE IF EXISTS perf_orders')
    })

    it('should handle concurrent queries efficiently', async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS concurrent_test AS
        SELECT i as id, random() as value FROM generate_series(1, 10000) as t(i)
      `)

      const start = performance.now()

      // Run 10 concurrent queries
      const queries = Array.from({ length: 10 }, (_, i) =>
        db.query(`SELECT COUNT(*) as cnt, AVG(value) as avg FROM concurrent_test WHERE id > ${i * 1000}`)
      )

      const results = await Promise.all(queries)

      const elapsed = performance.now() - start

      console.log(`10 concurrent queries: ${elapsed.toFixed(2)}ms`)

      expect(results).toHaveLength(10)
      results.forEach((r) => {
        expect(r.rows).toHaveLength(1)
      })

      // Concurrent should not be 10x slower than sequential
      expect(elapsed).toBeLessThan(500)

      await db.query('DROP TABLE IF EXISTS concurrent_test')
    })
  })
})
