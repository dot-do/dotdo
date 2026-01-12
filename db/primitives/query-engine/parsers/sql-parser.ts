/**
 * SQL WHERE Clause Parser
 *
 * Parses SQL WHERE clause syntax into unified AST format.
 * Supports SELECT statements with GROUP BY, ORDER BY, JOINs, etc.
 *
 * @see dotdo-yy0cj
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
} from '../ast'

// =============================================================================
// Types
// =============================================================================

/**
 * Token types for SQL lexer
 */
type TokenType =
  | 'KEYWORD'
  | 'IDENTIFIER'
  | 'OPERATOR'
  | 'NUMBER'
  | 'STRING'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'DOT'
  | 'EOF'

/**
 * Token structure
 */
interface Token {
  type: TokenType
  value: string
  position: number
}

/**
 * Parse error with position information
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public position: number,
    public line?: number,
    public column?: number
  ) {
    super(`${message} at position ${position}`)
    this.name = 'ParseError'
  }
}

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
}

// =============================================================================
// Constants
// =============================================================================

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
  'IS', 'NULL', 'LIKE', 'ILIKE', 'TRUE', 'FALSE', 'AS', 'ON',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'OUTER', 'FULL',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
  'LIMIT', 'OFFSET', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'DATE', 'TIMESTAMP', 'INTERVAL', 'ARRAY', 'SIMILAR', 'TO', 'ESCAPE',
  'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ROLLUP', 'OVER',
  'PARTITION', 'ROW_NUMBER', 'CURRENT_TIMESTAMP',
])

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

  private tokenize(input: string): Token[] {
    const tokens: Token[] = []
    let pos = 0

    while (pos < input.length) {
      // Skip whitespace
      while (pos < input.length && /\s/.test(input[pos]!)) {
        pos++
      }

      if (pos >= input.length) break

      const char = input[pos]
      const start = pos

      // Skip comments
      if (char === '-' && input[pos + 1] === '-') {
        while (pos < input.length && input[pos] !== '\n') pos++
        continue
      }
      if (char === '/' && input[pos + 1] === '*') {
        pos += 2
        while (pos < input.length - 1 && !(input[pos] === '*' && input[pos + 1] === '/')) pos++
        pos += 2
        continue
      }

      // Operators
      if (char === '=' || char === '!' || char === '<' || char === '>') {
        let op = char
        pos++
        if (pos < input.length && (input[pos] === '=' || (char === '<' && input[pos] === '>'))) {
          op += input[pos]
          pos++
        }
        tokens.push({ type: 'OPERATOR', value: op, position: start })
        continue
      }

      // Arithmetic operators (but handle - specially for negative numbers and JSON)
      if (char === '+') {
        tokens.push({ type: 'OPERATOR', value: '+', position: start })
        pos++
        continue
      }

      // JSON operators
      if (char === '-' && input[pos + 1] === '>' && input[pos + 2] === '>') {
        tokens.push({ type: 'OPERATOR', value: '->>', position: start })
        pos += 3
        continue
      }
      if (char === '-' && input[pos + 1] === '>') {
        tokens.push({ type: 'OPERATOR', value: '->', position: start })
        pos += 2
        continue
      }

      // Minus operator (when not followed by digit - that's handled below as negative number)
      if (char === '-' && !/\d/.test(input[pos + 1] || '')) {
        tokens.push({ type: 'OPERATOR', value: '-', position: start })
        pos++
        continue
      }

      // Array operators
      if (char === '@' && input[pos + 1] === '>') {
        tokens.push({ type: 'OPERATOR', value: '@>', position: start })
        pos += 2
        continue
      }

      // Parentheses
      if (char === '(') {
        tokens.push({ type: 'LPAREN', value: '(', position: start })
        pos++
        continue
      }
      if (char === ')') {
        tokens.push({ type: 'RPAREN', value: ')', position: start })
        pos++
        continue
      }

      // Comma
      if (char === ',') {
        tokens.push({ type: 'COMMA', value: ',', position: start })
        pos++
        continue
      }

      // Dot
      if (char === '.' && !/\d/.test(input[pos + 1] || '')) {
        tokens.push({ type: 'DOT', value: '.', position: start })
        pos++
        continue
      }

      // Strings (single or double quoted)
      if (char === "'" || char === '"') {
        const quote = char
        pos++
        let value = ''
        let closed = false
        while (pos < input.length) {
          if (input[pos] === quote) {
            if (input[pos + 1] === quote) {
              // Escaped quote
              value += quote
              pos += 2
            } else {
              pos++
              closed = true
              break
            }
          } else {
            value += input[pos]
            pos++
          }
        }
        if (!closed) {
          throw new ParseError(`Unclosed string literal`, start)
        }
        tokens.push({ type: 'STRING', value, position: start })
        continue
      }

      // Backtick quoted identifiers
      if (char === '`') {
        pos++
        let value = ''
        while (pos < input.length && input[pos] !== '`') {
          value += input[pos]
          pos++
        }
        pos++ // Skip closing backtick
        tokens.push({ type: 'IDENTIFIER', value, position: start })
        continue
      }

      // Numbers (including negative and scientific)
      if (/\d/.test(char!) || (char === '-' && /\d/.test(input[pos + 1] || '')) || (char === '.' && /\d/.test(input[pos + 1] || ''))) {
        let numStr = ''
        if (char === '-') {
          numStr = '-'
          pos++
        }
        while (pos < input.length && /[\d.eE+-]/.test(input[pos]!)) {
          numStr += input[pos]
          pos++
        }
        tokens.push({ type: 'NUMBER', value: numStr, position: start })
        continue
      }

      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(char!)) {
        let ident = ''
        while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos]!)) {
          ident += input[pos]
          pos++
        }

        // Handle qualified names (schema.table.column)
        while (pos < input.length && input[pos] === '.') {
          ident += '.'
          pos++
          while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos]!)) {
            ident += input[pos]
            pos++
          }
        }

        const upper = ident.toUpperCase()
        if (KEYWORDS.has(upper.split('.')[0]!)) {
          tokens.push({ type: 'KEYWORD', value: upper, position: start })
        } else {
          tokens.push({ type: 'IDENTIFIER', value: ident, position: start })
        }
        continue
      }

      // Asterisk (SELECT *)
      if (char === '*') {
        tokens.push({ type: 'OPERATOR', value: '*', position: start })
        pos++
        continue
      }

      // Unknown character - skip
      pos++
    }

    tokens.push({ type: 'EOF', value: '', position: input.length })
    return tokens
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
}

// =============================================================================
// Exports
// =============================================================================

// Types already exported at definition - removed duplicate exports
