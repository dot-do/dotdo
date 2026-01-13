/**
 * SOQL Lexer/Tokenizer
 *
 * Tokenizes Salesforce Object Query Language (SOQL) strings.
 * Supports SELECT, FROM, WHERE, ORDER BY, LIMIT, OFFSET, GROUP BY, HAVING
 *
 * @module @dotdo/salesforce/soql/lexer
 */

export enum TokenType {
  // Literals
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',
  DATE = 'DATE',
  DATETIME = 'DATETIME',

  // Identifiers
  IDENTIFIER = 'IDENTIFIER',

  // Keywords
  SELECT = 'SELECT',
  FROM = 'FROM',
  WHERE = 'WHERE',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  IN = 'IN',
  LIKE = 'LIKE',
  ORDER = 'ORDER',
  BY = 'BY',
  ASC = 'ASC',
  DESC = 'DESC',
  NULLS = 'NULLS',
  FIRST = 'FIRST',
  LAST = 'LAST',
  LIMIT = 'LIMIT',
  OFFSET = 'OFFSET',
  GROUP = 'GROUP',
  HAVING = 'HAVING',

  // Aggregate functions
  COUNT = 'COUNT',
  SUM = 'SUM',
  AVG = 'AVG',
  MIN = 'MIN',
  MAX = 'MAX',
  COUNT_DISTINCT = 'COUNT_DISTINCT',

  // Date functions
  CALENDAR_MONTH = 'CALENDAR_MONTH',
  CALENDAR_YEAR = 'CALENDAR_YEAR',
  DAY_IN_MONTH = 'DAY_IN_MONTH',
  DAY_IN_WEEK = 'DAY_IN_WEEK',
  DAY_IN_YEAR = 'DAY_IN_YEAR',
  DAY_ONLY = 'DAY_ONLY',
  FISCAL_MONTH = 'FISCAL_MONTH',
  FISCAL_QUARTER = 'FISCAL_QUARTER',
  FISCAL_YEAR = 'FISCAL_YEAR',
  HOUR_IN_DAY = 'HOUR_IN_DAY',
  WEEK_IN_MONTH = 'WEEK_IN_MONTH',
  WEEK_IN_YEAR = 'WEEK_IN_YEAR',

  // Special date literals
  TODAY = 'TODAY',
  YESTERDAY = 'YESTERDAY',
  TOMORROW = 'TOMORROW',
  LAST_WEEK = 'LAST_WEEK',
  THIS_WEEK = 'THIS_WEEK',
  NEXT_WEEK = 'NEXT_WEEK',
  LAST_MONTH = 'LAST_MONTH',
  THIS_MONTH = 'THIS_MONTH',
  NEXT_MONTH = 'NEXT_MONTH',
  LAST_YEAR = 'LAST_YEAR',
  THIS_YEAR = 'THIS_YEAR',
  NEXT_YEAR = 'NEXT_YEAR',
  LAST_N_DAYS = 'LAST_N_DAYS',
  NEXT_N_DAYS = 'NEXT_N_DAYS',

  // Logical operators
  INCLUDES = 'INCLUDES',
  EXCLUDES = 'EXCLUDES',

  // Relationship query keywords
  TYPEOF = 'TYPEOF',
  WHEN = 'WHEN',
  THEN = 'THEN',
  ELSE = 'ELSE',
  END = 'END',

  // Comparison operators
  EQ = 'EQ',           // =
  NEQ = 'NEQ',         // != or <>
  LT = 'LT',           // <
  GT = 'GT',           // >
  LTE = 'LTE',         // <=
  GTE = 'GTE',         // >=

  // Punctuation
  LPAREN = 'LPAREN',   // (
  RPAREN = 'RPAREN',   // )
  COMMA = 'COMMA',     // ,
  DOT = 'DOT',         // .
  COLON = 'COLON',     // :

  // Control
  EOF = 'EOF',
}

export interface Token {
  type: TokenType
  value: string
  line: number
  column: number
}

const KEYWORDS: Record<string, TokenType> = {
  'select': TokenType.SELECT,
  'from': TokenType.FROM,
  'where': TokenType.WHERE,
  'and': TokenType.AND,
  'or': TokenType.OR,
  'not': TokenType.NOT,
  'in': TokenType.IN,
  'like': TokenType.LIKE,
  'order': TokenType.ORDER,
  'by': TokenType.BY,
  'asc': TokenType.ASC,
  'desc': TokenType.DESC,
  'nulls': TokenType.NULLS,
  'first': TokenType.FIRST,
  'last': TokenType.LAST,
  'limit': TokenType.LIMIT,
  'offset': TokenType.OFFSET,
  'group': TokenType.GROUP,
  'having': TokenType.HAVING,
  'true': TokenType.BOOLEAN,
  'false': TokenType.BOOLEAN,
  'null': TokenType.NULL,

  // Aggregate functions
  'count': TokenType.COUNT,
  'sum': TokenType.SUM,
  'avg': TokenType.AVG,
  'min': TokenType.MIN,
  'max': TokenType.MAX,
  'count_distinct': TokenType.COUNT_DISTINCT,

  // Date functions
  'calendar_month': TokenType.CALENDAR_MONTH,
  'calendar_year': TokenType.CALENDAR_YEAR,
  'day_in_month': TokenType.DAY_IN_MONTH,
  'day_in_week': TokenType.DAY_IN_WEEK,
  'day_in_year': TokenType.DAY_IN_YEAR,
  'day_only': TokenType.DAY_ONLY,
  'fiscal_month': TokenType.FISCAL_MONTH,
  'fiscal_quarter': TokenType.FISCAL_QUARTER,
  'fiscal_year': TokenType.FISCAL_YEAR,
  'hour_in_day': TokenType.HOUR_IN_DAY,
  'week_in_month': TokenType.WEEK_IN_MONTH,
  'week_in_year': TokenType.WEEK_IN_YEAR,

  // Special date literals
  'today': TokenType.TODAY,
  'yesterday': TokenType.YESTERDAY,
  'tomorrow': TokenType.TOMORROW,
  'last_week': TokenType.LAST_WEEK,
  'this_week': TokenType.THIS_WEEK,
  'next_week': TokenType.NEXT_WEEK,
  'last_month': TokenType.LAST_MONTH,
  'this_month': TokenType.THIS_MONTH,
  'next_month': TokenType.NEXT_MONTH,
  'last_year': TokenType.LAST_YEAR,
  'this_year': TokenType.THIS_YEAR,
  'next_year': TokenType.NEXT_YEAR,
  'last_n_days': TokenType.LAST_N_DAYS,
  'next_n_days': TokenType.NEXT_N_DAYS,

  // Multipicklist operators
  'includes': TokenType.INCLUDES,
  'excludes': TokenType.EXCLUDES,

  // TYPEOF keywords
  'typeof': TokenType.TYPEOF,
  'when': TokenType.WHEN,
  'then': TokenType.THEN,
  'else': TokenType.ELSE,
  'end': TokenType.END,
}

export class LexerError extends Error {
  line: number
  column: number

  constructor(message: string, line: number, column: number) {
    super(`SOQL Lexer Error: ${message} at line ${line}, column ${column}`)
    this.name = 'SOQLLexerError'
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

  private skipWhitespace(): void {
    while (!this.isAtEnd) {
      const c = this.current
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        this.advance()
      } else {
        break
      }
    }
  }

  private makeToken(type: TokenType, value: string, startLine: number, startColumn: number): Token {
    return { type, value, line: startLine, column: startColumn }
  }

  private string(): Token {
    const startLine = this.line
    const startColumn = this.column
    const quote = this.advance() // consume opening quote (' in SOQL)

    let value = ''

    while (!this.isAtEnd && this.current !== quote) {
      if (this.current === '\\') {
        this.advance()
        switch (this.current) {
          case 'n': value += '\n'; break
          case 't': value += '\t'; break
          case 'r': value += '\r'; break
          case '\\': value += '\\'; break
          case "'": value += "'"; break
          default: value += this.current
        }
        this.advance()
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

    return this.makeToken(TokenType.STRING, value, startLine, startColumn)
  }

  private number(): Token {
    const startLine = this.line
    const startColumn = this.column
    let value = ''

    // Optional leading minus
    if (this.current === '-') {
      value += this.advance()
    }

    // Integer part
    while (!this.isAtEnd && /[0-9]/.test(this.current)) {
      value += this.advance()
    }

    // Decimal part
    if (this.current === '.') {
      const nextChar = this.peekChar(1)
      if (/[0-9]/.test(nextChar)) {
        value += this.advance() // consume '.'
        while (!this.isAtEnd && /[0-9]/.test(this.current)) {
          value += this.advance()
        }
      }
    }

    return this.makeToken(TokenType.NUMBER, value, startLine, startColumn)
  }

  private identifier(): Token {
    const startLine = this.line
    const startColumn = this.column
    let value = ''

    // Allow alphanumeric, underscore, and currency symbols for custom fields
    while (!this.isAtEnd && /[a-zA-Z0-9_$]/.test(this.current)) {
      value += this.advance()
    }

    // Check for keywords (case-insensitive)
    const lowerValue = value.toLowerCase()
    const type = KEYWORDS[lowerValue] || TokenType.IDENTIFIER

    return this.makeToken(type, value, startLine, startColumn)
  }

  private dateOrDatetime(): Token | null {
    // Check for date literal patterns like 2024-01-15 or 2024-01-15T10:30:00Z
    const startLine = this.line
    const startColumn = this.column
    const startPos = this.pos

    // Try to match YYYY-MM-DD pattern
    let value = ''

    // Year
    for (let i = 0; i < 4; i++) {
      if (/[0-9]/.test(this.current)) {
        value += this.advance()
      } else {
        // Not a date, reset
        this.pos = startPos
        this.column = startColumn
        return null
      }
    }

    if (this.current !== '-') {
      this.pos = startPos
      this.column = startColumn
      return null
    }
    value += this.advance()

    // Month
    for (let i = 0; i < 2; i++) {
      if (/[0-9]/.test(this.current)) {
        value += this.advance()
      } else {
        this.pos = startPos
        this.column = startColumn
        return null
      }
    }

    if (this.current !== '-') {
      this.pos = startPos
      this.column = startColumn
      return null
    }
    value += this.advance()

    // Day
    for (let i = 0; i < 2; i++) {
      if (/[0-9]/.test(this.current)) {
        value += this.advance()
      } else {
        this.pos = startPos
        this.column = startColumn
        return null
      }
    }

    // Check for time component (T)
    if (this.current === 'T') {
      value += this.advance()

      // Parse time HH:MM:SS
      for (let i = 0; i < 2; i++) {
        if (/[0-9]/.test(this.current)) value += this.advance()
      }
      if (this.current === ':') {
        value += this.advance()
        for (let i = 0; i < 2; i++) {
          if (/[0-9]/.test(this.current)) value += this.advance()
        }
        if (this.current === ':') {
          value += this.advance()
          for (let i = 0; i < 2; i++) {
            if (/[0-9]/.test(this.current)) value += this.advance()
          }
        }
      }

      // Timezone (Z or +/-HH:MM)
      if (this.current === 'Z') {
        value += this.advance()
      } else if (this.current === '+' || this.current === '-') {
        value += this.advance()
        for (let i = 0; i < 2; i++) {
          if (/[0-9]/.test(this.current)) value += this.advance()
        }
        if (this.current === ':') {
          value += this.advance()
          for (let i = 0; i < 2; i++) {
            if (/[0-9]/.test(this.current)) value += this.advance()
          }
        }
      }

      return this.makeToken(TokenType.DATETIME, value, startLine, startColumn)
    }

    return this.makeToken(TokenType.DATE, value, startLine, startColumn)
  }

  private nextToken(): Token {
    this.skipWhitespace()

    if (this.isAtEnd) {
      return this.makeToken(TokenType.EOF, '', this.line, this.column)
    }

    const startLine = this.line
    const startColumn = this.column
    const c = this.current

    // String literals (SOQL uses single quotes)
    if (c === "'") {
      return this.string()
    }

    // Numbers (including negative numbers)
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(this.peekChar(1)))) {
      // Try date/datetime first
      const dateToken = this.dateOrDatetime()
      if (dateToken) return dateToken
      return this.number()
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(c)) {
      return this.identifier()
    }

    // Two-character operators
    if (c === '!' && this.peekChar(1) === '=') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.NEQ, '!=', startLine, startColumn)
    }
    if (c === '<' && this.peekChar(1) === '>') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.NEQ, '<>', startLine, startColumn)
    }
    if (c === '<' && this.peekChar(1) === '=') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.LTE, '<=', startLine, startColumn)
    }
    if (c === '>' && this.peekChar(1) === '=') {
      this.advance(); this.advance()
      return this.makeToken(TokenType.GTE, '>=', startLine, startColumn)
    }

    // Single-character tokens
    this.advance()
    switch (c) {
      case '=': return this.makeToken(TokenType.EQ, '=', startLine, startColumn)
      case '<': return this.makeToken(TokenType.LT, '<', startLine, startColumn)
      case '>': return this.makeToken(TokenType.GT, '>', startLine, startColumn)
      case '(': return this.makeToken(TokenType.LPAREN, '(', startLine, startColumn)
      case ')': return this.makeToken(TokenType.RPAREN, ')', startLine, startColumn)
      case ',': return this.makeToken(TokenType.COMMA, ',', startLine, startColumn)
      case '.': return this.makeToken(TokenType.DOT, '.', startLine, startColumn)
      case ':': return this.makeToken(TokenType.COLON, ':', startLine, startColumn)
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
    const token = this.tokens[this.tokenIndex]
    if (token.type !== TokenType.EOF) {
      this.tokenIndex++
    }
    return token
  }

  peek(): Token {
    this.ensureTokenized()
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
    const token = this.peek()
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

/**
 * Convenience function to tokenize a SOQL string
 */
export function tokenize(source: string): Token[] {
  const lexer = new Lexer(source)
  const tokens: Token[] = []

  for (const token of lexer) {
    tokens.push(token)
    if (token.type === TokenType.EOF) break
  }

  return tokens.filter(t => t.type !== TokenType.EOF)
}
