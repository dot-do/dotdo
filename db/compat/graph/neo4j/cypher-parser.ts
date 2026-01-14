/**
 * Cypher Query Parser
 *
 * Parses Neo4j Cypher queries into a unified AST format.
 * Supports CREATE, MATCH, MERGE, DELETE, SET, REMOVE, RETURN, etc.
 *
 * @see https://neo4j.com/docs/cypher-manual/current/
 */

import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  SortColumn,
  TraversalNode,
  ComparisonOp,
  SortDirection,
  TraversalDirection,
} from '../../../primitives/query-engine/ast'

// =============================================================================
// Token Types
// =============================================================================

type TokenType =
  | 'KEYWORD'
  | 'IDENTIFIER'
  | 'OPERATOR'
  | 'NUMBER'
  | 'STRING'
  | 'PARAMETER'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'LBRACE'
  | 'RBRACE'
  | 'COLON'
  | 'COMMA'
  | 'DOT'
  | 'PIPE'
  | 'ARROW_LEFT'
  | 'ARROW_RIGHT'
  | 'DASH'
  | 'ASTERISK'
  | 'DOT_DOT'
  | 'EOF'

interface Token {
  type: TokenType
  value: string
  position: number
}

// =============================================================================
// AST Node Types
// =============================================================================

/**
 * Cypher node pattern
 */
export interface CypherNodePattern {
  variable?: string
  labels: string[]
  properties: Record<string, unknown>
}

/**
 * Cypher relationship pattern
 */
export interface CypherRelationshipPattern {
  variable?: string
  types: string[]
  direction: TraversalDirection
  minHops: number
  maxHops: number
  properties: Record<string, unknown>
}

/**
 * Cypher path pattern
 */
export interface CypherPathPattern {
  variable?: string
  elements: Array<CypherNodePattern | CypherRelationshipPattern>
}

/**
 * Cypher SET clause
 */
export interface CypherSetClause {
  variable: string
  property?: string
  value: unknown
  properties?: Record<string, unknown>
  operator: '=' | '+='
}

/**
 * Cypher REMOVE clause
 */
export interface CypherRemoveClause {
  variable: string
  property?: string
  label?: string
}

/**
 * Cypher RETURN item
 */
export interface CypherReturnItem {
  expression: string
  alias?: string
  aggregate?: string
  distinct?: boolean
}

/**
 * Parsed Cypher query
 */
export interface ParsedCypherQuery {
  type: 'CREATE' | 'MATCH' | 'MERGE' | 'DELETE' | 'WITH' | 'CALL'
  patterns: CypherPathPattern[]
  where?: QueryNode
  set?: CypherSetClause[]
  remove?: CypherRemoveClause[]
  delete?: { variables: string[]; detach: boolean }
  return?: {
    items: CypherReturnItem[]
    distinct: boolean
    orderBy?: SortColumn[]
    skip?: number
    limit?: number
  }
  create?: CypherPathPattern[]
  merge?: CypherPathPattern[]
  union?: { all: boolean; query: ParsedCypherQuery }
  optional?: boolean
}

// =============================================================================
// Parse Error
// =============================================================================

export class CypherParseError extends Error {
  constructor(
    message: string,
    public position: number
  ) {
    super(`${message} at position ${position}`)
    this.name = 'CypherParseError'
  }
}

// =============================================================================
// Constants
// =============================================================================

const KEYWORDS = new Set([
  'CREATE', 'MATCH', 'MERGE', 'DELETE', 'DETACH', 'SET', 'REMOVE', 'RETURN',
  'WITH', 'UNWIND', 'OPTIONAL', 'WHERE', 'AND', 'OR', 'NOT', 'XOR',
  'IN', 'IS', 'NULL', 'TRUE', 'FALSE', 'AS', 'DISTINCT',
  'ORDER', 'BY', 'ASC', 'DESC', 'ASCENDING', 'DESCENDING',
  'SKIP', 'LIMIT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'UNION', 'ALL', 'CALL', 'YIELD', 'FOREACH', 'ON',
  'CONSTRAINT', 'INDEX', 'DROP', 'START', 'LOAD', 'CSV', 'FROM',
  'USING', 'PERIODIC', 'COMMIT', 'CONTAINS', 'STARTS', 'ENDS',
])

const COMPARISON_OPS = new Set(['=', '!=', '<>', '>', '>=', '<', '<=', '=~'])
const CYPHER_OPS = new Set(['=', '!=', '<>', '>', '>=', '<', '<=', '=~', '+', '-', '*', '/', '%', '^'])

// =============================================================================
// Cypher Parser Class
// =============================================================================

export class CypherParser {
  private tokens: Token[] = []
  private pos = 0
  private input = ''
  private parameters: Record<string, unknown> = {}

  /**
   * Parse a Cypher query string
   */
  parse(cypher: string, parameters: Record<string, unknown> = {}): ParsedCypherQuery[] {
    this.input = cypher
    this.parameters = parameters
    this.tokens = this.tokenize(cypher)
    this.pos = 0

    const queries: ParsedCypherQuery[] = []

    while (this.current().type !== 'EOF') {
      const query = this.parseClause()
      if (query) {
        queries.push(query)
      }

      // Handle UNION
      if (this.matchKeyword('UNION')) {
        const all = this.matchKeyword('ALL')
        const nextQuery = this.parseClause()
        if (nextQuery && queries.length > 0) {
          queries[queries.length - 1]!.union = { all, query: nextQuery }
        }
      }
    }

    return queries
  }

  /**
   * Parse a Cypher WHERE clause into unified AST
   */
  parseWhereToAST(cypher: string, parameters: Record<string, unknown> = {}): QueryNode | undefined {
    this.input = cypher
    this.parameters = parameters
    this.tokens = this.tokenize(cypher)
    this.pos = 0

    if (this.tokens.length === 0 || this.tokens[0]!.type === 'EOF') {
      return undefined
    }

    return this.parseOr()
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

      // Skip single-line comments
      if (char === '/' && input[pos + 1] === '/') {
        while (pos < input.length && input[pos]! !== '\n') pos++
        continue
      }

      // Skip multi-line comments
      if (char === '/' && input[pos + 1] === '*') {
        pos += 2
        while (pos < input.length - 1 && !(input[pos]! === '*' && input[pos + 1] === '/')) pos++
        pos += 2
        continue
      }

      // Arrows: <-, ->, --
      if (char === '<' && input[pos + 1] === '-') {
        tokens.push({ type: 'ARROW_LEFT', value: '<-', position: start })
        pos += 2
        continue
      }
      if (char === '-' && input[pos + 1] === '>') {
        tokens.push({ type: 'ARROW_RIGHT', value: '->', position: start })
        pos += 2
        continue
      }

      // Dot dot (for range: *1..3)
      if (char === '.' && input[pos + 1] === '.') {
        tokens.push({ type: 'DOT_DOT', value: '..', position: start })
        pos += 2
        continue
      }

      // Comparison operators (multi-char)
      if ((char === '!' || char === '<' || char === '>') && input[pos + 1] === '=') {
        tokens.push({ type: 'OPERATOR', value: char + '=', position: start })
        pos += 2
        continue
      }
      if (char === '<' && input[pos + 1] === '>') {
        tokens.push({ type: 'OPERATOR', value: '<>', position: start })
        pos += 2
        continue
      }
      if (char === '=' && input[pos + 1] === '~') {
        tokens.push({ type: 'OPERATOR', value: '=~', position: start })
        pos += 2
        continue
      }
      if (char === '+' && input[pos + 1] === '=') {
        tokens.push({ type: 'OPERATOR', value: '+=', position: start })
        pos += 2
        continue
      }

      // Single-char operators
      if (char && CYPHER_OPS.has(char)) {
        tokens.push({ type: 'OPERATOR', value: char, position: start })
        pos++
        continue
      }

      // Brackets
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
      if (char === '[') {
        tokens.push({ type: 'LBRACKET', value: '[', position: start })
        pos++
        continue
      }
      if (char === ']') {
        tokens.push({ type: 'RBRACKET', value: ']', position: start })
        pos++
        continue
      }
      if (char === '{') {
        tokens.push({ type: 'LBRACE', value: '{', position: start })
        pos++
        continue
      }
      if (char === '}') {
        tokens.push({ type: 'RBRACE', value: '}', position: start })
        pos++
        continue
      }

      // Other punctuation
      if (char === ':') {
        tokens.push({ type: 'COLON', value: ':', position: start })
        pos++
        continue
      }
      if (char === ',') {
        tokens.push({ type: 'COMMA', value: ',', position: start })
        pos++
        continue
      }
      if (char === '.') {
        tokens.push({ type: 'DOT', value: '.', position: start })
        pos++
        continue
      }
      if (char === '|') {
        tokens.push({ type: 'PIPE', value: '|', position: start })
        pos++
        continue
      }
      if (char === '-') {
        tokens.push({ type: 'DASH', value: '-', position: start })
        pos++
        continue
      }
      if (char === '*') {
        tokens.push({ type: 'ASTERISK', value: '*', position: start })
        pos++
        continue
      }

      // Parameters: $name
      if (char === '$') {
        pos++
        let name = ''
        while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos]!)) {
          name += input[pos]!
          pos++
        }
        tokens.push({ type: 'PARAMETER', value: name, position: start })
        continue
      }

      // Strings
      if (char === "'" || char === '"') {
        const quote = char
        pos++
        let value = ''
        while (pos < input.length) {
          if (input[pos] === quote) {
            if (input[pos + 1] === quote) {
              value += quote
              pos += 2
            } else {
              pos++
              break
            }
          } else if (input[pos] === '\\') {
            pos++
            if (pos < input.length) {
              const escape = input[pos]
              switch (escape) {
                case 'n': value += '\n'; break
                case 't': value += '\t'; break
                case 'r': value += '\r'; break
                case '\\': value += '\\'; break
                default: value += escape
              }
              pos++
            }
          } else {
            value += input[pos]
            pos++
          }
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
        pos++
        tokens.push({ type: 'IDENTIFIER', value, position: start })
        continue
      }

      // Numbers
      if (char && (/\d/.test(char) || (char === '-' && /\d/.test(input[pos + 1] ?? '')))) {
        let numStr = ''
        if (char === '-') {
          numStr = '-'
          pos++
        }
        while (pos < input.length && /[\d.eE+-]/.test(input[pos]!)) {
          numStr += input[pos]!
          pos++
        }
        tokens.push({ type: 'NUMBER', value: numStr, position: start })
        continue
      }

      // Identifiers and keywords
      if (char && /[a-zA-Z_]/.test(char)) {
        let ident = ''
        while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos]!)) {
          ident += input[pos]!
          pos++
        }

        const upper = ident.toUpperCase()
        if (KEYWORDS.has(upper)) {
          tokens.push({ type: 'KEYWORD', value: upper, position: start })
        } else {
          tokens.push({ type: 'IDENTIFIER', value: ident, position: start })
        }
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

  private peek(offset = 1): Token {
    return this.tokens[this.pos + offset] || { type: 'EOF', value: '', position: this.input.length }
  }

  private advance(): Token {
    const token = this.current()
    this.pos++
    return token
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.current()
    if (token.type === type && (value === undefined || token.value === value)) {
      this.advance()
      return true
    }
    return false
  }

  private matchKeyword(keyword: string): boolean {
    const token = this.current()
    if (token.type === 'KEYWORD' && token.value === keyword) {
      this.advance()
      return true
    }
    return false
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current()
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new CypherParseError(
        `Expected ${type}${value ? ` '${value}'` : ''}, got ${token.type} '${token.value}'`,
        token.position
      )
    }
    return this.advance()
  }

  private expectKeyword(keyword: string): Token {
    const token = this.current()
    if (token.type !== 'KEYWORD' || token.value !== keyword) {
      throw new CypherParseError(`Expected keyword '${keyword}'`, token.position)
    }
    return this.advance()
  }

  // ===========================================================================
  // Clause Parsing
  // ===========================================================================

  private parseClause(): ParsedCypherQuery | null {
    const token = this.current()

    if (token.type !== 'KEYWORD') {
      return null
    }

    switch (token.value) {
      case 'CREATE':
        return this.parseCreate()
      case 'MATCH':
        return this.parseMatch()
      case 'OPTIONAL':
        return this.parseOptionalMatch()
      case 'MERGE':
        return this.parseMerge()
      default:
        return null
    }
  }

  private parseCreate(): ParsedCypherQuery {
    this.expectKeyword('CREATE')

    const patterns = this.parsePatternList()

    const query: ParsedCypherQuery = {
      type: 'CREATE',
      patterns,
    }

    // Handle RETURN
    if (this.matchKeyword('RETURN')) {
      query.return = this.parseReturn()
    }

    return query
  }

  private parseMatch(): ParsedCypherQuery {
    this.expectKeyword('MATCH')

    const patterns = this.parsePatternList()

    const query: ParsedCypherQuery = {
      type: 'MATCH',
      patterns,
    }

    // Handle WHERE
    if (this.matchKeyword('WHERE')) {
      query.where = this.parseOr()
    }

    // Handle SET
    if (this.matchKeyword('SET')) {
      query.set = this.parseSetClauses()
    }

    // Handle REMOVE
    if (this.matchKeyword('REMOVE')) {
      query.remove = this.parseRemoveClauses()
    }

    // Handle DELETE / DETACH DELETE
    const detach = this.matchKeyword('DETACH')
    if (this.matchKeyword('DELETE')) {
      query.delete = {
        variables: this.parseIdentifierList(),
        detach,
      }
    }

    // Handle CREATE (MATCH ... CREATE)
    if (this.matchKeyword('CREATE')) {
      query.create = this.parsePatternList()
    }

    // Handle MERGE (MATCH ... MERGE)
    if (this.matchKeyword('MERGE')) {
      query.merge = this.parsePatternList()
    }

    // Handle RETURN
    if (this.matchKeyword('RETURN')) {
      query.return = this.parseReturn()
    }

    return query
  }

  private parseOptionalMatch(): ParsedCypherQuery {
    this.expectKeyword('OPTIONAL')
    const query = this.parseMatch()
    query.optional = true
    return query
  }

  private parseMerge(): ParsedCypherQuery {
    this.expectKeyword('MERGE')

    const patterns = this.parsePatternList()

    const query: ParsedCypherQuery = {
      type: 'MERGE',
      patterns,
    }

    // Handle ON CREATE SET / ON MATCH SET
    while (this.matchKeyword('ON')) {
      if (this.matchKeyword('CREATE')) {
        this.expectKeyword('SET')
        query.set = query.set || []
        query.set.push(...this.parseSetClauses())
      } else if (this.matchKeyword('MATCH')) {
        this.expectKeyword('SET')
        query.set = query.set || []
        query.set.push(...this.parseSetClauses())
      }
    }

    // Handle RETURN
    if (this.matchKeyword('RETURN')) {
      query.return = this.parseReturn()
    }

    return query
  }

  // ===========================================================================
  // Pattern Parsing
  // ===========================================================================

  private parsePatternList(): CypherPathPattern[] {
    const patterns: CypherPathPattern[] = []

    // Handle path assignment: p = (a)-[r]->(b)
    let pathVariable: string | undefined
    if (this.current().type === 'IDENTIFIER' && this.peek().value === '=') {
      pathVariable = this.advance().value
      this.advance() // consume =
    }

    patterns.push(this.parsePath(pathVariable))

    while (this.match('COMMA')) {
      patterns.push(this.parsePath())
    }

    return patterns
  }

  private parsePath(variable?: string): CypherPathPattern {
    const elements: Array<CypherNodePattern | CypherRelationshipPattern> = []

    // Parse first node
    elements.push(this.parseNodePattern())

    // Parse relationship-node pairs
    while (this.isRelationshipStart()) {
      elements.push(this.parseRelationshipPattern())
      elements.push(this.parseNodePattern())
    }

    return { variable, elements }
  }

  private isRelationshipStart(): boolean {
    const token = this.current()
    return token.type === 'ARROW_LEFT' || token.type === 'DASH' ||
           token.value === '<-' || token.value === '-'
  }

  private parseNodePattern(): CypherNodePattern {
    this.expect('LPAREN')

    let variable: string | undefined
    const labels: string[] = []
    let properties: Record<string, unknown> = {}

    // Parse variable
    if (this.current().type === 'IDENTIFIER') {
      variable = this.advance().value
    }

    // Parse labels
    while (this.match('COLON')) {
      if (this.current().type === 'IDENTIFIER' || this.current().type === 'KEYWORD') {
        labels.push(this.advance().value)
      }
    }

    // Parse properties
    if (this.current().type === 'LBRACE') {
      properties = this.parseProperties()
    }

    this.expect('RPAREN')

    return { variable, labels, properties }
  }

  private parseRelationshipPattern(): CypherRelationshipPattern {
    let direction: TraversalDirection = 'OUT'
    let variable: string | undefined
    const types: string[] = []
    let minHops = 1
    let maxHops = 1
    let properties: Record<string, unknown> = {}

    // Parse direction start
    if (this.match('ARROW_LEFT')) {
      direction = 'IN'
    } else {
      this.expect('DASH')
    }

    // Parse relationship details if present
    if (this.match('LBRACKET')) {
      // Parse variable
      if (this.current().type === 'IDENTIFIER') {
        variable = this.advance().value
      }

      // Parse types
      while (this.match('COLON')) {
        if (this.current().type === 'IDENTIFIER' || this.current().type === 'KEYWORD') {
          types.push(this.advance().value)
        }

        // Handle multiple types: :TYPE1|TYPE2
        while (this.match('PIPE')) {
          if (this.current().type === 'IDENTIFIER' || this.current().type === 'KEYWORD') {
            types.push(this.advance().value)
          }
        }
      }

      // Parse variable length: *1..3
      if (this.match('ASTERISK')) {
        if (this.current().type === 'NUMBER') {
          minHops = parseInt(this.advance().value, 10)
          if (this.match('DOT_DOT')) {
            if (this.current().type === 'NUMBER') {
              maxHops = parseInt(this.advance().value, 10)
            } else {
              maxHops = Infinity
            }
          } else {
            maxHops = minHops
          }
        } else if (this.current().type === 'DOT_DOT') {
          this.advance()
          minHops = 1
          if (this.current().type === 'NUMBER') {
            maxHops = parseInt(this.advance().value, 10)
          } else {
            maxHops = Infinity
          }
        } else {
          // Just *, means any length
          minHops = 1
          maxHops = Infinity
        }
      }

      // Parse properties
      if (this.current().type === 'LBRACE') {
        properties = this.parseProperties()
      }

      this.expect('RBRACKET')
    }

    // Parse direction end
    if (direction === 'IN') {
      this.expect('DASH')
    } else if (this.match('ARROW_RIGHT')) {
      direction = 'OUT'
    } else if (this.match('DASH')) {
      direction = 'BOTH'
    }

    return { variable, types, direction, minHops, maxHops, properties }
  }

  private parseProperties(): Record<string, unknown> {
    const props: Record<string, unknown> = {}

    this.expect('LBRACE')

    if (this.current().type !== 'RBRACE') {
      do {
        const key = this.parsePropertyKey()
        this.expect('COLON')
        const value = this.parseExpression()
        props[key] = value
      } while (this.match('COMMA'))
    }

    this.expect('RBRACE')

    return props
  }

  private parsePropertyKey(): string {
    const token = this.current()
    if (token.type === 'IDENTIFIER' || token.type === 'KEYWORD' || token.type === 'STRING') {
      return this.advance().value
    }
    throw new CypherParseError('Expected property key', token.position)
  }

  // ===========================================================================
  // Expression Parsing
  // ===========================================================================

  private parseExpression(): unknown {
    const token = this.current()

    // Parameter
    if (token.type === 'PARAMETER') {
      this.advance()
      return this.parameters[token.value]
    }

    // String
    if (token.type === 'STRING') {
      return this.advance().value
    }

    // Number
    if (token.type === 'NUMBER') {
      const numStr = this.advance().value
      return numStr.includes('.') || numStr.includes('e') || numStr.includes('E')
        ? parseFloat(numStr)
        : parseInt(numStr, 10)
    }

    // Boolean
    if (token.type === 'KEYWORD') {
      if (token.value === 'TRUE') {
        this.advance()
        return true
      }
      if (token.value === 'FALSE') {
        this.advance()
        return false
      }
      if (token.value === 'NULL') {
        this.advance()
        return null
      }
    }

    // Array
    if (token.type === 'LBRACKET') {
      return this.parseArray()
    }

    // Identifier (property reference or variable)
    if (token.type === 'IDENTIFIER') {
      return this.advance().value
    }

    throw new CypherParseError(`Unexpected token in expression: ${token.value}`, token.position)
  }

  private parseArray(): unknown[] {
    const items: unknown[] = []

    this.expect('LBRACKET')

    if (this.current().type !== 'RBRACKET') {
      items.push(this.parseExpression())
      while (this.match('COMMA')) {
        items.push(this.parseExpression())
      }
    }

    this.expect('RBRACKET')

    return items
  }

  // ===========================================================================
  // WHERE Clause Parsing (to AST)
  // ===========================================================================

  private parseOr(): QueryNode {
    let left = this.parseXor()

    while (this.matchKeyword('OR')) {
      const right = this.parseXor()
      left = {
        type: 'logical',
        op: 'OR',
        children: [left, right],
      }
    }

    return left
  }

  private parseXor(): QueryNode {
    let left = this.parseAnd()

    while (this.matchKeyword('XOR')) {
      const right = this.parseAnd()
      // XOR is (A OR B) AND NOT (A AND B)
      left = {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'logical', op: 'OR', children: [left, right] },
          { type: 'logical', op: 'NOT', children: [
            { type: 'logical', op: 'AND', children: [left, right] }
          ]},
        ],
      } as LogicalNode
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

    return this.parseComparison()
  }

  private parseComparison(): QueryNode {
    // Handle parenthesized expression
    if (this.current().type === 'LPAREN') {
      this.advance()
      const expr = this.parseOr()
      this.expect('RPAREN')
      return expr
    }

    // Parse left side (property reference)
    const column = this.parsePropertyRef()

    // Handle IS NULL / IS NOT NULL
    if (this.matchKeyword('IS')) {
      const not = this.matchKeyword('NOT')
      this.expectKeyword('NULL')
      return {
        type: 'predicate',
        column,
        op: not ? 'IS NOT NULL' : 'IS NULL',
        value: null,
      } as PredicateNode
    }

    // Handle NOT IN, NOT CONTAINS, etc.
    const isNot = this.matchKeyword('NOT')

    // Handle IN
    if (this.matchKeyword('IN')) {
      const value = this.parseExpression()
      const pred: PredicateNode = {
        type: 'predicate',
        column,
        op: 'IN',
        value,
      }
      return isNot ? { type: 'logical', op: 'NOT', children: [pred] } as LogicalNode : pred
    }

    // Handle CONTAINS
    if (this.matchKeyword('CONTAINS')) {
      const value = this.parseExpression()
      const pred: PredicateNode = {
        type: 'predicate',
        column,
        op: 'CONTAINS',
        value,
      }
      return isNot ? { type: 'logical', op: 'NOT', children: [pred] } as LogicalNode : pred
    }

    // Handle STARTS WITH
    if (this.matchKeyword('STARTS')) {
      this.expectKeyword('WITH')
      const value = this.parseExpression()
      const pred: PredicateNode = {
        type: 'predicate',
        column,
        op: 'STARTS_WITH',
        value,
      }
      return isNot ? { type: 'logical', op: 'NOT', children: [pred] } as LogicalNode : pred
    }

    // Handle ENDS WITH
    if (this.matchKeyword('ENDS')) {
      this.expectKeyword('WITH')
      const value = this.parseExpression()
      // Map to LIKE for AST compatibility
      const pred: PredicateNode = {
        type: 'predicate',
        column,
        op: 'LIKE',
        value: `%${value}`,
      }
      return isNot ? { type: 'logical', op: 'NOT', children: [pred] } as LogicalNode : pred
    }

    // Handle comparison operators
    const token = this.current()
    if (token.type === 'OPERATOR' && COMPARISON_OPS.has(token.value)) {
      this.advance()
      let op = token.value
      if (op === '<>') op = '!='
      if (op === '=~') op = 'LIKE' // Map regex to LIKE for AST

      const value = this.parseExpression()
      return {
        type: 'predicate',
        column,
        op: op as ComparisonOp,
        value,
      }
    }

    // Boolean check (no operator means truthy check)
    return {
      type: 'predicate',
      column,
      op: '=',
      value: true,
    }
  }

  private parsePropertyRef(): string {
    let ref = ''

    // Parse identifier
    if (this.current().type === 'IDENTIFIER' || this.current().type === 'KEYWORD') {
      ref = this.advance().value
    } else {
      throw new CypherParseError('Expected property reference', this.current().position)
    }

    // Parse property access: n.name, n.address.city
    while (this.match('DOT')) {
      if (this.current().type === 'IDENTIFIER' || this.current().type === 'KEYWORD') {
        ref += '.' + this.advance().value
      }
    }

    return ref
  }

  // ===========================================================================
  // SET/REMOVE/DELETE Parsing
  // ===========================================================================

  private parseSetClauses(): CypherSetClause[] {
    const clauses: CypherSetClause[] = []

    do {
      clauses.push(this.parseSetClause())
    } while (this.match('COMMA'))

    return clauses
  }

  private parseSetClause(): CypherSetClause {
    const variable = this.parsePropertyRef()

    // Check for += or =
    const op = this.current().value as '=' | '+='
    if (op !== '=' && op !== '+=') {
      throw new CypherParseError('Expected = or += in SET clause', this.current().position)
    }
    this.advance()

    // Check if setting properties or single property
    if (this.current().type === 'LBRACE') {
      const properties = this.parseProperties()
      const parts = variable.split('.')
      return {
        variable: parts[0]!,
        properties,
        operator: op,
        value: null,
      }
    }

    const value = this.parseExpression()
    const parts = variable.split('.')

    if (parts.length > 1) {
      return {
        variable: parts[0]!,
        property: parts.slice(1).join('.'),
        value,
        operator: op,
      }
    }

    return {
      variable,
      value,
      operator: op,
    }
  }

  private parseRemoveClauses(): CypherRemoveClause[] {
    const clauses: CypherRemoveClause[] = []

    do {
      clauses.push(this.parseRemoveClause())
    } while (this.match('COMMA'))

    return clauses
  }

  private parseRemoveClause(): CypherRemoveClause {
    const ref = this.parsePropertyRef()
    const parts = ref.split('.')

    // Check for label removal: n:Label
    if (this.match('COLON')) {
      const label = this.current().type === 'IDENTIFIER' ? this.advance().value : ''
      return {
        variable: parts[0]!,
        label,
      }
    }

    if (parts.length > 1) {
      return {
        variable: parts[0]!,
        property: parts.slice(1).join('.'),
      }
    }

    return { variable: parts[0]! }
  }

  private parseIdentifierList(): string[] {
    const identifiers: string[] = []

    do {
      if (this.current().type === 'IDENTIFIER') {
        identifiers.push(this.advance().value)
      }
    } while (this.match('COMMA'))

    return identifiers
  }

  // ===========================================================================
  // RETURN Parsing
  // ===========================================================================

  private parseReturn(): ParsedCypherQuery['return'] {
    const distinct = this.matchKeyword('DISTINCT')
    const items: CypherReturnItem[] = []

    do {
      items.push(this.parseReturnItem())
    } while (this.match('COMMA'))

    const result: ParsedCypherQuery['return'] = { items, distinct }

    // Handle ORDER BY
    if (this.matchKeyword('ORDER')) {
      this.expectKeyword('BY')
      result.orderBy = this.parseOrderBy()
    }

    // Handle SKIP
    if (this.matchKeyword('SKIP')) {
      const token = this.current()
      if (token.type === 'NUMBER') {
        result.skip = parseInt(this.advance().value, 10)
      } else if (token.type === 'PARAMETER') {
        this.advance()
        result.skip = this.parameters[token.value] as number
      }
    }

    // Handle LIMIT
    if (this.matchKeyword('LIMIT')) {
      const token = this.current()
      if (token.type === 'NUMBER') {
        result.limit = parseInt(this.advance().value, 10)
      } else if (token.type === 'PARAMETER') {
        this.advance()
        result.limit = this.parameters[token.value] as number
      }
    }

    return result
  }

  private parseReturnItem(): CypherReturnItem {
    let expression = ''
    let aggregate: string | undefined
    let distinct = false

    // Check for DISTINCT
    if (this.matchKeyword('DISTINCT')) {
      distinct = true
    }

    // Check for aggregate functions
    const token = this.current()
    if (token.type === 'KEYWORD' && ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COLLECT'].includes(token.value)) {
      aggregate = token.value.toLowerCase()
      this.advance()
      this.expect('LPAREN')

      if (this.matchKeyword('DISTINCT')) {
        distinct = true
      }

      if (this.current().value === '*') {
        expression = '*'
        this.advance()
      } else {
        expression = this.parsePropertyRef()
      }

      this.expect('RPAREN')
    } else {
      expression = this.parsePropertyRef()
    }

    // Handle AS alias
    let alias: string | undefined
    if (this.matchKeyword('AS')) {
      alias = this.current().type === 'IDENTIFIER' ? this.advance().value : undefined
    }

    return { expression, alias, aggregate, distinct }
  }

  private parseOrderBy(): SortColumn[] {
    const columns: SortColumn[] = []

    do {
      const column = this.parsePropertyRef()
      let direction: SortDirection = 'ASC'

      if (this.matchKeyword('DESC') || this.matchKeyword('DESCENDING')) {
        direction = 'DESC'
      } else {
        this.matchKeyword('ASC')
        this.matchKeyword('ASCENDING')
      }

      columns.push({ column, direction })
    } while (this.match('COMMA'))

    return columns
  }
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Parse a Cypher query string
 */
export function parseCypher(
  cypher: string,
  parameters: Record<string, unknown> = {}
): ParsedCypherQuery[] {
  const parser = new CypherParser()
  return parser.parse(cypher, parameters)
}

/**
 * Parse a Cypher WHERE clause to unified AST
 */
export function parseCypherWhere(
  where: string,
  parameters: Record<string, unknown> = {}
): QueryNode | undefined {
  const parser = new CypherParser()
  return parser.parseWhereToAST(where, parameters)
}
