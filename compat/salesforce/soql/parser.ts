/**
 * SOQL Parser
 *
 * Parses SOQL tokens into an Abstract Syntax Tree (AST).
 * Supports SELECT, FROM, WHERE, ORDER BY, LIMIT, OFFSET, GROUP BY, HAVING
 *
 * @module @dotdo/salesforce/soql/parser
 */

import { Lexer, TokenType, type Token, LexerError } from './lexer'
import type {
  SelectNode,
  FieldNode,
  SimpleFieldNode,
  RelationshipFieldNode,
  AggregateFieldNode,
  SubqueryNode,
  FromNode,
  WhereNode,
  ComparisonNode,
  LogicalNode,
  InNode,
  LikeNode,
  NotNode,
  OrderByNode,
  ValueNode,
  StringValueNode,
  NumberValueNode,
  BooleanValueNode,
  NullValueNode,
  DateValueNode,
  DateTimeValueNode,
  DateLiteralNode,
  BindVariableNode,
} from './ast'

/**
 * Parser error with position information
 */
export class ParserError extends Error {
  line: number
  column: number

  constructor(message: string, token: Token) {
    super(`SOQL Parser Error: ${message} at line ${token.line}, column ${token.column}`)
    this.name = 'SOQLParserError'
    this.line = token.line
    this.column = token.column
  }
}

/**
 * SOQL Parser - converts tokens into an AST
 */
export class Parser {
  private lexer: Lexer

  constructor(source: string) {
    this.lexer = new Lexer(source)
  }

  /**
   * Parse the SOQL query and return the AST
   */
  parse(): SelectNode {
    return this.parseSelect()
  }

  private parseSelect(): SelectNode {
    const startToken = this.expect(TokenType.SELECT, 'Expected SELECT')

    // Parse field list
    const fields = this.parseFieldList()

    // Parse FROM clause
    this.expect(TokenType.FROM, 'Expected FROM')
    const from = this.parseFrom()

    // Build the select node
    const select: SelectNode = {
      type: 'Select',
      fields,
      from,
      line: startToken.line,
      column: startToken.column,
    }

    // Parse optional WHERE clause
    if (this.check(TokenType.WHERE)) {
      this.advance()
      select.where = this.parseWhere()
    }

    // Parse optional GROUP BY clause
    if (this.check(TokenType.GROUP)) {
      this.advance()
      this.expect(TokenType.BY, 'Expected BY after GROUP')
      select.groupBy = this.parseGroupByFields()
    }

    // Parse optional HAVING clause
    if (this.check(TokenType.HAVING)) {
      this.advance()
      select.having = this.parseWhere()
    }

    // Parse optional ORDER BY clause
    if (this.check(TokenType.ORDER)) {
      this.advance()
      this.expect(TokenType.BY, 'Expected BY after ORDER')
      select.orderBy = this.parseOrderBy()
    }

    // Parse optional LIMIT
    if (this.check(TokenType.LIMIT)) {
      this.advance()
      const limitToken = this.expect(TokenType.NUMBER, 'Expected number after LIMIT')
      select.limit = parseInt(limitToken.value, 10)
    }

    // Parse optional OFFSET
    if (this.check(TokenType.OFFSET)) {
      this.advance()
      const offsetToken = this.expect(TokenType.NUMBER, 'Expected number after OFFSET')
      select.offset = parseInt(offsetToken.value, 10)
    }

    return select
  }

  private parseFieldList(): FieldNode[] {
    const fields: FieldNode[] = []

    fields.push(this.parseField())

    while (this.check(TokenType.COMMA)) {
      this.advance() // consume comma
      fields.push(this.parseField())
    }

    return fields
  }

  private parseField(): FieldNode {
    const token = this.lexer.peek()

    // Check for aggregate functions
    if (this.isAggregate(token.type)) {
      return this.parseAggregateField()
    }

    // Check for subquery (SELECT inside parentheses)
    if (this.check(TokenType.LPAREN)) {
      return this.parseSubquery()
    }

    // Regular field or relationship field
    return this.parseSimpleOrRelationshipField()
  }

  private isAggregate(type: TokenType): boolean {
    return (
      type === TokenType.COUNT ||
      type === TokenType.SUM ||
      type === TokenType.AVG ||
      type === TokenType.MIN ||
      type === TokenType.MAX ||
      type === TokenType.COUNT_DISTINCT
    )
  }

  private parseAggregateField(): AggregateFieldNode {
    const token = this.advance()
    const func = token.type === TokenType.COUNT_DISTINCT ? 'COUNT_DISTINCT' : (token.value.toUpperCase() as AggregateFieldNode['function'])

    this.expect(TokenType.LPAREN, `Expected ( after ${func}`)

    let field: string | undefined
    if (!this.check(TokenType.RPAREN)) {
      const fieldToken = this.expect(TokenType.IDENTIFIER, 'Expected field name in aggregate')
      field = fieldToken.value
    }

    this.expect(TokenType.RPAREN, `Expected ) after aggregate field`)

    const node: AggregateFieldNode = {
      type: 'AggregateField',
      function: func,
      field,
      line: token.line,
      column: token.column,
    }

    // Check for alias
    if (this.check(TokenType.IDENTIFIER) && this.lexer.peek().value.toLowerCase() !== 'from') {
      node.alias = this.advance().value
    }

    return node
  }

  private parseSubquery(): SubqueryNode {
    const startToken = this.expect(TokenType.LPAREN, 'Expected (')
    const select = this.parseSelect()
    this.expect(TokenType.RPAREN, 'Expected )')

    return {
      type: 'Subquery',
      select,
      relationshipName: select.from.sobject,
      line: startToken.line,
      column: startToken.column,
    }
  }

  private parseSimpleOrRelationshipField(): SimpleFieldNode | RelationshipFieldNode {
    const token = this.expect(TokenType.IDENTIFIER, 'Expected field name')
    const parts = [token.value]

    // Check for dotted path (relationship field)
    while (this.check(TokenType.DOT)) {
      this.advance() // consume dot
      const nextToken = this.expect(TokenType.IDENTIFIER, 'Expected field name after .')
      parts.push(nextToken.value)
    }

    // Check for alias
    let alias: string | undefined
    if (this.check(TokenType.IDENTIFIER) && this.lexer.peek().value.toLowerCase() !== 'from') {
      alias = this.advance().value
    }

    if (parts.length === 1) {
      return {
        type: 'SimpleField',
        name: parts[0],
        alias,
        line: token.line,
        column: token.column,
      }
    }

    return {
      type: 'RelationshipField',
      path: parts,
      alias,
      line: token.line,
      column: token.column,
    }
  }

  private parseFrom(): FromNode {
    const token = this.expect(TokenType.IDENTIFIER, 'Expected object name')

    const node: FromNode = {
      type: 'From',
      sobject: token.value,
      line: token.line,
      column: token.column,
    }

    // Check for alias
    if (this.check(TokenType.IDENTIFIER) && !this.isClauseKeyword(this.lexer.peek().value.toLowerCase())) {
      node.alias = this.advance().value
    }

    return node
  }

  private isClauseKeyword(value: string): boolean {
    return ['where', 'order', 'group', 'having', 'limit', 'offset'].includes(value)
  }

  private parseWhere(): WhereNode {
    return this.parseOrExpression()
  }

  private parseOrExpression(): WhereNode {
    let left = this.parseAndExpression()

    while (this.check(TokenType.OR)) {
      const token = this.advance()
      const right = this.parseAndExpression()
      left = {
        type: 'Logical',
        operator: 'OR',
        left,
        right,
        line: token.line,
        column: token.column,
      }
    }

    return left
  }

  private parseAndExpression(): WhereNode {
    let left = this.parseNotExpression()

    while (this.check(TokenType.AND)) {
      const token = this.advance()
      const right = this.parseNotExpression()
      left = {
        type: 'Logical',
        operator: 'AND',
        left,
        right,
        line: token.line,
        column: token.column,
      }
    }

    return left
  }

  private parseNotExpression(): WhereNode {
    if (this.check(TokenType.NOT)) {
      const token = this.advance()
      const expression = this.parseNotExpression()
      return {
        type: 'Not',
        expression,
        line: token.line,
        column: token.column,
      }
    }

    return this.parsePrimaryCondition()
  }

  private parsePrimaryCondition(): WhereNode {
    // Handle parenthesized expressions
    if (this.check(TokenType.LPAREN)) {
      this.advance()
      const expr = this.parseOrExpression()
      this.expect(TokenType.RPAREN, 'Expected )')
      return expr
    }

    return this.parseCondition()
  }

  private parseCondition(): WhereNode {
    const fieldToken = this.expect(TokenType.IDENTIFIER, 'Expected field name')
    const field = this.parseFieldPath(fieldToken.value)

    const opToken = this.lexer.peek()

    // Handle IN / NOT IN
    if (this.check(TokenType.IN)) {
      this.advance()
      return this.parseInCondition(field, fieldToken, false)
    }

    if (this.check(TokenType.NOT)) {
      this.advance()
      if (this.check(TokenType.IN)) {
        this.advance()
        return this.parseInCondition(field, fieldToken, true)
      }
      if (this.check(TokenType.LIKE)) {
        this.advance()
        return this.parseLikeCondition(field, fieldToken, true)
      }
      throw new ParserError('Expected IN or LIKE after NOT', this.lexer.peek())
    }

    // Handle LIKE
    if (this.check(TokenType.LIKE)) {
      this.advance()
      return this.parseLikeCondition(field, fieldToken, false)
    }

    // Handle INCLUDES/EXCLUDES
    if (this.check(TokenType.INCLUDES) || this.check(TokenType.EXCLUDES)) {
      const op = this.advance()
      return this.parseIncludesExcludes(field, fieldToken, op.type === TokenType.INCLUDES ? 'INCLUDES' : 'EXCLUDES')
    }

    // Handle comparison operators
    const operator = this.parseComparisonOperator()
    const value = this.parseValue()

    return {
      type: 'Comparison',
      field,
      operator,
      value,
      line: fieldToken.line,
      column: fieldToken.column,
    }
  }

  private parseFieldPath(initial: string): string {
    let field = initial
    while (this.check(TokenType.DOT)) {
      this.advance()
      const next = this.expect(TokenType.IDENTIFIER, 'Expected field name after .')
      field += '.' + next.value
    }
    return field
  }

  private parseComparisonOperator(): ComparisonNode['operator'] {
    const token = this.advance()

    switch (token.type) {
      case TokenType.EQ:
        return '='
      case TokenType.NEQ:
        return '!='
      case TokenType.LT:
        return '<'
      case TokenType.GT:
        return '>'
      case TokenType.LTE:
        return '<='
      case TokenType.GTE:
        return '>='
      default:
        throw new ParserError(`Expected comparison operator, got ${token.type}`, token)
    }
  }

  private parseInCondition(field: string, fieldToken: Token, negated: boolean): InNode {
    this.expect(TokenType.LPAREN, 'Expected ( after IN')
    const values: ValueNode[] = []

    if (!this.check(TokenType.RPAREN)) {
      values.push(this.parseValue())
      while (this.check(TokenType.COMMA)) {
        this.advance()
        values.push(this.parseValue())
      }
    }

    this.expect(TokenType.RPAREN, 'Expected ) after IN values')

    return {
      type: 'In',
      field,
      values,
      negated,
      line: fieldToken.line,
      column: fieldToken.column,
    }
  }

  private parseLikeCondition(field: string, fieldToken: Token, negated: boolean): LikeNode {
    const patternToken = this.expect(TokenType.STRING, 'Expected pattern after LIKE')

    return {
      type: 'Like',
      field,
      pattern: patternToken.value,
      negated,
      line: fieldToken.line,
      column: fieldToken.column,
    }
  }

  private parseIncludesExcludes(field: string, fieldToken: Token, operator: 'INCLUDES' | 'EXCLUDES'): WhereNode {
    this.expect(TokenType.LPAREN, `Expected ( after ${operator}`)
    const values: string[] = []

    if (!this.check(TokenType.RPAREN)) {
      const val = this.expect(TokenType.STRING, 'Expected string value')
      values.push(val.value)
      while (this.check(TokenType.COMMA)) {
        this.advance()
        const nextVal = this.expect(TokenType.STRING, 'Expected string value')
        values.push(nextVal.value)
      }
    }

    this.expect(TokenType.RPAREN, `Expected ) after ${operator} values`)

    return {
      type: 'IncludesExcludes',
      field,
      operator,
      values,
      line: fieldToken.line,
      column: fieldToken.column,
    }
  }

  private parseValue(): ValueNode {
    const token = this.lexer.peek()

    switch (token.type) {
      case TokenType.STRING:
        this.advance()
        return {
          type: 'StringValue',
          value: token.value,
          line: token.line,
          column: token.column,
        }

      case TokenType.NUMBER:
        this.advance()
        return {
          type: 'NumberValue',
          value: parseFloat(token.value),
          line: token.line,
          column: token.column,
        }

      case TokenType.BOOLEAN:
        this.advance()
        return {
          type: 'BooleanValue',
          value: token.value.toLowerCase() === 'true',
          line: token.line,
          column: token.column,
        }

      case TokenType.NULL:
        this.advance()
        return {
          type: 'NullValue',
          line: token.line,
          column: token.column,
        }

      case TokenType.DATE:
        this.advance()
        return {
          type: 'DateValue',
          value: token.value,
          line: token.line,
          column: token.column,
        }

      case TokenType.DATETIME:
        this.advance()
        return {
          type: 'DateTimeValue',
          value: token.value,
          line: token.line,
          column: token.column,
        }

      // Date literals
      case TokenType.TODAY:
      case TokenType.YESTERDAY:
      case TokenType.TOMORROW:
      case TokenType.LAST_WEEK:
      case TokenType.THIS_WEEK:
      case TokenType.NEXT_WEEK:
      case TokenType.LAST_MONTH:
      case TokenType.THIS_MONTH:
      case TokenType.NEXT_MONTH:
      case TokenType.LAST_YEAR:
      case TokenType.THIS_YEAR:
      case TokenType.NEXT_YEAR:
        this.advance()
        return {
          type: 'DateLiteral',
          literal: token.value.toUpperCase(),
          line: token.line,
          column: token.column,
        }

      // Date literals with N parameter
      case TokenType.LAST_N_DAYS:
      case TokenType.NEXT_N_DAYS:
        this.advance()
        this.expect(TokenType.COLON, `Expected : after ${token.value}`)
        const nToken = this.expect(TokenType.NUMBER, 'Expected number after :')
        return {
          type: 'DateLiteral',
          literal: token.value.toUpperCase(),
          n: parseInt(nToken.value, 10),
          line: token.line,
          column: token.column,
        }

      case TokenType.COLON:
        // Bind variable
        this.advance()
        const varToken = this.expect(TokenType.IDENTIFIER, 'Expected variable name after :')
        return {
          type: 'BindVariable',
          name: varToken.value,
          line: token.line,
          column: token.column,
        }

      default:
        throw new ParserError(`Unexpected token: ${token.type}`, token)
    }
  }

  private parseGroupByFields(): FieldNode[] {
    const fields: FieldNode[] = []
    fields.push(this.parseSimpleOrRelationshipField())

    while (this.check(TokenType.COMMA)) {
      this.advance()
      fields.push(this.parseSimpleOrRelationshipField())
    }

    return fields
  }

  private parseOrderBy(): OrderByNode[] {
    const orderBy: OrderByNode[] = []

    orderBy.push(this.parseOrderByField())

    while (this.check(TokenType.COMMA)) {
      this.advance()
      orderBy.push(this.parseOrderByField())
    }

    return orderBy
  }

  private parseOrderByField(): OrderByNode {
    const token = this.expect(TokenType.IDENTIFIER, 'Expected field name')
    const field = this.parseFieldPath(token.value)

    let direction: 'ASC' | 'DESC' = 'ASC'
    let nulls: 'FIRST' | 'LAST' | undefined

    // Parse direction
    if (this.check(TokenType.ASC)) {
      this.advance()
      direction = 'ASC'
    } else if (this.check(TokenType.DESC)) {
      this.advance()
      direction = 'DESC'
    }

    // Parse NULLS FIRST/LAST
    if (this.check(TokenType.NULLS)) {
      this.advance()
      if (this.check(TokenType.FIRST)) {
        this.advance()
        nulls = 'FIRST'
      } else if (this.check(TokenType.LAST)) {
        this.advance()
        nulls = 'LAST'
      } else {
        throw new ParserError('Expected FIRST or LAST after NULLS', this.lexer.peek())
      }
    }

    return {
      type: 'OrderBy',
      field,
      direction,
      nulls,
      line: token.line,
      column: token.column,
    }
  }

  private check(type: TokenType): boolean {
    return this.lexer.peek().type === type
  }

  private advance(): Token {
    return this.lexer.next()
  }

  private expect(type: TokenType, message: string): Token {
    const token = this.lexer.peek()
    if (token.type !== type) {
      throw new ParserError(`${message}, got ${token.type} (${token.value})`, token)
    }
    return this.advance()
  }
}

/**
 * Parse a SOQL query string into an AST
 */
export function parse(source: string): SelectNode {
  const parser = new Parser(source)
  return parser.parse()
}
