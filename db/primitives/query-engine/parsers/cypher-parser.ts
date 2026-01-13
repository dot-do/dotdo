/**
 * Cypher Query Parser
 *
 * Parses Cypher graph query language into unified AST format.
 * Supports MATCH patterns with nodes and relationships, WHERE clauses,
 * RETURN projections, ORDER BY, SKIP, and LIMIT.
 *
 * @see dotdo-7boq8
 */

import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  ProjectionNode,
  SortNode,
  TraversalNode,
  TraversalDirection,
  SortDirection,
  ColumnSpec,
  SortColumn,
  ComparisonOp,
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

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed node (vertex) from MATCH pattern
 */
export interface ParsedNode {
  variable?: string
  labels?: string[]
  properties?: Record<string, unknown>
}

/**
 * Parsed relationship from MATCH pattern
 */
export interface ParsedRelationship {
  variable?: string
  edgeTypes?: string[]
  direction: TraversalDirection
  minHops: number
  maxHops: number
  targetNode?: ParsedNode
}

/**
 * Result of parsing a Cypher query
 */
export interface ParsedCypher {
  startNode?: ParsedNode
  traversals?: ParsedRelationship[]
  where?: QueryNode
  return?: ProjectionNode
  sort?: SortNode
  skip?: number
  limit?: number
  distinct?: boolean

  /** Convert to unified AST TraversalNode */
  toTraversalNode(): TraversalNode | undefined

  /** Convert vertex filter to QueryNode */
  toVertexFilter(): QueryNode | undefined
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Cypher keywords recognized by the parser
 */
export const CYPHER_KEYWORDS = new Set([
  'MATCH', 'WHERE', 'RETURN', 'ORDER', 'BY', 'SKIP', 'LIMIT',
  'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE',
  'AS', 'ASC', 'DESC', 'DISTINCT',
  'STARTS', 'ENDS', 'WITH', 'CONTAINS',
  'CREATE', 'DELETE', 'SET', 'REMOVE', 'MERGE', 'OPTIONAL',
  'UNION', 'UNWIND', 'CALL', 'YIELD',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COLLECT',
])

const COMPARISON_OPS = new Set(['=', '!=', '<>', '>', '>=', '<', '<='])

// =============================================================================
// CypherParser Class
// =============================================================================

export class CypherParser {
  private tokens: Token[] = []
  private pos = 0
  private input = ''

  /**
   * Parse a Cypher query string
   */
  parse(cypher: string): ParsedCypher {
    this.input = cypher
    this.tokens = this.tokenize(cypher)
    this.pos = 0

    const result: ParsedCypher = {
      toTraversalNode: () => this.createTraversalNode(result),
      toVertexFilter: () => this.createVertexFilter(result),
    }

    // Parse MATCH clause
    if (!this.matchKeyword('MATCH')) {
      throw new ParseError('Expected MATCH', this.current().position)
    }

    // Parse the pattern
    const { startNode, traversals } = this.parsePattern()
    result.startNode = startNode
    result.traversals = traversals

    // Parse WHERE clause (optional)
    if (this.matchKeyword('WHERE')) {
      result.where = this.parseOr()
    }

    // Parse RETURN clause
    if (this.matchKeyword('RETURN')) {
      // Check for DISTINCT
      if (this.matchKeyword('DISTINCT')) {
        result.distinct = true
      }

      result.return = this.parseReturnList()
    }

    // Parse ORDER BY clause (optional)
    if (this.matchKeyword('ORDER')) {
      this.expectKeyword('BY')
      result.sort = this.parseOrderBy()
    }

    // Parse SKIP (optional)
    if (this.matchKeyword('SKIP')) {
      result.skip = this.parseNumber()
    }

    // Parse LIMIT (optional)
    if (this.matchKeyword('LIMIT')) {
      result.limit = this.parseNumber()
    }

    return result
  }

  // ===========================================================================
  // Lexer
  // ===========================================================================

  private tokenize(input: string): Token[] {
    // Use a custom tokenizer for Cypher that handles : and | as operators
    const tokens: Token[] = []
    let pos = 0
    let line = 1
    let column = 1

    const isWhitespace = (ch: string) => /\s/.test(ch)
    const isDigit = (ch: string | undefined) => ch !== undefined && /\d/.test(ch)
    const isIdentifierStart = (ch: string) => /[a-zA-Z_]/.test(ch)
    const isIdentifierChar = (ch: string) => /[a-zA-Z0-9_]/.test(ch)

    const createToken = (type: TokenType, value: string, position: number): Token => ({
      type,
      value,
      position,
    })

    while (pos < input.length) {
      const ch = input[pos]!
      const start = pos

      // Skip whitespace
      if (isWhitespace(ch)) {
        if (ch === '\n') {
          line++
          column = 1
        } else {
          column++
        }
        pos++
        continue
      }

      // Skip comments
      if (ch === '/' && input[pos + 1] === '/') {
        while (pos < input.length && input[pos] !== '\n') pos++
        continue
      }
      if (ch === '/' && input[pos + 1] === '*') {
        pos += 2
        while (pos < input.length - 1 && !(input[pos] === '*' && input[pos + 1] === '/')) pos++
        pos += 2
        continue
      }

      // String literals
      if (ch === "'" || ch === '"') {
        const quote = ch
        pos++
        let value = ''
        while (pos < input.length && input[pos] !== quote) {
          if (input[pos] === '\\' && pos + 1 < input.length) {
            const next = input[pos + 1]!
            switch (next) {
              case 'n': value += '\n'; break
              case 't': value += '\t'; break
              case 'r': value += '\r'; break
              case '\\': value += '\\'; break
              case "'": value += "'"; break
              case '"': value += '"'; break
              default: value += next
            }
            pos += 2
          } else {
            value += input[pos]
            pos++
          }
        }
        pos++ // consume closing quote
        tokens.push(createToken(TokenType.STRING, value, start))
        continue
      }

      // Numbers - but be careful about .. range operator
      if (isDigit(ch) || (ch === '.' && isDigit(input[pos + 1]) && input[pos + 1] !== '.')) {
        let numStr = ''
        let hasDecimal = false
        while (pos < input.length) {
          const c = input[pos]!
          if (isDigit(c)) {
            numStr += c
            pos++
          } else if (c === '.' && !hasDecimal) {
            // Check for range operator ..
            if (input[pos + 1] === '.') {
              // This is the start of .., stop parsing number
              break
            }
            // Regular decimal point
            hasDecimal = true
            numStr += c
            pos++
          } else {
            break
          }
        }
        tokens.push(createToken(TokenType.NUMBER, numStr, start))
        continue
      }

      // Identifiers and keywords
      if (isIdentifierStart(ch)) {
        let value = ''
        while (pos < input.length && isIdentifierChar(input[pos]!)) {
          value += input[pos]
          pos++
        }
        const upper = value.toUpperCase()
        if (CYPHER_KEYWORDS.has(upper)) {
          tokens.push(createToken(TokenType.KEYWORD, upper, start))
        } else {
          tokens.push(createToken(TokenType.IDENTIFIER, value, start))
        }
        continue
      }

      // Multi-character operators
      if (ch === '<' && input[pos + 1] === '>') {
        tokens.push(createToken(TokenType.OPERATOR, '<>', start))
        pos += 2
        continue
      }
      if (ch === '!' && input[pos + 1] === '=') {
        tokens.push(createToken(TokenType.OPERATOR, '!=', start))
        pos += 2
        continue
      }
      if (ch === '>' && input[pos + 1] === '=') {
        tokens.push(createToken(TokenType.OPERATOR, '>=', start))
        pos += 2
        continue
      }
      if (ch === '<' && input[pos + 1] === '=') {
        tokens.push(createToken(TokenType.OPERATOR, '<=', start))
        pos += 2
        continue
      }
      if (ch === '.' && input[pos + 1] === '.') {
        // Range operator ..
        tokens.push(createToken(TokenType.OPERATOR, '..', start))
        pos += 2
        continue
      }

      // Single-character tokens
      switch (ch) {
        case '(':
          tokens.push(createToken(TokenType.LPAREN, '(', start))
          pos++
          continue
        case ')':
          tokens.push(createToken(TokenType.RPAREN, ')', start))
          pos++
          continue
        case '[':
          tokens.push(createToken(TokenType.LBRACKET, '[', start))
          pos++
          continue
        case ']':
          tokens.push(createToken(TokenType.RBRACKET, ']', start))
          pos++
          continue
        case '{':
          tokens.push(createToken(TokenType.OPERATOR, '{', start))
          pos++
          continue
        case '}':
          tokens.push(createToken(TokenType.OPERATOR, '}', start))
          pos++
          continue
        case ',':
          tokens.push(createToken(TokenType.COMMA, ',', start))
          pos++
          continue
        case '.':
          tokens.push(createToken(TokenType.DOT, '.', start))
          pos++
          continue
        case ':':
          tokens.push(createToken(TokenType.OPERATOR, ':', start))
          pos++
          continue
        case '|':
          tokens.push(createToken(TokenType.OPERATOR, '|', start))
          pos++
          continue
        case '*':
          tokens.push(createToken(TokenType.OPERATOR, '*', start))
          pos++
          continue
        case '-':
          tokens.push(createToken(TokenType.OPERATOR, '-', start))
          pos++
          continue
        case '>':
          tokens.push(createToken(TokenType.OPERATOR, '>', start))
          pos++
          continue
        case '<':
          tokens.push(createToken(TokenType.OPERATOR, '<', start))
          pos++
          continue
        case '=':
          tokens.push(createToken(TokenType.OPERATOR, '=', start))
          pos++
          continue
        default:
          pos++ // skip unknown characters
      }
    }

    tokens.push(createToken(TokenType.EOF, '', input.length))
    return tokens
  }

  // ===========================================================================
  // Parser Helpers
  // ===========================================================================

  private current(): Token {
    return this.tokens[this.pos] || { type: TokenType.EOF, value: '', position: this.input.length }
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] || { type: TokenType.EOF, value: '', position: this.input.length }
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
    if (this.current().type === TokenType.KEYWORD && this.current().value === keyword) {
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
    if (token.type === TokenType.IDENTIFIER || token.type === TokenType.STRING || token.type === TokenType.KEYWORD) {
      this.advance()
      return token.value
    }
    throw new ParseError('Expected identifier', token.position)
  }

  private parseNumber(): number {
    const token = this.current()
    if (token.type === TokenType.NUMBER) {
      this.advance()
      return parseNumericLiteral(token.value)
    }
    throw new ParseError('Expected number', token.position)
  }

  // ===========================================================================
  // Pattern Parsing
  // ===========================================================================

  private parsePattern(): { startNode: ParsedNode; traversals: ParsedRelationship[] } {
    // Parse the start node
    const startNode = this.parseNode()
    const traversals: ParsedRelationship[] = []

    // Parse subsequent relationships and nodes
    while (this.isRelationshipStart()) {
      const rel = this.parseRelationship()
      traversals.push(rel)
    }

    return { startNode, traversals }
  }

  private parseNode(): ParsedNode {
    if (this.current().type !== TokenType.LPAREN) {
      throw new ParseError('Expected (', this.current().position)
    }
    this.advance() // consume (

    const node: ParsedNode = {}

    // Parse variable name (optional)
    if (this.current().type === TokenType.IDENTIFIER) {
      node.variable = this.parseIdentifier()
    }

    // Parse labels (optional, :Label1:Label2)
    while (this.current().type === TokenType.OPERATOR && this.current().value === ':') {
      this.advance() // consume :
      if (!node.labels) {
        node.labels = []
      }
      node.labels.push(this.parseIdentifier())
    }

    // Parse properties (optional, {key: value, ...})
    if (this.current().value === '{') {
      node.properties = this.parseProperties()
    }

    if (this.current().type !== TokenType.RPAREN) {
      throw new ParseError('Expected )', this.current().position)
    }
    this.advance() // consume )

    return node
  }

  private isRelationshipStart(): boolean {
    const cur = this.current()
    return (cur.type === TokenType.OPERATOR && (cur.value === '-' || cur.value === '<'))
  }

  private parseRelationship(): ParsedRelationship {
    let direction: TraversalDirection = 'OUT'

    // Check for incoming arrow <-
    if (this.current().type === TokenType.OPERATOR && this.current().value === '<') {
      this.advance() // consume <
      direction = 'IN'
    }

    // Expect -
    if (this.current().type !== TokenType.OPERATOR || this.current().value !== '-') {
      throw new ParseError('Expected -', this.current().position)
    }
    this.advance() // consume -

    const rel: ParsedRelationship = {
      direction,
      minHops: 1,
      maxHops: 1,
    }

    // Check for relationship details [...]
    if (this.current().type === TokenType.LBRACKET) {
      this.advance() // consume [

      // Parse variable (optional)
      if (this.current().type === TokenType.IDENTIFIER) {
        rel.variable = this.parseIdentifier()
      }

      // Parse edge types (:TYPE1|:TYPE2)
      if (this.current().type === TokenType.OPERATOR && this.current().value === ':') {
        rel.edgeTypes = []
        while ((this.current().type === TokenType.OPERATOR && this.current().value === ':') ||
               (this.current().type === TokenType.OPERATOR && this.current().value === '|')) {
          if (this.current().value === '|') {
            this.advance() // consume |
          }
          if (this.current().value === ':') {
            this.advance() // consume :
          }
          rel.edgeTypes.push(this.parseIdentifier())
        }
      }

      // Parse variable length (*min..max)
      if (this.current().type === TokenType.OPERATOR && this.current().value === '*') {
        this.advance() // consume *
        this.parseVariableLength(rel)
      }

      if (this.current().type !== TokenType.RBRACKET) {
        throw new ParseError('Expected ]', this.current().position)
      }
      this.advance() // consume ]
    }

    // Expect -
    if (this.current().type !== TokenType.OPERATOR || this.current().value !== '-') {
      throw new ParseError('Expected - after relationship', this.current().position)
    }
    this.advance() // consume -

    // Check for outgoing arrow ->
    if (direction === 'OUT' || direction === 'BOTH') {
      if (this.current().type === TokenType.OPERATOR && this.current().value === '>') {
        this.advance() // consume >
        direction = 'OUT'
      } else if (direction === 'OUT') {
        // If we started with - and don't have > at the end, it's undirected
        direction = 'BOTH'
      }
    }

    rel.direction = direction

    // Parse target node
    if (this.current().type === TokenType.LPAREN) {
      rel.targetNode = this.parseNode()
    }

    return rel
  }

  private parseVariableLength(rel: ParsedRelationship): void {
    // Handle *N, *min..max, *min.., *..max, *

    const token = this.current()

    // Check for just * (unbounded) - next token is ] or something else
    if (token.type !== TokenType.NUMBER && token.value !== '..' && token.type !== TokenType.DOT) {
      rel.minHops = 1
      rel.maxHops = Infinity
      return
    }

    // Check for ..max (no min) - using .. operator token
    if (token.value === '..') {
      this.advance() // consume ..
      rel.minHops = 1
      if (this.current().type === TokenType.NUMBER) {
        rel.maxHops = this.parseNumber()
      } else {
        rel.maxHops = Infinity
      }
      return
    }

    // Check for ..max (no min) - using two DOT tokens
    if (token.type === TokenType.DOT && this.peek(1).type === TokenType.DOT) {
      this.advance() // consume first .
      this.advance() // consume second .
      rel.minHops = 1
      if (this.current().type === TokenType.NUMBER) {
        rel.maxHops = this.parseNumber()
      } else {
        rel.maxHops = Infinity
      }
      return
    }

    // Parse first number
    const firstNum = this.parseNumber()

    // Check for range using .. operator
    if (this.current().value === '..') {
      this.advance() // consume ..
      rel.minHops = firstNum

      // Check for max
      if (this.current().type === TokenType.NUMBER) {
        rel.maxHops = this.parseNumber()
      } else {
        rel.maxHops = Infinity
      }
    } else if (this.current().type === TokenType.DOT && this.peek(1).type === TokenType.DOT) {
      // Two separate DOT tokens
      this.advance() // consume first .
      this.advance() // consume second .
      rel.minHops = firstNum

      // Check for max
      if (this.current().type === TokenType.NUMBER) {
        rel.maxHops = this.parseNumber()
      } else {
        rel.maxHops = Infinity
      }
    } else {
      // Fixed hop count
      rel.minHops = firstNum
      rel.maxHops = firstNum
    }
  }

  private parseProperties(): Record<string, unknown> {
    const props: Record<string, unknown> = {}

    this.advance() // consume {

    if (this.current().value !== '}') {
      do {
        const key = this.parseIdentifier()
        if (this.current().type !== TokenType.OPERATOR || this.current().value !== ':') {
          throw new ParseError('Expected : in property', this.current().position)
        }
        this.advance() // consume :
        const value = this.parseValue()
        props[key] = value
      } while (this.match(','))
    }

    if (this.current().type !== TokenType.OPERATOR || this.current().value !== '}') {
      throw new ParseError('Expected }', this.current().position)
    }
    this.advance() // consume }

    return props
  }

  // ===========================================================================
  // WHERE Clause Parsing (Recursive Descent)
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
    // Handle parenthesized expression
    if (this.current().type === TokenType.LPAREN) {
      this.advance() // consume (
      const expr = this.parseOr()
      if (this.current().type !== TokenType.RPAREN) {
        throw new ParseError('Unbalanced parentheses', this.current().position)
      }
      this.advance() // consume )
      return expr
    }

    return this.parseComparison()
  }

  private parseComparison(): QueryNode {
    // Parse left side (column/property reference)
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

    // Handle STARTS WITH
    if (this.matchKeyword('STARTS')) {
      this.expectKeyword('WITH')
      const value = this.parseValue()
      return {
        type: 'predicate',
        column,
        op: 'STARTS_WITH',
        value,
      }
    }

    // Handle ENDS WITH
    if (this.matchKeyword('ENDS')) {
      this.expectKeyword('WITH')
      const value = this.parseValue()
      return {
        type: 'predicate',
        column,
        op: 'LIKE', // We'll use LIKE with pattern for ENDS WITH
        value: `%${value}`,
      }
    }

    // Handle CONTAINS
    if (this.matchKeyword('CONTAINS')) {
      const value = this.parseValue()
      return {
        type: 'predicate',
        column,
        op: 'CONTAINS',
        value,
      }
    }

    // Handle IN
    if (this.matchKeyword('IN')) {
      const values = this.parseArrayLiteral()
      return {
        type: 'predicate',
        column,
        op: 'IN',
        value: values,
      }
    }

    // Handle comparison operators
    const token = this.current()
    if (token.type === TokenType.OPERATOR && COMPARISON_OPS.has(token.value)) {
      this.advance()
      const op = token.value === '<>' ? '!=' : token.value
      const value = this.parseValue()
      return {
        type: 'predicate',
        column,
        op: op as ComparisonOp,
        value,
      }
    }

    throw new ParseError(`Expected operator after ${column}`, token.position)
  }

  private parseColumnRef(): string {
    let column = ''

    // Parse identifier
    if (this.current().type === TokenType.IDENTIFIER || this.current().type === TokenType.KEYWORD) {
      column = this.advance().value
    } else {
      throw new ParseError('Expected column name', this.current().position)
    }

    // Handle qualified name with dots (e.g., p.name)
    while (this.current().type === TokenType.DOT) {
      this.advance()
      column += '.'
      if (this.current().type === TokenType.IDENTIFIER || this.current().type === TokenType.STRING || this.current().type === TokenType.KEYWORD) {
        column += this.advance().value
      }
    }

    return column
  }

  private parseValue(): unknown {
    const token = this.current()

    // Handle boolean literals
    if (token.type === TokenType.KEYWORD && token.value === 'TRUE') {
      this.advance()
      return true
    }
    if (token.type === TokenType.KEYWORD && token.value === 'FALSE') {
      this.advance()
      return false
    }
    if (token.type === TokenType.KEYWORD && token.value === 'NULL') {
      this.advance()
      return null
    }

    // Handle numbers
    if (token.type === TokenType.NUMBER) {
      this.advance()
      return parseNumericLiteral(token.value)
    }

    // Handle strings
    if (token.type === TokenType.STRING) {
      this.advance()
      return token.value
    }

    // Handle arrays
    if (token.type === TokenType.LBRACKET) {
      return this.parseArrayLiteral()
    }

    throw new ParseError(`Unexpected token: ${token.value}`, token.position)
  }

  private parseArrayLiteral(): unknown[] {
    if (this.current().type !== TokenType.LBRACKET) {
      throw new ParseError('Expected [', this.current().position)
    }
    this.advance() // consume [

    const values: unknown[] = []

    if (this.current().type !== TokenType.RBRACKET) {
      values.push(this.parseValue())

      while (this.match(',')) {
        values.push(this.parseValue())
      }
    }

    if (this.current().type !== TokenType.RBRACKET) {
      throw new ParseError('Expected ]', this.current().position)
    }
    this.advance() // consume ]

    return values
  }

  // ===========================================================================
  // RETURN Clause Parsing
  // ===========================================================================

  private parseReturnList(): ProjectionNode {
    const columns: ColumnSpec[] = []

    do {
      const col = this.parseReturnColumn()
      columns.push(col)
    } while (this.match(','))

    return { type: 'projection', columns }
  }

  private parseReturnColumn(): ColumnSpec {
    const token = this.current()

    // Check for aggregate functions
    if (token.type === TokenType.KEYWORD && ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COLLECT'].includes(token.value)) {
      const fnName = token.value
      this.advance()
      this.match('(')

      let columnArg = '*'
      if (this.current().type === TokenType.OPERATOR && this.current().value === '*') {
        this.advance()
        columnArg = '*'
      } else if (this.current().type !== TokenType.RPAREN) {
        columnArg = this.parseColumnRef()
      }

      this.match(')')

      let alias: string | undefined
      if (this.matchKeyword('AS')) {
        alias = this.parseIdentifier()
      }

      return {
        source: `${fnName}(${columnArg})`,
        alias,
        include: true,
      }
    }

    // Check for number literal (e.g., RETURN 1)
    if (token.type === TokenType.NUMBER) {
      const value = this.advance().value
      let alias: string | undefined
      if (this.matchKeyword('AS')) {
        alias = this.parseIdentifier()
      }
      return { source: value, alias, include: true }
    }

    // Regular column
    const source = this.parseColumnRef()

    let alias: string | undefined
    if (this.matchKeyword('AS')) {
      alias = this.parseIdentifier()
    }

    return { source, alias, include: true }
  }

  // ===========================================================================
  // ORDER BY Parsing
  // ===========================================================================

  private parseOrderBy(): SortNode {
    const columns: SortColumn[] = []

    do {
      const column = this.parseColumnRef()
      let direction: SortDirection = 'ASC'

      if (this.matchKeyword('DESC')) {
        direction = 'DESC'
      } else {
        this.matchKeyword('ASC')
      }

      columns.push({ column, direction })
    } while (this.match(','))

    return { type: 'sort', columns }
  }

  // ===========================================================================
  // AST Conversion Helpers
  // ===========================================================================

  private createTraversalNode(parsed: ParsedCypher): TraversalNode | undefined {
    if (!parsed.traversals || parsed.traversals.length === 0) {
      return undefined
    }

    // For now, just convert the first traversal
    const rel = parsed.traversals[0]!

    const traversal: TraversalNode = {
      type: 'traversal',
      direction: rel.direction,
      minHops: rel.minHops,
      maxHops: rel.maxHops,
    }

    if (rel.edgeTypes && rel.edgeTypes.length > 0) {
      traversal.edgeTypes = rel.edgeTypes
    }

    // Add filter for target node if it has labels
    if (rel.targetNode?.labels) {
      traversal.filter = {
        type: 'predicate',
        column: '$type',
        op: 'IN',
        value: rel.targetNode.labels,
      }
    }

    return traversal
  }

  private createVertexFilter(parsed: ParsedCypher): QueryNode | undefined {
    if (!parsed.startNode) {
      return undefined
    }

    const predicates: QueryNode[] = []

    // Add label filter
    if (parsed.startNode.labels && parsed.startNode.labels.length > 0) {
      predicates.push({
        type: 'predicate',
        column: '$type',
        op: 'IN',
        value: parsed.startNode.labels,
      })
    }

    // Add property filters
    if (parsed.startNode.properties) {
      for (const [key, value] of Object.entries(parsed.startNode.properties)) {
        predicates.push({
          type: 'predicate',
          column: key,
          op: '=',
          value,
        })
      }
    }

    if (predicates.length === 0) {
      return undefined
    }

    if (predicates.length === 1) {
      return predicates[0]
    }

    return {
      type: 'logical',
      op: 'AND',
      children: predicates,
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

// Types already exported at definition
