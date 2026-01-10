/**
 * EdgeQL Lexer Implementation
 *
 * Hand-rolled recursive descent lexer for EdgeQL queries.
 * Optimized for bundle size efficiency per spike findings.
 *
 * @see dotdo-nu24u - GREEN: EdgeQL Lexer - Implementation
 */

import type { Token as TokenInterface } from './lexer-types'
export { TokenType, LexerError } from './lexer-types'
export type Token = TokenInterface

import { TokenType, LexerError } from './lexer-types'

export interface TokenizeOptions {
  /** If true, include comment tokens in output */
  preserveComments?: boolean
}

// ============================================================================
// KEYWORD MAP
// ============================================================================

const KEYWORDS: Record<string, TokenType> = {
  select: TokenType.SELECT,
  insert: TokenType.INSERT,
  update: TokenType.UPDATE,
  delete: TokenType.DELETE,
  filter: TokenType.FILTER,
  order: TokenType.ORDER,
  by: TokenType.BY,
  limit: TokenType.LIMIT,
  offset: TokenType.OFFSET,
  with: TokenType.WITH,
  for: TokenType.FOR,
  if: TokenType.IF,
  else: TokenType.ELSE,
  and: TokenType.AND,
  or: TokenType.OR,
  not: TokenType.NOT,
  in: TokenType.IN,
  like: TokenType.LIKE,
  ilike: TokenType.ILIKE,
  is: TokenType.IS,
  exists: TokenType.EXISTS,
  distinct: TokenType.DISTINCT,
  union: TokenType.UNION,
  intersect: TokenType.INTERSECT,
  except: TokenType.EXCEPT,
  true: TokenType.TRUE,
  false: TokenType.FALSE,
  required: TokenType.REQUIRED,
  optional: TokenType.OPTIONAL,
  multi: TokenType.MULTI,
  single: TokenType.SINGLE,
  abstract: TokenType.ABSTRACT,
  type: TokenType.TYPE,
  scalar: TokenType.SCALAR,
  enum: TokenType.ENUM,
  constraint: TokenType.CONSTRAINT,
  index: TokenType.INDEX,
  annotation: TokenType.ANNOTATION,
  module: TokenType.MODULE,
  alias: TokenType.ALIAS,
  function: TokenType.FUNCTION,
  property: TokenType.PROPERTY,
  link: TokenType.LINK,
  extending: TokenType.EXTENDING,
}

// ============================================================================
// LEXER CLASS
// ============================================================================

class Lexer {
  private source: string
  private pos: number = 0
  private line: number = 1
  private column: number = 1
  private tokens: Token[] = []
  private preserveComments: boolean

  constructor(source: string, options?: TokenizeOptions) {
    this.source = source
    this.preserveComments = options?.preserveComments ?? false
  }

  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      this.scanToken()
    }

    this.addToken(TokenType.EOF, '')
    return this.tokens
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length
  }

  private peek(offset: number = 0): string {
    const idx = this.pos + offset
    return idx < this.source.length ? this.source[idx] : ''
  }

  private advance(): string {
    const ch = this.source[this.pos]
    this.pos++
    if (ch === '\n') {
      this.line++
      this.column = 1
    } else if (ch === '\r') {
      // Handle CR (old Mac) and CRLF (Windows)
      if (this.peek() !== '\n') {
        this.line++
        this.column = 1
      }
    } else {
      this.column++
    }
    return ch
  }

  private addToken(type: TokenType, value: string, startPos?: number, startLine?: number, startColumn?: number): void {
    this.tokens.push({
      type,
      value,
      position: startPos ?? this.pos - value.length,
      line: startLine ?? this.line,
      column: startColumn ?? this.column - value.length,
    })
  }

  private scanToken(): void {
    const startPos = this.pos
    const startLine = this.line
    const startColumn = this.column
    const ch = this.advance()

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      return
    }

    // Comments
    if (ch === '#') {
      this.scanComment(startPos, startLine, startColumn)
      return
    }

    // Strings
    if (ch === "'" || ch === '"') {
      this.scanString(ch, startPos, startLine, startColumn, false)
      return
    }

    // Raw strings (r'...' or r"...")
    if (ch === 'r' && (this.peek() === "'" || this.peek() === '"')) {
      const quote = this.advance()
      this.scanString(quote, startPos, startLine, startColumn, true)
      return
    }

    // Numbers (including decimals starting with .)
    if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.peek()))) {
      this.scanNumber(ch, startPos, startLine, startColumn)
      return
    }

    // Identifiers and keywords
    if (this.isIdentifierStart(ch)) {
      this.scanIdentifier(ch, startPos, startLine, startColumn)
      return
    }

    // Backtick-quoted identifiers
    if (ch === '`') {
      this.scanQuotedIdentifier(startPos, startLine, startColumn)
      return
    }

    // Parameters ($name or $1)
    if (ch === '$') {
      this.scanParameter(startPos, startLine, startColumn)
      return
    }

    // Operators and delimiters
    this.scanOperatorOrDelimiter(ch, startPos, startLine, startColumn)
  }

  private scanComment(startPos: number, startLine: number, startColumn: number): void {
    const start = this.pos - 1 // include the #
    while (!this.isAtEnd() && this.peek() !== '\n' && this.peek() !== '\r') {
      this.advance()
    }
    if (this.preserveComments) {
      const value = this.source.slice(start, this.pos)
      this.addToken(TokenType.COMMENT, value, startPos, startLine, startColumn)
    }
  }

  private scanString(quote: string, startPos: number, startLine: number, startColumn: number, isRaw: boolean): void {
    // Check for triple-quoted string
    const isTriple = this.peek() === quote && this.peek(1) === quote
    if (isTriple) {
      this.advance() // consume second quote
      this.advance() // consume third quote
    }

    let value = ''
    const endSequence = isTriple ? quote + quote + quote : quote

    while (!this.isAtEnd()) {
      if (isTriple) {
        // Check for triple quote end
        if (this.peek() === quote && this.peek(1) === quote && this.peek(2) === quote) {
          this.advance()
          this.advance()
          this.advance()
          this.addToken(TokenType.STRING, value, startPos, startLine, startColumn)
          return
        }
      } else {
        // Single quote end
        if (this.peek() === quote) {
          this.advance()
          this.addToken(TokenType.STRING, value, startPos, startLine, startColumn)
          return
        }
      }

      const ch = this.advance()

      // Handle escapes (but not in raw strings)
      if (ch === '\\' && !isRaw) {
        if (this.isAtEnd()) {
          throw new LexerError('unterminated string', this.line, this.column, this.pos)
        }
        const escaped = this.advance()
        switch (escaped) {
          case 'n':
            value += '\n'
            break
          case 't':
            value += '\t'
            break
          case 'r':
            value += '\r'
            break
          case '\\':
            value += '\\'
            break
          case "'":
            value += "'"
            break
          case '"':
            value += '"'
            break
          case 'u':
            value += this.scanUnicodeEscape(4)
            break
          case 'U':
            value += this.scanUnicodeEscape(8)
            break
          default:
            throw new LexerError(`Invalid escape sequence: \\${escaped}`, this.line, this.column - 1, this.pos - 1)
        }
      } else {
        value += ch
      }
    }

    throw new LexerError('unterminated string', startLine, startColumn, startPos)
  }

  private scanUnicodeEscape(length: number): string {
    let hex = ''
    for (let i = 0; i < length; i++) {
      if (this.isAtEnd() || !this.isHexDigit(this.peek())) {
        throw new LexerError('Invalid unicode escape sequence', this.line, this.column, this.pos)
      }
      hex += this.advance()
    }
    const codePoint = parseInt(hex, 16)
    return String.fromCodePoint(codePoint)
  }

  private scanNumber(firstChar: string, startPos: number, startLine: number, startColumn: number): void {
    let value = firstChar

    // Check for hex, octal, binary
    if (firstChar === '0' && (this.peek() === 'x' || this.peek() === 'X')) {
      value += this.advance() // x or X
      while (this.isHexDigit(this.peek()) || this.peek() === '_') {
        value += this.advance()
      }
      this.addToken(TokenType.NUMBER, value, startPos, startLine, startColumn)
      return
    }

    if (firstChar === '0' && (this.peek() === 'o' || this.peek() === 'O')) {
      value += this.advance() // o or O
      while (this.isOctalDigit(this.peek()) || this.peek() === '_') {
        value += this.advance()
      }
      this.addToken(TokenType.NUMBER, value, startPos, startLine, startColumn)
      return
    }

    if (firstChar === '0' && (this.peek() === 'b' || this.peek() === 'B')) {
      value += this.advance() // b or B
      while (this.peek() === '0' || this.peek() === '1' || this.peek() === '_') {
        value += this.advance()
      }
      this.addToken(TokenType.NUMBER, value, startPos, startLine, startColumn)
      return
    }

    // Check for UUID (starts with hex digit, has specific format)
    if (this.isHexDigit(firstChar) && this.couldBeUUID(firstChar)) {
      const maybeUUID = this.tryParseUUID(firstChar, startPos, startLine, startColumn)
      if (maybeUUID) {
        return
      }
    }

    // Regular number - integer part
    while (this.isDigit(this.peek()) || this.peek() === '_') {
      value += this.advance()
    }

    // Decimal part
    if (this.peek() === '.' && (this.isDigit(this.peek(1)) || this.peek(1) === '_')) {
      value += this.advance() // .
      while (this.isDigit(this.peek()) || this.peek() === '_') {
        value += this.advance()
      }
    } else if (firstChar === '.') {
      // Already consumed ., now get the digits
      while (this.isDigit(this.peek()) || this.peek() === '_') {
        value += this.advance()
      }
    }

    // Exponent part
    if (this.peek() === 'e' || this.peek() === 'E') {
      value += this.advance()
      if (this.peek() === '+' || this.peek() === '-') {
        value += this.advance()
      }
      while (this.isDigit(this.peek()) || this.peek() === '_') {
        value += this.advance()
      }
    }

    // BigInt suffix
    if (this.peek() === 'n') {
      value += this.advance()
    }

    this.addToken(TokenType.NUMBER, value, startPos, startLine, startColumn)
  }

  private couldBeUUID(firstChar: string): boolean {
    // Check if we have enough characters for a UUID (36 chars total including hyphens)
    // Format: 8-4-4-4-12
    if (this.pos + 35 > this.source.length) return false
    // First segment needs to be 7 more hex chars after the first
    for (let i = 0; i < 7; i++) {
      if (!this.isHexDigit(this.peek(i))) return false
    }
    // Then a hyphen
    if (this.peek(7) !== '-') return false
    return true
  }

  private tryParseUUID(firstChar: string, startPos: number, startLine: number, startColumn: number): boolean {
    // Try to parse as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    // We've already consumed the first character
    const savedPos = this.pos
    const savedLine = this.line
    const savedColumn = this.column

    let value = firstChar

    // First segment: 7 more hex digits (we have 1 already)
    for (let i = 0; i < 7; i++) {
      if (!this.isHexDigit(this.peek())) {
        return false
      }
      value += this.advance()
    }

    // Parse remaining segments: 4-4-4-12 (with leading hyphen handled by parseUUIDSegments)
    const remaining = this.parseUUIDSegments([4, 4, 4, 12])
    if (remaining === null) {
      this.restorePosition(savedPos, savedLine, savedColumn)
      return false
    }

    this.addToken(TokenType.UUID, value + remaining, startPos, startLine, startColumn)
    return true
  }

  private restorePosition(pos: number, line: number, column: number): void {
    this.pos = pos
    this.line = line
    this.column = column
  }

  private scanIdentifier(firstChar: string, startPos: number, startLine: number, startColumn: number): void {
    let value = firstChar
    while (this.isIdentifierPart(this.peek())) {
      value += this.advance()
    }

    // Check if it could be a UUID (8 hex chars followed by hyphen pattern)
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    if (value.length === 8 && this.isAllHex(value) && this.peek() === '-') {
      const maybeUUID = this.tryParseUUIDFromIdentifier(value, startPos, startLine, startColumn)
      if (maybeUUID) {
        return
      }
    }

    // Check if it's a keyword (case-insensitive)
    const keywordType = KEYWORDS[value.toLowerCase()]
    if (keywordType) {
      this.addToken(keywordType, value, startPos, startLine, startColumn)
    } else {
      this.addToken(TokenType.IDENTIFIER, value, startPos, startLine, startColumn)
    }
  }

  private isAllHex(s: string): boolean {
    return /^[0-9a-fA-F]+$/.test(s)
  }

  /** Parse UUID segments. Expects hyphen before each segment. Returns collected value or null if failed. */
  private parseUUIDSegments(segments: number[]): string | null {
    let value = ''
    for (const count of segments) {
      if (this.peek() !== '-') return null
      value += this.advance()
      for (let j = 0; j < count; j++) {
        if (!this.isHexDigit(this.peek())) return null
        value += this.advance()
      }
    }
    return value
  }

  private tryParseUUIDFromIdentifier(prefix: string, startPos: number, startLine: number, startColumn: number): boolean {
    // We have 8 hex chars, now need -xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const savedPos = this.pos
    const savedLine = this.line
    const savedColumn = this.column

    // Parse remaining segments: 4-4-4-12
    const remaining = this.parseUUIDSegments([4, 4, 4, 12])
    if (remaining === null) {
      this.restorePosition(savedPos, savedLine, savedColumn)
      return false
    }

    this.addToken(TokenType.UUID, prefix + remaining, startPos, startLine, startColumn)
    return true
  }

  private scanQuotedIdentifier(startPos: number, startLine: number, startColumn: number): void {
    let value = ''
    while (!this.isAtEnd() && this.peek() !== '`') {
      value += this.advance()
    }
    if (this.isAtEnd()) {
      throw new LexerError('Unterminated quoted identifier', startLine, startColumn, startPos)
    }
    this.advance() // consume closing backtick
    this.addToken(TokenType.IDENTIFIER, value, startPos, startLine, startColumn)
  }

  private scanParameter(startPos: number, startLine: number, startColumn: number): void {
    let value = '$'
    // Parameter can be $name or $123
    if (this.isDigit(this.peek())) {
      // Positional parameter
      while (this.isDigit(this.peek())) {
        value += this.advance()
      }
    } else if (this.isIdentifierStart(this.peek())) {
      // Named parameter
      while (this.isIdentifierPart(this.peek())) {
        value += this.advance()
      }
    }
    this.addToken(TokenType.PARAMETER, value, startPos, startLine, startColumn)
  }

  private scanOperatorOrDelimiter(ch: string, startPos: number, startLine: number, startColumn: number): void {
    switch (ch) {
      case '{':
        this.addToken(TokenType.LBRACE, ch, startPos, startLine, startColumn)
        break
      case '}':
        this.addToken(TokenType.RBRACE, ch, startPos, startLine, startColumn)
        break
      case '(':
        this.addToken(TokenType.LPAREN, ch, startPos, startLine, startColumn)
        break
      case ')':
        this.addToken(TokenType.RPAREN, ch, startPos, startLine, startColumn)
        break
      case '[':
        this.addToken(TokenType.LBRACKET, ch, startPos, startLine, startColumn)
        break
      case ']':
        this.addToken(TokenType.RBRACKET, ch, startPos, startLine, startColumn)
        break
      case ',':
        this.addToken(TokenType.COMMA, ch, startPos, startLine, startColumn)
        break
      case ';':
        this.addToken(TokenType.SEMICOLON, ch, startPos, startLine, startColumn)
        break
      case ':':
        if (this.peek() === '=') {
          this.advance()
          this.addToken(TokenType.ASSIGN, ':=', startPos, startLine, startColumn)
        } else if (this.peek() === ':') {
          this.advance()
          this.addToken(TokenType.NAMESPACE, '::', startPos, startLine, startColumn)
        } else {
          this.addToken(TokenType.COLON, ch, startPos, startLine, startColumn)
        }
        break
      case '.':
        if (this.peek() === '>') {
          this.advance()
          this.addToken(TokenType.FORWARD_LINK, '.>', startPos, startLine, startColumn)
        } else if (this.peek() === '<') {
          this.advance()
          this.addToken(TokenType.BACKWARD_LINK, '.<', startPos, startLine, startColumn)
        } else {
          this.addToken(TokenType.DOT, ch, startPos, startLine, startColumn)
        }
        break
      case '-':
        if (this.peek() === '>') {
          this.advance()
          this.addToken(TokenType.ARROW, '->', startPos, startLine, startColumn)
        } else {
          this.addToken(TokenType.MINUS, ch, startPos, startLine, startColumn)
        }
        break
      case '+':
        if (this.peek() === '+') {
          this.advance()
          this.addToken(TokenType.CONCAT, '++', startPos, startLine, startColumn)
        } else {
          this.addToken(TokenType.PLUS, ch, startPos, startLine, startColumn)
        }
        break
      case '?':
        if (this.peek() === '?') {
          this.advance()
          this.addToken(TokenType.COALESCE, '??', startPos, startLine, startColumn)
        } else {
          throw new LexerError(`Unexpected character: ${ch}`, startLine, startColumn, startPos)
        }
        break
      case '=':
        this.addToken(TokenType.EQUALS, ch, startPos, startLine, startColumn)
        break
      case '!':
        if (this.peek() === '=') {
          this.advance()
          this.addToken(TokenType.NOT_EQUALS, '!=', startPos, startLine, startColumn)
        } else {
          throw new LexerError(`Unexpected character: ${ch}`, startLine, startColumn, startPos)
        }
        break
      case '<':
        if (this.peek() === '=') {
          this.advance()
          this.addToken(TokenType.LESS_EQUAL, '<=', startPos, startLine, startColumn)
        } else {
          this.addToken(TokenType.LESS_THAN, ch, startPos, startLine, startColumn)
        }
        break
      case '>':
        if (this.peek() === '=') {
          this.advance()
          this.addToken(TokenType.GREATER_EQUAL, '>=', startPos, startLine, startColumn)
        } else {
          this.addToken(TokenType.GREATER_THAN, ch, startPos, startLine, startColumn)
        }
        break
      case '*':
        this.addToken(TokenType.MULTIPLY, ch, startPos, startLine, startColumn)
        break
      case '/':
        this.addToken(TokenType.DIVIDE, ch, startPos, startLine, startColumn)
        break
      case '%':
        this.addToken(TokenType.MODULO, ch, startPos, startLine, startColumn)
        break
      case '^':
        this.addToken(TokenType.POWER, ch, startPos, startLine, startColumn)
        break
      case '@':
        this.addToken(TokenType.AT, ch, startPos, startLine, startColumn)
        break
      default:
        throw new LexerError(`Unexpected character: ${ch}`, startLine, startColumn, startPos)
    }
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9'
  }

  private isHexDigit(ch: string): boolean {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
  }

  private isOctalDigit(ch: string): boolean {
    return ch >= '0' && ch <= '7'
  }

  private isIdentifierStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch.charCodeAt(0) > 127
  }

  private isIdentifierPart(ch: string): boolean {
    return this.isIdentifierStart(ch) || this.isDigit(ch)
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Tokenize EdgeQL source code into tokens
 *
 * @param source - EdgeQL source code string
 * @param options - Optional tokenization options
 * @returns Array of tokens ending with EOF
 * @throws LexerError on invalid input
 */
export function tokenize(source: string, options?: TokenizeOptions): Token[] {
  const lexer = new Lexer(source, options)
  return lexer.tokenize()
}

export default {
  tokenize,
  TokenType,
}
