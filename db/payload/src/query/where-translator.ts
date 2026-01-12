/**
 * Payload Where Clause to Things JSON Query Translator
 *
 * Translates Payload CMS where clause syntax to SQLite json_extract() queries
 * for the Things table.
 *
 * Payload where clause syntax:
 * ```typescript
 * {
 *   title: { equals: 'Hello' },
 *   status: { in: ['draft', 'published'] },
 *   views: { greater_than: 100 },
 *   'author.name': { contains: 'John' },
 *   or: [
 *     { status: { equals: 'published' } },
 *     { featured: { equals: true } }
 *   ]
 * }
 * ```
 *
 * Target SQL output:
 * ```sql
 * WHERE type = ?
 *   AND json_extract(data, '$.title') = ?
 *   AND json_extract(data, '$.status') IN (?, ?)
 *   AND json_extract(data, '$.views') > ?
 *   AND json_extract(data, '$.author.name') LIKE ?
 *   AND (
 *     json_extract(data, '$.status') = ?
 *     OR json_extract(data, '$.featured') = ?
 *   )
 * ```
 *
 * @module @dotdo/payload/query/where-translator
 */

import { sql, and, or, eq, ne, gt, gte, lt, lte, like, inArray, notInArray, isNull, isNotNull } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Field condition operators supported by Payload CMS
 */
export interface FieldCondition {
  /** Exact equality. Use null for IS NULL checks. */
  equals?: unknown
  /** Negation of equals. Use null for IS NOT NULL checks. */
  not_equals?: unknown
  /** Value must be in the provided array. Empty array returns no results. */
  in?: unknown[]
  /** Value must not be in the provided array. Empty array returns all results. */
  not_in?: unknown[]
  /** Numeric/date comparison: value > operand */
  greater_than?: number | string | Date
  /** Numeric/date comparison: value >= operand */
  greater_than_equal?: number | string | Date
  /** Numeric/date comparison: value < operand */
  less_than?: number | string | Date
  /** Numeric/date comparison: value <= operand */
  less_than_equal?: number | string | Date
  /** SQL LIKE pattern match. Use % for wildcards. */
  like?: string
  /** Substring match. Automatically wraps with % wildcards. */
  contains?: string
  /** Check field existence. true = IS NOT NULL, false = IS NULL */
  exists?: boolean
}

/**
 * Payload where clause structure.
 * Supports field operators and logical AND/OR combinators.
 */
export interface WhereClause {
  [field: string]: FieldCondition | WhereClause[] | undefined
  /** Combine multiple conditions with AND logic */
  and?: WhereClause[]
  /** Combine multiple conditions with OR logic */
  or?: WhereClause[]
}

/**
 * Result of where clause translation
 */
export interface TranslatedWhere {
  /** The generated SQL expression */
  sql: SQL
  /** The parameter values in order */
  params: unknown[]
}

/**
 * Options for the translateWhere function
 */
export interface TranslateWhereOptions {
  /** Column name for the JSON data (default: 'data') */
  dataColumn?: string
  /** Table alias to use (default: none) */
  tableAlias?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Comparison operators with const assertion for type safety
 */
const COMPARISON_OPERATORS = {
  equals: 'equals',
  not_equals: 'not_equals',
  in: 'in',
  not_in: 'not_in',
  greater_than: 'greater_than',
  greater_than_equal: 'greater_than_equal',
  less_than: 'less_than',
  less_than_equal: 'less_than_equal',
  like: 'like',
  contains: 'contains',
  exists: 'exists',
} as const

type ComparisonOperator = keyof typeof COMPARISON_OPERATORS

/**
 * Set of valid operators for O(1) lookup
 */
const VALID_OPERATORS = new Set<string>(Object.keys(COMPARISON_OPERATORS))

/**
 * Reserved keys that are not field names
 */
const RESERVED_KEYS = new Set(['and', 'or'])

// ============================================================================
// PATH VALIDATION AND CONVERSION
// ============================================================================

/**
 * Regular expression for valid JSON paths.
 * Only allows alphanumeric characters, underscores, and dots (for nested paths).
 * Does not allow:
 * - Starting or ending with dots
 * - Consecutive dots
 * - Special characters (quotes, parentheses, semicolons, etc.)
 */
const VALID_JSON_PATH_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*$/

/**
 * Validates that a field path is safe for use in SQL queries.
 * This is a critical security function to prevent SQL injection.
 *
 * @param path - The field path to validate
 * @throws Error if the path contains invalid characters or patterns
 */
export function validateFieldPath(path: string): void {
  if (!path || typeof path !== 'string') {
    throw new WhereTranslatorError('Field path cannot be empty', path)
  }

  if (path.startsWith('.')) {
    throw new WhereTranslatorError('Field path cannot start with a dot', path)
  }

  if (path.endsWith('.')) {
    throw new WhereTranslatorError('Field path cannot end with a dot', path)
  }

  if (path.includes('..')) {
    throw new WhereTranslatorError('Field path cannot contain consecutive dots', path)
  }

  // Allow alphanumeric, underscores, and dots for nested paths
  // Also allow numeric segments for array indexing
  const segments = path.split('.')
  for (const segment of segments) {
    // Each segment must be alphanumeric (allowing underscore) or purely numeric (for array indices)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(segment) && !/^[0-9]+$/.test(segment)) {
      throw new WhereTranslatorError(
        `Invalid field path segment: '${segment}'. Segments must be alphanumeric identifiers or array indices.`,
        path
      )
    }
  }
}

/**
 * Convert a dot-notation field path to a JSON path for SQLite json_extract.
 * Handles both object property access (dot) and array indices (numeric segments).
 *
 * @param field - Dot-notation field path (e.g., 'author.name' or 'tags.0')
 * @returns JSON path string for SQLite json_extract (e.g., '$.author.name' or '$.tags[0]')
 */
export function toJsonPath(field: string): string {
  validateFieldPath(field)

  const parts = field.split('.')
  let path = '$'

  for (const part of parts) {
    // Check if the part is a numeric index
    if (/^[0-9]+$/.test(part)) {
      path += `[${part}]`
    } else {
      path += `.${part}`
    }
  }

  return path
}

/**
 * Build a safe JSON path string for use with SQLite json_extract().
 * Validates the path before constructing it.
 *
 * @param path - The field path to convert
 * @param options - Translation options
 * @returns SQL expression for json_extract
 */
function buildJsonExtract(path: string, options: TranslateWhereOptions = {}): SQL {
  const jsonPath = toJsonPath(path)
  const dataColumn = options.dataColumn ?? 'data'
  const tableAlias = options.tableAlias

  if (tableAlias) {
    return sql.raw(`json_extract(${tableAlias}.${dataColumn}, '${jsonPath}')`)
  }
  return sql.raw(`json_extract(${dataColumn}, '${jsonPath}')`)
}

// ============================================================================
// OPERATOR HANDLERS
// ============================================================================

/**
 * Check if an operator string is a valid comparison operator.
 */
function isValidOperator(op: string): op is ComparisonOperator {
  return VALID_OPERATORS.has(op)
}

/**
 * Build a SQL condition for a single operator.
 *
 * @param fieldRef - SQL reference to the field (json_extract expression)
 * @param op - The operator name
 * @param value - The value to compare against
 * @param fieldName - Original field name for error messages
 * @param params - Array to push parameter values to
 * @returns SQL condition
 */
function buildOperatorCondition(
  fieldRef: SQL,
  op: ComparisonOperator,
  value: unknown,
  fieldName: string,
  params: unknown[]
): SQL | undefined {
  switch (op) {
    // ----- Equality operators -----
    case 'equals':
      if (value === null || value === undefined) {
        return isNull(fieldRef)
      }
      params.push(value)
      return eq(fieldRef, sql`${value}`)

    case 'not_equals':
      if (value === null || value === undefined) {
        return isNotNull(fieldRef)
      }
      params.push(value)
      return ne(fieldRef, sql`${value}`)

    // ----- Array membership operators -----
    case 'in':
      if (!Array.isArray(value)) {
        throw new WhereTranslatorError(
          `'in' operator requires an array value, received: ${typeof value}`,
          fieldName,
          op
        )
      }
      if (value.length === 0) {
        // Empty IN is always false - use impossible condition
        return sql`1 = 0`
      }
      params.push(...value)
      return inArray(fieldRef, value)

    case 'not_in':
      if (!Array.isArray(value)) {
        throw new WhereTranslatorError(
          `'not_in' operator requires an array value, received: ${typeof value}`,
          fieldName,
          op
        )
      }
      if (value.length === 0) {
        // Empty NOT IN is always true - return undefined to skip
        return undefined
      }
      params.push(...value)
      return notInArray(fieldRef, value)

    // ----- Comparison operators -----
    case 'greater_than':
      params.push(value)
      return gt(fieldRef, sql`${value}`)

    case 'greater_than_equal':
      params.push(value)
      return gte(fieldRef, sql`${value}`)

    case 'less_than':
      params.push(value)
      return lt(fieldRef, sql`${value}`)

    case 'less_than_equal':
      params.push(value)
      return lte(fieldRef, sql`${value}`)

    // ----- String pattern operators -----
    case 'like':
      if (typeof value !== 'string') {
        throw new WhereTranslatorError(
          `'like' operator requires a string value, received: ${typeof value}`,
          fieldName,
          op
        )
      }
      params.push(value)
      return like(fieldRef, value)

    case 'contains':
      if (typeof value !== 'string') {
        throw new WhereTranslatorError(
          `'contains' operator requires a string value, received: ${typeof value}`,
          fieldName,
          op
        )
      }
      const pattern = `%${value}%`
      params.push(pattern)
      return like(fieldRef, pattern)

    // ----- Existence operator -----
    case 'exists':
      if (typeof value !== 'boolean') {
        throw new WhereTranslatorError(
          `'exists' operator requires a boolean value, received: ${typeof value}`,
          fieldName,
          op
        )
      }
      return value === true ? isNotNull(fieldRef) : isNull(fieldRef)
  }
}

/**
 * Build SQL conditions for a single field with its operators.
 * Multiple operators on the same field are ANDed together.
 *
 * @param field - The field name or path
 * @param condition - Object containing operators and their values
 * @param params - Array to push parameter values to
 * @param options - Translation options
 * @returns SQL condition or undefined if no valid operators
 */
function buildFieldConditions(
  field: string,
  condition: FieldCondition,
  params: unknown[],
  options: TranslateWhereOptions = {}
): SQL | undefined {
  const conditions: SQL[] = []
  const fieldRef = buildJsonExtract(field, options)

  for (const [op, value] of Object.entries(condition)) {
    if (value === undefined) continue

    if (!isValidOperator(op)) {
      throw new WhereTranslatorError(
        `Unknown operator: '${op}'. Valid operators are: ${Array.from(VALID_OPERATORS).join(', ')}`,
        field,
        op
      )
    }

    const sqlCondition = buildOperatorCondition(fieldRef, op, value, field, params)
    if (sqlCondition) {
      conditions.push(sqlCondition)
    }
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return and(...conditions)
}

// ============================================================================
// MAIN TRANSLATOR FUNCTION
// ============================================================================

/**
 * Translate a Payload where clause to a SQL condition for the Things table.
 *
 * This function translates Payload's MongoDB-like query syntax to SQLite
 * json_extract() queries. It handles:
 * - Simple field conditions (equals, not_equals, in, not_in, etc.)
 * - Nested field paths (author.name -> $.author.name)
 * - Compound queries (and, or) with arbitrary nesting
 * - Array indices (tags.0 -> $.tags[0])
 *
 * SECURITY: All values are parameterized to prevent SQL injection.
 * Field paths are validated to only allow safe characters.
 *
 * @param where - Payload where clause object
 * @param typeId - The noun type ID to filter by
 * @param options - Optional configuration
 * @returns Object with SQL expression and ordered params array
 *
 * @example
 * // Simple query
 * const result = translateWhere(
 *   { title: { equals: 'Hello' } },
 *   1
 * )
 * // result.sql: WHERE type = ? AND json_extract(data, '$.title') = ?
 * // result.params: [1, 'Hello']
 *
 * @example
 * // Compound query with nested paths
 * const result = translateWhere(
 *   {
 *     'author.name': { contains: 'John' },
 *     or: [
 *       { status: { equals: 'published' } },
 *       { featured: { equals: true } }
 *     ]
 *   },
 *   1
 * )
 */
export function translateWhere(
  where: WhereClause,
  typeId: number,
  options: TranslateWhereOptions = {}
): TranslatedWhere {
  const params: unknown[] = []
  const conditions: SQL[] = []

  // Always include type filter
  const tableAlias = options.tableAlias
  const typeColumn = tableAlias ? sql.raw(`${tableAlias}.type`) : sql.raw('type')
  params.push(typeId)
  conditions.push(eq(typeColumn, sql`${typeId}`))

  // Process the where clause
  const whereCondition = processWhereClause(where, params, options)
  if (whereCondition) {
    conditions.push(whereCondition)
  }

  // Combine all conditions with AND
  const finalSql = conditions.length === 1 ? conditions[0]! : and(...conditions)!

  return {
    sql: finalSql,
    params,
  }
}

/**
 * Process a where clause recursively, handling both field conditions
 * and logical operators (and/or).
 *
 * @param where - The where clause to process
 * @param params - Array to push parameter values to
 * @param options - Translation options
 * @returns SQL condition or undefined
 */
function processWhereClause(
  where: WhereClause,
  params: unknown[],
  options: TranslateWhereOptions = {}
): SQL | undefined {
  const conditions: SQL[] = []

  // Handle explicit AND
  if (where.and && Array.isArray(where.and)) {
    const andCondition = buildLogicalCondition(where.and, params, options, 'and')
    if (andCondition) {
      conditions.push(andCondition)
    }
  }

  // Handle explicit OR
  if (where.or && Array.isArray(where.or)) {
    const orCondition = buildLogicalCondition(where.or, params, options, 'or')
    if (orCondition) {
      conditions.push(orCondition)
    }
  }

  // Handle field operators (implicit AND between fields)
  for (const [field, value] of Object.entries(where)) {
    if (RESERVED_KEYS.has(field)) continue
    if (!value || typeof value !== 'object') continue

    const fieldCondition = buildFieldConditions(field, value as FieldCondition, params, options)
    if (fieldCondition) {
      conditions.push(fieldCondition)
    }
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return and(...conditions)
}

/**
 * Build a logical (AND/OR) condition from an array of where clauses.
 *
 * @param clauses - Array of where clauses to combine
 * @param params - Array to push parameter values to
 * @param options - Translation options
 * @param type - 'and' or 'or'
 * @returns Combined SQL condition or undefined
 */
function buildLogicalCondition(
  clauses: WhereClause[],
  params: unknown[],
  options: TranslateWhereOptions,
  type: 'and' | 'or'
): SQL | undefined {
  // Handle empty arrays
  if (clauses.length === 0) {
    if (type === 'and') {
      // Empty AND is always true - return undefined to omit
      return undefined
    } else {
      // Empty OR is always false (matches none)
      return sql`1 = 0`
    }
  }

  // Recursively build conditions
  const subConditions = clauses
    .map((w) => processWhereClause(w, params, options))
    .filter((c): c is SQL => c !== undefined)

  // Handle case where all sub-conditions were undefined
  if (subConditions.length === 0) {
    return type === 'and' ? undefined : sql`1 = 0`
  }

  // Single condition doesn't need wrapping
  if (subConditions.length === 1) {
    return subConditions[0]
  }

  // Combine with appropriate logical operator
  return type === 'and' ? and(...subConditions)! : or(...subConditions)!
}

// ============================================================================
// STANDALONE TRANSLATOR (without type filter)
// ============================================================================

/**
 * Translate a Payload where clause to SQL without the type filter.
 * Useful when you want to add the type filter yourself or for testing.
 *
 * @param where - Payload where clause object
 * @param options - Optional configuration
 * @returns Object with SQL expression and ordered params array, or undefined if no conditions
 */
export function translateWhereClauseOnly(
  where: WhereClause | undefined,
  options: TranslateWhereOptions = {}
): { sql: SQL; params: unknown[] } | undefined {
  if (!where || Object.keys(where).length === 0) {
    return undefined
  }

  const params: unknown[] = []
  const sqlCondition = processWhereClause(where, params, options)

  if (!sqlCondition) {
    return undefined
  }

  return {
    sql: sqlCondition,
    params,
  }
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Custom error class for where translator errors.
 * Provides detailed context about what went wrong.
 */
export class WhereTranslatorError extends Error {
  /** The field that caused the error */
  readonly field: string
  /** The operator that caused the error (if applicable) */
  readonly operator?: string

  constructor(message: string, field: string, operator?: string) {
    const fullMessage = [
      message,
      `  Field: ${field}`,
      operator ? `  Operator: ${operator}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    super(fullMessage)
    this.name = 'WhereTranslatorError'
    this.field = field
    this.operator = operator
  }
}
