/**
 * JSONPath Query Builder
 *
 * Builds SQL WHERE clauses from MongoDB-like query syntax using SQLite JSON functions.
 */

import type { WhereClause, QueryOperators, OrderBy } from './types'

/**
 * Convert a dot-notation path to SQLite json_extract path
 * e.g., "metadata.tier" -> "$.metadata.tier"
 */
export function toJsonPath(field: string): string {
  // Validate path - no empty segments
  if (field.includes('..')) {
    throw new Error(`Invalid path: "${field}" contains empty segments`)
  }

  // System fields like $id, $type, etc. are stored as columns
  if (field.startsWith('$')) {
    return field
  }

  return `$.${field}`
}

/**
 * Check if a field is a system column (not in JSON data)
 */
export function isSystemField(field: string): boolean {
  return field.startsWith('$')
}

/**
 * Get the SQL expression for a field
 */
export function getFieldExpr(field: string): string {
  if (isSystemField(field)) {
    return `"${field}"`
  }
  return `json_extract(data, '${toJsonPath(field)}')`
}

/**
 * Supported operators
 */
const SUPPORTED_OPERATORS = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$like',
  '$regex',
  '$options',
  '$exists',
  '$and',
  '$or',
  '$not',
])

/**
 * Check if an object is a query operator object
 */
function isOperatorObject(value: unknown): value is QueryOperators {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.length > 0 && keys.some((k) => k.startsWith('$'))
}

/**
 * Validate that all operators are supported
 */
function validateOperators(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') && !SUPPORTED_OPERATORS.has(key)) {
      throw new Error(`Unsupported operator: ${key}`)
    }
  }
}

/**
 * Build SQL condition from operators
 */
function buildOperatorCondition(
  field: string,
  operators: QueryOperators,
  params: unknown[]
): string {
  validateOperators(operators as Record<string, unknown>)

  const conditions: string[] = []
  const fieldExpr = getFieldExpr(field)

  if ('$eq' in operators) {
    params.push(operators.$eq)
    conditions.push(`${fieldExpr} = ?`)
  }

  if ('$ne' in operators) {
    params.push(operators.$ne)
    conditions.push(`${fieldExpr} != ?`)
  }

  if ('$gt' in operators) {
    params.push(operators.$gt)
    conditions.push(`${fieldExpr} > ?`)
  }

  if ('$gte' in operators) {
    params.push(operators.$gte)
    conditions.push(`${fieldExpr} >= ?`)
  }

  if ('$lt' in operators) {
    params.push(operators.$lt)
    conditions.push(`${fieldExpr} < ?`)
  }

  if ('$lte' in operators) {
    params.push(operators.$lte)
    conditions.push(`${fieldExpr} <= ?`)
  }

  if ('$in' in operators && operators.$in) {
    const placeholders = operators.$in.map(() => '?').join(', ')
    params.push(...operators.$in)
    conditions.push(`${fieldExpr} IN (${placeholders})`)
  }

  if ('$nin' in operators && operators.$nin) {
    const placeholders = operators.$nin.map(() => '?').join(', ')
    params.push(...operators.$nin)
    conditions.push(`${fieldExpr} NOT IN (${placeholders})`)
  }

  if ('$like' in operators) {
    params.push(operators.$like)
    conditions.push(`${fieldExpr} LIKE ?`)
  }

  if ('$regex' in operators) {
    const pattern = operators.$regex
    const options = operators.$options || ''
    const caseInsensitive = options.includes('i')
    // SQLite doesn't have native regex, but we can use LIKE for simple patterns
    // or implement a custom regex via REGEXP function
    // For now, convert simple regex to LIKE pattern for basic support
    // Or use GLOB for case-sensitive matching
    if (caseInsensitive) {
      // Use LIKE with LOWER() for case-insensitive
      params.push(regexToLike(pattern!))
      conditions.push(`LOWER(${fieldExpr}) LIKE LOWER(?)`)
    } else {
      // SQLite GLOB is case-sensitive
      params.push(regexToGlob(pattern!))
      conditions.push(`${fieldExpr} GLOB ?`)
    }
  }

  if ('$exists' in operators) {
    if (operators.$exists) {
      conditions.push(`${fieldExpr} IS NOT NULL`)
    } else {
      conditions.push(`${fieldExpr} IS NULL`)
    }
  }

  return conditions.length > 0 ? conditions.join(' AND ') : '1=1'
}

/**
 * Convert simple regex patterns to SQLite LIKE patterns
 */
function regexToLike(regex: string): string {
  // Handle common regex patterns
  let pattern = regex
  // ^pattern$ -> pattern (exact match)
  // ^pattern -> pattern%
  // pattern$ -> %pattern
  // Just pattern -> %pattern%

  const startsWithAnchor = pattern.startsWith('^')
  const endsWithAnchor = pattern.endsWith('$')

  if (startsWithAnchor) pattern = pattern.slice(1)
  if (endsWithAnchor) pattern = pattern.slice(0, -1)

  // Escape SQL LIKE special chars in the pattern content
  pattern = pattern.replace(/%/g, '\\%').replace(/_/g, '\\_')

  // Replace regex wildcards
  pattern = pattern.replace(/\.\*/g, '%').replace(/\./g, '_')

  if (!startsWithAnchor) pattern = '%' + pattern
  if (!endsWithAnchor) pattern = pattern + '%'

  return pattern
}

/**
 * Convert simple regex patterns to SQLite GLOB patterns
 */
function regexToGlob(regex: string): string {
  let pattern = regex

  const startsWithAnchor = pattern.startsWith('^')
  const endsWithAnchor = pattern.endsWith('$')

  if (startsWithAnchor) pattern = pattern.slice(1)
  if (endsWithAnchor) pattern = pattern.slice(0, -1)

  // Convert regex character classes to GLOB
  // [A-C] stays as [A-C] in GLOB
  // . becomes ?
  // .* becomes *
  pattern = pattern.replace(/\.\*/g, '*').replace(/\./g, '?')

  if (!startsWithAnchor) pattern = '*' + pattern
  if (!endsWithAnchor) pattern = pattern + '*'

  return pattern
}

/**
 * Build WHERE clause from query
 */
export function buildWhereClause(
  where: WhereClause | undefined,
  params: unknown[]
): string {
  if (!where || Object.keys(where).length === 0) {
    return '1=1'
  }

  const conditions: string[] = []

  // Handle $and
  if ('$and' in where && where.$and) {
    const andConditions = where.$and.map((clause) =>
      buildWhereClause(clause, params)
    )
    conditions.push(`(${andConditions.join(' AND ')})`)
  }

  // Handle $or
  if ('$or' in where && where.$or) {
    const orConditions = where.$or.map((clause) =>
      buildWhereClause(clause, params)
    )
    conditions.push(`(${orConditions.join(' OR ')})`)
  }

  // Handle $not
  if ('$not' in where && where.$not) {
    const notCondition = buildWhereClause(where.$not, params)
    conditions.push(`NOT (${notCondition})`)
  }

  // Handle field conditions
  for (const [field, condition] of Object.entries(where)) {
    if (field.startsWith('$')) continue // Skip logical operators

    // Validate field path
    if (field.includes('..')) {
      throw new Error(`Invalid path: "${field}" contains empty segments`)
    }

    if (isOperatorObject(condition)) {
      conditions.push(buildOperatorCondition(field, condition, params))
    } else {
      // Simple equality
      const fieldExpr = getFieldExpr(field)
      params.push(condition)
      conditions.push(`${fieldExpr} = ?`)
    }
  }

  return conditions.length > 0 ? conditions.join(' AND ') : '1=1'
}

/**
 * Build ORDER BY clause
 */
export function buildOrderByClause(orderBy: OrderBy | undefined): string {
  if (!orderBy) {
    return ''
  }

  const orders: string[] = []

  if (Array.isArray(orderBy)) {
    for (const order of orderBy) {
      for (const [field, direction] of Object.entries(order)) {
        const fieldExpr = getFieldExpr(field)
        orders.push(`${fieldExpr} ${direction.toUpperCase()}`)
      }
    }
  } else {
    for (const [field, direction] of Object.entries(orderBy)) {
      const fieldExpr = getFieldExpr(field)
      orders.push(`${fieldExpr} ${direction.toUpperCase()}`)
    }
  }

  return orders.length > 0 ? `ORDER BY ${orders.join(', ')}` : ''
}
