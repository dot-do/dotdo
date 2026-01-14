/**
 * RED Phase: Common Parser Primitives Tests
 *
 * Tests for shared parsing infrastructure used by SQL and Mongo parsers.
 * Extracts common tokenization and AST building patterns.
 *
 * @see dotdo-v8r9e
 */

import { describe, it, expect } from 'vitest'

import {
  // Tokenizer primitives
  Tokenizer,
  TokenType,
  Token,
  TokenizerError,

  // Value parsing
  parseStringLiteral,
  parseNumericLiteral,
  parseBooleanLiteral,

  // AST builders
  ASTBuilder,

  // Parse error
  ParseError,
} from '../parsers/common'

describe('Parser Primitives', () => {
  describe('Tokenizer', () => {
    describe('whitespace handling', () => {
      it('should skip whitespace between tokens', () => {
        const tokenizer = new Tokenizer('  hello   world  ')
        const tokens = tokenizer.tokenizeAll()

        const identifiers = tokens.filter((t) => t.type === TokenType.IDENTIFIER)
        expect(identifiers).toHaveLength(2)
        expect(identifiers[0]!.value).toBe('hello')
        expect(identifiers[1]!.value).toBe('world')
      })

      it('should handle tabs and newlines as whitespace', () => {
        const tokenizer = new Tokenizer('a\t\nb')
        const tokens = tokenizer.tokenizeAll()

        const identifiers = tokens.filter((t) => t.type === TokenType.IDENTIFIER)
        expect(identifiers).toHaveLength(2)
      })

      it('should track position across whitespace', () => {
        const tokenizer = new Tokenizer('  hello')
        const tokens = tokenizer.tokenizeAll()

        const hello = tokens.find((t) => t.value === 'hello')
        expect(hello?.position).toBe(2)
      })
    })

    describe('string literals', () => {
      it('should tokenize single-quoted strings', () => {
        const tokenizer = new Tokenizer("'hello world'")
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.STRING)
        expect(tokens[0]!.value).toBe('hello world')
      })

      it('should tokenize double-quoted strings', () => {
        const tokenizer = new Tokenizer('"hello world"')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.STRING)
        expect(tokens[0]!.value).toBe('hello world')
      })

      it('should handle escaped quotes in strings', () => {
        const tokenizer = new Tokenizer("'it''s a test'")
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.value).toBe("it's a test")
      })

      it('should handle backslash escapes in strings', () => {
        const tokenizer = new Tokenizer('"line1\\nline2"')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.value).toBe('line1\nline2')
      })

      it('should throw on unclosed string literal', () => {
        const tokenizer = new Tokenizer("'unclosed")

        expect(() => tokenizer.tokenizeAll()).toThrow(TokenizerError)
      })

      it('should track position for string errors', () => {
        const tokenizer = new Tokenizer("valid 'unclosed")

        try {
          tokenizer.tokenizeAll()
          expect.fail('Should have thrown')
        } catch (e) {
          expect((e as TokenizerError).position).toBe(6)
        }
      })
    })

    describe('numeric literals', () => {
      it('should tokenize integers', () => {
        const tokenizer = new Tokenizer('42')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.NUMBER)
        expect(tokens[0]!.value).toBe('42')
      })

      it('should tokenize decimals', () => {
        const tokenizer = new Tokenizer('3.14')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.NUMBER)
        expect(tokens[0]!.value).toBe('3.14')
      })

      it('should tokenize negative numbers', () => {
        const tokenizer = new Tokenizer('-42')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.NUMBER)
        expect(tokens[0]!.value).toBe('-42')
      })

      it('should tokenize scientific notation', () => {
        const tokenizer = new Tokenizer('1.5e10')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.NUMBER)
        expect(tokens[0]!.value).toBe('1.5e10')
      })

      it('should tokenize negative exponents', () => {
        const tokenizer = new Tokenizer('1e-5')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.NUMBER)
        expect(tokens[0]!.value).toBe('1e-5')
      })

      it('should handle numbers starting with decimal point', () => {
        const tokenizer = new Tokenizer('.5')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.NUMBER)
        expect(tokens[0]!.value).toBe('.5')
      })
    })

    describe('identifiers', () => {
      it('should tokenize simple identifiers', () => {
        const tokenizer = new Tokenizer('name')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.IDENTIFIER)
        expect(tokens[0]!.value).toBe('name')
      })

      it('should tokenize identifiers with underscores', () => {
        const tokenizer = new Tokenizer('user_name')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.value).toBe('user_name')
      })

      it('should tokenize identifiers starting with underscore', () => {
        const tokenizer = new Tokenizer('_private')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.value).toBe('_private')
      })

      it('should tokenize identifiers with numbers', () => {
        const tokenizer = new Tokenizer('field123')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.value).toBe('field123')
      })

      it('should not start identifier with number', () => {
        const tokenizer = new Tokenizer('123field')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.NUMBER)
        expect(tokens[1]!.type).toBe(TokenType.IDENTIFIER)
      })

      it('should preserve case in identifiers', () => {
        const tokenizer = new Tokenizer('UserName')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.value).toBe('UserName')
      })
    })

    describe('operators', () => {
      it('should tokenize comparison operators', () => {
        const operators = ['=', '!=', '<>', '>', '>=', '<', '<=']

        for (const op of operators) {
          const tokenizer = new Tokenizer(op)
          const tokens = tokenizer.tokenizeAll()

          expect(tokens[0]!.type).toBe(TokenType.OPERATOR)
          expect(tokens[0]!.value).toBe(op)
        }
      })

      it('should tokenize arithmetic operators', () => {
        const operators = ['+', '-', '*', '/']

        for (const op of operators) {
          const tokenizer = new Tokenizer(`a ${op} b`)
          const tokens = tokenizer.tokenizeAll()

          const opToken = tokens.find((t) => t.type === TokenType.OPERATOR)
          expect(opToken?.value).toBe(op)
        }
      })

      it('should distinguish minus from negative number', () => {
        // After identifier, minus is operator
        const tokenizer1 = new Tokenizer('a - 5')
        const tokens1 = tokenizer1.tokenizeAll()
        expect(tokens1[1]!.type).toBe(TokenType.OPERATOR)
        expect(tokens1[2]!.type).toBe(TokenType.NUMBER)
        expect(tokens1[2]!.value).toBe('5')

        // At start, minus with number is negative number
        const tokenizer2 = new Tokenizer('-5')
        const tokens2 = tokenizer2.tokenizeAll()
        expect(tokens2[0]!.type).toBe(TokenType.NUMBER)
        expect(tokens2[0]!.value).toBe('-5')
      })
    })

    describe('delimiters', () => {
      it('should tokenize parentheses', () => {
        const tokenizer = new Tokenizer('(a)')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.LPAREN)
        expect(tokens[2]!.type).toBe(TokenType.RPAREN)
      })

      it('should tokenize commas', () => {
        const tokenizer = new Tokenizer('a, b, c')
        const tokens = tokenizer.tokenizeAll()

        const commas = tokens.filter((t) => t.type === TokenType.COMMA)
        expect(commas).toHaveLength(2)
      })

      it('should tokenize dots', () => {
        const tokenizer = new Tokenizer('a.b.c')
        const tokens = tokenizer.tokenizeAll()

        const dots = tokens.filter((t) => t.type === TokenType.DOT)
        expect(dots).toHaveLength(2)
      })

      it('should tokenize brackets', () => {
        const tokenizer = new Tokenizer('[a]')
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.LBRACKET)
        expect(tokens[2]!.type).toBe(TokenType.RBRACKET)
      })
    })

    describe('keywords', () => {
      it('should recognize SQL keywords as KEYWORD type', () => {
        const tokenizer = new Tokenizer('SELECT FROM WHERE', {
          keywords: new Set(['SELECT', 'FROM', 'WHERE']),
        })
        const tokens = tokenizer.tokenizeAll()

        expect(tokens.every((t) => t.type === TokenType.KEYWORD || t.type === TokenType.EOF)).toBe(
          true
        )
      })

      it('should be case-insensitive for keywords', () => {
        const tokenizer = new Tokenizer('select SELECT Select', {
          keywords: new Set(['SELECT']),
        })
        const tokens = tokenizer.tokenizeAll()

        const keywords = tokens.filter((t) => t.type === TokenType.KEYWORD)
        expect(keywords).toHaveLength(3)
        // Original case should be preserved
        expect(keywords[0]!.value).toBe('SELECT')
        expect(keywords[1]!.value).toBe('SELECT')
        expect(keywords[2]!.value).toBe('SELECT')
      })

      it('should distinguish keywords from similar identifiers', () => {
        const tokenizer = new Tokenizer('SELECT selection', {
          keywords: new Set(['SELECT']),
        })
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.type).toBe(TokenType.KEYWORD)
        expect(tokens[1]!.type).toBe(TokenType.IDENTIFIER)
      })
    })

    describe('comments', () => {
      it('should skip single-line comments', () => {
        const tokenizer = new Tokenizer('a -- comment\nb')
        const tokens = tokenizer.tokenizeAll()

        const identifiers = tokens.filter((t) => t.type === TokenType.IDENTIFIER)
        expect(identifiers).toHaveLength(2)
      })

      it('should skip multi-line comments', () => {
        const tokenizer = new Tokenizer('a /* comment\nspanning\nlines */ b')
        const tokens = tokenizer.tokenizeAll()

        const identifiers = tokens.filter((t) => t.type === TokenType.IDENTIFIER)
        expect(identifiers).toHaveLength(2)
      })

      it('should handle unclosed multi-line comment', () => {
        const tokenizer = new Tokenizer('a /* unclosed')

        expect(() => tokenizer.tokenizeAll()).toThrow(TokenizerError)
      })
    })

    describe('position tracking', () => {
      it('should track line and column for tokens', () => {
        const tokenizer = new Tokenizer('a\nb\nc', { trackLineColumn: true })
        const tokens = tokenizer.tokenizeAll()

        const identifiers = tokens.filter((t) => t.type === TokenType.IDENTIFIER)
        expect(identifiers[0]!.line).toBe(1)
        expect(identifiers[0]!.column).toBe(1)
        expect(identifiers[1]!.line).toBe(2)
        expect(identifiers[1]!.column).toBe(1)
        expect(identifiers[2]!.line).toBe(3)
        expect(identifiers[2]!.column).toBe(1)
      })

      it('should track position accurately with mixed content', () => {
        const tokenizer = new Tokenizer('a = 1', { trackLineColumn: true })
        const tokens = tokenizer.tokenizeAll()

        expect(tokens[0]!.position).toBe(0) // a
        expect(tokens[1]!.position).toBe(2) // =
        expect(tokens[2]!.position).toBe(4) // 1
      })
    })
  })

  describe('Value Parsing', () => {
    describe('parseStringLiteral', () => {
      it('should parse simple strings', () => {
        expect(parseStringLiteral('hello')).toBe('hello')
      })

      it('should handle escaped characters', () => {
        expect(parseStringLiteral('line1\\nline2')).toBe('line1\nline2')
        expect(parseStringLiteral('tab\\there')).toBe('tab\there')
        expect(parseStringLiteral('quote\\"here')).toBe('quote"here')
      })

      it('should handle unicode escapes', () => {
        expect(parseStringLiteral('\\u0041')).toBe('A')
      })
    })

    describe('parseNumericLiteral', () => {
      it('should parse integers', () => {
        expect(parseNumericLiteral('42')).toBe(42)
        expect(parseNumericLiteral('-42')).toBe(-42)
      })

      it('should parse decimals', () => {
        expect(parseNumericLiteral('3.14')).toBe(3.14)
        expect(parseNumericLiteral('-3.14')).toBe(-3.14)
      })

      it('should parse scientific notation', () => {
        expect(parseNumericLiteral('1e10')).toBe(1e10)
        expect(parseNumericLiteral('1.5e-5')).toBe(1.5e-5)
      })

      it('should preserve integer type when appropriate', () => {
        expect(Number.isInteger(parseNumericLiteral('42'))).toBe(true)
        // Note: In JavaScript, 42.0 === 42, so we test that decimals return floats
        expect(Number.isInteger(parseNumericLiteral('42.5'))).toBe(false)
        expect(Number.isInteger(parseNumericLiteral('3.14'))).toBe(false)
      })
    })

    describe('parseBooleanLiteral', () => {
      it('should parse true values', () => {
        expect(parseBooleanLiteral('true')).toBe(true)
        expect(parseBooleanLiteral('TRUE')).toBe(true)
        expect(parseBooleanLiteral('True')).toBe(true)
      })

      it('should parse false values', () => {
        expect(parseBooleanLiteral('false')).toBe(false)
        expect(parseBooleanLiteral('FALSE')).toBe(false)
        expect(parseBooleanLiteral('False')).toBe(false)
      })

      it('should throw for invalid boolean', () => {
        expect(() => parseBooleanLiteral('yes')).toThrow()
      })
    })
  })

  describe('ASTBuilder', () => {
    describe('predicate creation', () => {
      it('should create equality predicate', () => {
        const builder = new ASTBuilder()
        const node = builder.eq('name', 'Alice')

        expect(node.type).toBe('predicate')
        expect(node.column).toBe('name')
        expect(node.op).toBe('=')
        expect(node.value).toBe('Alice')
      })

      it('should create comparison predicates', () => {
        const builder = new ASTBuilder()

        expect(builder.neq('x', 1).op).toBe('!=')
        expect(builder.gt('x', 1).op).toBe('>')
        expect(builder.gte('x', 1).op).toBe('>=')
        expect(builder.lt('x', 1).op).toBe('<')
        expect(builder.lte('x', 1).op).toBe('<=')
      })

      it('should create IN predicate', () => {
        const builder = new ASTBuilder()
        const node = builder.inList('status', ['active', 'pending'])

        expect(node.op).toBe('IN')
        expect(node.value).toEqual(['active', 'pending'])
      })

      it('should create NOT IN predicate', () => {
        const builder = new ASTBuilder()
        const node = builder.notInList('status', ['deleted'])

        expect(node.op).toBe('NOT IN')
      })

      it('should create BETWEEN predicate', () => {
        const builder = new ASTBuilder()
        const node = builder.between('age', 18, 65)

        expect(node.op).toBe('BETWEEN')
        expect(node.value).toEqual([18, 65])
      })

      it('should create LIKE predicate', () => {
        const builder = new ASTBuilder()
        const node = builder.like('email', '%@example.com')

        expect(node.op).toBe('LIKE')
        expect(node.value).toBe('%@example.com')
      })

      it('should create IS NULL predicate', () => {
        const builder = new ASTBuilder()
        const node = builder.isNull('deleted_at')

        expect(node.op).toBe('IS NULL')
        expect(node.value).toBeNull()
      })

      it('should create IS NOT NULL predicate', () => {
        const builder = new ASTBuilder()
        const node = builder.isNotNull('email')

        expect(node.op).toBe('IS NOT NULL')
      })
    })

    describe('logical combination', () => {
      it('should create AND node', () => {
        const builder = new ASTBuilder()
        const a = builder.eq('x', 1)
        const b = builder.eq('y', 2)
        const node = builder.and(a, b)

        expect(node.type).toBe('logical')
        expect(node.op).toBe('AND')
        expect(node.children).toHaveLength(2)
      })

      it('should create OR node', () => {
        const builder = new ASTBuilder()
        const a = builder.eq('x', 1)
        const b = builder.eq('y', 2)
        const node = builder.or(a, b)

        expect(node.op).toBe('OR')
      })

      it('should create NOT node', () => {
        const builder = new ASTBuilder()
        const inner = builder.eq('deleted', true)
        const node = builder.not(inner)

        expect(node.op).toBe('NOT')
        expect(node.children).toHaveLength(1)
      })

      it('should flatten nested ANDs', () => {
        const builder = new ASTBuilder()
        const a = builder.eq('x', 1)
        const b = builder.eq('y', 2)
        const c = builder.eq('z', 3)
        const ab = builder.and(a, b)
        const node = builder.and(ab, c)

        // Should flatten to single AND with 3 children
        expect(node.children).toHaveLength(3)
      })

      it('should flatten nested ORs', () => {
        const builder = new ASTBuilder()
        const a = builder.eq('x', 1)
        const b = builder.eq('y', 2)
        const c = builder.eq('z', 3)
        const ab = builder.or(a, b)
        const node = builder.or(ab, c)

        expect(node.children).toHaveLength(3)
      })

      it('should handle empty children list', () => {
        const builder = new ASTBuilder()
        const node = builder.and()

        // Empty AND is always true
        expect(node.type).toBe('predicate')
      })

      it('should unwrap single-child logical', () => {
        const builder = new ASTBuilder()
        const single = builder.eq('x', 1)
        const node = builder.and(single)

        // Single AND should return the child directly
        expect(node).toBe(single)
      })
    })

    describe('operator mapping', () => {
      it('should map SQL operators to AST operators', () => {
        const builder = new ASTBuilder()

        expect(builder.mapSqlOp('=')).toBe('=')
        expect(builder.mapSqlOp('!=')).toBe('!=')
        expect(builder.mapSqlOp('<>')).toBe('!=')
        expect(builder.mapSqlOp('>')).toBe('>')
        expect(builder.mapSqlOp('>=')).toBe('>=')
        expect(builder.mapSqlOp('<')).toBe('<')
        expect(builder.mapSqlOp('<=')).toBe('<=')
      })

      it('should map Mongo operators to AST operators', () => {
        const builder = new ASTBuilder()

        expect(builder.mapMongoOp('$eq')).toBe('=')
        expect(builder.mapMongoOp('$ne')).toBe('!=')
        expect(builder.mapMongoOp('$gt')).toBe('>')
        expect(builder.mapMongoOp('$gte')).toBe('>=')
        expect(builder.mapMongoOp('$lt')).toBe('<')
        expect(builder.mapMongoOp('$lte')).toBe('<=')
        expect(builder.mapMongoOp('$in')).toBe('IN')
        expect(builder.mapMongoOp('$nin')).toBe('NOT IN')
      })

      it('should throw for unknown operators', () => {
        const builder = new ASTBuilder()

        expect(() => builder.mapSqlOp('UNKNOWN')).toThrow()
        expect(() => builder.mapMongoOp('$unknown')).toThrow()
      })
    })
  })

  describe('ParseError', () => {
    it('should include position information', () => {
      const error = new ParseError('Unexpected token', 42)

      expect(error.message).toContain('42')
      expect(error.position).toBe(42)
    })

    it('should include line and column when available', () => {
      const error = new ParseError('Unexpected token', 42, 3, 5)

      expect(error.line).toBe(3)
      expect(error.column).toBe(5)
      expect(error.message).toContain('line 3')
      expect(error.message).toContain('column 5')
    })

    it('should be instanceof Error', () => {
      const error = new ParseError('Test', 0)

      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct name', () => {
      const error = new ParseError('Test', 0)

      expect(error.name).toBe('ParseError')
    })
  })
})
