/**
 * Workflow Query Parser
 *
 * Parses Temporal-like SQL query strings into structured filters.
 * Supports basic syntax: Field = "value" AND Field2 = "value2"
 */

import type { QueryFilter, QueryOperator, SearchAttributeValue } from './types'

// ============================================================================
// QUERY PARSING
// ============================================================================

/**
 * Parse a query string into structured filters.
 *
 * Supported syntax:
 * - Simple equality: `WorkflowType = "orderWorkflow"`
 * - Status filter: `Status = "RUNNING"`
 * - Combined (AND): `WorkflowType = "orderWorkflow" AND Status = "RUNNING"`
 * - Search attributes: `customerId = "cust-123"`
 *
 * @param query Query string in Temporal-like SQL syntax
 * @returns Array of QueryFilter objects
 */
export function parseQuery(query: string): QueryFilter[] {
  if (!query || query.trim() === '') {
    return []
  }

  const filters: QueryFilter[] = []

  // Split by AND (case insensitive)
  const conditions = query.split(/\s+AND\s+/i)

  for (const condition of conditions) {
    const filter = parseCondition(condition.trim())
    if (filter) {
      filters.push(filter)
    }
  }

  return filters
}

/**
 * Parse a single condition into a QueryFilter
 */
function parseCondition(condition: string): QueryFilter | null {
  // Match patterns like: Field = "value" or Field = 'value'
  // Also supports: Field != "value", Field > 123, etc.
  const operatorPattern = /^(\w+)\s*(=|!=|>=|<=|>|<|IN|NOT\s+IN)\s*(.+)$/i

  const match = condition.match(operatorPattern)
  if (!match) {
    return null
  }

  const [, field, operatorRaw, valueRaw] = match
  const operator = normalizeOperator(operatorRaw!.trim())
  const value = parseValue(valueRaw!.trim())

  if (!field || !operator || value === undefined) {
    return null
  }

  return {
    field,
    operator,
    value,
  }
}

/**
 * Normalize operator string to QueryOperator
 */
function normalizeOperator(op: string): QueryOperator {
  const normalized = op.toUpperCase().replace(/\s+/g, ' ')

  switch (normalized) {
    case '=':
      return '='
    case '!=':
      return '!='
    case '>':
      return '>'
    case '<':
      return '<'
    case '>=':
      return '>='
    case '<=':
      return '<='
    case 'IN':
      return 'IN'
    case 'NOT IN':
      return 'NOT IN'
    default:
      return '='
  }
}

/**
 * Parse a value string into the appropriate type
 */
function parseValue(valueStr: string): SearchAttributeValue | SearchAttributeValue[] | undefined {
  // Handle quoted strings (double or single quotes)
  const doubleQuoteMatch = valueStr.match(/^"([^"]*)"$/)
  if (doubleQuoteMatch) {
    return doubleQuoteMatch[1]
  }

  const singleQuoteMatch = valueStr.match(/^'([^']*)'$/)
  if (singleQuoteMatch) {
    return singleQuoteMatch[1]
  }

  // Handle array values for IN operator: (value1, value2, value3)
  const arrayMatch = valueStr.match(/^\(([^)]+)\)$/)
  if (arrayMatch) {
    return arrayMatch[1]!.split(',').map(v => parseValue(v.trim()) as SearchAttributeValue)
  }

  // Handle numbers
  if (/^-?\d+\.?\d*$/.test(valueStr)) {
    return parseFloat(valueStr)
  }

  // Handle booleans
  if (valueStr.toLowerCase() === 'true') return true
  if (valueStr.toLowerCase() === 'false') return false

  // Return as-is (unquoted string)
  return valueStr
}

// ============================================================================
// QUERY BUILDING
// ============================================================================

/**
 * Build a query string from structured filters
 */
export function buildQuery(filters: QueryFilter[]): string {
  if (filters.length === 0) {
    return ''
  }

  return filters.map(filter => buildCondition(filter)).join(' AND ')
}

/**
 * Build a single condition string
 */
function buildCondition(filter: QueryFilter): string {
  const value = formatValue(filter.value)
  return `${filter.field} ${filter.operator} ${value}`
}

/**
 * Format a value for query string
 */
function formatValue(value: SearchAttributeValue | SearchAttributeValue[]): string {
  if (Array.isArray(value)) {
    return `(${value.map(v => formatValue(v)).join(', ')})`
  }

  if (typeof value === 'string') {
    return `"${value}"`
  }

  if (value instanceof Date) {
    return `"${value.toISOString()}"`
  }

  return String(value)
}
