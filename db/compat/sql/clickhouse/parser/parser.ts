/**
 * ClickHouse SQL Parser - TypeScript Implementation
 *
 * This parser follows the pattern from ClickHouse's IParser/ParserSelectQuery.
 * Supports SELECT, CREATE TABLE, INSERT, and ClickHouse-specific syntax.
 */

import { Token, TokenType, tokenize } from './lexer'
import type {
  StatementNode,
  SelectQueryNode,
  CreateTableNode,
  InsertNode,
  ExpressionNode,
  IdentifierNode,
  LiteralNode,
  FunctionCallNode,
  BinaryOpNode,
  JSONPathNode,
  JSONCastNode,
  ArrayLiteralNode,
  StarNode,
  AliasNode,
  OrderByElementNode,
  TableIdentifierNode,
  ColumnDefNode,
  EngineNode,
} from './ast'

// ============================================================================
// Parser Implementation
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
    'INSERT',
    'INTO',
    'VALUES',
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

  parse(): StatementNode {
    if (this.matchKeyword('SELECT')) {
      return this.parseSelectQuery()
    }
    if (this.matchKeyword('CREATE')) {
      return this.parseCreateTable()
    }
    if (this.matchKeyword('INSERT')) {
      return this.parseInsert()
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
  // INSERT parsing
  // ============================================================================

  private parseInsert(): InsertNode {
    this.expectKeyword('INSERT')
    this.expectKeyword('INTO')

    const table = this.parseTableIdentifier()

    // Parse optional column list
    let columns: string[] | undefined
    if (this.match(TokenType.OpeningRoundBracket)) {
      this.advance()
      columns = []
      do {
        if (columns.length > 0) {
          this.advance() // consume comma
        }
        const colToken = this.current()
        if (colToken.type !== TokenType.BareWord && colToken.type !== TokenType.QuotedIdentifier) {
          throw new Error(`Expected column name but got ${colToken.type}`)
        }
        columns.push(colToken.value)
        this.advance()
      } while (this.match(TokenType.Comma))
      this.expect(TokenType.ClosingRoundBracket)
    }

    this.expectKeyword('VALUES')

    // Parse value rows
    const values: ExpressionNode[][] = []
    do {
      if (values.length > 0) {
        this.advance() // consume comma
      }
      this.expect(TokenType.OpeningRoundBracket)
      const row: ExpressionNode[] = []
      do {
        if (row.length > 0) {
          this.advance() // consume comma
        }
        row.push(this.parseExpression())
      } while (this.match(TokenType.Comma))
      this.expect(TokenType.ClosingRoundBracket)
      values.push(row)
    } while (this.match(TokenType.Comma))

    return {
      type: 'Insert',
      table,
      columns,
      values,
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

      // Type cast: ::TYPE
      if (this.match(TokenType.DoubleColon)) {
        this.advance()
        const typeToken = this.current()
        if (typeToken.type !== TokenType.BareWord) {
          throw new Error(`Expected type name after :: but got ${typeToken.type}`)
        }
        this.advance()

        expr = {
          type: 'JSONCast',
          expression: expr,
          targetType: typeToken.value,
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

export function parse(sql: string): StatementNode {
  const tokens = tokenize(sql)
  const parser = new Parser(tokens)
  return parser.parse()
}
