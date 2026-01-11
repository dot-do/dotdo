/**
 * EdgeQL Parser - Complete Implementation
 *
 * Hand-rolled recursive descent parser for EdgeQL queries.
 * Uses the lexer from ./lexer.ts for tokenization.
 *
 * Supported syntax:
 * - SELECT statements with shapes, filters, order by, limit, offset
 * - INSERT statements with data
 * - UPDATE statements with SET clauses and filters
 * - DELETE statements with filters
 * - FOR loops with union
 * - WITH blocks for CTEs
 * - Full expression support (arithmetic, comparison, logical, string, set, type operators)
 *
 * @see db/compat/gel/tests/edgeql-parser-complete.test.ts
 */

import { tokenize, Token, TokenType } from './lexer'

// ============================================================================
// AST NODES
// ============================================================================

export interface SelectStatement {
  type: 'SelectStatement'
  target: string
  shape: Shape
  filter?: FilterExpression
  orderBy?: OrderByClause
  limit?: Expression
  offset?: Expression
  distinct?: boolean
}

export interface InsertStatement {
  type: 'InsertStatement'
  target: string
  data: InsertData
}

export interface UpdateStatement {
  type: 'UpdateStatement'
  target: string
  filter?: FilterExpression
  set: SetClause
}

export interface DeleteStatement {
  type: 'DeleteStatement'
  target: string
  filter?: FilterExpression
}

export interface ForStatement {
  type: 'ForStatement'
  variable: string
  iterator: Expression
  body: Statement
}

export interface WithBlock {
  type: 'WithBlock'
  bindings: WithBinding[]
  body: Statement
}

export interface WithBinding {
  type: 'WithBinding'
  name: string
  value: Expression
}

export interface Shape {
  type: 'Shape'
  fields: ShapeField[]
}

export interface ShapeField {
  type: 'ShapeField'
  name: string
  alias?: string
  shape?: Shape
  computed?: Expression
  filter?: FilterExpression
}

export interface InsertData {
  type: 'InsertData'
  assignments: Assignment[]
}

export interface SetClause {
  type: 'SetClause'
  assignments: Assignment[]
}

export interface Assignment {
  type: 'Assignment'
  name: string
  value: Expression
}

export type Expression =
  | StringLiteral
  | NumberLiteral
  | BooleanLiteral
  | PathExpression
  | BinaryExpression
  | UnaryExpression
  | CoalesceExpression
  | ConcatExpression
  | CastExpression
  | ParameterExpression
  | FunctionCall
  | SetExpression
  | ArrayLiteral
  | TupleLiteral
  | InExpression
  | LikeExpression
  | TypeCheckExpression
  | ExistsExpression
  | DistinctExpression
  | SelectStatement
  | InsertStatement
  | GroupedExpression
  | TypeofExpression

export interface StringLiteral {
  type: 'StringLiteral'
  value: string
}

export interface NumberLiteral {
  type: 'NumberLiteral'
  value: number
}

export interface BooleanLiteral {
  type: 'BooleanLiteral'
  value: boolean
}

export interface PathExpression {
  type: 'PathExpression'
  path: PathSegment[]
}

export interface PathSegment {
  type: 'PathSegment'
  name: string
  navigation?: 'forward' | 'backward'
  typeFilter?: string
  optional?: boolean
  index?: number | Expression
  slice?: { start?: Expression; end?: Expression }
}

export interface BinaryExpression {
  type: 'BinaryExpression'
  operator: string
  left: Expression
  right: Expression
}

export interface UnaryExpression {
  type: 'UnaryExpression'
  operator: 'not' | '-' | '+'
  operand: Expression
}

export interface CoalesceExpression {
  type: 'CoalesceExpression'
  left: Expression
  right: Expression
}

export interface ConcatExpression {
  type: 'ConcatExpression'
  left: Expression
  right: Expression
}

export interface CastExpression {
  type: 'CastExpression'
  typeRef: string
  value: Expression
}

export interface ParameterExpression {
  type: 'ParameterExpression'
  name: string
  paramType?: string
}

export interface FunctionCall {
  type: 'FunctionCall'
  name: string
  args: Expression[]
}

export interface SetExpression {
  type: 'SetExpression'
  elements: Expression[]
}

export interface ArrayLiteral {
  type: 'ArrayLiteral'
  elements: Expression[]
}

export interface TupleLiteral {
  type: 'TupleLiteral'
  elements: Expression[]
}

export interface InExpression {
  type: 'InExpression'
  expression: Expression
  set: Expression
  negated: boolean
}

export interface LikeExpression {
  type: 'LikeExpression'
  expression: Expression
  pattern: Expression
  caseInsensitive: boolean
  negated?: boolean
}

export interface TypeCheckExpression {
  type: 'TypeCheckExpression'
  expression: Expression
  typeName: string
  negated: boolean
}

export interface ExistsExpression {
  type: 'ExistsExpression'
  argument: Expression
}

export interface DistinctExpression {
  type: 'DistinctExpression'
  argument: Expression
}

export interface GroupedExpression {
  type: 'GroupedExpression'
  expression: Expression
}

export interface TypeofExpression {
  type: 'TypeofExpression'
  argument: Expression
}

export interface FilterExpression {
  type: 'FilterExpression'
  condition: Expression
}

export interface OrderByClause {
  type: 'OrderByClause'
  expressions: OrderByExpression[]
}

export interface OrderByExpression {
  type: 'OrderByExpression'
  expression: Expression
  direction: 'asc' | 'desc' | null
  nullsPosition: 'first' | 'last' | null
}

export type Statement = SelectStatement | InsertStatement | UpdateStatement | DeleteStatement | ForStatement | WithBlock

// ============================================================================
// PARSER
// ============================================================================

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private current(): Token {
    return this.tokens[this.pos]
  }

  private peek(offset = 0): Token {
    const index = this.pos + offset
    return index < this.tokens.length ? this.tokens[index] : this.tokens[this.tokens.length - 1]
  }

  private advance(): Token {
    const token = this.current()
    this.pos++
    return token
  }

  private expect(type: TokenType, message?: string): Token {
    const token = this.current()
    if (token.type !== type) {
      throw new SyntaxError(
        message ??
          `Expected ${type} but got ${token.type} at line ${token.line}, column ${token.column}`
      )
    }
    return this.advance()
  }

  private match(...types: TokenType[]): boolean {
    if (types.includes(this.current().type)) {
      this.advance()
      return true
    }
    return false
  }

  private check(...types: TokenType[]): boolean {
    return types.includes(this.current().type)
  }

  private checkKeyword(keyword: string): boolean {
    const token = this.current()
    return token.type === TokenType.IDENTIFIER && token.value.toLowerCase() === keyword.toLowerCase()
  }

  private matchKeyword(keyword: string): boolean {
    if (this.checkKeyword(keyword)) {
      this.advance()
      return true
    }
    return false
  }

  // Check if a token type can be used as an identifier
  private isIdentifierLike(type: TokenType): boolean {
    if (type === TokenType.IDENTIFIER) return true

    // Keywords that can be used as identifiers
    const keywordTypes = [
      TokenType.TYPE, TokenType.SCALAR, TokenType.PROPERTY, TokenType.LINK,
      TokenType.ABSTRACT, TokenType.REQUIRED, TokenType.OPTIONAL, TokenType.MULTI, TokenType.SINGLE,
      TokenType.MODULE, TokenType.FUNCTION, TokenType.CONSTRAINT, TokenType.ANNOTATION,
      TokenType.INDEX, TokenType.ALIAS, TokenType.ENUM, TokenType.EXTENDING,
      TokenType.ORDER, TokenType.BY, TokenType.LIMIT, TokenType.OFFSET,
      TokenType.TRUE, TokenType.FALSE, TokenType.IF, TokenType.ELSE
    ]

    return keywordTypes.includes(type)
  }

  // Parse an identifier, but also accept certain keywords that can be used as identifiers in context
  private parseIdentifierOrKeyword(): string {
    const token = this.current()

    // Accept regular identifiers
    if (token.type === TokenType.IDENTIFIER) {
      this.advance()
      return token.value
    }

    // Accept keywords that can be used as identifiers in certain contexts
    // NOTE: EdgeQL allows many keywords to be used as type/field names
    const keywordTypes = [
      TokenType.TYPE, TokenType.SCALAR, TokenType.PROPERTY, TokenType.LINK,
      TokenType.ABSTRACT, TokenType.REQUIRED, TokenType.OPTIONAL, TokenType.MULTI, TokenType.SINGLE,
      TokenType.MODULE, TokenType.FUNCTION, TokenType.CONSTRAINT, TokenType.ANNOTATION,
      TokenType.INDEX, TokenType.ALIAS, TokenType.ENUM, TokenType.EXTENDING,
      // Additional keywords allowed as type/field names
      TokenType.ORDER, TokenType.BY, TokenType.LIMIT, TokenType.OFFSET,
      TokenType.TRUE, TokenType.FALSE, TokenType.IF, TokenType.ELSE
    ]

    if (keywordTypes.includes(token.type)) {
      this.advance()
      // Preserve original casing for type names
      return token.value
    }

    throw new SyntaxError(
      `Expected identifier at line ${token.line}, column ${token.column}`
    )
  }

  parse(): Statement {
    return this.parseStatement()
  }

  private parseStatement(): Statement {
    const token = this.current()

    if (token.type === TokenType.SELECT) {
      return this.parseSelect()
    }

    if (token.type === TokenType.INSERT) {
      return this.parseInsert()
    }

    if (token.type === TokenType.UPDATE) {
      return this.parseUpdate()
    }

    if (token.type === TokenType.DELETE) {
      return this.parseDelete()
    }

    if (token.type === TokenType.FOR) {
      return this.parseFor()
    }

    if (token.type === TokenType.WITH) {
      return this.parseWith()
    }

    throw new SyntaxError(
      `Expected SELECT, INSERT, UPDATE, DELETE, FOR, or WITH at line ${token.line}, column ${token.column}`
    )
  }

  private parseSelect(): SelectStatement {
    this.expect(TokenType.SELECT)

    let distinct = false
    if (this.check(TokenType.DISTINCT)) {
      this.advance()
      distinct = true
    }

    // Check for standalone shape select { ... }
    if (this.check(TokenType.LBRACE)) {
      const shape = this.parseShape()
      const result: SelectStatement = {
        type: 'SelectStatement',
        target: '',
        shape,
        distinct,
      }
      this.parseSelectClauses(result)
      return result
    }

    // Check for parenthesized expression like (select Admin).user_id
    // This needs to be parsed as a full expression, not just a subquery
    if (this.check(TokenType.LPAREN)) {
      // Parse as expression (which handles subqueries, path continuation, etc.)
      const expr = this.parseSelectExpression()

      const result: SelectStatement = {
        type: 'SelectStatement',
        target: '',
        shape: { type: 'Shape', fields: [] },
        distinct,
      }
      this.parseSelectClauses(result)
      return result
    }

    // Parse expression or type name
    // Expression select: select expr filter ...
    // Type select: select Type { shape } filter ...

    // Save position to potentially backtrack
    const savedPos = this.pos

    // Try to parse as identifier (type name)
    let target = ''
    if (this.check(TokenType.IDENTIFIER)) {
      target = this.parseTypeName()

      // If followed by { then it's a type select with shape
      if (this.check(TokenType.LBRACE)) {
        const shape = this.parseShape()
        const result: SelectStatement = {
          type: 'SelectStatement',
          target,
          shape,
          distinct,
        }
        this.parseSelectClauses(result)
        return result
      }

      // If followed by filter/order/limit/offset/EOF/RPAREN then it's a simple type select
      if (this.check(TokenType.FILTER, TokenType.ORDER, TokenType.LIMIT, TokenType.OFFSET, TokenType.EOF, TokenType.RPAREN)) {
        const result: SelectStatement = {
          type: 'SelectStatement',
          target,
          shape: { type: 'Shape', fields: [] },
          distinct,
        }
        this.parseSelectClauses(result)
        return result
      }

      // Otherwise, backtrack and parse as expression
      this.pos = savedPos
    }

    // Parse as expression (e.g., select n * 2, select .name)
    // We need to parse expressions that don't consume filter/order/limit/offset keywords
    const expr = this.parseSelectExpression()

    // Convert expression to target string if it's a simple path
    if (expr.type === 'PathExpression' && expr.path.length > 0) {
      target = expr.path.map(s => s.name).filter(n => n).join('.')
    }

    const result: SelectStatement = {
      type: 'SelectStatement',
      target,
      shape: { type: 'Shape', fields: [] },
      distinct,
    }

    this.parseSelectClauses(result)
    return result
  }

  // Parse expression for SELECT target - stops before filter/order/limit/offset
  private parseSelectExpression(): Expression {
    return this.parseOr()
  }

  private parseSelectClauses(result: SelectStatement): void {
    // Parse filter, order by, limit, offset in any order
    while (!this.check(TokenType.EOF, TokenType.RPAREN, TokenType.RBRACE)) {
      if (this.check(TokenType.FILTER)) {
        result.filter = this.parseFilter()
      } else if (this.check(TokenType.ORDER)) {
        result.orderBy = this.parseOrderBy()
      } else if (this.check(TokenType.LIMIT)) {
        this.advance()
        // Check for negative number
        if (this.check(TokenType.MINUS)) {
          throw new SyntaxError(`Negative limit not allowed at line ${this.current().line}`)
        }
        result.limit = this.parseExpression()
      } else if (this.check(TokenType.OFFSET)) {
        this.advance()
        result.offset = this.parseExpression()
      } else {
        break
      }
    }
  }

  private parseTypeName(): string {
    const parts: string[] = []
    parts.push(this.parseIdentifierOrKeyword())

    while (this.check(TokenType.NAMESPACE)) {
      this.advance()
      parts.push(this.parseIdentifierOrKeyword())
    }

    return parts.join('::')
  }

  private pathToString(expr: PathExpression): string {
    return expr.path.map(s => s.name).join('.')
  }

  private parseInsert(): InsertStatement {
    this.expect(TokenType.INSERT)

    const target = this.parseTypeName()
    const data = this.parseInsertData()

    return {
      type: 'InsertStatement',
      target,
      data,
    }
  }

  private parseUpdate(): UpdateStatement {
    this.expect(TokenType.UPDATE)

    const target = this.parseTypeName()

    let filter: FilterExpression | undefined
    if (this.check(TokenType.FILTER)) {
      filter = this.parseFilter()
    }

    // Expect 'set' keyword
    if (!this.checkKeyword('set')) {
      throw new SyntaxError(
        `Expected 'set' keyword in UPDATE at line ${this.current().line}, column ${this.current().column}`
      )
    }
    this.advance()

    const setClause = this.parseSetClause()

    return {
      type: 'UpdateStatement',
      target,
      filter,
      set: setClause,
    }
  }

  private parseDelete(): DeleteStatement {
    this.expect(TokenType.DELETE)

    const target = this.parseTypeName()

    // Check for unexpected tokens
    if (this.checkKeyword('set')) {
      throw new SyntaxError(
        `DELETE does not support SET clause at line ${this.current().line}, column ${this.current().column}`
      )
    }

    let filter: FilterExpression | undefined
    if (this.check(TokenType.FILTER)) {
      filter = this.parseFilter()
    }

    return {
      type: 'DeleteStatement',
      target,
      filter,
    }
  }

  private parseFor(): ForStatement {
    this.expect(TokenType.FOR)

    const varToken = this.current()
    if (varToken.type !== TokenType.IDENTIFIER) {
      throw new SyntaxError(
        `Expected variable name in FOR at line ${varToken.line}, column ${varToken.column}`
      )
    }
    const variable = this.advance().value

    // Expect 'in' keyword
    this.expect(TokenType.IN)

    // Parse iterator expression (without union)
    const iterator = this.parseForIterator()

    // Expect 'union' keyword
    if (!this.check(TokenType.UNION)) {
      throw new SyntaxError(
        `Expected 'union' in FOR at line ${this.current().line}, column ${this.current().column}`
      )
    }
    this.advance()

    // Parse body (wrapped in parentheses)
    this.expect(TokenType.LPAREN)
    const body = this.parseStatement()
    this.expect(TokenType.RPAREN)

    return {
      type: 'ForStatement',
      variable,
      iterator,
      body,
    }
  }

  // Parse FOR iterator - like parseExpression but stops before UNION
  private parseForIterator(): Expression {
    return this.parseCoalesce()
  }

  private parseWith(): WithBlock {
    this.expect(TokenType.WITH)

    const bindings: WithBinding[] = []

    // Parse bindings
    do {
      // Check for module import pattern: with module schema select ...
      if (this.check(TokenType.MODULE)) {
        this.advance()
        const moduleName = this.parseIdentifierOrKeyword()
        bindings.push({
          type: 'WithBinding',
          name: 'module',
          value: { type: 'PathExpression', path: [{ type: 'PathSegment', name: moduleName }] },
        })
      } else {
        const name = this.parseIdentifierOrKeyword()

        this.expect(TokenType.ASSIGN)
        const value = this.parseExpression()
        bindings.push({
          type: 'WithBinding',
          name,
          value,
        })
      }

      // Check for trailing comma or continuation
      if (this.check(TokenType.COMMA)) {
        this.advance()
        // Trailing comma before body is ok
        if (this.check(TokenType.SELECT, TokenType.INSERT, TokenType.UPDATE, TokenType.DELETE, TokenType.FOR)) {
          break
        }
      } else {
        break
      }
    } while (!this.check(TokenType.SELECT, TokenType.INSERT, TokenType.UPDATE, TokenType.DELETE, TokenType.FOR, TokenType.EOF))

    // Check for missing body
    if (this.check(TokenType.EOF)) {
      throw new SyntaxError(`WITH block missing body at line ${this.current().line}`)
    }

    const body = this.parseStatement()

    return {
      type: 'WithBlock',
      bindings,
      body,
    }
  }

  private parseShape(): Shape {
    this.expect(TokenType.LBRACE)

    const fields: ShapeField[] = []

    while (!this.check(TokenType.RBRACE, TokenType.EOF)) {
      fields.push(this.parseShapeField())

      if (this.check(TokenType.COMMA)) {
        this.advance()
        // Allow trailing comma
        if (this.check(TokenType.RBRACE)) {
          break
        }
      } else {
        break
      }
    }

    this.expect(TokenType.RBRACE)

    return {
      type: 'Shape',
      fields,
    }
  }

  private parseShapeField(): ShapeField {
    const first = this.current()

    // Handle path navigation in shape like .[is Type].field
    if (first.type === TokenType.DOT) {
      this.advance()
      // Parse the rest as a path and create a computed field
      if (this.check(TokenType.LBRACKET)) {
        // Type filter like .[is Type]
        this.advance()
        this.expect(TokenType.IS)
        const typeName = this.parseTypeName()
        this.expect(TokenType.RBRACKET)
        const segment: PathSegment = { type: 'PathSegment', name: '', typeFilter: typeName }
        const pathExpr: PathExpression = { type: 'PathExpression', path: [segment] }

        // Check for continuation
        if (this.check(TokenType.DOT)) {
          this.advance()
          const rest = this.parseShapeFieldPath()
          pathExpr.path.push(...rest)
        }

        return {
          type: 'ShapeField',
          name: '',
          computed: pathExpr,
        }
      }
    }

    // Accept identifier or keyword as field name (e.g., 'type' is a valid field name)
    const name = this.parseIdentifierOrKeyword()

    let alias: string | undefined
    let shape: Shape | undefined
    let computed: Expression | undefined
    let filter: FilterExpression | undefined

    // Check for alias or nested shape
    if (this.check(TokenType.COLON)) {
      this.advance()

      // Could be alias or nested shape
      if (this.check(TokenType.LBRACE)) {
        shape = this.parseShape()
      } else {
        // This is an alias syntax (alias: field)
        // Actually in EdgeQL, : introduces a nested shape
        // alias := is for computed
        throw new SyntaxError(
          `Expected '{' after ':' in shape field at line ${this.current().line}`
        )
      }
    } else if (this.check(TokenType.ASSIGN)) {
      // Computed field
      this.advance()
      computed = this.parseExpression()
    }

    // Check for inline shape
    if (this.check(TokenType.LBRACE)) {
      shape = this.parseShape()
    }

    // Check for filter on link
    if (this.check(TokenType.FILTER)) {
      filter = this.parseFilter()
    }

    return {
      type: 'ShapeField',
      name,
      alias,
      shape,
      computed,
      filter,
    }
  }

  private parseShapeFieldPath(): PathSegment[] {
    const segments: PathSegment[] = []
    const name = this.expect(TokenType.IDENTIFIER).value
    segments.push({ type: 'PathSegment', name })
    return segments
  }

  private parseInsertData(): InsertData {
    this.expect(TokenType.LBRACE)

    const assignments: Assignment[] = []

    while (!this.check(TokenType.RBRACE, TokenType.EOF)) {
      assignments.push(this.parseAssignment())

      if (this.check(TokenType.COMMA)) {
        this.advance()
        // Allow trailing comma
        if (this.check(TokenType.RBRACE)) {
          break
        }
      } else {
        break
      }
    }

    this.expect(TokenType.RBRACE)

    return {
      type: 'InsertData',
      assignments,
    }
  }

  private parseSetClause(): SetClause {
    this.expect(TokenType.LBRACE)

    const assignments: Assignment[] = []

    while (!this.check(TokenType.RBRACE, TokenType.EOF)) {
      // Skip empty lines (just commas with nothing)
      if (this.check(TokenType.COMMA)) {
        this.advance()
        continue
      }
      if (this.check(TokenType.RBRACE)) {
        break
      }

      assignments.push(this.parseAssignment())

      if (this.check(TokenType.COMMA)) {
        this.advance()
        // Allow trailing comma
        if (this.check(TokenType.RBRACE)) {
          break
        }
      } else {
        break
      }
    }

    if (assignments.length === 0) {
      throw new SyntaxError(`UPDATE SET clause cannot be empty at line ${this.current().line}`)
    }

    this.expect(TokenType.RBRACE)

    return {
      type: 'SetClause',
      assignments,
    }
  }

  private parseAssignment(): Assignment {
    // Accept identifier or keyword as assignment name (e.g., 'type' is a valid field name)
    const name = this.parseIdentifierOrKeyword()

    this.expect(TokenType.ASSIGN)

    const value = this.parseExpression()

    return {
      type: 'Assignment',
      name,
      value,
    }
  }

  private parseFilter(): FilterExpression {
    this.expect(TokenType.FILTER)

    const condition = this.parseExpression()

    return {
      type: 'FilterExpression',
      condition,
    }
  }

  private parseOrderBy(): OrderByClause {
    this.expect(TokenType.ORDER)
    this.expect(TokenType.BY)

    const expressions: OrderByExpression[] = []

    do {
      const expr = this.parseExpression()
      let direction: 'asc' | 'desc' | null = null
      let nullsPosition: 'first' | 'last' | null = null

      // Check for asc/desc
      if (this.checkKeyword('asc')) {
        direction = 'asc'
        this.advance()
      } else if (this.checkKeyword('desc')) {
        direction = 'desc'
        this.advance()
      }

      // Check for nulls first/last
      if (this.checkKeyword('nulls')) {
        this.advance()
        if (this.checkKeyword('first')) {
          nullsPosition = 'first'
          this.advance()
        } else if (this.checkKeyword('last')) {
          nullsPosition = 'last'
          this.advance()
        }
      }

      expressions.push({
        type: 'OrderByExpression',
        expression: expr,
        direction,
        nullsPosition,
      })

      // Check for 'then' for secondary sort
      if (this.checkKeyword('then')) {
        this.advance()
      } else {
        break
      }
    } while (true)

    return {
      type: 'OrderByClause',
      expressions,
    }
  }

  // ============================================================================
  // EXPRESSION PARSING
  // ============================================================================

  private parseExpression(): Expression {
    return this.parseOr()
  }

  private parseOr(): Expression {
    let left = this.parseAnd()

    while (this.check(TokenType.OR)) {
      this.advance()
      const right = this.parseAnd()
      left = {
        type: 'BinaryExpression',
        operator: 'or',
        left,
        right,
      }
    }

    return left
  }

  private parseAnd(): Expression {
    let left = this.parseNot()

    while (this.check(TokenType.AND)) {
      this.advance()
      const right = this.parseNot()
      left = {
        type: 'BinaryExpression',
        operator: 'and',
        left,
        right,
      }
    }

    return left
  }

  private parseNot(): Expression {
    if (this.check(TokenType.NOT)) {
      this.advance()
      const operand = this.parseNot()
      return {
        type: 'UnaryExpression',
        operator: 'not',
        operand,
      }
    }

    return this.parseComparison()
  }

  private parseComparison(): Expression {
    let left = this.parseIn()

    const comparisonOps = [
      TokenType.EQUALS,
      TokenType.NOT_EQUALS,
      TokenType.LESS_THAN,
      TokenType.GREATER_THAN,
      TokenType.LESS_EQUAL,
      TokenType.GREATER_EQUAL,
    ]

    while (this.check(...comparisonOps)) {
      const opToken = this.advance()
      let operator: string

      switch (opToken.type) {
        case TokenType.EQUALS:
          operator = '='
          break
        case TokenType.NOT_EQUALS:
          operator = '!='
          break
        case TokenType.LESS_THAN:
          operator = '<'
          break
        case TokenType.GREATER_THAN:
          operator = '>'
          break
        case TokenType.LESS_EQUAL:
          operator = '<='
          break
        case TokenType.GREATER_EQUAL:
          operator = '>='
          break
        default:
          operator = opToken.value
      }

      const right = this.parseIn()
      left = {
        type: 'BinaryExpression',
        operator,
        left,
        right,
      }
    }

    // Handle optional comparison operators ?= ?!=
    if (this.check(TokenType.OPTIONAL_EQUALS)) {
      this.advance()
      const right = this.parseIn()
      left = {
        type: 'BinaryExpression',
        operator: '?=',
        left,
        right,
      }
    } else if (this.check(TokenType.OPTIONAL_NOT_EQUALS)) {
      this.advance()
      const right = this.parseIn()
      left = {
        type: 'BinaryExpression',
        operator: '?!=',
        left,
        right,
      }
    }

    return left
  }

  private parseIn(): Expression {
    let left = this.parseLike()

    // Check for 'in' or 'not in'
    let negated = false
    if (this.check(TokenType.NOT) && this.peek(1).type === TokenType.IN) {
      this.advance() // not
      negated = true
    }

    if (this.check(TokenType.IN)) {
      this.advance()
      const set = this.parseSetOperator()
      return {
        type: 'InExpression',
        expression: left,
        set,
        negated,
      }
    }

    return left
  }

  private parseLike(): Expression {
    let left = this.parseIs()

    // Check for 'like', 'ilike', 'not like', 'not ilike'
    let negated = false
    if (this.check(TokenType.NOT) && (this.peek(1).type === TokenType.LIKE || this.peek(1).type === TokenType.ILIKE)) {
      this.advance() // not
      negated = true
    }

    if (this.check(TokenType.LIKE)) {
      this.advance()
      const pattern = this.parseSetOperator()
      return {
        type: 'LikeExpression',
        expression: left,
        pattern,
        caseInsensitive: false,
        negated,
      }
    }

    if (this.check(TokenType.ILIKE)) {
      this.advance()
      const pattern = this.parseSetOperator()
      return {
        type: 'LikeExpression',
        expression: left,
        pattern,
        caseInsensitive: true,
        negated,
      }
    }

    return left
  }

  private parseIs(): Expression {
    let left = this.parseSetOperator()

    // Check for 'is' or 'is not'
    if (this.check(TokenType.IS)) {
      this.advance()
      let negated = false

      if (this.check(TokenType.NOT)) {
        this.advance()
        negated = true
      }

      // Check for 'typeof'
      if (this.checkKeyword('typeof')) {
        this.advance()
        const argument = this.parseUnary()
        return {
          type: 'TypeCheckExpression',
          expression: left,
          typeName: 'typeof',
          negated,
        }
      }

      const typeName = this.parseTypeName()
      return {
        type: 'TypeCheckExpression',
        expression: left,
        typeName,
        negated,
      }
    }

    return left
  }

  private parseSetOperator(): Expression {
    let left = this.parseCoalesce()

    while (this.check(TokenType.UNION, TokenType.INTERSECT, TokenType.EXCEPT)) {
      const op = this.advance()
      const right = this.parseCoalesce()
      left = {
        type: 'BinaryExpression',
        operator: op.value.toLowerCase(),
        left,
        right,
      }
    }

    return left
  }

  private parseCoalesce(): Expression {
    let left = this.parseConcat()

    while (this.check(TokenType.COALESCE)) {
      this.advance()
      const right = this.parseConcat()
      left = {
        type: 'CoalesceExpression',
        left,
        right,
      }
    }

    return left
  }

  private parseConcat(): Expression {
    let left = this.parseAdditive()

    while (this.check(TokenType.CONCAT)) {
      this.advance()
      const right = this.parseAdditive()
      left = {
        type: 'ConcatExpression',
        left,
        right,
      }
    }

    return left
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative()

    while (this.check(TokenType.PLUS, TokenType.MINUS)) {
      const op = this.advance()
      const right = this.parseMultiplicative()
      left = {
        type: 'BinaryExpression',
        operator: op.type === TokenType.PLUS ? '+' : '-',
        left,
        right,
      }
    }

    return left
  }

  private parseMultiplicative(): Expression {
    let left = this.parsePower()

    while (this.check(TokenType.MULTIPLY, TokenType.DIVIDE, TokenType.MODULO)) {
      const op = this.advance()
      let operator: string

      switch (op.type) {
        case TokenType.MULTIPLY:
          operator = '*'
          break
        case TokenType.DIVIDE:
          // Check for floor division //
          if (this.check(TokenType.DIVIDE)) {
            this.advance()
            operator = '//'
          } else {
            operator = '/'
          }
          break
        case TokenType.MODULO:
          operator = '%'
          break
        default:
          operator = op.value
      }

      const right = this.parsePower()
      left = {
        type: 'BinaryExpression',
        operator,
        left,
        right,
      }
    }

    return left
  }

  private parsePower(): Expression {
    const left = this.parseUnary()

    if (this.check(TokenType.POWER)) {
      this.advance()
      // Power is right-associative
      const right = this.parsePower()
      return {
        type: 'BinaryExpression',
        operator: '^',
        left,
        right,
      }
    }

    return left
  }

  private parseUnary(): Expression {
    if (this.check(TokenType.MINUS)) {
      this.advance()
      const operand = this.parseUnary()
      return {
        type: 'UnaryExpression',
        operator: '-',
        operand,
      }
    }

    if (this.check(TokenType.PLUS)) {
      this.advance()
      const operand = this.parseUnary()
      return {
        type: 'UnaryExpression',
        operator: '+',
        operand,
      }
    }

    if (this.check(TokenType.EXISTS)) {
      this.advance()
      const argument = this.parseUnary()
      return {
        type: 'ExistsExpression',
        argument,
      }
    }

    if (this.check(TokenType.DISTINCT)) {
      this.advance()
      const argument = this.parseUnary()
      return {
        type: 'DistinctExpression',
        argument,
      }
    }

    if (this.checkKeyword('typeof')) {
      this.advance()
      const argument = this.parseUnary()
      return {
        type: 'TypeofExpression',
        argument,
      }
    }

    return this.parsePostfix()
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary()

    // Parse postfix operations like .field, [index], [is Type]
    while (true) {
      if (this.check(TokenType.DOT)) {
        this.advance()

        // Optional access .?
        let optional = false
        if (this.check(TokenType.QUESTION)) {
          this.advance()
          optional = true
        }

        // Check if identifier starts with ? (fallback for lexer variations)
        if (this.check(TokenType.IDENTIFIER) && this.current().value.startsWith('?')) {
          // Check if it's .?field
          optional = true
          const fieldName = this.current().value.slice(1) // Remove leading ?
          this.advance()

          if (expr.type === 'PathExpression') {
            expr.path.push({ type: 'PathSegment', name: fieldName, optional })
          } else {
            expr = {
              type: 'PathExpression',
              path: [
                { type: 'PathSegment', name: '', navigation: 'forward' },
                { type: 'PathSegment', name: fieldName, optional },
              ],
            }
          }
          continue
        }

        const fieldName = this.expect(TokenType.IDENTIFIER).value

        if (expr.type === 'PathExpression') {
          expr.path.push({ type: 'PathSegment', name: fieldName, optional })
        } else {
          // Convert to path expression
          const existingSegment: PathSegment = { type: 'PathSegment', name: '' }
          expr = {
            type: 'PathExpression',
            path: [existingSegment, { type: 'PathSegment', name: fieldName, optional }],
          }
        }
      } else if (this.check(TokenType.LBRACKET)) {
        this.advance()

        // Check for type filter [is Type] or [IS Type]
        if (this.check(TokenType.IS) || (this.check(TokenType.IDENTIFIER) && this.current().value.toUpperCase() === 'IS')) {
          this.advance()
          const typeName = this.parseTypeName()
          this.expect(TokenType.RBRACKET)

          if (expr.type === 'PathExpression' && expr.path.length > 0) {
            expr.path[expr.path.length - 1].typeFilter = typeName
          }
        } else if (this.check(TokenType.NUMBER, TokenType.MINUS)) {
          // Array index
          const indexExpr = this.parseExpression()

          // Check for slice
          if (this.check(TokenType.COLON)) {
            this.advance()
            let endExpr: Expression | undefined
            if (!this.check(TokenType.RBRACKET)) {
              endExpr = this.parseExpression()
            }
            this.expect(TokenType.RBRACKET)

            if (expr.type === 'PathExpression' && expr.path.length > 0) {
              expr.path[expr.path.length - 1].slice = { start: indexExpr, end: endExpr }
            }
          } else {
            this.expect(TokenType.RBRACKET)

            if (expr.type === 'PathExpression' && expr.path.length > 0) {
              expr.path[expr.path.length - 1].index = indexExpr
            }
          }
        } else if (this.check(TokenType.COLON)) {
          // Slice from start [:n]
          this.advance()
          const endExpr = this.parseExpression()
          this.expect(TokenType.RBRACKET)

          if (expr.type === 'PathExpression' && expr.path.length > 0) {
            expr.path[expr.path.length - 1].slice = { end: endExpr }
          }
        } else {
          // General expression index
          const indexExpr = this.parseExpression()
          this.expect(TokenType.RBRACKET)
        }
      } else if (this.check(TokenType.BACKWARD_LINK)) {
        // Backlink .<field
        this.advance()
        const fieldName = this.expect(TokenType.IDENTIFIER).value
        let typeFilter: string | undefined

        // Check for type filter
        if (this.check(TokenType.LBRACKET)) {
          this.advance()
          if (this.check(TokenType.IS) || (this.check(TokenType.IDENTIFIER) && this.current().value.toUpperCase() === 'IS')) {
            this.advance()
            typeFilter = this.parseTypeName()
          }
          this.expect(TokenType.RBRACKET)
        }

        if (expr.type === 'PathExpression') {
          expr.path.push({ type: 'PathSegment', name: fieldName, navigation: 'backward', typeFilter })
        } else {
          expr = {
            type: 'PathExpression',
            path: [{ type: 'PathSegment', name: fieldName, navigation: 'backward', typeFilter }],
          }
        }
      } else {
        break
      }
    }

    return expr
  }

  private parsePrimary(): Expression {
    const token = this.current()

    // Type cast <type>expr or <type>$param
    if (token.type === TokenType.LESS_THAN) {
      return this.parseCast()
    }

    // Parenthesized expression or tuple
    if (token.type === TokenType.LPAREN) {
      this.advance()

      // Check for subquery
      if (this.check(TokenType.SELECT, TokenType.INSERT, TokenType.UPDATE, TokenType.DELETE, TokenType.FOR, TokenType.WITH)) {
        const stmt = this.parseStatement()
        this.expect(TokenType.RPAREN)
        return stmt
      }

      const first = this.parseExpression()

      // Check for tuple
      if (this.check(TokenType.COMMA)) {
        const elements: Expression[] = [first]
        while (this.check(TokenType.COMMA)) {
          this.advance()
          if (this.check(TokenType.RPAREN)) break
          elements.push(this.parseExpression())
        }
        this.expect(TokenType.RPAREN)
        return {
          type: 'TupleLiteral',
          elements,
        }
      }

      this.expect(TokenType.RPAREN)
      return {
        type: 'GroupedExpression',
        expression: first,
      } as GroupedExpression
    }

    // Set literal { ... }
    if (token.type === TokenType.LBRACE) {
      this.advance()
      const elements: Expression[] = []

      while (!this.check(TokenType.RBRACE, TokenType.EOF)) {
        elements.push(this.parseExpression())
        if (this.check(TokenType.COMMA)) {
          this.advance()
          // Allow trailing comma
          if (this.check(TokenType.RBRACE)) break
        } else {
          break
        }
      }

      this.expect(TokenType.RBRACE)
      return {
        type: 'SetExpression',
        elements,
      }
    }

    // Array literal [ ... ]
    if (token.type === TokenType.LBRACKET) {
      this.advance()
      const elements: Expression[] = []

      while (!this.check(TokenType.RBRACKET, TokenType.EOF)) {
        elements.push(this.parseExpression())
        if (this.check(TokenType.COMMA)) {
          this.advance()
          if (this.check(TokenType.RBRACKET)) break
        } else {
          break
        }
      }

      this.expect(TokenType.RBRACKET)
      return {
        type: 'ArrayLiteral',
        elements,
      }
    }

    // String literal
    if (token.type === TokenType.STRING) {
      this.advance()
      return {
        type: 'StringLiteral',
        value: token.value,
      }
    }

    // Number literal
    if (token.type === TokenType.NUMBER) {
      this.advance()
      return {
        type: 'NumberLiteral',
        value: parseFloat(token.value),
      }
    }

    // Boolean literals
    if (token.type === TokenType.TRUE) {
      this.advance()
      return {
        type: 'BooleanLiteral',
        value: true,
      }
    }

    if (token.type === TokenType.FALSE) {
      this.advance()
      return {
        type: 'BooleanLiteral',
        value: false,
      }
    }

    // Parameter $name
    if (token.type === TokenType.PARAMETER) {
      this.advance()
      return {
        type: 'ParameterExpression',
        name: token.value,
      }
    }

    // Path expression starting with .
    if (token.type === TokenType.DOT) {
      return this.parsePathExpression()
    }

    // Backlink starting with .<
    if (token.type === TokenType.BACKWARD_LINK) {
      return this.parseBacklinkExpression()
    }

    // Identifier or keyword-as-identifier (could be type name, function call, or variable)
    if (this.isIdentifierLike(token.type)) {
      // Look ahead to see if it's a function call
      if (this.peek(1).type === TokenType.LPAREN) {
        return this.parseFunctionCall()
      }

      // Could be module::name
      if (this.peek(1).type === TokenType.NAMESPACE) {
        return this.parseModuleQualified()
      }

      const name = this.parseIdentifierOrKeyword()

      // Check for continuation path User.field
      if (this.check(TokenType.DOT)) {
        const path: PathSegment[] = [{ type: 'PathSegment', name }]

        while (this.check(TokenType.DOT)) {
          this.advance()
          // Check for optional
          let optional = false
          if (this.check(TokenType.QUESTION)) {
            this.advance()
            optional = true
          }
          const fieldName = this.parseIdentifierOrKeyword()
          path.push({ type: 'PathSegment', name: fieldName, optional })
        }

        return {
          type: 'PathExpression',
          path,
        }
      }

      return {
        type: 'PathExpression',
        path: [{ type: 'PathSegment', name }],
      }
    }

    throw new SyntaxError(
      `Unexpected token ${token.type} at line ${token.line}, column ${token.column}`
    )
  }

  private parseCast(): CastExpression {
    this.expect(TokenType.LESS_THAN)

    // Parse type
    let typeRef = ''

    // Check for 'optional' modifier
    if (this.check(TokenType.OPTIONAL)) {
      this.advance()
      typeRef = 'optional '
    }

    // Parse the type name (could be array<T>, etc.)
    typeRef += this.parseTypeRef()

    this.expect(TokenType.GREATER_THAN)

    // Parse the value being cast
    const value = this.parsePostfix()

    return {
      type: 'CastExpression',
      typeRef: typeRef.trim(),
      value,
    }
  }

  private parseTypeRef(): string {
    let result = ''

    // Identifier or keyword
    const first = this.current()
    if (first.type === TokenType.IDENTIFIER || first.type === TokenType.OPTIONAL) {
      result = this.advance().value
    } else {
      throw new SyntaxError(`Expected type name at line ${first.line}`)
    }

    // Check for module qualification
    while (this.check(TokenType.NAMESPACE)) {
      this.advance()
      result += '::' + this.expect(TokenType.IDENTIFIER).value
    }

    // Check for generic type parameters like array<str>
    if (this.check(TokenType.LESS_THAN)) {
      this.advance()
      result += '<'
      result += this.parseTypeRef()
      this.expect(TokenType.GREATER_THAN)
      result += '>'
    }

    return result
  }

  private parsePathExpression(): PathExpression {
    const path: PathSegment[] = []

    while (this.check(TokenType.DOT)) {
      this.advance()

      // Check for optional .?
      let optional = false
      if (this.check(TokenType.QUESTION)) {
        this.advance()
        optional = true
      }

      // Check for optional backlink .?<field (BACKWARD_LINK or LESS_THAN followed by identifier)
      if (optional && (this.check(TokenType.BACKWARD_LINK) || this.check(TokenType.LESS_THAN))) {
        if (this.check(TokenType.BACKWARD_LINK)) {
          this.advance()
        } else {
          // LESS_THAN case - consume it
          this.advance()
        }
        const fieldName = this.parseIdentifierOrKeyword()
        let typeFilter: string | undefined

        // Check for type filter
        if (this.check(TokenType.LBRACKET)) {
          this.advance()
          if (this.check(TokenType.IS) || (this.check(TokenType.IDENTIFIER) && this.current().value.toUpperCase() === 'IS')) {
            this.advance()
            typeFilter = this.parseTypeName()
          }
          this.expect(TokenType.RBRACKET)
        }

        path.push({ type: 'PathSegment', name: fieldName, navigation: 'backward', typeFilter, optional: true })
        continue
      }

      // Check for optional .?field (lexer variation)
      if (this.check(TokenType.IDENTIFIER) && this.current().value.startsWith('?')) {
        const fieldName = this.current().value.slice(1)
        this.advance()
        path.push({ type: 'PathSegment', name: fieldName, optional: true })
        continue
      }

      // Check for type filter .[is Type]
      if (this.check(TokenType.LBRACKET)) {
        this.advance()
        if (this.check(TokenType.IS) || (this.check(TokenType.IDENTIFIER) && this.current().value.toUpperCase() === 'IS')) {
          this.advance()
          const typeName = this.parseTypeName()
          this.expect(TokenType.RBRACKET)
          path.push({ type: 'PathSegment', name: '', typeFilter: typeName, optional })
          continue
        }
        // Put back bracket if not type filter
        this.pos--
      }

      const fieldName = this.parseIdentifierOrKeyword()
      let segment: PathSegment = { type: 'PathSegment', name: fieldName, optional }

      // Check for type filter
      if (this.check(TokenType.LBRACKET)) {
        this.advance()
        if (this.check(TokenType.IS) || (this.check(TokenType.IDENTIFIER) && this.current().value.toUpperCase() === 'IS')) {
          this.advance()
          segment.typeFilter = this.parseTypeName()
        } else if (this.check(TokenType.NUMBER, TokenType.MINUS)) {
          // Array index
          const indexExpr = this.parseExpression()
          if (this.check(TokenType.COLON)) {
            this.advance()
            let endExpr: Expression | undefined
            if (!this.check(TokenType.RBRACKET)) {
              endExpr = this.parseExpression()
            }
            segment.slice = { start: indexExpr, end: endExpr }
          } else {
            segment.index = indexExpr
          }
        } else if (this.check(TokenType.COLON)) {
          this.advance()
          const endExpr = this.parseExpression()
          segment.slice = { end: endExpr }
        }
        this.expect(TokenType.RBRACKET)
      }

      path.push(segment)
    }

    return {
      type: 'PathExpression',
      path,
    }
  }

  private parseBacklinkExpression(): PathExpression {
    const path: PathSegment[] = []

    // Optional .? prefix
    let optional = false
    if (this.check(TokenType.DOT)) {
      this.advance()
      if (this.check(TokenType.QUESTION)) {
        this.advance()
        optional = true
      }
    }

    this.expect(TokenType.BACKWARD_LINK)
    const fieldName = this.expect(TokenType.IDENTIFIER).value
    let typeFilter: string | undefined

    // Check for type filter
    if (this.check(TokenType.LBRACKET)) {
      this.advance()
      if (this.check(TokenType.IS) || (this.check(TokenType.IDENTIFIER) && this.current().value.toUpperCase() === 'IS')) {
        this.advance()
        typeFilter = this.parseTypeName()
      }
      this.expect(TokenType.RBRACKET)
    }

    path.push({ type: 'PathSegment', name: fieldName, navigation: 'backward', typeFilter, optional })

    // Continue parsing any further path elements
    while (this.check(TokenType.DOT, TokenType.BACKWARD_LINK)) {
      if (this.check(TokenType.DOT)) {
        this.advance()
        const nextField = this.expect(TokenType.IDENTIFIER).value
        let nextTypeFilter: string | undefined

        if (this.check(TokenType.LBRACKET)) {
          this.advance()
          if (this.check(TokenType.IS) || (this.check(TokenType.IDENTIFIER) && this.current().value.toUpperCase() === 'IS')) {
            this.advance()
            nextTypeFilter = this.parseTypeName()
          }
          this.expect(TokenType.RBRACKET)
        }

        path.push({ type: 'PathSegment', name: nextField, typeFilter: nextTypeFilter })
      } else if (this.check(TokenType.BACKWARD_LINK)) {
        this.advance()
        const nextField = this.expect(TokenType.IDENTIFIER).value
        let nextTypeFilter: string | undefined

        if (this.check(TokenType.LBRACKET)) {
          this.advance()
          if (this.check(TokenType.IS) || (this.check(TokenType.IDENTIFIER) && this.current().value.toUpperCase() === 'IS')) {
            this.advance()
            nextTypeFilter = this.parseTypeName()
          }
          this.expect(TokenType.RBRACKET)
        }

        path.push({ type: 'PathSegment', name: nextField, navigation: 'backward', typeFilter: nextTypeFilter })
      }
    }

    return {
      type: 'PathExpression',
      path,
    }
  }

  private parseFunctionCall(): FunctionCall {
    const name = this.parseTypeName()
    this.expect(TokenType.LPAREN)

    const args: Expression[] = []

    while (!this.check(TokenType.RPAREN, TokenType.EOF)) {
      args.push(this.parseExpression())
      if (this.check(TokenType.COMMA)) {
        this.advance()
      } else {
        break
      }
    }

    this.expect(TokenType.RPAREN)

    return {
      type: 'FunctionCall',
      name,
      args,
    }
  }

  private parseModuleQualified(): Expression {
    const parts: string[] = []
    parts.push(this.expect(TokenType.IDENTIFIER).value)

    while (this.check(TokenType.NAMESPACE)) {
      this.advance()
      parts.push(this.expect(TokenType.IDENTIFIER).value)
    }

    const fullName = parts.join('::')

    // Check if it's a function call
    if (this.check(TokenType.LPAREN)) {
      this.advance()
      const args: Expression[] = []

      while (!this.check(TokenType.RPAREN, TokenType.EOF)) {
        args.push(this.parseExpression())
        if (this.check(TokenType.COMMA)) {
          this.advance()
        } else {
          break
        }
      }

      this.expect(TokenType.RPAREN)

      return {
        type: 'FunctionCall',
        name: fullName,
        args,
      }
    }

    // It's a type reference or path
    return {
      type: 'PathExpression',
      path: [{ type: 'PathSegment', name: fullName }],
    }
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Parse EdgeQL source code into an AST
 *
 * @param source - EdgeQL source code
 * @returns Parsed AST statement
 *
 * @example
 * ```typescript
 * const ast = parse('select User { name }')
 * // { type: 'SelectStatement', target: 'User', shape: { fields: [{ name: 'name' }] } }
 * ```
 */
export function parse(source: string): Statement {
  const tokens = tokenize(source)
  const parser = new Parser(tokens)
  return parser.parse()
}

/**
 * Parse EdgeQL and return tokens (for debugging/testing)
 */
export function parseTokens(source: string): Token[] {
  return tokenize(source)
}

// ============================================================================
// SQL GENERATION (for compilation to SQLite)
// ============================================================================

/**
 * Compile EdgeQL AST to SQL
 *
 * This is a naive compiler for the prototype.
 * A production implementation would need proper table/field mapping.
 */
export function compileToSQL(ast: Statement): string {
  if (ast.type === 'SelectStatement') {
    return compileSelect(ast)
  }

  if (ast.type === 'InsertStatement') {
    return compileInsert(ast)
  }

  throw new Error(`Unknown statement type: ${(ast as Statement).type}`)
}

function compileSelect(ast: SelectStatement): string {
  const tableName = ast.target.toLowerCase()
  const fields = compileShapeFields(ast.shape)

  let sql = `SELECT ${fields} FROM ${tableName}`

  if (ast.filter) {
    sql += ` WHERE ${compileExpression(ast.filter.condition)}`
  }

  return sql
}

function compileShapeFields(shape: Shape, prefix = ''): string {
  // For nested shapes, we'd need JOINs
  // This prototype flattens to simple column selection
  return shape.fields
    .map((f) => {
      if (f.shape) {
        // Nested shape would require JOIN - simplified for prototype
        return `${f.name}_id`
      }
      return prefix ? `${prefix}.${f.name}` : f.name
    })
    .join(', ')
}

function compileInsert(ast: InsertStatement): string {
  const tableName = ast.target.toLowerCase()
  const columns = ast.data.assignments.map((a) => a.name).join(', ')
  const values = ast.data.assignments
    .map((a) => compileExpression(a.value))
    .join(', ')

  return `INSERT INTO ${tableName} (${columns}) VALUES (${values})`
}

function compileExpression(expr: Expression): string {
  switch (expr.type) {
    case 'StringLiteral':
      return `'${expr.value.replace(/'/g, "''")}'`

    case 'NumberLiteral':
      return String(expr.value)

    case 'BooleanLiteral':
      return expr.value ? '1' : '0'

    case 'PathExpression':
      // .field becomes column reference
      return expr.path.map(s => s.name).join('.')

    case 'BinaryExpression':
      return `${compileExpression(expr.left)} ${expr.operator} ${compileExpression(expr.right)}`

    default:
      throw new Error(`Unknown expression type: ${(expr as Expression).type}`)
  }
}

export default {
  parse,
  parseTokens,
  tokenize,
  compileToSQL,
}
