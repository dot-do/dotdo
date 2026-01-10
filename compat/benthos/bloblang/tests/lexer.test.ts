/**
 * RED Phase Tests: Bloblang lexer/tokenizer
 * Issue: dotdo-rn6l1
 *
 * These tests define the expected behavior for the Bloblang lexer.
 * They should FAIL until the implementation is complete.
 */
import { describe, it, expect } from 'vitest'
import {
  Lexer,
  Token,
  TokenType,
  tokenize
} from '../lexer'

describe('Bloblang Lexer', () => {
  describe('Basic tokenization', () => {
    it('tokenizes identifiers', () => {
      const tokens = tokenize('root this foo bar_baz')

      expect(tokens).toContainEqual({ type: TokenType.ROOT, value: 'root', line: 1, column: 1 })
      expect(tokens).toContainEqual({ type: TokenType.THIS, value: 'this', line: 1, column: 6 })
      expect(tokens).toContainEqual({ type: TokenType.IDENTIFIER, value: 'foo', line: 1, column: 11 })
      expect(tokens).toContainEqual({ type: TokenType.IDENTIFIER, value: 'bar_baz', line: 1, column: 15 })
    })

    it('tokenizes string literals', () => {
      const tokens = tokenize('"hello world"')

      expect(tokens).toContainEqual({
        type: TokenType.STRING,
        value: 'hello world',
        line: 1,
        column: 1
      })
    })

    it('tokenizes string literals with escape sequences', () => {
      const tokens = tokenize('"hello\\nworld\\t\\"escaped\\""')
      const stringToken = tokens.find(t => t.type === TokenType.STRING)

      expect(stringToken?.value).toBe('hello\nworld\t"escaped"')
    })

    it('tokenizes single-quoted strings', () => {
      const tokens = tokenize("'single quoted'")

      expect(tokens).toContainEqual({
        type: TokenType.STRING,
        value: 'single quoted',
        line: 1,
        column: 1
      })
    })

    it('tokenizes number literals', () => {
      const tokens = tokenize('42 3.14 -17 0.5 1e10 2.5e-3')

      expect(tokens).toContainEqual({ type: TokenType.NUMBER, value: '42', line: 1, column: 1 })
      expect(tokens).toContainEqual({ type: TokenType.NUMBER, value: '3.14', line: 1, column: 4 })
      expect(tokens.filter(t => t.type === TokenType.NUMBER)).toHaveLength(6)
    })

    it('tokenizes boolean literals', () => {
      const tokens = tokenize('true false')

      expect(tokens).toContainEqual({ type: TokenType.BOOLEAN, value: 'true', line: 1, column: 1 })
      expect(tokens).toContainEqual({ type: TokenType.BOOLEAN, value: 'false', line: 1, column: 6 })
    })

    it('tokenizes null literal', () => {
      const tokens = tokenize('null')

      expect(tokens).toContainEqual({ type: TokenType.NULL, value: 'null', line: 1, column: 1 })
    })
  })

  describe('Operators', () => {
    it('tokenizes assignment operator', () => {
      const tokens = tokenize('root = this')

      expect(tokens).toContainEqual({ type: TokenType.ASSIGN, value: '=', line: 1, column: 6 })
    })

    it('tokenizes arithmetic operators', () => {
      const tokens = tokenize('a + b - c * d / e % f')

      expect(tokens).toContainEqual({ type: TokenType.PLUS, value: '+', line: 1, column: 3 })
      expect(tokens).toContainEqual({ type: TokenType.MINUS, value: '-', line: 1, column: 7 })
      expect(tokens).toContainEqual({ type: TokenType.STAR, value: '*', line: 1, column: 11 })
      expect(tokens).toContainEqual({ type: TokenType.SLASH, value: '/', line: 1, column: 15 })
      expect(tokens).toContainEqual({ type: TokenType.PERCENT, value: '%', line: 1, column: 19 })
    })

    it('tokenizes comparison operators', () => {
      const tokens = tokenize('a == b != c < d > e <= f >= g')

      expect(tokens).toContainEqual({ type: TokenType.EQ, value: '==', line: 1, column: 3 })
      expect(tokens).toContainEqual({ type: TokenType.NEQ, value: '!=', line: 1, column: 8 })
      expect(tokens).toContainEqual({ type: TokenType.LT, value: '<', line: 1, column: 13 })
      expect(tokens).toContainEqual({ type: TokenType.GT, value: '>', line: 1, column: 17 })
      expect(tokens).toContainEqual({ type: TokenType.LTE, value: '<=', line: 1, column: 21 })
      expect(tokens).toContainEqual({ type: TokenType.GTE, value: '>=', line: 1, column: 26 })
    })

    it('tokenizes logical operators', () => {
      const tokens = tokenize('a && b || c !')

      expect(tokens).toContainEqual({ type: TokenType.AND, value: '&&', line: 1, column: 3 })
      expect(tokens).toContainEqual({ type: TokenType.OR, value: '||', line: 1, column: 8 })
      expect(tokens).toContainEqual({ type: TokenType.NOT, value: '!', line: 1, column: 13 })
    })

    it('tokenizes pipe operator', () => {
      const tokens = tokenize('this | uppercase()')

      expect(tokens).toContainEqual({ type: TokenType.PIPE, value: '|', line: 1, column: 6 })
    })
  })

  describe('Punctuation', () => {
    it('tokenizes brackets and braces', () => {
      const tokens = tokenize('(a) [b] {c}')

      expect(tokens).toContainEqual({ type: TokenType.LPAREN, value: '(', line: 1, column: 1 })
      expect(tokens).toContainEqual({ type: TokenType.RPAREN, value: ')', line: 1, column: 3 })
      expect(tokens).toContainEqual({ type: TokenType.LBRACKET, value: '[', line: 1, column: 5 })
      expect(tokens).toContainEqual({ type: TokenType.RBRACKET, value: ']', line: 1, column: 7 })
      expect(tokens).toContainEqual({ type: TokenType.LBRACE, value: '{', line: 1, column: 9 })
      expect(tokens).toContainEqual({ type: TokenType.RBRACE, value: '}', line: 1, column: 11 })
    })

    it('tokenizes separators', () => {
      const tokens = tokenize('a, b: c')

      expect(tokens).toContainEqual({ type: TokenType.COMMA, value: ',', line: 1, column: 2 })
      expect(tokens).toContainEqual({ type: TokenType.COLON, value: ':', line: 1, column: 5 })
    })

    it('tokenizes dot for property access', () => {
      const tokens = tokenize('this.field.nested')

      expect(tokens).toContainEqual({ type: TokenType.DOT, value: '.', line: 1, column: 5 })
      expect(tokens).toContainEqual({ type: TokenType.DOT, value: '.', line: 1, column: 11 })
    })
  })

  describe('Keywords', () => {
    it('tokenizes if/else/match keywords', () => {
      const tokens = tokenize('if else match')

      expect(tokens).toContainEqual({ type: TokenType.IF, value: 'if', line: 1, column: 1 })
      expect(tokens).toContainEqual({ type: TokenType.ELSE, value: 'else', line: 1, column: 4 })
      expect(tokens).toContainEqual({ type: TokenType.MATCH, value: 'match', line: 1, column: 9 })
    })

    it('tokenizes let and map keywords', () => {
      const tokens = tokenize('let x = map y')

      expect(tokens).toContainEqual({ type: TokenType.LET, value: 'let', line: 1, column: 1 })
      expect(tokens).toContainEqual({ type: TokenType.MAP, value: 'map', line: 1, column: 9 })
    })

    it('tokenizes meta keyword', () => {
      const tokens = tokenize('meta("key")')

      expect(tokens).toContainEqual({ type: TokenType.META, value: 'meta', line: 1, column: 1 })
    })
  })

  describe('Complex expressions', () => {
    it('tokenizes method chains', () => {
      const tokens = tokenize('this.field.uppercase().replace("A", "B")')

      const identifiers = tokens.filter(t => t.type === TokenType.IDENTIFIER)
      expect(identifiers.map(t => t.value)).toContain('uppercase')
      expect(identifiers.map(t => t.value)).toContain('replace')
    })

    it('tokenizes array literals', () => {
      const tokens = tokenize('[1, 2, 3, "four", true]')

      expect(tokens[0].type).toBe(TokenType.LBRACKET)
      expect(tokens.filter(t => t.type === TokenType.NUMBER)).toHaveLength(3)
      expect(tokens.filter(t => t.type === TokenType.STRING)).toHaveLength(1)
      expect(tokens.filter(t => t.type === TokenType.BOOLEAN)).toHaveLength(1)
    })

    it('tokenizes object literals', () => {
      const tokens = tokenize('{"key": "value", "num": 42}')

      expect(tokens[0].type).toBe(TokenType.LBRACE)
      expect(tokens.filter(t => t.type === TokenType.STRING)).toHaveLength(3)
      expect(tokens.filter(t => t.type === TokenType.COLON)).toHaveLength(2)
    })

    it('tokenizes arrow functions', () => {
      const tokens = tokenize('x -> x + 1')

      expect(tokens).toContainEqual({ type: TokenType.ARROW, value: '->', line: 1, column: 3 })
    })

    it('tokenizes interpolated strings', () => {
      const input = '"Hello ${this.name}!"'
      const tokens = tokenize(input)

      // Should identify interpolation markers
      const interpToken = tokens.find(t => t.type === TokenType.INTERP_STRING)
      expect(interpToken).toBeDefined()
    })
  })

  describe('Comments', () => {
    it('ignores line comments', () => {
      const tokens = tokenize(`
        root = this # this is a comment
        root.field = 42
      `)

      expect(tokens.filter(t => t.type === TokenType.IDENTIFIER).map(t => t.value))
        .not.toContain('is')
    })

    it('tracks line numbers across comments', () => {
      const tokens = tokenize(`root = this
# comment line
field = value`)

      const fieldToken = tokens.find(t => t.value === 'field')
      expect(fieldToken?.line).toBe(3)
    })
  })

  describe('Multiline handling', () => {
    it('tracks line and column numbers', () => {
      const tokens = tokenize(`root = this
root.a = 1
root.b = 2`)

      const line1Root = tokens.find(t => t.value === 'root' && t.line === 1)
      const line2Root = tokens.find(t => t.value === 'root' && t.line === 2)
      const line3Root = tokens.find(t => t.value === 'root' && t.line === 3)

      expect(line1Root?.column).toBe(1)
      expect(line2Root?.column).toBe(1)
      expect(line3Root?.column).toBe(1)
    })

    it('handles Windows-style line endings', () => {
      const tokens = tokenize('root = this\r\nfield = value')

      expect(tokens.find(t => t.value === 'field')?.line).toBe(2)
    })
  })

  describe('Error handling', () => {
    it('throws on unterminated string', () => {
      expect(() => tokenize('"unterminated')).toThrow(/unterminated string/i)
    })

    it('throws on invalid characters', () => {
      expect(() => tokenize('root = this @invalid')).toThrow(/unexpected character/i)
    })

    it('provides line and column in error messages', () => {
      try {
        tokenize(`root = this
field = "unterminated`)
        expect.fail('Should have thrown')
      } catch (e: any) {
        expect(e.message).toMatch(/line 2/i)
      }
    })
  })

  describe('Lexer class interface', () => {
    it('provides iterator interface', () => {
      const lexer = new Lexer('a b c')
      const tokens: Token[] = []

      for (const token of lexer) {
        if (token.type === TokenType.EOF) break
        tokens.push(token)
      }

      expect(tokens).toHaveLength(3)
    })

    it('provides peek without consuming', () => {
      const lexer = new Lexer('a b')

      expect(lexer.peek().value).toBe('a')
      expect(lexer.peek().value).toBe('a')
      expect(lexer.next().value).toBe('a')
      expect(lexer.peek().value).toBe('b')
    })

    it('provides lookahead', () => {
      const lexer = new Lexer('a b c')

      expect(lexer.lookahead(0).value).toBe('a')
      expect(lexer.lookahead(1).value).toBe('b')
      expect(lexer.lookahead(2).value).toBe('c')
    })

    it('provides position info', () => {
      const lexer = new Lexer('hello world')
      lexer.next() // consume 'hello'

      expect(lexer.position()).toEqual({ line: 1, column: 7 })
    })
  })
})

describe('Bloblang-specific syntax', () => {
  it('tokenizes $VAR environment variable syntax', () => {
    const tokens = tokenize('root = $MY_VAR')

    expect(tokens).toContainEqual({
      type: TokenType.ENV_VAR,
      value: 'MY_VAR',
      line: 1,
      column: 8
    })
  })

  it('tokenizes ${VAR} environment variable syntax', () => {
    const tokens = tokenize('root = ${MY_VAR}')

    expect(tokens).toContainEqual({
      type: TokenType.ENV_VAR,
      value: 'MY_VAR',
      line: 1,
      column: 8
    })
  })

  it('tokenizes ${! expression } for interpolation', () => {
    const tokens = tokenize('root = "${! this.field }"')

    // When ${! } is inside a string, it becomes an INTERP_STRING token
    const interpToken = tokens.find(t => t.type === TokenType.INTERP_STRING)
    expect(interpToken).toBeDefined()
    expect(interpToken?.value).toContain('this.field')
  })

  it('tokenizes deleted() special value', () => {
    const tokens = tokenize('root = deleted()')

    expect(tokens).toContainEqual({
      type: TokenType.DELETED,
      value: 'deleted',
      line: 1,
      column: 8
    })
  })

  it('tokenizes nothing() special value', () => {
    const tokens = tokenize('root = nothing()')

    expect(tokens).toContainEqual({
      type: TokenType.NOTHING,
      value: 'nothing',
      line: 1,
      column: 8
    })
  })

  it('tokenizes error() function', () => {
    const tokens = tokenize('root = error()')

    expect(tokens).toContainEqual({
      type: TokenType.ERROR,
      value: 'error',
      line: 1,
      column: 8
    })
  })

  it('tokenizes optional chaining with ?', () => {
    const tokens = tokenize('this.field?.nested')

    expect(tokens).toContainEqual({
      type: TokenType.OPTIONAL_CHAIN,
      value: '?.',
      line: 1,
      column: 11
    })
  })

  it('tokenizes null coalescing with |', () => {
    const tokens = tokenize('this.field | "default"')

    // In Bloblang, | can be null coalescing in certain contexts
    expect(tokens).toContainEqual({
      type: TokenType.PIPE,
      value: '|',
      line: 1,
      column: 12
    })
  })
})
