/**
 * ClickHouse SQL Parser Tests
 *
 * Tests for parsing Things/Relationships queries with:
 * - JSON path extraction (->>, ->)
 * - Vector functions (cosineDistance, etc.)
 * - CREATE TABLE with ENGINE clause
 */

import { describe, it, expect } from 'vitest'
import {
  Lexer,
  tokenize,
  TokenType,
  Parser,
  parseSQL,
  formatAST,
  validateThingsQuery,
  type Token,
  type SelectQueryNode,
  type CreateTableNode,
  type FunctionCallNode,
  type JSONPathNode,
  type BinaryOpNode,
  type LiteralNode,
  type IdentifierNode,
  type ArrayLiteralNode,
  type AliasNode,
} from './parser-wasm'

// ============================================================================
// Lexer Tests
// ============================================================================

describe('Lexer', () => {
  describe('basic tokens', () => {
    it('should tokenize simple SELECT', () => {
      const tokens = tokenize('SELECT * FROM things')
      const significant = tokens.filter(
        (t) => t.type !== TokenType.Whitespace && t.type !== TokenType.EndOfStream
      )

      expect(significant).toHaveLength(4)
      expect(significant[0]).toMatchObject({ type: TokenType.BareWord, value: 'SELECT' })
      expect(significant[1]).toMatchObject({ type: TokenType.Asterisk, value: '*' })
      expect(significant[2]).toMatchObject({ type: TokenType.BareWord, value: 'FROM' })
      expect(significant[3]).toMatchObject({ type: TokenType.BareWord, value: 'things' })
    })

    it('should tokenize numbers', () => {
      const tokens = tokenize('123 456.789 0.5 1e10 0xFF 0b101')
      const numbers = tokens.filter((t) => t.type === TokenType.Number)

      expect(numbers).toHaveLength(6)
      expect(numbers[0].value).toBe('123')
      expect(numbers[1].value).toBe('456.789')
      expect(numbers[2].value).toBe('0.5')
      expect(numbers[3].value).toBe('1e10')
      expect(numbers[4].value).toBe('0xFF')
      expect(numbers[5].value).toBe('0b101')
    })

    it('should tokenize string literals', () => {
      const tokens = tokenize("'hello' 'world''s' 'escape\\'d'")
      const strings = tokens.filter((t) => t.type === TokenType.StringLiteral)

      expect(strings).toHaveLength(3)
      expect(strings[0].value).toBe("'hello'")
      expect(strings[1].value).toBe("'world''s'")
      expect(strings[2].value).toBe("'escape\\'d'")
    })

    it('should tokenize quoted identifiers', () => {
      const tokens = tokenize('"column name" `another`')
      const quoted = tokens.filter((t) => t.type === TokenType.QuotedIdentifier)

      expect(quoted).toHaveLength(2)
      expect(quoted[0].value).toBe('"column name"')
      expect(quoted[1].value).toBe('`another`')
    })

    it('should tokenize operators', () => {
      const tokens = tokenize('= != <> < > <= >= <=> + - * / %')
      const ops = tokens.filter(
        (t) => t.type !== TokenType.Whitespace && t.type !== TokenType.EndOfStream
      )

      expect(ops.map((t) => t.type)).toEqual([
        TokenType.Equals,
        TokenType.NotEquals,
        TokenType.NotEquals,
        TokenType.Less,
        TokenType.Greater,
        TokenType.LessOrEquals,
        TokenType.GreaterOrEquals,
        TokenType.Spaceship,
        TokenType.Plus,
        TokenType.Minus,
        TokenType.Asterisk,
        TokenType.Slash,
        TokenType.Percent,
      ])
    })

    it('should tokenize arrow operators', () => {
      const tokens = tokenize('-> ->>')
      const arrows = tokens.filter(
        (t) => t.type !== TokenType.Whitespace && t.type !== TokenType.EndOfStream
      )

      expect(arrows).toHaveLength(2)
      expect(arrows[0]).toMatchObject({ type: TokenType.Arrow, value: '->' })
      expect(arrows[1]).toMatchObject({ type: TokenType.DoubleArrow, value: '->>' })
    })

    it('should tokenize double colon', () => {
      const tokens = tokenize('value::Int32')
      const significant = tokens.filter(
        (t) => t.type !== TokenType.Whitespace && t.type !== TokenType.EndOfStream
      )

      expect(significant).toHaveLength(3)
      expect(significant[0]).toMatchObject({ type: TokenType.BareWord, value: 'value' })
      expect(significant[1]).toMatchObject({ type: TokenType.DoubleColon, value: '::' })
      expect(significant[2]).toMatchObject({ type: TokenType.BareWord, value: 'Int32' })
    })

    it('should handle comments', () => {
      const tokens = tokenize('SELECT -- comment\n* /* block */ FROM')
      const significant = tokens.filter(
        (t) =>
          t.type !== TokenType.Whitespace &&
          t.type !== TokenType.Comment &&
          t.type !== TokenType.EndOfStream
      )

      expect(significant).toHaveLength(3)
      expect(significant[0].value).toBe('SELECT')
      expect(significant[1].value).toBe('*')
      expect(significant[2].value).toBe('FROM')
    })
  })
})

// ============================================================================
// Parser Tests - SELECT Queries
// ============================================================================

describe('Parser - SELECT Queries', () => {
  describe('basic SELECT', () => {
    it('should parse SELECT *', () => {
      const ast = parseSQL('SELECT * FROM things')

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode
      expect(select.columns).toHaveLength(1)
      expect(select.columns[0].type).toBe('Star')
      expect(select.from?.table).toBe('things')
    })

    it('should parse SELECT with multiple columns', () => {
      const ast = parseSQL('SELECT id, type, data FROM things')

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode
      expect(select.columns).toHaveLength(3)
      expect((select.columns[0] as IdentifierNode).name).toBe('id')
      expect((select.columns[1] as IdentifierNode).name).toBe('type')
      expect((select.columns[2] as IdentifierNode).name).toBe('data')
    })

    it('should parse SELECT DISTINCT', () => {
      const ast = parseSQL('SELECT DISTINCT type FROM things')

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode
      expect(select.distinct).toBe(true)
    })

    it('should parse SELECT with WHERE clause', () => {
      const ast = parseSQL("SELECT * FROM things WHERE type = 'customer'")

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode
      expect(select.where).toBeDefined()
      expect(select.where?.type).toBe('BinaryOp')

      const where = select.where as BinaryOpNode
      expect(where.op).toBe('=')
      expect((where.left as IdentifierNode).name).toBe('type')
      expect((where.right as LiteralNode).value).toBe('customer')
    })

    it('should parse SELECT with ORDER BY', () => {
      const ast = parseSQL('SELECT * FROM things ORDER BY created_at DESC')

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode
      expect(select.orderBy).toHaveLength(1)
      expect(select.orderBy![0].direction).toBe('DESC')
    })

    it('should parse SELECT with LIMIT', () => {
      const ast = parseSQL('SELECT * FROM things LIMIT 10')

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode
      expect(select.limit?.value).toBe(10)
    })

    it('should parse SELECT with aliases', () => {
      const ast = parseSQL('SELECT id AS thing_id, type thing_type FROM things')

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode
      expect(select.columns).toHaveLength(2)

      expect(select.columns[0].type).toBe('Alias')
      const alias1 = select.columns[0] as AliasNode
      expect(alias1.alias).toBe('thing_id')

      expect(select.columns[1].type).toBe('Alias')
      const alias2 = select.columns[1] as AliasNode
      expect(alias2.alias).toBe('thing_type')
    })
  })

  describe('JSON path extraction', () => {
    it("should parse SELECT with ->> JSON path extraction", () => {
      const sql = "SELECT data->>'$.user.email' FROM things WHERE type = 'customer'"
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      expect(select.columns).toHaveLength(1)
      expect(select.columns[0].type).toBe('JSONPath')

      const jsonPath = select.columns[0] as JSONPathNode
      expect(jsonPath.extractText).toBe(true)
      expect(jsonPath.path).toBe("'$.user.email'")
      expect((jsonPath.object as IdentifierNode).name).toBe('data')
    })

    it('should parse SELECT with -> JSON path extraction', () => {
      const sql = "SELECT data->'$.nested.object' FROM things"
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      const jsonPath = select.columns[0] as JSONPathNode
      expect(jsonPath.extractText).toBe(false)
      expect(jsonPath.path).toBe("'$.nested.object'")
    })

    it('should parse complex JSON path in WHERE clause', () => {
      const sql = "SELECT * FROM things WHERE data->>'$.status' = 'active'"
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      expect(select.where?.type).toBe('BinaryOp')
      const where = select.where as BinaryOpNode
      expect(where.left.type).toBe('JSONPath')
    })
  })

  describe('vector functions', () => {
    it('should parse cosineDistance function', () => {
      const sql = 'SELECT cosineDistance(embedding, [0.1, 0.2]) FROM things ORDER BY 1 LIMIT 10'
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      expect(select.columns).toHaveLength(1)
      expect(select.columns[0].type).toBe('FunctionCall')

      const func = select.columns[0] as FunctionCallNode
      expect(func.name).toBe('cosineDistance')
      expect(func.args).toHaveLength(2)
      expect((func.args[0] as IdentifierNode).name).toBe('embedding')
      expect(func.args[1].type).toBe('ArrayLiteral')

      const array = func.args[1] as ArrayLiteralNode
      expect(array.elements).toHaveLength(2)
      expect((array.elements[0] as LiteralNode).value).toBe(0.1)
      expect((array.elements[1] as LiteralNode).value).toBe(0.2)

      expect(select.limit?.value).toBe(10)
    })

    it('should parse L2Distance function', () => {
      const sql = 'SELECT L2Distance(vec1, vec2) AS distance FROM vectors'
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      expect(select.columns[0].type).toBe('Alias')
      const alias = select.columns[0] as AliasNode
      expect(alias.alias).toBe('distance')
      expect(alias.expression.type).toBe('FunctionCall')

      const func = alias.expression as FunctionCallNode
      expect(func.name).toBe('L2Distance')
    })

    it('should parse vector array literals', () => {
      const sql = 'SELECT [0.1, 0.2, 0.3, 0.4, 0.5] AS embedding'
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      const alias = select.columns[0] as AliasNode
      expect(alias.expression.type).toBe('ArrayLiteral')

      const array = alias.expression as ArrayLiteralNode
      expect(array.elements).toHaveLength(5)
    })

    it('should parse nested function calls with vectors', () => {
      const sql =
        'SELECT normalize(embedding) AS normalized_embedding FROM things WHERE cosineDistance(embedding, [0.1, 0.2]) < 0.5'
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      // Check column
      const alias = select.columns[0] as AliasNode
      expect((alias.expression as FunctionCallNode).name).toBe('normalize')

      // Check WHERE
      expect(select.where?.type).toBe('BinaryOp')
      const where = select.where as BinaryOpNode
      expect(where.left.type).toBe('FunctionCall')
      expect((where.left as FunctionCallNode).name).toBe('cosineDistance')
    })
  })

  describe('complex expressions', () => {
    it('should parse AND/OR conditions', () => {
      const sql = "SELECT * FROM things WHERE type = 'customer' AND status = 'active'"
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      expect(select.where?.type).toBe('BinaryOp')
      const where = select.where as BinaryOpNode
      expect(where.op).toBe('AND')
    })

    it('should parse arithmetic expressions', () => {
      const sql = 'SELECT price * quantity AS total FROM orders'
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      const alias = select.columns[0] as AliasNode
      expect(alias.expression.type).toBe('BinaryOp')

      const expr = alias.expression as BinaryOpNode
      expect(expr.op).toBe('*')
    })

    it('should parse function calls with multiple arguments', () => {
      const sql = "SELECT if(status = 'active', 1, 0) AS is_active FROM things"
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      const alias = select.columns[0] as AliasNode
      expect(alias.expression.type).toBe('FunctionCall')

      const func = alias.expression as FunctionCallNode
      expect(func.name).toBe('if')
      expect(func.args).toHaveLength(3)
    })

    it('should parse ORDER BY with numeric reference', () => {
      const sql = 'SELECT cosineDistance(embedding, [0.1, 0.2]) FROM things ORDER BY 1 LIMIT 10'
      const ast = parseSQL(sql)

      expect(ast.type).toBe('SelectQuery')
      const select = ast as SelectQueryNode

      expect(select.orderBy).toHaveLength(1)
      expect(select.orderBy![0].expression.type).toBe('Literal')
      expect((select.orderBy![0].expression as LiteralNode).value).toBe(1)
    })
  })
})

// ============================================================================
// Parser Tests - CREATE TABLE
// ============================================================================

describe('Parser - CREATE TABLE', () => {
  it('should parse CREATE TABLE with ENGINE clause', () => {
    const sql = 'CREATE TABLE things (id String, type String, data JSON) ENGINE = IcebergMergeTree()'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('CreateTable')
    const create = ast as CreateTableNode

    expect(create.table.table).toBe('things')
    expect(create.columns).toHaveLength(3)
    expect(create.columns[0]).toMatchObject({ name: 'id', dataType: 'String' })
    expect(create.columns[1]).toMatchObject({ name: 'type', dataType: 'String' })
    expect(create.columns[2]).toMatchObject({ name: 'data', dataType: 'JSON' })

    expect(create.engine?.name).toBe('IcebergMergeTree')
  })

  it('should parse CREATE TABLE IF NOT EXISTS', () => {
    const sql = 'CREATE TABLE IF NOT EXISTS things (id String) ENGINE = MergeTree()'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('CreateTable')
    const create = ast as CreateTableNode
    expect(create.ifNotExists).toBe(true)
  })

  it('should parse CREATE TABLE with complex column types', () => {
    const sql =
      'CREATE TABLE things (id String, tags Array(String), metadata Nullable(JSON)) ENGINE = ReplacingMergeTree()'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('CreateTable')
    const create = ast as CreateTableNode

    expect(create.columns).toHaveLength(3)
    expect(create.columns[1].dataType).toBe('Array(String)')
    expect(create.columns[2].dataType).toBe('Nullable(JSON)')
  })

  it('should parse CREATE TABLE with database prefix', () => {
    const sql = 'CREATE TABLE mydb.things (id String) ENGINE = MergeTree()'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('CreateTable')
    const create = ast as CreateTableNode
    expect(create.table.database).toBe('mydb')
    expect(create.table.table).toBe('things')
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

describe('Validation', () => {
  it('should validate Things query patterns', () => {
    const sql = "SELECT data->>'$.user.email' FROM things WHERE type = 'customer'"
    const ast = parseSQL(sql)
    const result = validateThingsQuery(ast)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should warn about non-things table', () => {
    const sql = 'SELECT * FROM users'
    const ast = parseSQL(sql)
    const result = validateThingsQuery(ast)

    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('users')
  })

  it('should validate vector function arguments', () => {
    const sql = 'SELECT cosineDistance(embedding, [0.1, 0.2]) FROM things'
    const ast = parseSQL(sql)
    const result = validateThingsQuery(ast)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

// ============================================================================
// Integration Tests - Full Query Parsing
// ============================================================================

describe('Integration Tests', () => {
  it('should parse Things query with JSON path extraction', () => {
    const sql = "SELECT data->>'$.user.email' FROM things WHERE type = 'customer'"
    const ast = parseSQL(sql)

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode

    // Verify structure
    expect(select.columns[0].type).toBe('JSONPath')
    expect(select.from?.table).toBe('things')
    expect(select.where?.type).toBe('BinaryOp')
  })

  it('should parse vector similarity search query', () => {
    const sql = 'SELECT cosineDistance(embedding, [0.1, 0.2]) FROM things ORDER BY 1 LIMIT 10'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode

    // Verify function call
    const func = select.columns[0] as FunctionCallNode
    expect(func.name).toBe('cosineDistance')

    // Verify ORDER BY
    expect(select.orderBy).toBeDefined()

    // Verify LIMIT
    expect(select.limit?.value).toBe(10)
  })

  it('should parse CREATE TABLE with IcebergMergeTree engine', () => {
    const sql = 'CREATE TABLE things (id String, type String, data JSON) ENGINE = IcebergMergeTree()'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('CreateTable')
    const create = ast as CreateTableNode

    expect(create.engine?.name).toBe('IcebergMergeTree')
    expect(create.columns.map((c) => c.name)).toEqual(['id', 'type', 'data'])
  })

  it('should format AST for debugging', () => {
    const sql = "SELECT data->>'$.user.email' FROM things WHERE type = 'customer'"
    const ast = parseSQL(sql)
    const formatted = formatAST(ast)

    expect(formatted).toContain('SELECT')
    expect(formatted).toContain('FROM: things')
    expect(formatted).toContain('WHERE')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty array literals', () => {
    const sql = 'SELECT [] AS empty_array'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    const alias = select.columns[0] as AliasNode
    const array = alias.expression as ArrayLiteralNode
    expect(array.elements).toHaveLength(0)
  })

  it('should handle negative numbers in expressions', () => {
    const sql = 'SELECT price - 10 AS discounted FROM products'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    const alias = select.columns[0] as AliasNode
    expect(alias.expression.type).toBe('BinaryOp')
  })

  it('should handle multiple JSON path accesses', () => {
    const sql = "SELECT data->>'$.a', data->>'$.b' FROM things"
    const ast = parseSQL(sql)

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    expect(select.columns).toHaveLength(2)
    expect(select.columns[0].type).toBe('JSONPath')
    expect(select.columns[1].type).toBe('JSONPath')
  })

  it('should handle quoted identifiers in various positions', () => {
    const sql = 'SELECT "column with spaces" FROM "table name"'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    expect((select.columns[0] as IdentifierNode).quoted).toBe(true)
  })

  it('should parse boolean literals', () => {
    const sql = 'SELECT true AS is_true, false AS is_false'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode

    const trueAlias = select.columns[0] as AliasNode
    expect((trueAlias.expression as LiteralNode).value).toBe(true)

    const falseAlias = select.columns[1] as AliasNode
    expect((falseAlias.expression as LiteralNode).value).toBe(false)
  })

  it('should parse NULL literal', () => {
    const sql = 'SELECT null AS nothing'
    const ast = parseSQL(sql)

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    const alias = select.columns[0] as AliasNode
    expect((alias.expression as LiteralNode).value).toBe(null)
  })

  it('should handle concatenation operator', () => {
    const sql = "SELECT first_name || ' ' || last_name AS full_name FROM users"
    const ast = parseSQL(sql)

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    const alias = select.columns[0] as AliasNode
    expect(alias.expression.type).toBe('BinaryOp')
  })
})
