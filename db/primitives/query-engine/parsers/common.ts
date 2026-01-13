/**
 * Common Parser and Evaluation Primitives
 *
 * Shared tokenization, AST building, and predicate evaluation infrastructure
 * for SQL and Mongo parsers. Extracts common patterns to reduce duplication
 * and improve maintainability.
 *
 * @see dotdo-v8r9e
 * @see dotdo-nplc2 (added predicate evaluation utilities)
 */

import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  ComparisonOp,
} from '../ast'

// =============================================================================
// Token Types
// =============================================================================

/**
 * Token types for the unified tokenizer
 */
export enum TokenType {
  /** Keywords (SELECT, FROM, WHERE, AND, OR, etc.) */
  KEYWORD = 'KEYWORD',
  /** Identifiers (column names, table names) */
  IDENTIFIER = 'IDENTIFIER',
  /** Operators (=, !=, <>, >, >=, <, <=, +, -, etc.) */
  OPERATOR = 'OPERATOR',
  /** Numeric literals (42, 3.14, 1e10) */
  NUMBER = 'NUMBER',
  /** String literals ('hello', "world") */
  STRING = 'STRING',
  /** Left parenthesis */
  LPAREN = 'LPAREN',
  /** Right parenthesis */
  RPAREN = 'RPAREN',
  /** Left bracket */
  LBRACKET = 'LBRACKET',
  /** Right bracket */
  RBRACKET = 'RBRACKET',
  /** Comma */
  COMMA = 'COMMA',
  /** Dot */
  DOT = 'DOT',
  /** End of file */
  EOF = 'EOF',
}

/**
 * Token structure with position tracking
 */
export interface Token {
  type: TokenType
  value: string
  position: number
  line?: number
  column?: number
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown during tokenization
 */
export class TokenizerError extends Error {
  constructor(
    message: string,
    public position: number,
    public line?: number,
    public column?: number
  ) {
    const locationInfo = line !== undefined && column !== undefined
      ? ` at line ${line}, column ${column}`
      : ` at position ${position}`
    super(`${message}${locationInfo}`)
    this.name = 'TokenizerError'
  }
}

/**
 * Error thrown during parsing with position information
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public position: number,
    public line?: number,
    public column?: number
  ) {
    const locationInfo = line !== undefined && column !== undefined
      ? ` at line ${line}, column ${column}`
      : ` at position ${position}`
    super(`${message}${locationInfo}`)
    this.name = 'ParseError'
  }
}

// =============================================================================
// Tokenizer Options
// =============================================================================

/**
 * Configuration options for the tokenizer
 */
export interface TokenizerOptions {
  /** Set of keywords to recognize (case-insensitive) */
  keywords?: Set<string>
  /** Whether to track line and column numbers */
  trackLineColumn?: boolean
  /** Whether to skip comments (default: true) */
  skipComments?: boolean
  /**
   * Whether to interpret backslash escapes in strings (default: true).
   * Set to false for SQL-92 style strings where only doubled quotes are escapes.
   */
  backslashEscapes?: boolean
}

// =============================================================================
// Tokenizer Class
// =============================================================================

/**
 * Universal tokenizer for query languages.
 * Handles strings, numbers, identifiers, operators, and keywords.
 */
export class Tokenizer {
  private input: string
  private pos = 0
  private line = 1
  private column = 1
  private keywords: Set<string>
  private trackLineColumn: boolean
  private skipComments: boolean
  private backslashEscapes: boolean
  private lastTokenType: TokenType | null = null

  constructor(input: string, options: TokenizerOptions = {}) {
    this.input = input
    this.keywords = options.keywords || new Set()
    this.trackLineColumn = options.trackLineColumn ?? false
    this.skipComments = options.skipComments ?? true
    this.backslashEscapes = options.backslashEscapes ?? true
  }

  /**
   * Tokenize the entire input and return all tokens
   */
  tokenizeAll(): Token[] {
    const tokens: Token[] = []
    let token: Token

    do {
      token = this.nextToken()
      tokens.push(token)
    } while (token.type !== TokenType.EOF)

    return tokens
  }

  /**
   * Get the next token from the input
   */
  nextToken(): Token {
    this.skipWhitespaceAndComments()

    if (this.pos >= this.input.length) {
      return this.createToken(TokenType.EOF, '', this.pos)
    }

    const char = this.input[this.pos]!
    const start = this.pos
    const startLine = this.line
    const startColumn = this.column

    // String literals
    if (char === "'" || char === '"') {
      const token = this.readString(char, start, startLine, startColumn)
      this.lastTokenType = token.type
      return token
    }

    // Backtick-quoted identifiers (MySQL style)
    if (char === '`') {
      const token = this.readBacktickIdentifier(start, startLine, startColumn)
      this.lastTokenType = token.type
      return token
    }

    // Check if minus should be part of number (at start or after operator/paren/comma)
    const minusIsNegative = char === '-' &&
      this.isDigit(this.peek(1)) &&
      (this.lastTokenType === null ||
       this.lastTokenType === TokenType.OPERATOR ||
       this.lastTokenType === TokenType.LPAREN ||
       this.lastTokenType === TokenType.COMMA ||
       this.lastTokenType === TokenType.KEYWORD)

    // Numbers (including negative numbers in appropriate context)
    if (this.isDigit(char) || (char === '.' && this.isDigit(this.peek(1))) || minusIsNegative) {
      const token = this.readNumber(start, startLine, startColumn)
      this.lastTokenType = token.type
      return token
    }

    // Multi-character operators (must check before single-char)
    if (this.isMultiCharOperatorStart(char)) {
      const op = this.readMultiCharOperator()
      if (op) {
        this.lastTokenType = TokenType.OPERATOR
        return this.createToken(TokenType.OPERATOR, op, start, startLine, startColumn)
      }
    }

    // Single-character operators
    if (this.isOperatorChar(char)) {
      this.advance()
      this.lastTokenType = TokenType.OPERATOR
      return this.createToken(TokenType.OPERATOR, char, start, startLine, startColumn)
    }

    // Parentheses
    if (char === '(') {
      this.advance()
      this.lastTokenType = TokenType.LPAREN
      return this.createToken(TokenType.LPAREN, '(', start, startLine, startColumn)
    }
    if (char === ')') {
      this.advance()
      this.lastTokenType = TokenType.RPAREN
      return this.createToken(TokenType.RPAREN, ')', start, startLine, startColumn)
    }

    // Brackets
    if (char === '[') {
      this.advance()
      this.lastTokenType = TokenType.LBRACKET
      return this.createToken(TokenType.LBRACKET, '[', start, startLine, startColumn)
    }
    if (char === ']') {
      this.advance()
      this.lastTokenType = TokenType.RBRACKET
      return this.createToken(TokenType.RBRACKET, ']', start, startLine, startColumn)
    }

    // Comma
    if (char === ',') {
      this.advance()
      this.lastTokenType = TokenType.COMMA
      return this.createToken(TokenType.COMMA, ',', start, startLine, startColumn)
    }

    // Dot (if not part of number)
    if (char === '.') {
      this.advance()
      this.lastTokenType = TokenType.DOT
      return this.createToken(TokenType.DOT, '.', start, startLine, startColumn)
    }

    // Identifiers and keywords
    if (this.isIdentifierStart(char)) {
      const token = this.readIdentifierOrKeyword(start, startLine, startColumn)
      this.lastTokenType = token.type
      return token
    }

    // Unknown character - advance and try again
    this.advance()
    return this.nextToken()
  }

  // ===========================================================================
  // String Reading
  // ===========================================================================

  private readString(quote: string, start: number, startLine: number, startColumn: number): Token {
    this.advance() // consume opening quote
    let value = ''
    let closed = false

    while (this.pos < this.input.length) {
      const char = this.input[this.pos]!

      if (char === quote) {
        // Check for escaped quote (doubled)
        if (this.peek(1) === quote) {
          value += quote
          this.advance()
          this.advance()
        } else {
          this.advance() // consume closing quote
          closed = true
          break
        }
      } else if (char === '\\' && this.backslashEscapes) {
        // Backslash escape sequence (only if enabled)
        value += this.readEscapeSequence()
      } else {
        value += char
        this.advance()
      }
    }

    if (!closed) {
      throw new TokenizerError('Unclosed string literal', start, startLine, startColumn)
    }

    return this.createToken(TokenType.STRING, value, start, startLine, startColumn)
  }

  private readEscapeSequence(): string {
    this.advance() // consume backslash

    if (this.pos >= this.input.length) {
      return '\\'
    }

    const char = this.input[this.pos]!
    this.advance()

    switch (char) {
      case 'n': return '\n'
      case 't': return '\t'
      case 'r': return '\r'
      case '\\': return '\\'
      case '"': return '"'
      case "'": return "'"
      case 'u':
        // Unicode escape: \uXXXX
        const hex = this.input.slice(this.pos, this.pos + 4)
        if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
          this.pos += 4
          this.column += 4
          return String.fromCharCode(parseInt(hex, 16))
        }
        return 'u'
      default:
        return char
    }
  }

  // ===========================================================================
  // Number Reading
  // ===========================================================================

  private readNumber(start: number, startLine: number, startColumn: number): Token {
    let numStr = ''

    // Handle leading minus
    if (this.input[this.pos] === '-') {
      numStr += '-'
      this.advance()
    }

    // Integer part (or leading dot for decimals like .5)
    if (this.input[this.pos] === '.') {
      numStr += '.'
      this.advance()
    }

    // Read digits
    while (this.pos < this.input.length && this.isDigit(this.input[this.pos]!)) {
      numStr += this.input[this.pos]
      this.advance()
    }

    // Decimal part
    if (this.input[this.pos] === '.' && !numStr.includes('.')) {
      numStr += '.'
      this.advance()
      while (this.pos < this.input.length && this.isDigit(this.input[this.pos]!)) {
        numStr += this.input[this.pos]
        this.advance()
      }
    }

    // Exponent part
    if (this.input[this.pos] === 'e' || this.input[this.pos] === 'E') {
      numStr += this.input[this.pos]
      this.advance()
      if (this.input[this.pos] === '+' || this.input[this.pos] === '-') {
        numStr += this.input[this.pos]
        this.advance()
      }
      while (this.pos < this.input.length && this.isDigit(this.input[this.pos]!)) {
        numStr += this.input[this.pos]
        this.advance()
      }
    }

    return this.createToken(TokenType.NUMBER, numStr, start, startLine, startColumn)
  }

  // ===========================================================================
  // Identifier/Keyword Reading
  // ===========================================================================

  private readIdentifierOrKeyword(start: number, startLine: number, startColumn: number): Token {
    let value = ''

    while (this.pos < this.input.length && this.isIdentifierChar(this.input[this.pos]!)) {
      value += this.input[this.pos]
      this.advance()
    }

    // Check if it's a keyword (case-insensitive)
    const upper = value.toUpperCase()
    if (this.keywords.has(upper)) {
      return this.createToken(TokenType.KEYWORD, upper, start, startLine, startColumn)
    }

    return this.createToken(TokenType.IDENTIFIER, value, start, startLine, startColumn)
  }

  /**
   * Read a backtick-quoted identifier (MySQL style).
   * Allows any characters inside, including spaces.
   */
  private readBacktickIdentifier(start: number, startLine: number, startColumn: number): Token {
    this.advance() // consume opening backtick
    let value = ''

    while (this.pos < this.input.length && this.input[this.pos] !== '`') {
      value += this.input[this.pos]
      this.advance()
    }

    if (this.pos >= this.input.length) {
      throw new TokenizerError('Unclosed backtick identifier', start, startLine, startColumn)
    }

    this.advance() // consume closing backtick
    return this.createToken(TokenType.IDENTIFIER, value, start, startLine, startColumn)
  }

  // ===========================================================================
  // Operator Reading
  // ===========================================================================

  private isMultiCharOperatorStart(char: string): boolean {
    return ['!', '<', '>', '-', '@'].includes(char)
  }

  private readMultiCharOperator(): string | null {
    const char = this.input[this.pos]!
    const next = this.peek(1)
    const nextNext = this.peek(2)

    // Three-character operators
    if (char === '-' && next === '>' && nextNext === '>') {
      this.advance()
      this.advance()
      this.advance()
      return '->>'
    }

    // Two-character operators
    if (char === '!' && next === '=') {
      this.advance()
      this.advance()
      return '!='
    }
    if (char === '<' && next === '>') {
      this.advance()
      this.advance()
      return '<>'
    }
    if (char === '<' && next === '=') {
      this.advance()
      this.advance()
      return '<='
    }
    if (char === '>' && next === '=') {
      this.advance()
      this.advance()
      return '>='
    }
    if (char === '-' && next === '>') {
      this.advance()
      this.advance()
      return '->'
    }
    if (char === '@' && next === '>') {
      this.advance()
      this.advance()
      return '@>'
    }

    // Single-character operators that might be mistaken for multi-char starters
    if (char === '<' || char === '>') {
      this.advance()
      return char
    }
    if (char === '!' && next !== '=') {
      this.advance()
      return char
    }
    // Minus as operator (not negative number)
    if (char === '-') {
      this.advance()
      return char
    }

    return null
  }

  // ===========================================================================
  // Whitespace and Comments
  // ===========================================================================

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.input.length) {
      const char = this.input[this.pos]!

      // Whitespace
      if (this.isWhitespace(char)) {
        this.advance()
        continue
      }

      if (!this.skipComments) {
        break
      }

      // Single-line comment (--)
      if (char === '-' && this.peek(1) === '-') {
        this.skipSingleLineComment()
        continue
      }

      // Multi-line comment (/* ... */)
      if (char === '/' && this.peek(1) === '*') {
        this.skipMultiLineComment()
        continue
      }

      break
    }
  }

  private skipSingleLineComment(): void {
    while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
      this.advance()
    }
    // Consume the newline if present
    if (this.pos < this.input.length) {
      this.advance()
    }
  }

  private skipMultiLineComment(): void {
    const start = this.pos
    this.advance() // skip /
    this.advance() // skip *

    while (this.pos < this.input.length - 1) {
      if (this.input[this.pos] === '*' && this.input[this.pos + 1] === '/') {
        this.advance() // skip *
        this.advance() // skip /
        return
      }
      this.advance()
    }

    throw new TokenizerError('Unclosed multi-line comment', start)
  }

  // ===========================================================================
  // Character Classification
  // ===========================================================================

  private isWhitespace(char: string): boolean {
    return /\s/.test(char)
  }

  private isDigit(char: string | undefined): boolean {
    return char !== undefined && /\d/.test(char)
  }

  private isIdentifierStart(char: string): boolean {
    return /[a-zA-Z_]/.test(char)
  }

  private isIdentifierChar(char: string): boolean {
    return /[a-zA-Z0-9_]/.test(char)
  }

  private isOperatorChar(char: string): boolean {
    return ['=', '+', '*', '/', '%'].includes(char)
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private peek(offset: number): string | undefined {
    return this.input[this.pos + offset]
  }

  private advance(): void {
    if (this.pos < this.input.length) {
      if (this.input[this.pos] === '\n') {
        this.line++
        this.column = 1
      } else {
        this.column++
      }
      this.pos++
    }
  }

  private createToken(
    type: TokenType,
    value: string,
    position: number,
    line?: number,
    column?: number
  ): Token {
    const token: Token = { type, value, position }
    if (this.trackLineColumn && line !== undefined && column !== undefined) {
      token.line = line
      token.column = column
    }
    return token
  }
}

// =============================================================================
// Value Parsing Functions
// =============================================================================

/**
 * Parse a string literal, handling escape sequences
 */
export function parseStringLiteral(value: string): string {
  let result = ''
  let i = 0

  while (i < value.length) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1]
      switch (next) {
        case 'n': result += '\n'; break
        case 't': result += '\t'; break
        case 'r': result += '\r'; break
        case '\\': result += '\\'; break
        case '"': result += '"'; break
        case "'": result += "'"; break
        case 'u':
          // Unicode escape
          if (i + 5 < value.length) {
            const hex = value.slice(i + 2, i + 6)
            if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
              result += String.fromCharCode(parseInt(hex, 16))
              i += 4
            } else {
              result += next
            }
          } else {
            result += next
          }
          break
        default:
          result += next
      }
      i += 2
    } else {
      result += value[i]
      i++
    }
  }

  return result
}

/**
 * Parse a numeric literal, preserving integer type when appropriate
 */
export function parseNumericLiteral(value: string): number {
  // If it has a decimal point, always return a float
  if (value.includes('.')) {
    return parseFloat(value)
  }

  // If it has an exponent, return float
  if (value.includes('e') || value.includes('E')) {
    return parseFloat(value)
  }

  // Otherwise return integer
  return parseInt(value, 10)
}

/**
 * Parse a boolean literal (TRUE, FALSE)
 */
export function parseBooleanLiteral(value: string): boolean {
  const lower = value.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  throw new Error(`Invalid boolean literal: ${value}`)
}

// =============================================================================
// AST Builder
// =============================================================================

/**
 * SQL operator to AST operator mapping
 */
const SQL_OP_MAP: Record<string, ComparisonOp> = {
  '=': '=',
  '!=': '!=',
  '<>': '!=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
  'IN': 'IN',
  'NOT IN': 'NOT IN',
  'BETWEEN': 'BETWEEN',
  'LIKE': 'LIKE',
  'ILIKE': 'LIKE',
  'IS NULL': 'IS NULL',
  'IS NOT NULL': 'IS NOT NULL',
  '@>': 'CONTAINS',
}

/**
 * MongoDB operator to AST operator mapping
 */
const MONGO_OP_MAP: Record<string, ComparisonOp> = {
  '$eq': '=',
  '$ne': '!=',
  '$gt': '>',
  '$gte': '>=',
  '$lt': '<',
  '$lte': '<=',
  '$in': 'IN',
  '$nin': 'NOT IN',
}

/**
 * Builder for creating unified AST nodes.
 * Provides a fluent API for constructing predicates and logical combinations.
 */
export class ASTBuilder {
  // ===========================================================================
  // Predicate Creation
  // ===========================================================================

  /**
   * Create an equality predicate
   */
  eq(column: string, value: unknown): PredicateNode {
    return this.predicate(column, '=', value)
  }

  /**
   * Create an inequality predicate
   */
  neq(column: string, value: unknown): PredicateNode {
    return this.predicate(column, '!=', value)
  }

  /**
   * Create a greater-than predicate
   */
  gt(column: string, value: unknown): PredicateNode {
    return this.predicate(column, '>', value)
  }

  /**
   * Create a greater-than-or-equal predicate
   */
  gte(column: string, value: unknown): PredicateNode {
    return this.predicate(column, '>=', value)
  }

  /**
   * Create a less-than predicate
   */
  lt(column: string, value: unknown): PredicateNode {
    return this.predicate(column, '<', value)
  }

  /**
   * Create a less-than-or-equal predicate
   */
  lte(column: string, value: unknown): PredicateNode {
    return this.predicate(column, '<=', value)
  }

  /**
   * Create an IN predicate
   */
  inList(column: string, values: unknown[]): PredicateNode {
    return this.predicate(column, 'IN', values)
  }

  /**
   * Create a NOT IN predicate
   */
  notInList(column: string, values: unknown[]): PredicateNode {
    return this.predicate(column, 'NOT IN', values)
  }

  /**
   * Create a BETWEEN predicate
   */
  between(column: string, low: unknown, high: unknown): PredicateNode {
    return this.predicate(column, 'BETWEEN', [low, high])
  }

  /**
   * Create a LIKE predicate
   */
  like(column: string, pattern: string): PredicateNode {
    return this.predicate(column, 'LIKE', pattern)
  }

  /**
   * Create an IS NULL predicate
   */
  isNull(column: string): PredicateNode {
    return this.predicate(column, 'IS NULL', null)
  }

  /**
   * Create an IS NOT NULL predicate
   */
  isNotNull(column: string): PredicateNode {
    return this.predicate(column, 'IS NOT NULL', null)
  }

  /**
   * Create a generic predicate
   */
  predicate(column: string, op: ComparisonOp, value: unknown): PredicateNode {
    return {
      type: 'predicate',
      column,
      op,
      value,
    }
  }

  // ===========================================================================
  // Logical Combination
  // ===========================================================================

  /**
   * Create an AND node, flattening nested ANDs
   */
  and(...children: QueryNode[]): QueryNode {
    // Handle empty case
    if (children.length === 0) {
      return this.alwaysTrue()
    }

    // Flatten nested ANDs
    const flattened = this.flattenLogical('AND', children)

    // Unwrap single child
    if (flattened.length === 1) {
      return flattened[0]!
    }

    return {
      type: 'logical',
      op: 'AND',
      children: flattened,
    }
  }

  /**
   * Create an OR node, flattening nested ORs
   */
  or(...children: QueryNode[]): QueryNode {
    // Handle empty case
    if (children.length === 0) {
      return this.alwaysFalse()
    }

    // Flatten nested ORs
    const flattened = this.flattenLogical('OR', children)

    // Unwrap single child
    if (flattened.length === 1) {
      return flattened[0]!
    }

    return {
      type: 'logical',
      op: 'OR',
      children: flattened,
    }
  }

  /**
   * Create a NOT node
   */
  not(child: QueryNode): LogicalNode {
    return {
      type: 'logical',
      op: 'NOT',
      children: [child],
    }
  }

  // ===========================================================================
  // Operator Mapping
  // ===========================================================================

  /**
   * Map a SQL operator to unified AST operator
   */
  mapSqlOp(op: string): ComparisonOp {
    const mapped = SQL_OP_MAP[op.toUpperCase()]
    if (!mapped) {
      throw new Error(`Unknown SQL operator: ${op}`)
    }
    return mapped
  }

  /**
   * Map a MongoDB operator to unified AST operator
   */
  mapMongoOp(op: string): ComparisonOp {
    const mapped = MONGO_OP_MAP[op]
    if (!mapped) {
      throw new Error(`Unknown MongoDB operator: ${op}`)
    }
    return mapped
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Create an always-true predicate (used for empty ANDs)
   */
  private alwaysTrue(): PredicateNode {
    return {
      type: 'predicate',
      column: '_',
      op: '=',
      value: { $always: true },
    }
  }

  /**
   * Create an always-false predicate (used for empty ORs)
   */
  private alwaysFalse(): PredicateNode {
    return {
      type: 'predicate',
      column: '_',
      op: '=',
      value: { $always: false },
    }
  }

  /**
   * Flatten nested logical nodes of the same type
   */
  private flattenLogical(op: 'AND' | 'OR', children: QueryNode[]): QueryNode[] {
    const result: QueryNode[] = []

    for (const child of children) {
      if (child.type === 'logical' && (child as LogicalNode).op === op) {
        result.push(...(child as LogicalNode).children)
      } else {
        result.push(child)
      }
    }

    return result
  }
}

// =============================================================================
// Predicate Evaluation Utilities
// =============================================================================

/**
 * Comparison operator type
 */
export type PredicateOp =
  | '=' | '!=' | '<>' | '>' | '>=' | '<' | '<='
  | 'IN' | 'NOT IN'
  | 'IS NULL' | 'IS NOT NULL'
  | 'LIKE' | 'CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH'
  | 'BETWEEN'
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'nin' | 'exists' | 'like' | 'contains' | 'startsWith' | 'isNull' | 'isNotNull'

/**
 * Predicate definition for evaluation
 */
export interface EvalPredicate {
  column: string
  op: PredicateOp
  value: unknown
}

/**
 * Get a nested value from an object using dot notation.
 *
 * @example
 * getNestedValue({ a: { b: 1 } }, 'a.b') // => 1
 * getNestedValue({ a: [{ b: 1 }] }, 'a.0.b') // => 1
 *
 * @param obj The object to extract from
 * @param path Dot-separated path (e.g., 'a.b.c')
 * @returns The value at the path, or undefined if not found
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Compare two values for ordering.
 *
 * Returns:
 * - negative if a < b
 * - 0 if a === b
 * - positive if a > b
 *
 * Handles null/undefined (treated as less than any value), numbers, strings, and dates.
 *
 * @param a First value
 * @param b Second value
 * @returns Comparison result
 */
export function compareValues(a: unknown, b: unknown): number {
  // Handle equal references
  if (a === b) return 0

  // Handle nulls/undefined (null < any value)
  if (a === null || a === undefined) {
    if (b === null || b === undefined) return 0
    return -1
  }
  if (b === null || b === undefined) return 1

  // Handle ObjectId (check for toHexString method)
  if (isObjectIdLike(a) && isObjectIdLike(b)) {
    return (a as { toHexString(): string }).toHexString()
      .localeCompare((b as { toHexString(): string }).toHexString())
  }

  // Handle numbers
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  // Handle strings
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b)
  }

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime()
  }

  // Handle booleans
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1
  }

  // Default to string comparison
  return String(a).localeCompare(String(b))
}

/**
 * Check if a value looks like an ObjectId (has toHexString method)
 */
function isObjectIdLike(value: unknown): value is { toHexString(): string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'toHexString' in value &&
    typeof (value as { toHexString: unknown }).toHexString === 'function'
  )
}

/**
 * Check equality between two values.
 * Handles ObjectIds, arrays (element matching), and dates.
 *
 * @param a First value
 * @param b Second value
 * @returns true if values are equal
 */
export function compareEquality(a: unknown, b: unknown): boolean {
  // Handle ObjectId comparison
  if (isObjectIdLike(a) && isObjectIdLike(b)) {
    return a.toHexString() === b.toHexString()
  }
  if (isObjectIdLike(a) && typeof b === 'string') {
    return a.toHexString() === b
  }
  if (typeof a === 'string' && isObjectIdLike(b)) {
    return a === b.toHexString()
  }

  // Handle arrays - check if value is in array
  if (Array.isArray(a) && !Array.isArray(b)) {
    return a.some((item) => compareEquality(item, b))
  }

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }

  return a === b
}

/**
 * Evaluate a predicate against a document/row.
 *
 * Supports both SQL-style operators (=, !=, >, etc.) and
 * lowercase operators (eq, neq, gt, etc.) for compatibility
 * with different query systems.
 *
 * @param doc The document/row to evaluate
 * @param predicate The predicate to evaluate
 * @returns true if the predicate matches
 */
export function evaluatePredicate(
  doc: Record<string, unknown>,
  predicate: EvalPredicate
): boolean {
  const value = getNestedValue(doc, predicate.column)
  const { op, value: expected } = predicate

  switch (op) {
    // Equality
    case '=':
    case 'eq':
      return compareEquality(value, expected)

    // Inequality
    case '!=':
    case '<>':
    case 'neq':
      return !compareEquality(value, expected)

    // Greater than
    case '>':
    case 'gt':
      return compareValues(value, expected) > 0

    // Greater than or equal
    case '>=':
    case 'gte':
      return compareValues(value, expected) >= 0

    // Less than
    case '<':
    case 'lt':
      return compareValues(value, expected) < 0

    // Less than or equal
    case '<=':
    case 'lte':
      return compareValues(value, expected) <= 0

    // In list
    case 'IN':
    case 'in':
      if (!Array.isArray(expected)) return false
      return expected.some((e) => compareEquality(value, e))

    // Not in list
    case 'NOT IN':
    case 'nin':
      if (!Array.isArray(expected)) return true
      return !expected.some((e) => compareEquality(value, e))

    // Null checks
    case 'IS NULL':
    case 'isNull':
      return value === null || value === undefined

    case 'IS NOT NULL':
    case 'isNotNull':
      return value !== null && value !== undefined

    // Exists check
    case 'exists':
      return expected ? value !== undefined : value === undefined

    // Pattern matching
    case 'LIKE':
    case 'like':
      if (typeof value !== 'string') return false
      // LIKE pattern: % = any chars, _ = single char
      // Convert to regex
      const likePattern = String(expected)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.')
      return new RegExp(`^${likePattern}$`, 'i').test(value)

    case 'CONTAINS':
    case 'contains':
      if (typeof value !== 'string') return false
      return value.toLowerCase().includes(String(expected).toLowerCase())

    case 'STARTS_WITH':
    case 'startsWith':
      if (typeof value !== 'string') return false
      return value.startsWith(String(expected))

    case 'ENDS_WITH':
      if (typeof value !== 'string') return false
      return value.endsWith(String(expected))

    // Between
    case 'BETWEEN':
      if (!Array.isArray(expected) || expected.length !== 2) return false
      const [low, high] = expected
      return compareValues(value, low) >= 0 && compareValues(value, high) <= 0

    default:
      // Unknown operator - default to true for forward compatibility
      return true
  }
}

/**
 * Evaluate multiple predicates with AND logic.
 *
 * @param doc The document/row to evaluate
 * @param predicates Array of predicates
 * @returns true if all predicates match
 */
export function evaluatePredicatesAnd(
  doc: Record<string, unknown>,
  predicates: EvalPredicate[]
): boolean {
  return predicates.every((pred) => evaluatePredicate(doc, pred))
}

/**
 * Evaluate multiple predicates with OR logic.
 *
 * @param doc The document/row to evaluate
 * @param predicates Array of predicates
 * @returns true if any predicate matches
 */
export function evaluatePredicatesOr(
  doc: Record<string, unknown>,
  predicates: EvalPredicate[]
): boolean {
  return predicates.some((pred) => evaluatePredicate(doc, pred))
}
