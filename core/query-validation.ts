/**
 * Query Validation Module
 *
 * Provides input validation for operator queries used in Thing queries.
 * Operators follow MongoDB-style query syntax ($gt, $lt, $in, etc.)
 *
 * @module core/query-validation
 */

import { z } from 'zod'

// =============================================================================
// OPERATOR SCHEMAS
// =============================================================================

/**
 * Comparable value types for comparison operators ($gt, $lt, $gte, $lte)
 * These operators only make sense with ordered types.
 * Note: ISO date strings remain as strings - date parsing happens at match time.
 */
const comparableValueSchema = z.union([
  z.number(),
  z.string(),
  z.date(),
])

/**
 * Schema for individual comparison operators
 * Each operator has specific value type requirements.
 */
export const operatorSchema = z
  .object({
    /** Greater than - requires comparable value */
    $gt: comparableValueSchema.optional(),
    /** Less than - requires comparable value */
    $lt: comparableValueSchema.optional(),
    /** Greater than or equal - requires comparable value */
    $gte: comparableValueSchema.optional(),
    /** Less than or equal - requires comparable value */
    $lte: comparableValueSchema.optional(),
    /** Equality - accepts any value */
    $eq: z.unknown().optional(),
    /** Not equal - accepts any value */
    $ne: z.unknown().optional(),
    /** In array - must be an array of values */
    $in: z.array(z.unknown()).optional(),
    /** Not in array - must be an array of values */
    $nin: z.array(z.unknown()).optional(),
    /** Exists check - must be boolean */
    $exists: z.boolean().optional(),
    /** Regex match - must be string or RegExp */
    $regex: z.union([z.string(), z.instanceof(RegExp)]).optional(),
  })
  .strict()
  .refine(
    (obj) => Object.keys(obj).length > 0,
    { message: 'Operator object must have at least one operator' }
  )

/**
 * Type guard to check if a value is an operator object (has $ prefixed keys)
 */
export function isOperatorObject(value: unknown): value is OperatorQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every((k) => k.startsWith('$'))
}

/**
 * Known operator names for validation
 */
export const VALID_OPERATORS = [
  '$gt',
  '$lt',
  '$gte',
  '$lte',
  '$eq',
  '$ne',
  '$in',
  '$nin',
  '$exists',
  '$regex',
] as const

export type ValidOperator = (typeof VALID_OPERATORS)[number]

/**
 * Type for operator query objects
 */
export type OperatorQuery = z.infer<typeof operatorSchema>

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Custom error class for query validation failures
 */
export class QueryValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public operator?: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'QueryValidationError'
  }
}

/**
 * Validate a single field's operator query
 *
 * @param field - The field name being queried
 * @param operators - The operator object to validate
 * @throws QueryValidationError if validation fails
 */
export function validateOperatorQuery(
  field: string,
  operators: unknown
): OperatorQuery {
  // Check if it looks like an operator object
  if (!isOperatorObject(operators)) {
    throw new QueryValidationError(
      `Expected operator object for field '${field}', got ${typeof operators}`,
      field
    )
  }

  // Check for unknown operators
  const keys = Object.keys(operators)
  for (const key of keys) {
    if (!VALID_OPERATORS.includes(key as ValidOperator)) {
      throw new QueryValidationError(
        `Unknown operator '${key}' in field '${field}'. Valid operators: ${VALID_OPERATORS.join(', ')}`,
        field,
        key
      )
    }
  }

  // Validate the operator values
  const result = operatorSchema.safeParse(operators)
  if (!result.success) {
    const firstError = result.error.errors[0]
    const path = firstError.path.join('.')
    throw new QueryValidationError(
      `Invalid operator value in field '${field}': ${firstError.message}`,
      field,
      path,
      firstError
    )
  }

  return result.data
}

/**
 * Validate a complete where clause with potentially multiple fields and operators
 *
 * @param where - The where clause object
 * @returns Validated where clause with normalized operator values
 * @throws QueryValidationError if validation fails
 */
export function validateWhereClause(
  where: Record<string, unknown>
): Record<string, unknown | OperatorQuery> {
  const validated: Record<string, unknown | OperatorQuery> = {}

  for (const [field, value] of Object.entries(where)) {
    // Skip null/undefined values (they're valid simple queries)
    if (value === null || value === undefined) {
      validated[field] = value
      continue
    }

    // Check if this is an operator query
    if (typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value)
      const hasOperators = keys.some((k) => k.startsWith('$'))

      if (hasOperators) {
        // Validate as operator query
        validated[field] = validateOperatorQuery(field, value)
      } else {
        // Treat as simple equality match
        validated[field] = value
      }
    } else {
      // Simple value - equality match
      validated[field] = value
    }
  }

  return validated
}

// =============================================================================
// OPERATOR EXECUTION
// =============================================================================

/**
 * Compare two values, handling different types appropriately
 */
function compareValues(a: unknown, b: unknown): number {
  // Handle null/undefined
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime()
  }

  // Convert date strings for comparison
  if (typeof a === 'string' && typeof b === 'string') {
    // Try to parse as dates if they look like ISO strings
    const dateA = Date.parse(a)
    const dateB = Date.parse(b)
    if (!isNaN(dateA) && !isNaN(dateB)) {
      return dateA - dateB
    }
    // String comparison
    return a.localeCompare(b)
  }

  // Numeric comparison
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  // Coerce to string for comparison
  return String(a).localeCompare(String(b))
}

/**
 * Check if a value matches an operator query
 *
 * @param value - The value from the thing being filtered
 * @param operators - The validated operator query
 * @returns true if the value matches all operators
 */
export function matchesOperators(
  value: unknown,
  operators: OperatorQuery
): boolean {
  // $gt - greater than
  if (operators.$gt !== undefined) {
    if (compareValues(value, operators.$gt) <= 0) return false
  }

  // $lt - less than
  if (operators.$lt !== undefined) {
    if (compareValues(value, operators.$lt) >= 0) return false
  }

  // $gte - greater than or equal
  if (operators.$gte !== undefined) {
    if (compareValues(value, operators.$gte) < 0) return false
  }

  // $lte - less than or equal
  if (operators.$lte !== undefined) {
    if (compareValues(value, operators.$lte) > 0) return false
  }

  // $eq - equality
  if (operators.$eq !== undefined) {
    if (value !== operators.$eq) return false
  }

  // $ne - not equal
  if (operators.$ne !== undefined) {
    if (value === operators.$ne) return false
  }

  // $in - value in array
  if (operators.$in !== undefined) {
    if (!operators.$in.includes(value)) return false
  }

  // $nin - value not in array
  if (operators.$nin !== undefined) {
    if (operators.$nin.includes(value)) return false
  }

  // $exists - field exists check
  if (operators.$exists !== undefined) {
    const exists = value !== undefined && value !== null
    if (operators.$exists !== exists) return false
  }

  // $regex - regex match
  if (operators.$regex !== undefined) {
    if (typeof value !== 'string') return false
    const regex =
      operators.$regex instanceof RegExp
        ? operators.$regex
        : new RegExp(operators.$regex)
    if (!regex.test(value)) return false
  }

  return true
}

/**
 * Check if a thing matches a where clause
 *
 * @param thing - The thing object to check
 * @param where - The validated where clause
 * @returns true if the thing matches all conditions
 */
export function matchesWhere(
  thing: Record<string, unknown>,
  where: Record<string, unknown | OperatorQuery>
): boolean {
  for (const [field, condition] of Object.entries(where)) {
    const value = thing[field]

    // Check if condition is an operator query
    if (
      condition !== null &&
      typeof condition === 'object' &&
      !Array.isArray(condition)
    ) {
      const keys = Object.keys(condition)
      if (keys.some((k) => k.startsWith('$'))) {
        // Operator query
        if (!matchesOperators(value, condition as OperatorQuery)) {
          return false
        }
        continue
      }
    }

    // Simple equality check
    if (value !== condition) {
      return false
    }
  }

  return true
}
