/**
 * EdgeQL Parser Prototype Tests
 *
 * Tests for the hand-rolled recursive descent parser prototype.
 *
 * @see dotdo-56wx9 - SPIKE: EdgeQL Parser Approach Evaluation
 */

import { describe, it, expect } from 'vitest'
import { parse, tokenize, compileToSQL, type SelectStatement, type InsertStatement } from './edgeql-parser'

describe('EdgeQL Parser Prototype', () => {
  describe('Tokenizer', () => {
    it('tokenizes simple select', () => {
      const tokens = tokenize('select User { name }')

      expect(tokens.map((t) => t.type)).toEqual([
        'SELECT',
        'IDENTIFIER',
        'LBRACE',
        'IDENTIFIER',
        'RBRACE',
        'EOF',
      ])
    })

    it('tokenizes string literals', () => {
      const tokens = tokenize("insert User { name := 'Alice' }")

      expect(tokens.map((t) => t.type)).toEqual([
        'INSERT',
        'IDENTIFIER',
        'LBRACE',
        'IDENTIFIER',
        'ASSIGN',
        'STRING',
        'RBRACE',
        'EOF',
      ])

      expect(tokens[5].value).toBe('Alice')
    })

    it('tokenizes filter with path expression', () => {
      const tokens = tokenize('select User { name } filter .active = true')

      expect(tokens.map((t) => t.type)).toEqual([
        'SELECT',
        'IDENTIFIER',
        'LBRACE',
        'IDENTIFIER',
        'RBRACE',
        'FILTER',
        'DOT',
        'IDENTIFIER',
        'EQUALS',
        'TRUE',
        'EOF',
      ])
    })

    it('tokenizes nested shape', () => {
      const tokens = tokenize('select User { name, posts: { title } }')

      expect(tokens.map((t) => t.type)).toEqual([
        'SELECT',
        'IDENTIFIER',
        'LBRACE',
        'IDENTIFIER',
        'COMMA',
        'IDENTIFIER',
        'COLON',
        'LBRACE',
        'IDENTIFIER',
        'RBRACE',
        'RBRACE',
        'EOF',
      ])
    })

    it('reports line and column for errors', () => {
      expect(() => tokenize('select @invalid')).toThrow(/Unexpected character '@' at line 1/)
    })

    it('handles escape sequences in strings', () => {
      const tokens = tokenize("'hello\\nworld'")
      expect(tokens[0].value).toBe('hello\nworld')
    })
  })

  describe('Parser - SELECT statements', () => {
    it('parses simple select', () => {
      const ast = parse('select User { name }')

      expect(ast.type).toBe('SelectStatement')

      const select = ast as SelectStatement
      expect(select.target).toBe('User')
      expect(select.shape.fields).toHaveLength(1)
      expect(select.shape.fields[0].name).toBe('name')
    })

    it('parses select with multiple fields', () => {
      const ast = parse('select User { id, name, email }') as SelectStatement

      expect(ast.shape.fields).toHaveLength(3)
      expect(ast.shape.fields.map((f) => f.name)).toEqual(['id', 'name', 'email'])
    })

    it('parses select with nested shape', () => {
      const ast = parse('select User { name, posts: { title } }') as SelectStatement

      expect(ast.shape.fields).toHaveLength(2)
      expect(ast.shape.fields[0].name).toBe('name')

      const postsField = ast.shape.fields[1]
      expect(postsField.name).toBe('posts')
      expect(postsField.shape).toBeDefined()
      expect(postsField.shape?.fields[0].name).toBe('title')
    })

    it('parses select with filter', () => {
      const ast = parse('select User { name } filter .active = true') as SelectStatement

      expect(ast.filter).toBeDefined()
      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })

    it('parses deeply nested shapes', () => {
      const ast = parse(
        'select User { name, posts: { title, comments: { text } } }'
      ) as SelectStatement

      expect(ast.shape.fields).toHaveLength(2)

      const postsField = ast.shape.fields[1]
      expect(postsField.shape?.fields).toHaveLength(2)

      const commentsField = postsField.shape?.fields[1]
      expect(commentsField?.name).toBe('comments')
      expect(commentsField?.shape?.fields[0].name).toBe('text')
    })
  })

  describe('Parser - INSERT statements', () => {
    it('parses simple insert', () => {
      const ast = parse("insert User { name := 'Alice' }") as InsertStatement

      expect(ast.type).toBe('InsertStatement')
      expect(ast.target).toBe('User')
      expect(ast.data.assignments).toHaveLength(1)
      expect(ast.data.assignments[0].name).toBe('name')
      expect(ast.data.assignments[0].value).toEqual({
        type: 'StringLiteral',
        value: 'Alice',
      })
    })

    it('parses insert with multiple fields', () => {
      const ast = parse(
        "insert User { name := 'Alice', age := 30, active := true }"
      ) as InsertStatement

      expect(ast.data.assignments).toHaveLength(3)
      expect(ast.data.assignments[0].name).toBe('name')
      expect(ast.data.assignments[1].name).toBe('age')
      expect(ast.data.assignments[1].value).toEqual({
        type: 'NumberLiteral',
        value: 30,
      })
      expect(ast.data.assignments[2].value).toEqual({
        type: 'BooleanLiteral',
        value: true,
      })
    })
  })

  describe('SQL Compilation', () => {
    it('compiles simple select to SQL', () => {
      const ast = parse('select User { name }')
      const sql = compileToSQL(ast)

      expect(sql).toBe('SELECT name FROM user')
    })

    it('compiles select with filter to SQL', () => {
      const ast = parse('select User { name } filter .active = true')
      const sql = compileToSQL(ast)

      expect(sql).toBe('SELECT name FROM user WHERE active = 1')
    })

    it('compiles insert to SQL', () => {
      const ast = parse("insert User { name := 'Alice' }")
      const sql = compileToSQL(ast)

      expect(sql).toBe("INSERT INTO user (name) VALUES ('Alice')")
    })

    it('compiles insert with multiple fields', () => {
      const ast = parse("insert User { name := 'Alice', age := 30 }")
      const sql = compileToSQL(ast)

      expect(sql).toBe("INSERT INTO user (name, age) VALUES ('Alice', 30)")
    })

    it('escapes single quotes in strings', () => {
      // EdgeQL uses backslash escaping, SQL output uses ''
      const ast = parse("insert User { name := 'O\\'Brien' }")
      const sql = compileToSQL(ast)

      expect(sql).toBe("INSERT INTO user (name) VALUES ('O''Brien')")
    })
  })

  describe('Error Handling', () => {
    it('throws on unexpected token', () => {
      expect(() => parse('select')).toThrow(/Expected IDENTIFIER/)
    })

    it('throws on missing brace', () => {
      expect(() => parse('select User { name')).toThrow(/Expected RBRACE/)
    })

    it('throws on invalid assignment syntax', () => {
      expect(() => parse('insert User { name = "Alice" }')).toThrow()
    })

    it('provides line/column in error messages', () => {
      expect(() =>
        parse(`select User {
  name,
  @invalid
}`)
      ).toThrow(/line/)
    })
  })

  describe('Edge Cases', () => {
    it('handles trailing commas in shapes', () => {
      // This should work - trailing comma is ignored
      const ast = parse('select User { name, }') as SelectStatement
      expect(ast.shape.fields).toHaveLength(1)
    })

    it('handles whitespace variations', () => {
      const ast1 = parse('select User{name}') as SelectStatement
      const ast2 = parse('select  User  {  name  }') as SelectStatement

      expect(ast1.shape.fields[0].name).toBe(ast2.shape.fields[0].name)
    })

    it('handles numeric field values', () => {
      const ast = parse('select User { name } filter .id = 42') as SelectStatement

      expect(ast.filter?.condition.type).toBe('BinaryExpression')
    })
  })
})
