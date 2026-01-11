/**
 * Bloblang Lexer/Tokenizer
 * Issue: dotdo-mb6gb (GREEN phase)
 */

export enum TokenType {
  // Literals
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',

  // Identifiers and keywords
  IDENTIFIER = 'IDENTIFIER',
  ROOT = 'ROOT',
  THIS = 'THIS',
  META = 'META',

  // Keywords
  IF = 'IF',
  ELSE = 'ELSE',
  MATCH = 'MATCH',
  LET = 'LET',
  MAP = 'MAP',

  // Special values
  DELETED = 'DELETED',
  NOTHING = 'NOTHING',
  ERROR = 'ERROR',
  IN = 'IN',

  // Operators
  ASSIGN = 'ASSIGN',
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  STAR = 'STAR',
  SLASH = 'SLASH',
  PERCENT = 'PERCENT',

  // Comparison
  EQ = 'EQ',
  NEQ = 'NEQ',
  LT = 'LT',
  GT = 'GT',
  LTE = 'LTE',
  GTE = 'GTE',

  // Logical
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',

  // Punctuation
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  DOT = 'DOT',
  COMMA = 'COMMA',
  COLON = 'COLON',
  SEMICOLON = 'SEMICOLON',
  PIPE = 'PIPE',
  ARROW = 'ARROW',
  OPTIONAL_CHAIN = 'OPTIONAL_CHAIN',

  // Special
  ENV_VAR = 'ENV_VAR',
  INTERP_STRING = 'INTERP_STRING',
  INTERP_EXPR = 'INTERP_EXPR',

  // Control
  EOF = 'EOF',
  NEWLINE = 'NEWLINE'
}

export interface Token {
  type: TokenType
  value: string
  line: number
  column: number
}

const KEYWORDS: Record<string, TokenType> = {
  'root': TokenType.ROOT,
  'this': TokenType.THIS,
  'meta': TokenType.META,
  'if': TokenType.IF,
  'else': TokenType.ELSE,
  'match': TokenType.MATCH,
  'let': TokenType.LET,
  'map': TokenType.MAP,
  'true': TokenType.BOOLEAN,
  'false': TokenType.BOOLEAN,
  'null': TokenType.NULL,
  'deleted': TokenType.DELETED,
  'nothing': TokenType.NOTHING,
  'error': TokenType.ERROR,
  'in': TokenType.IN
}

export class LexerError extends Error {
  line: number
  column: number

  constructor(message: string, line: number, column: number) {
    super(`${message} at line ${line}, column ${column}`)
    this.name = 'LexerError'
    this.line = line
    this.column = column
  }
}

export class Lexer implements Iterable<Token> {
  private source: string
  private pos: number = 0
  private line: number = 1
  private column: number = 1
  private tokens: Token[] = []
  private tokenIndex: number = 0
  private peeked: Token | null = null

  constructor(source: string) {
    this.source = source
  }

  private get current(): string {
    return this.source[this.pos] || ''
  }

  private get isAtEnd(): boolean {
    return this.pos >= this.source.length
  }

  private advance(): string {
    const char = this.current
    this.pos++
    if (char === '\n') {
      this.line++
      this.column = 1
    } else {
      this.column++
    }
    return char
  }

  private peekChar(offset: number = 0): string {
    return this.source[this.pos + offset] || ''
  }

  private match(expected: string): boolean {
    if (this.current === expected) {
      this.advance()
      return true
    }
    return false
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd) {
      const c = this.current
      if (c === ' ' || c === '\t' || c === '\r') {
        this.advance()
      } else if (c === '\n') {
        this.advance()
      } else if (c === '#') {
        // Comment - skip to end of line
        while (!this.isAtEnd && this.current !== '\n') {
          this.advance()
        }
      } else {
        break
      }
    }
  }

  private makeToken(type: TokenType, value: string, startLine: number, startColumn: number): Token {
    return { type, value, line: startLine, column: startColumn }
  }

  private string(quote: string): Token {
    const startLine = this.line
    const startColumn = this.column
    this.advance() // consume opening quote

    let value = ''
    let hasInterpolation = false

    while (!this.isAtEnd && this.current !== quote) {
      if (this.current === '\\') {
        this.advance()
        switch (this.current) {
          case 'n': value += '\n'; break
          case 't': value += '\t'; break
          case 'r': value += '\r'; break
          case '\\': value += '\\'; break
          case '"': value += '"'; break
          case "'": value += "'"; break
          default: value += this.current
        }
        this.advance()
      } else if (this.current === '$' && this.peekChar(1) === '{' && this.peekChar(2) === '!') {
        hasInterpolation = true
        value += this.advance()
        value += this.advance()
        value += this.advance()
        // Consume until closing }
        while (!this.isAtEnd && this.current !== '}') {
          value += this.advance()
        }
        if (this.current === '}') {
          value += this.advance()
        }
      } else if (this.current === '$' && this.peekChar(1) === '{') {
        hasInterpolation = true
        value += this.advance()
        value += this.advance()
        while (!this.isAtEnd && this.current !== '}') {
          value += this.advance()
        }
        if (this.current === '}') {
          value += this.advance()
        }
      } else if (this.current === '\n') {
        throw new LexerError('Unterminated string literal', startLine, startColumn)
      } else {
        value += this.advance()
      }
    }

    if (this.isAtEnd) {
      throw new LexerError('Unterminated string literal', startLine, startColumn)
    }

    this.advance() // consume closing quote

    if (hasInterpolation) {
      return this.makeToken(TokenType.INTERP_STRING, value, startLine, startColumn)
    }
    return this.makeToken(TokenType.STRING, value, startLine, startColumn)
  }

  private number(): Token {
    const startLine = this.line
    const startColumn = this.column
    let value = ''

    // Integer part (no leading - handled here, that's a unary operator)
    while (!this.isAtEnd && /[0-9]/.test(this.current)) {
      value += this.advance()
    }

    // Decimal part - check for dot followed by digit
    if (this.current === '.') {
      const nextChar = this.peekChar(1)
      if (/[0-9]/.test(nextChar)) {
        value += this.advance() // consume '.'
        while (!this.isAtEnd && /[0-9]/.test(this.current)) {
          value += this.advance()
        }
      }
    }

    // Exponent part
    if (this.current === 'e' || this.current === 'E') {
      value += this.advance()
      if (this.current === '+' || this.current === '-') {
        value += this.advance()
      }
      while (!this.isAtEnd && /[0-9]/.test(this.current)) {
        value += this.advance()
      }
    }

    return this.makeToken(TokenType.NUMBER, value, startLine, startColumn)
  }

  private identifier(): Token {
    const startLine = this.line
    const startColumn = this.column
    let value = ''

    while (!this.isAtEnd && /[a-zA-Z0-9_]/.test(this.current)) {
      value += this.advance()
    }

    const type = KEYWORDS[value] || TokenType.IDENTIFIER
    return this.makeToken(type, value, startLine, startColumn)
  }

  private envVar(): Token {
    const startLine = this.line
    const startColumn = this.column

    this.advance() // consume $

    if (this.current === '{') {
      this.advance() // consume {

      // Check for ${! expression }
      if (this.current === '!') {
        this.advance() // consume !
        let expr = ''
        while (!this.isAtEnd && this.current !== '}') {
          expr += this.advance()
        }
        if (this.current === '}') {
          this.advance()
        }
        return this.makeToken(TokenType.INTERP_EXPR, expr.trim(), startLine, startColumn)
      }

      let name = ''
      while (!this.isAtEnd && /[a-zA-Z0-9_]/.test(this.current)) {
        name += this.advance()
      }
      if (this.current === '}') {
        this.advance()
      }
      return this.makeToken(TokenType.ENV_VAR, name, startLine, startColumn)
    } else {
      let name = ''
      while (!this.isAtEnd && /[a-zA-Z0-9_]/.test(this.current)) {
        name += this.advance()
      }
      return this.makeToken(TokenType.ENV_VAR, name, startLine, startColumn)
    }
  }

  private nextToken(): Token {
    this.skipWhitespace()

    if (this.isAtEnd) {
      return this.makeToken(TokenType.EOF, '', this.line, this.column)
    }

    const startLine = this.line
    const startColumn = this.column
    const c = this.current

    // String literals
    if (c === '"' || c === "'") {
      return this.string(c)
    }

    // Numbers (only digits, not leading -)
    if (/[0-9]/.test(c)) {
      return this.number()
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(c)) {
      return this.identifier()
    }

    // Environment variables
    if (c === '$') {
      return this.envVar()
    }

    // Two-character tokens
    if (c === '=' && this.peekChar(1) === '=') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.EQ, '==', startLine, startColumn)
    }
    if (c === '!' && this.peekChar(1) === '=') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.NEQ, '!=', startLine, startColumn)
    }
    if (c === '<' && this.peekChar(1) === '=') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.LTE, '<=', startLine, startColumn)
    }
    if (c === '>' && this.peekChar(1) === '=') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.GTE, '>=', startLine, startColumn)
    }
    if (c === '&' && this.peekChar(1) === '&') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.AND, '&&', startLine, startColumn)
    }
    if (c === '|' && this.peekChar(1) === '|') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.OR, '||', startLine, startColumn)
    }
    if (c === '-' && this.peekChar(1) === '>') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.ARROW, '->', startLine, startColumn)
    }
    if (c === '?' && this.peekChar(1) === '.') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.OPTIONAL_CHAIN, '?.', startLine, startColumn)
    }

    // Single-character tokens
    this.advance()
    switch (c) {
      case '=': return this.makeToken(TokenType.ASSIGN, '=', startLine, startColumn)
      case '+': return this.makeToken(TokenType.PLUS, '+', startLine, startColumn)
      case '-': return this.makeToken(TokenType.MINUS, '-', startLine, startColumn)
      case '*': return this.makeToken(TokenType.STAR, '*', startLine, startColumn)
      case '/': return this.makeToken(TokenType.SLASH, '/', startLine, startColumn)
      case '%': return this.makeToken(TokenType.PERCENT, '%', startLine, startColumn)
      case '<': return this.makeToken(TokenType.LT, '<', startLine, startColumn)
      case '>': return this.makeToken(TokenType.GT, '>', startLine, startColumn)
      case '!': return this.makeToken(TokenType.NOT, '!', startLine, startColumn)
      case '(': return this.makeToken(TokenType.LPAREN, '(', startLine, startColumn)
      case ')': return this.makeToken(TokenType.RPAREN, ')', startLine, startColumn)
      case '[': return this.makeToken(TokenType.LBRACKET, '[', startLine, startColumn)
      case ']': return this.makeToken(TokenType.RBRACKET, ']', startLine, startColumn)
      case '{': return this.makeToken(TokenType.LBRACE, '{', startLine, startColumn)
      case '}': return this.makeToken(TokenType.RBRACE, '}', startLine, startColumn)
      case '.': return this.makeToken(TokenType.DOT, '.', startLine, startColumn)
      case ',': return this.makeToken(TokenType.COMMA, ',', startLine, startColumn)
      case ':': return this.makeToken(TokenType.COLON, ':', startLine, startColumn)
      case ';': return this.makeToken(TokenType.SEMICOLON, ';', startLine, startColumn)
      case '|': return this.makeToken(TokenType.PIPE, '|', startLine, startColumn)
      case '?': return this.makeToken(TokenType.IDENTIFIER, '?', startLine, startColumn) // Standalone ? is rare
      case '&': throw new LexerError(`Unexpected character: ${c} (did you mean &&?)`, startLine, startColumn)
      default:
        throw new LexerError(`Unexpected character: ${c}`, startLine, startColumn)
    }
  }

  private ensureTokenized(): void {
    if (this.tokens.length === 0) {
      while (true) {
        const token = this.nextToken()
        this.tokens.push(token)
        if (token.type === TokenType.EOF) break
      }
    }
  }

  next(): Token {
    this.ensureTokenized()
    if (this.peeked) {
      const token = this.peeked
      this.peeked = null
      return token
    }
    const token = this.tokens[this.tokenIndex]
    if (token.type !== TokenType.EOF) {
      this.tokenIndex++
    }
    return token
  }

  peekToken(): Token {
    this.ensureTokenized()
    if (this.peeked) return this.peeked
    return this.tokens[this.tokenIndex]
  }

  lookahead(offset: number): Token {
    this.ensureTokenized()
    const idx = this.tokenIndex + offset
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1] // EOF
    }
    return this.tokens[idx]
  }

  position(): { line: number; column: number } {
    const token = this.peekToken()
    return { line: token.line, column: token.column }
  }

  [Symbol.iterator](): Iterator<Token> {
    this.ensureTokenized()
    let index = 0
    const tokens = this.tokens
    return {
      next(): IteratorResult<Token> {
        if (index < tokens.length) {
          return { value: tokens[index++], done: false }
        }
        return { value: undefined as unknown as Token, done: true }
      }
    }
  }
}

// Alias for class method
Lexer.prototype.peek = Lexer.prototype.peekToken

/**
 * Convenience function to tokenize a string
 */
export function tokenize(source: string): Token[] {
  const lexer = new Lexer(source)
  const tokens: Token[] = []

  for (const token of lexer) {
    tokens.push(token)
    if (token.type === TokenType.EOF) break
  }

  // Remove EOF from returned tokens (tests expect it excluded)
  return tokens.filter(t => t.type !== TokenType.EOF)
}
