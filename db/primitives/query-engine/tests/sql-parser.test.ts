/**
 * RED Phase: SQL WHERE Clause Parser Tests
 *
 * Tests for the SQL WHERE clause parser that converts
 * SQL syntax to unified AST.
 *
 * @see dotdo-l65ba
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import implementation and types
import { SQLWhereParser, ParseError } from '../parsers/sql-parser'
import type { PredicateNode, LogicalNode, QueryNode, GroupByNode, SortNode, ProjectionNode } from '../ast'

describe('SQLWhereParser', () => {
  let parser: SQLWhereParser

  beforeEach(() => {
    // GREEN phase: instantiate the actual parser
    parser = new SQLWhereParser()
  })

  describe('comparison predicates', () => {
    it('should parse: column = value', () => {
      const sql = 'name = "Alice"'

      const ast = parser.parseWhere(sql)

      expect(ast.type).toBe('predicate')
      expect((ast as PredicateNode).column).toBe('name')
      expect((ast as PredicateNode).op).toBe('=')
      expect((ast as PredicateNode).value).toBe('Alice')
    })

    it('should parse: column != value', () => {
      const sql = 'status != "deleted"'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('!=')
    })

    it('should parse: column <> value (alias for !=)', () => {
      const sql = 'status <> "deleted"'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('!=')
    })

    it('should parse: column > value', () => {
      const sql = 'age > 21'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('>')
      expect((ast as PredicateNode).value).toBe(21)
    })

    it('should parse: column >= value', () => {
      const sql = 'price >= 100.50'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('>=')
      expect((ast as PredicateNode).value).toBe(100.50)
    })

    it('should parse: column < value', () => {
      const sql = 'count < 10'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('<')
    })

    it('should parse: column <= value', () => {
      const sql = 'quantity <= 5'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('<=')
    })

    it('should parse negative numbers', () => {
      const sql = 'temperature > -10'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).value).toBe(-10)
    })

    it('should parse scientific notation', () => {
      const sql = 'value > 1.5e10'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).value).toBe(1.5e10)
    })
  })

  describe('set predicates', () => {
    it('should parse: column IN (a, b, c)', () => {
      const sql = 'status IN ("active", "pending", "review")'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('IN')
      expect((ast as PredicateNode).value).toEqual(['active', 'pending', 'review'])
    })

    it('should parse: column NOT IN (a, b, c)', () => {
      const sql = 'category NOT IN ("spam", "deleted", "archived")'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('NOT IN')
    })

    it('should parse: column IN with numbers', () => {
      const sql = 'id IN (1, 2, 3, 4, 5)'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).value).toEqual([1, 2, 3, 4, 5])
    })

    it('should parse: column IN with mixed types', () => {
      const sql = 'value IN (1, "two", 3.0)'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).value).toEqual([1, 'two', 3.0])
    })

    it('should parse: column BETWEEN a AND b', () => {
      const sql = 'price BETWEEN 10 AND 100'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('BETWEEN')
      expect((ast as PredicateNode).value).toEqual([10, 100])
    })

    it('should parse: column NOT BETWEEN a AND b', () => {
      const sql = 'age NOT BETWEEN 0 AND 18'

      const ast = parser.parseWhere(sql)

      // NOT BETWEEN becomes NOT + BETWEEN or separate representation
      expect(ast).toBeDefined()
    })

    it('should parse: BETWEEN with strings', () => {
      const sql = 'name BETWEEN "A" AND "M"'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).value).toEqual(['A', 'M'])
    })

    it('should parse: BETWEEN with dates', () => {
      const sql = "created_at BETWEEN '2024-01-01' AND '2024-12-31'"

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })
  })

  describe('null predicates', () => {
    it('should parse: column IS NULL', () => {
      const sql = 'deleted_at IS NULL'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('IS NULL')
      expect((ast as PredicateNode).column).toBe('deleted_at')
    })

    it('should parse: column IS NOT NULL', () => {
      const sql = 'email IS NOT NULL'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('IS NOT NULL')
    })
  })

  describe('text predicates', () => {
    it('should parse: column LIKE "pattern%"', () => {
      const sql = 'email LIKE "%@example.com"'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('LIKE')
      expect((ast as PredicateNode).value).toBe('%@example.com')
    })

    it('should parse: column NOT LIKE "pattern%"', () => {
      const sql = 'name NOT LIKE "%test%"'

      const ast = parser.parseWhere(sql)

      // NOT LIKE becomes NOT + LIKE or separate representation
      expect(ast).toBeDefined()
    })

    it('should parse: column ILIKE "pattern%" (case insensitive)', () => {
      const sql = 'name ILIKE "%alice%"'

      const ast = parser.parseWhere(sql)

      // ILIKE is case-insensitive LIKE
      expect(ast).toBeDefined()
    })

    it('should parse LIKE with escape character', () => {
      const sql = "path LIKE '%\\_test%' ESCAPE '\\'"

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })

    it('should parse: column SIMILAR TO pattern', () => {
      const sql = 'name SIMILAR TO "(A|B|C)%"'

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })
  })

  describe('logical operators', () => {
    it('should parse: a AND b', () => {
      const sql = 'age >= 18 AND status = "active"'

      const ast = parser.parseWhere(sql)

      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).op).toBe('AND')
      expect((ast as LogicalNode).children).toHaveLength(2)
    })

    it('should parse: a OR b', () => {
      const sql = 'role = "admin" OR role = "moderator"'

      const ast = parser.parseWhere(sql)

      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).op).toBe('OR')
    })

    it('should parse: NOT a', () => {
      const sql = 'NOT deleted'

      const ast = parser.parseWhere(sql)

      expect(ast.type).toBe('logical')
      expect((ast as LogicalNode).op).toBe('NOT')
    })

    it('should parse: (a AND b) OR c', () => {
      const sql = '(age >= 18 AND active = TRUE) OR admin = TRUE'

      const ast = parser.parseWhere(sql)

      expect((ast as LogicalNode).op).toBe('OR')
      expect((ast as LogicalNode).children[0].type).toBe('logical')
    })

    it('should respect operator precedence: a AND b OR c -> (a AND b) OR c', () => {
      const sql = 'a = 1 AND b = 2 OR c = 3'

      const ast = parser.parseWhere(sql)

      // AND has higher precedence than OR
      expect((ast as LogicalNode).op).toBe('OR')
      expect((ast as LogicalNode).children[0].type).toBe('logical')
      expect(((ast as LogicalNode).children[0] as LogicalNode).op).toBe('AND')
    })

    it('should respect operator precedence: a OR b AND c -> a OR (b AND c)', () => {
      const sql = 'a = 1 OR b = 2 AND c = 3'

      const ast = parser.parseWhere(sql)

      expect((ast as LogicalNode).op).toBe('OR')
      expect((ast as LogicalNode).children[1].type).toBe('logical')
      expect(((ast as LogicalNode).children[1] as LogicalNode).op).toBe('AND')
    })

    it('should handle multiple levels of nesting', () => {
      const sql = '((a = 1 AND b = 2) OR (c = 3 AND d = 4)) AND e = 5'

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })

    it('should handle NOT with parentheses', () => {
      const sql = 'NOT (a = 1 OR b = 2)'

      const ast = parser.parseWhere(sql)

      expect((ast as LogicalNode).op).toBe('NOT')
    })
  })

  describe('aggregate queries', () => {
    it('should parse: SELECT ... GROUP BY col1, col2', () => {
      const sql = 'SELECT category, SUM(amount) FROM orders GROUP BY category'

      const ast = parser.parseSelect(sql)

      expect(ast.groupBy).toBeDefined()
      expect((ast.groupBy as GroupByNode).columns).toContain('category')
    })

    it('should parse: SELECT COUNT(*), SUM(col) ...', () => {
      const sql = 'SELECT COUNT(*), SUM(price), AVG(quantity) FROM orders'

      const ast = parser.parseSelect(sql)

      expect(ast.projection).toBeDefined()
    })

    it('should parse: SELECT ... HAVING COUNT(*) > 10', () => {
      const sql =
        'SELECT category, COUNT(*) as cnt FROM products GROUP BY category HAVING COUNT(*) > 10'

      const ast = parser.parseSelect(sql)

      expect((ast.groupBy as GroupByNode).having).toBeDefined()
    })

    it('should parse: SELECT ... ORDER BY col ASC/DESC', () => {
      const sql = 'SELECT * FROM users ORDER BY created_at DESC, name ASC'

      const ast = parser.parseSelect(sql)

      expect(ast.sort).toBeDefined()
      expect((ast.sort as SortNode).columns).toHaveLength(2)
      expect((ast.sort as SortNode).columns[0].direction).toBe('DESC')
    })

    it('should parse: SELECT ... LIMIT n OFFSET m', () => {
      const sql = 'SELECT * FROM users LIMIT 20 OFFSET 100'

      const ast = parser.parseSelect(sql)

      expect(ast.limit).toBe(20)
      expect(ast.offset).toBe(100)
    })

    it('should parse: SELECT ... LIMIT n, m (alternative syntax)', () => {
      const sql = 'SELECT * FROM users LIMIT 100, 20'

      const ast = parser.parseSelect(sql)

      expect(ast.offset).toBe(100)
      expect(ast.limit).toBe(20)
    })

    it('should parse: SELECT DISTINCT', () => {
      const sql = 'SELECT DISTINCT category FROM products'

      const ast = parser.parseSelect(sql)

      expect(ast.distinct).toBe(true)
    })

    it('should parse: GROUP BY with ROLLUP', () => {
      const sql = 'SELECT region, category, SUM(sales) FROM data GROUP BY ROLLUP(region, category)'

      const ast = parser.parseSelect(sql)

      expect(ast).toBeDefined()
    })

    it('should parse: window functions', () => {
      const sql = 'SELECT name, salary, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) as rank FROM employees'

      const ast = parser.parseSelect(sql)

      expect(ast).toBeDefined()
    })
  })

  describe('data types', () => {
    it('should parse string literals: "text" or \'text\'', () => {
      const sql1 = 'name = "Alice"'
      const sql2 = "name = 'Alice'"

      const ast1 = parser.parseWhere(sql1)
      const ast2 = parser.parseWhere(sql2)

      expect((ast1 as PredicateNode).value).toBe('Alice')
      expect((ast2 as PredicateNode).value).toBe('Alice')
    })

    it('should parse escaped quotes in strings', () => {
      const sql = "name = 'O''Brien'"

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).value).toBe("O'Brien")
    })

    it('should parse numeric literals: 42, 3.14', () => {
      const sql1 = 'age = 42'
      const sql2 = 'price = 3.14'

      const ast1 = parser.parseWhere(sql1)
      const ast2 = parser.parseWhere(sql2)

      expect((ast1 as PredicateNode).value).toBe(42)
      expect((ast2 as PredicateNode).value).toBe(3.14)
    })

    it('should parse boolean literals: TRUE, FALSE', () => {
      const sql1 = 'active = TRUE'
      const sql2 = 'deleted = FALSE'

      const ast1 = parser.parseWhere(sql1)
      const ast2 = parser.parseWhere(sql2)

      expect((ast1 as PredicateNode).value).toBe(true)
      expect((ast2 as PredicateNode).value).toBe(false)
    })

    it('should parse NULL', () => {
      const sql = 'value IS NULL'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).op).toBe('IS NULL')
    })

    it('should parse date/timestamp literals', () => {
      const sql1 = "created_at > DATE '2024-01-01'"
      const sql2 = "updated_at < TIMESTAMP '2024-01-01 12:00:00'"

      const ast1 = parser.parseWhere(sql1)
      const ast2 = parser.parseWhere(sql2)

      expect(ast1).toBeDefined()
      expect(ast2).toBeDefined()
    })

    it('should parse interval literals', () => {
      const sql = "created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'"

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })

    it('should parse array literals', () => {
      const sql = 'tags @> ARRAY[\'urgent\', \'important\']'

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })

    it('should parse JSON literals', () => {
      const sql = "data->>'name' = 'Alice'"

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })
  })

  describe('identifiers', () => {
    it('should parse simple columns: name', () => {
      const sql = 'name = "Alice"'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).column).toBe('name')
    })

    it('should parse qualified columns: table.column', () => {
      const sql = 'users.name = "Alice"'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).column).toBe('users.name')
    })

    it('should parse quoted identifiers: "Column Name"', () => {
      const sql = '"Column Name" = "value"'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).column).toBe('Column Name')
    })

    it('should parse backtick quoted identifiers: `Column Name`', () => {
      const sql = '`Column Name` = "value"'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).column).toBe('Column Name')
    })

    it('should parse schema.table.column', () => {
      const sql = 'public.users.email = "test@example.com"'

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).column).toBe('public.users.email')
    })

    it('should handle reserved word columns when quoted', () => {
      const sql = '"select" = 1 AND "from" = 2'

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })
  })

  describe('joins', () => {
    it('should parse INNER JOIN', () => {
      const sql =
        'SELECT * FROM orders INNER JOIN customers ON orders.customer_id = customers.id'

      const ast = parser.parseSelect(sql)

      expect(ast.join).toBeDefined()
      expect(ast.join.joinType).toBe('INNER')
    })

    it('should parse LEFT JOIN', () => {
      const sql =
        'SELECT * FROM orders LEFT JOIN customers ON orders.customer_id = customers.id'

      const ast = parser.parseSelect(sql)

      expect(ast.join.joinType).toBe('LEFT')
    })

    it('should parse RIGHT JOIN', () => {
      const sql =
        'SELECT * FROM orders RIGHT JOIN customers ON orders.customer_id = customers.id'

      const ast = parser.parseSelect(sql)

      expect(ast.join.joinType).toBe('RIGHT')
    })

    it('should parse CROSS JOIN', () => {
      const sql = 'SELECT * FROM a CROSS JOIN b'

      const ast = parser.parseSelect(sql)

      expect(ast.join.joinType).toBe('CROSS')
    })

    it('should parse multiple JOINs', () => {
      const sql = `
        SELECT * FROM orders
        JOIN customers ON orders.customer_id = customers.id
        JOIN products ON orders.product_id = products.id
      `

      const ast = parser.parseSelect(sql)

      expect(ast).toBeDefined()
    })

    it('should parse complex JOIN conditions', () => {
      const sql = `
        SELECT * FROM orders o
        JOIN customers c ON o.customer_id = c.id AND c.status = 'active'
      `

      const ast = parser.parseSelect(sql)

      expect(ast).toBeDefined()
    })
  })

  describe('subqueries', () => {
    it('should parse subquery in WHERE', () => {
      const sql = 'id IN (SELECT user_id FROM active_users)'

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })

    it('should parse EXISTS subquery', () => {
      const sql = 'EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)'

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })

    it('should parse scalar subquery', () => {
      const sql = 'salary > (SELECT AVG(salary) FROM employees)'

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw ParseError on syntax error', () => {
      const sql = 'a = AND b = 2'

      expect(() => parser.parseWhere(sql)).toThrow(ParseError)
    })

    it('should include position information in errors', () => {
      const sql = 'name = "unclosed string'

      try {
        parser.parseWhere(sql)
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as ParseError).position).toBeDefined()
      }
    })

    it('should throw on unbalanced parentheses', () => {
      const sql = '(a = 1 AND (b = 2)'

      expect(() => parser.parseWhere(sql)).toThrow(/parenthes/i)
    })

    it('should throw on unexpected token', () => {
      const sql = 'a = 1 b = 2'

      expect(() => parser.parseWhere(sql)).toThrow(/unexpected/i)
    })

    it('should provide helpful error for missing operator', () => {
      const sql = 'a 1'

      expect(() => parser.parseWhere(sql)).toThrow(/operator/i)
    })
  })

  describe('case sensitivity', () => {
    it('should handle case-insensitive keywords', () => {
      // Keywords (SELECT, FROM, WHERE) should be case-insensitive
      const sql1 = 'SELECT * FROM users WHERE age > 21'
      const sql2 = 'select * from users where age > 21'

      const ast1 = parser.parseSelect(sql1)
      const ast2 = parser.parseSelect(sql2)

      // Both should parse successfully with same structure
      expect(ast1).toEqual(ast2)

      // Mixed case keywords should also work
      const sql3 = 'Select * From users Where age > 21'
      const ast3 = parser.parseSelect(sql3)
      expect(ast3).toEqual(ast1)
    })

    it('should preserve case for identifiers', () => {
      const sql = 'SELECT UserName FROM Users'

      const ast = parser.parseSelect(sql)

      expect((ast.projection as ProjectionNode).columns[0].source).toBe('UserName')
    })
  })

  describe('comments', () => {
    it('should ignore single-line comments', () => {
      const sql = `
        name = 'Alice' -- This is a comment
        AND age > 21
      `

      const ast = parser.parseWhere(sql)

      expect((ast as LogicalNode).children).toHaveLength(2)
    })

    it('should ignore multi-line comments', () => {
      const sql = `
        name = 'Alice'
        /* This is
           a multi-line
           comment */
        AND age > 21
      `

      const ast = parser.parseWhere(sql)

      expect((ast as LogicalNode).children).toHaveLength(2)
    })
  })

  describe('performance', () => {
    it('should parse 10k queries per second', () => {
      const queries: string[] = []
      for (let i = 0; i < 10000; i++) {
        queries.push(`field${i % 100} > ${i} AND status IN ('active', 'pending')`)
      }

      const start = performance.now()
      for (const query of queries) {
        parser.parseWhere(query)
      }
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(1000) // Under 1 second
    })

    it('should handle long IN lists efficiently', () => {
      const values = Array.from({ length: 10000 }, (_, i) => i).join(', ')
      const sql = `id IN (${values})`

      const start = performance.now()
      parser.parseWhere(sql)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(100) // Under 100ms
    })
  })

  describe('edge cases', () => {
    it('should handle empty WHERE clause', () => {
      const sql = ''

      const ast = parser.parseWhere(sql)

      // Empty should produce always-true or no predicates
      expect(ast).toBeDefined()
    })

    it('should handle whitespace-only input', () => {
      const sql = '   \t\n   '

      const ast = parser.parseWhere(sql)

      expect(ast).toBeDefined()
    })

    it('should handle very long column names', () => {
      const longName = 'a'.repeat(256)
      const sql = `${longName} = 1`

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).column).toBe(longName)
    })

    it('should handle unicode in strings', () => {
      const sql = "name = 'Alice'"

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).value).toBe('Alice')
    })

    it('should handle emoji in strings', () => {
      const sql = "name = 'Hello '"

      const ast = parser.parseWhere(sql)

      expect((ast as PredicateNode).value).toBe('Hello ')
    })
  })

  // ==========================================================================
  // Temporal / Time Travel Queries (AS OF)
  // ==========================================================================

  describe('temporal / time travel queries', () => {
    describe('FOR SYSTEM_TIME AS OF', () => {
      it('should parse: SELECT * FROM users FOR SYSTEM_TIME AS OF TIMESTAMP', () => {
        const sql = "SELECT * FROM users FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15T10:00:00Z'"

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.type).toBe('temporal')
        expect(ast.temporal!.queryType).toBe('AS_OF')
        expect(ast.temporal!.asOfTimestamp).toBe(new Date('2024-01-15T10:00:00Z').getTime())
      })

      it('should parse: FOR SYSTEM_TIME AS OF with epoch milliseconds', () => {
        const sql = 'SELECT * FROM users FOR SYSTEM_TIME AS OF 1705312800000'

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.queryType).toBe('AS_OF')
        expect(ast.temporal!.asOfTimestamp).toBe(1705312800000)
      })

      it('should parse: FOR SYSTEM_TIME AS OF with string timestamp', () => {
        const sql = "SELECT * FROM users FOR SYSTEM_TIME AS OF '2024-01-15T10:00:00Z'"

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.queryType).toBe('AS_OF')
        expect(ast.temporal!.asOfTimestamp).toBe(new Date('2024-01-15T10:00:00Z').getTime())
      })
    })

    describe('FOR SYSTEM_VERSION AS OF', () => {
      it('should parse: SELECT * FROM users FOR SYSTEM_VERSION AS OF 12345', () => {
        const sql = 'SELECT * FROM users FOR SYSTEM_VERSION AS OF 12345'

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.queryType).toBe('AS_OF')
        expect(ast.temporal!.snapshotId).toBe(12345)
      })
    })

    describe('FOR SYSTEM_TIME BEFORE', () => {
      it('should parse: SELECT * FROM users FOR SYSTEM_TIME BEFORE timestamp', () => {
        const sql = "SELECT * FROM users FOR SYSTEM_TIME BEFORE TIMESTAMP '2024-01-15T10:00:00Z'"

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.queryType).toBe('BEFORE')
        expect(ast.temporal!.asOfTimestamp).toBe(new Date('2024-01-15T10:00:00Z').getTime())
      })
    })

    describe('FOR SYSTEM_TIME BETWEEN', () => {
      it('should parse: SELECT * FROM users FOR SYSTEM_TIME BETWEEN t1 AND t2', () => {
        const sql = `SELECT * FROM users FOR SYSTEM_TIME BETWEEN
          TIMESTAMP '2024-01-01T00:00:00Z'
          AND TIMESTAMP '2024-01-31T23:59:59Z'`

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.queryType).toBe('BETWEEN')
        expect(ast.temporal!.asOfTimestamp).toBe(new Date('2024-01-01T00:00:00Z').getTime())
        expect(ast.temporal!.toTimestamp).toBe(new Date('2024-01-31T23:59:59Z').getTime())
      })

      it('should parse: SELECT * FROM users FOR SYSTEM_TIME FROM t1 TO t2', () => {
        const sql = `SELECT * FROM users FOR SYSTEM_TIME FROM 1704067200000 TO 1706745600000`

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.queryType).toBe('BETWEEN')
        expect(ast.temporal!.asOfTimestamp).toBe(1704067200000)
        expect(ast.temporal!.toTimestamp).toBe(1706745600000)
      })
    })

    describe('CURRENT_TIMESTAMP in temporal clauses', () => {
      it('should parse: FOR SYSTEM_TIME AS OF CURRENT_TIMESTAMP', () => {
        const before = Date.now()
        const sql = 'SELECT * FROM users FOR SYSTEM_TIME AS OF CURRENT_TIMESTAMP'

        const ast = parser.parseSelect(sql)
        const after = Date.now()

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.queryType).toBe('AS_OF')
        expect(ast.temporal!.asOfTimestamp).toBeGreaterThanOrEqual(before)
        expect(ast.temporal!.asOfTimestamp).toBeLessThanOrEqual(after)
      })

      it('should parse: FOR SYSTEM_TIME AS OF CURRENT_TIMESTAMP - INTERVAL', () => {
        const before = Date.now() - 24 * 60 * 60 * 1000
        const sql = "SELECT * FROM users FOR SYSTEM_TIME AS OF CURRENT_TIMESTAMP - INTERVAL '1 day'"

        const ast = parser.parseSelect(sql)
        const after = Date.now() - 24 * 60 * 60 * 1000

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.queryType).toBe('AS_OF')
        // Allow some tolerance for test execution time
        expect(ast.temporal!.asOfTimestamp).toBeGreaterThanOrEqual(before - 100)
        expect(ast.temporal!.asOfTimestamp).toBeLessThanOrEqual(after + 100)
      })
    })

    describe('temporal clause with other clauses', () => {
      it('should combine temporal with WHERE clause', () => {
        const sql = `SELECT * FROM users
          FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15T10:00:00Z'
          WHERE status = 'active'`

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.queryType).toBe('AS_OF')
        expect(ast.where).toBeDefined()
        expect((ast.where as PredicateNode).column).toBe('status')
      })

      it('should combine temporal with JOIN', () => {
        const sql = `SELECT * FROM orders
          FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15T10:00:00Z'
          INNER JOIN customers ON orders.customer_id = customers.id`

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.join).toBeDefined()
      })

      it('should combine temporal with ORDER BY and LIMIT', () => {
        const sql = `SELECT * FROM users
          FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15T10:00:00Z'
          ORDER BY created_at DESC
          LIMIT 10`

        const ast = parser.parseSelect(sql)

        expect(ast.temporal).toBeDefined()
        expect(ast.sort).toBeDefined()
        expect(ast.limit).toBe(10)
      })
    })

    describe('interval parsing', () => {
      it('should parse INTERVAL with minutes', () => {
        const before = Date.now() - 30 * 60 * 1000
        const sql = "SELECT * FROM users FOR SYSTEM_TIME AS OF CURRENT_TIMESTAMP - INTERVAL '30 minutes'"

        const ast = parser.parseSelect(sql)
        const after = Date.now() - 30 * 60 * 1000

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.asOfTimestamp).toBeGreaterThanOrEqual(before - 100)
        expect(ast.temporal!.asOfTimestamp).toBeLessThanOrEqual(after + 100)
      })

      it('should parse INTERVAL with hours', () => {
        const before = Date.now() - 2 * 60 * 60 * 1000
        const sql = "SELECT * FROM users FOR SYSTEM_TIME AS OF CURRENT_TIMESTAMP - INTERVAL '2 hours'"

        const ast = parser.parseSelect(sql)
        const after = Date.now() - 2 * 60 * 60 * 1000

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.asOfTimestamp).toBeGreaterThanOrEqual(before - 100)
        expect(ast.temporal!.asOfTimestamp).toBeLessThanOrEqual(after + 100)
      })

      it('should parse INTERVAL with weeks', () => {
        const before = Date.now() - 1 * 7 * 24 * 60 * 60 * 1000
        const sql = "SELECT * FROM users FOR SYSTEM_TIME AS OF CURRENT_TIMESTAMP - INTERVAL '1 week'"

        const ast = parser.parseSelect(sql)
        const after = Date.now() - 1 * 7 * 24 * 60 * 60 * 1000

        expect(ast.temporal).toBeDefined()
        expect(ast.temporal!.asOfTimestamp).toBeGreaterThanOrEqual(before - 100)
        expect(ast.temporal!.asOfTimestamp).toBeLessThanOrEqual(after + 100)
      })
    })
  })
})
