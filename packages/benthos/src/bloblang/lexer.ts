/**
 * Bloblang Lexer
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Tokenizes Bloblang source code.
 */

export enum TokenType {
  // Literals
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',

  // Identifiers
  IDENTIFIER = 'IDENTIFIER',
  ENV_VAR = 'ENV_VAR',

  // Keywords
  ROOT = 'ROOT',
  THIS = 'THIS',
  META = 'META',
  DELETED = 'DELETED',
  NOTHING = 'NOTHING',
  IF = 'IF',
  ELSE = 'ELSE',
  MATCH = 'MATCH',
  LET = 'LET',
  IN = 'IN',
  MAP = 'MAP',
  ERROR = 'ERROR',

  // Operators
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  STAR = 'STAR',
  SLASH = 'SLASH',
  PERCENT = 'PERCENT',
  EQ = 'EQ',
  NEQ = 'NEQ',
  LT = 'LT',
  GT = 'GT',
  LTE = 'LTE',
  GTE = 'GTE',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  ASSIGN = 'ASSIGN',
  PIPE = 'PIPE',
  ARROW = 'ARROW',
  OPTIONAL_CHAIN = 'OPTIONAL_CHAIN',

  // Punctuation
  DOT = 'DOT',
  COMMA = 'COMMA',
  COLON = 'COLON',
  SEMICOLON = 'SEMICOLON',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',

  // Special
  EOF = 'EOF',
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
  'deleted': TokenType.DELETED,
  'nothing': TokenType.NOTHING,
  'if': TokenType.IF,
  'else': TokenType.ELSE,
  'match': TokenType.MATCH,
  'let': TokenType.LET,
  'in': TokenType.IN,
  'map': TokenType.MAP,
  'true': TokenType.BOOLEAN,
  'false': TokenType.BOOLEAN,
  'null': TokenType.NULL,
  'error': TokenType.ERROR,
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

export class Lexer {
  private source: string
  private pos: number = 0
  private line: number = 1
  private column: number = 1
  private lookaheadBuffer: Token[] = []

  constructor(source: string) {
    this.source = source
  }

  private peek(offset: number = 0): string {
    return this.source[this.pos + offset] ?? ''
  }

  private advance(): string {
    const char = this.source[this.pos]
    this.pos++
    if (char === '\n') {
      this.line++
      this.column = 1
    } else {
      this.column++
    }
    return char
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length) {
      const char = this.peek()
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        this.advance()
      } else if (char === '#') {
        // Skip line comments
        while (this.peek() !== '\n' && this.pos < this.source.length) {
          this.advance()
        }
      } else {
        break
      }
    }
  }

  private readString(quote: string): Token {
    const startLine = this.line
    const startColumn = this.column
    let value = ''

    this.advance() // consume opening quote

    while (this.pos < this.source.length) {
      const char = this.peek()

      if (char === quote) {
        this.advance()
        return { type: TokenType.STRING, value, line: startLine, column: startColumn }
      }

      if (char === '\\') {
        this.advance()
        const escaped = this.advance()
        switch (escaped) {
          case 'n': value += '\n'; break
          case 't': value += '\t'; break
          case 'r': value += '\r'; break
          case '\\': value += '\\'; break
          case '"': value += '"'; break
          case "'": value += "'"; break
          default: value += escaped
        }
      } else if (char === '\n') {
        throw new LexerError('Unterminated string literal', startLine, startColumn)
      } else {
        value += this.advance()
      }
    }

    throw new LexerError('Unterminated string literal', startLine, startColumn)
  }

  private readNumber(): Token {
    const startLine = this.line
    const startColumn = this.column
    let value = ''

    // Handle negative numbers
    if (this.peek() === '-') {
      value += this.advance()
    }

    // Integer part
    while (/[0-9]/.test(this.peek())) {
      value += this.advance()
    }

    // Decimal part
    if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
      value += this.advance() // .
      while (/[0-9]/.test(this.peek())) {
        value += this.advance()
      }
    }

    // Exponent part
    if (this.peek() === 'e' || this.peek() === 'E') {
      value += this.advance()
      if (this.peek() === '+' || this.peek() === '-') {
        value += this.advance()
      }
      while (/[0-9]/.test(this.peek())) {
        value += this.advance()
      }
    }

    return { type: TokenType.NUMBER, value, line: startLine, column: startColumn }
  }

  private readIdentifier(): Token {
    const startLine = this.line
    const startColumn = this.column
    let value = ''

    while (/[a-zA-Z0-9_]/.test(this.peek())) {
      value += this.advance()
    }

    const type = KEYWORDS[value] ?? TokenType.IDENTIFIER

    return { type, value, line: startLine, column: startColumn }
  }

  private readEnvVar(): Token {
    const startLine = this.line
    const startColumn = this.column

    this.advance() // consume $

    let value = ''
    while (/[a-zA-Z0-9_]/.test(this.peek())) {
      value += this.advance()
    }

    return { type: TokenType.ENV_VAR, value, line: startLine, column: startColumn }
  }

  private nextToken(): Token {
    this.skipWhitespace()

    if (this.pos >= this.source.length) {
      return { type: TokenType.EOF, value: '', line: this.line, column: this.column }
    }

    const startLine = this.line
    const startColumn = this.column
    const char = this.peek()

    // String literals
    if (char === '"' || char === "'") {
      return this.readString(char)
    }

    // Numbers
    if (/[0-9]/.test(char)) {
      return this.readNumber()
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      return this.readIdentifier()
    }

    // Environment/local variables
    if (char === '$') {
      return this.readEnvVar()
    }

    // Two-character operators
    const twoChar = this.peek(0) + this.peek(1)
    switch (twoChar) {
      case '==':
        this.advance(); this.advance()
        return { type: TokenType.EQ, value: '==', line: startLine, column: startColumn }
      case '!=':
        this.advance(); this.advance()
        return { type: TokenType.NEQ, value: '!=', line: startLine, column: startColumn }
      case '<=':
        this.advance(); this.advance()
        return { type: TokenType.LTE, value: '<=', line: startLine, column: startColumn }
      case '>=':
        this.advance(); this.advance()
        return { type: TokenType.GTE, value: '>=', line: startLine, column: startColumn }
      case '&&':
        this.advance(); this.advance()
        return { type: TokenType.AND, value: '&&', line: startLine, column: startColumn }
      case '||':
        this.advance(); this.advance()
        return { type: TokenType.OR, value: '||', line: startLine, column: startColumn }
      case '->':
        this.advance(); this.advance()
        return { type: TokenType.ARROW, value: '->', line: startLine, column: startColumn }
      case '?.':
        this.advance(); this.advance()
        return { type: TokenType.OPTIONAL_CHAIN, value: '?.', line: startLine, column: startColumn }
    }

    // Single-character operators and punctuation
    this.advance()
    switch (char) {
      case '+': return { type: TokenType.PLUS, value: '+', line: startLine, column: startColumn }
      case '-': return { type: TokenType.MINUS, value: '-', line: startLine, column: startColumn }
      case '*': return { type: TokenType.STAR, value: '*', line: startLine, column: startColumn }
      case '/': return { type: TokenType.SLASH, value: '/', line: startLine, column: startColumn }
      case '%': return { type: TokenType.PERCENT, value: '%', line: startLine, column: startColumn }
      case '<': return { type: TokenType.LT, value: '<', line: startLine, column: startColumn }
      case '>': return { type: TokenType.GT, value: '>', line: startLine, column: startColumn }
      case '!': return { type: TokenType.NOT, value: '!', line: startLine, column: startColumn }
      case '=': return { type: TokenType.ASSIGN, value: '=', line: startLine, column: startColumn }
      case '|': return { type: TokenType.PIPE, value: '|', line: startLine, column: startColumn }
      case '.': return { type: TokenType.DOT, value: '.', line: startLine, column: startColumn }
      case ',': return { type: TokenType.COMMA, value: ',', line: startLine, column: startColumn }
      case ':': return { type: TokenType.COLON, value: ':', line: startLine, column: startColumn }
      case ';': return { type: TokenType.SEMICOLON, value: ';', line: startLine, column: startColumn }
      case '(': return { type: TokenType.LPAREN, value: '(', line: startLine, column: startColumn }
      case ')': return { type: TokenType.RPAREN, value: ')', line: startLine, column: startColumn }
      case '[': return { type: TokenType.LBRACKET, value: '[', line: startLine, column: startColumn }
      case ']': return { type: TokenType.RBRACKET, value: ']', line: startLine, column: startColumn }
      case '{': return { type: TokenType.LBRACE, value: '{', line: startLine, column: startColumn }
      case '}': return { type: TokenType.RBRACE, value: '}', line: startLine, column: startColumn }
    }

    throw new LexerError(`Unexpected character: ${char}`, startLine, startColumn)
  }

  next(): Token {
    if (this.lookaheadBuffer.length > 0) {
      return this.lookaheadBuffer.shift()!
    }
    return this.nextToken()
  }

  lookahead(offset: number): Token {
    while (this.lookaheadBuffer.length <= offset) {
      this.lookaheadBuffer.push(this.nextToken())
    }
    return this.lookaheadBuffer[offset]
  }
}
