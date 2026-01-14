/**
 * ClickHouse SQL Parser - TypeScript Implementation
 *
 * This is a spike implementation following the LexerStandalone.h pattern from ClickHouse,
 * designed to work in WASM/Workers environments without native dependencies.
 *
 * Based on ClickHouse's Lexer.cpp and ParserSelectQuery.cpp
 */

// ============================================================================
// Token Types (matching ClickHouse's Lexer.h)
// ============================================================================

export enum TokenType {
  Whitespace = 'Whitespace',
  Comment = 'Comment',

  BareWord = 'BareWord', // Either keyword (SELECT) or identifier (column)
  Number = 'Number', // Always non-negative. 123, 123.456e12, 0x123p12
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
// Lexer (following ClickHouse's Lexer.cpp pattern)
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

// ============================================================================
// AST Node Types
// ============================================================================

export type ASTNode =
  | SelectQueryNode
  | CreateTableNode
  | ExpressionNode
  | IdentifierNode
  | LiteralNode
  | FunctionCallNode
  | BinaryOpNode
  | JSONPathNode
  | ArrayLiteralNode
  | ColumnDefNode
  | EngineNode
  | TableIdentifierNode
  | StarNode
  | AliasNode
  | OrderByElementNode

export interface SelectQueryNode {
  type: 'SelectQuery'
  columns: ExpressionNode[]
  from?: TableIdentifierNode
  where?: ExpressionNode
  orderBy?: OrderByElementNode[]
  limit?: LiteralNode
  distinct?: boolean
}

export interface CreateTableNode {
  type: 'CreateTable'
  table: TableIdentifierNode
  columns: ColumnDefNode[]
  engine?: EngineNode
  ifNotExists?: boolean
}

export interface ColumnDefNode {
  type: 'ColumnDef'
  name: string
  dataType: string
}

export interface EngineNode {
  type: 'Engine'
  name: string
  args?: ExpressionNode[]
}

export interface TableIdentifierNode {
  type: 'TableIdentifier'
  database?: string
  table: string
}

export interface IdentifierNode {
  type: 'Identifier'
  name: string
  quoted?: boolean
}

export interface LiteralNode {
  type: 'Literal'
  value: string | number | boolean | null
  dataType: 'string' | 'number' | 'boolean' | 'null'
}

export interface FunctionCallNode {
  type: 'FunctionCall'
  name: string
  args: ExpressionNode[]
}

export interface BinaryOpNode {
  type: 'BinaryOp'
  op: string
  left: ExpressionNode
  right: ExpressionNode
}

export interface JSONPathNode {
  type: 'JSONPath'
  object: ExpressionNode
  path: string
  extractText: boolean // true for ->>, false for ->
}

export interface ArrayLiteralNode {
  type: 'ArrayLiteral'
  elements: ExpressionNode[]
}

export interface StarNode {
  type: 'Star'
}

export interface AliasNode {
  type: 'Alias'
  expression: ExpressionNode
  alias: string
}

export interface OrderByElementNode {
  type: 'OrderByElement'
  expression: ExpressionNode
  direction: 'ASC' | 'DESC'
}

export type ExpressionNode =
  | IdentifierNode
  | LiteralNode
  | FunctionCallNode
  | BinaryOpNode
  | JSONPathNode
  | ArrayLiteralNode
  | StarNode
  | AliasNode

// ============================================================================
// Parser (following ClickHouse's IParser/ParserSelectQuery pattern)
// ============================================================================

export class Parser {
  private tokens: Token[]
  private pos: number = 0
  private readonly keywords = new Set([
    'SELECT',
    'FROM',
    'WHERE',
    'ORDER',
    'BY',
    'LIMIT',
    'OFFSET',
    'GROUP',
    'HAVING',
    'DISTINCT',
    'ALL',
    'AS',
    'AND',
    'OR',
    'NOT',
    'IN',
    'BETWEEN',
    'LIKE',
    'IS',
    'NULL',
    'TRUE',
    'FALSE',
    'CREATE',
    'TABLE',
    'IF',
    'EXISTS',
    'ENGINE',
    'ASC',
    'DESC',
    'WITH',
    'PREWHERE',
    'SETTINGS',
  ])

  constructor(tokens: Token[]) {
    // Filter out whitespace and comments
    this.tokens = tokens.filter(
      (t) => t.type !== TokenType.Whitespace && t.type !== TokenType.Comment
    )
  }

  private current(): Token {
    if (this.pos >= this.tokens.length) {
      return { type: TokenType.EndOfStream, value: '', begin: 0, end: 0 }
    }
    return this.tokens[this.pos]
  }

  private advance(): Token {
    const token = this.current()
    this.pos++
    return token
  }

  private peek(offset: number = 0): Token {
    const idx = this.pos + offset
    if (idx >= this.tokens.length) {
      return { type: TokenType.EndOfStream, value: '', begin: 0, end: 0 }
    }
    return this.tokens[idx]
  }

  private isKeyword(value: string): boolean {
    return this.keywords.has(value.toUpperCase())
  }

  private matchKeyword(keyword: string): boolean {
    const token = this.current()
    return token.type === TokenType.BareWord && token.value.toUpperCase() === keyword.toUpperCase()
  }

  private expectKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      throw new Error(
        `Expected keyword '${keyword}' but got '${this.current().value}' at position ${this.current().begin}`
      )
    }
    this.advance()
  }

  private match(type: TokenType): boolean {
    return this.current().type === type
  }

  private expect(type: TokenType): Token {
    if (!this.match(type)) {
      throw new Error(
        `Expected ${type} but got ${this.current().type} ('${this.current().value}') at position ${this.current().begin}`
      )
    }
    return this.advance()
  }

  // ============================================================================
  // Main parse entry point
  // ============================================================================

  parse(): SelectQueryNode | CreateTableNode {
    if (this.matchKeyword('SELECT')) {
      return this.parseSelectQuery()
    }
    if (this.matchKeyword('CREATE')) {
      return this.parseCreateTable()
    }
    throw new Error(`Unexpected token: ${this.current().value}`)
  }

  // ============================================================================
  // SELECT query parsing
  // ============================================================================

  private parseSelectQuery(): SelectQueryNode {
    this.expectKeyword('SELECT')

    let distinct = false
    if (this.matchKeyword('DISTINCT')) {
      distinct = true
      this.advance()
    }

    const columns = this.parseSelectExpressionList()

    let from: TableIdentifierNode | undefined
    if (this.matchKeyword('FROM')) {
      this.advance()
      from = this.parseTableIdentifier()
    }

    let where: ExpressionNode | undefined
    if (this.matchKeyword('WHERE')) {
      this.advance()
      where = this.parseExpression()
    }

    let orderBy: OrderByElementNode[] | undefined
    if (this.matchKeyword('ORDER')) {
      this.advance()
      this.expectKeyword('BY')
      orderBy = this.parseOrderByList()
    }

    let limit: LiteralNode | undefined
    if (this.matchKeyword('LIMIT')) {
      this.advance()
      const limitToken = this.expect(TokenType.Number)
      limit = {
        type: 'Literal',
        value: parseInt(limitToken.value, 10),
        dataType: 'number',
      }
    }

    return {
      type: 'SelectQuery',
      columns,
      from,
      where,
      orderBy,
      limit,
      distinct,
    }
  }

  private parseSelectExpressionList(): ExpressionNode[] {
    const expressions: ExpressionNode[] = []

    do {
      if (expressions.length > 0) {
        this.advance() // consume comma
      }
      expressions.push(this.parseAliasedExpression())
    } while (this.match(TokenType.Comma))

    return expressions
  }

  private parseAliasedExpression(): ExpressionNode {
    const expr = this.parseExpression()

    // Check for alias (AS name or just name)
    if (this.matchKeyword('AS')) {
      this.advance()
      const aliasToken = this.current()
      if (aliasToken.type === TokenType.BareWord || aliasToken.type === TokenType.QuotedIdentifier) {
        this.advance()
        return {
          type: 'Alias',
          expression: expr,
          alias: aliasToken.value,
        }
      }
    } else if (
      this.current().type === TokenType.BareWord &&
      !this.isKeyword(this.current().value) &&
      !['FROM', 'WHERE', 'ORDER', 'LIMIT', 'GROUP', 'HAVING'].includes(this.current().value.toUpperCase())
    ) {
      const aliasToken = this.advance()
      return {
        type: 'Alias',
        expression: expr,
        alias: aliasToken.value,
      }
    }

    return expr
  }

  private parseOrderByList(): OrderByElementNode[] {
    const elements: OrderByElementNode[] = []

    do {
      if (elements.length > 0) {
        this.advance() // consume comma
      }
      const expr = this.parseExpression()
      let direction: 'ASC' | 'DESC' = 'ASC'

      if (this.matchKeyword('ASC')) {
        this.advance()
        direction = 'ASC'
      } else if (this.matchKeyword('DESC')) {
        this.advance()
        direction = 'DESC'
      }

      elements.push({
        type: 'OrderByElement',
        expression: expr,
        direction,
      })
    } while (this.match(TokenType.Comma))

    return elements
  }

  private parseTableIdentifier(): TableIdentifierNode {
    const first = this.current()
    if (first.type !== TokenType.BareWord && first.type !== TokenType.QuotedIdentifier) {
      throw new Error(`Expected table name but got ${first.type}`)
    }
    this.advance()

    if (this.match(TokenType.Dot)) {
      this.advance()
      const second = this.current()
      if (second.type !== TokenType.BareWord && second.type !== TokenType.QuotedIdentifier) {
        throw new Error(`Expected table name after dot but got ${second.type}`)
      }
      this.advance()
      return {
        type: 'TableIdentifier',
        database: first.value,
        table: second.value,
      }
    }

    return {
      type: 'TableIdentifier',
      table: first.value,
    }
  }

  // ============================================================================
  // CREATE TABLE parsing
  // ============================================================================

  private parseCreateTable(): CreateTableNode {
    this.expectKeyword('CREATE')
    this.expectKeyword('TABLE')

    let ifNotExists = false
    if (this.matchKeyword('IF')) {
      this.advance()
      this.expectKeyword('NOT')
      this.expectKeyword('EXISTS')
      ifNotExists = true
    }

    const table = this.parseTableIdentifier()

    this.expect(TokenType.OpeningRoundBracket)
    const columns = this.parseColumnDefList()
    this.expect(TokenType.ClosingRoundBracket)

    let engine: EngineNode | undefined
    if (this.matchKeyword('ENGINE')) {
      this.advance()
      if (this.match(TokenType.Equals)) {
        this.advance()
      }
      engine = this.parseEngine()
    }

    return {
      type: 'CreateTable',
      table,
      columns,
      engine,
      ifNotExists,
    }
  }

  private parseColumnDefList(): ColumnDefNode[] {
    const columns: ColumnDefNode[] = []

    do {
      if (columns.length > 0) {
        this.advance() // consume comma
      }
      columns.push(this.parseColumnDef())
    } while (this.match(TokenType.Comma))

    return columns
  }

  private parseColumnDef(): ColumnDefNode {
    const nameToken = this.current()
    if (nameToken.type !== TokenType.BareWord && nameToken.type !== TokenType.QuotedIdentifier) {
      throw new Error(`Expected column name but got ${nameToken.type}`)
    }
    this.advance()

    // Parse data type (can be complex like Array(String) or Nullable(Int32))
    const dataType = this.parseDataType()

    return {
      type: 'ColumnDef',
      name: nameToken.value,
      dataType,
    }
  }

  private parseDataType(): string {
    const typeToken = this.current()
    if (typeToken.type !== TokenType.BareWord) {
      throw new Error(`Expected data type but got ${typeToken.type}`)
    }
    this.advance()

    let dataType = typeToken.value

    // Handle parameterized types like Array(String), Nullable(Int32), etc.
    if (this.match(TokenType.OpeningRoundBracket)) {
      this.advance()
      const innerType = this.parseDataType()
      this.expect(TokenType.ClosingRoundBracket)
      dataType = `${dataType}(${innerType})`
    }

    return dataType
  }

  private parseEngine(): EngineNode {
    const nameToken = this.current()
    if (nameToken.type !== TokenType.BareWord) {
      throw new Error(`Expected engine name but got ${nameToken.type}`)
    }
    this.advance()

    let args: ExpressionNode[] | undefined
    if (this.match(TokenType.OpeningRoundBracket)) {
      this.advance()
      args = []
      if (!this.match(TokenType.ClosingRoundBracket)) {
        do {
          if (args.length > 0) {
            this.advance() // consume comma
          }
          args.push(this.parseExpression())
        } while (this.match(TokenType.Comma))
      }
      this.expect(TokenType.ClosingRoundBracket)
    }

    return {
      type: 'Engine',
      name: nameToken.value,
      args,
    }
  }

  // ============================================================================
  // Expression parsing (with operator precedence)
  // ============================================================================

  private parseExpression(): ExpressionNode {
    return this.parseOrExpression()
  }

  private parseOrExpression(): ExpressionNode {
    let left = this.parseAndExpression()

    while (this.matchKeyword('OR')) {
      this.advance()
      const right = this.parseAndExpression()
      left = { type: 'BinaryOp', op: 'OR', left, right }
    }

    return left
  }

  private parseAndExpression(): ExpressionNode {
    let left = this.parseComparisonExpression()

    while (this.matchKeyword('AND')) {
      this.advance()
      const right = this.parseComparisonExpression()
      left = { type: 'BinaryOp', op: 'AND', left, right }
    }

    return left
  }

  private parseComparisonExpression(): ExpressionNode {
    let left = this.parseAdditiveExpression()

    const comparisonOps: { [key in TokenType]?: string } = {
      [TokenType.Equals]: '=',
      [TokenType.NotEquals]: '!=',
      [TokenType.Less]: '<',
      [TokenType.Greater]: '>',
      [TokenType.LessOrEquals]: '<=',
      [TokenType.GreaterOrEquals]: '>=',
      [TokenType.Spaceship]: '<=>',
    }

    while (comparisonOps[this.current().type]) {
      const op = comparisonOps[this.current().type]!
      this.advance()
      const right = this.parseAdditiveExpression()
      left = { type: 'BinaryOp', op, left, right }
    }

    // Handle LIKE, IN, BETWEEN, IS NULL, etc.
    if (this.matchKeyword('LIKE')) {
      this.advance()
      const right = this.parseAdditiveExpression()
      left = { type: 'BinaryOp', op: 'LIKE', left, right }
    } else if (this.matchKeyword('IN')) {
      this.advance()
      const right = this.parseAdditiveExpression()
      left = { type: 'BinaryOp', op: 'IN', left, right }
    } else if (this.matchKeyword('IS')) {
      this.advance()
      let op = 'IS'
      if (this.matchKeyword('NOT')) {
        this.advance()
        op = 'IS NOT'
      }
      this.expectKeyword('NULL')
      left = {
        type: 'BinaryOp',
        op,
        left,
        right: { type: 'Literal', value: null, dataType: 'null' },
      }
    }

    return left
  }

  private parseAdditiveExpression(): ExpressionNode {
    let left = this.parseMultiplicativeExpression()

    while (this.match(TokenType.Plus) || this.match(TokenType.Minus) || this.match(TokenType.Concatenation)) {
      const op = this.current().value
      this.advance()
      const right = this.parseMultiplicativeExpression()
      left = { type: 'BinaryOp', op, left, right }
    }

    return left
  }

  private parseMultiplicativeExpression(): ExpressionNode {
    let left = this.parseUnaryExpression()

    while (
      this.match(TokenType.Asterisk) ||
      this.match(TokenType.Slash) ||
      this.match(TokenType.Percent)
    ) {
      const op = this.current().value
      this.advance()
      const right = this.parseUnaryExpression()
      left = { type: 'BinaryOp', op, left, right }
    }

    return left
  }

  private parseUnaryExpression(): ExpressionNode {
    if (this.match(TokenType.Minus)) {
      this.advance()
      const expr = this.parseUnaryExpression()
      return {
        type: 'BinaryOp',
        op: '-',
        left: { type: 'Literal', value: 0, dataType: 'number' },
        right: expr,
      }
    }

    if (this.matchKeyword('NOT')) {
      this.advance()
      const expr = this.parseUnaryExpression()
      return {
        type: 'FunctionCall',
        name: 'NOT',
        args: [expr],
      }
    }

    return this.parsePostfixExpression()
  }

  private parsePostfixExpression(): ExpressionNode {
    let expr = this.parsePrimaryExpression()

    while (true) {
      // JSON path access: -> or ->>
      if (this.match(TokenType.Arrow) || this.match(TokenType.DoubleArrow)) {
        const extractText = this.current().type === TokenType.DoubleArrow
        this.advance()

        // The path can be a string literal (e.g., '$.user.email')
        let path: string
        if (this.match(TokenType.StringLiteral)) {
          path = this.current().value
          this.advance()
        } else {
          throw new Error('Expected JSON path string after -> or ->>')
        }

        expr = {
          type: 'JSONPath',
          object: expr,
          path,
          extractText,
        }
        continue
      }

      // Dot access for qualified names
      if (this.match(TokenType.Dot)) {
        this.advance()
        const nameToken = this.current()
        if (nameToken.type !== TokenType.BareWord && nameToken.type !== TokenType.QuotedIdentifier) {
          throw new Error(`Expected identifier after dot but got ${nameToken.type}`)
        }
        this.advance()

        // Convert to qualified identifier
        if (expr.type === 'Identifier') {
          expr = {
            type: 'Identifier',
            name: `${expr.name}.${nameToken.value}`,
          }
        } else {
          // Function call on result (e.g., array.size())
          if (this.match(TokenType.OpeningRoundBracket)) {
            const args = this.parseFunctionArgs()
            expr = {
              type: 'FunctionCall',
              name: nameToken.value,
              args: [expr, ...args],
            }
          } else {
            expr = {
              type: 'BinaryOp',
              op: '.',
              left: expr,
              right: { type: 'Identifier', name: nameToken.value },
            }
          }
        }
        continue
      }

      // Array subscript
      if (this.match(TokenType.OpeningSquareBracket)) {
        this.advance()
        const index = this.parseExpression()
        this.expect(TokenType.ClosingSquareBracket)
        expr = {
          type: 'FunctionCall',
          name: 'arrayElement',
          args: [expr, index],
        }
        continue
      }

      break
    }

    return expr
  }

  private parsePrimaryExpression(): ExpressionNode {
    const token = this.current()

    // Star (*)
    if (token.type === TokenType.Asterisk) {
      this.advance()
      return { type: 'Star' }
    }

    // Number literal
    if (token.type === TokenType.Number) {
      this.advance()
      const value = token.value.includes('.') ? parseFloat(token.value) : parseInt(token.value, 10)
      return { type: 'Literal', value, dataType: 'number' }
    }

    // String literal
    if (token.type === TokenType.StringLiteral) {
      this.advance()
      // Remove quotes and handle escapes
      const raw = token.value.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'")
      return { type: 'Literal', value: raw, dataType: 'string' }
    }

    // Bare word (identifier or function call or boolean/null)
    if (token.type === TokenType.BareWord) {
      const name = token.value

      // Boolean literals
      if (name.toUpperCase() === 'TRUE') {
        this.advance()
        return { type: 'Literal', value: true, dataType: 'boolean' }
      }
      if (name.toUpperCase() === 'FALSE') {
        this.advance()
        return { type: 'Literal', value: false, dataType: 'boolean' }
      }
      if (name.toUpperCase() === 'NULL') {
        this.advance()
        return { type: 'Literal', value: null, dataType: 'null' }
      }

      this.advance()

      // Check if it's a function call
      if (this.match(TokenType.OpeningRoundBracket)) {
        const args = this.parseFunctionArgs()
        return { type: 'FunctionCall', name, args }
      }

      return { type: 'Identifier', name }
    }

    // Quoted identifier
    if (token.type === TokenType.QuotedIdentifier) {
      this.advance()
      // Remove quotes
      const name = token.value.slice(1, -1)
      return { type: 'Identifier', name, quoted: true }
    }

    // Parenthesized expression
    if (token.type === TokenType.OpeningRoundBracket) {
      this.advance()
      const expr = this.parseExpression()
      this.expect(TokenType.ClosingRoundBracket)
      return expr
    }

    // Array literal [...]
    if (token.type === TokenType.OpeningSquareBracket) {
      this.advance()
      const elements: ExpressionNode[] = []
      if (!this.match(TokenType.ClosingSquareBracket)) {
        do {
          if (elements.length > 0) {
            this.advance() // consume comma
          }
          elements.push(this.parseExpression())
        } while (this.match(TokenType.Comma))
      }
      this.expect(TokenType.ClosingSquareBracket)
      return { type: 'ArrayLiteral', elements }
    }

    throw new Error(
      `Unexpected token in expression: ${token.type} ('${token.value}') at position ${token.begin}`
    )
  }

  private parseFunctionArgs(): ExpressionNode[] {
    this.expect(TokenType.OpeningRoundBracket)
    const args: ExpressionNode[] = []

    if (!this.match(TokenType.ClosingRoundBracket)) {
      do {
        if (args.length > 0) {
          this.advance() // consume comma
        }
        args.push(this.parseExpression())
      } while (this.match(TokenType.Comma))
    }

    this.expect(TokenType.ClosingRoundBracket)
    return args
  }
}

// ============================================================================
// High-level parse function
// ============================================================================

export function parseSQL(sql: string): SelectQueryNode | CreateTableNode {
  const tokens = tokenize(sql)
  const parser = new Parser(tokens)
  return parser.parse()
}

// ============================================================================
// AST Utilities
// ============================================================================

export function formatAST(node: ASTNode, indent: number = 0): string {
  const prefix = '  '.repeat(indent)

  switch (node.type) {
    case 'SelectQuery':
      let result = `${prefix}SELECT`
      if (node.distinct) {
        result += ' DISTINCT'
      }
      result += `\n${prefix}  columns:\n`
      for (const col of node.columns) {
        result += formatAST(col, indent + 2) + '\n'
      }
      if (node.from) {
        result += `${prefix}  FROM: ${node.from.database ? node.from.database + '.' : ''}${node.from.table}\n`
      }
      if (node.where) {
        result += `${prefix}  WHERE:\n${formatAST(node.where, indent + 2)}\n`
      }
      if (node.orderBy) {
        result += `${prefix}  ORDER BY:\n`
        for (const elem of node.orderBy) {
          result += `${prefix}    ${formatAST(elem.expression, 0).trim()} ${elem.direction}\n`
        }
      }
      if (node.limit) {
        result += `${prefix}  LIMIT: ${node.limit.value}\n`
      }
      return result

    case 'CreateTable':
      let createResult = `${prefix}CREATE TABLE`
      if (node.ifNotExists) {
        createResult += ' IF NOT EXISTS'
      }
      createResult += ` ${node.table.database ? node.table.database + '.' : ''}${node.table.table}\n`
      createResult += `${prefix}  columns:\n`
      for (const col of node.columns) {
        createResult += `${prefix}    ${col.name} ${col.dataType}\n`
      }
      if (node.engine) {
        createResult += `${prefix}  ENGINE = ${node.engine.name}`
        if (node.engine.args && node.engine.args.length > 0) {
          createResult += '(...)'
        }
        createResult += '()\n'
      }
      return createResult

    case 'FunctionCall':
      return `${prefix}${node.name}(${node.args.map((a) => formatAST(a, 0).trim()).join(', ')})`

    case 'BinaryOp':
      return `${prefix}(${formatAST(node.left, 0).trim()} ${node.op} ${formatAST(node.right, 0).trim()})`

    case 'JSONPath':
      return `${prefix}${formatAST(node.object, 0).trim()}${node.extractText ? '->>' : '->'}'${node.path}'`

    case 'Identifier':
      return `${prefix}${node.quoted ? `"${node.name}"` : node.name}`

    case 'Literal':
      if (node.dataType === 'string') {
        return `${prefix}'${node.value}'`
      }
      return `${prefix}${node.value}`

    case 'ArrayLiteral':
      return `${prefix}[${node.elements.map((e) => formatAST(e, 0).trim()).join(', ')}]`

    case 'Star':
      return `${prefix}*`

    case 'Alias':
      return `${prefix}${formatAST(node.expression, 0).trim()} AS ${node.alias}`

    default:
      return `${prefix}[Unknown node type]`
  }
}

// ============================================================================
// Validation helpers for Things/Relationships patterns
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateThingsQuery(ast: ASTNode): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] }

  if (ast.type !== 'SelectQuery') {
    result.valid = false
    result.errors.push('Expected SELECT query')
    return result
  }

  // Check for valid Things table access
  if (ast.from && ast.from.table.toLowerCase() !== 'things') {
    result.warnings.push(`Table '${ast.from.table}' is not 'things' - ensure this is intentional`)
  }

  // Check for JSON path access patterns
  for (const col of ast.columns) {
    validateExpressionForThings(col, result)
  }

  if (ast.where) {
    validateExpressionForThings(ast.where, result)
  }

  return result
}

function validateExpressionForThings(expr: ExpressionNode, result: ValidationResult): void {
  switch (expr.type) {
    case 'JSONPath':
      // Valid JSON path access
      if (!expr.path.startsWith("'$.")) {
        result.warnings.push(`JSON path '${expr.path}' does not start with '$.' - this may be incorrect`)
      }
      break

    case 'FunctionCall':
      // Check for known vector functions
      const vectorFunctions = [
        'cosineDistance',
        'L2Distance',
        'L1Distance',
        'dotProduct',
        'vectorSum',
        'vectorDifference',
      ]
      if (vectorFunctions.includes(expr.name)) {
        // Valid vector function
        if (expr.args.length < 2) {
          result.errors.push(`Vector function '${expr.name}' requires at least 2 arguments`)
          result.valid = false
        }
      }
      // Recursively validate args
      for (const arg of expr.args) {
        validateExpressionForThings(arg, result)
      }
      break

    case 'BinaryOp':
      validateExpressionForThings(expr.left, result)
      validateExpressionForThings(expr.right, result)
      break

    case 'Alias':
      validateExpressionForThings(expr.expression, result)
      break

    default:
      // Other types are fine
      break
  }
}
