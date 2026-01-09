/**
 * Query Builder for Payload Database Adapter
 *
 * Translates Payload CMS where clauses to Drizzle ORM queries.
 * Supports MongoDB-like query syntax with operators:
 * - equals, not_equals
 * - in, not_in
 * - greater_than, greater_than_equal, less_than, less_than_equal
 * - like, contains
 * - exists
 * - and, or (logical operators)
 *
 * @module @dotdo/payload/adapter/query-builder
 */

import { sql, eq, ne, inArray, notInArray, gt, gte, lt, lte, like, and, or, isNull, isNotNull } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'

// ============================================================================
// CONSTANTS - Operator Maps with const assertions for type safety
// ============================================================================

/**
 * Maps Payload operator names to their handler identifiers.
 * Using const assertion ensures literal types for compile-time checks.
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

/**
 * Logical operators for combining conditions
 */
const LOGICAL_OPERATORS = {
  and: 'and',
  or: 'or',
} as const

/**
 * All valid operator names (union type for compile-time validation)
 */
type ComparisonOperator = keyof typeof COMPARISON_OPERATORS
type LogicalOperator = keyof typeof LOGICAL_OPERATORS

/**
 * Set of valid comparison operators for O(1) lookup
 */
const VALID_OPERATORS = new Set<string>(Object.keys(COMPARISON_OPERATORS))

// ============================================================================
// TYPES
// ============================================================================

/**
 * Value types for comparison operators.
 * Each operator constrains what values it accepts.
 */
type ComparisonValue = unknown
type ArrayValue = unknown[]
type NumericOrDateValue = number | string | Date
type StringValue = string
type BooleanValue = boolean

/**
 * Payload where clause operator definitions.
 * Uses mapped types for strict operator-to-value-type associations.
 */
export interface WhereOperator {
  /** Exact equality. Use null for IS NULL checks. */
  equals?: ComparisonValue
  /** Negation of equals. Use null for IS NOT NULL checks. */
  not_equals?: ComparisonValue
  /** Value must be in the provided array. Empty array returns no results. */
  in?: ArrayValue
  /** Value must not be in the provided array. Empty array returns all results. */
  not_in?: ArrayValue
  /** Numeric/date comparison: value > operand */
  greater_than?: NumericOrDateValue
  /** Numeric/date comparison: value >= operand */
  greater_than_equal?: NumericOrDateValue
  /** Numeric/date comparison: value < operand */
  less_than?: NumericOrDateValue
  /** Numeric/date comparison: value <= operand */
  less_than_equal?: NumericOrDateValue
  /** SQL LIKE pattern match. Use % for wildcards. */
  like?: StringValue
  /** Substring match. Automatically wraps with % wildcards. */
  contains?: StringValue
  /** Check field existence. true = IS NOT NULL, false = IS NULL */
  exists?: BooleanValue
}

/**
 * Payload where clause structure.
 * Supports field operators and logical AND/OR combinators.
 */
export interface WhereClause {
  [field: string]: WhereOperator | WhereClause[] | undefined
  /** Combine multiple conditions with AND logic */
  and?: WhereClause[]
  /** Combine multiple conditions with OR logic */
  or?: WhereClause[]
}

/**
 * Table type with column references for optimization.
 * Known columns are accessed directly; unknown fields use json_extract.
 */
export interface QueryTable {
  [column: string]: SQLWrapper | undefined
  /** The JSON data column for dynamic field access */
  data?: SQLWrapper
}

// ============================================================================
// FIELD REFERENCE CACHE
// ============================================================================

/**
 * Caches SQL field references to avoid rebuilding json_extract calls
 * for the same field paths across multiple conditions.
 *
 * Thread-safe within a single request (JavaScript's single-threaded nature).
 * Cache is scoped to a QueryBuilder instance for proper isolation.
 *
 * @example
 * const cache = new FieldRefCache()
 * const ref1 = cache.get('meta.featured', table)
 * const ref2 = cache.get('meta.featured', table) // Returns cached reference
 */
class FieldRefCache {
  private cache = new Map<string, SQL>()

  /**
   * Get or create a SQL reference for a field.
   *
   * @param field - The field path (e.g., 'status' or 'meta.featured')
   * @param table - The query table with column definitions
   * @returns Cached or newly created SQL reference
   */
  get(field: string, table: QueryTable): SQL {
    // Use table identity + field as cache key to handle multiple tables
    const tableKey = table.data ? 'json' : 'direct'
    const cacheKey = `${tableKey}:${field}`

    let ref = this.cache.get(cacheKey)
    if (!ref) {
      ref = buildFieldRef(field, table)
      this.cache.set(cacheKey, ref)
    }
    return ref
  }

  /**
   * Clear the cache. Call between unrelated queries if reusing the builder.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get the current cache size (useful for debugging/monitoring).
   */
  get size(): number {
    return this.cache.size
  }
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Validate a field path format.
 *
 * @param path - The field path to validate
 * @throws Error if the path is empty, starts with a dot, or contains consecutive dots
 *
 * @example
 * validateFieldPath('status')         // OK
 * validateFieldPath('meta.featured')  // OK
 * validateFieldPath('')               // Throws: Field path cannot be empty
 * validateFieldPath('.invalid')       // Throws: Field path cannot start with a dot
 * validateFieldPath('path..nested')   // Throws: Field path cannot contain consecutive dots
 */
export function validateFieldPath(path: string): void {
  if (!path || path.length === 0) {
    throw new Error('Field path cannot be empty')
  }
  if (path.startsWith('.')) {
    throw new Error('Field path cannot start with a dot')
  }
  if (path.includes('..')) {
    throw new Error('Field path cannot contain consecutive dots')
  }
}

/**
 * Convert a dot-notation field path to a JSON path for SQLite json_extract.
 * Handles both object property access (dot) and array indices (numeric segments).
 *
 * @param field - Dot-notation field path
 * @returns JSON path string for SQLite json_extract
 *
 * @example
 * toJsonPath('status')                  // '$.status'
 * toJsonPath('meta.featured')           // '$.meta.featured'
 * toJsonPath('tags.0')                  // '$.tags[0]'
 * toJsonPath('blocks.0.content.text')   // '$.blocks[0].content.text'
 */
export function toJsonPath(field: string): string {
  validateFieldPath(field)

  const parts = field.split('.')
  let path = '$'

  for (const part of parts) {
    // Check if the part is a numeric index (optimization: avoid regex for simple cases)
    if (part.length > 0 && isNumericString(part)) {
      path += `[${part}]`
    } else {
      path += `.${part}`
    }
  }

  return path
}

/**
 * Check if a string represents a non-negative integer.
 * More efficient than regex for simple numeric checks.
 *
 * @param str - The string to check
 * @returns true if the string is a valid non-negative integer
 */
function isNumericString(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 48 || code > 57) return false // '0' = 48, '9' = 57
  }
  return true
}

// ============================================================================
// FIELD REFERENCE UTILITIES
// ============================================================================

/**
 * Build a SQL reference to a field without caching.
 * Uses direct column access when available, falls back to json_extract.
 *
 * @internal Use FieldRefCache.get() for cached access
 */
function buildFieldRef(field: string, table: QueryTable): SQL {
  // Direct column access for top-level indexed fields
  const isNested = field.includes('.')

  if (!isNested && table[field]) {
    // Use direct column reference if available
    return sql`${table[field]}`
  }

  // Fall back to json_extract for nested or data fields
  const jsonPath = toJsonPath(field)
  const dataCol = table.data || sql`data`
  return sql`json_extract(${dataCol}, ${jsonPath})`
}

/**
 * Get a SQL reference to a field, using direct column access when available
 * or falling back to json_extract for nested/data fields.
 *
 * Note: For performance-critical code with many conditions on the same fields,
 * use a FieldRefCache instance instead.
 *
 * @param field - The field path (e.g., 'status' or 'meta.featured')
 * @param table - The query table with column definitions
 * @returns SQL expression for the field
 */
export function getFieldRef(field: string, table: QueryTable): SQL {
  return buildFieldRef(field, table)
}

// ============================================================================
// OPERATOR HANDLERS
// ============================================================================

/**
 * Build a SQL condition for a single field with operators.
 * Multiple operators on the same field are ANDed together.
 *
 * @param field - The field name or path
 * @param ops - Object containing operators and their values
 * @param table - The query table with column definitions
 * @param cache - Optional field reference cache for optimization
 * @returns SQL condition or undefined if no valid operators
 *
 * @example
 * // Single operator
 * buildFieldCondition('status', { equals: 'published' }, table)
 *
 * // Multiple operators (range query)
 * buildFieldCondition('price', { greater_than: 10, less_than: 100 }, table)
 */
export function buildFieldCondition(
  field: string,
  ops: WhereOperator,
  table: QueryTable,
  cache?: FieldRefCache
): SQL | undefined {
  const conditions: SQL[] = []
  const fieldRef = cache ? cache.get(field, table) : getFieldRef(field, table)

  // Handle each operator
  for (const [op, value] of Object.entries(ops)) {
    if (!isValidOperator(op)) {
      throw new QueryBuilderError(
        `Unknown operator: ${op}`,
        field,
        op,
        `Valid operators are: ${Array.from(VALID_OPERATORS).join(', ')}`
      )
    }

    const condition = buildOperatorCondition(fieldRef, op as ComparisonOperator, value, field)
    if (condition) {
      conditions.push(condition)
    }
  }

  // Optimize: return early for common cases
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]

  // Multiple operators on same field are ANDed together
  return and(...conditions)
}

/**
 * Check if an operator string is a valid comparison operator.
 *
 * @param op - The operator string to validate
 * @returns true if the operator is valid
 */
function isValidOperator(op: string): op is ComparisonOperator {
  return VALID_OPERATORS.has(op)
}

/**
 * Build a SQL condition for a single operator.
 *
 * @param fieldRef - SQL reference to the field
 * @param op - The operator name
 * @param value - The value to compare against
 * @param fieldName - Original field name for error messages
 * @returns SQL condition or undefined
 */
function buildOperatorCondition(
  fieldRef: SQL,
  op: ComparisonOperator,
  value: unknown,
  fieldName: string
): SQL | undefined {
  switch (op) {
    // ----- Equality operators -----
    case 'equals':
      if (value === null) {
        return isNull(fieldRef)
      }
      return eq(fieldRef, value)

    case 'not_equals':
      if (value === null) {
        return isNotNull(fieldRef)
      }
      return ne(fieldRef, value)

    // ----- Array membership operators -----
    case 'in':
      if (!Array.isArray(value)) {
        throw new QueryBuilderError(
          `'in' operator requires an array value`,
          fieldName,
          op,
          `Received: ${typeof value}`
        )
      }
      if (value.length === 0) {
        // Empty IN is always false - use impossible condition
        return sql`1 = 0`
      }
      return inArray(fieldRef, value)

    case 'not_in':
      if (!Array.isArray(value)) {
        throw new QueryBuilderError(
          `'not_in' operator requires an array value`,
          fieldName,
          op,
          `Received: ${typeof value}`
        )
      }
      if (value.length === 0) {
        // Empty NOT IN is always true
        return sql`1 = 1`
      }
      return notInArray(fieldRef, value)

    // ----- Comparison operators -----
    case 'greater_than':
      return gt(fieldRef, value)

    case 'greater_than_equal':
      return gte(fieldRef, value)

    case 'less_than':
      return lt(fieldRef, value)

    case 'less_than_equal':
      return lte(fieldRef, value)

    // ----- String pattern operators -----
    case 'like':
      if (typeof value !== 'string') {
        throw new QueryBuilderError(
          `'like' operator requires a string value`,
          fieldName,
          op,
          `Received: ${typeof value}`
        )
      }
      return like(fieldRef, value)

    case 'contains':
      if (typeof value !== 'string') {
        throw new QueryBuilderError(
          `'contains' operator requires a string value`,
          fieldName,
          op,
          `Received: ${typeof value}`
        )
      }
      // contains is syntactic sugar for LIKE with wildcards
      return like(fieldRef, `%${value}%`)

    // ----- Existence operator -----
    case 'exists':
      if (typeof value !== 'boolean') {
        throw new QueryBuilderError(
          `'exists' operator requires a boolean value`,
          fieldName,
          op,
          `Received: ${typeof value}`
        )
      }
      return value === true ? isNotNull(fieldRef) : isNull(fieldRef)
  }
}

// ============================================================================
// WHERE CLAUSE BUILDER
// ============================================================================

/**
 * Build a Drizzle SQL condition from a Payload where clause.
 *
 * Supports:
 * - Field operators (equals, in, greater_than, etc.)
 * - Logical combinators (and, or)
 * - Nested conditions with arbitrary depth
 * - Implicit AND for multiple top-level fields
 *
 * @param where - Payload where clause object
 * @param table - Drizzle table reference with column definitions
 * @param options - Optional configuration for query building
 * @returns SQL condition or undefined if no conditions
 *
 * @example
 * // Simple equals
 * buildWhere({ status: { equals: 'published' } }, things)
 *
 * // Multiple fields (implicit AND)
 * buildWhere({
 *   status: { equals: 'published' },
 *   featured: { equals: true }
 * }, things)
 *
 * // Explicit AND/OR logic
 * buildWhere({
 *   and: [
 *     { status: { equals: 'published' } },
 *     { or: [
 *       { featured: { equals: true } },
 *       { pinned: { equals: true } }
 *     ]}
 *   ]
 * }, things)
 */
export function buildWhere(
  where: WhereClause | undefined,
  table: QueryTable,
  options?: BuildWhereOptions
): SQL | undefined {
  if (!where || Object.keys(where).length === 0) {
    return undefined
  }

  // Use internal builder with field reference caching
  const cache = options?.cache ?? new FieldRefCache()
  return buildWhereInternal(where, table, cache)
}

/**
 * Options for buildWhere function.
 */
interface BuildWhereOptions {
  /** Pre-existing cache for field references (useful for batch operations) */
  cache?: FieldRefCache
}

/**
 * Internal recursive where clause builder with caching.
 */
function buildWhereInternal(where: WhereClause, table: QueryTable, cache: FieldRefCache): SQL | undefined {
  const conditions: SQL[] = []

  // Handle explicit AND
  if (where.and && Array.isArray(where.and)) {
    const andCondition = buildLogicalCondition(where.and, table, cache, 'and')
    if (andCondition) {
      conditions.push(andCondition)
    }
  }

  // Handle explicit OR
  if (where.or && Array.isArray(where.or)) {
    const orCondition = buildLogicalCondition(where.or, table, cache, 'or')
    if (orCondition) {
      conditions.push(orCondition)
    }
  }

  // Handle field operators (implicit AND between fields)
  for (const [field, operators] of Object.entries(where)) {
    if (field === 'and' || field === 'or') continue
    if (!operators || typeof operators !== 'object') continue

    const fieldCondition = buildFieldCondition(field, operators as WhereOperator, table, cache)
    if (fieldCondition) {
      conditions.push(fieldCondition)
    }
  }

  // Optimize: return early for common cases
  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]

  // Combine all conditions with AND
  return and(...conditions)
}

/**
 * Build a logical (AND/OR) condition from an array of where clauses.
 * Handles optimization for empty arrays and single-element arrays.
 *
 * @param clauses - Array of where clauses to combine
 * @param table - The query table
 * @param cache - Field reference cache
 * @param type - 'and' or 'or'
 * @returns Combined SQL condition or undefined
 */
function buildLogicalCondition(
  clauses: WhereClause[],
  table: QueryTable,
  cache: FieldRefCache,
  type: LogicalOperator
): SQL | undefined {
  // Handle empty arrays
  if (clauses.length === 0) {
    if (type === 'and') {
      // Empty AND is always true (matches all) - return undefined to omit
      return undefined
    } else {
      // Empty OR is always false (matches none)
      return sql`1 = 0`
    }
  }

  // Recursively build conditions
  const subConditions = clauses
    .map(w => buildWhereInternal(w, table, cache))
    .filter((c): c is SQL => c !== undefined)

  // Handle case where all sub-conditions were undefined
  if (subConditions.length === 0) {
    return type === 'and' ? undefined : sql`1 = 0`
  }

  // Optimize: single condition doesn't need wrapping
  if (subConditions.length === 1) {
    return subConditions[0]
  }

  // Combine with appropriate logical operator
  return type === 'and' ? and(...subConditions)! : or(...subConditions)!
}

// ============================================================================
// SORT BUILDER
// ============================================================================

/**
 * Build a sort clause from a Payload sort string or array.
 *
 * @param sort - Sort field(s): 'field' for ASC, '-field' for DESC
 * @param table - Drizzle table reference with column definitions
 * @param cache - Optional field reference cache
 * @returns SQL sort clause(s) or undefined
 *
 * @example
 * buildSort('createdAt', things)           // ORDER BY createdAt ASC
 * buildSort('-createdAt', things)          // ORDER BY createdAt DESC
 * buildSort(['status', '-createdAt'], things) // ORDER BY status ASC, createdAt DESC
 */
export function buildSort(
  sort: string | string[] | undefined,
  table: QueryTable,
  cache?: FieldRefCache
): SQL | SQL[] | undefined {
  if (!sort) return undefined

  const fieldCache = cache ?? new FieldRefCache()

  // Handle array of sort fields
  if (Array.isArray(sort)) {
    const sortClauses = sort
      .map(s => buildSingleSort(s, table, fieldCache))
      .filter((s): s is SQL => s !== undefined)

    if (sortClauses.length === 0) return undefined
    if (sortClauses.length === 1) return sortClauses[0]
    return sortClauses
  }

  // Handle single sort field
  return buildSingleSort(sort, table, fieldCache)
}

/**
 * Build a single sort clause.
 *
 * @param sort - Sort string with optional '-' prefix for descending
 * @param table - The query table
 * @param cache - Field reference cache
 * @returns SQL sort clause or undefined
 */
function buildSingleSort(sort: string, table: QueryTable, cache: FieldRefCache): SQL | undefined {
  if (!sort) return undefined

  const isDesc = sort.startsWith('-')
  const field = isDesc ? sort.slice(1) : sort

  const fieldRef = cache.get(field, table)

  return isDesc ? sql`${fieldRef} DESC` : sql`${fieldRef} ASC`
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Custom error class for query builder errors.
 * Provides detailed context about what went wrong and where.
 */
export class QueryBuilderError extends Error {
  /** The field that caused the error */
  readonly field: string
  /** The operator that caused the error (if applicable) */
  readonly operator?: string
  /** Additional hint for fixing the error */
  readonly hint?: string

  constructor(message: string, field: string, operator?: string, hint?: string) {
    const fullMessage = [
      message,
      `  Field: ${field}`,
      operator ? `  Operator: ${operator}` : null,
      hint ? `  Hint: ${hint}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    super(fullMessage)
    this.name = 'QueryBuilderError'
    this.field = field
    this.operator = operator
    this.hint = hint
  }
}

// ============================================================================
// EXPORTS FOR ADVANCED USE
// ============================================================================

/**
 * Create a reusable field reference cache.
 * Useful when building multiple related queries to avoid redundant computations.
 *
 * @returns A new FieldRefCache instance
 *
 * @example
 * const cache = createFieldRefCache()
 * const where1 = buildWhere(query1, table, { cache })
 * const where2 = buildWhere(query2, table, { cache })
 * const sort = buildSort('-createdAt', table, cache)
 */
export function createFieldRefCache(): FieldRefCache {
  return new FieldRefCache()
}
