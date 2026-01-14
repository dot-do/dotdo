/**
 * ClickHouse SQL Parser Tests
 *
 * Tests for parsing Things/Relationships queries with:
 * - JSON path extraction (->>, ->)
 * - Vector functions (cosineDistance, etc.)
 * - Full-text search (hasToken)
 * - CREATE TABLE with ENGINE clause
 * - INSERT with JSON casts
 */

import { describe, it, expect } from 'vitest'
import {
  parse,
  tokenize,
  TokenType,
  formatAST,
  validateThingsQuery,
  findFunctionCalls,
  findJSONPaths,
  hasVectorFunctions,
  hasFullTextSearch,
  type SelectQueryNode,
  type CreateTableNode,
  type InsertNode,
  type FunctionCallNode,
  type JSONPathNode,
  type JSONCastNode,
  type BinaryOpNode,
  type LiteralNode,
  type IdentifierNode,
  type ArrayLiteralNode,
  type AliasNode,
} from './index'

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
      const tokens = tokenize('value::JSON')
      const significant = tokens.filter(
        (t) => t.type !== TokenType.Whitespace && t.type !== TokenType.EndOfStream
      )

      expect(significant).toHaveLength(3)
      expect(significant[0]).toMatchObject({ type: TokenType.BareWord, value: 'value' })
      expect(significant[1]).toMatchObject({ type: TokenType.DoubleColon, value: '::' })
      expect(significant[2]).toMatchObject({ type: TokenType.BareWord, value: 'JSON' })
    })
  })
})

// ============================================================================
// RED Tests from Issue dotdo-62azr
// ============================================================================

describe('ClickHouse SQL Parser - RED Tests', () => {
  it('parses SELECT with JSON path extraction', () => {
    const ast = parse("SELECT data->>'$.user.email' FROM things")

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode

    expect(select.columns).toHaveLength(1)
    expect(select.columns[0].type).toBe('JSONPath')

    const jsonPath = select.columns[0] as JSONPathNode
    expect(jsonPath.extractText).toBe(true) // ->> extracts text
    expect(jsonPath.path).toContain('$.user.email')
  })

  it('parses WHERE with JSON conditions', () => {
    const ast = parse("SELECT * FROM things WHERE data->>'$.status' = 'active'")

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode

    expect(select.where).toBeDefined()
    expect(select.where?.type).toBe('BinaryOp')

    const where = select.where as BinaryOpNode
    expect(where.left.type).toBe('JSONPath')

    const jsonPath = where.left as JSONPathNode
    expect(jsonPath.extractText).toBe(true)
  })

  it('parses cosineDistance for vector search', () => {
    const ast = parse('SELECT cosineDistance(embedding, [0.1, 0.2]) FROM things')

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode

    expect(select.columns).toHaveLength(1)
    expect(select.columns[0].type).toBe('FunctionCall')

    const func = select.columns[0] as FunctionCallNode
    expect(func.name).toBe('cosineDistance')
    expect(func.args).toHaveLength(2)
    expect(func.args[1].type).toBe('ArrayLiteral')
  })

  it('parses hasToken for full-text search', () => {
    const ast = parse("SELECT * FROM things WHERE hasToken(data->>'$.content', 'search term')")

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode

    expect(select.where).toBeDefined()
    expect(select.where?.type).toBe('FunctionCall')

    const func = select.where as FunctionCallNode
    expect(func.name).toBe('hasToken')
    expect(func.args).toHaveLength(2)

    // First arg should be a JSON path
    expect(func.args[0].type).toBe('JSONPath')
  })

  it('parses CREATE TABLE with Things schema', () => {
    const ast = parse(`
      CREATE TABLE things (
        id String,
        type String,
        data JSON,
        embedding Array(Float32)
      ) ENGINE = IcebergMergeTree()
    `)

    expect(ast.type).toBe('CreateTable')
    const create = ast as CreateTableNode

    expect(create.table.table).toBe('things')
    expect(create.columns).toHaveLength(4)
    expect(create.columns[0]).toMatchObject({ name: 'id', dataType: 'String' })
    expect(create.columns[1]).toMatchObject({ name: 'type', dataType: 'String' })
    expect(create.columns[2]).toMatchObject({ name: 'data', dataType: 'JSON' })
    expect(create.columns[3]).toMatchObject({ name: 'embedding', dataType: 'Array(Float32)' })

    expect(create.engine?.name).toBe('IcebergMergeTree')
  })

  it('parses INSERT with JSON data', () => {
    const ast = parse(`
      INSERT INTO things (type, data)
      VALUES ('event', '{"user": "alice"}'::JSON)
    `)

    expect(ast.type).toBe('Insert')
    const insert = ast as InsertNode

    expect(insert.table.table).toBe('things')
    expect(insert.columns).toEqual(['type', 'data'])
    expect(insert.values).toHaveLength(1)
    expect(insert.values[0]).toHaveLength(2)

    // Second value should be a JSON cast
    const jsonValue = insert.values[0][1] as JSONCastNode
    expect(jsonValue.type).toBe('JSONCast')
    expect(jsonValue.targetType).toBe('JSON')
  })
})

// ============================================================================
// Additional Parser Tests
// ============================================================================

describe('Parser - SELECT Queries', () => {
  it('should parse SELECT *', () => {
    const ast = parse('SELECT * FROM things')

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    expect(select.columns).toHaveLength(1)
    expect(select.columns[0].type).toBe('Star')
    expect(select.from?.table).toBe('things')
  })

  it('should parse SELECT with multiple columns', () => {
    const ast = parse('SELECT id, type, data FROM things')

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    expect(select.columns).toHaveLength(3)
  })

  it('should parse SELECT DISTINCT', () => {
    const ast = parse('SELECT DISTINCT type FROM things')

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    expect(select.distinct).toBe(true)
  })

  it('should parse SELECT with ORDER BY', () => {
    const ast = parse('SELECT * FROM things ORDER BY created_at DESC')

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    expect(select.orderBy).toHaveLength(1)
    expect(select.orderBy![0].direction).toBe('DESC')
  })

  it('should parse SELECT with LIMIT', () => {
    const ast = parse('SELECT * FROM things LIMIT 10')

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    expect(select.limit?.value).toBe(10)
  })

  it('should parse SELECT with aliases', () => {
    const ast = parse('SELECT id AS thing_id, type thing_type FROM things')

    expect(ast.type).toBe('SelectQuery')
    const select = ast as SelectQueryNode
    expect(select.columns).toHaveLength(2)

    const alias1 = select.columns[0] as AliasNode
    expect(alias1.alias).toBe('thing_id')

    const alias2 = select.columns[1] as AliasNode
    expect(alias2.alias).toBe('thing_type')
  })
})

describe('Parser - JSON Path', () => {
  it('should parse ->> JSON path extraction', () => {
    const ast = parse("SELECT data->>'$.user.email' FROM things")
    const select = ast as SelectQueryNode

    const jsonPath = select.columns[0] as JSONPathNode
    expect(jsonPath.extractText).toBe(true)
  })

  it('should parse -> JSON path extraction', () => {
    const ast = parse("SELECT data->'$.nested.object' FROM things")
    const select = ast as SelectQueryNode

    const jsonPath = select.columns[0] as JSONPathNode
    expect(jsonPath.extractText).toBe(false)
  })

  it('should parse multiple JSON path accesses', () => {
    const ast = parse("SELECT data->>'$.a', data->>'$.b' FROM things")
    const select = ast as SelectQueryNode

    expect(select.columns).toHaveLength(2)
    expect(select.columns[0].type).toBe('JSONPath')
    expect(select.columns[1].type).toBe('JSONPath')
  })
})

describe('Parser - Vector Functions', () => {
  it('should parse cosineDistance function', () => {
    const ast = parse('SELECT cosineDistance(embedding, [0.1, 0.2]) FROM things ORDER BY 1 LIMIT 10')
    const select = ast as SelectQueryNode

    const func = select.columns[0] as FunctionCallNode
    expect(func.name).toBe('cosineDistance')
    expect(func.args).toHaveLength(2)

    const array = func.args[1] as ArrayLiteralNode
    expect(array.elements).toHaveLength(2)
    expect((array.elements[0] as LiteralNode).value).toBe(0.1)
    expect((array.elements[1] as LiteralNode).value).toBe(0.2)
  })

  it('should parse L2Distance function', () => {
    const ast = parse('SELECT L2Distance(vec1, vec2) AS distance FROM vectors')
    const select = ast as SelectQueryNode

    const alias = select.columns[0] as AliasNode
    const func = alias.expression as FunctionCallNode
    expect(func.name).toBe('L2Distance')
  })

  it('should parse vector array literals', () => {
    const ast = parse('SELECT [0.1, 0.2, 0.3, 0.4, 0.5] AS embedding')
    const select = ast as SelectQueryNode

    const alias = select.columns[0] as AliasNode
    const array = alias.expression as ArrayLiteralNode
    expect(array.elements).toHaveLength(5)
  })
})

describe('Parser - INSERT', () => {
  it('should parse INSERT with column list', () => {
    const ast = parse("INSERT INTO things (id, type) VALUES ('123', 'event')")

    expect(ast.type).toBe('Insert')
    const insert = ast as InsertNode

    expect(insert.table.table).toBe('things')
    expect(insert.columns).toEqual(['id', 'type'])
    expect(insert.values).toHaveLength(1)
    expect(insert.values[0]).toHaveLength(2)
  })

  it('should parse INSERT with multiple rows', () => {
    const ast = parse("INSERT INTO things (type) VALUES ('a'), ('b'), ('c')")

    expect(ast.type).toBe('Insert')
    const insert = ast as InsertNode

    expect(insert.values).toHaveLength(3)
  })

  it('should parse INSERT with type cast', () => {
    const ast = parse("INSERT INTO things (data) VALUES ('{}'::JSON)")

    expect(ast.type).toBe('Insert')
    const insert = ast as InsertNode

    const value = insert.values[0][0] as JSONCastNode
    expect(value.type).toBe('JSONCast')
    expect(value.targetType).toBe('JSON')
  })
})

describe('Parser - CREATE TABLE', () => {
  it('should parse CREATE TABLE with ENGINE clause', () => {
    const ast = parse('CREATE TABLE things (id String) ENGINE = IcebergMergeTree()')

    expect(ast.type).toBe('CreateTable')
    const create = ast as CreateTableNode

    expect(create.table.table).toBe('things')
    expect(create.engine?.name).toBe('IcebergMergeTree')
  })

  it('should parse CREATE TABLE IF NOT EXISTS', () => {
    const ast = parse('CREATE TABLE IF NOT EXISTS things (id String) ENGINE = MergeTree()')

    expect(ast.type).toBe('CreateTable')
    const create = ast as CreateTableNode
    expect(create.ifNotExists).toBe(true)
  })

  it('should parse CREATE TABLE with complex column types', () => {
    const ast = parse(
      'CREATE TABLE things (id String, tags Array(String), metadata Nullable(JSON)) ENGINE = ReplacingMergeTree()'
    )

    expect(ast.type).toBe('CreateTable')
    const create = ast as CreateTableNode

    expect(create.columns).toHaveLength(3)
    expect(create.columns[1].dataType).toBe('Array(String)')
    expect(create.columns[2].dataType).toBe('Nullable(JSON)')
  })
})

// ============================================================================
// Validation Tests
// ============================================================================

describe('Validation', () => {
  it('should validate Things query patterns', () => {
    const ast = parse("SELECT data->>'$.user.email' FROM things WHERE type = 'customer'")
    const result = validateThingsQuery(ast)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should warn about non-things table', () => {
    const ast = parse('SELECT * FROM users')
    const result = validateThingsQuery(ast)

    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('users')
  })

  it('should validate vector function arguments', () => {
    const ast = parse('SELECT cosineDistance(embedding, [0.1, 0.2]) FROM things')
    const result = validateThingsQuery(ast)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Utility Functions', () => {
  it('should find all function calls', () => {
    const ast = parse('SELECT cosineDistance(embedding, [0.1, 0.2]), hasToken(content, "test") FROM things')
    const calls = findFunctionCalls(ast)

    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.some((c) => c.name === 'cosineDistance')).toBe(true)
    expect(calls.some((c) => c.name === 'hasToken')).toBe(true)
  })

  it('should find all JSON paths', () => {
    const ast = parse("SELECT data->>'$.a', data->>'$.b' FROM things")
    const paths = findJSONPaths(ast)

    expect(paths).toHaveLength(2)
  })

  it('should detect vector functions', () => {
    const ast1 = parse('SELECT cosineDistance(embedding, [0.1, 0.2]) FROM things')
    expect(hasVectorFunctions(ast1)).toBe(true)

    const ast2 = parse('SELECT * FROM things')
    expect(hasVectorFunctions(ast2)).toBe(false)
  })

  it('should detect full-text search functions', () => {
    const ast1 = parse("SELECT * FROM things WHERE hasToken(content, 'test')")
    expect(hasFullTextSearch(ast1)).toBe(true)

    const ast2 = parse('SELECT * FROM things')
    expect(hasFullTextSearch(ast2)).toBe(false)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty array literals', () => {
    const ast = parse('SELECT [] AS empty_array')
    const select = ast as SelectQueryNode

    const alias = select.columns[0] as AliasNode
    const array = alias.expression as ArrayLiteralNode
    expect(array.elements).toHaveLength(0)
  })

  it('should handle negative numbers in expressions', () => {
    const ast = parse('SELECT price - 10 AS discounted FROM products')
    const select = ast as SelectQueryNode

    const alias = select.columns[0] as AliasNode
    expect(alias.expression.type).toBe('BinaryOp')
  })

  it('should handle boolean literals', () => {
    const ast = parse('SELECT true AS is_true, false AS is_false')
    const select = ast as SelectQueryNode

    const trueAlias = select.columns[0] as AliasNode
    expect((trueAlias.expression as LiteralNode).value).toBe(true)

    const falseAlias = select.columns[1] as AliasNode
    expect((falseAlias.expression as LiteralNode).value).toBe(false)
  })

  it('should handle NULL literal', () => {
    const ast = parse('SELECT null AS nothing')
    const select = ast as SelectQueryNode

    const alias = select.columns[0] as AliasNode
    expect((alias.expression as LiteralNode).value).toBe(null)
  })

  it('should handle concatenation operator', () => {
    const ast = parse("SELECT first_name || ' ' || last_name AS full_name FROM users")
    const select = ast as SelectQueryNode

    const alias = select.columns[0] as AliasNode
    expect(alias.expression.type).toBe('BinaryOp')
  })

  it('should handle AND/OR conditions', () => {
    const ast = parse("SELECT * FROM things WHERE type = 'customer' AND status = 'active'")
    const select = ast as SelectQueryNode

    const where = select.where as BinaryOpNode
    expect(where.op).toBe('AND')
  })

  it('should parse arithmetic expressions', () => {
    const ast = parse('SELECT price * quantity AS total FROM orders')
    const select = ast as SelectQueryNode

    const alias = select.columns[0] as AliasNode
    const expr = alias.expression as BinaryOpNode
    expect(expr.op).toBe('*')
  })
})

// ============================================================================
// Format AST Tests
// ============================================================================

describe('Format AST', () => {
  it('should format SELECT query', () => {
    const ast = parse("SELECT data->>'$.user.email' FROM things WHERE type = 'customer'")
    const formatted = formatAST(ast)

    expect(formatted).toContain('SELECT')
    expect(formatted).toContain('FROM: things')
    expect(formatted).toContain('WHERE')
  })

  it('should format CREATE TABLE', () => {
    const ast = parse('CREATE TABLE things (id String) ENGINE = IcebergMergeTree()')
    const formatted = formatAST(ast)

    expect(formatted).toContain('CREATE TABLE')
    expect(formatted).toContain('things')
    expect(formatted).toContain('ENGINE = IcebergMergeTree')
  })

  it('should format INSERT', () => {
    const ast = parse("INSERT INTO things (type) VALUES ('event')")
    const formatted = formatAST(ast)

    expect(formatted).toContain('INSERT INTO')
    expect(formatted).toContain('things')
    expect(formatted).toContain('columns')
  })
})
