/**
 * ClickHouse-Compatible SQL Parser
 *
 * Parses a subset of ClickHouse SQL syntax for the analytics engine.
 * Supports SELECT, aggregations, time functions, and ClickHouse-specific syntax.
 */

import type {
  SQLSelectStatement,
  SQLAggregation,
  SQLFunction,
  SQLExpression,
  SQLCondition,
  SQLOrderBy,
  SQLWithFill,
  SQLOperator,
  AggregationType,
} from './types'

// ============================================================================
// TOKENIZER
// ============================================================================

type TokenType =
  | 'KEYWORD'
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'OPERATOR'
  | 'COMMA'
  | 'LPAREN'
  | 'RPAREN'
  | 'STAR'
  | 'DOT'
  | 'EOF'

interface Token {
  type: TokenType
  value: string
  position: number
}

const KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP',
  'BY',
  'HAVING',
  'ORDER',
  'ASC',
  'DESC',
  'LIMIT',
  'OFFSET',
  'AND',
  'OR',
  'NOT',
  'IN',
  'BETWEEN',
  'LIKE',
  'IS',
  'NULL',
  'AS',
  'WITH',
  'FILL',
  'STEP',
  'INTERVAL',
  'OVER',
  'PARTITION',
  'ROWS',
  'RANGE',
  'UNBOUNDED',
  'PRECEDING',
  'FOLLOWING',
  'CURRENT',
  'ROW',
  'TO',
])

const OPERATORS = new Set(['=', '!=', '<>', '<', '<=', '>', '>='])

function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < sql.length) {
    // Skip whitespace
    if (/\s/.test(sql[i]!)) {
      i++
      continue
    }

    // Comments (-- style)
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }

    // String literals
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i]
      const start = i
      i++
      let value = ''
      while (i < sql.length && sql[i] !== quote) {
        if (sql[i] === '\\' && i + 1 < sql.length) {
          value += sql[i + 1]
          i += 2
        } else {
          value += sql[i]
          i++
        }
      }
      i++ // Skip closing quote
      tokens.push({ type: 'STRING', value, position: start })
      continue
    }

    // Numbers (including negative and decimals)
    if (/[0-9]/.test(sql[i]!) || (sql[i] === '-' && /[0-9]/.test(sql[i + 1]!))) {
      const start = i
      if (sql[i] === '-') i++
      while (i < sql.length && /[0-9.]/.test(sql[i]!)) i++
      tokens.push({ type: 'NUMBER', value: sql.slice(start, i), position: start })
      continue
    }

    // Multi-char operators
    if (sql.slice(i, i + 2) === '<=' || sql.slice(i, i + 2) === '>=' || sql.slice(i, i + 2) === '!=' || sql.slice(i, i + 2) === '<>') {
      tokens.push({ type: 'OPERATOR', value: sql.slice(i, i + 2), position: i })
      i += 2
      continue
    }

    // Single-char operators
    if (OPERATORS.has(sql[i]!)) {
      tokens.push({ type: 'OPERATOR', value: sql[i]!, position: i })
      i++
      continue
    }

    // Parentheses
    if (sql[i] === '(') {
      tokens.push({ type: 'LPAREN', value: '(', position: i })
      i++
      continue
    }
    if (sql[i] === ')') {
      tokens.push({ type: 'RPAREN', value: ')', position: i })
      i++
      continue
    }

    // Comma
    if (sql[i] === ',') {
      tokens.push({ type: 'COMMA', value: ',', position: i })
      i++
      continue
    }

    // Star
    if (sql[i] === '*') {
      tokens.push({ type: 'STAR', value: '*', position: i })
      i++
      continue
    }

    // Dot
    if (sql[i] === '.') {
      tokens.push({ type: 'DOT', value: '.', position: i })
      i++
      continue
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(sql[i]!)) {
      const start = i
      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i]!)) i++
      const value = sql.slice(start, i)
      const upper = value.toUpperCase()
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'KEYWORD', value: upper, position: start })
      } else {
        tokens.push({ type: 'IDENTIFIER', value, position: start })
      }
      continue
    }

    // Unknown character - skip
    i++
  }

  tokens.push({ type: 'EOF', value: '', position: i })
  return tokens
}

// ============================================================================
// PARSER
// ============================================================================

class SQLParser {
  private tokens: Token[]
  private pos = 0

  constructor(sql: string) {
    this.tokens = tokenize(sql)
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '', position: -1 }
  }

  private peek(offset = 1): Token {
    return this.tokens[this.pos + offset] || { type: 'EOF', value: '', position: -1 }
  }

  private advance(): Token {
    const token = this.current()
    this.pos++
    return token
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current()
    if (token.type !== type || (value !== undefined && token.value.toUpperCase() !== value.toUpperCase())) {
      throw new Error(`Expected ${value || type} at position ${token.position}, got ${token.value}`)
    }
    return this.advance()
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.current()
    return token.type === type && (value === undefined || token.value.toUpperCase() === value.toUpperCase())
  }

  private matchKeyword(keyword: string): boolean {
    return this.match('KEYWORD', keyword)
  }

  parse(): SQLSelectStatement {
    if (!this.matchKeyword('SELECT')) {
      throw new Error(`Expected SELECT at position ${this.current().position}`)
    }
    return this.parseSelect()
  }

  private parseSelect(): SQLSelectStatement {
    this.expect('KEYWORD', 'SELECT')

    const columns = this.parseSelectList()

    // FROM clause (optional for function-only queries like SELECT now())
    let from: string | SQLSelectStatement = '__dual__' // Virtual table for no-table queries
    if (this.matchKeyword('FROM')) {
      this.advance()
      if (this.match('LPAREN')) {
        // Subquery
        this.advance()
        from = this.parseSelect()
        this.expect('RPAREN')
      } else {
        from = this.expect('IDENTIFIER').value
      }
    }

    // WHERE clause
    let where: SQLExpression | undefined
    if (this.matchKeyword('WHERE')) {
      this.advance()
      where = this.parseExpression()
    }

    // GROUP BY clause
    let groupBy: string[] | undefined
    if (this.matchKeyword('GROUP')) {
      this.advance()
      this.expect('KEYWORD', 'BY')
      groupBy = this.parseIdentifierList()
    }

    // HAVING clause
    let having: SQLExpression | undefined
    if (this.matchKeyword('HAVING')) {
      this.advance()
      having = this.parseExpression()
    }

    // ORDER BY clause
    let orderBy: SQLOrderBy[] | undefined
    if (this.matchKeyword('ORDER')) {
      this.advance()
      this.expect('KEYWORD', 'BY')
      orderBy = this.parseOrderByList()
    }

    // WITH FILL clause
    let withFill: SQLWithFill | undefined
    if (this.matchKeyword('WITH')) {
      this.advance()
      if (this.matchKeyword('FILL')) {
        this.advance()
        withFill = this.parseWithFill()
      }
    }

    // LIMIT clause
    let limit: number | undefined
    if (this.matchKeyword('LIMIT')) {
      this.advance()
      limit = Number(this.expect('NUMBER').value)
    }

    // OFFSET clause
    let offset: number | undefined
    if (this.matchKeyword('OFFSET')) {
      this.advance()
      offset = Number(this.expect('NUMBER').value)
    }

    return {
      type: 'select',
      columns,
      from,
      where,
      groupBy,
      having,
      orderBy,
      limit,
      offset,
      withFill,
    }
  }

  private parseSelectList(): (string | SQLAggregation | SQLFunction)[] {
    const columns: (string | SQLAggregation | SQLFunction)[] = []

    do {
      if (this.match('COMMA')) {
        this.advance()
      }

      if (this.match('STAR')) {
        this.advance()
        columns.push('*')
        continue
      }

      const item = this.parseSelectItem()
      columns.push(item)
    } while (this.match('COMMA'))

    return columns
  }

  private parseSelectItem(): string | SQLAggregation | SQLFunction {
    const token = this.current()

    // Check if it's a function call (aggregation or regular function)
    if (token.type === 'IDENTIFIER' && this.peek().type === 'LPAREN') {
      const funcName = token.value.toLowerCase()
      this.advance() // consume function name
      this.advance() // consume (

      // Check for quantile(p)(column) syntax
      if (funcName === 'quantile' && this.match('NUMBER')) {
        const p = Number(this.advance().value)
        this.expect('RPAREN')
        this.expect('LPAREN')
        const column = this.expect('IDENTIFIER').value
        this.expect('RPAREN')
        const alias = this.parseAlias()
        return {
          type: 'quantile' as AggregationType,
          column,
          alias: alias || `quantile_${p}_${column}`,
          args: [p],
        }
      }

      // Parse function arguments
      const args: (string | number | SQLFunction)[] = []
      if (!this.match('RPAREN')) {
        do {
          if (this.match('COMMA')) this.advance()

          if (this.match('NUMBER')) {
            args.push(Number(this.advance().value))
          } else if (this.match('STRING')) {
            args.push(this.advance().value)
          } else if (this.match('IDENTIFIER')) {
            // Check for nested function
            if (this.peek().type === 'LPAREN') {
              const nestedFunc = this.parseSelectItem()
              if (typeof nestedFunc !== 'string') {
                args.push(nestedFunc as SQLFunction)
              }
            } else {
              args.push(this.advance().value)
            }
          }
        } while (this.match('COMMA'))
      }
      this.expect('RPAREN')

      const alias = this.parseAlias()

      // Check for OVER clause (window functions)
      if (this.matchKeyword('OVER')) {
        // For now, return as regular function - window function handling to be added
        this.advance()
        this.expect('LPAREN')
        // Skip window spec for now
        let depth = 1
        while (depth > 0) {
          if (this.match('LPAREN')) depth++
          if (this.match('RPAREN')) depth--
          this.advance()
        }
      }

      // Check if it's a known aggregation
      const aggTypes: Record<string, AggregationType> = {
        count: 'count',
        sum: 'sum',
        avg: 'avg',
        min: 'min',
        max: 'max',
        uniq: 'uniq',
      }

      if (aggTypes[funcName]) {
        // Check if the argument is a nested function
        const firstArg = args[0]
        if (typeof firstArg === 'object' && firstArg !== null && 'name' in firstArg) {
          // Nested function like avg(JSONExtractFloat(metadata, 'latency'))
          return {
            type: aggTypes[funcName],
            columnFunc: firstArg as SQLFunction,
            alias: alias || `${funcName}_func`,
          }
        }
        return {
          type: aggTypes[funcName],
          column: firstArg as string | undefined,
          alias: alias || `${funcName}_${firstArg || 'all'}`,
        }
      }

      // Regular function
      return {
        name: funcName,
        args: args as (string | number | SQLFunction)[],
        alias,
      }
    }

    // Regular column
    const column = this.expect('IDENTIFIER').value
    const alias = this.parseAlias()
    return alias ? { name: column, args: [], alias } : column
  }

  private parseAlias(): string | undefined {
    if (this.matchKeyword('AS')) {
      this.advance()
      return this.expect('IDENTIFIER').value
    }
    // Check for implicit alias (identifier without AS)
    if (this.match('IDENTIFIER') && !this.matchKeyword('FROM') && !this.matchKeyword('WHERE')) {
      return this.advance().value
    }
    return undefined
  }

  private parseExpression(): SQLExpression {
    return this.parseOrExpression()
  }

  private parseOrExpression(): SQLExpression {
    let left = this.parseAndExpression()

    while (this.matchKeyword('OR')) {
      this.advance()
      const right = this.parseAndExpression()
      left = {
        type: 'logical',
        operator: 'OR',
        left,
        right,
      }
    }

    return left
  }

  private parseAndExpression(): SQLExpression {
    let left = this.parsePrimaryExpression()

    while (this.matchKeyword('AND')) {
      this.advance()
      const right = this.parsePrimaryExpression()
      left = {
        type: 'logical',
        operator: 'AND',
        left,
        right,
      }
    }

    return left
  }

  private parsePrimaryExpression(): SQLExpression {
    // Handle parentheses
    if (this.match('LPAREN')) {
      this.advance()
      // Check if it's a subquery
      if (this.matchKeyword('SELECT')) {
        const subquery = this.parseSelect()
        this.expect('RPAREN')
        return {
          type: 'function',
          function: {
            name: 'subquery',
            args: [subquery as unknown as string],
          },
        }
      }
      const expr = this.parseExpression()
      this.expect('RPAREN')
      return expr
    }

    // Parse condition
    return this.parseCondition()
  }

  private parseCondition(): SQLExpression {
    // Handle function calls in conditions
    let column: string
    if (this.match('IDENTIFIER') && this.peek().type === 'LPAREN') {
      const func = this.parseSelectItem()
      if (typeof func === 'string') {
        column = func
      } else {
        // Function call - need to serialize for comparison
        column = this.serializeFunction(func)
      }
    } else {
      column = this.expect('IDENTIFIER').value
    }

    // IS NULL / IS NOT NULL
    if (this.matchKeyword('IS')) {
      this.advance()
      const not = this.matchKeyword('NOT')
      if (not) this.advance()
      this.expect('KEYWORD', 'NULL')
      return {
        type: 'condition',
        condition: {
          column,
          operator: not ? 'IS NOT NULL' : 'IS NULL',
          value: null,
        },
      }
    }

    // IN expression
    if (this.matchKeyword('IN')) {
      this.advance()
      this.expect('LPAREN')
      const values: unknown[] = []
      do {
        if (this.match('COMMA')) this.advance()
        if (this.match('STRING')) {
          values.push(this.advance().value)
        } else if (this.match('NUMBER')) {
          values.push(Number(this.advance().value))
        }
      } while (this.match('COMMA'))
      this.expect('RPAREN')
      return {
        type: 'condition',
        condition: {
          column,
          operator: 'IN',
          value: values,
          values,
        },
      }
    }

    // NOT IN expression
    if (this.matchKeyword('NOT')) {
      this.advance()
      if (this.matchKeyword('IN')) {
        this.advance()
        this.expect('LPAREN')
        const values: unknown[] = []
        do {
          if (this.match('COMMA')) this.advance()
          if (this.match('STRING')) {
            values.push(this.advance().value)
          } else if (this.match('NUMBER')) {
            values.push(Number(this.advance().value))
          }
        } while (this.match('COMMA'))
        this.expect('RPAREN')
        return {
          type: 'condition',
          condition: {
            column,
            operator: 'NOT IN',
            value: values,
            values,
          },
        }
      }
    }

    // BETWEEN expression
    if (this.matchKeyword('BETWEEN')) {
      this.advance()
      const low = this.parseValue()
      this.expect('KEYWORD', 'AND')
      const high = this.parseValue()
      return {
        type: 'condition',
        condition: {
          column,
          operator: 'BETWEEN',
          value: [low, high],
          values: [low, high],
        },
      }
    }

    // LIKE expression
    if (this.matchKeyword('LIKE')) {
      this.advance()
      const pattern = this.expect('STRING').value
      return {
        type: 'condition',
        condition: {
          column,
          operator: 'LIKE',
          value: pattern,
        },
      }
    }

    // Regular comparison
    const op = this.expect('OPERATOR').value as SQLOperator
    const value = this.parseValue()

    return {
      type: 'condition',
      condition: {
        column,
        operator: op,
        value,
      },
    }
  }

  private serializeFunction(func: SQLAggregation | SQLFunction): string {
    if ('type' in func) {
      return `${func.type}(${func.column || ''})`
    }
    return `${func.name}(${func.args.join(', ')})`
  }

  private parseValue(): unknown {
    // Handle function calls (like toDateTime, now, etc.)
    if (this.match('IDENTIFIER') && this.peek().type === 'LPAREN') {
      const funcName = this.advance().value.toLowerCase()
      this.advance() // (
      const args: unknown[] = []
      if (!this.match('RPAREN')) {
        do {
          if (this.match('COMMA')) this.advance()
          args.push(this.parseValue())
        } while (this.match('COMMA'))
      }
      this.expect('RPAREN')

      // Handle INTERVAL
      if (this.matchKeyword('INTERVAL')) {
        // This is an expression like now() - INTERVAL 1 DAY
        // Just return the function for now
      }

      return { function: funcName, args }
    }

    if (this.match('STRING')) {
      return this.advance().value
    }
    if (this.match('NUMBER')) {
      return Number(this.advance().value)
    }
    if (this.matchKeyword('NULL')) {
      this.advance()
      return null
    }
    // Column reference
    if (this.match('IDENTIFIER')) {
      return { column: this.advance().value }
    }

    throw new Error(`Unexpected token: ${this.current().value}`)
  }

  private parseIdentifierList(): string[] {
    const list: string[] = []
    do {
      if (this.match('COMMA')) this.advance()
      list.push(this.expect('IDENTIFIER').value)
    } while (this.match('COMMA'))
    return list
  }

  private parseOrderByList(): SQLOrderBy[] {
    const list: SQLOrderBy[] = []
    do {
      if (this.match('COMMA')) this.advance()
      const column = this.expect('IDENTIFIER').value
      let direction: 'ASC' | 'DESC' = 'ASC'
      if (this.matchKeyword('ASC')) {
        this.advance()
      } else if (this.matchKeyword('DESC')) {
        this.advance()
        direction = 'DESC'
      }
      list.push({ column, direction })
    } while (this.match('COMMA'))
    return list
  }

  private parseWithFill(): SQLWithFill {
    // WITH FILL FROM expr TO expr STEP INTERVAL n unit
    let from: Date | string = new Date()
    let to: Date | string = new Date()
    let step = '1 HOUR'

    if (this.matchKeyword('FROM')) {
      this.advance()
      const val = this.parseValue()
      from = val as Date | string
    }

    if (this.matchKeyword('TO')) {
      this.advance()
      const val = this.parseValue()
      to = val as Date | string
    }

    if (this.matchKeyword('STEP')) {
      this.advance()
      if (this.matchKeyword('INTERVAL')) {
        this.advance()
        const n = this.expect('NUMBER').value
        const unit = this.expect('IDENTIFIER').value
        step = `${n} ${unit}`
      }
    }

    return { from, to, step }
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function parseSQL(sql: string): SQLSelectStatement {
  const parser = new SQLParser(sql.trim())
  return parser.parse()
}
