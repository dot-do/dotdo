/**
 * ClickHouse SQL Lexer - TypeScript Implementation
 *
 * This lexer follows the pattern from ClickHouse's Lexer.cpp and LexerStandalone.h.
 * Designed to work in WASM/Workers environments without native dependencies.
 */

// ============================================================================
// Token Types (matching ClickHouse's Lexer.h)
// ============================================================================

export enum TokenType {
  Whitespace = 'Whitespace',
  Comment = 'Comment',

  BareWord = 'BareWord', // Either keyword (SELECT) or identifier (column)
  Number = 'Number', // Always non-negative. 123, 456.789, 0xFF, 0b101
  StringLiteral = 'StringLiteral', // 'hello world'

  QuotedIdentifier = 'QuotedIdentifier', // "x", `x`

  OpeningRoundBracket = 'OpeningRoundBracket',
  ClosingRoundBracket = 'ClosingRoundBracket',
  OpeningSquareBracket = 'OpeningSquareBracket',
  ClosingSquareBracket = 'ClosingSquareBracket',
  OpeningCurlyBrace = 'OpeningCurlyBrace',
  ClosingCurlyBrace = 'ClosingCurlyBrace',

  Comma = 'Comma',
  Semicolon = 'Semicolon',
  Dot = 'Dot',
  Asterisk = 'Asterisk',
  DollarSign = 'DollarSign',
  Plus = 'Plus',
  Minus = 'Minus',
  Slash = 'Slash',
  Percent = 'Percent',
  Arrow = 'Arrow', // ->
  DoubleArrow = 'DoubleArrow', // ->>
  QuestionMark = 'QuestionMark',
  Colon = 'Colon',
  DoubleColon = 'DoubleColon', // ::
  Caret = 'Caret',
  Equals = 'Equals',
  NotEquals = 'NotEquals',
  Less = 'Less',
  Greater = 'Greater',
  LessOrEquals = 'LessOrEquals',
  GreaterOrEquals = 'GreaterOrEquals',
  Spaceship = 'Spaceship', // <=>
  PipeMark = 'PipeMark',
  Concatenation = 'Concatenation', // ||
  At = 'At',
  DoubleAt = 'DoubleAt',

  EndOfStream = 'EndOfStream',
  Error = 'Error',
}

export interface Token {
  type: TokenType
  value: string
  begin: number
  end: number
}

// ============================================================================
// Lexer Implementation
// ============================================================================

export class Lexer {
  private input: string
  private pos: number = 0
  private prevSignificantTokenType: TokenType = TokenType.Whitespace

  constructor(input: string) {
    this.input = input
  }

  nextToken(): Token {
    const token = this.nextTokenImpl()
    if (this.isSignificant(token.type)) {
      this.prevSignificantTokenType = token.type
    }
    return token
  }

  private isSignificant(type: TokenType): boolean {
    return type !== TokenType.Whitespace && type !== TokenType.Comment
  }

  private nextTokenImpl(): Token {
    if (this.pos >= this.input.length) {
      return { type: TokenType.EndOfStream, value: '', begin: this.pos, end: this.pos }
    }

    const tokenBegin = this.pos
    const char = this.input[this.pos]

    // Whitespace
    if (/\s/.test(char)) {
      while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
        this.pos++
      }
      return {
        type: TokenType.Whitespace,
        value: this.input.slice(tokenBegin, this.pos),
        begin: tokenBegin,
        end: this.pos,
      }
    }

    // Numbers
    if (/[0-9]/.test(char)) {
      return this.parseNumber(tokenBegin)
    }

    // String literals
    if (char === "'") {
      return this.parseString(tokenBegin)
    }

    // Quoted identifiers
    if (char === '"' || char === '`') {
      return this.parseQuotedIdentifier(tokenBegin, char)
    }

    // Brackets
    if (char === '(') {
      this.pos++
      return { type: TokenType.OpeningRoundBracket, value: '(', begin: tokenBegin, end: this.pos }
    }
    if (char === ')') {
      this.pos++
      return { type: TokenType.ClosingRoundBracket, value: ')', begin: tokenBegin, end: this.pos }
    }
    if (char === '[') {
      this.pos++
      return { type: TokenType.OpeningSquareBracket, value: '[', begin: tokenBegin, end: this.pos }
    }
    if (char === ']') {
      this.pos++
      return { type: TokenType.ClosingSquareBracket, value: ']', begin: tokenBegin, end: this.pos }
    }
    if (char === '{') {
      this.pos++
      return { type: TokenType.OpeningCurlyBrace, value: '{', begin: tokenBegin, end: this.pos }
    }
    if (char === '}') {
      this.pos++
      return { type: TokenType.ClosingCurlyBrace, value: '}', begin: tokenBegin, end: this.pos }
    }

    // Punctuation
    if (char === ',') {
      this.pos++
      return { type: TokenType.Comma, value: ',', begin: tokenBegin, end: this.pos }
    }
    if (char === ';') {
      this.pos++
      return { type: TokenType.Semicolon, value: ';', begin: tokenBegin, end: this.pos }
    }
    if (char === '*') {
      this.pos++
      return { type: TokenType.Asterisk, value: '*', begin: tokenBegin, end: this.pos }
    }
    if (char === '$') {
      this.pos++
      return { type: TokenType.DollarSign, value: '$', begin: tokenBegin, end: this.pos }
    }
    if (char === '+') {
      this.pos++
      return { type: TokenType.Plus, value: '+', begin: tokenBegin, end: this.pos }
    }
    if (char === '%') {
      this.pos++
      return { type: TokenType.Percent, value: '%', begin: tokenBegin, end: this.pos }
    }
    if (char === '^') {
      this.pos++
      return { type: TokenType.Caret, value: '^', begin: tokenBegin, end: this.pos }
    }
    if (char === '?') {
      this.pos++
      return { type: TokenType.QuestionMark, value: '?', begin: tokenBegin, end: this.pos }
    }
    if (char === '@') {
      this.pos++
      if (this.pos < this.input.length && this.input[this.pos] === '@') {
        this.pos++
        return { type: TokenType.DoubleAt, value: '@@', begin: tokenBegin, end: this.pos }
      }
      return { type: TokenType.At, value: '@', begin: tokenBegin, end: this.pos }
    }

    // Dot (distinguish from number starting with .)
    if (char === '.') {
      // Check if next char is a digit and previous token allows starting number
      if (
        this.pos + 1 < this.input.length &&
        /[0-9]/.test(this.input[this.pos + 1]) &&
        this.prevSignificantTokenType !== TokenType.ClosingRoundBracket &&
        this.prevSignificantTokenType !== TokenType.ClosingSquareBracket &&
        this.prevSignificantTokenType !== TokenType.BareWord &&
        this.prevSignificantTokenType !== TokenType.QuotedIdentifier &&
        this.prevSignificantTokenType !== TokenType.Number
      ) {
        return this.parseNumber(tokenBegin)
      }
      this.pos++
      return { type: TokenType.Dot, value: '.', begin: tokenBegin, end: this.pos }
    }

    // Minus, Arrow, Comment
    if (char === '-') {
      this.pos++
      if (this.pos < this.input.length && this.input[this.pos] === '>') {
        this.pos++
        // Check for ->>
        if (this.pos < this.input.length && this.input[this.pos] === '>') {
          this.pos++
          return { type: TokenType.DoubleArrow, value: '->>', begin: tokenBegin, end: this.pos }
        }
        return { type: TokenType.Arrow, value: '->', begin: tokenBegin, end: this.pos }
      }
      if (this.pos < this.input.length && this.input[this.pos] === '-') {
        // Comment until end of line
        this.pos++
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
          this.pos++
        }
        return {
          type: TokenType.Comment,
          value: this.input.slice(tokenBegin, this.pos),
          begin: tokenBegin,
          end: this.pos,
        }
      }
      return { type: TokenType.Minus, value: '-', begin: tokenBegin, end: this.pos }
    }

    // Slash and comments
    if (char === '/') {
      this.pos++
      if (this.pos < this.input.length && this.input[this.pos] === '/') {
        // Single-line comment
        this.pos++
        while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
          this.pos++
        }
        return {
          type: TokenType.Comment,
          value: this.input.slice(tokenBegin, this.pos),
          begin: tokenBegin,
          end: this.pos,
        }
      }
      if (this.pos < this.input.length && this.input[this.pos] === '*') {
        // Multi-line comment
        this.pos++
        let depth = 1
        while (this.pos + 1 < this.input.length && depth > 0) {
          if (this.input[this.pos] === '/' && this.input[this.pos + 1] === '*') {
            this.pos += 2
            depth++
          } else if (this.input[this.pos] === '*' && this.input[this.pos + 1] === '/') {
            this.pos += 2
            depth--
          } else {
            this.pos++
          }
        }
        return {
          type: TokenType.Comment,
          value: this.input.slice(tokenBegin, this.pos),
          begin: tokenBegin,
          end: this.pos,
        }
      }
      return { type: TokenType.Slash, value: '/', begin: tokenBegin, end: this.pos }
    }

    // Colon
    if (char === ':') {
      this.pos++
      if (this.pos < this.input.length && this.input[this.pos] === ':') {
        this.pos++
        return { type: TokenType.DoubleColon, value: '::', begin: tokenBegin, end: this.pos }
      }
      return { type: TokenType.Colon, value: ':', begin: tokenBegin, end: this.pos }
    }

    // Equals
    if (char === '=') {
      this.pos++
      if (this.pos < this.input.length && this.input[this.pos] === '=') {
        this.pos++
      }
      return {
        type: TokenType.Equals,
        value: this.input.slice(tokenBegin, this.pos),
        begin: tokenBegin,
        end: this.pos,
      }
    }

    // Not equals
    if (char === '!') {
      this.pos++
      if (this.pos < this.input.length && this.input[this.pos] === '=') {
        this.pos++
        return { type: TokenType.NotEquals, value: '!=', begin: tokenBegin, end: this.pos }
      }
      return { type: TokenType.Error, value: '!', begin: tokenBegin, end: this.pos }
    }

    // Less, LessOrEquals, NotEquals (<>), Spaceship (<=>)
    if (char === '<') {
      this.pos++
      if (this.pos + 1 < this.input.length && this.input[this.pos] === '=' && this.input[this.pos + 1] === '>') {
        this.pos += 2
        return { type: TokenType.Spaceship, value: '<=>', begin: tokenBegin, end: this.pos }
      }
      if (this.pos < this.input.length && this.input[this.pos] === '=') {
        this.pos++
        return { type: TokenType.LessOrEquals, value: '<=', begin: tokenBegin, end: this.pos }
      }
      if (this.pos < this.input.length && this.input[this.pos] === '>') {
        this.pos++
        return { type: TokenType.NotEquals, value: '<>', begin: tokenBegin, end: this.pos }
      }
      return { type: TokenType.Less, value: '<', begin: tokenBegin, end: this.pos }
    }

    // Greater, GreaterOrEquals
    if (char === '>') {
      this.pos++
      if (this.pos < this.input.length && this.input[this.pos] === '=') {
        this.pos++
        return { type: TokenType.GreaterOrEquals, value: '>=', begin: tokenBegin, end: this.pos }
      }
      return { type: TokenType.Greater, value: '>', begin: tokenBegin, end: this.pos }
    }

    // Pipe
    if (char === '|') {
      this.pos++
      if (this.pos < this.input.length && this.input[this.pos] === '|') {
        this.pos++
        return { type: TokenType.Concatenation, value: '||', begin: tokenBegin, end: this.pos }
      }
      return { type: TokenType.PipeMark, value: '|', begin: tokenBegin, end: this.pos }
    }

    // Bare words (identifiers and keywords)
    if (/[a-zA-Z_]/.test(char) || char === '$') {
      while (this.pos < this.input.length && /[a-zA-Z0-9_$]/.test(this.input[this.pos])) {
        this.pos++
      }
      return {
        type: TokenType.BareWord,
        value: this.input.slice(tokenBegin, this.pos),
        begin: tokenBegin,
        end: this.pos,
      }
    }

    // Unknown character
    this.pos++
    return {
      type: TokenType.Error,
      value: this.input.slice(tokenBegin, this.pos),
      begin: tokenBegin,
      end: this.pos,
    }
  }

  private parseNumber(tokenBegin: number): Token {
    // Handle hex (0x) and binary (0b) prefixes
    if (
      this.input[this.pos] === '0' &&
      this.pos + 1 < this.input.length &&
      (this.input[this.pos + 1] === 'x' || this.input[this.pos + 1] === 'X')
    ) {
      this.pos += 2
      while (this.pos < this.input.length && /[0-9a-fA-F_]/.test(this.input[this.pos])) {
        this.pos++
      }
      return {
        type: TokenType.Number,
        value: this.input.slice(tokenBegin, this.pos),
        begin: tokenBegin,
        end: this.pos,
      }
    }

    if (
      this.input[this.pos] === '0' &&
      this.pos + 1 < this.input.length &&
      (this.input[this.pos + 1] === 'b' || this.input[this.pos + 1] === 'B')
    ) {
      this.pos += 2
      while (this.pos < this.input.length && /[01_]/.test(this.input[this.pos])) {
        this.pos++
      }
      return {
        type: TokenType.Number,
        value: this.input.slice(tokenBegin, this.pos),
        begin: tokenBegin,
        end: this.pos,
      }
    }

    // Integer part (or start with .)
    if (this.input[this.pos] !== '.') {
      while (this.pos < this.input.length && /[0-9_]/.test(this.input[this.pos])) {
        this.pos++
      }
    }

    // Decimal point
    if (this.pos < this.input.length && this.input[this.pos] === '.') {
      this.pos++
      while (this.pos < this.input.length && /[0-9_]/.test(this.input[this.pos])) {
        this.pos++
      }
    }

    // Exponent
    if (this.pos < this.input.length && (this.input[this.pos] === 'e' || this.input[this.pos] === 'E')) {
      this.pos++
      if (this.pos < this.input.length && (this.input[this.pos] === '+' || this.input[this.pos] === '-')) {
        this.pos++
      }
      while (this.pos < this.input.length && /[0-9_]/.test(this.input[this.pos])) {
        this.pos++
      }
    }

    return {
      type: TokenType.Number,
      value: this.input.slice(tokenBegin, this.pos),
      begin: tokenBegin,
      end: this.pos,
    }
  }

  private parseString(tokenBegin: number): Token {
    this.pos++ // Skip opening quote
    while (this.pos < this.input.length) {
      if (this.input[this.pos] === "'") {
        this.pos++
        // Handle escaped quotes ('')
        if (this.pos < this.input.length && this.input[this.pos] === "'") {
          this.pos++
          continue
        }
        return {
          type: TokenType.StringLiteral,
          value: this.input.slice(tokenBegin, this.pos),
          begin: tokenBegin,
          end: this.pos,
        }
      }
      if (this.input[this.pos] === '\\') {
        this.pos += 2 // Skip escape sequence
        continue
      }
      this.pos++
    }
    return {
      type: TokenType.Error,
      value: this.input.slice(tokenBegin, this.pos),
      begin: tokenBegin,
      end: this.pos,
    }
  }

  private parseQuotedIdentifier(tokenBegin: number, quoteChar: string): Token {
    this.pos++ // Skip opening quote
    while (this.pos < this.input.length) {
      if (this.input[this.pos] === quoteChar) {
        this.pos++
        // Handle escaped quotes
        if (this.pos < this.input.length && this.input[this.pos] === quoteChar) {
          this.pos++
          continue
        }
        return {
          type: TokenType.QuotedIdentifier,
          value: this.input.slice(tokenBegin, this.pos),
          begin: tokenBegin,
          end: this.pos,
        }
      }
      if (this.input[this.pos] === '\\') {
        this.pos += 2
        continue
      }
      this.pos++
    }
    return {
      type: TokenType.Error,
      value: this.input.slice(tokenBegin, this.pos),
      begin: tokenBegin,
      end: this.pos,
    }
  }
}

// ============================================================================
// Tokenize helper
// ============================================================================

export function tokenize(input: string): Token[] {
  const lexer = new Lexer(input)
  const tokens: Token[] = []
  while (true) {
    const token = lexer.nextToken()
    tokens.push(token)
    if (token.type === TokenType.EndOfStream || token.type === TokenType.Error) {
      break
    }
  }
  return tokens
}
