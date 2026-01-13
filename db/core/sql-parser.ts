/**
 * SQL Parser for Shard Key Extraction
 *
 * A proper tokenizer and recursive descent parser for extracting shard key values
 * from SQL WHERE clauses. Replaces regex-based parsing for more accurate and
 * maintainable extraction.
 *
 * Supports:
 * - WHERE column = value (strings, numbers, parameters)
 * - WHERE column IN (value, ...)
 * - AND/OR conditions
 * - INSERT INTO ... (columns) VALUES (values)
 * - UPDATE ... WHERE ...
 * - Nested parentheses
 * - Named parameters (:param)
 * - Positional parameters (?)
 */

// ============================================================================
// TOKEN TYPES
// ============================================================================

export type TokenType =
  | 'KEYWORD'      // SELECT, INSERT, UPDATE, DELETE, WHERE, AND, OR, IN, VALUES, INTO, SET, FROM
  | 'IDENTIFIER'   // column names, table names
  | 'STRING'       // 'value' or "value"
  | 'NUMBER'       // 123, 45.67, -89
  | 'OPERATOR'     // =, !=, <>, <, >, <=, >=
  | 'COMMA'        // ,
  | 'LPAREN'       // (
  | 'RPAREN'       // )
  | 'PARAM'        // ? (positional parameter)
  | 'NAMED_PARAM'  // :name (named parameter)
  | 'DOT'          // . (for table.column)
  | 'SEMICOLON'    // ;
  | 'STAR'         // *
  | 'EOF'          // end of input

export interface Token {
  type: TokenType
  value: string
  position: number
}

// ============================================================================
// SQL KEYWORDS
// ============================================================================

const KEYWORDS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'AND', 'OR',
  'IN', 'NOT', 'NULL', 'IS', 'LIKE', 'BETWEEN', 'VALUES', 'INTO', 'SET',
  'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT',
  'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'DISTINCT', 'ALL', 'EXISTS',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'TRUE', 'FALSE', 'ASC', 'DESC',
])

// ============================================================================
// TOKENIZER
// ============================================================================

export class SQLTokenizer {
  private input: string
  private position: number = 0

  constructor(input: string) {
    this.input = input
  }

  private get current(): string {
    return this.input[this.position] || ''
  }

  private peek(offset: number = 1): string {
    return this.input[this.position + offset] || ''
  }

  private advance(): string {
    return this.input[this.position++] || ''
  }

  private skipWhitespace(): void {
    while (this.position < this.input.length && /\s/.test(this.current)) {
      this.advance()
    }
  }

  private readString(quote: string): string {
    const startPos = this.position
    this.advance() // consume opening quote
    let value = ''

    while (this.position < this.input.length) {
      const char = this.current
      if (char === quote) {
        // Check for escaped quote (doubled)
        if (this.peek() === quote) {
          value += quote
          this.advance()
          this.advance()
        } else {
          this.advance() // consume closing quote
          break
        }
      } else if (char === '\\' && this.peek() === quote) {
        // Backslash escape
        value += quote
        this.advance()
        this.advance()
      } else {
        value += char
        this.advance()
      }
    }

    return value
  }

  private readNumber(): string {
    let value = ''

    // Handle negative numbers
    if (this.current === '-') {
      value += this.advance()
    }

    // Integer part
    while (this.position < this.input.length && /[0-9]/.test(this.current)) {
      value += this.advance()
    }

    // Decimal part
    if (this.current === '.' && /[0-9]/.test(this.peek())) {
      value += this.advance() // consume '.'
      while (this.position < this.input.length && /[0-9]/.test(this.current)) {
        value += this.advance()
      }
    }

    // Scientific notation
    if (this.current.toLowerCase() === 'e') {
      value += this.advance()
      if (this.current === '+' || this.current === '-') {
        value += this.advance()
      }
      while (this.position < this.input.length && /[0-9]/.test(this.current)) {
        value += this.advance()
      }
    }

    return value
  }

  private readIdentifier(): string {
    let value = ''

    // Handle quoted identifiers (backticks or double quotes for identifiers)
    if (this.current === '`') {
      this.advance() // consume opening backtick
      while (this.position < this.input.length && this.current !== '`') {
        value += this.advance()
      }
      if (this.current === '`') {
        this.advance() // consume closing backtick
      }
      return value
    }

    // Handle bracket-quoted identifiers [identifier]
    if (this.current === '[') {
      this.advance() // consume opening bracket
      while (this.position < this.input.length && this.current !== ']') {
        value += this.advance()
      }
      if (this.current === ']') {
        this.advance() // consume closing bracket
      }
      return value
    }

    // Regular identifier: alphanumeric and underscore
    while (this.position < this.input.length && /[a-zA-Z0-9_]/.test(this.current)) {
      value += this.advance()
    }

    return value
  }

  private readNamedParam(): string {
    this.advance() // consume ':'
    let value = ''
    while (this.position < this.input.length && /[a-zA-Z0-9_]/.test(this.current)) {
      value += this.advance()
    }
    return value
  }

  tokenize(): Token[] {
    const tokens: Token[] = []

    while (this.position < this.input.length) {
      this.skipWhitespace()
      if (this.position >= this.input.length) break

      const startPos = this.position
      const char = this.current

      // String literals
      if (char === "'" || char === '"') {
        const value = this.readString(char)
        tokens.push({ type: 'STRING', value, position: startPos })
        continue
      }

      // Numbers (including negative)
      if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(this.peek()))) {
        const value = this.readNumber()
        tokens.push({ type: 'NUMBER', value, position: startPos })
        continue
      }

      // Named parameters
      if (char === ':') {
        const value = this.readNamedParam()
        tokens.push({ type: 'NAMED_PARAM', value, position: startPos })
        continue
      }

      // Positional parameter
      if (char === '?') {
        this.advance()
        tokens.push({ type: 'PARAM', value: '?', position: startPos })
        continue
      }

      // Operators
      if (char === '=' || char === '<' || char === '>' || char === '!') {
        let op = this.advance()
        if ((char === '<' || char === '>' || char === '!') && this.current === '=') {
          op += this.advance()
        } else if (char === '<' && this.current === '>') {
          op += this.advance() // <>
        }
        tokens.push({ type: 'OPERATOR', value: op, position: startPos })
        continue
      }

      // Punctuation
      if (char === ',') {
        this.advance()
        tokens.push({ type: 'COMMA', value: ',', position: startPos })
        continue
      }
      if (char === '(') {
        this.advance()
        tokens.push({ type: 'LPAREN', value: '(', position: startPos })
        continue
      }
      if (char === ')') {
        this.advance()
        tokens.push({ type: 'RPAREN', value: ')', position: startPos })
        continue
      }
      if (char === '.') {
        this.advance()
        tokens.push({ type: 'DOT', value: '.', position: startPos })
        continue
      }
      if (char === ';') {
        this.advance()
        tokens.push({ type: 'SEMICOLON', value: ';', position: startPos })
        continue
      }
      if (char === '*') {
        this.advance()
        tokens.push({ type: 'STAR', value: '*', position: startPos })
        continue
      }

      // Identifiers and keywords
      if (/[a-zA-Z_`\[]/.test(char)) {
        const value = this.readIdentifier()
        const upperValue = value.toUpperCase()
        if (KEYWORDS.has(upperValue)) {
          tokens.push({ type: 'KEYWORD', value: upperValue, position: startPos })
        } else {
          tokens.push({ type: 'IDENTIFIER', value, position: startPos })
        }
        continue
      }

      // Skip unknown characters
      this.advance()
    }

    tokens.push({ type: 'EOF', value: '', position: this.position })
    return tokens
  }
}

// ============================================================================
// AST TYPES
// ============================================================================

export type ASTNode =
  | ConditionNode
  | ValueNode
  | InListNode
  | BinaryOpNode

export interface ConditionNode {
  type: 'condition'
  column: string
  operator: string
  value: ValueNode | InListNode
}

export interface ValueNode {
  type: 'value'
  valueType: 'string' | 'number' | 'param' | 'named_param' | 'null'
  value: string
  paramIndex?: number // for positional parameters
}

export interface InListNode {
  type: 'in_list'
  values: ValueNode[]
}

export interface BinaryOpNode {
  type: 'binary_op'
  operator: 'AND' | 'OR'
  left: ASTNode
  right: ASTNode
}

// ============================================================================
// PARSER
// ============================================================================

export class SQLParser {
  private tokens: Token[]
  private position: number = 0
  private paramIndex: number = 0 // Track positional parameter order

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private get current(): Token {
    return this.tokens[this.position] || { type: 'EOF', value: '', position: -1 }
  }

  private peek(offset: number = 1): Token {
    return this.tokens[this.position + offset] || { type: 'EOF', value: '', position: -1 }
  }

  private advance(): Token {
    return this.tokens[this.position++] || { type: 'EOF', value: '', position: -1 }
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`Expected ${type}${value ? ` '${value}'` : ''} but got ${token.type} '${token.value}'`)
    }
    return this.advance()
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.current
    return token.type === type && (value === undefined || token.value === value)
  }

  private matchKeyword(...keywords: string[]): boolean {
    return this.match('KEYWORD') && keywords.includes(this.current.value)
  }

  /**
   * Find the WHERE clause and parse it
   */
  parseWhereClause(): ASTNode | undefined {
    // Skip to WHERE keyword
    while (!this.match('EOF')) {
      if (this.matchKeyword('WHERE')) {
        this.advance() // consume WHERE
        return this.parseExpression()
      }
      this.advance()
    }
    return undefined
  }

  /**
   * Parse INSERT statement to extract column values
   * Returns map of column name to value node
   */
  parseInsert(): Map<string, ValueNode> | undefined {
    const columnValues = new Map<string, ValueNode>()

    // Find INSERT INTO
    if (!this.matchKeyword('INSERT')) {
      return undefined
    }
    this.advance()

    if (!this.matchKeyword('INTO')) {
      return undefined
    }
    this.advance()

    // Skip table name
    if (this.match('IDENTIFIER')) {
      this.advance()
    }

    // Parse column list
    if (!this.match('LPAREN')) {
      return undefined
    }
    this.advance()

    const columns: string[] = []
    while (!this.match('RPAREN') && !this.match('EOF')) {
      if (this.match('IDENTIFIER')) {
        columns.push(this.current.value)
        this.advance()
      }
      if (this.match('COMMA')) {
        this.advance()
      }
    }

    if (this.match('RPAREN')) {
      this.advance()
    }

    // Find VALUES keyword
    if (!this.matchKeyword('VALUES')) {
      return undefined
    }
    this.advance()

    // Parse values list
    if (!this.match('LPAREN')) {
      return undefined
    }
    this.advance()

    const values: ValueNode[] = []
    while (!this.match('RPAREN') && !this.match('EOF')) {
      const value = this.parseValue()
      if (value) {
        values.push(value)
      }
      if (this.match('COMMA')) {
        this.advance()
      }
    }

    // Match columns to values
    for (let i = 0; i < columns.length && i < values.length; i++) {
      columnValues.set(columns[i]!.toLowerCase(), values[i]!)
    }

    return columnValues
  }

  /**
   * Parse a boolean expression (AND/OR)
   */
  private parseExpression(): ASTNode | undefined {
    let left = this.parseComparison()
    if (!left) return undefined

    while (this.matchKeyword('AND', 'OR')) {
      const operator = this.current.value as 'AND' | 'OR'
      this.advance()
      const right = this.parseComparison()
      if (!right) break

      left = {
        type: 'binary_op',
        operator,
        left,
        right,
      }
    }

    return left
  }

  /**
   * Parse a comparison (column op value or column IN (...))
   */
  private parseComparison(): ASTNode | undefined {
    // Handle parenthesized expressions
    if (this.match('LPAREN')) {
      this.advance()
      const expr = this.parseExpression()
      if (this.match('RPAREN')) {
        this.advance()
      }
      return expr
    }

    // Handle NOT
    if (this.matchKeyword('NOT')) {
      this.advance()
      // Skip NOT conditions for shard key extraction
      return this.parseComparison()
    }

    // Expect identifier (column name)
    if (!this.match('IDENTIFIER')) {
      // Skip unknown tokens
      if (!this.match('EOF') && !this.matchKeyword('AND', 'OR')) {
        this.advance()
        return this.parseComparison()
      }
      return undefined
    }

    let column = this.current.value
    this.advance()

    // Handle table.column
    if (this.match('DOT')) {
      this.advance()
      if (this.match('IDENTIFIER')) {
        column = this.current.value // Use column name, not table.column
        this.advance()
      }
    }

    // Handle IS NULL / IS NOT NULL
    if (this.matchKeyword('IS')) {
      this.advance()
      if (this.matchKeyword('NOT')) {
        this.advance()
      }
      if (this.matchKeyword('NULL')) {
        this.advance()
      }
      // Skip IS NULL conditions for shard extraction
      return this.parseComparison()
    }

    // Handle IN clause
    if (this.matchKeyword('IN')) {
      this.advance()
      const inList = this.parseInList()
      if (inList) {
        return {
          type: 'condition',
          column,
          operator: 'IN',
          value: inList,
        }
      }
      return undefined
    }

    // Handle NOT IN
    if (this.matchKeyword('NOT')) {
      this.advance()
      if (this.matchKeyword('IN')) {
        this.advance()
        this.parseInList() // Consume but don't use
        return this.parseComparison() // Skip NOT IN conditions
      }
    }

    // Handle LIKE, BETWEEN
    if (this.matchKeyword('LIKE', 'BETWEEN')) {
      // Skip these for shard key extraction
      this.advance()
      while (!this.match('EOF') && !this.matchKeyword('AND', 'OR') && !this.match('RPAREN')) {
        this.advance()
      }
      return this.parseComparison()
    }

    // Handle comparison operators
    if (this.match('OPERATOR')) {
      const operator = this.current.value
      this.advance()

      const value = this.parseValue()
      if (value) {
        return {
          type: 'condition',
          column,
          operator,
          value,
        }
      }
    }

    return undefined
  }

  /**
   * Parse an IN list: (value, value, ...)
   */
  private parseInList(): InListNode | undefined {
    if (!this.match('LPAREN')) {
      return undefined
    }
    this.advance()

    const values: ValueNode[] = []
    while (!this.match('RPAREN') && !this.match('EOF')) {
      const value = this.parseValue()
      if (value) {
        values.push(value)
      }
      if (this.match('COMMA')) {
        this.advance()
      }
    }

    if (this.match('RPAREN')) {
      this.advance()
    }

    return { type: 'in_list', values }
  }

  /**
   * Parse a value (string, number, parameter)
   */
  private parseValue(): ValueNode | undefined {
    const token = this.current

    if (token.type === 'STRING') {
      this.advance()
      return { type: 'value', valueType: 'string', value: token.value }
    }

    if (token.type === 'NUMBER') {
      this.advance()
      return { type: 'value', valueType: 'number', value: token.value }
    }

    if (token.type === 'PARAM') {
      const paramIdx = this.paramIndex++
      this.advance()
      return { type: 'value', valueType: 'param', value: '?', paramIndex: paramIdx }
    }

    if (token.type === 'NAMED_PARAM') {
      this.advance()
      return { type: 'value', valueType: 'named_param', value: token.value }
    }

    if (this.matchKeyword('NULL')) {
      this.advance()
      return { type: 'value', valueType: 'null', value: 'NULL' }
    }

    if (this.matchKeyword('TRUE', 'FALSE')) {
      const val = token.value
      this.advance()
      return { type: 'value', valueType: 'number', value: val === 'TRUE' ? '1' : '0' }
    }

    return undefined
  }
}

// ============================================================================
// SHARD KEY EXTRACTOR
// ============================================================================

export interface ExtractedShardKey {
  /** Single shard key value (when query targets one shard) */
  value?: string
  /** Multiple values (when IN clause is used) */
  values?: string[]
  /** Whether this is a cross-shard query (no shard key found) */
  isCrossShard: boolean
}

/**
 * Extract shard key values from a parsed WHERE clause AST
 */
function extractFromAST(
  node: ASTNode,
  shardKey: string,
  params?: unknown[] | Record<string, unknown>
): ExtractedShardKey {
  const lowerShardKey = shardKey.toLowerCase()

  if (node.type === 'condition') {
    const columnLower = node.column.toLowerCase()

    if (columnLower === lowerShardKey) {
      // Direct match on shard key
      if (node.operator === '=' && node.value.type === 'value') {
        const resolved = resolveValue(node.value, params)
        if (resolved !== undefined) {
          return { value: resolved, isCrossShard: false }
        }
      }

      if (node.operator === 'IN' && node.value.type === 'in_list') {
        const resolvedValues: string[] = []
        for (const v of node.value.values) {
          const resolved = resolveValue(v, params)
          if (resolved !== undefined) {
            resolvedValues.push(resolved)
          }
        }
        if (resolvedValues.length > 0) {
          return { values: resolvedValues, isCrossShard: false }
        }
      }
    }
  }

  if (node.type === 'binary_op') {
    const leftResult = extractFromAST(node.left, shardKey, params)
    const rightResult = extractFromAST(node.right, shardKey, params)

    // For AND: both conditions must be satisfied, but we only need the shard key
    if (node.operator === 'AND') {
      if (!leftResult.isCrossShard) return leftResult
      if (!rightResult.isCrossShard) return rightResult
    }

    // For OR: if either side has a shard key, we might need to query multiple shards
    if (node.operator === 'OR') {
      // If both sides have shard keys, we need multiple shards
      if (!leftResult.isCrossShard && !rightResult.isCrossShard) {
        const allValues: string[] = []
        if (leftResult.value) allValues.push(leftResult.value)
        if (leftResult.values) allValues.push(...leftResult.values)
        if (rightResult.value) allValues.push(rightResult.value)
        if (rightResult.values) allValues.push(...rightResult.values)

        if (allValues.length > 1) {
          return { values: allValues, isCrossShard: false }
        }
        if (allValues.length === 1) {
          return { value: allValues[0], isCrossShard: false }
        }
      }

      // If only one side has shard key in OR, it's a cross-shard query
      if (!leftResult.isCrossShard || !rightResult.isCrossShard) {
        return { isCrossShard: true }
      }
    }
  }

  return { isCrossShard: true }
}

/**
 * Resolve a value node to a string, handling parameters
 */
function resolveValue(
  node: ValueNode,
  params?: unknown[] | Record<string, unknown>
): string | undefined {
  switch (node.valueType) {
    case 'string':
    case 'number':
      return node.value

    case 'param':
      if (Array.isArray(params) && node.paramIndex !== undefined) {
        const val = params[node.paramIndex]
        if (val !== undefined && val !== null) {
          return String(val)
        }
      }
      return undefined

    case 'named_param':
      if (params && typeof params === 'object' && !Array.isArray(params)) {
        const val = params[node.value]
        if (val !== undefined && val !== null) {
          return String(val)
        }
      }
      return undefined

    case 'null':
      return undefined
  }
}

/**
 * Extract shard key value from SQL statement using proper parsing
 *
 * @param sql - SQL statement
 * @param shardKey - Name of shard key column
 * @param params - Query parameters (array or object)
 * @returns Extracted shard key info
 */
export function parseAndExtractShardKey(
  sql: string,
  shardKey: string,
  params?: unknown[] | Record<string, unknown>
): ExtractedShardKey {
  try {
    const tokenizer = new SQLTokenizer(sql)
    const tokens = tokenizer.tokenize()
    const parser = new SQLParser(tokens)

    const upperSql = sql.toUpperCase().trim()

    // Handle INSERT statements
    if (upperSql.startsWith('INSERT')) {
      const columnValues = parser.parseInsert()
      if (columnValues) {
        const valueNode = columnValues.get(shardKey.toLowerCase())
        if (valueNode) {
          const resolved = resolveValue(valueNode, params)
          if (resolved !== undefined) {
            return { value: resolved, isCrossShard: false }
          }
        }
      }
      return { isCrossShard: true }
    }

    // Handle SELECT, UPDATE, DELETE with WHERE clause
    const ast = parser.parseWhereClause()
    if (!ast) {
      return { isCrossShard: true }
    }

    return extractFromAST(ast, shardKey, params)
  } catch {
    // Fall back to cross-shard on parse error
    return { isCrossShard: true }
  }
}

/**
 * Extract shard key value from SQL statement (simplified interface)
 * Returns single value or undefined for multi-shard/cross-shard queries
 *
 * This is the main entry point, replacing the regex-based extractShardKey
 *
 * @param sql - SQL statement
 * @param shardKey - Name of shard key column
 * @param params - Query parameters (array or object)
 * @returns Extracted key value or undefined
 */
export function extractShardKeyParsed(
  sql: string,
  shardKey: string,
  params?: unknown[] | Record<string, unknown>
): string | undefined {
  const result = parseAndExtractShardKey(sql, shardKey, params)

  // Only return a value if we have exactly one shard to target
  if (!result.isCrossShard && result.value) {
    return result.value
  }

  // Multiple values means we need to fan out (return undefined)
  // Cross-shard also returns undefined
  return undefined
}
