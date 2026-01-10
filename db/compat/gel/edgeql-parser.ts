/**
 * EdgeQL Parser Prototype - Hand-Rolled Recursive Descent
 *
 * This is a PROTOTYPE parser for evaluating the hand-rolled approach.
 * It implements a minimal subset of EdgeQL for the spike evaluation.
 *
 * Supported syntax:
 * - select User { name }
 * - select User { name, posts: { title } } filter .active = true
 * - insert User { name := 'Alice' }
 *
 * @see dotdo-56wx9 - SPIKE: EdgeQL Parser Approach Evaluation
 */

// ============================================================================
// TOKENIZER
// ============================================================================

export type TokenType =
  | 'SELECT'
  | 'INSERT'
  | 'FILTER'
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'DOT'
  | 'COLON'
  | 'ASSIGN'      // :=
  | 'EQUALS'      // =
  | 'COMMA'
  | 'LBRACE'
  | 'RBRACE'
  | 'TRUE'
  | 'FALSE'
  | 'EOF'

export interface Token {
  type: TokenType
  value: string
  position: number
  line: number
  column: number
}

const KEYWORDS: Record<string, TokenType> = {
  select: 'SELECT',
  insert: 'INSERT',
  filter: 'FILTER',
  true: 'TRUE',
  false: 'FALSE',
}

/**
 * Tokenize EdgeQL source code into tokens
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let pos = 0
  let line = 1
  let column = 1

  while (pos < source.length) {
    const char = source[pos]

    // Skip whitespace
    if (/\s/.test(char)) {
      if (char === '\n') {
        line++
        column = 1
      } else {
        column++
      }
      pos++
      continue
    }

    // Skip comments (# style)
    if (char === '#') {
      while (pos < source.length && source[pos] !== '\n') {
        pos++
      }
      continue
    }

    const startPos = pos
    const startColumn = column

    // Assignment operator :=
    if (char === ':' && source[pos + 1] === '=') {
      tokens.push({
        type: 'ASSIGN',
        value: ':=',
        position: startPos,
        line,
        column: startColumn,
      })
      pos += 2
      column += 2
      continue
    }

    // Single character tokens
    if (char === '.') {
      tokens.push({ type: 'DOT', value: '.', position: startPos, line, column: startColumn })
      pos++
      column++
      continue
    }

    if (char === ':') {
      tokens.push({ type: 'COLON', value: ':', position: startPos, line, column: startColumn })
      pos++
      column++
      continue
    }

    if (char === '=') {
      tokens.push({ type: 'EQUALS', value: '=', position: startPos, line, column: startColumn })
      pos++
      column++
      continue
    }

    if (char === ',') {
      tokens.push({ type: 'COMMA', value: ',', position: startPos, line, column: startColumn })
      pos++
      column++
      continue
    }

    if (char === '{') {
      tokens.push({ type: 'LBRACE', value: '{', position: startPos, line, column: startColumn })
      pos++
      column++
      continue
    }

    if (char === '}') {
      tokens.push({ type: 'RBRACE', value: '}', position: startPos, line, column: startColumn })
      pos++
      column++
      continue
    }

    // String literals (single or double quoted)
    if (char === "'" || char === '"') {
      const quote = char
      pos++
      column++
      let value = ''

      while (pos < source.length && source[pos] !== quote) {
        if (source[pos] === '\\' && pos + 1 < source.length) {
          // Handle escape sequences
          pos++
          column++
          const escaped = source[pos]
          switch (escaped) {
            case 'n':
              value += '\n'
              break
            case 't':
              value += '\t'
              break
            case '\\':
              value += '\\'
              break
            case "'":
              value += "'"
              break
            case '"':
              value += '"'
              break
            default:
              value += escaped
          }
        } else {
          value += source[pos]
        }
        pos++
        column++
      }

      if (pos >= source.length) {
        throw new SyntaxError(`Unterminated string at line ${line}, column ${startColumn}`)
      }

      pos++ // Skip closing quote
      column++

      tokens.push({
        type: 'STRING',
        value,
        position: startPos,
        line,
        column: startColumn,
      })
      continue
    }

    // Numbers
    if (/[0-9]/.test(char)) {
      let value = ''
      while (pos < source.length && /[0-9.]/.test(source[pos])) {
        value += source[pos]
        pos++
        column++
      }
      tokens.push({
        type: 'NUMBER',
        value,
        position: startPos,
        line,
        column: startColumn,
      })
      continue
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      let value = ''
      while (pos < source.length && /[a-zA-Z0-9_]/.test(source[pos])) {
        value += source[pos]
        pos++
        column++
      }

      const keyword = KEYWORDS[value.toLowerCase()]
      tokens.push({
        type: keyword || 'IDENTIFIER',
        value,
        position: startPos,
        line,
        column: startColumn,
      })
      continue
    }

    throw new SyntaxError(
      `Unexpected character '${char}' at line ${line}, column ${column}`
    )
  }

  tokens.push({
    type: 'EOF',
    value: '',
    position: pos,
    line,
    column,
  })

  return tokens
}

// ============================================================================
// AST NODES
// ============================================================================

export interface SelectStatement {
  type: 'SelectStatement'
  target: string
  shape: Shape
  filter?: FilterExpression
}

export interface InsertStatement {
  type: 'InsertStatement'
  target: string
  data: InsertData
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
}

export interface InsertData {
  type: 'InsertData'
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
  path: string[]
}

export interface BinaryExpression {
  type: 'BinaryExpression'
  operator: '='
  left: Expression
  right: Expression
}

export interface FilterExpression {
  type: 'FilterExpression'
  condition: Expression
}

export type Statement = SelectStatement | InsertStatement

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

  private match(type: TokenType): boolean {
    if (this.current().type === type) {
      this.advance()
      return true
    }
    return false
  }

  parse(): Statement {
    const token = this.current()

    if (token.type === 'SELECT') {
      return this.parseSelect()
    }

    if (token.type === 'INSERT') {
      return this.parseInsert()
    }

    throw new SyntaxError(
      `Expected SELECT or INSERT at line ${token.line}, column ${token.column}`
    )
  }

  private parseSelect(): SelectStatement {
    this.expect('SELECT')

    const targetToken = this.expect('IDENTIFIER')
    const target = targetToken.value

    const shape = this.parseShape()

    let filter: FilterExpression | undefined
    if (this.current().type === 'FILTER') {
      filter = this.parseFilter()
    }

    return {
      type: 'SelectStatement',
      target,
      shape,
      filter,
    }
  }

  private parseInsert(): InsertStatement {
    this.expect('INSERT')

    const targetToken = this.expect('IDENTIFIER')
    const target = targetToken.value

    const data = this.parseInsertData()

    return {
      type: 'InsertStatement',
      target,
      data,
    }
  }

  private parseShape(): Shape {
    this.expect('LBRACE')

    const fields: ShapeField[] = []

    while (this.current().type !== 'RBRACE' && this.current().type !== 'EOF') {
      fields.push(this.parseShapeField())

      if (this.current().type === 'COMMA') {
        this.advance()
      } else {
        break
      }
    }

    this.expect('RBRACE')

    return {
      type: 'Shape',
      fields,
    }
  }

  private parseShapeField(): ShapeField {
    const nameToken = this.expect('IDENTIFIER')
    const name = nameToken.value

    let alias: string | undefined
    let shape: Shape | undefined

    // Check for alias or nested shape
    if (this.current().type === 'COLON') {
      this.advance()

      // Could be alias or nested shape
      if (this.current().type === 'LBRACE') {
        shape = this.parseShape()
      } else {
        // This is an alias syntax (alias: field)
        // For our subset, we support "field: { nested }" pattern
        throw new SyntaxError(
          `Expected '{' after ':' in shape field at line ${this.current().line}`
        )
      }
    }

    return {
      type: 'ShapeField',
      name,
      alias,
      shape,
    }
  }

  private parseInsertData(): InsertData {
    this.expect('LBRACE')

    const assignments: Assignment[] = []

    while (this.current().type !== 'RBRACE' && this.current().type !== 'EOF') {
      assignments.push(this.parseAssignment())

      if (this.current().type === 'COMMA') {
        this.advance()
      } else {
        break
      }
    }

    this.expect('RBRACE')

    return {
      type: 'InsertData',
      assignments,
    }
  }

  private parseAssignment(): Assignment {
    const nameToken = this.expect('IDENTIFIER')
    const name = nameToken.value

    this.expect('ASSIGN')

    const value = this.parseExpression()

    return {
      type: 'Assignment',
      name,
      value,
    }
  }

  private parseFilter(): FilterExpression {
    this.expect('FILTER')

    const condition = this.parseExpression()

    return {
      type: 'FilterExpression',
      condition,
    }
  }

  private parseExpression(): Expression {
    let left = this.parsePrimary()

    // Handle binary expressions (currently only =)
    if (this.current().type === 'EQUALS') {
      this.advance()
      const right = this.parsePrimary()
      left = {
        type: 'BinaryExpression',
        operator: '=',
        left,
        right,
      }
    }

    return left
  }

  private parsePrimary(): Expression {
    const token = this.current()

    if (token.type === 'STRING') {
      this.advance()
      return {
        type: 'StringLiteral',
        value: token.value,
      }
    }

    if (token.type === 'NUMBER') {
      this.advance()
      return {
        type: 'NumberLiteral',
        value: parseFloat(token.value),
      }
    }

    if (token.type === 'TRUE') {
      this.advance()
      return {
        type: 'BooleanLiteral',
        value: true,
      }
    }

    if (token.type === 'FALSE') {
      this.advance()
      return {
        type: 'BooleanLiteral',
        value: false,
      }
    }

    // Path expression: .field or .field.subfield
    if (token.type === 'DOT') {
      return this.parsePathExpression()
    }

    if (token.type === 'IDENTIFIER') {
      this.advance()
      const path = [token.value]

      while (this.current().type === 'DOT') {
        this.advance()
        const next = this.expect('IDENTIFIER')
        path.push(next.value)
      }

      return {
        type: 'PathExpression',
        path,
      }
    }

    throw new SyntaxError(
      `Unexpected token ${token.type} at line ${token.line}, column ${token.column}`
    )
  }

  private parsePathExpression(): PathExpression {
    const path: string[] = []

    while (this.current().type === 'DOT') {
      this.advance()
      const nameToken = this.expect('IDENTIFIER')
      path.push(nameToken.value)
    }

    return {
      type: 'PathExpression',
      path,
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
      return expr.path.join('.')

    case 'BinaryExpression':
      return `${compileExpression(expr.left)} = ${compileExpression(expr.right)}`

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
