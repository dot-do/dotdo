/**
 * @dotdo/db/compat/sql/shared - SQL Parser
 *
 * Shared SQL parsing utilities used by all SQL compat layers.
 * Extracts common parsing logic that was duplicated across postgres, mysql, turso, etc.
 */

import type {
  SQLValue,
  StorageValue,
  DialectConfig,
  SQLCommand,
} from './types'
import { SQLParseError } from './types'

// ============================================================================
// VALUE PARSING
// ============================================================================

/**
 * Parse a single SQL value token into a typed value
 */
export function parseValueToken(token: string): StorageValue {
  const trimmed = token.trim()

  // Handle NULL
  if (trimmed.toUpperCase() === 'NULL') {
    return null
  }

  // Handle DEFAULT (returns null, caller handles)
  if (trimmed.toUpperCase() === 'DEFAULT') {
    return null
  }

  // Handle booleans
  if (trimmed.toUpperCase() === 'TRUE') {
    return 1
  }
  if (trimmed.toUpperCase() === 'FALSE') {
    return 0
  }

  // Handle quoted strings
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }

  // Handle integers
  if (/^-?\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10)
  }

  // Handle floats
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return parseFloat(trimmed)
  }

  // Return as string
  return trimmed
}

/**
 * Normalize an input value to storage format
 */
export function normalizeValue(value: SQLValue, dialect: DialectConfig): StorageValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'boolean') {
    // For PostgreSQL, preserve native boolean; for MySQL/SQLite, convert to 0/1
    return dialect.booleanType === 'integer' ? (value ? 1 : 0) : value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Uint8Array) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return value
  }

  return String(value)
}

/**
 * Resolve a value part (parameter or literal) to a storage value
 */
export function resolveValuePart(
  valuePart: string,
  params: SQLValue[],
  paramIndex: { current: number },
  dialect: DialectConfig
): StorageValue {
  const trimmed = valuePart.trim()

  // Handle PostgreSQL-style parameters ($1, $2, ...)
  const pgParamMatch = trimmed.match(/^\$(\d+)$/)
  if (pgParamMatch) {
    const index = parseInt(pgParamMatch[1], 10) - 1
    return normalizeValue(params[index], dialect)
  }

  // Handle MySQL-style parameters (?)
  if (trimmed === '?') {
    return normalizeValue(params[paramIndex.current++], dialect)
  }

  // Handle boolean literals with dialect awareness
  const upperTrimmed = trimmed.toUpperCase()
  if (upperTrimmed === 'TRUE') {
    return dialect.booleanType === 'integer' ? 1 : true
  }
  if (upperTrimmed === 'FALSE') {
    return dialect.booleanType === 'integer' ? 0 : false
  }

  // Parse as literal (for non-boolean values)
  return parseValueToken(trimmed)
}

// ============================================================================
// STRING SPLITTING
// ============================================================================

/**
 * Split a comma-separated list respecting quotes and parentheses
 */
export function splitValues(valuesPart: string): string[] {
  const parts: string[] = []
  let current = ''
  let inString = false
  let stringChar = ''
  let depth = 0

  for (const char of valuesPart) {
    if (!inString && (char === "'" || char === '"')) {
      inString = true
      stringChar = char
      current += char
    } else if (inString && char === stringChar) {
      inString = false
      current += char
    } else if (!inString && char === '(') {
      depth++
      current += char
    } else if (!inString && char === ')') {
      depth--
      current += char
    } else if (!inString && depth === 0 && char === ',') {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }

  if (current.length > 0) {
    parts.push(current)
  }

  return parts
}

/**
 * Split column definitions (for CREATE TABLE)
 */
export function splitColumnDefs(defs: string): string[] {
  const result: string[] = []
  let current = ''
  let depth = 0

  for (const char of defs) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) {
    result.push(current.trim())
  }
  return result
}

/**
 * Parse multiple value sets for multi-row INSERT: (1, 2), (3, 4)
 */
export function parseMultipleValueSets(
  valuesPart: string,
  params: SQLValue[],
  dialect: DialectConfig
): StorageValue[][] {
  const results: StorageValue[][] = []
  let currentSet: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  const paramIndex = { current: 0 }

  for (const char of valuesPart) {
    if (!inString && (char === "'" || char === '"')) {
      inString = true
      stringChar = char
      current += char
    } else if (inString && char === stringChar) {
      inString = false
      current += char
    } else if (!inString && char === '(') {
      if (depth === 0) {
        current = ''
      } else {
        current += char
      }
      depth++
    } else if (!inString && char === ')') {
      depth--
      if (depth === 0) {
        // End of value set
        currentSet.push(current)
        // Parse the values
        const values: StorageValue[] = []
        for (const part of currentSet) {
          const trimmed = part.trim()
          if (trimmed === '') continue
          values.push(resolveValuePart(trimmed, params, paramIndex, dialect))
        }
        results.push(values)
        currentSet = []
        current = ''
      } else {
        current += char
      }
    } else if (!inString && depth === 1 && char === ',') {
      currentSet.push(current)
      current = ''
    } else if (!inString && depth === 0 && char === ',') {
      // Between value sets, skip
    } else {
      current += char
    }
  }

  return results
}

// ============================================================================
// SQL COMMAND DETECTION
// ============================================================================

/**
 * Detect the SQL command type from a query
 */
export function detectCommand(sql: string): SQLCommand {
  const normalized = sql.trim().toUpperCase()

  if (normalized.startsWith('SELECT')) return 'SELECT'
  if (normalized.startsWith('INSERT')) return 'INSERT'
  if (normalized.startsWith('UPDATE')) return 'UPDATE'
  if (normalized.startsWith('DELETE')) return 'DELETE'
  if (normalized.startsWith('CREATE TABLE')) return 'CREATE TABLE'
  if (normalized.startsWith('CREATE INDEX') || normalized.startsWith('CREATE UNIQUE INDEX')) return 'CREATE INDEX'
  if (normalized.startsWith('DROP TABLE')) return 'DROP TABLE'
  if (normalized.startsWith('BEGIN') || normalized === 'START TRANSACTION') return 'BEGIN'
  if (normalized.startsWith('COMMIT')) return 'COMMIT'
  if (normalized.startsWith('ROLLBACK')) return 'ROLLBACK'
  if (normalized.startsWith('SET ')) return 'SET'
  if (normalized.startsWith('SHOW ')) return 'SHOW'
  if (normalized.startsWith('SAVEPOINT')) return 'SAVEPOINT'
  if (normalized.startsWith('RELEASE')) return 'RELEASE'

  throw new SQLParseError(`Unsupported SQL command: ${sql}`)
}

// ============================================================================
// IDENTIFIER PARSING
// ============================================================================

/**
 * Parse a table name from SQL, handling quotes
 */
export function parseTableName(match: RegExpMatchArray): string {
  // Pattern typically captures: (?:"([^"]+)"|`([^`]+)`|(\w+))
  // Returns the first non-undefined capture group
  for (let i = 1; i < match.length; i++) {
    if (match[i]) {
      return match[i].toLowerCase()
    }
  }
  throw new SQLParseError('Could not parse table name')
}

/**
 * Parse column list from SQL
 */
export function parseColumnList(columnsPart: string): string[] {
  if (columnsPart.trim() === '*') {
    return ['*']
  }

  return columnsPart.split(',').map((c) => {
    const col = c.trim()
    // Handle alias.column
    if (col.includes('.')) {
      const parts = col.split('.')
      return parts[parts.length - 1].replace(/["'`]/g, '').toLowerCase()
    }
    // Handle column AS alias - take the alias
    const asMatch = col.match(/(.+?)\s+AS\s+["'`]?(\w+)["'`]?/i)
    if (asMatch) {
      return asMatch[2].toLowerCase()
    }
    return col.replace(/["'`]/g, '').toLowerCase()
  })
}

/**
 * Extract actual column name from expression (handling alias.column)
 */
export function extractColumnName(expr: string): string {
  const trimmed = expr.trim()
  if (trimmed.includes('.')) {
    const parts = trimmed.split('.')
    return parts[parts.length - 1].replace(/["'`]/g, '').toLowerCase()
  }
  return trimmed.replace(/["'`]/g, '').toLowerCase()
}

// ============================================================================
// DIALECT TRANSLATION
// ============================================================================

/**
 * Translate SQL from one dialect to normalized form (SQLite-compatible)
 */
export function translateDialect(sql: string, dialect: DialectConfig): string {
  let result = sql

  // Replace dialect-specific identifier quotes with standard double quotes
  if (dialect.identifierQuote === '`') {
    result = result.replace(/`([^`]+)`/g, '"$1"')
  }

  // Apply type translations if defined
  if (dialect.typeTranslations) {
    for (const [pattern, replacement] of dialect.typeTranslations) {
      result = result.replace(pattern, replacement)
    }
  }

  return result
}

// ============================================================================
// WHERE CLAUSE PARSING
// ============================================================================

/**
 * Condition types for WHERE clause
 */
export type ConditionOperator = '=' | '!=' | '<>' | '>' | '<' | '>=' | '<=' | 'IS NULL' | 'IS NOT NULL' | 'LIKE' | 'ILIKE' | 'IN'

export interface ParsedCondition {
  column: string
  operator: ConditionOperator
  value?: StorageValue
  values?: StorageValue[]  // For IN clause
}

/**
 * Parse a single WHERE condition
 */
export function parseCondition(
  condition: string,
  params: SQLValue[],
  paramIndex: { current: number },
  dialect: DialectConfig
): ParsedCondition | null {
  // Handle IS NULL
  const isNullMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|`([^`]+)`|(\w+))\s+IS\s+NULL/i)
  if (isNullMatch) {
    return {
      column: extractColumnName(isNullMatch[1] || isNullMatch[2] || isNullMatch[3]),
      operator: 'IS NULL',
    }
  }

  // Handle IS NOT NULL
  const isNotNullMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|`([^`]+)`|(\w+))\s+IS\s+NOT\s+NULL/i)
  if (isNotNullMatch) {
    return {
      column: extractColumnName(isNotNullMatch[1] || isNotNullMatch[2] || isNotNullMatch[3]),
      operator: 'IS NOT NULL',
    }
  }

  // Handle ILIKE (PostgreSQL case-insensitive)
  const ilikeMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|`([^`]+)`|(\w+))\s+ILIKE\s+(.+)/i)
  if (ilikeMatch) {
    const value = resolveValuePart(ilikeMatch[4], params, paramIndex, dialect)
    return {
      column: extractColumnName(ilikeMatch[1] || ilikeMatch[2] || ilikeMatch[3]),
      operator: 'ILIKE',
      value,
    }
  }

  // Handle LIKE
  const likeMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|`([^`]+)`|(\w+))\s+LIKE\s+(.+)/i)
  if (likeMatch) {
    const value = resolveValuePart(likeMatch[4], params, paramIndex, dialect)
    return {
      column: extractColumnName(likeMatch[1] || likeMatch[2] || likeMatch[3]),
      operator: 'LIKE',
      value,
    }
  }

  // Handle IN clause
  const inMatch = condition.match(/(?:[\w.]+\.)?(?:"([^"]+)"|`([^`]+)`|(\w+))\s+IN\s*\(([^)]+)\)/i)
  if (inMatch) {
    const valuesPart = inMatch[4]
    const values = valuesPart.split(',').map((v) =>
      resolveValuePart(v.trim(), params, paramIndex, dialect)
    )
    return {
      column: extractColumnName(inMatch[1] || inMatch[2] || inMatch[3]),
      operator: 'IN',
      values,
    }
  }

  // Handle comparison operators (order matters: >= <= != <> before > < =)
  const compMatch = condition.match(
    /(?:[\w.]+\.)?(?:"([^"]+)"|`([^`]+)`|(\w+))\s*(>=|<=|!=|<>|>|<|=)\s*(.+)/i
  )
  if (compMatch) {
    const operator = compMatch[4] as ConditionOperator
    const value = resolveValuePart(compMatch[5], params, paramIndex, dialect)
    return {
      column: extractColumnName(compMatch[1] || compMatch[2] || compMatch[3]),
      operator: operator === '<>' ? '!=' : operator,
      value,
    }
  }

  return null
}

/**
 * Split WHERE clause by AND (ignoring ANDs inside strings/parentheses)
 */
export function splitWhereConditions(whereClause: string): string[] {
  const conditions: string[] = []
  let current = ''
  let inString = false
  let stringChar = ''
  let depth = 0
  const upperWhere = whereClause.toUpperCase()
  let i = 0

  while (i < whereClause.length) {
    const char = whereClause[i]

    if (!inString && (char === "'" || char === '"')) {
      inString = true
      stringChar = char
      current += char
    } else if (inString && char === stringChar) {
      inString = false
      current += char
    } else if (!inString && char === '(') {
      depth++
      current += char
    } else if (!inString && char === ')') {
      depth--
      current += char
    } else if (!inString && depth === 0) {
      // Check for AND keyword
      if (
        upperWhere.substring(i, i + 5) === ' AND ' ||
        upperWhere.substring(i, i + 4) === 'AND '
      ) {
        conditions.push(current.trim())
        current = ''
        i += upperWhere[i] === ' ' ? 4 : 3
        continue
      }
      current += char
    } else {
      current += char
    }
    i++
  }

  if (current.trim()) {
    conditions.push(current.trim())
  }

  return conditions
}

// ============================================================================
// ORDER BY PARSING
// ============================================================================

export interface OrderByClause {
  column: string
  descending: boolean
}

/**
 * Parse ORDER BY clause
 */
export function parseOrderBy(orderByClause: string): OrderByClause[] {
  return orderByClause.split(',').map((part) => {
    const trimmed = part.trim()
    const descMatch = trimmed.match(/(.+?)\s+DESC$/i)
    const ascMatch = trimmed.match(/(.+?)\s+ASC$/i)
    const column = extractColumnName(descMatch?.[1] || ascMatch?.[1] || trimmed)
    return {
      column,
      descending: !!descMatch,
    }
  })
}

// ============================================================================
// SET CLAUSE PARSING (for UPDATE)
// ============================================================================

export interface SetAssignment {
  column: string
  value?: StorageValue
  expression?: {
    sourceColumn: string
    operator: '+' | '-' | '*' | '/'
    operand: number
  }
}

export interface ParseSetClauseResult {
  assignments: SetAssignment[]
  paramsConsumed: number
}

/**
 * Parse SET clause for UPDATE statement
 * Returns assignments and count of params consumed (for positional ? params)
 */
export function parseSetClause(
  setPart: string,
  params: SQLValue[],
  dialect: DialectConfig
): ParseSetClauseResult {
  const assignments: SetAssignment[] = []
  const parts = splitValues(setPart)
  const paramIndex = { current: 0 }

  for (const part of parts) {
    const match = part.match(/(?:"([^"]+)"|`([^`]+)`|(\w+))\s*=\s*(.+)/i)
    if (match) {
      const column = (match[1] || match[2] || match[3]).toLowerCase()
      const valuePart = match[4].trim()

      // Check for expression like "col = col + ?" or "col = col - 50"
      const exprMatch = valuePart.match(/^(\w+)\s*([+\-*/])\s*(.+)$/i)
      if (exprMatch) {
        const sourceColumn = exprMatch[1].toLowerCase()
        const operator = exprMatch[2] as '+' | '-' | '*' | '/'
        const operandPart = exprMatch[3].trim()

        // Get operand value
        let operand: number
        if (operandPart === '?') {
          operand = normalizeValue(params[paramIndex.current++], dialect) as number
        } else {
          const pgMatch = operandPart.match(/^\$(\d+)$/)
          if (pgMatch) {
            operand = normalizeValue(params[parseInt(pgMatch[1], 10) - 1], dialect) as number
          } else {
            operand = parseFloat(operandPart)
          }
        }

        assignments.push({
          column,
          expression: { sourceColumn, operator, operand },
        })
      } else {
        // Simple value assignment
        const value = resolveValuePart(valuePart, params, paramIndex, dialect)
        assignments.push({ column, value })
      }
    }
  }

  return { assignments, paramsConsumed: paramIndex.current }
}
