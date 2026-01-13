/**
 * SQL Parser Tests
 *
 * Tests for the proper SQL parser that extracts shard keys from SQL statements.
 * Covers tokenization, parsing, and shard key extraction for various SQL patterns.
 */
import { describe, it, expect } from 'vitest'
import {
  SQLTokenizer,
  SQLParser,
  extractShardKeyParsed,
  parseAndExtractShardKey,
} from './sql-parser'

// ============================================================================
// TOKENIZER TESTS
// ============================================================================

describe('SQLTokenizer', () => {
  describe('basic tokens', () => {
    it('should tokenize keywords', () => {
      const tokenizer = new SQLTokenizer('SELECT FROM WHERE AND OR')
      const tokens = tokenizer.tokenize()

      expect(tokens.map(t => t.type)).toEqual([
        'KEYWORD', 'KEYWORD', 'KEYWORD', 'KEYWORD', 'KEYWORD', 'EOF'
      ])
      expect(tokens.map(t => t.value)).toEqual([
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', ''
      ])
    })

    it('should tokenize identifiers', () => {
      const tokenizer = new SQLTokenizer('users tenant_id myColumn123')
      const tokens = tokenizer.tokenize()

      expect(tokens.filter(t => t.type === 'IDENTIFIER').map(t => t.value)).toEqual([
        'users', 'tenant_id', 'myColumn123'
      ])
    })

    it('should tokenize string literals with single quotes', () => {
      const tokenizer = new SQLTokenizer("'hello' 'world'")
      const tokens = tokenizer.tokenize()

      expect(tokens.filter(t => t.type === 'STRING').map(t => t.value)).toEqual([
        'hello', 'world'
      ])
    })

    it('should tokenize string literals with double quotes', () => {
      const tokenizer = new SQLTokenizer('"hello" "world"')
      const tokens = tokenizer.tokenize()

      expect(tokens.filter(t => t.type === 'STRING').map(t => t.value)).toEqual([
        'hello', 'world'
      ])
    })

    it('should handle escaped quotes in strings', () => {
      const tokenizer = new SQLTokenizer("'it''s escaped' \"he said \"\"hello\"\"\"")
      const tokens = tokenizer.tokenize()

      expect(tokens.filter(t => t.type === 'STRING').map(t => t.value)).toEqual([
        "it's escaped", 'he said "hello"'
      ])
    })

    it('should tokenize numbers', () => {
      const tokenizer = new SQLTokenizer('123 45.67 -89 1.23e10')
      const tokens = tokenizer.tokenize()

      expect(tokens.filter(t => t.type === 'NUMBER').map(t => t.value)).toEqual([
        '123', '45.67', '-89', '1.23e10'
      ])
    })

    it('should tokenize operators', () => {
      const tokenizer = new SQLTokenizer('= != <> < > <= >=')
      const tokens = tokenizer.tokenize()

      expect(tokens.filter(t => t.type === 'OPERATOR').map(t => t.value)).toEqual([
        '=', '!=', '<>', '<', '>', '<=', '>='
      ])
    })

    it('should tokenize punctuation', () => {
      const tokenizer = new SQLTokenizer('( ) , . ; *')
      const tokens = tokenizer.tokenize()

      expect(tokens.map(t => t.type).slice(0, -1)).toEqual([
        'LPAREN', 'RPAREN', 'COMMA', 'DOT', 'SEMICOLON', 'STAR'
      ])
    })

    it('should tokenize parameters', () => {
      const tokenizer = new SQLTokenizer('? :tenant_id :user_id')
      const tokens = tokenizer.tokenize()

      expect(tokens[0]).toMatchObject({ type: 'PARAM', value: '?' })
      expect(tokens[1]).toMatchObject({ type: 'NAMED_PARAM', value: 'tenant_id' })
      expect(tokens[2]).toMatchObject({ type: 'NAMED_PARAM', value: 'user_id' })
    })

    it('should handle backtick-quoted identifiers', () => {
      const tokenizer = new SQLTokenizer('`table-name` `column with spaces`')
      const tokens = tokenizer.tokenize()

      expect(tokens.filter(t => t.type === 'IDENTIFIER').map(t => t.value)).toEqual([
        'table-name', 'column with spaces'
      ])
    })

    it('should handle bracket-quoted identifiers', () => {
      const tokenizer = new SQLTokenizer('[table-name] [column with spaces]')
      const tokens = tokenizer.tokenize()

      expect(tokens.filter(t => t.type === 'IDENTIFIER').map(t => t.value)).toEqual([
        'table-name', 'column with spaces'
      ])
    })
  })

  describe('full SQL statements', () => {
    it('should tokenize SELECT statement', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'abc123'"
      const tokenizer = new SQLTokenizer(sql)
      const tokens = tokenizer.tokenize()

      const types = tokens.map(t => t.type)
      expect(types).toContain('KEYWORD')
      expect(types).toContain('STAR')
      expect(types).toContain('IDENTIFIER')
      expect(types).toContain('OPERATOR')
      expect(types).toContain('STRING')
    })

    it('should tokenize INSERT statement', () => {
      const sql = "INSERT INTO users (id, tenant_id, name) VALUES (1, 'abc', 'John')"
      const tokenizer = new SQLTokenizer(sql)
      const tokens = tokenizer.tokenize()

      const values = tokens.map(t => t.value)
      expect(values).toContain('INSERT')
      expect(values).toContain('INTO')
      expect(values).toContain('VALUES')
    })
  })
})

// ============================================================================
// PARSER TESTS
// ============================================================================

describe('SQLParser', () => {
  describe('parseWhereClause', () => {
    it('should parse simple equality condition', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'abc123'"
      const tokens = new SQLTokenizer(sql).tokenize()
      const parser = new SQLParser(tokens)
      const ast = parser.parseWhereClause()

      expect(ast).toBeDefined()
      expect(ast?.type).toBe('condition')
      if (ast?.type === 'condition') {
        expect(ast.column).toBe('tenant_id')
        expect(ast.operator).toBe('=')
        expect(ast.value).toMatchObject({ type: 'value', valueType: 'string', value: 'abc123' })
      }
    })

    it('should parse AND conditions', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'abc' AND status = 'active'"
      const tokens = new SQLTokenizer(sql).tokenize()
      const parser = new SQLParser(tokens)
      const ast = parser.parseWhereClause()

      expect(ast).toBeDefined()
      expect(ast?.type).toBe('binary_op')
      if (ast?.type === 'binary_op') {
        expect(ast.operator).toBe('AND')
        expect(ast.left.type).toBe('condition')
        expect(ast.right.type).toBe('condition')
      }
    })

    it('should parse OR conditions', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'abc' OR tenant_id = 'xyz'"
      const tokens = new SQLTokenizer(sql).tokenize()
      const parser = new SQLParser(tokens)
      const ast = parser.parseWhereClause()

      expect(ast).toBeDefined()
      expect(ast?.type).toBe('binary_op')
      if (ast?.type === 'binary_op') {
        expect(ast.operator).toBe('OR')
      }
    })

    it('should parse IN clauses', () => {
      const sql = "SELECT * FROM users WHERE tenant_id IN ('a', 'b', 'c')"
      const tokens = new SQLTokenizer(sql).tokenize()
      const parser = new SQLParser(tokens)
      const ast = parser.parseWhereClause()

      expect(ast).toBeDefined()
      expect(ast?.type).toBe('condition')
      if (ast?.type === 'condition') {
        expect(ast.column).toBe('tenant_id')
        expect(ast.operator).toBe('IN')
        expect(ast.value.type).toBe('in_list')
        if (ast.value.type === 'in_list') {
          expect(ast.value.values).toHaveLength(3)
        }
      }
    })

    it('should handle parenthesized expressions', () => {
      const sql = "SELECT * FROM users WHERE (tenant_id = 'abc') AND (status = 'active')"
      const tokens = new SQLTokenizer(sql).tokenize()
      const parser = new SQLParser(tokens)
      const ast = parser.parseWhereClause()

      expect(ast).toBeDefined()
      expect(ast?.type).toBe('binary_op')
    })

    it('should handle table.column notation', () => {
      const sql = "SELECT * FROM users u WHERE u.tenant_id = 'abc'"
      const tokens = new SQLTokenizer(sql).tokenize()
      const parser = new SQLParser(tokens)
      const ast = parser.parseWhereClause()

      expect(ast?.type).toBe('condition')
      if (ast?.type === 'condition') {
        expect(ast.column).toBe('tenant_id')
      }
    })
  })

  describe('parseInsert', () => {
    it('should parse INSERT with column list', () => {
      const sql = "INSERT INTO users (id, tenant_id, name) VALUES (1, 'abc123', 'John')"
      const tokens = new SQLTokenizer(sql).tokenize()
      const parser = new SQLParser(tokens)
      const columnValues = parser.parseInsert()

      expect(columnValues).toBeDefined()
      expect(columnValues?.get('tenant_id')).toMatchObject({
        type: 'value',
        valueType: 'string',
        value: 'abc123'
      })
    })

    it('should parse INSERT with numeric values', () => {
      const sql = "INSERT INTO users (id, tenant_id, age) VALUES (1, 123, 25)"
      const tokens = new SQLTokenizer(sql).tokenize()
      const parser = new SQLParser(tokens)
      const columnValues = parser.parseInsert()

      expect(columnValues?.get('tenant_id')).toMatchObject({
        type: 'value',
        valueType: 'number',
        value: '123'
      })
    })

    it('should parse INSERT with parameters', () => {
      const sql = "INSERT INTO users (id, tenant_id, name) VALUES (?, ?, ?)"
      const tokens = new SQLTokenizer(sql).tokenize()
      const parser = new SQLParser(tokens)
      const columnValues = parser.parseInsert()

      expect(columnValues?.get('tenant_id')).toMatchObject({
        type: 'value',
        valueType: 'param',
        paramIndex: 1
      })
    })
  })
})

// ============================================================================
// SHARD KEY EXTRACTION TESTS
// ============================================================================

describe('extractShardKeyParsed', () => {
  describe('SELECT statements', () => {
    it('should extract from simple WHERE clause', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'abc123'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })

    it('should extract from parameterized query', () => {
      const sql = 'SELECT * FROM users WHERE tenant_id = ?'
      expect(extractShardKeyParsed(sql, 'tenant_id', ['abc123'])).toBe('abc123')
    })

    it('should extract from named parameter', () => {
      const sql = 'SELECT * FROM users WHERE tenant_id = :tenant_id'
      expect(extractShardKeyParsed(sql, 'tenant_id', { tenant_id: 'abc123' })).toBe('abc123')
    })

    it('should extract numeric shard keys', () => {
      const sql = 'SELECT * FROM users WHERE tenant_id = 123'
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('123')
    })

    it('should extract with multiple conditions (AND)', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'abc' AND status = 'active'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
    })

    it('should extract with shard key on right side of AND', () => {
      const sql = "SELECT * FROM users WHERE status = 'active' AND tenant_id = 'abc'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
    })

    it('should handle table.column notation', () => {
      const sql = "SELECT * FROM users u WHERE u.tenant_id = 'abc123'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })

    it('should handle double-quoted strings', () => {
      const sql = 'SELECT * FROM users WHERE tenant_id = "abc123"'
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })

    it('should be case-insensitive for column names', () => {
      const sql = "SELECT * FROM users WHERE TENANT_ID = 'abc123'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })

    it('should handle complex WHERE with multiple ANDs', () => {
      const sql = "SELECT * FROM users WHERE status = 'active' AND tenant_id = 'abc' AND age > 18"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
    })
  })

  describe('IN clauses', () => {
    it('should return undefined for IN clause (multi-shard)', () => {
      const sql = "SELECT * FROM users WHERE tenant_id IN ('a', 'b', 'c')"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBeUndefined()
    })

    it('should return undefined for IN with parameters', () => {
      const sql = 'SELECT * FROM users WHERE tenant_id IN (?, ?, ?)'
      expect(extractShardKeyParsed(sql, 'tenant_id', ['a', 'b', 'c'])).toBeUndefined()
    })
  })

  describe('OR clauses', () => {
    it('should return undefined for OR on shard key (multi-shard)', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'a' OR tenant_id = 'b'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBeUndefined()
    })

    it('should return undefined when OR includes non-shard condition', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'a' OR status = 'deleted'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBeUndefined()
    })
  })

  describe('INSERT statements', () => {
    it('should extract from INSERT with string value', () => {
      const sql = "INSERT INTO users (id, tenant_id, name) VALUES (1, 'abc123', 'John')"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })

    it('should extract from INSERT with numeric value', () => {
      const sql = "INSERT INTO users (id, tenant_id, name) VALUES (1, 123, 'John')"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('123')
    })

    it('should extract from INSERT with parameters', () => {
      const sql = 'INSERT INTO users (id, tenant_id, name) VALUES (?, ?, ?)'
      expect(extractShardKeyParsed(sql, 'tenant_id', [1, 'abc123', 'John'])).toBe('abc123')
    })

    it('should handle INSERT with different column order', () => {
      const sql = "INSERT INTO users (tenant_id, id, name) VALUES ('abc123', 1, 'John')"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })
  })

  describe('UPDATE statements', () => {
    it('should extract from UPDATE WHERE clause', () => {
      const sql = "UPDATE users SET name = 'Jane' WHERE tenant_id = 'abc123'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })

    it('should extract from UPDATE with parameters', () => {
      const sql = 'UPDATE users SET name = ? WHERE tenant_id = ?'
      expect(extractShardKeyParsed(sql, 'tenant_id', ['Jane', 'abc123'])).toBe('abc123')
    })
  })

  describe('DELETE statements', () => {
    it('should extract from DELETE WHERE clause', () => {
      const sql = "DELETE FROM users WHERE tenant_id = 'abc123'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })
  })

  describe('cross-shard queries', () => {
    it('should return undefined when shard key not in query', () => {
      const sql = "SELECT * FROM users WHERE name = 'John'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBeUndefined()
    })

    it('should return undefined for queries without WHERE', () => {
      const sql = 'SELECT * FROM users'
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBeUndefined()
    })

    it('should return undefined for LIKE conditions on shard key', () => {
      const sql = "SELECT * FROM users WHERE tenant_id LIKE 'abc%'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBeUndefined()
    })

    it('should return undefined for range conditions on shard key', () => {
      const sql = "SELECT * FROM users WHERE tenant_id > 'abc'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('should handle empty SQL', () => {
      expect(extractShardKeyParsed('', 'tenant_id')).toBeUndefined()
    })

    it('should handle malformed SQL gracefully', () => {
      expect(extractShardKeyParsed('NOT VALID SQL AT ALL', 'tenant_id')).toBeUndefined()
    })

    it('should handle SQL with special characters in values', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'abc-123_xyz'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc-123_xyz')
    })

    it('should handle values with spaces', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'my tenant id'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('my tenant id')
    })

    it('should handle escaped quotes in values', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = 'it''s escaped'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe("it's escaped")
    })

    it('should handle UUID values', () => {
      const sql = "SELECT * FROM users WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('550e8400-e29b-41d4-a716-446655440000')
    })

    it('should handle multiple positional parameters', () => {
      const sql = 'SELECT * FROM users WHERE id = ? AND tenant_id = ? AND status = ?'
      expect(extractShardKeyParsed(sql, 'tenant_id', [1, 'abc123', 'active'])).toBe('abc123')
    })

    it('should handle backtick-quoted column names', () => {
      const sql = "SELECT * FROM users WHERE `tenant_id` = 'abc123'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })

    it('should handle bracket-quoted column names', () => {
      const sql = "SELECT * FROM users WHERE [tenant_id] = 'abc123'"
      expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc123')
    })

    it('should handle floating point numbers', () => {
      const sql = 'SELECT * FROM data WHERE shard_key = 3.14159'
      expect(extractShardKeyParsed(sql, 'shard_key')).toBe('3.14159')
    })

    it('should handle negative numbers', () => {
      const sql = 'SELECT * FROM data WHERE shard_key = -42'
      expect(extractShardKeyParsed(sql, 'shard_key')).toBe('-42')
    })

    it('should handle scientific notation', () => {
      const sql = 'SELECT * FROM data WHERE shard_key = 1.5e10'
      expect(extractShardKeyParsed(sql, 'shard_key')).toBe('1.5e10')
    })
  })
})

// ============================================================================
// parseAndExtractShardKey TESTS
// ============================================================================

describe('parseAndExtractShardKey', () => {
  it('should return detailed result for single value', () => {
    const sql = "SELECT * FROM users WHERE tenant_id = 'abc'"
    const result = parseAndExtractShardKey(sql, 'tenant_id')

    expect(result).toEqual({
      value: 'abc',
      isCrossShard: false,
    })
  })

  it('should return values array for IN clause', () => {
    const sql = "SELECT * FROM users WHERE tenant_id IN ('a', 'b', 'c')"
    const result = parseAndExtractShardKey(sql, 'tenant_id')

    expect(result.isCrossShard).toBe(false)
    expect(result.values).toEqual(['a', 'b', 'c'])
  })

  it('should return values array for OR conditions', () => {
    const sql = "SELECT * FROM users WHERE tenant_id = 'a' OR tenant_id = 'b'"
    const result = parseAndExtractShardKey(sql, 'tenant_id')

    expect(result.isCrossShard).toBe(false)
    expect(result.values).toEqual(['a', 'b'])
  })

  it('should mark cross-shard when no shard key found', () => {
    const sql = "SELECT * FROM users WHERE name = 'John'"
    const result = parseAndExtractShardKey(sql, 'tenant_id')

    expect(result.isCrossShard).toBe(true)
    expect(result.value).toBeUndefined()
    expect(result.values).toBeUndefined()
  })

  it('should mark cross-shard when OR includes non-shard condition', () => {
    const sql = "SELECT * FROM users WHERE tenant_id = 'a' OR name = 'John'"
    const result = parseAndExtractShardKey(sql, 'tenant_id')

    expect(result.isCrossShard).toBe(true)
  })
})

// ============================================================================
// COMPARISON WITH REGEX IMPLEMENTATION
// ============================================================================

describe('parser vs regex comparison', () => {
  // These tests verify the parser handles cases that regex struggles with

  it('should handle nested parentheses correctly', () => {
    const sql = "SELECT * FROM users WHERE ((tenant_id = 'abc') AND (status = 'active'))"
    expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
  })

  it('should handle complex boolean expressions', () => {
    const sql = "SELECT * FROM users WHERE (tenant_id = 'abc' AND active = true) OR (tenant_id = 'abc' AND deleted = false)"
    // Both branches have same tenant_id, but OR makes it ambiguous
    // The parser should handle this - returning undefined as it's same value in OR
    const result = parseAndExtractShardKey(sql, 'tenant_id')
    // Both OR branches have same tenant_id = 'abc', so we can optimize to single shard
    expect(result.value || result.values?.[0]).toBe('abc')
  })

  it('should not be fooled by shard key in string values', () => {
    const sql = "SELECT * FROM users WHERE comment = 'tenant_id = xyz' AND tenant_id = 'abc'"
    expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
  })

  it('should handle shard key appearing multiple times', () => {
    const sql = "SELECT tenant_id FROM users WHERE tenant_id = 'abc' ORDER BY tenant_id"
    expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
  })

  it('should correctly identify parameter positions', () => {
    const sql = 'SELECT * FROM users WHERE a = ? AND b = ? AND tenant_id = ? AND d = ?'
    expect(extractShardKeyParsed(sql, 'tenant_id', ['val_a', 'val_b', 'abc123', 'val_d'])).toBe('abc123')
  })

  it('should handle subqueries (not extracting from inner query)', () => {
    const sql = "SELECT * FROM users WHERE tenant_id = 'abc' AND id IN (SELECT user_id FROM orders WHERE tenant_id = 'xyz')"
    // Should extract from outer WHERE, not inner
    expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
  })

  it('should handle BETWEEN clauses gracefully', () => {
    const sql = "SELECT * FROM users WHERE tenant_id = 'abc' AND age BETWEEN 18 AND 65"
    expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
  })

  it('should handle IS NULL conditions', () => {
    const sql = "SELECT * FROM users WHERE tenant_id = 'abc' AND deleted_at IS NULL"
    expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
  })

  it('should handle IS NOT NULL conditions', () => {
    const sql = "SELECT * FROM users WHERE tenant_id = 'abc' AND email IS NOT NULL"
    expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
  })

  it('should handle NOT conditions', () => {
    const sql = "SELECT * FROM users WHERE tenant_id = 'abc' AND NOT deleted"
    expect(extractShardKeyParsed(sql, 'tenant_id')).toBe('abc')
  })
})
