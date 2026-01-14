/**
 * SQL WHERE Clause Parser
 *
 * Parses SQL WHERE clause syntax into unified AST format.
 * Supports SELECT statements with GROUP BY, ORDER BY, JOINs, etc.
 *
 * Uses the shared Tokenizer from common.ts for lexical analysis.
 *
 * @see dotdo-yy0cj
 * @see dotdo-nplc2 (refactored to use shared tokenizer)
 */

import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  GroupByNode,
  SortNode,
  ProjectionNode,
  JoinNode,
  ComparisonOp,
  AggregateFunction,
  SortDirection,
  SortColumn,
  ColumnSpec,
  AliasedAggregation,
  JoinType,
  TemporalNode,
  TemporalQueryType,
} from '../ast'

import {
  Tokenizer,
  TokenType,
  type Token,
  ParseError,
  parseNumericLiteral,
} from './common'

// =============================================================================
// Re-export ParseError for external use
// =============================================================================

export { ParseError }

/**
 * Parsed SELECT statement result
 */
export interface ParsedSelect {
  projection?: ProjectionNode
  from?: string
  where?: QueryNode
  groupBy?: GroupByNode
  sort?: SortNode
  join?: JoinNode & { joinType: JoinType }
  limit?: number
  offset?: number
  distinct?: boolean
  /** Temporal clause for AS OF / time travel queries */
  temporal?: TemporalNode
}

// =============================================================================
// Constants
// =============================================================================

/**
 * SQL keywords recognized by the parser
 */
export const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
  'IS', 'NULL', 'LIKE', 'ILIKE', 'TRUE', 'FALSE', 'AS', 'ON',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'OUTER', 'FULL',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
  'LIMIT', 'OFFSET', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'DATE', 'TIMESTAMP', 'INTERVAL', 'ARRAY', 'SIMILAR', 'TO', 'ESCAPE',
  'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ROLLUP', 'OVER',
  'PARTITION', 'ROW_NUMBER', 'CURRENT_TIMESTAMP',
  // Temporal / Time Travel keywords
  'FOR', 'SYSTEM_TIME', 'SYSTEM_VERSION', 'OF', 'BEFORE', 'VERSIONS',
])

// Alias for backwards compatibility
const KEYWORDS = SQL_KEYWORDS

const COMPARISON_OPS = new Set(['=', '!=', '<>', '>', '>=', '<', '<=', '@>'])

// =============================================================================
// SQLWhereParser Class
// =============================================================================

export class SQLWhereParser {
  private tokens: Token[] = []
  private pos = 0
  private input = ''

  /**
   * Parse a WHERE clause string
   */
  parseWhere(sql: string): QueryNode {
    if (!sql || sql.trim().length === 0) {
      return { type: 'predicate', column: '_', op: '=', value: { $always: true } } as PredicateNode
    }

    this.input = sql
    this.tokens = this.tokenize(sql)
    this.pos = 0

    if (this.tokens.length === 0 || this.tokens[0]!.type === 'EOF') {
      return { type: 'predicate', column: '_', op: '=', value: { $always: true } } as PredicateNode
    }

    const result = this.parseOr()

    // Check for unexpected remaining tokens
    if (this.current().type !== 'EOF') {
      throw new ParseError(`Unexpected token: ${this.current().value}`, this.current().position)
    }

    return result
  }

  /**
   * Parse a full SELECT statement
   */
  parseSelect(sql: string): ParsedSelect {
    this.input = sql
    this.tokens = this.tokenize(sql)
    this.pos = 0

    const result: ParsedSelect = {}

    // Parse SELECT clause
    if (this.matchKeyword('SELECT')) {
      // Check for DISTINCT
      if (this.matchKeyword('DISTINCT')) {
        result.distinct = true
      }

      result.projection = this.parseProjectionList()
    }

    // Parse FROM clause
    if (this.matchKeyword('FROM')) {
      result.from = this.parseIdentifier()

      // Parse temporal clause (FOR SYSTEM_TIME AS OF, etc.)
      // This must come right after the table name, before JOINs
      if (this.matchKeyword('FOR')) {
        result.temporal = this.parseTemporalClause()
      }

      // Parse JOINs
      while (this.peekJoin()) {
        result.join = this.parseJoin()
      }
    }

    // Parse WHERE clause
    if (this.matchKeyword('WHERE')) {
      result.where = this.parseOr()
    }

    // Parse GROUP BY clause
    if (this.matchKeyword('GROUP')) {
      this.expectKeyword('BY')
      result.groupBy = this.parseGroupBy()
    }

    // Parse ORDER BY clause
    if (this.matchKeyword('ORDER')) {
      this.expectKeyword('BY')
      result.sort = this.parseOrderBy()
    }

    // Parse LIMIT/OFFSET
    if (this.matchKeyword('LIMIT')) {
      const first = this.parseNumber()

      if (this.match(',')) {
        // LIMIT offset, count syntax
        result.offset = first
        result.limit = this.parseNumber()
      } else {
        result.limit = first

        if (this.matchKeyword('OFFSET')) {
          result.offset = this.parseNumber()
        }
      }
    }

    return result
  }

  // ===========================================================================
  // Lexer
  // ===========================================================================

  /**
   * Tokenize SQL input using the shared Tokenizer.
   *
   * Uses the shared Tokenizer from common.ts which already supports
   * SQL-specific operators (->>, ->, @>), comparison operators, and comments.
   *
   * @see dotdo-nplc2 (refactored to use shared tokenizer)
   */
  private tokenize(input: string): Token[] {
    // Use shared tokenizer with SQL keywords
    // The shared tokenizer already handles SQL-specific operators:
    // - JSON operators: ->>, ->
    // - Array operators: @>
    // - Comparison: =, !=, <>, >, >=, <, <=
    // - Comments: -- and /* */
    //
    // SQL uses SQL-92 style escaping (doubled quotes) rather than backslash escapes
    const tokenizer = new Tokenizer(input, {
      keywords: KEYWORDS,
      backslashEscapes: false,
    })

    return tokenizer.tokenizeAll()
  }

  // ===========================================================================
  // Parser Helpers
  // ===========================================================================

  private current(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '', position: this.input.length }
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] || { type: 'EOF', value: '', position: this.input.length }
  }

  private advance(): Token {
    const token = this.current()
    this.pos++
    return token
  }

  private match(value: string): boolean {
    if (this.current().value === value || this.current().value.toUpperCase() === value) {
      this.advance()
      return true
    }
    return false
  }

  private matchKeyword(keyword: string): boolean {
    if (this.current().type === 'KEYWORD' && this.current().value === keyword) {
      this.advance()
      return true
    }
    return false
  }

  private expectKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      throw new ParseError(`Expected ${keyword}`, this.current().position)
    }
  }

  private parseIdentifier(): string {
    const token = this.current()
    if (token.type === 'IDENTIFIER' || token.type === 'STRING' || token.type === 'KEYWORD') {
      this.advance()
      return token.value
    }
    throw new ParseError('Expected identifier', token.position)
  }

  private parseNumber(): number {
    const token = this.current()
    if (token.type === 'NUMBER') {
      this.advance()
      return parseFloat(token.value)
    }
    throw new ParseError('Expected number', token.position)
  }

  // ===========================================================================
  // Expression Parsing (Recursive Descent)
  // ===========================================================================

  private parseOr(): QueryNode {
    let left = this.parseAnd()

    while (this.matchKeyword('OR')) {
      const right = this.parseAnd()
      left = {
        type: 'logical',
        op: 'OR',
        children: [left, right],
      }
    }

    return left
  }

  private parseAnd(): QueryNode {
    let left = this.parseNot()

    while (this.matchKeyword('AND')) {
      const right = this.parseNot()
      left = {
        type: 'logical',
        op: 'AND',
        children: [left, right],
      }
    }

    return left
  }

  private parseNot(): QueryNode {
    if (this.matchKeyword('NOT')) {
      const child = this.parseNot()
      return {
        type: 'logical',
        op: 'NOT',
        children: [child],
      }
    }

    return this.parsePrimary()
  }

  private parsePrimary(): QueryNode {
    // Handle EXISTS subquery
    if (this.matchKeyword('EXISTS')) {
      this.match('(')
      // Skip subquery for now
      let depth = 1
      while (depth > 0 && this.current().type !== 'EOF') {
        if (this.current().value === '(') depth++
        if (this.current().value === ')') depth--
        this.advance()
      }
      return { type: 'predicate', column: '$exists', op: '=', value: true } as PredicateNode
    }

    // Handle parenthesized expression
    if (this.current().type === 'LPAREN') {
      this.advance() // consume (
      const expr = this.parseOr()
      if (this.current().type !== 'RPAREN') {
        throw new ParseError('Unbalanced parentheses', this.current().position)
      }
      this.advance() // consume )
      return expr
    }

    return this.parseComparison()
  }

  private parseComparison(): QueryNode {
    // Parse left side (column)
    const column = this.parseColumnRef()

    // Handle IS NULL / IS NOT NULL
    if (this.matchKeyword('IS')) {
      const not = this.matchKeyword('NOT')
      this.expectKeyword('NULL')
      return {
        type: 'predicate',
        column,
        op: not ? 'IS NOT NULL' : 'IS NULL',
        value: null,
      }
    }

    // Handle NOT IN, NOT BETWEEN, NOT LIKE
    const isNot = this.matchKeyword('NOT')

    // Handle IN
    if (this.matchKeyword('IN')) {
      this.match('(')

      // Check for subquery
      if (this.matchKeyword('SELECT')) {
        // Skip subquery
        let depth = 1
        while (depth > 0 && this.current().type !== 'EOF') {
          if (this.current().value === '(') depth++
          if (this.current().value === ')') depth--
          if (depth > 0) this.advance()
        }
        this.advance() // consume )
        return { type: 'predicate', column, op: isNot ? 'NOT IN' : 'IN', value: { $subquery: true } } as PredicateNode
      }

      const values = this.parseValueList()
      this.match(')')
      return {
        type: 'predicate',
        column,
        op: isNot ? 'NOT IN' : 'IN',
        value: values,
      }
    }

    // Handle BETWEEN
    if (this.matchKeyword('BETWEEN')) {
      const low = this.parseValue()
      this.expectKeyword('AND')
      const high = this.parseValue()

      const betweenPred: PredicateNode = {
        type: 'predicate',
        column,
        op: 'BETWEEN',
        value: [low, high],
      }

      if (isNot) {
        return { type: 'logical', op: 'NOT', children: [betweenPred] }
      }
      return betweenPred
    }

    // Handle LIKE / ILIKE
    if (this.matchKeyword('LIKE') || this.matchKeyword('ILIKE')) {
      const value = this.parseValue()

      // Handle ESCAPE clause
      if (this.matchKeyword('ESCAPE')) {
        this.parseValue() // consume escape character
      }

      const likePred: PredicateNode = {
        type: 'predicate',
        column,
        op: 'LIKE',
        value,
      }

      if (isNot) {
        return { type: 'logical', op: 'NOT', children: [likePred] }
      }
      return likePred
    }

    // Handle SIMILAR TO
    if (this.matchKeyword('SIMILAR')) {
      this.expectKeyword('TO')
      const value = this.parseValue()
      return {
        type: 'predicate',
        column,
        op: 'LIKE',
        value,
      }
    }

    // If we had NOT but no following keyword, that's an error
    if (isNot) {
      throw new ParseError('Expected IN, BETWEEN, or LIKE after NOT', this.current().position)
    }

    // Handle comparison operators
    const token = this.current()
    if (token.type === 'OPERATOR' && COMPARISON_OPS.has(token.value)) {
      this.advance()
      const op = token.value === '<>' ? '!=' : token.value

      // Handle subquery comparison
      if (this.current().type === 'LPAREN' && this.peek(1).type === 'KEYWORD' && this.peek(1).value === 'SELECT') {
        this.advance() // consume (
        // Skip subquery
        let depth = 1
        while (depth > 0 && this.current().type !== 'EOF') {
          if (this.current().value === '(') depth++
          if (this.current().value === ')') depth--
          if (depth > 0) this.advance()
        }
        this.advance() // consume )
        return { type: 'predicate', column, op: op as ComparisonOp, value: { $subquery: true } } as PredicateNode
      }

      // Check if the value is a column reference (for JOIN conditions like a.id = b.id)
      const valueTok = this.current()
      if (valueTok.type === 'IDENTIFIER') {
        // This is a column reference
        const refColumn = this.parseColumnRef()
        return {
          type: 'predicate',
          column,
          op: op as ComparisonOp,
          value: { $ref: refColumn },
        }
      }

      const value = this.parseValue()
      return {
        type: 'predicate',
        column,
        op: op as ComparisonOp,
        value,
      }
    }

    // Handle boolean column (no operator) - treated as column = TRUE
    // This allows "NOT deleted" to work (becomes NOT (deleted = TRUE))
    if (token.type === 'EOF' || token.type === 'RPAREN' ||
        (token.type === 'KEYWORD' && ['AND', 'OR', 'ORDER', 'GROUP', 'LIMIT', 'HAVING'].includes(token.value))) {
      return {
        type: 'predicate',
        column,
        op: '=',
        value: true,
      }
    }

    throw new ParseError(`Expected operator after column ${column}`, token.position)
  }

  private parseColumnRef(): string {
    let column = ''

    // Handle aggregate functions (COUNT, SUM, AVG, MIN, MAX)
    const token = this.current()
    if (token.type === 'KEYWORD' && ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(token.value)) {
      column = this.advance().value
      if (this.current().type === 'LPAREN') {
        this.advance() // consume (
        if (this.current().value === '*') {
          column += '(*)'
          this.advance()
        } else if (this.current().type !== 'RPAREN') {
          column += '(' + this.parseColumnRef() + ')'
        } else {
          column += '()'
        }
        if (this.current().type === 'RPAREN') {
          this.advance() // consume )
        }
      }
      return column
    }

    // Handle quoted identifier
    if (this.current().type === 'STRING') {
      column = this.advance().value
    } else if (this.current().type === 'IDENTIFIER' || this.current().type === 'KEYWORD') {
      column = this.advance().value
    } else {
      throw new ParseError('Expected column name', this.current().position)
    }

    // Handle qualified name with dots
    while (this.current().type === 'DOT') {
      this.advance()
      column += '.'
      if (this.current().type === 'IDENTIFIER' || this.current().type === 'STRING' || this.current().type === 'KEYWORD') {
        column += this.advance().value
      }
    }

    // Handle JSON operators
    if (this.current().value === '->' || this.current().value === '->>') {
      const jsonOp = this.advance().value
      const key = this.parseValue()
      column += jsonOp + "'" + key + "'"
    }

    return column
  }

  private parseValue(): unknown {
    const token = this.current()

    // Handle DATE/TIMESTAMP literals
    if (token.type === 'KEYWORD' && (token.value === 'DATE' || token.value === 'TIMESTAMP')) {
      this.advance()
      const str = this.current()
      if (str.type === 'STRING') {
        this.advance()
        return str.value
      }
    }

    // Handle CURRENT_TIMESTAMP
    if (token.type === 'KEYWORD' && token.value === 'CURRENT_TIMESTAMP') {
      this.advance()

      // Handle CURRENT_TIMESTAMP - INTERVAL
      if (this.current().value === '-' || this.current().value === '+') {
        this.advance()
        this.matchKeyword('INTERVAL')
        this.parseValue() // interval value
      }

      return Date.now()
    }

    // Handle INTERVAL
    if (token.type === 'KEYWORD' && token.value === 'INTERVAL') {
      this.advance()
      const value = this.parseValue()
      return value
    }

    // Handle ARRAY literals
    if (token.type === 'KEYWORD' && token.value === 'ARRAY') {
      this.advance()
      this.match('[')
      const values = this.parseValueList()
      this.match(']')
      return values
    }

    // Handle boolean literals
    if (token.type === 'KEYWORD' && token.value === 'TRUE') {
      this.advance()
      return true
    }
    if (token.type === 'KEYWORD' && token.value === 'FALSE') {
      this.advance()
      return false
    }
    if (token.type === 'KEYWORD' && token.value === 'NULL') {
      this.advance()
      return null
    }

    // Handle numbers
    if (token.type === 'NUMBER') {
      this.advance()
      const num = parseFloat(token.value)
      return Number.isInteger(num) && !token.value.includes('.') ? parseInt(token.value) : num
    }

    // Handle strings
    if (token.type === 'STRING') {
      this.advance()
      return token.value
    }

    // Handle parenthesized subquery or expression
    if (token.type === 'LPAREN') {
      this.advance()
      // Check for SELECT (subquery)
      if (this.matchKeyword('SELECT')) {
        let depth = 1
        while (depth > 0 && this.current().type !== 'EOF') {
          if (this.current().value === '(') depth++
          if (this.current().value === ')') depth--
          if (depth > 0) this.advance()
        }
        this.advance() // consume )
        return { $subquery: true }
      }
      // Otherwise it's a parenthesized expression or value list
      const values = this.parseValueList()
      this.match(')')
      return values.length === 1 ? values[0] : values
    }

    throw new ParseError(`Unexpected token: ${token.value}`, token.position)
  }

  private parseValueList(): unknown[] {
    const values: unknown[] = []

    // Handle empty list or closing paren
    if (this.current().type === 'RPAREN' || this.current().value === ']') {
      return values
    }

    values.push(this.parseValue())

    while (this.match(',')) {
      values.push(this.parseValue())
    }

    return values
  }

  // ===========================================================================
  // SELECT Clause Parsing
  // ===========================================================================

  private parseProjectionList(): ProjectionNode {
    const columns: ColumnSpec[] = []

    // Handle SELECT *
    if (this.current().value === '*') {
      this.advance()
      return { type: 'projection', columns: [{ source: '*', include: true }] }
    }

    do {
      const col = this.parseSelectColumn()
      columns.push(col)
    } while (this.match(','))

    return { type: 'projection', columns }
  }

  private parseSelectColumn(): ColumnSpec {
    // Check for aggregate functions
    const token = this.current()
    if (token.type === 'KEYWORD' && ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ROW_NUMBER'].includes(token.value)) {
      const fnName = token.value
      this.advance()
      this.match('(')

      let column: string | undefined
      let columnArg = '*'
      if (this.current().value === '*') {
        this.advance()
        columnArg = '*'
      } else if (this.current().value !== ')') {
        column = this.parseColumnRef()
        columnArg = column
      }

      this.match(')')

      // Handle OVER clause for window functions
      if (this.matchKeyword('OVER')) {
        this.match('(')
        // Skip PARTITION BY and ORDER BY
        let depth = 1
        while (depth > 0 && this.current().type !== 'EOF') {
          if (this.current().value === '(') depth++
          if (this.current().value === ')') depth--
          if (depth > 0) this.advance()
        }
        this.advance()
      }

      let alias: string | undefined
      if (this.matchKeyword('AS')) {
        alias = this.parseIdentifier()
      } else if (this.current().type === 'IDENTIFIER') {
        alias = this.parseIdentifier()
      }

      // Return the full aggregate expression as source
      return {
        source: `${fnName}(${columnArg})`,
        alias,
        include: true,
      }
    }

    // Regular column
    const source = this.parseColumnRef()

    let alias: string | undefined
    if (this.matchKeyword('AS')) {
      alias = this.parseIdentifier()
    } else if (this.current().type === 'IDENTIFIER' && !this.peekKeyword()) {
      alias = this.parseIdentifier()
    }

    return { source, alias, include: true }
  }

  private peekKeyword(): boolean {
    const val = this.current().value.toUpperCase()
    return ['FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS'].includes(val)
  }

  // ===========================================================================
  // GROUP BY / ORDER BY Parsing
  // ===========================================================================

  private parseGroupBy(): GroupByNode {
    const columns: string[] = []
    const aggregations: AliasedAggregation[] = []

    // Handle ROLLUP
    if (this.matchKeyword('ROLLUP')) {
      this.match('(')
      do {
        columns.push(this.parseColumnRef())
      } while (this.match(','))
      this.match(')')
    } else {
      // Regular GROUP BY columns
      do {
        columns.push(this.parseColumnRef())
      } while (this.match(','))
    }

    // Handle HAVING
    let having: QueryNode | undefined
    if (this.matchKeyword('HAVING')) {
      having = this.parseOr()
    }

    return {
      type: 'groupBy',
      columns,
      aggregations,
      having,
    }
  }

  private parseOrderBy(): SortNode {
    const columns: SortColumn[] = []

    do {
      const column = this.parseColumnRef()
      let direction: SortDirection = 'ASC'
      let nulls: 'first' | 'last' | undefined

      if (this.matchKeyword('DESC')) {
        direction = 'DESC'
      } else {
        this.matchKeyword('ASC')
      }

      if (this.matchKeyword('NULLS')) {
        if (this.matchKeyword('FIRST')) {
          nulls = 'first'
        } else if (this.matchKeyword('LAST')) {
          nulls = 'last'
        }
      }

      columns.push({ column, direction, nulls })
    } while (this.match(','))

    return { type: 'sort', columns }
  }

  // ===========================================================================
  // JOIN Parsing
  // ===========================================================================

  private peekJoin(): boolean {
    const token = this.current()
    if (token.type !== 'KEYWORD') return false
    return ['JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'FULL'].includes(token.value)
  }

  private parseJoin(): JoinNode & { joinType: JoinType } {
    let joinType: JoinType = 'INNER'

    if (this.matchKeyword('LEFT')) {
      joinType = 'LEFT'
      this.matchKeyword('OUTER')
    } else if (this.matchKeyword('RIGHT')) {
      joinType = 'RIGHT'
      this.matchKeyword('OUTER')
    } else if (this.matchKeyword('CROSS')) {
      joinType = 'CROSS'
    } else if (this.matchKeyword('INNER')) {
      joinType = 'INNER'
    } else if (this.matchKeyword('FULL')) {
      joinType = 'LEFT' // Simplified: treat FULL as LEFT
      this.matchKeyword('OUTER')
    }

    this.expectKeyword('JOIN')

    const right = this.parseIdentifier()

    // Handle table alias
    let rightAlias = right
    if (this.current().type === 'IDENTIFIER' && this.current().value.toUpperCase() !== 'ON') {
      rightAlias = this.parseIdentifier()
    }

    let on: PredicateNode | LogicalNode

    if (joinType === 'CROSS') {
      // Cross join has no ON clause
      on = { type: 'predicate', column: '_', op: '=', value: true } as PredicateNode
    } else {
      this.expectKeyword('ON')
      on = this.parseOr() as PredicateNode | LogicalNode
    }

    return {
      type: 'join',
      joinType,
      left: '$current',
      right,
      on: on as PredicateNode,
    }
  }

  // ===========================================================================
  // Temporal / Time Travel Clause Parsing
  // ===========================================================================

  /**
   * Parse temporal clause after FOR keyword.
   *
   * Supports the following SQL:2011 temporal query patterns:
   * - FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-15T10:00:00Z'
   * - FOR SYSTEM_TIME AS OF 1705312800000
   * - FOR SYSTEM_VERSION AS OF 12345
   * - FOR SYSTEM_TIME BEFORE TIMESTAMP '2024-01-15T10:00:00Z'
   * - FOR SYSTEM_TIME BETWEEN timestamp1 AND timestamp2
   * - FOR SYSTEM_TIME FROM timestamp1 TO timestamp2
   *
   * Also supports the shorter patterns:
   * - AS OF TIMESTAMP '2024-01-15T10:00:00Z'
   * - AS OF 1705312800000
   */
  private parseTemporalClause(): TemporalNode {
    // Handle SYSTEM_TIME or SYSTEM_VERSION
    let isVersionBased = false

    if (this.matchKeyword('SYSTEM_TIME')) {
      isVersionBased = false
    } else if (this.matchKeyword('SYSTEM_VERSION')) {
      isVersionBased = true
    } else {
      // Fallback: expect AS OF directly (short form)
      this.expectKeyword('AS')
      this.expectKeyword('OF')
      return this.parseAsOfValue(false)
    }

    // Parse the temporal operator
    if (this.matchKeyword('AS')) {
      this.expectKeyword('OF')
      return this.parseAsOfValue(isVersionBased)
    }

    if (this.matchKeyword('BEFORE')) {
      return this.parseBeforeValue()
    }

    if (this.matchKeyword('BETWEEN')) {
      return this.parseBetweenTimestamps()
    }

    if (this.matchKeyword('FROM')) {
      return this.parseFromToTimestamps()
    }

    throw new ParseError(
      'Expected AS OF, BEFORE, BETWEEN, or FROM in temporal clause',
      this.current().position
    )
  }

  /**
   * Parse AS OF value (timestamp or version number)
   */
  private parseAsOfValue(isVersionBased: boolean): TemporalNode {
    if (isVersionBased) {
      // FOR SYSTEM_VERSION AS OF <version_number>
      const version = this.parseNumber()
      return {
        type: 'temporal',
        queryType: 'AS_OF',
        snapshotId: version,
      }
    }

    // FOR SYSTEM_TIME AS OF <timestamp>
    const timestamp = this.parseTemporalTimestamp()
    return {
      type: 'temporal',
      queryType: 'AS_OF',
      asOfTimestamp: timestamp,
    }
  }

  /**
   * Parse BEFORE value
   */
  private parseBeforeValue(): TemporalNode {
    const timestamp = this.parseTemporalTimestamp()
    return {
      type: 'temporal',
      queryType: 'BEFORE',
      asOfTimestamp: timestamp,
    }
  }

  /**
   * Parse BETWEEN timestamp1 AND timestamp2
   */
  private parseBetweenTimestamps(): TemporalNode {
    const fromTimestamp = this.parseTemporalTimestamp()
    this.expectKeyword('AND')
    const toTimestamp = this.parseTemporalTimestamp()
    return {
      type: 'temporal',
      queryType: 'BETWEEN',
      asOfTimestamp: fromTimestamp,
      toTimestamp: toTimestamp,
    }
  }

  /**
   * Parse FROM timestamp1 TO timestamp2
   */
  private parseFromToTimestamps(): TemporalNode {
    const fromTimestamp = this.parseTemporalTimestamp()
    this.expectKeyword('TO')
    const toTimestamp = this.parseTemporalTimestamp()
    return {
      type: 'temporal',
      queryType: 'BETWEEN',
      asOfTimestamp: fromTimestamp,
      toTimestamp: toTimestamp,
    }
  }

  /**
   * Parse a timestamp value in temporal clause.
   *
   * Supports:
   * - TIMESTAMP '2024-01-15T10:00:00Z' (ISO string)
   * - '2024-01-15T10:00:00Z' (ISO string without TIMESTAMP keyword)
   * - 1705312800000 (epoch milliseconds)
   * - CURRENT_TIMESTAMP
   * - CURRENT_TIMESTAMP - INTERVAL '1 day'
   */
  private parseTemporalTimestamp(): number {
    // Handle TIMESTAMP keyword
    if (this.matchKeyword('TIMESTAMP')) {
      const token = this.current()
      if (token.type === 'STRING') {
        this.advance()
        return new Date(token.value).getTime()
      }
      throw new ParseError('Expected timestamp string after TIMESTAMP', token.position)
    }

    // Handle CURRENT_TIMESTAMP
    if (this.matchKeyword('CURRENT_TIMESTAMP')) {
      let timestamp = Date.now()

      // Handle CURRENT_TIMESTAMP - INTERVAL
      if (this.current().value === '-' || this.current().value === '+') {
        const isSubtract = this.current().value === '-'
        this.advance()

        if (this.matchKeyword('INTERVAL')) {
          const intervalMs = this.parseIntervalValue()
          timestamp = isSubtract ? timestamp - intervalMs : timestamp + intervalMs
        }
      }

      return timestamp
    }

    // Handle numeric timestamp (epoch ms)
    const token = this.current()
    if (token.type === 'NUMBER') {
      this.advance()
      return parseFloat(token.value)
    }

    // Handle string timestamp without TIMESTAMP keyword
    if (token.type === 'STRING') {
      this.advance()
      return new Date(token.value).getTime()
    }

    throw new ParseError('Expected timestamp value', token.position)
  }

  /**
   * Parse INTERVAL value and return milliseconds.
   *
   * Supports:
   * - INTERVAL '1 day'
   * - INTERVAL '30 minutes'
   * - INTERVAL '2 hours'
   */
  private parseIntervalValue(): number {
    const token = this.current()
    if (token.type !== 'STRING') {
      throw new ParseError('Expected interval string', token.position)
    }
    this.advance()

    // Parse interval string like '1 day' or '30 minutes'
    const match = token.value.match(/^(\d+)\s*(\w+)$/)
    if (!match || !match[1] || !match[2]) {
      throw new ParseError(`Invalid interval format: ${token.value}`, token.position)
    }

    const value = parseInt(match[1], 10)
    const unit = match[2].toLowerCase()

    switch (unit) {
      case 'millisecond':
      case 'milliseconds':
      case 'ms':
        return value
      case 'second':
      case 'seconds':
      case 'sec':
      case 's':
        return value * 1000
      case 'minute':
      case 'minutes':
      case 'min':
        return value * 60 * 1000
      case 'hour':
      case 'hours':
      case 'hr':
      case 'h':
        return value * 60 * 60 * 1000
      case 'day':
      case 'days':
      case 'd':
        return value * 24 * 60 * 60 * 1000
      case 'week':
      case 'weeks':
      case 'w':
        return value * 7 * 24 * 60 * 60 * 1000
      case 'month':
      case 'months':
        return value * 30 * 24 * 60 * 60 * 1000 // Approximate
      case 'year':
      case 'years':
        return value * 365 * 24 * 60 * 60 * 1000 // Approximate
      default:
        throw new ParseError(`Unknown interval unit: ${unit}`, token.position)
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

// Types already exported at definition - removed duplicate exports
